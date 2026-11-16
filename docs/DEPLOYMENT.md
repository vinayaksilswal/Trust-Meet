# Deployment

Local Compose launches PostgreSQL, Redis, Mailpit, LiveKit, a migration job, the API and Next.js. The API, Redis, PostgreSQL and SMTP traffic use the internal Compose network. The web app, local mailbox and LiveKit ports publish on loopback. Apply Alembic migrations as a release job before routing traffic to a new API version.

The planned AWS layout uses a public TLS load balancer for Next.js, private application tasks for FastAPI, RDS PostgreSQL, managed Redis, S3, Secrets Manager and CloudWatch. LiveKit Cloud handles external media rooms. A production stack, credentials, infrastructure-as-code apply, backups, alerts and rollback rehearsal are pending.
