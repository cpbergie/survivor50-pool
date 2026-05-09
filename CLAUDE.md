# Survivor 50 Fantasy Pool — Project Context

## What this is
A weekly fantasy pool website tracking Survivor 50 (US). 13 players each picked 9 castaways + 1 MVP at the start of the season. Points are scored each episode based on castaway performance.

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

## Hard rules — no exceptions
Always stop and get explicit user confirmation before:
- Committing code
- Pushing to GitHub
- Sending any message (email, Slack, etc.)
- Making any purchase
- Touching any production system
- Taking any irreversible action

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
