# Survivor Fantasy Pool — Project Context

## What this is
A weekly fantasy pool website. Each player drafts castaways + 1 MVP at the start of a season; points are scored each episode based on castaway performance. **Season 51 official format (GlobalTV): 2 tribes (Toka/Yellow, Savu/Purple), 4 picks from each = 8 picks, MVP is one of them.**

**Currently: Season 51.** Rebranded from Season 50 on 2026-09-05 (ocean/broadcast theme — keep it). Tabs: **Standings · Rosters · Weekly** (the Weekly tab is the per-player episode-by-episode points grid; it replaced a "Past Seasons" tab). The 21-castaway cast and both tribes are loaded (Aaliyah was the Episode 1 boot); the draft (picks/MVPs) is still pending — picks are due before Episode 2 (Wed Sept 30). Scoring is per-castaway-per-episode in `data/pool.json` — no spreadsheet, no stored totals. `data/season50.json` is a frozen archive, no longer shown on the site.

## Key links
- **Live site:** https://survivor50-pool-gules.vercel.app/
- **GitHub:** https://github.com/cpbergie/survivor50-pool

## Local repo
`/Users/cpbergie/claude/survivor50-pool`

## Stack
Plain HTML/JS/CSS → GitHub → Vercel (auto-deploys on push). No build step.
- `index.html` — structure and tabs (Standings, Rosters, Weekly)
- `app.js` — fetches `data/pool.json` and renders all tabs
- `style.css` — dark Survivor theme (ocean/broadcast)
- `standings.js` — pure derived selectors (`window.Standings`); everything cumulative is computed from per-episode castaway points
- `data/pool.json` — the season: cast, players, per-episode castaway points. Totals/ranks/movement are all derived at render time, never stored.
- `data/season50.json` — frozen Season 50 archive (old per-player `scores` format); kept for the record, not shown on the site
- `data/season51-cast.md` — cast reference
- `data/scoring-rules.md` — the official S51 scoring rules
- `tools/pool_tools.py` (+ `tools/test_pool_tools.py`) — GlobalTV/Reddit/apply/check CLI, stdlib Python, not deployed
- `.claude/skills/survivor-weekly-update/SKILL.md` — **the weekly workflow; follow it when the user says an episode is done**

## Scoring model
Full rules: `data/scoring-rules.md`. Points are entered **once per castaway per episode** in `episodes[].castawayPoints` — that number is the castaway's whole week (survival: +1 pre-merge / +3 post-merge, plus 5/10/15-pt event bonuses). A player's episode score = the sum of their active roster's castaway points. Added picks count from their `fromEp`; a swapped-out pick carries `untilEp`; an eliminated castaway scores in their elimination episode but not after. End-of-season placement (+30/+20/+10 for winner/2nd/3rd) and MVP (+30 if your MVP wins) bonuses are applied by `standings.js` once `placements` is set. Everything cumulative is derived — never stored.

Base per-castaway numbers come from the GlobalTV Survivor Fantasy Tribe weekly results; house adjustments (things GlobalTV missed, from the Reddit episode threads) are recorded separately as `adjustments` and added on top — see the skill.

## Weekly update workflow
Use the **`survivor-weekly-update` skill** (`.claude/skills/survivor-weekly-update/SKILL.md`). In short: GlobalTV's
per-castaway points are the base (`tools/pool_tools.py globaltv`); the r/survivor episode threads are scanned
for events GlobalTV missed (`tools/pool_tools.py reddit`); Reddit-based changes are *proposed to the user and
only applied after approval*; then `tools/pool_tools.py apply`, `check`, commit, push.

Do NOT add `totals`, `lastEpisode`, or per-player `scores` — those are derived. Never let an unknown castaway
name pass silently (add an alias instead) — a silent mismatch would score someone zero.

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
  "mergeEp": null,                  // episode the tribes merged
  "tribes": { "TribeName": "#hex" },
  "placements": {},                 // after the finale: { "1": winner, "2": runnerUp, "3": third }
  "castaways": [{ "name": "Kilby", "aliases": ["Danny"], "tribe": "Toka", "eliminatedEp": null }],   // aliases = other spellings GlobalTV/Reddit use
  "players": [{
    "id": "clay", "name": "Clay",
    "mvp": "<castaway>",            // MVP = pick for who wins it all; +30 bonus if they win. Not a weekly multiplier.
    "picks": ["<castaway>", ...],   // draft picks (official S51: 4 per tribe = 8), active from episode 1 (a swapped pick becomes { "name": "...", "untilEp": N })
    "addedPicks": [{ "name": "<castaway>", "fromEp": 6 }]  // merge/replacement picks, active from that episode
  }],
  "episodes": [{
    "episode": 1,
    "scored": true,                 // optional; set false for a scheduled-but-unscored episode
    "source": { "globaltv": "survivor-51-episode-2-points.jpg" },   // optional audit trail
    "base": { "Brady": 8, ... },                       // GlobalTV's numbers
    "adjustments": [{ "castaway": "Brady", "pts": 10, "reason": "…", "source": ["https://…"] }],
    "castawayPoints": { "Brady": 18, ... }             // = base + adjustments; the only field the site reads
  }]
}
```

## Players (in order)
Clay, Amy, Dan, Chris, Bryany, Julie, Mark, Kogi-pops, Kogi - Sandy, Lynne, Brenden, Woody, Vinny, Claude

## Castaways
Season 51 cast (21) is in `data/pool.json` (bios in `data/season51-cast.md`). Tribes: **Toka (Yellow)** — Brady, Devin, Jelly, Jenna, Kilby, Lewis, Maggie, Mike, Patt, Thien An; **Savu (Purple)** — Alexis, Ana, Carter, Cristian, Eric, Kristin, Linnea, Ori, Rob, Sharonda. Aaliyah was voted out in Episode 1 (not on the official pick list; confirmed by a Reddit comment — ask the user if in doubt). Draft (picks + MVPs) hasn't happened yet.
