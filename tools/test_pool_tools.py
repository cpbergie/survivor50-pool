#!/usr/bin/env python3
"""Offline tests for pool_tools.py:  python3 tools/test_pool_tools.py"""
import contextlib
import copy
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pool_tools as t  # noqa: E402

REAL_POOL = t.ROOT / "data" / "pool.json"


def run(*argv):
    """Invoke the CLI; returns (exit code, stderr text)."""
    err = io.StringIO()
    with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
        code = t.main(list(argv))
    return code, err.getvalue()


CAST = [{"name": "Aaliyah", "tribe": None, "eliminatedEp": None},
        {"name": "Kilby", "aliases": ["Danny", "Danny Kilby"], "tribe": None, "eliminatedEp": None},
        {"name": "Thien An", "aliases": ["An", "An Thien An"], "tribe": None, "eliminatedEp": None},
        {"name": "Rob", "tribe": None, "eliminatedEp": None},
        {"name": "Ana", "tribe": None, "eliminatedEp": None}]


def mini_pool():
    return {"season": 51, "premiere": "2026-09-23", "lastUpdated": "Pre-season", "mergeEp": None,
            "tribes": {}, "placements": {}, "castaways": copy.deepcopy(CAST),
            "players": [{"id": "clay", "name": "Clay", "mvp": "Rob", "picks": ["Rob", "Kilby"], "addedPicks": []},
                        {"id": "amy", "name": "Amy", "mvp": None, "picks": ["Ana", "Thien An"], "addedPicks": []}],
            "episodes": []}


class Names(unittest.TestCase):
    def test_normalisation_and_aliases(self):
        idx = t.NameIndex(CAST)
        self.assertEqual(idx.resolve("Danny"), "Kilby")
        self.assertEqual(idx.resolve("  kilby "), "Kilby")
        self.assertEqual(idx.resolve("An “Thien An”"), "Thien An")      # curly quotes as GlobalTV prints it
        self.assertEqual(idx.resolve('An "Thien An"'), "Thien An")
        self.assertIsNone(idx.resolve("Stephenie"))
        self.assertEqual(idx.resolve("Ana"), "Ana")                       # 'An' alias must not swallow 'Ana'

    def test_suggestions(self):
        self.assertIn("Aaliyah", t.NameIndex(CAST).suggest("Aliyah"))

    def test_collision_is_an_error(self):
        bad = copy.deepcopy(CAST)
        bad[3]["aliases"] = ["Danny"]
        with self.assertRaises(t.ToolError):
            t.NameIndex(bad)


class SurvivalArithmetic(unittest.TestCase):
    def test_premerge(self):
        r = t.analyze_totals({"a": 6, "b": 1, "c": 5, "d": 0, "e": 8}, 3, None)
        self.assertEqual([r[k]["status"] for k in "abcde"], ["stayed", "stayed", "left", "left", "anomaly"])
        self.assertEqual(r["a"]["eventPoints"], 5)
        self.assertEqual(r["c"]["eventPoints"], 5)

    def test_postmerge_and_merge_week(self):
        self.assertEqual(t.analyze_totals({"a": 8}, 9, 6)["a"]["status"], "stayed")
        self.assertEqual(t.analyze_totals({"a": 8}, 9, 6)["a"]["eventPoints"], 5)
        self.assertEqual(t.analyze_totals({"a": 6}, 9, 6)["a"]["status"], "anomaly")   # 1-pt rate after merge
        for total in (6, 8):                                                             # merge week: either rate
            self.assertEqual(t.analyze_totals({"a": total}, 6, 6)["a"]["status"], "stayed")

    def test_unrecorded_merge_is_flagged(self):
        self.assertEqual(t.analyze_totals({"a": 8}, 7, None)["a"]["status"], "anomaly")


