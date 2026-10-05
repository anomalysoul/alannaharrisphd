"""Fetch postings from public ATS job-board APIs (no scraping, no login)."""
import html
import json
import re
import urllib.request

UA = {"User-Agent": "job-applier/0.1 (personal job search)"}


def _get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return json.load(r)


def _text(s):
    s = re.sub(r"<[^>]+>", " ", html.unescape(s or ""))
    return re.sub(r"\s+", " ", s).strip()


def greenhouse(token):
    data = _get_json(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true")
    return [
        dict(id=f"greenhouse:{token}:{j['id']}", source="greenhouse", company=token,
             title=j["title"], location=(j.get("location") or {}).get("name", ""),
             url=j["absolute_url"], description=_text(j.get("content")))
        for j in data.get("jobs", [])
    ]


def lever(slug):
    data = _get_json(f"https://api.lever.co/v0/postings/{slug}?mode=json")
    return [
        dict(id=f"lever:{slug}:{j['id']}", source="lever", company=slug, title=j["text"],
             location=(j.get("categories") or {}).get("location", ""),
             url=j["hostedUrl"], description=j.get("descriptionPlain", ""))
        for j in data
    ]


def ashby(slug):
    data = _get_json(f"https://api.ashbyhq.com/posting-api/job-board/{slug}")
    return [
        dict(id=f"ashby:{slug}:{j['id']}", source="ashby", company=slug, title=j["title"],
             location=j.get("location", ""), url=j["jobUrl"],
             description=j.get("descriptionPlain", ""))
        for j in data.get("jobs", [])
    ]


FETCHERS = {"greenhouse": greenhouse, "lever": lever, "ashby": ashby}


def fetch_all(sources: dict):
    """Yield (source, board, jobs_or_exception) for each configured board."""
    for source, boards in sources.items():
        for board in boards:
            try:
                yield source, board, FETCHERS[source](board)
            except Exception as e:  # one bad board shouldn't stop the run
                yield source, board, e


def prefilter(job: dict, prefs: dict) -> bool:
    """Cheap keyword filter before spending API calls on scoring."""
    title = job["title"].lower()
    if job["company"].lower() in [c.lower() for c in prefs.get("exclude_companies", [])]:
        return False
    if any(k.lower() in title for k in prefs.get("exclude_title_keywords", [])):
        return False
    wanted = prefs.get("title_keywords", [])
    if wanted and not any(k.lower() in title for k in wanted):
        return False
    locs = [l.lower() for l in prefs.get("locations", [])]
    if locs and job["location"] and not any(l in job["location"].lower() for l in locs):
        return False
    return True
