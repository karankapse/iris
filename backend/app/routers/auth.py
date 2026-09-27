"""Sign up, log in, log out, and "who am I". A caregiver creates one account per Iris user;
everything personal (profile, calibration, emotion model, voice) is stored under that account."""

import json
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException

from app.config import get_settings
from app.deps import DbDep
from app.schemas.auth import (
    AuthResponse,
    ChangePasswordRequest,
    DeleteAccountRequest,
    EmailRequest,
    EyeCalibration,
    ForgotPasswordRequest,
    LoginRequest,
    ResetPasswordRequest,
    SignupRequest,
    SignupResponse,
    TokenRequest,
    UpdateMeRequest,
    UserOut,
)
from app.services import auth, email

router = APIRouter(prefix="/api/auth", tags=["auth"])


email_msgs = email  # the message texts live in app/services/email.py


def _email(background: BackgroundTasks, to: str, subject: str, body: str, html: str) -> None:
    """Send after the response has gone out, so a slow mail server never slows the app down."""
    background.add_task(email.send_email, get_settings(), to, subject, body, html)


def _send_confirmation(db, background: BackgroundTasks, user: dict) -> None:
    token = auth.new_token()
    db.add_verification(auth.token_hash(token), user["id"], auth.verify_expiry_iso())
    link = f"{get_settings().app_url}/verify-email?token={token}"
    _email(
        background, user["email"], *email_msgs.confirm_email(user["name"], link, auth.VERIFY_HOURS)
    )


def _clean_email(email: str) -> str:
    email = email.strip().lower()
    if "@" not in email or email.startswith("@") or email.endswith("@"):
        raise HTTPException(422, "Please enter a valid email address")
    return email


def _start_session(db, user: dict) -> AuthResponse:
    token = auth.new_token()
    db.add_session(auth.token_hash(token), user["id"], auth.expiry_iso())
    return AuthResponse(
        token=token, user=UserOut(id=user["id"], email=user["email"], name=user["name"])
    )


def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return None


def current_user(db: DbDep, authorization: Annotated[str | None, Header()] = None) -> dict:
    """Route dependency: the logged-in user, or 401."""
    token = _bearer(authorization)
    user_id = token and db.get_session_user(auth.token_hash(token), auth.now_iso())
    user = user_id and db.get_user(user_id)
    if not user:
        raise HTTPException(401, "Please log in")
    return user


CurrentUser = Annotated[dict, Depends(current_user)]


@router.post("/signup", response_model=SignupResponse, status_code=201)
def signup(req: SignupRequest, db: DbDep, background: BackgroundTasks) -> SignupResponse:
    """Creates the account (not usable yet) and emails a confirmation link, like most apps do."""
    email = _clean_email(req.email)
    user = {"id": auth.new_user_id(), "email": email, "name": req.name.strip()}
    if not db.create_user(user["id"], email, user["name"], auth.hash_password(req.password)):
        raise HTTPException(409, "An account with this email already exists")
    _send_confirmation(db, background, user)
    return SignupResponse(email=email)


@router.post("/verify", response_model=AuthResponse)
def verify_email(req: TokenRequest, db: DbDep, background: BackgroundTasks) -> AuthResponse:
    """The link in the confirmation email: confirms the address and signs in."""
    user_id = db.use_verification(auth.token_hash(req.token), auth.now_iso())
    user = user_id and db.get_user(user_id)
    if not user:
        raise HTTPException(400, "This confirmation link is invalid or has expired.")
    db.set_verified(user["id"])
    _email(background, user["email"], *email_msgs.welcome(user["name"], get_settings().app_url))
    return _start_session(db, user)


@router.post("/resend-verification", status_code=204)
def resend_verification(req: EmailRequest, db: DbDep, background: BackgroundTasks) -> None:
    """Same answer whether or not the account exists (never reveals who is registered)."""
    user = db.get_user_by_email(req.email.strip().lower())
    if user and not user["email_verified"]:
        _send_confirmation(db, background, user)


