// ===== STATE =====
let poolData = null;
let meIndex = {};        // playerId -> { rank, rankLabel, total, name, movement }
let meRowEl = null;
let scrollRaf = 0;
let snuffChecked = false;

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const ME_KEY = 'sft.me';
const DISMISS_KEY = 'sft.claimDismissed';
const SEEN_ELIMS_KEY = 'sft.seenElims';

// ===== STORAGE (defensive — private mode / blocked storage) =====
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
function lsDel(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
function ssGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } }
function ssDel(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } }

// ===== TAB NAVIGATION =====
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('active');
      b.removeAttribute('aria-current');
    });
    document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    btn.setAttribute('aria-current', 'page');
    document.getElementById(btn.dataset.tab).classList.add('active');
    window.scrollTo({ top: 0, behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
    refreshMeCard();
    if (btn.dataset.tab === 'rosters') maybePlaySnuffs();
  });
});

// ===== COLLAPSING HERO → MINI-HEADER =====
function updateMiniHeader() {
  const header = document.querySelector('header');
  const show = window.scrollY > header.offsetHeight - 4;
  document.getElementById('mini-header').classList.toggle('visible', show);
}

if ('IntersectionObserver' in window) {
  const sentinel = document.getElementById('header-sentinel');
  if (sentinel) {
    new IntersectionObserver(([entry]) => {
      document.getElementById('mini-header').classList.toggle('visible', !entry.isIntersecting);
    }, { threshold: 0 }).observe(sentinel);
  }
}

function onScrollFrame() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    refreshMeCard();
    updateMiniHeader();
  });
}
window.addEventListener('scroll', onScrollFrame, { passive: true });
window.addEventListener('resize', onScrollFrame, { passive: true });

// ===== LOAD DATA =====
fetch('data/pool.json')
  .then(r => r.json())
  .then(data => {
    poolData = data;
    buildStandings(data);
    buildRosters(data);
    buildWeekly(data);
    initClaim();
  })
  .catch(err => console.error('Failed to load pool data:', err));

// ===== HELPERS =====
function sortByTotal(players, totals) {
  return [...players].sort((a, b) => (totals[b.name] || 0) - (totals[a.name] || 0));
}

// Payout slots, awarded in finishing order; the AI player (Claude) is not eligible.
function computePayouts(players, totals) {
  const slots = ['$80', '$30', '$10'];
  const map = {};
  let i = 0;
  sortByTotal(players, totals).forEach(p => {
    if (p.name === 'Claude') { map[p.name] = '—'; return; }
    map[p.name] = slots[i] || '—';
    if (i < slots.length) i += 1;
  });
  return map;
}

// ===== STANDINGS =====
const TRIBE_FALLBACK = 'var(--foam-dim)';
const FLAME_SVG =
  '<svg viewBox="0 0 20 20" width="12" height="12" fill="currentColor" aria-hidden="true">' +
  '<path d="M10 1c.6 3-1.8 4.6-1.8 7.2 0 1.4.9 2.4 2 2.6-.3-1.1.2-2.3 1-3 .2 1.4 1.1 2 1.9 3 ' +
  '1.4 1.7 1 4.4-1 5.6 3.2-.4 5.4-2.9 5.4-6C17.5 8 13 5.5 12.6 1c-.7 1-1.9 1.7-2.6 0z"/></svg>';

let openDetailId = null;

function badgeFor(label, rank) {
  return rank <= 3
    ? `<span class="rank-badge rank-${rank}">${label}</span>`
    : `<span class="rank-other">${label}</span>`;
}

function movementCell(m) {
  if (m == null) return '';
  if (m === 0) return '<span class="mv mv-flat">—</span>';
  if (m > 0) return `<span class="mv mv-up">▲${m}</span>`;
  return `<span class="mv mv-down">▼${Math.abs(m)}</span>`;
}

