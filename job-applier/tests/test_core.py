from jobapply import applicator, llm, sources
from jobapply.db import DB

PROFILE = {"first_name": "Jane", "last_name": "Doe", "email": "j@x.com", "phone": "555",
           "answers": {"sponsorship": "No"}}
JOB = dict(id="lever:a:1", source="lever", company="a", title="Program Manager", location="Remote",
           url="http://x", description="d")


def test_db_dedupes_and_updates():
    db = DB(":memory:")
    assert db.add_job(JOB) and not db.add_job(JOB)
    db.update(JOB["id"], status="scored", score=80)
    assert db.by_status("scored")[0]["score"] == 80


def test_prefilter():
    prefs = {"title_keywords": ["manager"], "exclude_title_keywords": ["intern"],
             "exclude_companies": ["bad"], "locations": ["remote"]}
    assert sources.prefilter(JOB, prefs)
    assert not sources.prefilter({**JOB, "title": "Manager Intern"}, prefs)
    assert not sources.prefilter({**JOB, "company": "bad"}, prefs)
    assert not sources.prefilter({**JOB, "location": "Paris"}, prefs)


def test_resolve_never_guesses():
    assert applicator.resolve("First Name *", PROFILE, "") == "Jane"
    assert applicator.resolve("Full name", PROFILE, "") == "Jane Doe"
    assert applicator.resolve("Will you require visa sponsorship?", PROFILE, "") == "No"
    assert applicator.resolve("Cover letter", PROFILE, "Hello") == "Hello"
    assert applicator.resolve("Favorite color", PROFILE, "") is None


class FakeClient:
    class messages:
        @staticmethod
        def create(**kw):
            class B: type = "text"; text = 'Sure: {"score": 88, "reasoning": "good", "deal_breakers": []}'
            class M: content = [B]
            return M


def test_score_job_parses_json_and_caps_on_deal_breakers():
    assert llm.score_job({}, "resume", JOB, FakeClient) == (88, "good")
    assert llm.parse_json('x {"a": 1} y') == {"a": 1}
