# Survivor 50 Fantasy Pool

Live standings, rosters, and episode breakdowns for the Survivor 50 fantasy pool.

## Stack

- Pure HTML/CSS/JS — no framework, no build step
- Data lives in `data/pool.json`
- Hosted on Vercel (static site, auto-deploys on push)

## Weekly Update Workflow

After each episode:
1. Sheet gets updated with new episode scores
2. KNRD pulls the Google Sheet data via CSV export
3. Updates `data/pool.json` with new episode scores, totals, and any eliminations
4. Commits and pushes to GitHub
5. Vercel auto-deploys — site is live within seconds

## Data Structure (`data/pool.json`)

- `lastEpisode` — most recent episode number
- `castaways` — all 24 castaways with status (active/eliminated)
- `players` — 13 pool players with their 9 picks and MVP
- `episodes` — per-episode score breakdown
- `totals` — cumulative totals per player

## Local Dev

```bash
# Serve locally (needed for fetch() to work)
npx serve .
# or
python3 -m http.server 3000
```

Then open http://localhost:3000
