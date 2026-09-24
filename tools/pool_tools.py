#!/usr/bin/env python3
"""Survivor fantasy pool tools (stdlib only, no build step).

  globaltv   Read a week's per-castaway points from GlobalTV's Fantasy Tribe page
  tribes     Read the tribe rosters + pick rules from that page (--apply loads them)
  reddit     Mirror archived r/survivor episode threads locally and scan them
  apply      Write an episode into data/pool.json (canonical formatting, audit trail)
  check      Validate data/pool.json
  format     Rewrite data/pool.json in canonical formatting

Design notes
  * The site never sees this code. It only reads data/pool.json.
  * GlobalTV publishes each week as a JPG whose alt text carries the numbers, e.g.
    "Aubry total points: 13; Cirie total points: 15; ...". We parse the alt text and
    the skill cross-checks it against the image itself.
  * Every castaway number is: survival (1 pre-merge / 3 post-merge, 0 if they left that
    week) + event bonuses (multiples of 5). That makes each number self-checking, and
    lets us infer who left a given week (see analyze_totals).
  * Reddit access goes through the public Arctic Shift archive (Reddit itself blocks
    unauthenticated clients). We mirror a thread once, then analyse offline.
  * Anything unrecognised (a castaway name, a malformed row) fails loudly instead of
    silently scoring someone zero.

Exit codes: 0 ok · 1 error · 2 validation / unknown names · 3 results not posted yet
"""
from __future__ import annotations

import argparse
import datetime as dt
import difflib
import json
import re
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POOL = ROOT / "data" / "pool.json"
STANDINGS_JS = ROOT / "standings.js"
CACHE = ROOT / "tools" / ".cache"

GLOBALTV_URL = "https://www.globaltv.com/survivor-51-fantasy-tribe/"
UA_BROWSER = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 "
              "(KHTML, like Gecko) Version/17.0 Safari/605.1.15")
UA_TOOL = "survivor-pool-tools/1.0 (+https://github.com/cpbergie/survivor50-pool)"
ARCTIC = "https://arctic-shift.photon-reddit.com/api/comments/search"

NUM_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
             "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12}

# Buff colours on a dark background (tuned for the site's ocean theme).
BUFF_HEX = {"yellow": "#f2c230", "purple": "#9d7bff", "orange": "#f08a24", "teal": "#1fb5a8",
            "blue": "#4b9bff", "red": "#e5484d", "green": "#3fb950", "pink": "#ec4899",
            "black": "#8b95a1", "white": "#e5e7eb", "gray": "#8b95a1", "grey": "#8b95a1"}


class ToolError(Exception):
    def __init__(self, msg: str, code: int = 1):
        super().__init__(msg)
        self.code = code


def log(*a):
    print(*a, file=sys.stderr)


# ───────────────────────────── names ─────────────────────────────

def norm(s: str) -> str:
    """Case/quote/punctuation-insensitive key: 'An “Thien An”' -> 'an thien an'."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[\"“”„‟‘’'`´]", "", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


class NameIndex:
    """Maps any spelling GlobalTV/Reddit uses back to the pool's castaway name."""

    def __init__(self, castaways: list[dict]):
        self.by_key: dict[str, str] = {}
        self.canonical = [c["name"] for c in castaways]
        for c in castaways:
            spellings = {c["name"], *c.get("aliases", [])}
            if c.get("fullName"):
                spellings.add(c["fullName"])
            for sp in spellings:
                k = norm(sp)
                if self.by_key.get(k, c["name"]) != c["name"]:
                    raise ToolError(f"alias collision: {sp!r} maps to both "
                                    f"{self.by_key[k]!r} and {c['name']!r}")
                self.by_key[k] = c["name"]

    def resolve(self, raw: str) -> str | None:
        return self.by_key.get(norm(raw))

    def suggest(self, raw: str) -> list[str]:
        hits = difflib.get_close_matches(norm(raw), list(self.by_key), n=3, cutoff=0.5)
        return sorted({self.by_key[h] for h in hits})


# ───────────────────────── pool.json I/O ─────────────────────────
# Canonical formatting keeps diffs to just the lines that changed: castaways and
# players stay one object per line, an episode is a small block.

def inline(v) -> str:
    if isinstance(v, dict):
        if not v:
            return "{}"
        return "{ " + ", ".join(f"{json.dumps(k, ensure_ascii=False)}: {inline(x)}"
                                for k, x in v.items()) + " }"
    if isinstance(v, list):
        return "[" + ", ".join(inline(x) for x in v) + "]"
    return json.dumps(v, ensure_ascii=False)


def _format_episode(ep: dict, last: bool) -> list[str]:
    out = ["    {"]
    keys = list(ep)
    for i, k in enumerate(keys):
        v, comma, kj = ep[k], ("," if i < len(keys) - 1 else ""), json.dumps(k)
        if k in ("base", "castawayPoints") and isinstance(v, dict) and v:
            out.append(f"      {kj}: {{")
            items = list(v.items())
            for j, (n, p) in enumerate(items):
                out.append(f"        {json.dumps(n, ensure_ascii=False)}: {json.dumps(p)}"
                           f"{',' if j < len(items) - 1 else ''}")
            out.append(f"      }}{comma}")
        elif k == "adjustments" and isinstance(v, list) and v:
            out.append(f"      {kj}: [")
            for j, a in enumerate(v):
                out.append(f"        {inline(a)}{',' if j < len(v) - 1 else ''}")
            out.append(f"      ]{comma}")
        else:
            out.append(f"      {kj}: {inline(v)}{comma}")
    out.append("    }" + ("" if last else ","))
    return out


