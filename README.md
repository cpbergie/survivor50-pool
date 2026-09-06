# Survivor 51 Fantasy Pool

Live standings, rosters, and episode breakdowns for the Survivor 51 fantasy pool.

## Stack

- Pure HTML/CSS/JS — no framework, no build step
- `data/pool.json` is the source of truth; `standings.js` derives totals/ranks/movement
- Hosted on Vercel (static site, auto-deploys on push to `main`)

## Files

- `index.html` — structure, tabs (Standings / Rosters / Past Seasons)
- `app.js` — fetches `data/pool.json`, renders the UI
- `standings.js` — pure derived selectors (`window.Standings`)
- `style.css` — ocean/broadcast theme
- `data/pool.json` — Season 51: cast, players, per-episode castaway points
- `data/season50.json` — frozen Season 50 archive (Past Seasons tab)
- `data/season51-cast.md` — cast reference
- `WEEKLY_UPDATE.md` — how to record an episode

## Scoring

Points are entered once per castaway per episode (`episodes[].castawayPoints`). A player's
episode score is the sum of their active roster's castaway points. Everything cumulative is
derived — no stored totals.

## Local dev

```bash
python3 -m http.server 3000
```

Then open http://localhost:3000
