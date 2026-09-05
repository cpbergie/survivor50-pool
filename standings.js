// ===== DERIVED SELECTORS =====
// Pure functions over the season object. No DOM, no side effects.
// The season object is data/pool.json: { players[], episodes[], totals{}, castaways[], tribes{} }.
// Points are stored per-episode (episodes[].scores[name]); cumulative is derived here.

(function (global) {
  'use strict';

  function episodeNumbers(season) {
    return (season.episodes || []).map(e => e.episode);
  }

  function lastScoredEpisode(season) {
    const nums = episodeNumbers(season);
    return nums.length ? Math.max.apply(null, nums) : 0;
  }

  // Cumulative points for one player through (and including) episode `throughEp`.
  function totalPoints(season, playerName, throughEp) {
    return (season.episodes || [])
      .filter(e => e.episode <= throughEp)
      .reduce((sum, e) => sum + (e.scores[playerName] || 0), 0);
  }

  // Standard competition ranking (1, 2, 2, 4). Returns { key: { rank, rankLabel } };
  // rankLabel gets a "T" prefix when the rank is shared.
  function rankByTotal(entries) {
    const rows = entries.slice().sort((a, b) =>
      b.total - a.total || String(a.key).localeCompare(String(b.key))
    );
    const counts = {};
    let rank = 0, prevTotal = null, seen = 0;
    rows.forEach(r => {
      seen += 1;
      if (r.total !== prevTotal) { rank = seen; prevTotal = r.total; }
      r.rank = rank;
      counts[rank] = (counts[rank] || 0) + 1;
    });
    const out = {};
    rows.forEach(r => {
      out[r.key] = { rank: r.rank, rankLabel: (counts[r.rank] > 1 ? 'T' : '') + r.rank };
    });
    return out;
  }

  // Ranked standings as of episode `ep`, keyed by player id.
  // `useAuthoritativeTotals` swaps in season.totals for the current episode so
  // sheet corrections are reflected; earlier episodes are summed from episodes[].
  function standingsAt(season, ep, useAuthoritativeTotals) {
    const players = season.players || [];
    const current = useAuthoritativeTotals && ep === lastScoredEpisode(season);
    return rankByTotal(players.map(p => ({
      key: p.id,
      total: current ? (season.totals[p.name] || 0) : totalPoints(season, p.name, ep),
    })));
  }

  // Rank change for each player between episode `ep` and `ep - 1`.
  // Positive = moved up (toward #1). {} when there is no prior episode.
  function movement(season, ep) {
    if (!ep || ep < 2) return {};
    const cur = standingsAt(season, ep, true);
    const prev = standingsAt(season, ep - 1, false);
    const out = {};
    Object.keys(cur).forEach(id => {
      const before = prev[id] ? prev[id].rank : null;
      out[id] = before == null ? 0 : before - cur[id].rank;
    });
    return out;
  }

  function eliminatedNames(season) {
    return new Set((season.castaways || [])
      .filter(c => c.status === 'eliminated' || c.eliminatedEp != null)
      .map(c => c.name));
  }

  function roster(player) {
    return [...(player.picks || []), ...(player.addedPicks || [])];
  }

  // Roster members still in the game.
  function aliveCount(player, season) {
    const elim = eliminatedNames(season);
    return roster(player).filter(n => !elim.has(n)).length;
  }

  // Points this player scored in the most recent scored episode.
  function lastEpisodePoints(season, playerName) {
    const ep = lastScoredEpisode(season);
    const row = (season.episodes || []).find(e => e.episode === ep);
    return row ? (row.scores[playerName] || 0) : 0;
  }

  global.Standings = {
    lastScoredEpisode,
    totalPoints,
    rankByTotal,
    standingsAt,
    movement,
    eliminatedNames,
    roster,
    aliveCount,
    lastEpisodePoints,
  };
})(window);
