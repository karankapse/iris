"""Tiny SQLite storage layer (standard library only, no ORM).

Only numbers and labels are stored here, EXCEPT the optional conversation memory
(conversation_log): the partner's words and the reply, so suggestions can learn how this person
feels about each topic. It stays on this machine and can be switched off / erased in Settings.
Raw video/audio never reaches the backend.
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
CREATE TABLE IF NOT EXISTS conversation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    utterance_id TEXT NOT NULL,
    partner_text TEXT NOT NULL,
    detected_emotion TEXT,         -- what the face showed right after the partner spoke
    emotion_confidence REAL,
    mood TEXT,                     -- the user's mood setting at the time
    reply_text TEXT NOT NULL,
    reply_tone TEXT NOT NULL,
    tone_ok INTEGER,               -- NULL / 0 / 1 (the user's eye yes/no afterwards)
    partner_reaction TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS conversation_log_user ON conversation_log (user_id, id);
CREATE TABLE IF NOT EXISTS voice_profiles (
    user_id TEXT PRIMARY KEY,
    voice_id TEXT NOT NULL,
    name TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS voices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    voice_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, voice_id)
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
            # Older databases: samples didn't record which recording they came from.
            cols = {r["name"] for r in conn.execute("PRAGMA table_info(emotion_samples)")}
            if "recording" not in cols:
                conn.execute("ALTER TABLE emotion_samples ADD COLUMN recording TEXT")

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
        recording: str | None = None,
    ) -> None:
        """rows = [(label, features, source), ...]; `recording` groups frames of one recording."""
        with closing(self._connect()) as conn, conn:
            conn.executemany(
                "INSERT INTO emotion_samples"
                " (user_id, label, feature_names, features, source, recording)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                [
                    (
                        user_id,
                        label,
                        json.dumps(feature_names),
                        json.dumps(feats),
                        source,
                        recording,
                    )
                    for label, feats, source in rows
                ],
            )

    def get_samples(self, user_id: str) -> list[dict]:
        with closing(self._connect()) as conn:
            cur = conn.execute(
                "SELECT label, feature_names, features, source, recording FROM emotion_samples"
                " WHERE user_id = ? ORDER BY id",
                (user_id,),
            )
            return [
                {
                    "label": r["label"],
                    "feature_names": json.loads(r["feature_names"]),
                    "features": json.loads(r["features"]),
                    "source": r["source"],
                    "recording": r["recording"],
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

    # ---- conversation memory ------------------------------------------------
    def add_exchange(self, user_id: str, row: dict) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "INSERT INTO conversation_log (user_id, utterance_id, partner_text,"
                " detected_emotion, emotion_confidence, mood, reply_text, reply_tone)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    user_id,
                    row["utterance_id"],
                    row["partner_text"],
                    row.get("detected_emotion"),
                    row.get("emotion_confidence"),
                    row.get("mood"),
                    row["reply_text"],
                    row["reply_tone"],
                ),
            )

    def rate_exchange(
        self,
        user_id: str,
        utterance_id: str,
        tone_ok: bool | None,
        partner_reaction: str | None,
    ) -> None:
        """Attach the later yes/no (or the partner's tap) to the logged exchange."""
        with closing(self._connect()) as conn, conn:
            if tone_ok is not None:
                conn.execute(
                    "UPDATE conversation_log SET tone_ok = ?"
                    " WHERE user_id = ? AND utterance_id = ?",
                    (int(tone_ok), user_id, utterance_id),
                )
            if partner_reaction is not None:
                conn.execute(
                    "UPDATE conversation_log SET partner_reaction = ?"
                    " WHERE user_id = ? AND utterance_id = ?",
                    (partner_reaction, user_id, utterance_id),
                )

    def recent_exchanges(self, user_id: str, limit: int = 500) -> list[dict]:
        """Newest first."""
        with closing(self._connect()) as conn:
            rows = conn.execute(
                "SELECT utterance_id, partner_text, detected_emotion, emotion_confidence, mood,"
                " reply_text, reply_tone, tone_ok, partner_reaction, created_at"
                " FROM conversation_log WHERE user_id = ? ORDER BY id DESC LIMIT ?",
                (user_id, limit),
            ).fetchall()
            return [dict(r) for r in rows]

    def clear_exchanges(self, user_id: str) -> int:
        with closing(self._connect()) as conn, conn:
            return conn.execute(
                "DELETE FROM conversation_log WHERE user_id = ?", (user_id,)
            ).rowcount

    # ---- voice profiles & voices --------------------------------------------
    def set_voice_profile(self, user_id: str, voice_id: str, name: str) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "INSERT INTO voice_profiles (user_id, voice_id, name) VALUES (?, ?, ?)"
                " ON CONFLICT(user_id) DO UPDATE SET voice_id = excluded.voice_id,"
                " name = excluded.name, updated_at = CURRENT_TIMESTAMP",
                (user_id, voice_id, name),
            )
            conn.execute(
                "INSERT INTO voices (user_id, voice_id, name) VALUES (?, ?, ?)"
                " ON CONFLICT(user_id, voice_id) DO UPDATE SET name = excluded.name",
                (user_id, voice_id, name),
            )

    def get_voice_profile(self, user_id: str) -> dict | None:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT user_id, voice_id, name FROM voice_profiles WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            return dict(row) if row else None

    def list_voices(self, user_id: str) -> list[dict]:
        with closing(self._connect()) as conn, conn:
            # Sync any legacy voice in voice_profiles to voices
            active = conn.execute(
                "SELECT voice_id, name FROM voice_profiles WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            if active:
                conn.execute(
                    "INSERT OR IGNORE INTO voices (user_id, voice_id, name) VALUES (?, ?, ?)",
                    (user_id, active["voice_id"], active["name"]),
                )
            rows = conn.execute(
                "SELECT voice_id, name FROM voices WHERE user_id = ? ORDER BY id ASC",
                (user_id,),
            ).fetchall()
            return [dict(r) for r in rows]

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
