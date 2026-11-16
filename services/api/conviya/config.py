from ipaddress import IPv4Address, IPv4Network
from typing import Literal
from urllib.parse import urlsplit

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

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
    livekit_api_url: str = "http://127.0.0.1:7880"
    livekit_ws_url: str = "ws://localhost:7880"
    livekit_api_key: str = "devkey"
    livekit_api_secret: str = "secret"

    @model_validator(mode="after")
    def enforce_launch_gates(self):
        origin = urlsplit(self.web_origin)
        if origin.path or origin.query or origin.fragment or not origin.hostname or origin.username:
            raise ValueError("WEB_ORIGIN must be an origin without a trailing slash.")
        if (self.enable_matchmaking or self.enable_private_rooms) and not self.enable_conversations:
            raise ValueError("Matchmaking and private rooms require conversations.")
        if self.environment == "production":
            if origin.scheme != "https" or not self.smtp_starttls or not self.smtp_username or not self.smtp_password:
                raise ValueError("Production requires an HTTPS web origin and authenticated TLS mail.")
            if self.enable_dev_age_assurance or self.enable_conversations:
                raise ValueError("Production conversations require approved age assurance and media enforcement.")
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
