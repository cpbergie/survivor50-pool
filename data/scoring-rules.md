# Survivor Fantasy Tribe — Scoring Rules

Source: GlobalTV Survivor Fantasy Tribe (Season 50 page — Season 51 not published yet;
the system has been stable across seasons). https://www.globaltv.com/survivor-50-fantasy-tribe/

## Draft
- 3 picks from each of the 3 starting tribes → **9 picks total**
- Choose **1 of the 9 as MVP** — your pick for the Sole Survivor / winner
- **Merge bonus:** after the merge, add **1 extra castaway** (max 9 at any time).
  Points for the added pick are **not retroactive** — they start the episode *after* the merge.
- **Swap:** if you still have all 9 at the merge, you may swap one pick for a stronger
  castaway. Takes effect the episode after the merge. You keep all points already
  accumulated from the dropped pick.
- Points begin accumulating at **Episode 2**.

## Survival (per castaway, per week)
- **+1** per week survived **pre-merge**
- **+3** per week survived **post-merge**

## Final placement (end of season, one-time)
- **+10** if any of your picks comes **3rd**
- **+20** if any of your picks comes **2nd**
- **+30** if any of your picks **wins**
- **+30** if your **MVP** wins the game

## Weekly event bonuses
Earned if a castaway does the thing **visibly on screen**. Limited to **one line per
castaway per week per category** (one castaway crying twice = 5 pts; two castaways crying
= 10 pts). Excludes recaps and "next time on" previews.

### 5 points
- Wins a group Immunity Challenge
- Wins a group Reward Challenge
- Gets chosen to go on a reward
- Finds or is given a game advantage
- Plays a hidden immunity idol on themselves at Tribal Council
- Uses a game advantage at Tribal Council
- Visibly cries with tears on camera
- Says a curse word that is bleeped / censored
- Says "I miss…"
- Kisses another player still in the game
- Gets into a heated argument and shouts at another player
- Wardrobe malfunction / blurred nudity on screen
- Chooses to risk their vote
- Finds a fake immunity idol
- Hugs Jeff
- Is chosen to go on a journey

### 10 points
- Wins an individual Reward Challenge
- Finds a hidden immunity idol
- Voted out while holding a hidden immunity idol or game advantage
- Plays their Shot in the Dark
- Torch snuffed as a result of a blindside
- Treated for a medical emergency
- Chooses to forfeit the game
- Catches seafood or wildlife
- Tampers with or steals the tribe's food
- Plays a fake immunity idol at Tribal Council
- Searches through someone else's bag
- Voted out unanimously
- A hidden immunity idol is played on them by another player

### 15 points
- Wins an individual Immunity Challenge
- Draws a SAFE scroll from playing their Shot in the Dark
- Wins a fire-making challenge
- Gives an immunity idol/necklace away or plays it for another player
- Creates a fake immunity idol
- Successfully gets another player to play their fake idol at Tribal Council
- Forced to leave the game by no choice of their own (other than being voted off)

---

## How this maps to `data/pool.json`

`episodes[].castawayPoints[<castaway>]` = that castaway's **full weekly total** for the
episode: survival points (1 or 3) + every event bonus they earned that week. Enter it once
per castaway. Base source: GlobalTV's weekly results; house adjustments (things GlobalTV
missed, from the Reddit episode thread) are folded into the same number.

- `mergeEp` — the episode the tribes merged (drives the 1→3 survival rate; informational
  once we're copying GlobalTV's totals directly)
- `placements` — `{ "1": "<winner>", "2": "<runner-up>", "3": "<third>" }`, set after the
  finale. `standings.js` applies the +30 / +20 / +10 and the +30 MVP bonus.
- A mid-season swap: give the dropped pick `"untilEp": <n>` and add the new one to
  `addedPicks` with `"fromEp": <n+1>`.
