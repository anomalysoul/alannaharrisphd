# job-applier

A CLI that finds jobs, scores them against your resume with Claude, drafts tailored cover letters, and fills out the application forms in a real browser. It keeps a local SQLite tracker of everything.

## Setup
```bash
pip install -r requirements.txt && playwright install chromium
export ANTHROPIC_API_KEY=...
cp profile.example.json profile.json   # edit: contact info, answers, preferences, company boards
# put resume.pdf and resume.txt (plain text) next to it
```
`sources` in the profile lists company board slugs, i.e. the `X` in `boards.greenhouse.io/X`, `jobs.lever.co/X`, or `jobs.ashbyhq.com/X`.

## Use
```bash
python -m jobapply run              # fetch -> score -> draft cover letters
python -m jobapply list             # see the pipeline
python -m jobapply apply --dry-run  # fill forms + screenshot, never submit
python -m jobapply apply            # opens each form; you type y to submit
python -m jobapply apply --auto --limit 3   # headless, submits clean forms with no confirmation
```
Statuses: `new -> scored -> drafted -> applied`, or `skipped` / `needs_review` / `failed`.

## Guardrails (deliberate)
- Cover letters use only facts from your resume and summary. The prompt forbids inventing anything.
- Form answers come only from your `answers` map and profile. A required field with no grounded answer sets `needs_review` and nothing is submitted.
- CAPTCHAs are never bypassed. The job is flagged for you to do manually.
- Default mode is human-in-the-loop, and `--limit` caps applications per run. Review the first several drafts before using `--auto`.
- Only public job-board APIs are used, with no scraping and no logins. LinkedIn and Indeed forbid automation, so they are intentionally unsupported.

## Tests
`pytest`
