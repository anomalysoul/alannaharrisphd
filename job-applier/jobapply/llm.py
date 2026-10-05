"""Claude-powered scoring and writing. Grounded strictly in the user's own profile."""
import json
import re

MODEL = "claude-sonnet-5-5"


def _client():
    import anthropic
    return anthropic.Anthropic()


def _ask(system, user, max_tokens=1500, client=None):
    client = client or _client()
    msg = client.messages.create(
        model=MODEL, max_tokens=max_tokens, system=system,
        messages=[{"role": "user", "content": user}],
    )
    return "".join(b.text for b in msg.content if b.type == "text")


def parse_json(text):
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError(f"no JSON in model output: {text[:200]!r}")
    return json.loads(m.group(0))


def score_job(profile, resume_text, job, client=None):
    system = (
        "You assess job fit for a candidate. Be honest and calibrated; do not inflate. "
        'Reply with JSON only: {"score": 0-100, "reasoning": "2 sentences", '
        '"deal_breakers": ["..."]}'
    )
    user = (
        f"CANDIDATE SUMMARY:\n{profile.get('summary','')}\n\nRESUME:\n{resume_text}\n\n"
        f"PREFERENCES: {json.dumps(profile.get('preferences', {}))}\n\n"
        f"JOB: {job['title']} at {job['company']} ({job['location']})\n{job['description'][:6000]}"
    )
    out = parse_json(_ask(system, user, 500, client))
    score = int(out["score"])
    if out.get("deal_breakers"):
        score = min(score, 40)
    return score, out.get("reasoning", "")


def write_cover_letter(profile, resume_text, job, client=None):
    system = (
        "Write a concise, specific cover letter (under 250 words, no clichés, no placeholders). "
        "Use ONLY facts present in the resume/summary. Never invent employers, degrees, "
        "numbers, or skills. Output the letter body only."
    )
    user = (
        f"CANDIDATE: {profile['first_name']} {profile['last_name']}\n"
        f"SUMMARY: {profile.get('summary','')}\n\nRESUME:\n{resume_text}\n\n"
        f"JOB: {job['title']} at {job['company']}\n{job['description'][:6000]}"
    )
    return _ask(system, user, 800, client).strip()