function buildStandings(data) {
  const players = data.players || [];
  const totals = Standings.totalsByName(data);
  const lastEp = Standings.lastScoredEpisode(data);
  const started = lastEp > 0;

  document.getElementById('last-updated').textContent = started
    ? `Updated after Episode ${lastEp}` +
      (data.lastUpdated && !/pre-?season|not started/i.test(data.lastUpdated) ? ` · ${data.lastUpdated}` : '')
    : 'Season 51 · pre-season';
  document.getElementById('standings-empty').hidden = started;
  document.getElementById('standings-hint').hidden = !started;

  const sorted = sortByTotal(players, totals);
  const ranks = started
    ? Standings.rankByTotal(players.map(p => ({ key: p.id, total: totals[p.name] || 0 })))
    : {};
  const move = started ? Standings.movement(data, lastEp) : {};
  const payouts = started ? computePayouts(players, totals) : {};

  // Header
  const hr = document.createElement('tr');
  hr.innerHTML = started
    ? `<th class="c-rank">#</th>` +
      `<th class="c-move"><span aria-hidden="true">▲▼</span><span class="sr-only">Rank change since last episode</span></th>` +
      `<th class="col-player">Player</th>` +
      `<th class="c-alive"><span class="flame-ico" title="Castaways still in the game">${FLAME_SVG}</span>` +
        `<span class="sr-only">Castaways still in the game</span></th>` +
      `<th class="c-total">Total</th>`
    : `<th class="c-rank">#</th><th class="col-player">Player</th><th class="c-total">Total</th>`;
  document.querySelector('#standings-table thead').replaceChildren(hr);

  // Body
  meIndex = {};
  openDetailId = null;
  const colspan = started ? 5 : 3;
  const tbody = document.getElementById('standings-body');
  tbody.replaceChildren();

  sorted.forEach((player, idx) => {
    const total = totals[player.name] || 0;
    const info = started ? ranks[player.id] : null;
    const rank = info ? info.rank : idx + 1;
    const rankLabel = info ? info.rankLabel : String(idx + 1);
    const m = started ? (move[player.id] || 0) : null;
    const canExpand = started && Standings.roster(player).length > 0;

    if (player.id) {
      meIndex[player.id] = { rank, rankLabel, total, name: player.name, movement: m };
    }

    const tr = document.createElement('tr');
    tr.className = 'st-row';
    if (player.id) tr.dataset.playerId = player.id;
    if (rank === 1) tr.classList.add('row-1');
    if (canExpand) {
      tr.setAttribute('role', 'button');
      tr.setAttribute('tabindex', '0');
      tr.setAttribute('aria-expanded', 'false');
      tr.setAttribute('aria-controls', `st-detail-${player.id}`);
    }

    tr.innerHTML = started
      ? `<td class="c-rank">${badgeFor(rankLabel, rank)}</td>
         <td class="c-move">${movementCell(m)}</td>
         <td class="col-player"><span class="st-name">${player.name}</span>${canExpand ? '<span class="st-caret" aria-hidden="true">›</span>' : ''}</td>
         <td class="c-alive">${Standings.aliveCount(player, data)}</td>
         <td class="c-total">${total}</td>`
      : `<td class="c-rank"><span class="rank-other">${idx + 1}</span></td>
         <td class="col-player"><span class="st-name">${player.name}</span></td>
         <td class="c-total">${total}</td>`;
    tbody.appendChild(tr);

    if (canExpand) {
      const dr = document.createElement('tr');
      dr.className = 'st-detail';
      dr.id = `st-detail-${player.id}`;
      dr.hidden = true;
      dr.innerHTML = `<td colspan="${colspan}">${detailHtml(player, data, payouts)}</td>`;
      tbody.appendChild(dr);

      const toggle = () => toggleDetail(player.id);
      tr.addEventListener('click', toggle);
      tr.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    }
  });
}

function detailHtml(player, season, payouts) {
  const lastEp = Standings.lastScoredEpisode(season);
  const wk = Standings.lastEpisodePoints(season, player);
  const roster = Standings.roster(player);
  const elim = Standings.eliminatedNames(season);
  const tribes = season.tribes || {};
  const cInfo = {};
  (season.castaways || []).forEach(c => { cInfo[c.name] = c; });
  const alive = roster.filter(n => !elim.has(n)).length;
  const pay = payouts[player.name];

  const cast = roster.map(name => {
    const c = cInfo[name] || {};
    const isElim = elim.has(name);
    const color = c.tribe && tribes[c.tribe] ? tribes[c.tribe] : TRIBE_FALLBACK;
    const tag = isElim ? (c.eliminatedEp ? `Ep ${c.eliminatedEp}` : 'out') : '';
    const pts = Standings.castawayContribution(season, player, name);
    return `<li class="dcast${isElim ? ' is-elim' : ''}">
      <span class="dcast-dot" style="background:${color}"></span>
      <span class="dcast-name">${name}</span>
      ${name === player.mvp ? '<span class="dcast-mvp">MVP</span>' : ''}
      ${tag ? `<span class="dcast-ep">${tag}</span>` : ''}
      <span class="dcast-pts">${pts}</span>
    </li>`;
  }).join('');

  const mvpHit = Standings.mvpBonus(season, player);

  return `
    <div class="detail-head">
      <span class="detail-week">${wk >= 0 ? '+' : ''}${wk} in Ep ${lastEp}</span>
      <span class="detail-alive">${alive} of ${roster.length} still in</span>
      ${mvpHit ? `<span class="detail-pay">MVP hit +${mvpHit}</span>` : ''}
      ${pay && pay !== '—' ? `<span class="detail-pay">Winning ${pay}</span>` : ''}
    </div>
    <ul class="detail-cast">${cast}</ul>`;
}

