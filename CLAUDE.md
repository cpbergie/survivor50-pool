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
- `style.css` — dark Survivor theme
- `data/pool.json` — single source of truth for the site (all scoring pre-calculated)

## Weekly update workflow
When the user says "Episode N is done. [Castaway] was voted off.":
1. Read the Google Sheet using the Google Drive connector (file ID: `1edbTrp6f6NL4KCTU8x92L7H8_tHEsd-hEG2cKz2u6-0`)
2. Find the **"Points for Ep N"** row → per-player episode score
3. Find the **"Points to date"** row for that episode → cumulative totals
4. Update `data/pool.json`:
   - Add new episode entry to `episodes` array
   - Update `totals` with cumulative totals from the sheet
   - Mark voted-off castaway as `"status": "eliminated"` in `castaways` array
   - Update `lastEpisode` to the new episode number
5. Commit locally and show the user a summary
6. **Wait for explicit approval before pushing**

## Git
Committing and pushing/merging to `main` is pre-authorized (2026-09-05) — do it on your own judgment once work is tested, and show a summary. Branch off `main` for feature work. Vercel auto-deploys `main`.

## Hard rules — no exceptions
Always stop and get explicit user confirmation before:
- Sending any message (email, Slack, etc.)
- Making any purchase
- Touching any production system beyond the normal `main` → Vercel deploy
- Taking any other irreversible or outward-facing action

## Pool.json structure
```json
{
  "lastEpisode": 11,
  "castaways": [{ "name": "...", "status": "active|eliminated" }],
  "players": [{ "name": "...", "mvp": "...", "picks": [...], "addedPicks": [...] }],
  "episodes": [{ "episode": 1, "scores": { "Clay": 0, ... } }],
  "totals": { "Clay": 653, ... }
}
```

## Players (in order)
Clay, Amy, Dan, Chris, Bryany, Julie, Mark, Kogi-pops, Sandy - Kogi, Lynne, Brenden, Woody, Claude

## Castaways
Active (as of Ep 11): Aubry, Cirie, Joe, Jonathan, Rick, Rizo, Tiffany
Eliminated: Angelina, Benjamin "Coach", Charlie, Christian, Chrissy, Colby, Dee, Emily, Genevieve, Jenna, Kamilla, Kyle, Mike, Ozzy, Quintavius "Q", Saiounia "Sia", Savannah, Shauhin, Stephanie
