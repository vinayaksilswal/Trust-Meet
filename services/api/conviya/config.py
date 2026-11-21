from ipaddress import IPv4Address, IPv4Network
from typing import Literal
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

from certifi import where as ca_bundle
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL, make_url


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
    resend_api_key: str = ""
    enable_dev_age_assurance: bool = False
    enable_conversations: bool = False
    enable_matchmaking: bool = False
    enable_private_rooms: bool = False
    public_conversations: bool = False
    web_proxy_secret: str = ""
    livekit_api_url: str = "http://127.0.0.1:7880"
    livekit_ws_url: str = "ws://localhost:7880"
    livekit_api_key: str = "devkey"
    livekit_api_secret: str = "secret"
    media_provider: Literal["livekit", "realtimekit"] = "livekit"
    cloudflare_account_id: str = ""
    cloudflare_realtimekit_app_id: str = ""
    cloudflare_api_token: str = ""
    realtimekit_video_preset: str = "trust_meet_video"
    realtimekit_audio_preset: str = "trust_meet_audio"
    realtimekit_text_preset: str = "trust_meet_text"
    enable_billing: bool = False
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""
    razorpay_plus_plan_id: str = ""
    plus_price_inr: int = 199
    pass_price_1d_inr: int = 999
    pass_price_3d_inr: int = 1999
    pass_price_7d_inr: int = 2999
    # Development has no edge geolocation, so local users report this country.
    dev_country: str = "IN"

    @property
    def database_connection_url(self) -> URL:
        url = make_url(self.database_url)
        if url.query.get("sslmode") == "verify-full" and "sslrootcert" not in url.query:
            return url.update_query_dict({"sslrootcert": ca_bundle()})
        return url

    @property
    def resend_key(self) -> str:
        if self.resend_api_key:
            return self.resend_api_key
        if self.smtp_host.casefold() == "smtp.resend.com" and self.smtp_username == "resend":
            return self.smtp_password
        return ""

    @model_validator(mode="after")
    def enforce_launch_gates(self):
        if self.media_provider == "realtimekit":
            try:
                account_id = UUID(self.cloudflare_account_id)
                UUID(self.cloudflare_realtimekit_app_id)
            except ValueError as exc:
                raise ValueError("RealtimeKit requires valid Cloudflare account and app IDs.") from exc
            if account_id.hex != self.cloudflare_account_id.lower() or not self.cloudflare_api_token.strip():
                raise ValueError("RealtimeKit requires a Cloudflare account ID and API token.")
            presets = {self.realtimekit_video_preset, self.realtimekit_audio_preset, self.realtimekit_text_preset}
            if len(presets) != 3 or not all(preset.strip() for preset in presets):
                raise ValueError("RealtimeKit requires separate text, audio and video presets.")
        if self.enable_billing:
            if not self.razorpay_key_id.startswith(("rzp_test_", "rzp_live_")) or len(self.razorpay_key_secret) < 16:
                raise ValueError("Billing requires a Razorpay key ID and key secret.")
            if len(self.razorpay_webhook_secret) < 16:
                raise ValueError("Billing requires a Razorpay webhook secret.")
            if self.razorpay_plus_plan_id and not self.razorpay_plus_plan_id.startswith("plan_"):
                raise ValueError("RAZORPAY_PLUS_PLAN_ID must be a Razorpay plan ID.")
            if self.razorpay_key_id.startswith("rzp_live_") and self.environment != "production":
                raise ValueError("Live Razorpay keys require production settings.")
            prices = (self.plus_price_inr, self.pass_price_1d_inr, self.pass_price_3d_inr, self.pass_price_7d_inr)
            if not all(1 <= price <= 100_000 for price in prices):
                raise ValueError("Prices must be whole rupee amounts.")
        if self.public_conversations and self.environment != "production":
            raise ValueError("Public conversations require production settings.")
        origin = urlsplit(self.web_origin)
        if origin.path or origin.query or origin.fragment or not origin.hostname or origin.username:
            raise ValueError("WEB_ORIGIN must be an origin without a trailing slash.")
        if (self.enable_matchmaking or self.enable_private_rooms) and not self.enable_conversations:
            raise ValueError("Matchmaking and private rooms require conversations.")
        if self.environment == "production":
            if origin.scheme != "https":
                raise ValueError("Production requires an HTTPS web origin.")
            if self.enable_dev_age_assurance or (self.enable_conversations and not self.public_conversations):
                raise ValueError("Production conversations require approved age assurance and media enforcement.")
            if len(self.web_proxy_secret) < 32:
                raise ValueError("Production requires a dedicated web proxy secret.")
            if self.public_conversations:
                ws = urlsplit(self.livekit_ws_url)
                if self.media_provider == "livekit" and (ws.scheme != "wss" or not ws.hostname or not ws.hostname.endswith(".livekit.cloud")
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
