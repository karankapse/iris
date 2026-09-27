import re

from app.services.auth import MAX_FAILED_LOGINS, hash_password, verify_password

ACCOUNT = {"email": "Sam@Example.com", "password": "correct horse", "name": "Sam"}
LOGIN = {"email": "sam@example.com", "password": "correct horse"}


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def link_token(outbox, path):
    """The token from the most recent emailed link to `path`."""
    for mail in reversed(outbox):
        m = re.search(rf"{path}\?token=([\w-]+)", mail["body"])
        if m:
            return m.group(1)
    raise AssertionError(f"no {path} link emailed")


def signup_confirmed(client, outbox, account=ACCOUNT) -> dict:
    """Sign up + click the emailed confirmation link. Returns the signed-in AuthResponse."""
    assert client.post("/api/auth/signup", json=account).status_code == 201
    res = client.post("/api/auth/verify", json={"token": link_token(outbox, "verify-email")})
    assert res.status_code == 200
    return res.json()


def test_password_hashing():
    h = hash_password("secret123")
    assert "secret123" not in h  # never stored in plain text
    assert verify_password("secret123", h)
    assert not verify_password("wrong", h)
    assert hash_password("secret123") != h  # random salt each time


# ---- registration with email confirmation ------------------------------------------------


def test_signup_emails_a_confirmation_link_and_does_not_sign_in_yet(client, outbox):
    res = client.post("/api/auth/signup", json=ACCOUNT)
    assert res.status_code == 201
    assert res.json() == {"email": "sam@example.com", "needs_verification": True}
    assert "token" not in res.json()
    mail = outbox[-1]
    assert mail["to"] == "sam@example.com" and mail["subject"] == "Confirm your email for Iris"
    assert "verify-email?token=" in mail["html"]  # branded HTML with the button
    assert "correct horse" not in mail["body"] + mail["html"]  # never email a password


def test_login_is_refused_until_the_email_is_confirmed(client, outbox):
    client.post("/api/auth/signup", json=ACCOUNT)
    res = client.post("/api/auth/login", json=LOGIN)
    assert res.status_code == 403 and "confirm your email" in res.json()["detail"]


def test_confirmation_link_signs_in_works_once_and_sends_a_welcome(client, outbox):
    body = signup_confirmed(client, outbox)
    assert body["user"]["email"] == "sam@example.com"
    assert client.get("/api/auth/me", headers=bearer(body["token"])).status_code == 200
    assert outbox[-1]["subject"] == "You're all set with Iris"
    assert client.post("/api/auth/login", json=LOGIN).status_code == 200  # can log in now
    used = link_token(outbox, "verify-email")
    assert client.post("/api/auth/verify", json={"token": used}).status_code == 400


def test_resend_confirmation(client, outbox):
    client.post("/api/auth/signup", json=ACCOUNT)
    n = len(outbox)
    assert (
        client.post("/api/auth/resend-verification", json={"email": "SAM@example.com"}).status_code
        == 204
    )
    assert len(outbox) == n + 1 and outbox[-1]["subject"] == "Confirm your email for Iris"
    # unknown or already-confirmed emails: same answer, nothing sent
    assert (
        client.post("/api/auth/resend-verification", json={"email": "who@x.com"}).status_code == 204
    )
    assert len(outbox) == n + 1


def test_duplicate_email_is_rejected(client, outbox):
    client.post("/api/auth/signup", json=ACCOUNT)
    res = client.post("/api/auth/signup", json={**ACCOUNT, "email": "sam@example.com"})
    assert res.status_code == 409


def test_signup_validation(client):
    assert client.post("/api/auth/signup", json={**ACCOUNT, "password": "short"}).status_code == 422
    assert (
        client.post("/api/auth/signup", json={**ACCOUNT, "email": "no-at-sign"}).status_code == 422
    )


# ---- login / sessions ------------------------------------------------------------------------


def test_login_works_and_wrong_password_does_not(client, outbox):
    user_id = signup_confirmed(client, outbox)["user"]["id"]
    ok = client.post("/api/auth/login", json={**LOGIN, "email": "SAM@example.com"})
    assert ok.status_code == 200 and ok.json()["user"]["id"] == user_id
    bad = client.post("/api/auth/login", json={**LOGIN, "password": "nope"})
    assert bad.status_code == 401
    unknown = client.post("/api/auth/login", json={"email": "who@x.com", "password": "nope"})
    assert unknown.json()["detail"] == bad.json()["detail"]  # doesn't reveal which emails exist


def test_too_many_wrong_passwords_lock_the_account_for_a_while(client, outbox):
    signup_confirmed(client, outbox)
    for _ in range(MAX_FAILED_LOGINS):
        assert client.post("/api/auth/login", json={**LOGIN, "password": "nope"}).status_code == 401
    locked = client.post("/api/auth/login", json=LOGIN)  # even the RIGHT password is refused now
    assert locked.status_code == 429 and "Too many" in locked.json()["detail"]
    # resetting the password (proving you own the email) lifts the lock
    client.post("/api/auth/forgot", json={"email": "sam@example.com"})
    token = link_token(outbox, "reset-password")
    client.post("/api/auth/reset", json={"token": token, "new_password": "brand new pw"})
    assert (
        client.post("/api/auth/login", json={**LOGIN, "password": "brand new pw"}).status_code
        == 200
    )


