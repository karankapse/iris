"""Tiny storage layer (no ORM): SQLite on your machine, Postgres when deployed.

Set DATABASE_URL (e.g. the free Postgres database Vercel adds) to use Postgres; otherwise it's a
SQLite file. The same SQL runs on both (see _PgConnection).

Only numbers and labels are stored here, EXCEPT the optional conversation memory
(conversation_log): the partner's words and the reply, so suggestions can learn how this person
feels about each topic. It stays on this machine and can be switched off / erased in Settings.
Raw video/audio never reaches the backend.
A new connection per call keeps things simple and thread-safe for a local app.
"""

import json
import re
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
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS email_verifications (
    token_hash TEXT PRIMARY KEY,   -- sha256 of the emailed token
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS login_failures (
    email TEXT NOT NULL,
    failed_at TEXT NOT NULL
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
CREATE TABLE IF NOT EXISTS eye_calibrations (
    user_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,            -- JSON: browser storage key -> saved calibration
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


def _postgres_schema() -> str:
    return SCHEMA.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "BIGSERIAL PRIMARY KEY")


class _PgConnection:
    """Postgres behind the same small interface the code below uses with sqlite3: `?`
    placeholders, conn.execute() returning a cursor, rows by column name, `with conn:` = one
    transaction (committed on success)."""

    def __init__(self, url: str):
        import psycopg
        from psycopg.rows import dict_row

        # no server-side prepared statements: works through connection poolers (Neon, PgBouncer)
        self._conn = psycopg.connect(url, row_factory=dict_row, prepare_threshold=None)

    @staticmethod
    def _sql(sql: str) -> str:
        return re.sub(r"\?", "%s", sql)

    def execute(self, sql: str, params=()):
        cur = self._conn.cursor()
        # no parameters: sent as-is, which also allows several statements (the schema)
        cur.execute(self._sql(sql), params or None)
        return cur

    def executemany(self, sql: str, rows):
        cur = self._conn.cursor()
        cur.executemany(self._sql(sql), list(rows))
        return cur

    def __enter__(self):
        return self

    def __exit__(self, exc_type, *_):
        if exc_type:
            self._conn.rollback()
        else:
            self._conn.commit()

    def close(self):
        self._conn.close()


def _integrity_errors() -> tuple[type[Exception], ...]:
    try:
        import psycopg

        return (sqlite3.IntegrityError, psycopg.IntegrityError)
    except ImportError:
        return (sqlite3.IntegrityError,)


class Database:
    def __init__(self, path: Path | str, url: str = ""):
        self.path = str(path)
        self.url = url
        if url:
            with closing(self._connect()) as conn, conn:
                conn.execute(_postgres_schema())  # several statements, no parameters
                conn.execute("ALTER TABLE emotion_samples ADD COLUMN IF NOT EXISTS recording TEXT")
            return
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        # ":memory:" gives a fresh DB per connection, so tests use a temp file instead.
        with self._connect() as conn:
            conn.executescript(SCHEMA)
            # Upgrade older databases: accounts made before email confirmation existed count as
            # confirmed (new accounts are inserted as unconfirmed explicitly).
            cols = [c[1] for c in conn.execute("PRAGMA table_info(users)")]
            if "email_verified" not in cols:
                conn.execute(
                    "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1"
                )
            # Older databases: samples didn't record which recording they came from.
            cols = {r["name"] for r in conn.execute("PRAGMA table_info(emotion_samples)")}
            if "recording" not in cols:
                conn.execute("ALTER TABLE emotion_samples ADD COLUMN recording TEXT")

    def _connect(self):
        if self.url:
            return _PgConnection(self.url)
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
                    "INSERT INTO voices (user_id, voice_id, name) VALUES (?, ?, ?)"
                    " ON CONFLICT(user_id, voice_id) DO NOTHING",
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

    def save_eye_calibration(self, user_id: str, data_json: str) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "INSERT INTO eye_calibrations (user_id, data) VALUES (?, ?)"
                " ON CONFLICT(user_id) DO UPDATE SET data = excluded.data,"
                " updated_at = CURRENT_TIMESTAMP",
                (user_id, data_json),
            )

    def get_eye_calibration(self, user_id: str) -> str | None:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT data FROM eye_calibrations WHERE user_id = ?", (user_id,)
            ).fetchone()
            return row["data"] if row else None

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
                    "INSERT INTO users (id, email, name, password_hash, email_verified)"
                    " VALUES (?, ?, ?, ?, 0)",
                    (user_id, email, name, password_hash),
                )
            return True
        except _integrity_errors():
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
        "email_verifications",
        "emotion_samples",
        "conversation_log",
        "eye_calibrations",
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
            conn.execute(
                "DELETE FROM login_failures WHERE email = (SELECT email FROM users WHERE id = ?)",
                (user_id,),
            )
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))

    def list_users(self) -> list[dict]:
        with closing(self._connect()) as conn:
            rows = conn.execute("SELECT id, email, name, created_at FROM users ORDER BY created_at")
            return [dict(r) for r in rows]

    # ---- email confirmation ----------------------------------------------------------
    def add_verification(self, token_hash: str, user_id: str, expires_at: str) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "INSERT INTO email_verifications (token_hash, user_id, expires_at)"
                " VALUES (?, ?, ?)",
                (token_hash, user_id, expires_at),
            )

    def use_verification(self, token_hash: str, now: str) -> str | None:
        with closing(self._connect()) as conn, conn:
            row = conn.execute(
                "SELECT user_id FROM email_verifications WHERE token_hash = ? AND used = 0"
                " AND expires_at > ?",
                (token_hash, now),
            ).fetchone()
            if not row:
                return None
            conn.execute(
                "UPDATE email_verifications SET used = 1 WHERE token_hash = ?", (token_hash,)
            )
            return row["user_id"]

    def set_verified(self, user_id: str) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute("UPDATE users SET email_verified = 1 WHERE id = ?", (user_id,))

    # ---- brute-force protection ---------------------------------------------------------
    def record_login_failure(self, email: str, now: str) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "INSERT INTO login_failures (email, failed_at) VALUES (?, ?)", (email, now)
            )

    def count_login_failures(self, email: str, since: str) -> int:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM login_failures WHERE email = ? AND failed_at > ?",
                (email, since),
            ).fetchone()
            return row["n"]

    def clear_login_failures(self, email: str) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute("DELETE FROM login_failures WHERE email = ?", (email,))
