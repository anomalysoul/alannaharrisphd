"""Fill out application forms in a real browser (Playwright).

Safety rules baked in:
  * never invents answers: unknown required fields -> the job is flagged needs_review
  * CAPTCHAs are never bypassed -> flagged needs_review
  * default mode is human-in-the-loop: the browser stays open and you confirm each submit
"""
import re

# (label regex, profile key). First match wins.
FIELD_MAP = [
    (r"first\s*name|given name", "first_name"),
    (r"last\s*name|surname|family name", "last_name"),
    (r"^\s*(full\s*)?name\b", "full_name"),
    (r"e-?mail", "email"),
    (r"phone|mobile", "phone"),
    (r"linkedin", "linkedin"),
    (r"github", "github"),
    (r"website|portfolio|personal site", "website"),
    (r"current (company|employer)|organization", "current_company"),
    (r"city|location|where are you", "location"),
    (r"cover letter|additional information|why .*(want|interested)", "cover_letter"),
]
CAPTCHA_SELECTORS = "iframe[src*='recaptcha'], iframe[src*='hcaptcha'], .g-recaptcha, .h-captcha"


def resolve(label: str, profile: dict, cover_letter: str):
    """Return the value for a form label, or None if we have no grounded answer."""
    label = label.lower()
    for pattern, answer in profile.get("answers", {}).items():
        if re.search(pattern.lower(), label):
            return answer
    values = {**profile, "full_name": f"{profile['first_name']} {profile['last_name']}",
              "cover_letter": cover_letter}
    for pattern, key in FIELD_MAP:
        if re.search(pattern, label):
            return values.get(key) or None
    return None


_LABEL_JS = """el => (el.labels && el.labels[0] ? el.labels[0].innerText : '')
  || el.getAttribute('aria-label') || el.placeholder || el.name || ''"""


def fill_form(page, profile, cover_letter):
    """Fill the visible form. Returns a list of unresolved required field labels."""
    unresolved = []
    fields = page.locator(
        "input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=checkbox]):not([type=radio]),"
        " textarea, select")
    for i in range(fields.count()):
        el = fields.nth(i)
        is_select = el.evaluate("e => e.tagName") == "SELECT"
        # selects always carry a default option, so only skip pre-filled text fields
        if not el.is_visible() or (not is_select and (el.input_value() or "").strip()):
            continue
        label = el.evaluate(_LABEL_JS).strip()
        required = el.evaluate("e => e.required || e.getAttribute('aria-required') === 'true'") \
            or label.endswith("*")
        value = resolve(label, profile, cover_letter)
        if value is None:
            if required:
                unresolved.append(label or "(unlabelled field)")
            continue
        try:
            if is_select:
                opts = [o.strip() for o in el.locator("option").all_inner_texts()]
                exact = [o for o in opts if o.lower() == str(value).lower()]
                loose = [o for o in opts if str(value).lower() in o.lower()]
                pick = (exact or loose or [None])[0]
                if pick is None:
                    raise ValueError("no matching option")
                el.select_option(label=pick)
            else:
                el.fill(str(value))
        except Exception:
            if required:
                unresolved.append(label)
    resume = page.locator("input[type=file]").first
    if resume.count() and profile.get("resume_path"):
        resume.set_input_files(profile["resume_path"])
    return unresolved


def apply(job, profile, cover_letter, *, mode="review", shot_dir="screenshots"):
    """mode: 'review' (confirm in terminal) | 'auto' (submit if clean) | 'dry' (fill only).

    Returns (status, note) with status in applied | needs_review | failed | drafted.
    """
    from playwright.sync_api import sync_playwright

    url = job["url"]
    if job["source"] == "lever" and not url.rstrip("/").endswith("/apply"):
        url = url.rstrip("/") + "/apply"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=(mode == "auto"))
        page = browser.new_page()
        try:
            page.goto(url, wait_until="networkidle", timeout=45000)
            # Greenhouse/Ashby put the form below the posting; open it if there's an Apply button.
            btn = page.get_by_role("button", name=re.compile(r"^apply", re.I))
            if btn.count() and not page.locator("input[type=file]").count():
                btn.first.click()
                page.wait_for_load_state("networkidle")
            if page.locator(CAPTCHA_SELECTORS).count():
                return "needs_review", "CAPTCHA present; apply manually"
            unresolved = fill_form(page, profile, cover_letter)
            if unresolved:
                return "needs_review", "no grounded answer for: " + "; ".join(unresolved)
            if mode == "dry":
                page.screenshot(path=f"{shot_dir}/{job['id'].replace(':', '_')}.png", full_page=True)
                return "drafted", "form filled (dry run)"
            if mode == "review":
                ok = input(f"\nSubmit application to {job['company']} - {job['title']}? [y/N] ")
                if ok.strip().lower() != "y":
                    return "skipped", "declined at review"
            page.get_by_role("button", name=re.compile(r"submit|send application", re.I)).first.click()
            page.wait_for_load_state("networkidle")
            return "applied", "submitted"
        except Exception as e:
            return "failed", f"{type(e).__name__}: {e}"[:300]
        finally:
            browser.close()
