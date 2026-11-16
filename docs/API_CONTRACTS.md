# API contracts

The same-origin web proxy exposes FastAPI under `/api`. The OpenAPI document is available at `/api/openapi.json`. Protected routes use an HttpOnly cookie backed by a server-side session. Browser mutations must come from the configured origin.

- `/auth/*` handles registration, verification, sign-in, recovery, reset and logout.
- `/me` returns the authenticated profile, eligibility and development feature availability. `POST /eligibility` submits the local age check.
- `GET /conversations/current` returns the user's open conversation or invitation.
- `POST /conversations/invitations` issues a single-use invitation. `POST /conversations/invitations/accept` redeems its secret.
- `/conversations/{id}` supports participant-scoped status, consent, media grants, end, report and block.
- `POST /matchmaking/search` creates or renews an availability lease. `POST /matchmaking/cancel` releases the specified lease.
- `/rooms` lists or creates private rooms. `POST /rooms/join` redeems an invitation. Media grants require admission and an open schedule. Host actions manage invitations, lock, approval, mute, removal and closure.
- `/health` checks API process health. `/ready` checks PostgreSQL schema availability and Redis.
