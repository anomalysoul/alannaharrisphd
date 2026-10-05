"""job-applier CLI.  Typical flow:  fetch -> score -> draft -> apply (or `run` for the first three)."""
import argparse
import json
import os
import sys

from . import llm, sources
from .db import DB


def load_profile(path):
    with open(path) as f:
        p = json.load(f)
    p["resume_text"] = open(p["resume_text_path"]).read() if p.get("resume_text_path") else p.get("summary", "")
    return p


def cmd_fetch(a, p, db):
    new = 0
    for source, board, res in sources.fetch_all(p["sources"]):
        if isinstance(res, Exception):
            print(f"! {source}/{board}: {res}", file=sys.stderr)
            continue
        kept = [j for j in res if sources.prefilter(j, p["preferences"])]
        added = sum(db.add_job(j) for j in kept)
        new += added
        print(f"{source}/{board}: {len(res)} postings, {len(kept)} pass filters, {added} new")
    print(f"{new} new jobs")


def cmd_score(a, p, db):
    min_score = p["preferences"].get("min_score", 70)
    for j in db.by_status("new"):
        try:
            score, why = llm.score_job(p, p["resume_text"], j)
        except Exception as e:
            print(f"! scoring {j['id']}: {e}", file=sys.stderr)
            continue
        db.update(j["id"], score=score, reasoning=why, status="scored" if score >= min_score else "skipped")
        print(f"{score:3d}  {j['company']} - {j['title']}")


def cmd_draft(a, p, db):
    for j in db.by_status("scored", a.limit):
        letter = llm.write_cover_letter(p, p["resume_text"], j)
        db.update(j["id"], cover_letter=letter, status="drafted")
        print(f"drafted: {j['company']} - {j['title']}")


def cmd_apply(a, p, db):
    from . import applicator
    os.makedirs("screenshots", exist_ok=True)
    mode = "auto" if a.auto else "dry" if a.dry_run else "review"
    for j in db.by_status("drafted", a.limit):
        print(f"\n>>> {j['company']} - {j['title']} (score {j['score']})\n    {j['url']}")
        status, note = applicator.apply(j, p, j["cover_letter"], mode=mode)
        if status == "drafted" and mode == "dry":
            status = "drafted"  # stays queued
        db.update(j["id"], status=status, notes=note)
        print(f"    -> {status}: {note}")


def cmd_run(a, p, db):
    cmd_fetch(a, p, db); cmd_score(a, p, db); cmd_draft(a, p, db)


def cmd_list(a, p, db):
    for j in db.all():
        print(f"{j['status']:<12} {j['score'] if j['score'] is not None else '-':>3}  "
              f"{j['company']} - {j['title']}  {j['url']}")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="jobapply")
    ap.add_argument("--profile", default="profile.json")
    ap.add_argument("--db", default="jobs.db")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name, fn in [("fetch", cmd_fetch), ("score", cmd_score), ("run", cmd_run), ("list", cmd_list)]:
        sub.add_parser(name).set_defaults(fn=fn)
    d = sub.add_parser("draft"); d.add_argument("--limit", type=int, default=20); d.set_defaults(fn=cmd_draft)
    s = sub.add_parser("apply")
    s.add_argument("--limit", type=int, default=5, help="max applications this run")
    g = s.add_mutually_exclusive_group()
    g.add_argument("--auto", action="store_true", help="submit without confirmation (headless)")
    g.add_argument("--dry-run", action="store_true", help="fill forms and screenshot, never submit")
    s.set_defaults(fn=cmd_apply)
    a = ap.parse_args(argv)
    a.fn(a, load_profile(a.profile), DB(a.db))


if __name__ == "__main__":
    main()
