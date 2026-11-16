from ipaddress import IPv4Address, IPv4Network
from typing import Literal
from urllib.parse import parse_qs, urlsplit

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)

    environment: Literal["development", "test", "lan", "production"] = "development"
    web_origin: str = "http://localhost:3000"
    database_url: str = "postgresql+psycopg://conviya:conviya@127.0.0.1:5432/conviya"
    redis_url: str = "redis://127.0.0.1:6379/0"
    smtp_host: str = "127.0.0.1"
    smtp_port: int = 1025
    smtp_sender: str = "no-reply@conviya.local"
    smtp_starttls: bool = False
    smtp_username: str = ""
    smtp_password: str = ""
    enable_dev_age_assurance: bool = False
    enable_conversations: bool = False
    enable_matchmaking: bool = False
    enable_private_rooms: bool = False
    lan_skip_email_verification: bool = False
    public_conversations: bool = False
    veriff_api_url: str = "https://stationapi.veriff.com"
    veriff_api_key: str = ""
    veriff_shared_secret: str = ""
    web_proxy_secret: str = ""
    livekit_api_url: str = "http://127.0.0.1:7880"
    livekit_ws_url: str = "ws://localhost:7880"
    livekit_api_key: str = "devkey"
    livekit_api_secret: str = "secret"

    @model_validator(mode="after")
    def enforce_launch_gates(self):
        if self.lan_skip_email_verification and self.environment != "lan":
            raise ValueError("Skipping email verification is available only in LAN testing.")
        if self.public_conversations and self.environment != "production":
            raise ValueError("Public conversations require production settings.")
        origin = urlsplit(self.web_origin)
        if origin.path or origin.query or origin.fragment or not origin.hostname or origin.username:
            raise ValueError("WEB_ORIGIN must be an origin without a trailing slash.")
        if (self.enable_matchmaking or self.enable_private_rooms) and not self.enable_conversations:
            raise ValueError("Matchmaking and private rooms require conversations.")
        if self.environment == "production":
            if origin.scheme != "https" or not self.smtp_starttls or not self.smtp_username or not self.smtp_password:
                raise ValueError("Production requires an HTTPS web origin and authenticated TLS mail.")
            if self.enable_dev_age_assurance or (self.enable_conversations and not self.public_conversations):
                raise ValueError("Production conversations require approved age assurance and media enforcement.")
            if len(self.web_proxy_secret) < 32:
                raise ValueError("Production requires a dedicated web proxy secret.")
            if self.public_conversations:
                veriff = urlsplit(self.veriff_api_url)
                if (veriff.scheme != "https" or not veriff.hostname or not veriff.hostname.endswith(".veriff.com")
                        or veriff.netloc != veriff.hostname or veriff.path or veriff.query or veriff.fragment
                        or not self.veriff_api_key or not self.veriff_shared_secret):
                    raise ValueError("Public conversations require a Veriff identity verification integration.")
                ws = urlsplit(self.livekit_ws_url)
                if (ws.scheme != "wss" or not ws.hostname or not ws.hostname.endswith(".livekit.cloud")
                        or ws.netloc != ws.hostname or ws.path or ws.query or ws.fragment
                        or self.livekit_api_url != f"https://{ws.hostname}"
                        or len(self.livekit_api_secret) < 32 or self.livekit_api_key in {"", "devkey"}):
                    raise ValueError("Public conversations require a dedicated LiveKit Cloud project.")
                db = urlsplit(self.database_url)
                if db.scheme != "postgresql+psycopg" or parse_qs(db.query).get("sslmode") != ["verify-full"]:
                    raise ValueError("Public conversations require verified PostgreSQL TLS.")
                redis = urlsplit(self.redis_url)
                redis_options = parse_qs(redis.query)
                if (redis.scheme != "rediss" or
                        redis_options.get("ssl_cert_reqs", ["required"]) != ["required"] or
                        redis_options.get("ssl_check_hostname", ["true"]) != ["true"]):
                    raise ValueError("Public conversations require verified Redis TLS.")
        elif self.environment == "lan":
            private_networks = ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
            try:
                address = IPv4Address(origin.hostname)
            except ValueError as error:
                raise ValueError("LAN testing requires a private IPv4 address.") from error
            if origin.scheme != "https" or not any(address in IPv4Network(network) for network in private_networks):
                raise ValueError("LAN testing requires HTTPS on a private IPv4 address.")
            if self.livekit_ws_url != f"wss://{origin.netloc}" or len(self.livekit_api_secret) < 32:
                raise ValueError("LAN testing requires same-origin encrypted signaling and a dedicated media key.")
        elif origin.scheme != "http" or origin.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("Development and test origins must use loopback HTTP.")
        return self


settings = Settings()
