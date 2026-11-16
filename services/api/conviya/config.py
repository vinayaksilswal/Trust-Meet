from typing import Literal
from urllib.parse import urlsplit

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
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
        elif origin.scheme != "http" or origin.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("Development and test origins must use loopback HTTP.")
        return self


settings = Settings()
