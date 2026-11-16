# Architecture

Next.js serves the responsive web app and forwards same-origin API traffic to a FastAPI modular monolith. Shared TypeScript contracts validate the API payloads in the web client. The identity, eligibility and conversation modules share an async SQLAlchemy transaction boundary. Alembic owns PostgreSQL schema changes. Redis holds rate limits and transient availability. LiveKit carries participant text and media over WebRTC using room-bound grants.

The API process currently runs a periodic maintenance task for expiration and media cleanup. Transactions and row locks coordinate cleanup across processes. A dedicated worker and production telemetry are later work. The web and API run together locally with isolated infrastructure dependencies defined in Compose.
