# Weekly Update Process

## What you provide
After each episode, tell Claude:
1. The **episode number**
2. **Each player's score** for that episode (from the Google Sheet)
3. **Who got voted off** (castaway name, exactly as it appears in the JSON)

## What Claude does
1. Adds the new episode's scores to the `episodes` array in `data/pool.json`
2. Recalculates each player's running `totals`
3. Marks the voted-off castaway as `"status": "eliminated"` in the `castaways` array
4. Updates `lastEpisode` to the current episode number
5. Commits and pushes to GitHub → Vercel auto-deploys

## What updates on the site
- **Standings tab** — new totals, rankings, episode score column
- **Rosters tab** — voted-off castaway gets strikethrough across all rosters; "Still in the game" banner updates automatically

## Example prompt to give Claude
> Episode 12 scores: Clay 55, Amy 40, Dan 72, Chris 61, Bryany 48, Julie 33, Mark 80, Kogi-pops 45, Sandy-Kogi 60, Lynne 70, Brenden 52, Woody 38, Claude 66. Voted off: Jonathan.

That's all that's needed — Claude handles the JSON edits, totals recalculation, commit, and push.

## Key file
`data/pool.json` — single source of truth for the site. Never edit it manually; always go through Claude to avoid calculation errors.
