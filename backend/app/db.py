"""Tiny SQLite storage layer (standard library only, no ORM).

Only numbers and labels are stored here. Raw video/audio never reaches the backend.
A new connection per call keeps things simple and thread-safe for a local app.
"""

import json
import sqlite3
from contextlib import closing
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,   -- sha256 of the emailed token
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,           -- random id; used as user_id everywhere else
    email TEXT NOT NULL UNIQUE,    -- stored lowercase
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,   -- scrypt, see app/services/auth.py (never the password itself)
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,   -- sha256 of the login token (the token itself is never stored)
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
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

    # ---- accounts ------------------------------------------------------------
    def create_user(self, user_id: str, email: str, name: str, password_hash: str) -> bool:
        """False if the email is already registered."""
        try:
            with closing(self._connect()) as conn, conn:
                conn.execute(
                    "INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)",
                    (user_id, email, name, password_hash),
                )
            return True
        except sqlite3.IntegrityError:
            return False

    def get_user_by_email(self, email: str) -> dict | None:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            return dict(row) if row else None

    def get_user(self, user_id: str) -> dict | None:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return dict(row) if row else None

    def add_session(self, token_hash: str, user_id: str, expires_at: str) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                (token_hash, user_id, expires_at),
            )

    def get_session_user(self, token_hash: str, now: str) -> str | None:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?",
                (token_hash, now),
            ).fetchone()
            return row["user_id"] if row else None

    def delete_session(self, token_hash: str) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))

    def update_user(
        self, user_id: str, *, name: str | None = None, password_hash: str | None = None
    ):
        with closing(self._connect()) as conn, conn:
            if name is not None:
                conn.execute("UPDATE users SET name = ? WHERE id = ?", (name, user_id))
            if password_hash is not None:
                conn.execute(
                    "UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id)
                )

    def delete_other_sessions(self, user_id: str, keep_token_hash: str) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "DELETE FROM sessions WHERE user_id = ? AND token_hash != ?",
                (user_id, keep_token_hash),
            )

    def add_password_reset(self, token_hash: str, user_id: str, expires_at: str) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                (token_hash, user_id, expires_at),
            )

    def use_password_reset(self, token_hash: str, now: str) -> str | None:
        """The user id if the token is valid (unused, not expired); marks it used. Else None."""
        with closing(self._connect()) as conn, conn:
            row = conn.execute(
                "SELECT user_id FROM password_resets WHERE token_hash = ? AND used = 0"
                " AND expires_at > ?",
                (token_hash, now),
            ).fetchone()
            if not row:
                return None
            conn.execute("UPDATE password_resets SET used = 1 WHERE token_hash = ?", (token_hash,))
            return row["user_id"]

    def delete_all_sessions(self, user_id: str) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))

    # Every table that holds something belonging to a user (keep in sync when adding tables).
    USER_TABLES = (
        "sessions",
        "password_resets",
        "emotion_samples",
        "emotion_models",
        "profiles",
        "feedback",
        "voice_profiles",
        "voices",
    )

    def delete_user_everything(self, user_id: str) -> None:
        """Delete the account AND all its data (calibration, emotion model, profile, voices)."""
        with closing(self._connect()) as conn, conn:
            for table in self.USER_TABLES:
                conn.execute(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))

    def list_users(self) -> list[dict]:
        with closing(self._connect()) as conn:
            rows = conn.execute("SELECT id, email, name, created_at FROM users ORDER BY created_at")
            return [dict(r) for r in rows]