function toggleDetail(id) {
  const dr = document.getElementById(`st-detail-${id}`);
  const row = document.querySelector(`.st-row[data-player-id="${id}"]`);
  if (!dr || !row) return;
  const willOpen = openDetailId !== id;

  if (openDetailId && openDetailId !== id) {
    const prevDr = document.getElementById(`st-detail-${openDetailId}`);
    const prevRow = document.querySelector(`.st-row[data-player-id="${openDetailId}"]`);
    if (prevDr) prevDr.hidden = true;
    if (prevRow) {
      prevRow.setAttribute('aria-expanded', 'false');
      prevRow.classList.remove('is-open');
    }
  }

  dr.hidden = !willOpen;
  row.setAttribute('aria-expanded', String(willOpen));
  row.classList.toggle('is-open', willOpen);
  openDetailId = willOpen ? id : null;
}

// ===== ROSTERS =====
function buildRosters(data) {
  const castaways = data.castaways || [];
  const players = data.players || [];
  const totals = Standings.totalsByName(data);

  const elimSet = Standings.eliminatedNames(data);
  const activeCastaways = castaways
    .filter(c => !Standings.isEliminated(c))
    .map(c => c.name)
    .sort((a, b) => a.localeCompare(b));

  const acEl = document.getElementById('active-castaways');
  if (castaways.length > 0) {
    acEl.hidden = false;
    acEl.innerHTML = `
      <div class="active-castaways-header">
        <span class="active-castaways-title">Still in the game</span>
        <span class="active-castaways-count">${activeCastaways.length} left</span>
      </div>
      <div class="active-castaways-list">
        ${activeCastaways.map(n => `<span class="active-castaway-pill">${n}</span>`).join('')}
      </div>
    `;
  } else {
    acEl.hidden = true;
  }

  const anyPicks = players.some(p => (p.picks || []).length || (p.addedPicks || []).length);
  document.getElementById('rosters-empty').hidden = anyPicks;

  const grid = document.getElementById('rosters-grid');
  grid.replaceChildren();

  sortByTotal(players, totals).forEach(player => {
    const card = document.createElement('div');
    card.className = 'roster-card';
    if (player.id) card.dataset.playerId = player.id;

    const addedPicks = (player.addedPicks || []).map(Standings.pickName);
    const allPicks = Standings.roster(player);

    if (allPicks.length === 0) {
      card.innerHTML = `
        <div class="roster-card-header">
          <span class="roster-player-name">${player.name}</span>
          <span class="roster-total">Draft TBD</span>
        </div>
        <div class="roster-tbd">Picks appear here after the Season 51 draft.</div>
      `;
      grid.appendChild(card);
      return;
    }

    const activeCount = allPicks.filter(p => !elimSet.has(p)).length;

    card.innerHTML = `
      <div class="roster-card-header">
        <span class="roster-player-name">${player.name}</span>
        <span class="roster-total"><span>${totals[player.name] || 0}</span> pts · ${activeCount}/${allPicks.length} alive</span>
      </div>
      <ul class="roster-picks">
        ${allPicks.map(castaway => {
          const isMvp = castaway === player.mvp;
          const isElim = elimSet.has(castaway);
          const isAdded = addedPicks.includes(castaway);
          const classes = [isMvp ? 'mvp' : '', isAdded ? 'added-pick' : '', isElim ? 'eliminated' : ''].filter(Boolean).join(' ');
          const star = isMvp
            ? '<span class="mvp-star">⭐</span>'
            : '<span class="mvp-star" style="opacity:0">⭐</span>';
          const badge = isAdded ? '<span class="added-badge">NEW</span>' : '';
          return `<li class="${classes}">${star}<span class="castaway-name">${castaway}</span>${badge}</li>`;
        }).join('')}
      </ul>
    `;
    grid.appendChild(card);
  });

  applyMe();
  maybePlaySnuffs();
}

