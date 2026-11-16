import asyncio
from datetime import timedelta
from email.message import EmailMessage
import smtplib
import ssl
from typing import Annotated

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
Db = Annotated[AsyncSession, Depends(database)]
Password = Annotated[str, StringConstraints(min_length=12, max_length=128)]
Token = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{43}$")]
hasher = PasswordHasher()
dummy_hash = hasher.hash(new_token())
hash_slots = asyncio.Semaphore(2)
session_lifetime = timedelta(hours=12)
cookie_name = "__Host-conviya" if settings.environment == "production" else "conviya"


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


def send_mail(email: str, token: str, purpose: str):
    action = "verify" if purpose == "verify" else "reset"
    message = EmailMessage()
    message["From"] = settings.smtp_sender
    message["To"] = email
    message["Subject"] = "Verify your Conviya email" if action == "verify" else "Reset your Conviya password"
    message.set_content(
        f"Open this link to {action} your Conviya account.\n\n"
        f"{settings.web_origin}/account/{action}#{token}\n\n"
        "If you did not request this, you can ignore this message."
    )
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=5) as smtp:
        if settings.smtp_starttls:
            smtp.starttls(context=ssl.create_default_context())
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(message)


async def issue_account_link(db: AsyncSession, user: User, purpose: str):
    token = new_token()
    lifetime = timedelta(hours=12) if purpose == "verify" else timedelta(minutes=30)
    db.add(AccountToken(token_hash=digest(token), user_id=user.id, purpose=purpose, expires_at=now() + lifetime))
    await db.commit()
    try:
        await asyncio.to_thread(send_mail, user.email, token, purpose)
    except (OSError, smtplib.SMTPException) as err:
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


@router.post("/register", status_code=202)
async def register(payload: Registration, request: Request, db: Db):
    await auth_limits(request, payload.email, "register")
    async with hash_slots:
        password_hash = await asyncio.to_thread(hasher.hash, payload.password)
    statement = insert(User).values(
        email=payload.email.casefold(), display_name=payload.display_name, password_hash=password_hash
    )
    user = await db.scalar(statement.on_conflict_do_nothing(index_elements=[User.email]).returning(User))
    if user:
        await issue_account_link(db, user, "verify")
    return {"message": "Check your inbox for an email verification link."}


@router.post("/resend", status_code=202)
async def resend(payload: Address, request: Request, db: Db):
    await auth_limits(request, payload.email, "resend")
    user = await find_user(db, payload.email)
    if user and user.status == "active" and user.email_verified_at is None:
        await issue_account_link(db, user, "verify")
    return {"message": "If the address needs verification, a link is on its way."}


async def consume_token(db: AsyncSession, token: str, purpose: str):
    token_hash = digest(token)
    account_token = await db.get(AccountToken, token_hash)
    if not account_token or account_token.purpose != purpose:
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
    await db.execute(delete(AccountToken).where(AccountToken.user_id == user.id, AccountToken.purpose == purpose))
    return user


@router.post("/verify")
async def verify(payload: TokenInput, request: Request, db: Db):
    await throttle("verify", client_key(request), 35, 300)
    user = await consume_token(db, payload.token, "verify")
    user.email_verified_at = now()
    await db.commit()
    return {"message": "Email verified. You can now sign in."}


@router.post("/recover", status_code=202)
async def recover(payload: Address, request: Request, db: Db):
    await auth_limits(request, payload.email, "recover")
    user = await find_user(db, payload.email)
    if user and user.status == "active" and user.email_verified_at:
        await issue_account_link(db, user, "reset")
    return {"message": "If the address has a verified account, a reset link is on its way."}


@router.post("/reset")
async def reset(payload: PasswordReset, request: Request, db: Db):
    await throttle("reset", client_key(request), 20, 300)
    user = await consume_token(db, payload.token, "reset")
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
    if user.email_verified_at is None:
        raise HTTPException(403, "Verify your email before signing in.")
    token = new_token()
    prior = request.cookies.get(cookie_name, "")
    if len(prior) == 43:
        await db.execute(delete(LoginSession).where(LoginSession.token_hash == digest(prior)))
    db.add(LoginSession(token_hash=digest(token), user_id=user.id, expires_at=now() + session_lifetime))
    await db.commit()
    response.set_cookie(
        cookie_name, token, max_age=int(session_lifetime.total_seconds()),
        secure=settings.environment == "production", httponly=True, samesite="strict", path="/",
    )
    return {"message": "Signed in."}


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response, db: Db):
    prior = request.cookies.get(cookie_name, "")
    if len(prior) == 43:
        await db.execute(delete(LoginSession).where(LoginSession.token_hash == digest(prior)))
        await db.commit()
    response.delete_cookie(cookie_name, secure=settings.environment == "production", httponly=True, samesite="strict")
