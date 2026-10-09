# Survivor 51 Pool — Weekly Update Process

## The short version
Tell Claude: **"Episode N points are posted."** Claude runs the `survivor-weekly-update` skill
(`.claude/skills/survivor-weekly-update/SKILL.md`), which:

1. Reads the official per-castaway points for that episode from **GlobalTV**, and checks them against the
   results image (the image is the source; the text version behind it is hand-typed).
2. Works out who left from the numbers (a castaway who left that week gets no survival point) and checks it
   against what you tell it.
3. Writes `data/pool.json`, validates it, commits and pushes. Vercel deploys.

**GlobalTV's numbers are used as-is.** (Decided 2026-10-09: no Reddit scan or hand adjustments. The Reddit
tooling still exists in `tools/` if you ever want a one-off check, but nothing is applied without your OK.)

## When things happen
- **Episodes air Wednesday.** Points start at **Episode 2** (Ep 1 scores nothing).
- **GlobalTV posts results Thursday evening after 6pm.** Tell Claude once they're up.
- GlobalTV sometimes **re-uploads corrected results**; Claude re-checks and shows you any change.

## What you give Claude
- The episode number, and who left if you know it (Claude also infers it from the numbers).
- Any house-rule rulings (e.g. "a blurred tattoo doesn't count").

## Data
`data/pool.json` is the source of truth. An episode looks like:
```json
{
  "episode": 2,
  "source": { "globaltv": "survivor-51-episode-2-points.jpg" },
  "base":  { "Rob": 8, "Kilby": 6, "...": 0 },
  "adjustments": [ { "castaway": "Rob", "pts": 10, "reason": "Found a hidden immunity idol",
                     "source": ["https://www.reddit.com/…"] } ],
  "castawayPoints": { "Rob": 18, "Kilby": 6, "...": 0 }
}
```
`castawayPoints` (= base + adjustments) is what the site reads; `base` and `adjustments` are the audit trail.
Never add `totals`, `lastEpisode`, or per-player scores — the site derives those.

## Tools (`tools/pool_tools.py`, Python 3, no install)
| command | what it does |
|---|---|
| `globaltv --episode N` | official per-castaway points, with arithmetic self-checks and who-left inference |
| `tribes [--apply]` | tribe rosters + pick rules from the same page |
| `reddit find/fetch/scan --episode N` | find the episode's threads by name, mirror the live one once (checked for completeness), scan it offline; `--thread` also works |
| `apply --episode N …` | write the episode into `pool.json` (canonical formatting, `--dry-run`, `--replace`) |
| `check` | validate `pool.json` |

Tests: `python3 tools/test_pool_tools.py`. Tools are excluded from the deployed site (`.vercelignore`).

## Mid-season roster changes
- **Merge pick:** `addedPicks` entry `{ "name": "<castaway>", "fromEp": <merge episode + 1> }`; set `mergeEp`.
- **Swap:** mark the dropped pick `{ "name": "<castaway>", "untilEp": <n> }` and add the new one with `fromEp: n+1`.
- **Finale:** set `placements` to apply the +30/+20/+10 and MVP bonuses.
