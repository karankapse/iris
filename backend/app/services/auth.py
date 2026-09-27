"""Password hashing and login tokens. Standard library only.

- Passwords: scrypt (a slow, memory-hard hash) with a random salt per user. We only ever store
  the hash, so even someone with the database file can't read passwords.
- Login tokens: 32 random bytes, sent to the browser once. The database stores only a SHA-256
  of the token, so a leaked database can't be used to log in either.
"""

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

SESSION_DAYS = 30
RESET_MINUTES = 30
_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), **_SCRYPT)
    return hmac.compare_digest(digest.hex(), digest_hex)  # constant time: no timing leaks


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def expiry_iso() -> str:
    return (datetime.now(UTC) + timedelta(days=SESSION_DAYS)).isoformat()


def new_user_id() -> str:
    return "u_" + secrets.token_hex(8)


def reset_expiry_iso() -> str:
    return (datetime.now(UTC) + timedelta(minutes=RESET_MINUTES)).isoformat()