def format_pool(d: dict) -> str:
    lines = ["{"]
    keys = list(d)
    for i, k in enumerate(keys):
        v, comma, kj = d[k], ("," if i < len(keys) - 1 else ""), json.dumps(k)
        if k in ("castaways", "players") and isinstance(v, list) and v:
            lines.append(f"  {kj}: [")
            for j, item in enumerate(v):
                lines.append(f"    {inline(item)}{',' if j < len(v) - 1 else ''}")
            lines.append(f"  ]{comma}")
        elif k == "episodes" and isinstance(v, list) and v:
            lines.append('  "episodes": [')
            for j, ep in enumerate(v):
                lines.extend(_format_episode(ep, last=(j == len(v) - 1)))
            lines.append(f"  ]{comma}")
        else:
            lines.append(f"  {kj}: {inline(v)}{comma}")
    lines.append("}")
    return "\n".join(lines) + "\n"


def load_pool(path: Path | str = POOL) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def save_pool(d: dict, path: Path | str = POOL) -> None:
    Path(path).write_text(format_pool(d), encoding="utf-8")


# ─────────────────────── survival-point arithmetic ───────────────────────

def survival_options(ep: int, merge_ep: int | None) -> tuple[int, ...]:
    """Survival points a castaway who *stayed* earns in episode `ep`."""
    if merge_ep is None or ep < merge_ep:
        return (1,)
    if ep == merge_ep:
        return (1, 3)          # rules don't say which rate applies in the merge week
    return (3,)


def analyze_totals(points: dict[str, int], ep: int, merge_ep: int | None) -> dict[str, dict]:
    """Classify each castaway's weekly number.

    total = survival + events, events are multiples of 5, survival is 1 or 3, and a
    castaway who left that week earns no survival point. So total % 5 is:
      0        -> left the game this week  (events only)
      1 or 3   -> stayed (matching the survival rate)
      other    -> anomaly: a typo, or the merge hasn't been recorded in pool.json
    """
    opts = survival_options(ep, merge_ep)
    ok = {o % 5: o for o in opts}
    out = {}
    for name, total in points.items():
        r = total % 5
        if r == 0:
            out[name] = {"total": total, "status": "left", "eventPoints": total}
        elif r in ok:
            out[name] = {"total": total, "status": "stayed", "eventPoints": total - ok[r]}
        else:
            out[name] = {"total": total, "status": "anomaly", "eventPoints": None}
    return out


# ───────────────────────────── globaltv ─────────────────────────────

HEADING_RE = re.compile(r"(?:EPISODE|EP\.?|WEEK)\s*#?\s*(\d+)\s+POINTS?", re.I)
FILE_RE = re.compile(r"episode-(\d+)-points(?:[_-]?(v?\d+))?", re.I)
ALT_ITEM = re.compile(r"^\s*(?P<name>.+?)\s+total points:\s*(?P<pts>-?\d+)\s*$", re.I)