// ===== ELIMINATION "SNUFF" =====
// Play a one-time reveal on roster entries for castaways the viewer hasn't yet
// seen eliminated. Fires when the Rosters tab is first shown.
function getSeenElims() {
  try { return new Set(JSON.parse(lsGet(SEEN_ELIMS_KEY) || '[]')); }
  catch { return new Set(); }
}

function markElimsSeen(season) {
  lsSet(SEEN_ELIMS_KEY, JSON.stringify([...Standings.eliminatedNames(season)]));
}

function maybePlaySnuffs() {
  if (snuffChecked || !poolData) return;
  if (!document.getElementById('rosters').classList.contains('active')) return;
  snuffChecked = true;

  const seen = getSeenElims();
  const fresh = new Set([...Standings.eliminatedNames(poolData)].filter(n => !seen.has(n)));
  markElimsSeen(poolData);

  // Only animate a fresh result the viewer is "seeing happen" — a normal episode
  // votes out one (occasionally two). A big backlog just renders in its final state.
  if (fresh.size === 0 || fresh.size > 2 || REDUCED_MOTION) return;

  let i = 0;
  document.querySelectorAll('#rosters-grid .roster-picks li.eliminated').forEach(li => {
    const name = li.querySelector('.castaway-name');
    if (!name || !fresh.has(name.textContent)) return;
    li.style.setProperty('--snuff-delay', Math.min(i++ * 0.06, 0.5).toFixed(2) + 's');
    li.classList.remove('snuff');
    void li.offsetWidth;               // restart the animation
    li.classList.add('snuff');
  });
}

// ===== WEEKLY POINTS =====
// Every player's score, episode by episode (the old spreadsheet grid).
function buildWeekly(data) {
  const players = data.players || [];
  const totals = Standings.totalsByName(data);
  const eps = Standings.scoredEpisodes(data).map(e => e.episode).sort((a, b) => b - a);
  const started = eps.length > 0;

  document.getElementById('weekly-empty').hidden = started;
  document.querySelector('.weekly-wrap').hidden = !started;
  if (!started) return;

  const sorted = sortByTotal(players, totals);
  const ranks = started
    ? Standings.rankByTotal(players.map(p => ({ key: p.id, total: totals[p.name] || 0 })))
    : {};

  // Best score each episode, to highlight it.
  const bestByEp = {};
  eps.forEach(ep => {
    bestByEp[ep] = players.reduce((m, p) =>
      Math.max(m, Standings.playerEpisodePoints(data, p, ep)), 0);
  });

  const hr = document.createElement('tr');
  hr.innerHTML =
    `<th>#</th><th class="col-player">Player</th><th class="c-total">Total</th>` +
    eps.map((ep, i) => `<th class="wk-ep${i === 0 ? ' wk-latest' : ''}">Ep ${ep}</th>`).join('');
  document.querySelector('#weekly-table thead').replaceChildren(hr);

  const tbody = document.getElementById('weekly-body');
  tbody.replaceChildren();

  sorted.forEach((player, idx) => {
    const info = started ? ranks[player.id] : null;
    const rank = info ? info.rank : idx + 1;
    const rankLabel = info ? info.rankLabel : String(idx + 1);

    const tr = document.createElement('tr');
    if (player.id) tr.dataset.playerId = player.id;
    if (started && rank === 1) tr.classList.add('row-1');

    const cells = eps.map((ep, i) => {
      const pts = Standings.playerEpisodePoints(data, player, ep);
      const best = pts > 0 && pts === bestByEp[ep];
      const cls = ['wk-pts', i === 0 ? 'wk-latest' : '', best ? 'wk-best' : ''].filter(Boolean).join(' ');
      return `<td class="${cls}">${pts}</td>`;
    }).join('');

    tr.innerHTML = `
      <td>${started ? badgeFor(rankLabel, rank) : `<span class="rank-other">${idx + 1}</span>`}</td>
      <td class="col-player"><span class="st-name">${player.name}</span></td>
      <td class="c-total">${totals[player.name] || 0}</td>
      ${cells}`;
    tbody.appendChild(tr);
  });

  applyMe();
}

// ===== CLAIM FLOW ("this is me", no auth) =====
function isValidId(id) {
  return !!id && !!poolData && (poolData.players || []).some(p => p.id === id);
}