def test_logout_ends_the_session(client, outbox):
    token = signup_confirmed(client, outbox)["token"]
    assert client.post("/api/auth/logout", headers=bearer(token)).status_code == 204
    assert client.get("/api/auth/me", headers=bearer(token)).status_code == 401


def test_me_needs_a_valid_token(client):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers=bearer("made-up")).status_code == 401


def test_tokens_are_not_stored_in_plain_text(client, outbox):
    token = signup_confirmed(client, outbox)["token"]
    with client.app.state.db._connect() as conn:
        stored = [r[0] for r in conn.execute("SELECT token_hash FROM sessions")]
        pw = [r[0] for r in conn.execute("SELECT password_hash FROM users")]
    assert token not in stored
    assert "correct horse" not in pw[0]


# ---- account changes ------------------------------------------------------------------------


def test_update_name(client, outbox):
    token = signup_confirmed(client, outbox)["token"]
    res = client.patch("/api/auth/me", json={"name": "  Samuel "}, headers=bearer(token))
    assert res.status_code == 200 and res.json()["name"] == "Samuel"
    assert client.patch("/api/auth/me", json={"name": "x"}).status_code == 401  # needs login


def test_change_password_signs_out_other_devices_and_sends_a_notice(client, outbox):
    token = signup_confirmed(client, outbox)["token"]
    other = client.post("/api/auth/login", json=LOGIN).json()["token"]
    change = {"current_password": "nope", "new_password": "brand new pw"}
    assert client.post("/api/auth/password", json=change, headers=bearer(token)).status_code == 401
    change["current_password"] = "correct horse"
    assert client.post("/api/auth/password", json=change, headers=bearer(token)).status_code == 204
    assert client.get("/api/auth/me", headers=bearer(token)).status_code == 200  # this device stays
    assert client.get("/api/auth/me", headers=bearer(other)).status_code == 401  # others signed out
    assert outbox[-1]["subject"] == "Your Iris password was changed"


def test_forgot_password_emails_a_one_time_link(client, outbox):
    old = signup_confirmed(client, outbox)["token"]
    assert client.post("/api/auth/forgot", json={"email": "SAM@example.com"}).status_code == 204
    token = link_token(outbox, "reset-password")
    res = client.post("/api/auth/reset", json={"token": token, "new_password": "fresh password"})
    assert res.status_code == 200
    assert client.get("/api/auth/me", headers=bearer(old)).status_code == 401  # old sessions gone
    assert (
        client.post("/api/auth/login", json={**LOGIN, "password": "fresh password"}).status_code
        == 200
    )
    again = client.post("/api/auth/reset", json={"token": token, "new_password": "another one"})
    assert again.status_code == 400  # one use only


def test_forgot_password_does_not_reveal_unknown_emails(client, outbox):
    assert client.post("/api/auth/forgot", json={"email": "nobody@x.com"}).status_code == 204
    assert outbox == []


def test_bad_reset_token_is_rejected(client):
    res = client.post("/api/auth/reset", json={"token": "made-up", "new_password": "whatever12"})
    assert res.status_code == 400


def test_delete_account_removes_the_account_and_all_its_data(client, outbox):
    body = signup_confirmed(client, outbox)
    token, user_id = body["token"], body["user"]["id"]
    client.put(f"/api/profile/{user_id}", json={"name": "Sam", "phrases": ["hi"]})
    wrong = client.request(
        "DELETE", "/api/auth/me", json={"password": "nope"}, headers=bearer(token)
    )
    assert wrong.status_code == 401
    ok = client.request(
        "DELETE", "/api/auth/me", json={"password": "correct horse"}, headers=bearer(token)
    )
    assert ok.status_code == 204
    assert client.get("/api/auth/me", headers=bearer(token)).status_code == 401
    assert client.post("/api/auth/login", json=LOGIN).status_code == 401  # account gone
    assert client.get(f"/api/profile/{user_id}").json()["name"] == ""  # data gone too
    assert outbox[-1]["subject"] == "Your Iris account was deleted"
    assert client.post("/api/auth/signup", json=ACCOUNT).status_code == 201  # email reusable


def test_user_tables_cover_every_table_with_a_user_id(client):
    db = client.app.state.db
    with db._connect() as conn:
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        with_user = {
            t
            for t in tables
            if any(c[1] == "user_id" for c in conn.execute(f"PRAGMA table_info({t})"))
        }
    assert with_user == set(db.USER_TABLES)


def test_existing_accounts_count_as_confirmed_after_the_upgrade(tmp_path):
    """Older databases (before email confirmation) keep working: those accounts stay usable."""
    import sqlite3

    from app.db import Database

    path = tmp_path / "old.db"
    with sqlite3.connect(path) as conn:
        conn.execute(
            "CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,"
            " name TEXT NOT NULL, password_hash TEXT NOT NULL,"
            " created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        )
        conn.execute(
            "INSERT INTO users (id, email, name, password_hash) VALUES ('u1','a@b.c','A','x')"
        )
    db = Database(path)
    assert db.get_user("u1")["email_verified"] == 1


def test_without_smtp_the_email_is_logged_not_lost(caplog):
    from app.config import Settings
    from app.services.email import deliver

    with caplog.at_level("WARNING", logger="iris.email"):
        assert deliver(Settings(smtp_host=""), "a@b.c", "Hello", "Body text") is False
    assert "SMTP not configured" in caplog.text and "Body text" in caplog.text
