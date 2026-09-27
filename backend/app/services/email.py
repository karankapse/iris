"""Sending email as branded HTML with a plain-text fallback, over SMTP (e.g. Gmail) or, where
SMTP is blocked (hosts like Railway), Brevo's HTTPS API.

Nothing configured (the default in development)? The email is written to the backend log
instead, so every flow can still be tested; nothing is lost silently.
"""

import html as html_lib
import logging
import smtplib
from email.message import EmailMessage
from email.utils import make_msgid, parseaddr

import httpx

from app.config import Settings

log = logging.getLogger("iris.email")

# (subject, plain text, html)
Email = tuple[str, str, str]


def send_email(
    settings: Settings, to: str, subject: str, body: str, html: str | None = None
) -> bool:
    """True if handed to the SMTP server. Never raises: a failed email must not break sign-up."""
    return deliver(settings, to, subject, body, html)


def deliver(settings: Settings, to: str, subject: str, body: str, html: str | None = None) -> bool:
    if settings.brevo_api_key:
        return _deliver_brevo(settings, to, subject, body, html)
    if not settings.smtp_host:
        log.warning("[email not sent: SMTP not configured] to=%s subject=%s\n%s", to, subject, body)
        return False
    msg = EmailMessage()
    msg["From"] = settings.email_from or settings.smtp_user
    msg["To"] = to
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid(domain="iris.app")  # unique: mail apps don't merge them
    msg.set_content(body)
    if html:
        msg.add_alternative(html, subtype="html")
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


def _deliver_brevo(settings: Settings, to: str, subject: str, body: str, html: str | None) -> bool:
    """Brevo's transactional email API (HTTPS, so it works where SMTP ports are blocked). The
    sender must be verified in Brevo (a single address is enough: no domain needed)."""
    name, address = parseaddr(settings.email_from or settings.smtp_user)
    payload = {
        "sender": {"name": name or "Iris", "email": address},
        "to": [{"email": to}],
        "subject": subject,
        "textContent": body,
        **({"htmlContent": html} if html else {}),
    }
    try:
        res = httpx.post(
            "https://api.brevo.com/v3/smtp/email",
            json=payload,
            headers={"api-key": settings.brevo_api_key, "accept": "application/json"},
            timeout=15,
        )
        res.raise_for_status()
        log.info("email sent to %s: %s", to, subject)
        return True
    except httpx.HTTPError as e:
        detail = e.response.text if isinstance(e, httpx.HTTPStatusError) else str(e)
        log.error("email to %s failed (Brevo): %s", to, detail)
        return False


# ---- the branded layout -------------------------------------------------------------------


def _layout(title: str, paragraphs: list[str], button: tuple[str, str] | None, footer: str) -> str:
    """A simple, email-client-safe card: pink header, text, one big button."""
    esc = html_lib.escape
    body = "".join(
        f'<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#1f2330">{esc(p)}</p>'
        for p in paragraphs
    )
    btn = ""
    if button:
        label, url = button
        btn = (
            f'<p style="margin:24px 0"><a href="{esc(url)}" style="background:#d95e9c;color:#fff;'
            "text-decoration:none;font-weight:700;padding:14px 26px;border-radius:12px;"
            f'display:inline-block;font-size:16px">{esc(label)}</a></p>'
            '<p style="margin:0 0 14px;font-size:13px;color:#6b7280">Button not working? '
            f'Copy this link:<br><a href="{esc(url)}" style="color:#6b7280">{esc(url)}</a></p>'
        )
    return (
        '<!doctype html><html><body style="margin:0;background:#f3f4f8;padding:24px 12px;'
        'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">'
        '<tr><td align="center">'
        '<table role="presentation" width="100%" style="max-width:520px;background:#fff;'
        'border-radius:18px;overflow:hidden" cellspacing="0" cellpadding="0">'
        '<tr><td style="background:#0b1024;padding:22px 28px">'
        '<span style="display:inline-block;width:30px;height:30px;border-radius:50%;'
        'background:#fff;vertical-align:middle"></span>'
        '<span style="color:#fff;font-size:22px;font-weight:700;vertical-align:middle;'
        'margin-left:10px">Iris</span></td></tr>'
        '<tr><td style="padding:28px">'
        '<h1 style="margin:0 0 16px;font-size:22px;color:#0b1024">'
        f"{esc(title)}</h1>{body}{btn}</td></tr>"
        f'<tr><td style="padding:16px 28px;background:#fafafb;font-size:12px;color:#9ca3af">'
        f"{esc(footer)}</td></tr></table></td></tr></table></body></html>"
    )


def _make(subject: str, title: str, paragraphs: list[str], button, footer: str) -> Email:
    text = "\n\n".join([title, *paragraphs]) + (f"\n\n{button[0]}: {button[1]}" if button else "")
    return subject, f"{text}\n\n{footer}\n\n- Iris", _layout(title, paragraphs, button, footer)


# ---- the messages -------------------------------------------------------------------------

IGNORE = "If you didn't ask for this, you can ignore this email."


def confirm_email(name: str, link: str, hours: int) -> Email:
    return _make(
        "Confirm your email for Iris",
        f"Welcome to Iris, {name}!",
        [
            "Iris lets people speak with their eyes, in a voice that carries how they feel.",
            f"Confirm this email address to finish creating the account. The link works for "
            f"{hours} hours.",
        ],
        ("Confirm email", link),
        IGNORE,
    )


def welcome(name: str, app_url: str) -> Email:
    return _make(
        "You're all set with Iris",
        "Your account is ready",
        [
            f"{name}'s Iris account is confirmed.",
            "Next step: calibrate the eyes (about 11 seconds) so Iris learns how they move.",
        ],
        ("Open Iris", f"{app_url}/calibrate"),
        "You're receiving this because an Iris account was created with this email.",
    )


def password_changed(name: str, app_url: str) -> Email:
    return _make(
        "Your Iris password was changed",
        "Password changed",
        [
            f"The password for {name}'s Iris account was just changed, and other devices were "
            "signed out.",
            "If this wasn't you, reset your password right away.",
        ],
        ("Reset password", f"{app_url}/login?forgot=1"),
        "Security notice for your Iris account.",
    )


def password_reset(name: str, link: str, minutes: int) -> Email:
    return _make(
        "Reset your Iris password",
        "Reset your password",
        [
            f"Someone asked to reset the password for {name}'s Iris account.",
            f"Choose a new password with the button below. The link works once, for {minutes} "
            "minutes.",
        ],
        ("Choose a new password", link),
        IGNORE + " Your password stays the same.",
    )


def account_deleted(name: str) -> Email:
    return _make(
        "Your Iris account was deleted",
        "Account deleted",
        [
            f"{name}'s Iris account and all of its data (calibration, emotion model, profile and "
            "voices) were permanently deleted.",
            "If this wasn't you, reply to this email.",
        ],
        None,
        "This is the last email you'll get about this account.",
    )
