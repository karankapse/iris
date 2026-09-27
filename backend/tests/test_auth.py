from app.services.auth import hash_password, verify_password

ACCOUNT = {"email": "Sam@Example.com", "password": "correct horse", "name": "Sam"}


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_password_hashing():
    h = hash_password("secret123")
    assert "secret123" not in h  # never stored in plain text
    assert verify_password("secret123", h)
    assert not verify_password("wrong", h)
    assert hash_password("secret123") != h  # random salt each time


def test_signup_then_me(client):
    res = client.post("/api/auth/signup", json=ACCOUNT)
    assert res.status_code == 201
    body = res.json()
    assert body["user"]["email"] == "sam@example.com"  # stored lowercase
    assert body["user"]["id"].startswith("u_")
    me = client.get("/api/auth/me", headers=bearer(body["token"]))
    assert me.status_code == 200 and me.json()["name"] == "Sam"


def test_duplicate_email_is_rejected(client):
    client.post("/api/auth/signup", json=ACCOUNT)
    res = client.post("/api/auth/signup", json={**ACCOUNT, "email": "sam@example.com"})
    assert res.status_code == 409


def test_login_works_and_wrong_password_does_not(client):
    user_id = client.post("/api/auth/signup", json=ACCOUNT).json()["user"]["id"]
    ok = client.post(
        "/api/auth/login", json={"email": "sam@example.com", "password": "correct horse"}
    )
    assert ok.status_code == 200 and ok.json()["user"]["id"] == user_id
    bad = client.post("/api/auth/login", json={"email": "sam@example.com", "password": "nope"})
    assert bad.status_code == 401
    unknown = client.post("/api/auth/login", json={"email": "who@x.com", "password": "nope"})
    assert unknown.json()["detail"] == bad.json()["detail"]  # doesn't reveal which emails exist


def test_logout_ends_the_session(client):
    token = client.post("/api/auth/signup", json=ACCOUNT).json()["token"]
    assert client.post("/api/auth/logout", headers=bearer(token)).status_code == 204
    assert client.get("/api/auth/me", headers=bearer(token)).status_code == 401


def test_me_needs_a_valid_token(client):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers=bearer("made-up")).status_code == 401


def test_signup_validation(client):
    assert client.post("/api/auth/signup", json={**ACCOUNT, "password": "short"}).status_code == 422
    assert (
        client.post("/api/auth/signup", json={**ACCOUNT, "email": "no-at-sign"}).status_code == 422
    )


def test_tokens_are_not_stored_in_plain_text(client):
    token = client.post("/api/auth/signup", json=ACCOUNT).json()["token"]
    db = client.app.state.db
    with db._connect() as conn:
        stored = [r[0] for r in conn.execute("SELECT token_hash FROM sessions")]
        pw = [r[0] for r in conn.execute("SELECT password_hash FROM users")]
    assert token not in stored
    assert "correct horse" not in pw[0]
