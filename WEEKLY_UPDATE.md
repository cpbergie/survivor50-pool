# Survivor 51 Pool — Weekly Update Process

## About the project
A weekly fantasy pool tracking Survivor 51 (US). 13 players each draft 9 castaways + 1 MVP
(a pick for who wins it all). Points are scored each episode based on castaway performance.

## Links
- Live site: https://survivor50-pool-gules.vercel.app/
- GitHub: https://github.com/cpbergie/survivor50-pool

## Stack
Plain HTML/JS/CSS → GitHub → Vercel (auto-deploys on push). No build step.
The site reads `data/pool.json` and `standings.js` derives everything (totals, ranks, movement)
from per-episode castaway points.

---

# Weekly Update Process

## The scoring model
Points are entered **once per castaway per episode**. A player's score for the episode is the
sum of their active roster's castaway points. There is no spreadsheet — `data/pool.json` is the
source of truth and the site computes the rest.

Base per-castaway numbers: the official **GlobalTV Survivor Fantasy Tribe** results page.
House adjustments (kissing, cursing, etc.): sourced from the week's **Reddit episode thread**
and applied on top. (A weekly job will eventually automate both.)

## What you give Claude each week
- The episode number
- Each castaway's points for that episode (or a link / paste of the official results + any
  house adjustments)
- Who was voted out / left

## What Claude does
Edits `data/pool.json`:
1. Appends to `episodes[]`:
   ```json
   { "episode": N, "castawayPoints": { "Aaliyah": 12, "Brady": 8, ... } }
   ```
   Include a number for every castaway still in the game plus whoever left this episode.
2. Sets `"eliminatedEp": N` on the castaway(s) who left, in `castaways[]`.
3. Updates `"lastUpdated"` (free text, e.g. `"Episode 3 · Jenna out"`).
4. Commits and pushes → Vercel auto-deploys.

**Never** add `totals`, `lastEpisode`, or per-player `scores` — those are derived by `standings.js`.

## What updates on the site
- **Standings** — totals, ranks, movement arrows, alive counts, and each player's
  tap-to-expand breakdown (per-castaway contribution, "+N this week", payout)
- **Rosters** — voted-out castaway gets struck through, "Still in the game" count drops,
  and a one-time "snuff" animation plays the first time you open the Rosters tab

## Mid-season roster changes
If a player replaces an eliminated pick, add to that player's `addedPicks`:
```json
{ "name": "<new castaway>", "fromEp": <first episode it should score> }
```

## Example
> "Episode 3 is done. Jenna was voted out. Here are the castaway points: Aaliyah 14,
> Alexis 9, Brady 22, ... (plus Kilby +5 for the kiss)."