class RealSeason50Data(unittest.TestCase):
    """The 12 real GlobalTV images from Survivor 50: every number must fit the arithmetic and the
    numbers must reproduce who left each week."""

    @classmethod
    def setUpClass(cls):
        cls.fx = json.loads((HERE / "fixtures" / "s50_results.json").read_text(encoding="utf-8"))

    def test_no_anomalies_and_departures_match(self):
        prev_members = None
        for e in self.fx["episodes"]:
            raw, bad = t.parse_alt(e["alt"])
            self.assertEqual(bad, [], f"episode {e['heading']}")
            det = t.analyze_totals(raw, e["heading"], self.fx["mergeEp"])
            self.assertFalse([n for n, d in det.items() if d["status"] == "anomaly"], f"episode {e['heading']}")
            left = sorted(n for n, d in det.items() if d["status"] == "left")
            self.assertEqual(left, sorted(self.fx["left_by_raw_name"][str(e["heading"])]), f"episode {e['heading']}")
            if prev_members is not None:                # who vanished from the list == who the numbers say left
                self.assertEqual(sorted(prev_members - set(raw)), sorted(prev_left))
            prev_members, prev_left = set(raw), left


def page_html(items):
    """Mimic GlobalTV: <p><a><img …/></a><br/><strong>EPISODE n POINTS:</strong></p> — the image
    for a heading sits in the NEXT paragraph, before the following heading."""
    out = ["<article><p>Results<br/><strong>EPISODE %d POINTS:</strong></p>" % items[0][0]]
    for i, (ep, fname, alt) in enumerate(items):
        nxt = items[i + 1][0] if i + 1 < len(items) else None
        out.append(f'<p><a href="/{fname}"><img src="https://x.test/wp/{fname}" alt="{alt}" /></a><br/>'
                   + (f"<strong>EPISODE {nxt} POINTS:</strong>" if nxt else "") + "</p>")
    return "".join(out) + "</article>"


class ResultsParsing(unittest.TestCase):
    def test_pairs_by_position_and_warns_on_mislabelled_file(self):
        html = page_html([(9, "survivor-50-episode-9-points-1.jpg", "A total points: 8; B total points: 5"),
                          (8, "survivor-50-episode-9-points_v2.jpg", "A total points: 13; B total points: 3")])
        found, warns = t.parse_results(html)
        self.assertEqual(found[9]["raw"], {"A": 8, "B": 5})
        self.assertEqual(found[8]["raw"], {"A": 13, "B": 3})                 # not clobbered by the mislabel
        self.assertTrue(any("episode 8" in w and "episode 9" in w for w in warns))
        self.assertEqual(found[8]["version"], "v2")

    def test_no_images_yet(self):
        found, _ = t.parse_results("<article><p><strong>EPISODE 2 POINTS:</strong></p></article>")
        self.assertEqual(found, {})

    def test_fixture_page_round_trip(self):
        fx = json.loads((HERE / "fixtures" / "s50_results.json").read_text(encoding="utf-8"))
        items = [(e["heading"], e["file"], e["alt"].replace('"', "&quot;")) for e in reversed(fx["episodes"])]
        found, _ = t.parse_results(page_html(items))
        self.assertEqual(sorted(found), list(range(2, 14)))
        self.assertEqual(found[12]["raw"]["Joe"], 28)

    def test_alt_with_junk_is_reported(self):
        raw, bad = t.parse_alt("A total points: 5; garbage here; B total points: x")
        self.assertEqual(raw, {"A": 5})
        self.assertEqual(len(bad), 2)


class Tribes(unittest.TestCase):
    def test_table_and_rules(self):
        html = ("<p>Pick FOUR castaways from each tribe</p><table><tr><td>Toka (Yellow Tribe)</td><td>Savu (Purple Tribe)</td></tr>"
                "<tr><td>An “Thien An”</td><td>Rob</td></tr><tr><td>Danny</td><td>Ana</td></tr></table>"
                "<p>You should have EIGHT picks in total</p>")
        info = t.parse_tribes(html)
        self.assertEqual(info["tribes"]["Toka"]["members"], ["An “Thien An”", "Danny"])
        self.assertEqual(info["tribes"]["Savu"]["color"], "purple")
        self.assertEqual(info["rules"], {"picksPerTribe": 4, "totalPicks": 8})