class ResultsParser(HTMLParser):
    """Emits ('heading', n) and ('img', src, alt) in document order."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.events: list[tuple] = []
        self._buf: list[str] = []

    def _flush(self):
        text, self._buf = "".join(self._buf), []
        for m in HEADING_RE.finditer(text):
            self.events.append(("heading", int(m.group(1))))

    def handle_data(self, data):
        self._buf.append(data)

    def handle_endtag(self, tag):
        self._flush()

    def handle_starttag(self, tag, attrs):
        self._flush()
        if tag == "img":
            a = dict(attrs)
            src, alt = a.get("src") or "", a.get("alt") or ""
            if "points" in src.lower() or "total points" in alt.lower():
                self.events.append(("img", src, alt))

    def close(self):
        super().close()
        self._flush()


def parse_alt(alt: str) -> tuple[dict[str, int], list[str]]:
    pts, bad = {}, []
    for part in alt.split(";"):
        part = part.strip()
        if not part:
            continue
        m = ALT_ITEM.match(part)
        if not m:
            bad.append(part)
            continue
        pts[m["name"].strip()] = int(m["pts"])
    return pts, bad


def parse_results(html_text: str) -> tuple[dict[int, dict], list[str]]:
    """{episode: {image, alt, raw, bad, fileEpisode, version}}, warnings.

    Each image belongs to the heading ABOVE it in document order (GlobalTV's markup is
    <p>…<strong>EPISODE 12 POINTS:</strong></p><p><img ep12/> <strong>EPISODE 11…). File
    names are unreliable (they've mislabelled episodes), so we pair on position and only
    warn when the file name disagrees.
    """
    p = ResultsParser()
    p.feed(html_text)
    p.close()
    warnings, found = [], {}
    cur = None
    for ev in p.events:
        if ev[0] == "heading":
            cur = ev[1]
            continue
        _, src, alt = ev
        fm = FILE_RE.search(src)
        file_ep = int(fm.group(1)) if fm else None
        ep = cur if cur is not None else file_ep
        if ep is None:
            warnings.append(f"image with no heading and no episode in its filename: {src}")
            continue
        if cur is None:
            warnings.append(f"no heading before {src}; used the episode in its filename ({ep})")
        raw, bad = parse_alt(alt)
        rec = {"image": src, "alt": alt, "raw": raw, "bad": bad, "fileEpisode": file_ep,
               "version": (fm.group(2) if fm else None)}
        if ep in found:
            warnings.append(f"episode {ep}: more than one image under its heading; using the last")
        found[ep] = rec
        if file_ep is not None and file_ep != ep:
            warnings.append(f"episode {ep}: image file is named for episode {file_ep} "
                            f"({src.rsplit('/', 1)[-1]}) — paired by position, please eyeball the image")
    return found, warnings


def http_get(url: str, ua: str = UA_BROWSER, binary: bool = False, timeout: int = 40):
    req = urllib.request.Request(url, headers={"User-Agent": ua})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read()
    except urllib.error.URLError as e:
        raise ToolError(f"could not fetch {url}: {e}") from e
    return data if binary else data.decode("utf-8", "replace")


def page_html(args) -> tuple[str, str]:
    if getattr(args, "html", None):
        return Path(args.html).read_text(encoding="utf-8"), f"file:{args.html}"
    return http_get(args.url), args.url


def cmd_globaltv(args) -> int:
    html_text, source = page_html(args)
    pool = load_pool(args.pool)
    idx = NameIndex(pool["castaways"])
    merge_ep = pool.get("mergeEp")
    found, warnings = parse_results(html_text)
    posted = sorted(found)

    if not found:
        log("GlobalTV has no results images posted yet.")
        print(json.dumps({"source": source, "postedEpisodes": [], "episodes": {}}, indent=2))
        return 3
    wanted = [args.episode] if args.episode else posted
    if args.episode and args.episode not in found:
        log(f"Episode {args.episode} is not posted yet. Posted so far: {posted}")
        return 3

    by_ep_members = {}
    out_eps, unknown_all = {}, {}
    for ep in sorted(found):
        rec = found[ep]
        norm_pts, unknown = {}, []
        for raw_name, pts in rec["raw"].items():
            name = idx.resolve(raw_name)
            if name is None:
                unknown.append(raw_name)
            elif name in norm_pts:
                raise ToolError(f"episode {ep}: {raw_name!r} resolves to {name!r} twice", 2)
            else:
                norm_pts[name] = pts
        by_ep_members[ep] = set(norm_pts)
        if unknown:
            unknown_all[ep] = unknown
        detail = analyze_totals(norm_pts, ep, merge_ep)
        w = [f"unparseable row in alt text: {b!r}" for b in rec["bad"]]
        w += [f"{n}: total {d['total']} doesn't fit survival + multiples of 5 "
              f"(merge recorded at ep {merge_ep})" for n, d in detail.items() if d["status"] == "anomaly"]
        out_eps[ep] = {"image": rec["image"], "imageVersion": rec["version"],
                       "fileEpisode": rec["fileEpisode"], "points": norm_pts, "detail": detail,
                       "inferredLeft": sorted(n for n, d in detail.items() if d["status"] == "left"),
                       "warnings": w}

    # continuity: who left in N should be exactly who is missing from N+1
    for ep in sorted(found):
        nxt = ep + 1
        if nxt in by_ep_members:
            gone = by_ep_members[ep] - by_ep_members[nxt]
            inferred = set(out_eps[ep]["inferredLeft"])
            if gone != inferred:
                out_eps[ep]["warnings"].append(
                    f"who left (from numbers) {sorted(inferred)} != who vanished before ep {nxt} {sorted(gone)}")

    # castaways the pool thinks are in the game but the page omits (and vice versa)
    known = {c["name"]: c.get("eliminatedEp") for c in pool["castaways"]}
    for ep in wanted:
        members = set(out_eps[ep]["points"])
        alive = {n for n, e in known.items() if e is None or e >= ep}
        if members and alive:
            missing, extra = sorted(alive - members), sorted(members - alive)
            if missing:
                out_eps[ep]["warnings"].append(f"pool has these active but GlobalTV omits them: {missing}")
            if extra:
                out_eps[ep]["warnings"].append(f"GlobalTV lists these but the pool has them eliminated earlier: {extra}")

    if args.save_images:
        d = Path(args.save_images)
        d.mkdir(parents=True, exist_ok=True)
        for ep in wanted:
            url = urllib.parse.urljoin(source, out_eps[ep]["image"])
            path = d / f"episode-{ep}.jpg"
            path.write_bytes(http_get(url, binary=True))
            out_eps[ep]["imageFile"] = str(path)

    bad_names = {ep: u for ep, u in unknown_all.items() if ep in wanted}
    if bad_names and not args.allow_unknown:
        for ep, names in bad_names.items():
            for n in names:
                sug = idx.suggest(n)
                log(f"UNKNOWN castaway on episode {ep}: {n!r}" + (f"  (did you mean {', '.join(sug)}?)" if sug else ""))
        log("Add each spelling to that castaway's \"aliases\" in data/pool.json, then re-run "
            "(or pass --allow-unknown to skip them).")
        return 2

    result = {"source": source, "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
              "postedEpisodes": posted, "mergeEp": merge_ep,
              "episodes": {str(e): out_eps[e] for e in wanted}, "warnings": warnings}
    text = json.dumps(result, indent=2, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
    else:
        print(text)

    for ep in wanted:
        e = out_eps[ep]
        log(f"\nEpisode {ep}  ({e['image'].rsplit('/', 1)[-1]})  {len(e['points'])} castaways")
        for n, d in sorted(e["detail"].items(), key=lambda kv: -kv[1]["total"]):
            ev = "?" if d["eventPoints"] is None else d["eventPoints"]
            log(f"  {n:<10} {d['total']:>3}   {d['status']:<8} events={ev}")
        if e["inferredLeft"]:
            log(f"  -> numbers say these left the game this week: {', '.join(e['inferredLeft'])}")
        for w in e["warnings"]:
            log(f"  WARNING: {w}")
    for w in warnings:
        log(f"WARNING: {w}")
    return 0


# ───────────────────────────── tribes ─────────────────────────────

class TableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self._t = self._r = self._c = None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._t = []
        elif tag == "tr" and self._t is not None:
            self._r = []
        elif tag in ("td", "th") and self._r is not None:
            self._c = []

    def handle_data(self, data):
        if self._c is not None:
            self._c.append(data)

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._c is not None and self._r is not None:
            self._r.append(" ".join("".join(self._c).split()))
            self._c = None
        elif tag == "tr" and self._r is not None and self._t is not None:
            self._t.append(self._r)
            self._r = None
        elif tag == "table" and self._t is not None:
            self.tables.append(self._t)
            self._t = None


def strip_tags(html_text: str) -> str:
    html_text = re.sub(r"(?is)<(script|style).*?</\1>", " ", html_text)
    return " ".join(re.sub(r"<[^>]+>", " ", html_text).split())


def parse_tribes(html_text: str) -> dict:
    tp = TableParser()
    tp.feed(html_text)
    tribes = {}
    for table in tp.tables:
        if not table:
            continue
        hdr = [re.match(r"^(?P<name>.+?)\s*\((?P<color>[A-Za-z ]+?)\s+Tribe\)", c, re.I) for c in table[0]]
        if not all(hdr):
            continue
        for col, m in enumerate(hdr):
            members = [row[col] for row in table[1:] if col < len(row) and row[col].strip()]
            tribes[m["name"].strip()] = {"color": m["color"].strip().lower(), "members": members}
        break
    text = strip_tags(html_text)
    rules = {}
    m = re.search(r"Pick\s+(\w+)\s+castaways\s+from\s+each\s+tribe", text, re.I)
    if m:
        rules["picksPerTribe"] = NUM_WORDS.get(m.group(1).lower(), m.group(1))
    m = re.search(r"(\w+)\s+picks\s+in\s+total", text, re.I)
    if m:
        rules["totalPicks"] = NUM_WORDS.get(m.group(1).lower(), m.group(1))
    m = re.search(r"can\s*not\s+have\s+more\s+than\s+(\w+)\s+castaways", text, re.I)
    if m:
        rules["maxRoster"] = NUM_WORDS.get(m.group(1).lower(), m.group(1))
    m = re.search(r"beginning on ([A-Z][a-z]+ \d+)", text)
    if m:
        rules["resultsBeginOn"] = m.group(1)
    return {"tribes": tribes, "rules": rules}


def cmd_tribes(args) -> int:
    html_text, source = page_html(args)
    pool = load_pool(args.pool)
    idx = NameIndex(pool["castaways"])
    info = parse_tribes(html_text)
    if not info["tribes"]:
        raise ToolError("no tribe table found on the page (has the layout changed?)")
    assigned, unknown = {}, []
    for tname, t in info["tribes"].items():
        for raw in t["members"]:
            name = idx.resolve(raw)
            if name is None:
                unknown.append((tname, raw))
            else:
                assigned[name] = tname
    missing = [n for n in idx.canonical if n not in assigned]
    for tname, t in info["tribes"].items():
        mem = sorted(n for n, tn in assigned.items() if tn == tname)
        log(f"{tname} ({t['color']}): {len(mem)} — {', '.join(mem)}")
    log(f"rules: {info['rules']}")
    for tname, raw in unknown:
        log(f"UNKNOWN name on {tname}: {raw!r}  (did you mean {', '.join(idx.suggest(raw)) or '?'})")
    if missing:
        log(f"Not on either tribe list: {', '.join(missing)}  (eliminated already? confirm before assuming)")
    if unknown:
        log("Add each unknown spelling to that castaway's \"aliases\" in data/pool.json and re-run.")
        return 2
    if args.apply:
        pool["tribes"] = {tn: BUFF_HEX.get(t["color"], "#8b95a1") for tn, t in info["tribes"].items()}
        for c in pool["castaways"]:
            if c["name"] in assigned:
                c["tribe"] = assigned[c["name"]]
        save_pool(pool, args.pool)
        log(f"wrote tribes + {len(assigned)} castaway assignments to {args.pool}")
    print(json.dumps({"source": source, **info, "assigned": assigned, "notOnList": missing}, indent=2))
    return 0


# ───────────────────────────── reddit ─────────────────────────────
# category: (key, label, points, [patterns], [negative patterns]). Recall over precision —
# the skill reads the hits and judges; the negatives only strip the most common idioms.
_I = re.I
CATEGORIES = [
    # 5 points
    ("kiss", "Kisses another player", 5, [r"\bkiss(?:ed|es|ing)?\b", r"\bsmooch"],
     [r"kiss(?:ed|es|ing)?\s+(?:his|her|their|my|your|our)\s+ass", r"kiss(?:ing)?\s+ass",
      r"kiss of death", r"kiss(?:ing)?\s+up\b", r"kiss(?:ing)?\s+the\s+ring"]),
    ("bleep", "Curse word bleeped/censored", 5, [r"\bbleep(?:ed|ing|s)?\b", r"\bbeep(?:ed|ing)?\b", r"\bcensored\b"], []),
    ("cry", "Visibly cries", 5, [r"\bcrying\b", r"\bcried\b", r"\btears\b", r"\bsobb(?:ed|ing)\b", r"\bweeping\b"],
     [r"\bi(?:'m|’m| am)\s+(?:so\s+)?crying", r"crying\s+(?:laughing|rn|lol)", r"\bcrying\s+for\b"]),
    ("imiss", "Says \"I miss…\"", 5, [r"\bi miss\b"], []),
    ("hugjeff", "Hugs Jeff", 5, [r"hugs?\s+jeff", r"hugg(?:ed|ing)\s+jeff", r"jeff\s+hug"], []),
    ("argument", "Heated argument / shouts at a player", 5,
     [r"(?:screaming|yelling|shouting)\s+at", r"heated\s+(?:argument|exchange)", r"got into it"], []),
    ("blurred", "Blurred nudity / wardrobe malfunction", 5,
     [r"\bblurr?(?:ed)?\b", r"pixelat", r"wardrobe malfunction", r"\bnude\b", r"\bnaked\b"], []),
    ("advantage", "Finds/gets an advantage or uses one at Tribal", 5,
     [r"found (?:an? )?(?:\w+ )?advantage", r"beware advantage", r"secret advantage", r"got (?:an? )?advantage", r"\bclue\b"], []),
    ("selfidol", "Plays an idol on themselves", 5, [r"plays? (?:the |an? |their )?idol", r"played (?:the |an? |their )?idol"], []),
    ("riskvote", "Risks their vote", 5, [r"risk(?:s|ed|ing)?\s+(?:their|his|her)\s+vote", r"\bsafety without power\b"], []),
    ("firetokens", "Buys something with fire tokens", 5, [r"fire\s+tokens?", r"\bbought\b", r"\bbuys\b"], []),
    ("reward", "Group reward: wins or is chosen", 5, [r"(?:won|wins|win|chosen for|going on|picked for) (?:the )?reward"], []),
    ("groupimmunity", "Wins a group immunity challenge", 5, [r"(?:won|wins) (?:the )?immunity"], []),
    # 10 points
    ("journey", "Journey / Exile Island", 10, [r"\bjourney\b", r"\bexile\b"], []),
    ("coin", "Million-dollar coin (chosen 10 / success 15)", 10,
     [r"million[- ]dollar coin", r"coin\s*flip", r"flipp?(?:ed|ing)?\s+(?:the\s+)?coin"], []),
    ("idolfound", "Finds a hidden immunity idol", 10,
     [r"found (?:the |an? )?(?:hidden )?(?:immunity )?idol", r"finds (?:the |an? )?idol", r"\bidol found\b"], []),
    ("indreward", "Wins an individual reward", 10, [r"individual reward"], []),
    ("votedwithidol", "Voted out holding an idol/advantage", 10,
     [r"idol in (?:his|her|their) pocket", r"voted out (?:with|holding)", r"with (?:an? |the )?idol in"], []),
    ("sitd", "Plays Shot in the Dark", 10, [r"shot in the dark"], []),
    ("blindside", "Blindside (torch snuffed)", 10, [r"blindsid"], []),
    ("medical", "Medical emergency", 10, [r"\bmedical\b", r"medevac", r"\bmedic\b"], []),
    ("forfeit", "Chooses to forfeit/quit", 10, [r"\bforfeit", r"\bquit(?:s|ting)?\b(?!\s+whin)"], []),
    ("seafood", "Catches seafood or wildlife", 10,
     [r"caught (?:a |some )?(?:fish|crab|lobster|octopus|shark)", r"catch(?:es)? (?:a )?fish", r"\bspear(?:ed|ing)?\b"], []),
    ("foodsteal", "Steals/tampers with tribe food", 10, [r"steal(?:s|ing)?\s+(?:the\s+)?(?:food|rice)", r"stole\s+(?:the\s+)?(?:food|rice)", r"tamper"], []),
    ("bag", "Searches someone's bag", 10, [r"through (?:his|her|their|someone(?:'s|’s)) bag", r"searched (?:his|her|their) bag"], []),
    ("unanimous", "Voted out unanimously", 10, [r"unanimous"], []),
    ("idolplayedon", "Idol played on them by someone else", 10, [r"idol (?:was )?played (?:on|for) (?:him|her)"], []),
    ("fakeidol", "Fake idol (find 5 / play 10 / create 15)", 10, [r"fake idol"], []),
    # 15 points
    ("indimmunity", "Wins individual immunity", 15, [r"individual immunity", r"won (?:the )?(?:individual )?immunity"], []),
    ("safe", "Draws SAFE from Shot in the Dark", 15, [r"\bsafe scroll\b", r"\bdrew safe\b"], []),
    ("fire", "Wins a fire-making challenge", 15, [r"fire[- ]?making", r"make fire"], []),
    ("gaveidol", "Gives an idol away / plays it for another", 15, [r"gave (?:the |his |her )?idol", r"plays? (?:it|the idol) for"], []),
    ("forcedout", "Forced out of the game", 15, [r"medevac", r"pulled from the game", r"evacuat"], []),
    ("returns", "Returns to the game", 15, [r"returns? to the game", r"comes? back (?:in|into) the game", r"redemption"], []),
    # information only
    ("boot", "Voted out / eliminated (info, no points)", 0,
     [r"voted out", r"first boot", r"sent home", r"torch (?:was )?snuffed", r"\beliminated\b"], []),
]
CATEGORY_RE = [(k, lab, pts, [re.compile(p, _I) for p in pos], [re.compile(n, _I) for n in neg])
               for k, lab, pts, pos, neg in CATEGORIES]
CASE_SENSITIVE_NAMES = {"Rob", "Jelly", "Ana", "Mike", "Ori", "Patt"}   # also ordinary words/short


def thread_id(s: str) -> str:
    m = re.search(r"/comments/([a-z0-9]+)", s)
    return m.group(1) if m else s.strip()


def arctic_get(params: dict, tries: int = 4) -> list[dict]:
    url = ARCTIC + "?" + urllib.parse.urlencode(params)
    last = ""
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA_TOOL})
            with urllib.request.urlopen(req, timeout=60) as r:
                d = json.load(r)
            if d.get("error"):
                last = str(d["error"])
            else:
                return d.get("data") or []
        except urllib.error.HTTPError as e:      # 422 is this API's "timeout / slow down"
            last = f"HTTP {e.code} {e.read().decode('utf-8', 'replace')[:100]}"
        except (urllib.error.URLError, TimeoutError) as e:
            last = str(e)
        time.sleep(6 * (i + 1))
    raise ToolError(f"archive request failed after {tries} tries: {last}")


def thread_path(tid: str) -> Path:
    return CACHE / "threads" / f"{tid}.json"


def slim(c: dict) -> dict:
    return {k: c.get(k) for k in ("id", "author", "body", "created_utc", "score", "parent_id", "permalink")}


def fetch_thread(tid: str, max_requests: int, sleep: float = 3.2, fresh: bool = False) -> dict:
    """Mirror a thread's comments locally; re-running resumes from where it stopped."""
    path = thread_path(tid)
    mirror = {"threadId": tid, "comments": {}, "cursor": None}
    if path.exists() and not fresh:
        mirror = json.loads(path.read_text(encoding="utf-8"))
    n = 0
    while n < max_requests:
        params = {"link_id": tid, "limit": 100, "sort": "asc"}
        if mirror["cursor"] is not None:
            params["after"] = mirror["cursor"] - 1        # exclusive cursor; dedupe by id
        rows = arctic_get(params)
        n += 1
        new = 0
        for c in rows:
            if c["id"] not in mirror["comments"]:
                new += 1
            mirror["comments"][c["id"]] = slim(c)
        if rows:
            mirror["cursor"] = max(c["created_utc"] for c in rows)
        mirror["fetchedAt"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(mirror), encoding="utf-8")
        log(f"  {tid}: +{new} (total {len(mirror['comments'])})")
        if len(rows) < 100 or (new == 0 and len(rows) == 100):
            break
        time.sleep(sleep)
    mirror["requests"] = n
    return mirror


def name_patterns(castaways: list[dict]) -> list[tuple[str, re.Pattern]]:
    """One regex per castaway. Two-letter aliases are skipped (\"An\" would match the word)."""
    pats = []
    for c in castaways:
        spellings = {c["name"], *c.get("aliases", [])}
        spellings = {s for s in spellings if len(s) >= 3}
        if not spellings:
            continue
        body = "|".join(sorted((re.escape(s) for s in spellings), key=len, reverse=True))
        flags = 0 if c["name"] in CASE_SENSITIVE_NAMES else re.I
        pats.append((c["name"], re.compile(rf"\b(?:{body})\b", flags)))
    return pats


def snippet(body: str, m: re.Match, width: int = 150) -> str:
    b = " ".join(body.split())
    i = b.lower().find(m.group(0).lower())
    lo = max(0, i - width // 2)
    return ("…" if lo else "") + b[lo:lo + width] + ("…" if lo + width < len(b) else "")


def scan_comments(comments: list[dict], castaways: list[dict], thread: str) -> dict:
    names = name_patterns(castaways)
    cats = {k: {"label": lab, "points": pts, "attributed": [], "unattributed": 0}
            for k, lab, pts, _, _ in CATEGORY_RE}
    for c in comments:
        body = c.get("body") or ""
        if not body or body in ("[deleted]", "[removed]"):
            continue
        who = [n for n, p in names if p.search(body)]
        for key, _, _, pos, neg in CATEGORY_RE:
            m = next((x for p in pos if (x := p.search(body))), None)
            if not m or any(n.search(body) for n in neg):
                continue
            if who:
                cats[key]["attributed"].append({
                    "castaways": who, "id": c["id"], "thread": thread, "author": c.get("author"),
                    "score": c.get("score"), "text": snippet(body, m),
                    "link": f"https://www.reddit.com/r/survivor/comments/{thread}/_/{c['id']}/"})
            else:
                cats[key]["unattributed"] += 1
    return cats


def cmd_reddit(args) -> int:
    pool = load_pool(args.pool)
    threads = [thread_id(t) for t in args.thread]
    if not threads:
        raise ToolError("give at least one --thread (id or URL)")
    mirrors = {}
    for t in threads:
        if args.action == "fetch" or not thread_path(t).exists() or args.refresh:
            log(f"mirroring {t} (polite: one request every ~3s)…")
            mirrors[t] = fetch_thread(t, args.max_requests, fresh=args.fresh)
        else:
            mirrors[t] = json.loads(thread_path(t).read_text(encoding="utf-8"))
    if args.action == "fetch":
        for t, m in mirrors.items():
            log(f"{t}: {len(m['comments'])} comments mirrored to {thread_path(t)}")
        return 0

    merged = {}
    for t, m in mirrors.items():
        cats = scan_comments(list(m["comments"].values()), pool["castaways"], t)
        for k, v in cats.items():
            tgt = merged.setdefault(k, {"label": v["label"], "points": v["points"], "attributed": [], "unattributed": 0})
            tgt["attributed"] += v["attributed"]
            tgt["unattributed"] += v["unattributed"]
    for v in merged.values():                       # single-castaway hits first, then by score
        v["attributed"].sort(key=lambda r: (len(r["castaways"]) != 1, -(r["score"] or 0)))
    matrix: dict[str, dict[str, int]] = {}
    for k, v in merged.items():
        for r in v["attributed"]:
            for n in r["castaways"]:
                matrix.setdefault(n, {})
                matrix[n][k] = matrix[n].get(k, 0) + 1
    out = {"threads": {t: len(m["comments"]) for t, m in mirrors.items()},
           "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
           "castawayMatrix": matrix, "categories": merged}
    if args.out:
        Path(args.out).write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        log(f"wrote {args.out}")

    lines = [f"Threads: {out['threads']}", "", "Per-castaway mentions (comments, by category):"]
    for n in sorted(matrix, key=lambda x: -sum(matrix[x].values())):
        lines.append(f"  {n:<10} " + ", ".join(f"{k}×{v}" for k, v in
                                                 sorted(matrix[n].items(), key=lambda kv: -kv[1])))
    lines.append("")
    for k, v in merged.items():
        if not v["attributed"]:
            continue
        lines.append(f"## {v['label']} ({v['points']} pts)  attributed={len(v['attributed'])}  "
                     f"unattributed={v['unattributed']}")
        for r in v["attributed"][: args.per_cat]:
            lines.append(f"  [{','.join(r['castaways'])}] (▲{r['score']}) {r['text']}\n      {r['link']}")
    print("\n".join(lines))
    return 0


# ───────────────────────────── apply / check ─────────────────────────────

def node_summary(pool_path: Path) -> list[dict] | None:
    js = r"""
global.window = {};
require(process.argv[1]);
const S = global.window.Standings;
const season = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const last = S.lastScoredEpisode(season);
const totals = S.totalsByName(season);
const ranks = S.rankByTotal(season.players.map(p => ({ key: p.id, total: totals[p.name] || 0 })));
const move = S.movement(season, last);
console.log(JSON.stringify(season.players.map(p => ({
  name: p.name, total: totals[p.name] || 0, week: S.lastEpisodePoints(season, p),
  rank: ranks[p.id].rankLabel, move: move[p.id] || 0 }))
  .sort((a, b) => b.total - a.total)));
"""
    try:
        r = subprocess.run(["node", "-e", js, str(STANDINGS_JS), str(pool_path)],
                           capture_output=True, text=True, timeout=30)
        return json.loads(r.stdout) if r.returncode == 0 else None
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return None


def build_episode(ep: int, base: dict[str, int], adjustments: list[dict], source: dict | None,
                  order: list[str]) -> dict:
    final = dict(base)
    for a in adjustments:
        final[a["castaway"]] = final.get(a["castaway"], 0) + a["pts"]
    rank = {n: i for i, n in enumerate(order)}
    key = lambda n: rank.get(n, 999)                                   # noqa: E731
    entry = {"episode": ep}
    if source:
        entry["source"] = source
    entry["base"] = {n: base[n] for n in sorted(base, key=key)}
    if adjustments:
        entry["adjustments"] = adjustments
    entry["castawayPoints"] = {n: final[n] for n in sorted(final, key=key)}
    return entry


def cmd_apply(args) -> int:
    pool = load_pool(args.pool)
    names = [c["name"] for c in pool["castaways"]]
    idx = NameIndex(pool["castaways"])
    ep = args.episode

    source = None
    if args.from_globaltv:
        gt = json.loads(Path(args.from_globaltv).read_text(encoding="utf-8"))
        rec = gt["episodes"].get(str(ep))
        if not rec:
            raise ToolError(f"episode {ep} is not in {args.from_globaltv}", 2)
        base = rec["points"]
        source = {"globaltv": rec["image"].rsplit("/", 1)[-1]}
    elif args.base:
        raw = json.loads(Path(args.base).read_text(encoding="utf-8"))
        base = {}
        for n, p in raw.items():
            c = idx.resolve(n)
            if c is None:
                raise ToolError(f"unknown castaway {n!r} (did you mean {idx.suggest(n)})", 2)
            base[c] = int(p)
        source = {"manual": True}
    else:
        raise ToolError("give --from-globaltv FILE or --base FILE")

    adjustments = []
    if args.adjustments:
        for a in json.loads(Path(args.adjustments).read_text(encoding="utf-8")):
            c = idx.resolve(a["castaway"])
            if c is None:
                raise ToolError(f"adjustment for unknown castaway {a['castaway']!r}", 2)
            if not isinstance(a.get("pts"), int):
                raise ToolError(f"adjustment for {c} needs an integer pts", 2)
            if not a.get("reason"):
                raise ToolError(f"adjustment for {c} needs a reason", 2)
            adjustments.append({"castaway": c, "pts": a["pts"], "reason": a["reason"],
                                **({"source": a["source"]} if a.get("source") else {})})

    problems = []
    for n in base:
        if n not in names:
            problems.append(f"{n!r} is not a castaway in pool.json")
    for c in pool["castaways"]:
        if c["name"] in base and c.get("eliminatedEp") is not None and c["eliminatedEp"] < ep:
            problems.append(f"{c['name']} was eliminated in episode {c['eliminatedEp']} but has points in {ep}")
    for a in adjustments:
        if a["pts"] % 5:
            problems.append(f"adjustment for {a['castaway']} is {a['pts']}: event bonuses come in multiples of 5")
    if problems and not args.force:
        for p in problems:
            log(f"ERROR: {p}")
        log("(--force to override)")
        return 2

    existing = next((e for e in pool["episodes"] if e["episode"] == ep), None)
    if existing and not args.replace:
        log(f"Episode {ep} is already in pool.json. Use --replace to overwrite (GlobalTV re-uploads "
            f"corrected images, so this is normal).")
        return 2
    entry = build_episode(ep, base, adjustments, source, names)
    if existing:
        old = existing.get("castawayPoints", {})
        changed = {n: (old.get(n), entry["castawayPoints"].get(n))
                   for n in sorted(set(old) | set(entry["castawayPoints"]))
                   if old.get(n) != entry["castawayPoints"].get(n)}
        log(f"replacing episode {ep}; {len(changed)} castaway numbers change: {changed}")
        pool["episodes"] = [entry if e["episode"] == ep else e for e in pool["episodes"]]
    else:
        pool["episodes"] = sorted(pool["episodes"] + [entry], key=lambda e: e["episode"])

    out_names = []
    for n in args.eliminated or []:
        c = idx.resolve(n)
        if c is None:
            raise ToolError(f"--eliminated: unknown castaway {n!r} (did you mean {idx.suggest(n)})", 2)
        rec = next(x for x in pool["castaways"] if x["name"] == c)
        if rec.get("eliminatedEp") not in (None, ep):
            raise ToolError(f"{c} is already recorded as eliminated in episode {rec['eliminatedEp']}", 2)
        rec["eliminatedEp"] = ep
        out_names.append(c)
    pool["lastUpdated"] = args.last_updated or (
        f"Episode {ep}" + (f" · {', '.join(out_names)} out" if out_names else ""))

    target = Path(args.pool)
    if args.dry_run:
        tmp = target.with_suffix(".dryrun.json")
        save_pool(pool, tmp)
        log(f"[dry run] would write episode {ep}; preview at {tmp}")
        summary_path = tmp
    else:
        save_pool(pool, target)
        summary_path = target
        log(f"wrote episode {ep} to {target}")

    rows = node_summary(summary_path)
    if rows:
        log(f"\nStandings after episode {ep}:")
        for r in rows:
            mv = "  " if not r["move"] else (f"▲{r['move']}" if r["move"] > 0 else f"▼{abs(r['move'])}")
            log(f"  {r['rank']:>3} {mv:<3} {r['name']:<13} {r['total']:>5}   (+{r['week']})")
    else:
        log("(node not available — skipped the standings preview)")
    if args.dry_run:
        summary_path.unlink(missing_ok=True)
    return 0


def cmd_check(args) -> int:
    path = Path(args.pool)
    raw = path.read_text(encoding="utf-8")
    pool = json.loads(raw)
    errs, warns = [], []
    try:
        idx = NameIndex(pool["castaways"])
    except ToolError as e:
        errs.append(str(e))
        idx = None
    names = [c["name"] for c in pool["castaways"]]
    if len(set(names)) != len(names):
        errs.append("duplicate castaway names")
    ids = [p["id"] for p in pool["players"]]
    if len(set(ids)) != len(ids):
        errs.append("duplicate player ids")
    for p in pool["players"]:
        picks = [x if isinstance(x, str) else x["name"] for x in p.get("picks", []) + p.get("addedPicks", [])]
        for n in picks:
            if n not in names:
                errs.append(f"{p['name']}: pick {n!r} is not a castaway")
        if len(set(picks)) != len(picks):
            errs.append(f"{p['name']}: duplicate picks")
        if p.get("mvp") and p["mvp"] not in picks:
            errs.append(f"{p['name']}: MVP {p['mvp']!r} is not among their picks")
    merge_ep = pool.get("mergeEp")
    eps = pool.get("episodes", [])
    if len({e["episode"] for e in eps}) != len(eps):
        errs.append("duplicate episode numbers")
    for e in eps:
        n = e["episode"]
        pts = e.get("castawayPoints") or {}
        for c in pts:
            if c not in names:
                errs.append(f"episode {n}: {c!r} is not a castaway")
        for c in pool["castaways"]:
            if c["name"] in pts and c.get("eliminatedEp") is not None and c["eliminatedEp"] < n:
                warns.append(f"episode {n}: {c['name']} has points after being eliminated in {c['eliminatedEp']}")
        if "base" in e:
            recomputed = dict(e["base"])
            for a in e.get("adjustments", []):
                recomputed[a["castaway"]] = recomputed.get(a["castaway"], 0) + a["pts"]
            if recomputed != pts:
                errs.append(f"episode {n}: castawayPoints != base + adjustments")
            for name, d in analyze_totals(e["base"], n, merge_ep).items():
                if d["status"] == "anomaly":
                    warns.append(f"episode {n}: {name} base {d['total']} doesn't fit survival + multiples of 5")
    if raw != format_pool(pool):
        warns.append("file is not in canonical formatting (run: pool_tools.py format)")
    for w in warns:
        log(f"warning: {w}")
    for e in errs:
        log(f"ERROR: {e}")
    log(f"{len(pool['castaways'])} castaways · {len(pool['players'])} players · {len(eps)} episodes · "
        f"{len(errs)} errors · {len(warns)} warnings")
    return 2 if errs else 0


def cmd_format(args) -> int:
    save_pool(load_pool(args.pool), args.pool)
    log(f"rewrote {args.pool} in canonical formatting")
    return 0


# ───────────────────────────── cli ─────────────────────────────

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pool", default=str(POOL), help="pool JSON to read/write (default data/pool.json)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("globaltv", help="per-castaway points from GlobalTV")
    g.add_argument("--episode", type=int)
    g.add_argument("--url", default=GLOBALTV_URL)
    g.add_argument("--html", help="parse a saved page instead of fetching")
    g.add_argument("--out", help="write JSON here instead of stdout")
    g.add_argument("--save-images", metavar="DIR", help="also download each episode's results image")
    g.add_argument("--allow-unknown", action="store_true", help="skip unrecognised castaway names")
    g.set_defaults(fn=cmd_globaltv)

    t = sub.add_parser("tribes", help="tribe rosters + pick rules from the same page")
    t.add_argument("--url", default=GLOBALTV_URL)
    t.add_argument("--html")
    t.add_argument("--apply", action="store_true", help="write tribes + castaway.tribe into the pool")
    t.set_defaults(fn=cmd_tribes)

    r = sub.add_parser("reddit", help="mirror + scan archived episode threads")
    r.add_argument("action", choices=["fetch", "scan"])
    r.add_argument("--thread", action="append", default=[], help="thread id or URL (repeatable)")
    r.add_argument("--max-requests", type=int, default=150)
    r.add_argument("--refresh", action="store_true", help="scan: top up the mirror first")
    r.add_argument("--fresh", action="store_true", help="ignore the local mirror and start over")
    r.add_argument("--per-cat", type=int, default=12)
    r.add_argument("--out", help="also write full JSON here")
    r.set_defaults(fn=cmd_reddit)

    a = sub.add_parser("apply", help="write an episode into the pool")
    a.add_argument("--episode", type=int, required=True)
    a.add_argument("--from-globaltv", metavar="FILE", help="JSON from the globaltv command")
    a.add_argument("--base", metavar="FILE", help="or a plain {castaway: points} JSON")
    a.add_argument("--adjustments", metavar="FILE", help="[{castaway, pts, reason, source?}]")
    a.add_argument("--eliminated", nargs="*", help="castaways who left this episode")
    a.add_argument("--last-updated")
    a.add_argument("--replace", action="store_true")
    a.add_argument("--force", action="store_true")
    a.add_argument("--dry-run", action="store_true")
    a.set_defaults(fn=cmd_apply)

    sub.add_parser("check", help="validate the pool").set_defaults(fn=cmd_check)
    sub.add_parser("format", help="canonical formatting").set_defaults(fn=cmd_format)

    args = ap.parse_args(argv)
    try:
        return args.fn(args)
    except ToolError as e:
        log(f"error: {e}")
        return e.code


if __name__ == "__main__":
    sys.exit(main())
