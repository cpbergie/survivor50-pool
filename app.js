// ===== STATE =====
let poolData = null;
let meIndex = {};        // playerId -> { rank, rankLabel, total, name, movement }
let meRowEl = null;
let meCardRaf = 0;

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const ME_KEY = 'sft.me';
const DISMISS_KEY = 'sft.claimDismissed';

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
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
    refreshMeCard();
  });
});

// ===== LOAD DATA =====
fetch('data/pool.json')
  .then(r => r.json())
  .then(data => {
    poolData = data;
    buildStandings(data);
    buildRosters(data);
    initClaim();
  })
  .catch(err => console.error('Failed to load pool data:', err));

fetch('data/season50.json')
  .then(r => r.json())
  .then(data => buildPastSeason(data))
  .catch(err => console.error('Failed to load Season 50 data:', err));

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

function rankCell(rank, ranked) {
  return ranked && rank <= 3
    ? `<span class="rank-badge rank-${rank}">${rank}</span>`
    : `<span class="rank-other">${rank}</span>`;
}

// ===== STANDINGS =====
function buildStandings(data) {
  const totals = data.totals || {};
  const players = data.players || [];
  const episodes = data.episodes || [];
  const started = (data.lastEpisode || 0) > 0 && episodes.length > 0;

  document.getElementById('last-updated').textContent = started
    ? `Updated after Episode ${data.lastEpisode}` +
      (data.lastUpdated && data.lastUpdated !== 'Not started' ? ` · ${data.lastUpdated}` : '')
    : 'Season 51 · pre-season';
  document.getElementById('standings-empty').hidden = started;

  const sorted = sortByTotal(players, totals);
  const epNums = started
    ? [...episodes].sort((a, b) => b.episode - a.episode).map(e => e.episode)
    : [];
  const payouts = started ? computePayouts(players, totals) : {};

  // Header row
  const thead = document.querySelector('#standings-table thead');
  const hr = document.createElement('tr');
  hr.innerHTML =
    `<th>#</th><th class="col-player">Player</th><th>Total</th>` +
    (started ? `<th>Winning</th>` : ``);
  epNums.forEach((ep, idx) => {
    const th = document.createElement('th');
    th.textContent = idx === 0 ? `This Week · Ep ${ep}` : `Ep ${ep}`;
    if (idx > 0) th.classList.add('ep-col-old');
    hr.appendChild(th);
  });
  thead.replaceChildren(hr);

  // Body rows
  meIndex = {};
  const tbody = document.getElementById('standings-body');
  tbody.replaceChildren();
  sorted.forEach((player, idx) => {
    const rank = idx + 1;
    const total = totals[player.name] || 0;
    const tr = document.createElement('tr');
    if (player.id) tr.dataset.playerId = player.id;
    if (started && rank === 1) tr.classList.add('row-1');

    // NOTE: tie handling (competition ranking + "T" prefix) lands with the
    // movement/alive columns in Phase 2. Pre-season this is a stable list order.
    if (player.id) {
      meIndex[player.id] = { rank, rankLabel: String(rank), total, name: player.name, movement: null };
    }

    const epCells = epNums.map((ep, i) => {
      const epData = episodes.find(e => e.episode === ep);
      const pts = epData ? (epData.scores[player.name] || 0) : 0;
      return `<td class="ep-pts${i > 0 ? ' ep-col-old' : ''}">${pts}</td>`;
    }).join('');

    tr.innerHTML = `
      <td>${rankCell(rank, started)}</td>
      <td class="col-player">${player.name}</td>
      <td class="total-pts">${total}</td>
      ${started ? `<td class="winning-pts">${payouts[player.name] || '—'}</td>` : ``}
      ${epCells}
    `;
    tbody.appendChild(tr);
  });

  // Mobile toggle for older episode columns
  if (epNums.length > 1) {
    const tableWrap = document.querySelector('#standings .table-wrap');
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'toggle-ep-btn';
    toggleBtn.textContent = `Show all ${epNums.length} episodes`;
    let expanded = false;
    tableWrap.classList.add('ep-cols-hidden');
    toggleBtn.addEventListener('click', () => {
      expanded = !expanded;
      tableWrap.classList.toggle('ep-cols-hidden', !expanded);
      toggleBtn.textContent = expanded
        ? 'Hide older episodes'
        : `Show all ${epNums.length} episodes`;
    });
    tableWrap.after(toggleBtn);
  }
}

// ===== ROSTERS =====
function buildRosters(data) {
  const castaways = data.castaways || [];
  const players = data.players || [];
  const totals = data.totals || {};

  const activeCastaways = castaways
    .filter(c => c.status === 'active')
    .map(c => c.name)
    .sort((a, b) => a.localeCompare(b));
  const eliminatedNames = castaways
    .filter(c => c.status === 'eliminated')
    .map(c => c.name);

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

    const basePicks = player.picks || [];
    const addedPicks = player.addedPicks || [];
    const allPicks = [...basePicks, ...addedPicks];

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

    const activeCount = allPicks.filter(p => !eliminatedNames.includes(p)).length;

    card.innerHTML = `
      <div class="roster-card-header">
        <span class="roster-player-name">${player.name}</span>
        <span class="roster-total"><span>${totals[player.name] || 0}</span> pts · ${activeCount}/${allPicks.length} alive</span>
      </div>
      <ul class="roster-picks">
        ${allPicks.map(castaway => {
          const isMvp = castaway === player.mvp;
          const isElim = eliminatedNames.includes(castaway);
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
}

// ===== PAST SEASONS =====
function buildPastSeason(data) {
  const totals = data.totals || {};
  const players = data.players || [];
  const sorted = sortByTotal(players, totals);
  const payouts = computePayouts(players, totals);
  const champ = sorted[0];

  if (champ) {
    document.getElementById('past-champion').innerHTML = `
      <div class="champ-badge">Champion</div>
      <div class="champ-name">${champ.name}</div>
      <div class="champ-score">${totals[champ.name]} pts · won $80</div>
    `;
  }

  const tbody = document.getElementById('past-body');
  tbody.replaceChildren();
  sorted.forEach((player, idx) => {
    const rank = idx + 1;
    const tr = document.createElement('tr');
    if (rank === 1) tr.classList.add('row-1');
    const aiTag = player.name === 'Claude' ? '<span class="tag-ai">AI</span>' : '';
    tr.innerHTML = `
      <td>${rankCell(rank, true)}</td>
      <td class="col-player">${player.name}${aiTag}</td>
      <td class="total-pts">${totals[player.name] || 0}</td>
      <td class="winning-pts">${payouts[player.name] || '—'}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('past-foot').textContent =
    'Payouts: $80 / $30 / $10 to the top three eligible finishers. Claude (AI) plays for pride only.';
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
  window.addEventListener('scroll', scheduleMeCard, { passive: true });
  window.addEventListener('resize', scheduleMeCard, { passive: true });
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

  meRowEl = document.querySelector(`#standings-body tr[data-player-id="${me}"]`);
  if (meRowEl) meRowEl.classList.add('is-me');

  const rosterCard = document.querySelector(`#rosters-grid .roster-card[data-player-id="${me}"]`);
  if (rosterCard) rosterCard.classList.add('is-me');

  refreshMeCard();
}

function scheduleMeCard() {
  if (meCardRaf) return;
  meCardRaf = requestAnimationFrame(() => { meCardRaf = 0; refreshMeCard(); });
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
