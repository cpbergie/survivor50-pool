// ===== DERIVED SELECTORS =====
// Pure functions over the season object (data/pool.json). No DOM, no side effects.
//
//   players[]   { id, name, mvp, picks: [name…], addedPicks: [{ name, fromEp }…] }
//   episodes[]  { episode, scored?, castawayPoints: { castawayName: points } }
//   castaways[] { name, tribe?, eliminatedEp? }
//   tribes?     { tribeName: "#hex" }
//
// Points are entered ONCE per castaway per episode (episodes[].castawayPoints).
// A player's episode score = the sum of their active roster's castaway points.
// Everything cumulative (totals, ranks, movement) is derived here.

(function (global) {
  'use strict';

  function pickName(p) { return typeof p === 'string' ? p : p.name; }
  function pickFrom(p) { return typeof p === 'string' ? 1 : (p.fromEp || 1); }

  function scoredEpisodes(season) {
    return (season.episodes || []).filter(e => e.scored !== false && e.castawayPoints);
  }

  function lastScoredEpisode(season) {
    const nums = scoredEpisodes(season).map(e => e.episode);
    return nums.length ? Math.max.apply(null, nums) : 0;
  }

  function hasStarted(season) {
    return lastScoredEpisode(season) > 0;
  }

  // Every pick a player has ever held (base + all added), as names — for display.
  function roster(player) {
    return [
      ...(player.picks || []).map(pickName),
      ...(player.addedPicks || []).map(pickName),
    ];
  }

  // Picks active during episode `ep` — an added pick only counts from its fromEp.
  function rosterAt(player, ep) {
    return [
      ...(player.picks || []).map(pickName),
      ...(player.addedPicks || []).filter(p => pickFrom(p) <= ep).map(pickName),
    ];
  }

  // Episode `ep` points for one castaway — ignored once they're gone (their
  // elimination episode still counts; anything after does not).
  function castawayEpisodePoints(season, row, name) {
    const c = (season.castaways || []).find(x => x.name === name);
    if (c && c.eliminatedEp != null && c.eliminatedEp < row.episode) return 0;
    return row.castawayPoints[name] || 0;
  }

  // A player's score for one episode.
  function playerEpisodePoints(season, player, ep) {
    const row = (season.episodes || []).find(e => e.episode === ep);
    if (!row || !row.castawayPoints) return 0;
    return rosterAt(player, ep).reduce((s, name) => s + castawayEpisodePoints(season, row, name), 0);
  }

  // Cumulative points through (and including) episode `throughEp`.
  function totalPoints(season, player, throughEp) {
    return scoredEpisodes(season)
      .filter(e => e.episode <= throughEp)
      .reduce((s, e) => s + playerEpisodePoints(season, player, e.episode), 0);
  }

  // { playerName: cumulativeTotal } through the latest scored episode.
  function totalsByName(season) {
    const thru = lastScoredEpisode(season);
    const out = {};
    (season.players || []).forEach(p => { out[p.name] = totalPoints(season, p, thru); });
    return out;
  }

  // Points one castaway has contributed to one player across the season so far.
  function castawayContribution(season, player, name) {
    return scoredEpisodes(season).reduce((s, e) =>
      rosterAt(player, e.episode).includes(name) ? s + castawayEpisodePoints(season, e, name) : s, 0);
  }

  // Standard competition ranking (1, 2, 2, 4) -> { key: { rank, rankLabel } };
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

  // Ranked standings keyed by player id, as of episode `ep`.
  function standingsAt(season, ep) {
    return rankByTotal((season.players || []).map(p => ({
      key: p.id,
      total: totalPoints(season, p, ep),
    })));
  }

  // Rank change per player id between `ep` and `ep - 1`. Positive = moved up.
  function movement(season, ep) {
    if (!ep || ep < 2) return {};
    const cur = standingsAt(season, ep);
    const prev = standingsAt(season, ep - 1);
    const out = {};
    Object.keys(cur).forEach(id => {
      const before = prev[id] ? prev[id].rank : null;
      out[id] = before == null ? 0 : before - cur[id].rank;
    });
    return out;
  }

  function isEliminated(castaway) {
    return castaway.eliminatedEp != null || castaway.status === 'eliminated';
  }

  function eliminatedNames(season) {
    return new Set((season.castaways || []).filter(isEliminated).map(c => c.name));
  }

  function aliveCount(player, season) {
    const elim = eliminatedNames(season);
    return roster(player).filter(n => !elim.has(n)).length;
  }

  function lastEpisodePoints(season, player) {
    return playerEpisodePoints(season, player, lastScoredEpisode(season));
  }

  global.Standings = {
    pickName,
    scoredEpisodes,
    lastScoredEpisode,
    hasStarted,
    roster,
    rosterAt,
    playerEpisodePoints,
    totalPoints,
    totalsByName,
    castawayContribution,
    rankByTotal,
    standingsAt,
    movement,
    isEliminated,
    eliminatedNames,
    aliveCount,
    lastEpisodePoints,
  };
})(window);
