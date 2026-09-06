// ===== DERIVED SELECTORS =====
// Pure functions over the season object (data/pool.json). No DOM, no side effects.
//
//   players[]    { id, name, mvp, picks: [name | {name,fromEp?,untilEp?}…], addedPicks: […] }
//   episodes[]   { episode, scored?, castawayPoints: { castawayName: points } }
//   castaways[]  { name, tribe?, eliminatedEp? }
//   tribes?      { tribeName: "#hex" }
//   mergeEp?     episode the tribes merged
//   placements?  { "1": winnerName, "2": runnerUp, "3": third } — set after the finale
//
// Points are entered ONCE per castaway per episode (episodes[].castawayPoints) —
// survival + every event bonus, per data/scoring-rules.md. A player's episode score
// is the sum of their active roster's castaway points. End-of-season placement (+30/
// +20/+10) and MVP (+30) bonuses are added once `placements` is filled in.
// Everything cumulative (totals, ranks, movement) is derived here.

(function (global) {
  'use strict';

  function pickName(p) { return typeof p === 'string' ? p : p.name; }
  function pickFrom(p) { return typeof p === 'string' ? 1 : (p.fromEp || 1); }
  function pickUntil(p) { return typeof p === 'string' ? Infinity : (p.untilEp || Infinity); }

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

  // Picks active during episode `ep`. A pick (base or added) may carry `fromEp`
  // (added at the merge) and/or `untilEp` (swapped out); a plain string is always active.
  function rosterAt(player, ep) {
    return [...(player.picks || []), ...(player.addedPicks || [])]
      .filter(p => pickFrom(p) <= ep && ep <= pickUntil(p))
      .map(pickName);
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

  // End-of-season bonus for a castaway's final placement (set via season.placements).
  function placementBonus(season, castawayName) {
    const p = season.placements || {};
    if (p['1'] === castawayName) return 30;
    if (p['2'] === castawayName) return 20;
    if (p['3'] === castawayName) return 10;
    return 0;
  }

  // +30 if the player's MVP pick won the game.
  function mvpBonus(season, player) {
    const winner = (season.placements || {})['1'];
    return winner && player.mvp === winner ? 30 : 0;
  }

  function seasonOver(season) {
    return !!(season.placements && Object.keys(season.placements).length);
  }

  // Cumulative points through (and including) episode `throughEp`, plus any
  // end-of-season placement / MVP bonuses once the finale has been recorded.
  function totalPoints(season, player, throughEp) {
    let sum = scoredEpisodes(season)
      .filter(e => e.episode <= throughEp)
      .reduce((s, e) => s + playerEpisodePoints(season, player, e.episode), 0);
    if (seasonOver(season)) {
      roster(player).forEach(name => { sum += placementBonus(season, name); });
      sum += mvpBonus(season, player);
    }
    return sum;
  }

  // { playerName: cumulativeTotal } through the latest scored episode.
  function totalsByName(season) {
    const thru = lastScoredEpisode(season);
    const out = {};
    (season.players || []).forEach(p => { out[p.name] = totalPoints(season, p, thru); });
    return out;
  }

  // Points one castaway has contributed to one player across the season so far,
  // including their final-placement bonus once the season is over.
  function castawayContribution(season, player, name) {
    let sum = scoredEpisodes(season).reduce((s, e) =>
      rosterAt(player, e.episode).includes(name) ? s + castawayEpisodePoints(season, e, name) : s, 0);
    if (seasonOver(season) && roster(player).includes(name)) sum += placementBonus(season, name);
    return sum;
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
    placementBonus,
    mvpBonus,
    seasonOver,
    rankByTotal,
    standingsAt,
    movement,
    isEliminated,
    eliminatedNames,
    aliveCount,
    lastEpisodePoints,
  };
})(window);
