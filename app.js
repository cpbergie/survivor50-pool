// ===== TAB NAVIGATION =====
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// ===== LOAD DATA =====
fetch('data/pool.json')
  .then(r => r.json())
  .then(data => {
    buildStandings(data);
    buildRosters(data);
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
  const tbody = document.getElementById('standings-body');
  tbody.replaceChildren();
  sorted.forEach((player, idx) => {
    const rank = idx + 1;
    const tr = document.createElement('tr');
    if (started && rank === 1) tr.classList.add('row-1');

    const epCells = epNums.map((ep, i) => {
      const epData = episodes.find(e => e.episode === ep);
      const pts = epData ? (epData.scores[player.name] || 0) : 0;
      return `<td class="ep-pts${i > 0 ? ' ep-col-old' : ''}">${pts}</td>`;
    }).join('');

    tr.innerHTML = `
      <td>${rankCell(rank, started)}</td>
      <td class="col-player">${player.name}</td>
      <td class="total-pts">${totals[player.name] || 0}</td>
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