class Formatting(unittest.TestCase):
    def test_real_pool_round_trips_byte_for_byte(self):
        raw = REAL_POOL.read_text(encoding="utf-8")
        self.assertEqual(t.format_pool(json.loads(raw)), raw)

    def test_episodes_round_trip_and_idempotent(self):
        p = mini_pool()
        p["episodes"] = [t.build_episode(2, {"Rob": 8, "Kilby": 6}, [{"castaway": "Rob", "pts": 10, "reason": "idol",
                         "source": ["https://r/1"]}], {"globaltv": "e2.jpg"}, [c["name"] for c in CAST])]
        text = t.format_pool(p)
        self.assertEqual(json.loads(text), p)
        self.assertEqual(t.format_pool(json.loads(text)), text)


class Apply(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.pool = Path(self.tmp.name) / "pool.json"
        t.save_pool(mini_pool(), self.pool)
        self.base = Path(self.tmp.name) / "base.json"
        self.base.write_text(json.dumps({"Rob": 8, "Danny": 6, "An": 1, "Ana": 3, "Aaliyah": 5}))

    def tearDown(self):
        self.tmp.cleanup()

    def load(self):
        return json.loads(self.pool.read_text())

    def test_apply_with_alias_adjustments_and_elimination(self):
        adj = Path(self.tmp.name) / "adj.json"
        adj.write_text(json.dumps([{"castaway": "Danny", "pts": 10, "reason": "found idol", "source": ["https://r/1"]}]))
        code, err = run("--pool", str(self.pool), "apply", "--episode", "2", "--base", str(self.base),
                        "--adjustments", str(adj), "--eliminated", "Aaliyah")
        self.assertEqual(code, 0, err)
        p = self.load()
        e = p["episodes"][0]
        self.assertEqual(e["castawayPoints"]["Kilby"], 16)                # alias resolved, adjustment added
        self.assertEqual(e["base"]["Kilby"], 6)
        self.assertEqual(next(c for c in p["castaways"] if c["name"] == "Aaliyah")["eliminatedEp"], 2)
        self.assertEqual(p["lastUpdated"], "Episode 2 · Aaliyah out")
        self.assertEqual(run("--pool", str(self.pool), "check")[0], 0)
        self.assertEqual(self.pool.read_text(), t.format_pool(p))          # canonical

    def test_dry_run_writes_nothing(self):
        before = self.pool.read_text()
        code, _ = run("--pool", str(self.pool), "apply", "--episode", "2", "--base", str(self.base), "--dry-run")
        self.assertEqual(code, 0)
        self.assertEqual(self.pool.read_text(), before)
        self.assertFalse(self.pool.with_suffix(".dryrun.json").exists())

    def test_existing_episode_needs_replace(self):
        args = ["--pool", str(self.pool), "apply", "--episode", "2", "--base", str(self.base)]
        self.assertEqual(run(*args)[0], 0)
        self.assertEqual(run(*args)[0], 2)
        self.assertEqual(run(*args, "--replace")[0], 0)
        self.assertEqual(len(self.load()["episodes"]), 1)

    def test_unknown_castaway_fails_loudly(self):
        self.base.write_text(json.dumps({"Rob": 8, "Stephenie": 4}))
        code, err = run("--pool", str(self.pool), "apply", "--episode", "2", "--base", str(self.base))
        self.assertEqual(code, 2)
        self.assertIn("Stephenie", err)
        self.assertEqual(self.load()["episodes"], [])

    def test_points_after_elimination_rejected(self):
        p = self.load()
        next(c for c in p["castaways"] if c["name"] == "Aaliyah")["eliminatedEp"] = 1
        t.save_pool(p, self.pool)
        code, err = run("--pool", str(self.pool), "apply", "--episode", "2", "--base", str(self.base))
        self.assertEqual(code, 2)
        self.assertIn("Aaliyah", err)

    def test_adjustment_needs_reason_and_multiple_of_five(self):
        adj = Path(self.tmp.name) / "adj.json"
        adj.write_text(json.dumps([{"castaway": "Rob", "pts": 10}]))
        self.assertEqual(run("--pool", str(self.pool), "apply", "--episode", "2", "--base", str(self.base),
                             "--adjustments", str(adj))[0], 2)
        adj.write_text(json.dumps([{"castaway": "Rob", "pts": 7, "reason": "x"}]))
        self.assertEqual(run("--pool", str(self.pool), "apply", "--episode", "2", "--base", str(self.base),
                             "--adjustments", str(adj))[0], 2)

    def test_check_catches_tampering(self):
        run("--pool", str(self.pool), "apply", "--episode", "2", "--base", str(self.base))
        p = self.load()
        p["episodes"][0]["castawayPoints"]["Rob"] += 1
        t.save_pool(p, self.pool)
        code, err = run("--pool", str(self.pool), "check")
        self.assertEqual(code, 2)
        self.assertIn("base + adjustments", err)

    def test_check_flags_mvp_outside_picks(self):
        p = self.load()
        p["players"][0]["mvp"] = "Ana"
        t.save_pool(p, self.pool)
        self.assertEqual(run("--pool", str(self.pool), "check")[0], 2)


class RedditScan(unittest.TestCase):
    def comment(self, cid, body):
        return {"id": cid, "author": "u", "body": body, "score": 3, "created_utc": 1}

    def test_attribution_idioms_and_case(self):
        cs = [self.comment("a", "Rob found an idol so fast"),
              self.comment("b", "kissing his ass is all they do"),        # idiom, must be dropped
              self.comment("c", "they kissed on the beach"),              # real, but nobody named
              self.comment("d", "Kilby and Ana kissed!"),
              self.comment("e", "i can't rob a bank"),                    # lowercase 'rob' is not Rob
              self.comment("f", "Danny caught a fish with a spear")]      # alias
        cats = t.scan_comments(cs, CAST, "thread1")
        idol = cats["idolfound"]["attributed"]
        self.assertEqual([r["id"] for r in idol], ["a"])
        self.assertEqual(idol[0]["castaways"], ["Rob"])
        self.assertEqual([r["id"] for r in cats["kiss"]["attributed"]], ["d"])
        self.assertEqual(sorted(cats["kiss"]["attributed"][0]["castaways"]), ["Ana", "Kilby"])
        self.assertEqual(cats["kiss"]["unattributed"], 1)
        self.assertNotIn("e", [r["id"] for c in cats.values() for r in c["attributed"]])
        self.assertEqual(cats["seafood"]["attributed"][0]["castaways"], ["Kilby"])

    def test_two_letter_alias_does_not_match_the_word_an(self):
        cats = t.scan_comments([self.comment("x", "An idol was found")], CAST, "t")
        self.assertEqual(sum(len(c["attributed"]) for c in cats.values()), 0)

    def test_thread_id_from_url(self):
        self.assertEqual(t.thread_id("https://www.reddit.com/r/survivor/comments/1wop0s4/survivor_51_e1/"), "1wop0s4")
        self.assertEqual(t.thread_id("1wop0s4"), "1wop0s4")


class ThreadMirror(unittest.TestCase):
    def test_paging_resume_and_dedupe(self):
        pages = {}

        def fake(params, tries=4):
            after = params.get("after")
            calls.append(after)
            allc = [{"id": f"c{i}", "created_utc": 1000 + i, "body": "x", "author": "u", "score": 1,
                     "parent_id": "t3_x", "permalink": ""} for i in range(250)]
            rows = [c for c in allc if after is None or c["created_utc"] > after][:100]
            return rows

        orig, orig_path, orig_cache = t.arctic_get, t.thread_path, t.CACHE
        with tempfile.TemporaryDirectory() as d:
            t.arctic_get, t.CACHE = fake, Path(d)
            t.thread_path = lambda tid: Path(d) / f"{tid}.json"
            calls = []
            try:
                with contextlib.redirect_stderr(io.StringIO()):
                    m = t.fetch_thread("abc", 20, sleep=0)
                self.assertEqual(len(m["comments"]), 250)               # nothing lost at page boundaries
                self.assertEqual(calls[0], None)
                calls.clear()
                with contextlib.redirect_stderr(io.StringIO()):
                    m2 = t.fetch_thread("abc", 20, sleep=0)             # resume: only tops up
                self.assertEqual(len(m2["comments"]), 250)
                self.assertLessEqual(len(calls), 2)
            finally:
                t.arctic_get, t.thread_path, t.CACHE = orig, orig_path, orig_cache


if __name__ == "__main__":
    unittest.main(verbosity=1)
