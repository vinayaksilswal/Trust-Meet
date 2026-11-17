import asyncio
from datetime import timedelta
from email.message import EmailMessage
import json
import logging
import smtplib
import ssl
from typing import Annotated
from urllib.error import HTTPError
from urllib.request import Request as MailRequest, urlopen

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, StringConstraints
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .models import AccountToken, LoginSession, User
from .runtime import client_key, database, digest, new_token, now, throttle


router = APIRouter(prefix="/auth", tags=["identity"])
logger = logging.getLogger(__name__)
Db = Annotated[AsyncSession, Depends(database)]
Password = Annotated[str, StringConstraints(min_length=12, max_length=128)]
Token = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{43}$")]
hasher = PasswordHasher()
dummy_hash = hasher.hash(new_token())
hash_slots = asyncio.Semaphore(2)
session_lifetime = timedelta(hours=12)
secure_cookie = settings.environment in {"lan", "production"}
cookie_name = "__Host-conviya" if secure_cookie else "conviya"


class Credentials(BaseModel):
    email: EmailStr
    password: Password


class Registration(Credentials):
    display_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=60)]


class Address(BaseModel):
    email: EmailStr


class TokenInput(BaseModel):
    token: Token


class PasswordReset(TokenInput):
    password: Password


def send_password_reset(email: str, token: str):
    subject = "Reset your Trust Meet password"
    body = (
        "Open this link to reset your Trust Meet password.\n\n"
        f"{settings.web_origin}/account/reset#{token}\n\n"
        "If you did not request this, you can ignore this message."
    )
    resend_key = settings.resend_key
    if resend_key:
        request = MailRequest(
            "https://api.resend.com/emails",
            data=json.dumps({"from": settings.smtp_sender, "to": [email], "subject": subject, "text": body}).encode(),
            headers={"Authorization": f"Bearer {resend_key}", "Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(request, timeout=5):
            return

    if settings.environment == "production" and not (settings.smtp_starttls and settings.smtp_username and settings.smtp_password):
        raise OSError("Authenticated password reset mail is not configured.")

    message = EmailMessage()
    message["From"] = settings.smtp_sender
    message["To"] = email
    message["Subject"] = subject
    message.set_content(body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=5) as smtp:
        if settings.smtp_starttls:
            smtp.starttls(context=ssl.create_default_context())
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(message)


async def issue_password_reset(db: AsyncSession, user: User):
    token = new_token()
    db.add(AccountToken(token_hash=digest(token), user_id=user.id, purpose="reset", expires_at=now() + timedelta(minutes=30)))
    await db.commit()
    try:
        await asyncio.to_thread(send_password_reset, user.email, token)
    except (OSError, smtplib.SMTPException) as err:
        provider_status = err.code if isinstance(err, HTTPError) else getattr(err, "smtp_code", None)
        logger.warning("Account email delivery failed (%s, provider status %s)", type(err).__name__, provider_status)
        raise HTTPException(503, "Email delivery is temporarily unavailable. Please try again.") from err


async def find_user(db: AsyncSession, email: str):
    return await db.scalar(select(User).where(User.email == email.casefold()))


async def auth_limits(request: Request, email: str, action: str):
    await throttle(f"{action}:ip", client_key(request), 35, 300)
    await throttle(f"{action}:email", email.casefold(), 6, 300)


async def current_user(request: Request, db: Db) -> User:
    token = request.cookies.get(cookie_name, "")
    if len(token) != 43:
        raise HTTPException(401, "Sign in to continue.")
    user = await db.scalar(
        select(User)
        .join(LoginSession)
        .where(LoginSession.token_hash == digest(token), LoginSession.expires_at > now(), User.status == "active")
    )
    if not user:
        raise HTTPException(401, "Your session has expired or is no longer available.")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


@router.get("/options")
async def options():
    return {"email_verification_required": False}


@router.post("/register", status_code=202)
async def register(payload: Registration, request: Request, db: Db):
    await auth_limits(request, payload.email, "register")
    async with hash_slots:
        password_hash = await asyncio.to_thread(hasher.hash, payload.password)
    statement = insert(User).values(
        email=payload.email.casefold(), display_name=payload.display_name, password_hash=password_hash
    )
    await db.execute(statement.on_conflict_do_nothing(index_elements=[User.email]))
    await db.commit()
    return {"message": "You can sign in now with your email and password."}


async def consume_reset_token(db: AsyncSession, token: str):
    token_hash = digest(token)
    account_token = await db.get(AccountToken, token_hash)
    if not account_token or account_token.purpose != "reset":
        raise HTTPException(400, "This link is invalid or expired.")
    user = await db.get(User, account_token.user_id, with_for_update=True)
    if not user or user.status != "active":
        raise HTTPException(400, "This link is invalid or expired.")
    consumed = await db.scalar(
        delete(AccountToken)
        .where(AccountToken.token_hash == token_hash, AccountToken.expires_at > now())
        .returning(AccountToken.token_hash)
    )
    if consumed is None:
        raise HTTPException(400, "This link is invalid or expired.")
    await db.execute(delete(AccountToken).where(AccountToken.user_id == user.id, AccountToken.purpose == "reset"))
    return user


@router.post("/recover", status_code=202)
async def recover(payload: Address, request: Request, db: Db):
    await auth_limits(request, payload.email, "recover")
    user = await find_user(db, payload.email)
    if user and user.status == "active":
        try:
            await issue_password_reset(db, user)
        except HTTPException as err:
            if err.status_code != 503:
                raise
    return {"message": "If this email is registered, check your inbox for a reset link."}


@router.post("/reset")
async def reset(payload: PasswordReset, request: Request, db: Db):
    await throttle("reset", client_key(request), 20, 300)
    user = await consume_reset_token(db, payload.token)
    async with hash_slots:
        user.password_hash = await asyncio.to_thread(hasher.hash, payload.password)
    await db.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
    await db.commit()
    return {"message": "Password updated. Sign in with your new password."}


@router.post("/login")
async def login(payload: Credentials, request: Request, response: Response, db: Db):
    await auth_limits(request, payload.email, "login")
    user = await db.scalar(select(User).where(User.email == payload.email.casefold()).with_for_update())
    try:
        async with hash_slots:
            await asyncio.to_thread(hasher.verify, user.password_hash if user else dummy_hash, payload.password)
    except VerifyMismatchError as err:
        raise HTTPException(401, "Email or password is incorrect.") from err
    if not user or user.status != "active":
        raise HTTPException(401, "Email or password is incorrect.")
    token = new_token()
    prior = request.cookies.get(cookie_name, "")
    if len(prior) == 43:
        await db.execute(delete(LoginSession).where(LoginSession.token_hash == digest(prior)))
    db.add(LoginSession(token_hash=digest(token), user_id=user.id, expires_at=now() + session_lifetime))
    await db.commit()
    response.set_cookie(
        cookie_name, token, max_age=int(session_lifetime.total_seconds()),
        secure=secure_cookie, httponly=True, samesite="strict", path="/",
    )
    return {"message": "Signed in."}


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response, db: Db):
    prior = request.cookies.get(cookie_name, "")
    if len(prior) == 43:
        await db.execute(delete(LoginSession).where(LoginSession.token_hash == digest(prior)))
        await db.commit()
    response.delete_cookie(cookie_name, secure=secure_cookie, httponly=True, samesite="strict")
