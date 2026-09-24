# Survivor Fantasy Tribe — Scoring Rules (Season 51)

Source: the official GlobalTV page, read 2026-09-24 — https://www.globaltv.com/survivor-51-fantasy-tribe/
(Season 50's page was the model; S51 changed the draft format and added categories, marked **NEW** / **CHANGED**.)

## Draft — **CHANGED**
- **2 starting tribes** (Toka / Yellow, Savu / Purple). Pick **4 from each tribe → 8 picks total**
  (Season 50: 3 tribes × 3 = 9).
- Choose **1 of the 8 as your MVP** — your pick for the Sole Survivor.
- You can never hold more than **8** castaways at once.
- **Merge bonus:** after the merge, add **1 extra castaway** (if you've lost some). Points for the added pick
  are **not retroactive** — they start the episode *after* the merge.
- **Swap:** if you still have all 8 at the merge you may swap one pick for a stronger castaway (effective the
  episode after the merge). You keep every point already earned by the dropped pick.
- Points begin at **Episode 2**. Results are posted **Thursday evenings after 6pm** (first one: Oct 1).

## Survival (per castaway, per week)
- **+1** per week survived **pre-merge** · **+3** per week survived **post-merge**
- A castaway who leaves during a week earns **no survival point** that week (their events still count).

## Final placement (end of season, one-time)
- **+10** a pick comes **3rd** · **+20** a pick comes **2nd** · **+30** a pick **wins** · **+30** your **MVP** wins

## Weekly event bonuses
Earned if a castaway does it **visibly on screen**. Limited to **one line per castaway per week per category**
(one castaway crying twice = 5; two castaways crying = 10). Recaps and "next time on" previews don't count.

### 5 points
- Wins a group Immunity Challenge
- Wins a group Reward Challenge
- Gets chosen to go on reward
- Finds or gets a game advantage
- Plays a hidden immunity idol on themselves at Tribal Council
- Uses a game advantage at Tribal Council
- Visually cries with tears on camera
- Says a curse word that is bleeped/censored
- Says "I miss…"
- Kisses another player still in the game
- Gets into a heated argument and shouts at another player
- Wardrobe malfunction / nudity that is blurred on screen
- Chooses to risk their vote
- Finds a fake immunity idol
- Hugs Jeff
- **NEW** Buys something with fire tokens

### 10 points
- Wins an individual Reward Challenge
- Finds a hidden immunity idol
- Voted out while in possession of a hidden immunity idol or game advantage
- Plays their Shot in the Dark
- Torch gets snuffed as a result of a blindside
- Gets treated for a medical emergency
- Chooses to forfeit the game
- Catches seafood or wildlife
- Tampers with or steals the tribe's food
- Plays a fake immunity idol at Tribal Council
- Searches through someone else's bag
- Voted out unanimously
- A hidden immunity idol is played on them by another player
- **NEW** Is chosen to flip the "million-dollar coin"
- **CHANGED** Is chosen to go on a journey **or sent to Exile Island** (was 5 pts, journey only)

### 15 points
- Wins an individual Immunity Challenge
- Draws a SAFE scroll as a result of playing their Shot in the Dark
- Wins a fire-making challenge
- Gives an immunity idol/necklace away or plays it for another player
- Creates a fake immunity idol
- Successfully gets another player to play their fake idol at Tribal Council
- Is forced to leave the game by no choice of their own (other than being voted off)
- **NEW** Returns to the game after being voted off/eliminated
- **NEW** Successfully flips the "million-dollar" coin and isn't eliminated

---

## How this maps to `data/pool.json`

`episodes[].castawayPoints[<castaway>]` = that castaway's **full weekly total** (survival + every event
bonus). GlobalTV's weekly numbers are the `base`; anything they missed goes in `adjustments` (each with a
reason and source link) and `castawayPoints` = base + adjustments. `standings.js` derives everything else.

Every GlobalTV weekly number is **self-checking**: `total % 5` is `0` for a castaway who left that week
(events only), and `1` (pre-merge) or `3` (post-merge) for one who stayed. `tools/pool_tools.py` uses this to
flag typos, detect an unrecorded merge, and infer who left each week. (Verified on all 12 posted weeks of
Season 50.)

- `mergeEp` — the episode the tribes merged (drives the 1→3 survival check)
- `placements` — `{ "1": winner, "2": runner-up, "3": third }`, set after the finale
- Mid-season swap: give the dropped pick `"untilEp": <n>`; add the new one to `addedPicks` with `"fromEp": <n+1>`
