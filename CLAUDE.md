# Survivor Fantasy Pool — Project Context

## What this is
A weekly fantasy pool website. 13 players each draft 9 castaways + 1 MVP at the start of a season; points are scored each episode based on castaway performance.

**Currently: Season 51.** The site was rebranded from Season 50 on 2026-09-05 (ocean/broadcast theme — keep it). Season 50's final results live in the "Past Seasons" tab (`data/season50.json`). Season 51 rosters/scoring are cleared pending the new cast + draft. There's a phased mobile-first build spec in progress (Phase 1 "claim flow" is done). The Google Sheet is being retired as the scoring source — a weekly job will pull from the official site + a Reddit episode thread instead.

## Key links
- **Live site:** https://survivor50-pool-gules.vercel.app/
- **GitHub:** https://github.com/cpbergie/survivor50-pool
- **Google Sheet (source of truth):** https://docs.google.com/spreadsheets/d/1edbTrp6f6NL4KCTU8x92L7H8_tHEsd-hEG2cKz2u6-0/edit

## Local repo
`/Users/cpbergie/claude/survivor50-pool`

## Stack
Plain HTML/JS/CSS → GitHub → Vercel (auto-deploys on push). No build step.
- `index.html` — structure and tabs (Standings, Rosters)
- `app.js` — fetches `data/pool.json` and renders all tabs
- `style.css` — dark Survivor theme (ocean/broadcast)
- `standings.js` — pure derived selectors (`window.Standings`); everything cumulative is computed from per-episode castaway points
- `data/pool.json` — the season: cast, players, per-episode castaway points. Totals/ranks/movement are all derived at render time, never stored.
- `data/season50.json` — frozen Season 50 archive (old per-player `scores` format), feeds the Past Seasons tab
- `data/season51-cast.md` — cast reference

## Scoring model
Points are entered **once per castaway per episode** in `episodes[].castawayPoints`. A player's episode score = the sum of their active roster's castaway points (added picks only count from their `fromEp`; an eliminated castaway scores in their elimination episode but not after). `standings.js` derives cumulative totals, ranks, and movement.

Base per-castaway numbers come from the official GlobalTV Survivor Fantasy Tribe results; house adjustments (kissing, cursing, etc. — rules TBD from the user) are applied on top. A weekly job will eventually produce `castawayPoints` from those two sources.

## Weekly update workflow
When the user provides an episode's castaway scores and who left:
1. Add an entry to `episodes[]`: `{ "episode": N, "castawayPoints": { "<castaway>": <pts>, ... } }`
2. Set `"eliminatedEp": N` on the voted-out castaway(s) in `castaways[]`
3. Update `"lastUpdated"` (free text, e.g. `"Episode 3 · Jenna out"`)
4. Commit, push (pre-authorized), show the user a summary. Vercel auto-deploys.

Do NOT add `totals`, `lastEpisode`, or per-player `scores` — those are derived.

## Git
Committing and pushing/merging to `main` is pre-authorized (2026-09-05) — do it on your own judgment once work is tested, and show a summary. Branch off `main` for feature work. Vercel auto-deploys `main`.

## Hard rules — no exceptions
Always stop and get explicit user confirmation before:
- Sending any message (email, Slack, etc.)
- Making any purchase
- Touching any production system beyond the normal `main` → Vercel deploy
- Taking any other irreversible or outward-facing action

## Pool.json structure (Season 51)
```json
{
  "season": 51,
  "premiere": "2026-09-23",
  "lastUpdated": "Pre-season",
  "tribes": { "TribeName": "#hex" },
  "castaways": [{ "name": "Aaliyah", "tribe": "TribeName|null", "eliminatedEp": null }],
  "players": [{
    "id": "clay", "name": "Clay",
    "mvp": "<castaway>",            // MVP = pick for who wins it all (Sole Survivor); not a scoring multiplier
    "picks": ["<castaway>", ...],   // 9 draft picks, active from episode 1
    "addedPicks": [{ "name": "<castaway>", "fromEp": 6 }]  // replacements, active from that episode
  }],
  "episodes": [{
    "episode": 1,
    "scored": true,                 // optional; set false for a scheduled-but-unscored episode
    "castawayPoints": { "Aaliyah": 12, "Brady": 8, ... }
  }]
}
```

## Players (in order)
Clay, Amy, Dan, Chris, Bryany, Julie, Mark, Kogi-pops, Kogi - Sandy, Lynne, Brenden, Woody, Claude

## Castaways
Season 51 cast (21) is in `data/pool.json` and detailed in `data/season51-cast.md`. Tribes not yet announced. Draft (picks + MVPs) hasn't happened.
