"""Bring the database schema up to head.

Run as its own step before the maintenance worker starts (see `worker_entry`), never from
inside a running event loop — Alembic's env.py starts its own loop. A Postgres advisory lock
serializes the rare case of two daemons overlapping during a deploy, so only one upgrade runs
at a time and the other sees head and does nothing. The upgrade is idempotent: at head it is a
no-op in well under a second.
"""

import logging
from pathlib import Path

import psycopg
from alembic import command
from alembic.config import Config

from .config import settings


logger = logging.getLogger(__name__)
# A fixed key, distinct from the matchmaking transition lock (70211601).
MIGRATION_LOCK = 70211602
ALEMBIC_INI = Path(__file__).resolve().parent.parent / "alembic.ini"


def libpq_dsn() -> str:
    # Alembic connects through SQLAlchemy; the advisory-lock connection uses libpq directly.
    return settings.database_connection_url.set(drivername="postgresql").render_as_string(hide_password=False)


def upgrade_to_head() -> None:
    config = Config(str(ALEMBIC_INI))
    with psycopg.connect(libpq_dsn(), connect_timeout=10, autocommit=True) as lock:
        lock.execute("SELECT pg_advisory_lock(%s)", (MIGRATION_LOCK,))
        try:
            logger.info("Applying database migrations to head")
            command.upgrade(config, "head")
            logger.info("Database schema is up to date")
        finally:
            lock.execute("SELECT pg_advisory_unlock(%s)", (MIGRATION_LOCK,))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    upgrade_to_head()
