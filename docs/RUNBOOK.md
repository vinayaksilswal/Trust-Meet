# Local runbook

- Inspect service state with `docker compose ps` and recent errors with `docker compose logs --tail 100`.
- Request `http://localhost:3000/api/health` for API process health and `http://localhost:3000/api/ready` for schema and Redis readiness.
- Run `docker compose exec api alembic current` to inspect schema version and `docker compose exec api alembic check` to detect schema drift.
- If verification mail fails, confirm Mailpit is running, then use Resend verification.
- If a local call fails, confirm ports 7880–7882 are available and check the LiveKit log. Use Reconnect to request a fresh grant.
- For a local adverse event, turn off conversation and matchmaking flags and stop LiveKit to terminate the local media service.

Production incident staffing, escalation, restore drills and telemetry thresholds are pending.
