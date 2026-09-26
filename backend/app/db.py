"""Tiny SQLite storage layer (standard library only, no ORM).

Only numbers and labels are stored here. Raw video/audio never reaches the backend.
A new connection per call keeps things simple and thread-safe for a local app.
"""

import json
import sqlite3
from contextlib import closing
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS emotion_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    label TEXT NOT NULL,
    feature_names TEXT NOT NULL,   -- JSON list
    features TEXT NOT NULL,        -- JSON list of floats
    source TEXT NOT NULL,          -- 'calibration' or 'feedback'
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS emotion_models (
    user_id TEXT PRIMARY KEY,
    model TEXT NOT NULL,           -- JSON of EmotionModel
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,            -- JSON of UserProfile
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    utterance_id TEXT NOT NULL,
    reply_text TEXT NOT NULL,
    spoken_tone TEXT NOT NULL,
    user_tone_ok INTEGER,          -- NULL / 0 / 1
    partner_reaction TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""


class Database:
    def __init__(self, path: Path | str):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        # ":memory:" gives a fresh DB per connection, so tests use a temp file instead.
        with self._connect() as conn:
            conn.executescript(SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    # ---- emotion samples -------------------------------------------------
    def add_samples(
        self,
        user_id: str,
        feature_names: list[str],
        rows: list[tuple[str, list[float], str]],
    ) -> None:
        """rows = [(label, features, source), ...]"""
        with closing(self._connect()) as conn, conn:
            conn.executemany(
                "INSERT INTO emotion_samples (user_id, label, feature_names, features, source)"
                " VALUES (?, ?, ?, ?, ?)",
                [
                    (user_id, label, json.dumps(feature_names), json.dumps(feats), source)
                    for label, feats, source in rows
                ],
            )

    def get_samples(self, user_id: str) -> list[dict]:
        with closing(self._connect()) as conn:
            cur = conn.execute(
                "SELECT label, feature_names, features FROM emotion_samples"
                " WHERE user_id = ? ORDER BY id",
                (user_id,),
            )
            return [
                {
                    "label": r["label"],
                    "feature_names": json.loads(r["feature_names"]),
                    "features": json.loads(r["features"]),
                }
                for r in cur.fetchall()
            ]

    # ---- trained models ---------------------------------------------------
    def save_model(self, user_id: str, model_json: str) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "INSERT INTO emotion_models (user_id, model) VALUES (?, ?)"
                " ON CONFLICT(user_id) DO UPDATE SET model = excluded.model,"
                " updated_at = CURRENT_TIMESTAMP",
                (user_id, model_json),
            )

    def get_model(self, user_id: str) -> str | None:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT model FROM emotion_models WHERE user_id = ?", (user_id,)
            ).fetchone()
            return row["model"] if row else None

    # ---- feedback -----------------------------------------------------------
    def add_feedback(
        self,
        user_id: str,
        utterance_id: str,
        reply_text: str,
        spoken_tone: str,
        user_tone_ok: bool | None,
        partner_reaction: str | None,
    ) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "INSERT INTO feedback (user_id, utterance_id, reply_text, spoken_tone,"
                " user_tone_ok, partner_reaction) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    user_id,
                    utterance_id,
                    reply_text,
                    spoken_tone,
                    None if user_tone_ok is None else int(user_tone_ok),
                    partner_reaction,
                ),
            )

    def count_feedback(self, user_id: str) -> int:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM feedback WHERE user_id = ?", (user_id,)
            ).fetchone()
            return row["n"]

    # ---- profile -------------------------------------------------------------
    def save_profile(self, user_id: str, profile_json: str) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "INSERT INTO profiles (user_id, data) VALUES (?, ?)"
                " ON CONFLICT(user_id) DO UPDATE SET data = excluded.data,"
                " updated_at = CURRENT_TIMESTAMP",
                (user_id, profile_json),
            )

    def get_profile(self, user_id: str) -> str | None:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT data FROM profiles WHERE user_id = ?", (user_id,)).fetchone()
            return row["data"] if row else None
