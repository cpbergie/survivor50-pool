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
    buildEpisodes(data);
  })
  .catch(err => console.error('Failed to load pool data:', err));

// ===== STANDINGS =====
function buildStandings(data) {
  // Last updated
  document.getElementById('last-updated').textContent =
    `Last updated: Episode ${data.lastEpisode} · ${data.lastUpdated}`;

  // Sort players by total
  const sorted = [...data.players].sort((a, b) =>
    data.totals[b.name] - data.totals[a.name]
  );

  // Build episode column headers (most recent first)
  const epNums = [...data.episodes].sort((a, b) => b.number - a.number).map(e => e.number);
  const thead = document.querySelector('#standings-table thead tr');
  epNums.forEach((ep, idx) => {
    const th = document.createElement('th');
    th.textContent = idx === 0 ? `This Week (Ep ${ep})` : `Ep ${ep}`;
    if (idx > 0) th.classList.add('ep-col-old');
    thead.appendChild(th);
  });

  // Build rows
  const tbody = document.getElementById('standings-body');
  sorted.forEach((player, idx) => {
    const rank = idx + 1;
    const total = data.totals[player.name];
    const tr = document.createElement('tr');
    if (rank === 1) tr.classList.add('row-1');

    let rankHtml;
    if (rank <= 3) {
      rankHtml = `<span class="rank-badge rank-${rank}">${rank}</span>`;
    } else {
      rankHtml = `<span class="rank-other">${rank}</span>`;
    }

    const epCells = epNums.map((ep, idx) => {
      const epData = data.episodes.find(e => e.number === ep);
      const pts = epData ? (epData.scores[player.name] || 0) : 0;
      const cls = idx > 0 ? 'ep-pts ep-col-old' : 'ep-pts';
      return `<td class="${cls}">${pts}</td>`;
    }).join('');

    tr.innerHTML = `
      <td>${rankHtml}</td>
      <td>${player.name}</td>
      <td class="total-pts">${total}</td>
      ${epCells}
    `;
    tbody.appendChild(tr);
  });

  // Mobile toggle for older episode columns
  const tableWrap = document.querySelector('.table-wrap');
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

// ===== ROSTERS =====
function buildRosters(data) {
  const activeCastaways = data.castaways
    .filter(c => c.status === 'active')
    .map(c => c.name)
    .sort((a, b) => a.localeCompare(b));

  const eliminatedNames = data.castaways
    .filter(c => c.status === 'eliminated')
    .map(c => c.name);

  const activeCastawaysEl = document.getElementById('active-castaways');
  activeCastawaysEl.innerHTML = `
    <div class="active-castaways-header">
      <span class="active-castaways-title">Still in the game</span>
      <span class="active-castaways-count">${activeCastaways.length} left</span>
    </div>
    <div class="active-castaways-list">
      ${activeCastaways.map(name => `<span class="active-castaway-pill">${name}</span>`).join('')}
    </div>
  `;

  // Sort players by total for consistency
  const sorted = [...data.players].sort((a, b) =>
    data.totals[b.name] - data.totals[a.name]
  );

  const grid = document.getElementById('rosters-grid');

  sorted.forEach(player => {
    const total = data.totals[player.name];
    const card = document.createElement('div');
    card.className = 'roster-card';

    const activeCount = player.picks.filter(p => !eliminatedNames.includes(p)).length;

    card.innerHTML = `
      <div class="roster-card-header">
        <span class="roster-player-name">${player.name}</span>
        <span class="roster-total"><span>${total}</span> pts · ${activeCount}/9 alive</span>
      </div>
      <ul class="roster-picks">
        ${player.picks.map(castaway => {
          const isMvp = castaway === player.mvp;
          const isElim = eliminatedNames.includes(castaway);
          const classes = [isMvp ? 'mvp' : '', isElim ? 'eliminated' : ''].filter(Boolean).join(' ');
          const star = isMvp ? '<span class="mvp-star">⭐</span>' : '<span class="mvp-star" style="opacity:0">⭐</span>';
          return `<li class="${classes}">${star}<span class="castaway-name">${castaway}</span></li>`;
        }).join('')}
      </ul>
    `;
    grid.appendChild(card);
  });
}

// ===== EPISODES =====
function buildEpisodes(data) {
  const container = document.getElementById('episodes-container');

  // Build eliminated map: which castaways were eliminated each episode
  const elimByEp = {};
  data.castaways.forEach(c => {
    if (c.status === 'eliminated') {
      if (!elimByEp[c.eliminatedEp]) elimByEp[c.eliminatedEp] = [];
      elimByEp[c.eliminatedEp].push(c.name);
    }
  });

  // Most recent episode first
  const episodes = [...data.episodes].sort((a, b) => b.number - a.number);

  episodes.forEach(ep => {
    const block = document.createElement('div');
    block.className = 'episode-block';

    const votedOut = elimByEp[ep.number] || [];
    const votedOutText = votedOut.length
      ? `🪔 Snuffed: ${votedOut.join(', ')}`
      : '';

    // Castaway scores sorted descending
    const castawayRows = Object.entries(ep.castawayScores || {})
      .sort(([, a], [, b]) => b - a);
    const bestScore = castawayRows.length ? castawayRows[0][1] : 0;

    const isFirst = ep.number === episodes[0].number;
    if (!isFirst) block.classList.add('collapsed');

    block.innerHTML = `
      <div class="episode-header">
        <span class="episode-title">
          <span class="ep-chevron">▼</span>
          Episode ${ep.number}
        </span>
        ${votedOutText ? `<span class="episode-voted-out">${votedOutText}</span>` : ''}
      </div>
      <div class="episode-scores">
        ${castawayRows.map(([name, pts]) => `
          <div class="ep-score-cell">
            <span class="ep-player-name">${name}</span>
            <span class="ep-score-val${pts === bestScore ? ' best' : ''}">${pts}</span>
          </div>
        `).join('')}
      </div>
    `;

    block.querySelector('.episode-header').addEventListener('click', () => {
      block.classList.toggle('collapsed');
    });

    container.appendChild(block);
  });
}