@router.post("/login", response_model=AuthResponse)
def login(req: LoginRequest, db: DbDep) -> AuthResponse:
    email = req.email.strip().lower()
    # Brute-force protection: too many wrong passwords lock this email for a while.
    if db.count_login_failures(email, auth.lock_window_start_iso()) >= auth.MAX_FAILED_LOGINS:
        raise HTTPException(
            429,
            f"Too many wrong passwords. Try again in {auth.LOCK_MINUTES} minutes, "
            "or reset your password.",
        )
    user = db.get_user_by_email(email)
    # Same message either way, so nobody can probe which emails have accounts.
    if not user or not auth.verify_password(req.password, user["password_hash"]):
        db.record_login_failure(email, auth.now_iso())
        raise HTTPException(401, "Wrong email or password")
    db.clear_login_failures(email)
    if not user["email_verified"]:
        raise HTTPException(403, "Please confirm your email first: check your inbox for the link.")
    return _start_session(db, user)


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> UserOut:
    return UserOut(id=user["id"], email=user["email"], name=user["name"])


@router.get("/me/eye-calibration", response_model=EyeCalibration)
def get_eye_calibration(user: CurrentUser, db: DbDep) -> EyeCalibration:
    saved = db.get_eye_calibration(user["id"])
    return EyeCalibration(data=json.loads(saved) if saved else None)


@router.put("/me/eye-calibration", status_code=204)
def put_eye_calibration(req: EyeCalibration, user: CurrentUser, db: DbDep) -> None:
    if req.data is None:
        raise HTTPException(422, "No calibration to save")
    if len(json.dumps(req.data)) > 200_000:
        raise HTTPException(413, "Calibration too large")
    db.save_eye_calibration(user["id"], json.dumps(req.data))


@router.post("/logout", status_code=204)
def logout(db: DbDep, authorization: Annotated[str | None, Header()] = None) -> None:
    token = _bearer(authorization)
    if token:
        db.delete_session(auth.token_hash(token))


@router.patch("/me", response_model=UserOut)
def update_me(req: UpdateMeRequest, user: CurrentUser, db: DbDep) -> UserOut:
    name = req.name.strip()
    if not name:
        raise HTTPException(422, "Name can't be empty")
    db.update_user(user["id"], name=name)
    return UserOut(id=user["id"], email=user["email"], name=name)


@router.post("/password", status_code=204)
def change_password(
    req: ChangePasswordRequest,
    user: CurrentUser,
    db: DbDep,
    background: BackgroundTasks,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    if not auth.verify_password(req.current_password, user["password_hash"]):
        raise HTTPException(401, "Current password is wrong")
    db.update_user(user["id"], password_hash=auth.hash_password(req.new_password))
    # Sign out every OTHER device (e.g. if the old password leaked); keep this one signed in.
    db.delete_other_sessions(user["id"], auth.token_hash(_bearer(authorization) or ""))
    _email(
        background,
        user["email"],
        *email_msgs.password_changed(user["name"], get_settings().app_url),
    )


@router.post("/forgot", status_code=204)
def forgot_password(req: ForgotPasswordRequest, db: DbDep, background: BackgroundTasks) -> None:
    """Emails a one-time reset link. Same answer either way: it never reveals who has an account."""
    user = db.get_user_by_email(req.email.strip().lower())
    if not user:
        return
    token = auth.new_token()
    db.add_password_reset(auth.token_hash(token), user["id"], auth.reset_expiry_iso())
    link = f"{get_settings().app_url}/reset-password?token={token}"
    _email(
        background,
        user["email"],
        *email_msgs.password_reset(user["name"], link, auth.RESET_MINUTES),
    )


@router.post("/reset", response_model=AuthResponse)
def reset_password(req: ResetPasswordRequest, db: DbDep) -> AuthResponse:
    user_id = db.use_password_reset(auth.token_hash(req.token), auth.now_iso())
    user = user_id and db.get_user(user_id)
    if not user:
        raise HTTPException(400, "This reset link is invalid or has expired. Ask for a new one.")
    db.update_user(user["id"], password_hash=auth.hash_password(req.new_password))
    db.set_verified(user["id"])  # the reset link was emailed, so the address is confirmed too
    db.clear_login_failures(user["email"])
    db.delete_all_sessions(user["id"])  # sign out everywhere, then sign in here
    return _start_session(db, user)


@router.delete("/me", status_code=204)
def delete_account(
    req: DeleteAccountRequest, user: CurrentUser, db: DbDep, background: BackgroundTasks
) -> None:
    """Permanently delete the signed-in account and everything stored for it."""
    if not auth.verify_password(req.password, user["password_hash"]):
        raise HTTPException(401, "Password is wrong")
    db.delete_user_everything(user["id"])
    _email(background, user["email"], *email_msgs.account_deleted(user["name"]))
