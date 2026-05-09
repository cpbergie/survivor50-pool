# Survivor 50 Pool — Project Overview & Weekly Update Process

## About the project
A weekly fantasy pool tracking Survivor 50 (US). 13 players each picked 9 castaways + 1 MVP at the start of the season. Points are scored each episode based on castaway performance.

## Links
- Live site: https://survivor50-pool-gules.vercel.app/
- GitHub: https://github.com/cpbergie/survivor50-pool
- Google Sheet (source of truth): https://docs.google.com/spreadsheets/d/1edbTrp6f6NL4KCTU8x92L7H8_tHEsd-hEG2cKz2u6-0/edit

## Stack
Plain HTML/JS/CSS → GitHub → Vercel (auto-deploys on push). All scoring is calculated in the Google Sheet; the site reads `data/pool.json` and displays it.

---

# Weekly Update Process

## What you do each week
1. Fill in the new episode tab in the Google Sheet (castaway scores per player column — the sheet auto-calculates totals)
2. Tell Claude: **"Episode [N] is done. [Castaway name] was voted off."**

That's it — Claude handles everything else.

## What Claude does
1. Reads the Google Sheet directly via the Google Drive connector (file ID: `1edbTrp6f6NL4KCTU8x92L7H8_tHEsd-hEG2cKz2u6-0`)
2. Finds the **"Points for Ep N"** row — per-player episode score
3. Finds the **"Points to date"** row from that episode — cumulative total per player
4. Updates `data/pool.json`:
   - Adds the new episode's scores to the `episodes` array
   - Updates `totals` with the new cumulative totals
   - Marks the voted-off castaway as `"status": "eliminated"` in the `castaways` array
   - Updates `lastEpisode` to the current episode number
5. Commits and pushes to GitHub → Vercel auto-deploys

## What updates on the site
- **Standings tab** — new totals, rankings, episode score column
- **Rosters tab** — voted-off castaway gets strikethrough; "Still in the game" banner updates

## Google Sheet structure (for reference)
- **Row 1**: Player names (Clay, Amy, Dan, Chris, Bryany, Julie, Mark, Kogi-pops, Sandy - Kogi, Lynne, Brenden, Woody, Claude)
- **Rows 2–25**: Per-castaway scores for the episode (filled in by you)
- **"Points for Ep N" row**: Auto-calculated episode total per player ← Claude reads this
- **"Points to date" row**: Cumulative season total per player ← Claude reads this

## Example prompt
> "Episode 12 is done. Jonathan was voted off."
