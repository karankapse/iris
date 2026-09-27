"""Sign up, log in, log out, and "who am I". A caregiver creates one account per Iris user;
everything personal (profile, calibration, emotion model, voice) is stored under that account."""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException

from app.config import get_settings
from app.deps import DbDep
from app.schemas.auth import (
    AuthResponse,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    ResetPasswordRequest,
    SignupRequest,
    UpdateMeRequest,
    UserOut,
)
from app.services import auth, email

router = APIRouter(prefix="/api/auth", tags=["auth"])


email_msgs = email  # the message texts live in app/services/email.py


def _email(background: BackgroundTasks, to: str, subject: str, body: str) -> None:
    """Send after the response has gone out, so a slow mail server never slows the app down."""
    background.add_task(email.send_email, get_settings(), to, subject, body)


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


@router.post("/signup", response_model=AuthResponse, status_code=201)
def signup(req: SignupRequest, db: DbDep, background: BackgroundTasks) -> AuthResponse:
    email = _clean_email(req.email)
    user = {"id": auth.new_user_id(), "email": email, "name": req.name.strip()}
    if not db.create_user(user["id"], email, user["name"], auth.hash_password(req.password)):
        raise HTTPException(409, "An account with this email already exists")
    _email(background, email, *email_msgs.welcome(user["name"], get_settings().app_url))
    return _start_session(db, user)


@router.post("/login", response_model=AuthResponse)
def login(req: LoginRequest, db: DbDep) -> AuthResponse:
    user = db.get_user_by_email(req.email.strip().lower())
    # Same message either way, so nobody can probe which emails have accounts.
    if not user or not auth.verify_password(req.password, user["password_hash"]):
        raise HTTPException(401, "Wrong email or password")
    return _start_session(db, user)


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> UserOut:
    return UserOut(id=user["id"], email=user["email"], name=user["name"])


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
    db.delete_all_sessions(user["id"])  # sign out everywhere, then sign in here
    return _start_session(db, user)
