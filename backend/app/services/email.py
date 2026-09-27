"""Sending email over SMTP (standard library only).

No SMTP server configured (the default in development)? The email is written to the backend log
instead, so every flow can still be tested; nothing is lost silently.
"""

import logging
import smtplib
from email.message import EmailMessage

from app.config import Settings

log = logging.getLogger("iris.email")


def send_email(settings: Settings, to: str, subject: str, body: str) -> bool:
    """True if handed to the SMTP server. Never raises: a failed email must not break sign-up."""
    if not settings.smtp_host:
        log.warning("[email not sent: SMTP not configured] to=%s subject=%s\n%s", to, subject, body)
        return False
    msg = EmailMessage()
    msg["From"] = settings.email_from or settings.smtp_user
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            smtp.starttls()
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
        log.info("email sent to %s: %s", to, subject)
        return True
    except (smtplib.SMTPException, OSError) as e:
        log.error("email to %s failed: %s", to, e)
        return False


# ---- the messages ---------------------------------------------------------------------------


def welcome(name: str, app_url: str) -> tuple[str, str]:
    return (
        "Welcome to Iris",
        f"Hi,\n\nAn Iris account was created for {name}.\n\n"
        f"Next step: sign in and calibrate the eyes (about 11 seconds) so Iris knows how "
        f"{name}'s eyes move:\n{app_url}/calibrate\n\n"
        "If you didn't create this account, you can ignore this email.\n\n- Iris",
    )


def password_changed(name: str, app_url: str) -> tuple[str, str]:
    return (
        "Your Iris password was changed",
        f"Hi,\n\nThe password for {name}'s Iris account was just changed, and other devices were "
        "signed out.\n\nIf this wasn't you, reset your password now:\n"
        f"{app_url}/login?forgot=1\n\n- Iris",
    )


def password_reset(name: str, link: str, minutes: int) -> tuple[str, str]:
    return (
        "Reset your Iris password",
        f"Hi,\n\nSomeone asked to reset the password for {name}'s Iris account.\n\n"
        f"Choose a new password here (the link works once, for {minutes} minutes):\n{link}\n\n"
        "If this wasn't you, ignore this email: the password stays the same.\n\n- Iris",
    )


def account_deleted(name: str) -> tuple[str, str]:
    return (
        "Your Iris account was deleted",
        f"Hi,\n\n{name}'s Iris account and all of its data (calibration, emotion model, profile "
        "and voices) were permanently deleted.\n\n"
        "If this wasn't you, reply to this email.\n\n- Iris",
    )