function getMe() {
  const id = lsGet(ME_KEY);
  return isValidId(id) ? id : null;
}

function playerName(id) {
  const p = (poolData.players || []).find(x => x.id === id);
  return p ? p.name : '';
}

function initClaim() {
  // 1.2 — deep link: ?me=<id> sets identity, then strip the param
  const params = new URLSearchParams(location.search);
  if (params.has('me')) {
    const candidate = params.get('me');
    if (isValidId(candidate)) lsSet(ME_KEY, candidate);
    params.delete('me');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
  }

  buildClaimChips();

  document.getElementById('claim-dismiss').addEventListener('click', () => {
    ssSet(DISMISS_KEY, '1');
    setClaimBarOpen(false);
  });
  document.getElementById('me-reset').addEventListener('click', () => {
    lsDel(ME_KEY);
    ssDel(DISMISS_KEY);
    applyMe();
    setClaimBarOpen(true);
  });
  document.getElementById('me-card-btn').addEventListener('click', () => {
    if (!meRowEl) return;
    document.querySelector('.tab-btn[data-tab="standings"]').click();
    meRowEl.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'center' });
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshMeCard();
  });

  applyMe();

  // 1.1 — offer the picker if they haven't chosen and haven't dismissed this session
  setClaimBarOpen(!getMe() && ssGet(DISMISS_KEY) !== '1');
}

function buildClaimChips() {
  const wrap = document.getElementById('claim-chips');
  wrap.replaceChildren();
  (poolData.players || []).forEach(player => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'claim-chip';
    chip.dataset.id = player.id;
    chip.textContent = player.name;
    chip.addEventListener('click', () => {
      lsSet(ME_KEY, player.id);
      ssDel(DISMISS_KEY);
      setClaimBarOpen(false);
      applyMe();
      if (meRowEl) meRowEl.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'center' });
    });
    wrap.appendChild(chip);
  });
}

function setClaimBarOpen(open) {
  const bar = document.getElementById('claim-bar');
  bar.hidden = !open;
  if (open) {
    const me = getMe();
    bar.querySelectorAll('.claim-chip').forEach(c => {
      c.setAttribute('aria-pressed', String(c.dataset.id === me));
    });
  }
}

// Highlight "my" row + roster card, footer status, and (re)wire the mini-card.
function applyMe() {
  const me = getMe();

  document.querySelectorAll('.is-me').forEach(el => el.classList.remove('is-me'));

  const status = document.getElementById('me-status');
  if (!me) {
    status.hidden = true;
    meRowEl = null;
    refreshMeCard();
    return;
  }

  document.getElementById('me-status-name').textContent = playerName(me);
  status.hidden = false;

  meRowEl = document.querySelector(`#standings-body tr.st-row[data-player-id="${me}"]`);
  if (meRowEl) meRowEl.classList.add('is-me');

  document
    .querySelectorAll(`#rosters-grid .roster-card[data-player-id="${me}"], #weekly-body tr[data-player-id="${me}"]`)
    .forEach(el => el.classList.add('is-me'));

  refreshMeCard();
}

// 1.3 — sticky mini-card, shown only when "my" row is scrolled out of the
// standings view.
function refreshMeCard() {
  const card = document.getElementById('me-card');
  const me = getMe();
  const standingsActive = document.getElementById('standings').classList.contains('active');
  const info = me ? meIndex[me] : null;

  const rect = meRowEl ? meRowEl.getBoundingClientRect() : null;
  const rowInView = rect ? (rect.bottom > 8 && rect.top < window.innerHeight - 8) : true;

  if (!me || !standingsActive || !meRowEl || rowInView || !info) {
    card.hidden = true;
    return;
  }

  document.getElementById('me-card-rank').textContent = `#${info.rankLabel}`;
  document.getElementById('me-card-name').textContent = info.name;
  document.getElementById('me-card-total').textContent = `${info.total} pts`;

  const moveEl = document.getElementById('me-card-move');
  if (info.movement == null || info.movement === 0) {
    moveEl.textContent = '';
    moveEl.className = 'me-card-move';
  } else if (info.movement > 0) {
    moveEl.textContent = `▲${info.movement}`;
    moveEl.className = 'me-card-move up';
  } else {
    moveEl.textContent = `▼${Math.abs(info.movement)}`;
    moveEl.className = 'me-card-move down';
  }

  card.hidden = false;
}
