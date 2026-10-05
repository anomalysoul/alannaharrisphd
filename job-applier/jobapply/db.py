"""SQLite job tracker."""
import sqlite3
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  source TEXT, company TEXT, title TEXT, location TEXT, url TEXT,
  description TEXT,
  score INTEGER, reasoning TEXT, cover_letter TEXT, notes TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  updated_at REAL
);
"""

# new -> scored -> drafted -> applied | needs_review | failed | skipped


class DB:
    def __init__(self, path="jobs.db"):
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)

    def add_job(self, job: dict) -> bool:
        """Insert a job; returns False if it was already tracked."""
        cur = self.conn.execute(
            "INSERT OR IGNORE INTO jobs (id, source, company, title, location, url, description, updated_at)"
            " VALUES (:id, :source, :company, :title, :location, :url, :description, :now)",
            {**job, "now": time.time()},
        )
        self.conn.commit()
        return cur.rowcount == 1

    def update(self, job_id: str, **fields):
        cols = ", ".join(f"{k} = :{k}" for k in fields)
        self.conn.execute(
            f"UPDATE jobs SET {cols}, updated_at = :now WHERE id = :id",
            {**fields, "now": time.time(), "id": job_id},
        )
        self.conn.commit()

    def by_status(self, status: str, limit: int = 1000):
        return self.conn.execute(
            "SELECT * FROM jobs WHERE status = ? ORDER BY score DESC, updated_at DESC LIMIT ?",
            (status, limit),
        ).fetchall()

    def get(self, job_id: str):
        return self.conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()

    def all(self):
        return self.conn.execute("SELECT * FROM jobs ORDER BY updated_at DESC").fetchall()
