"""Daemon entrypoint for the maintenance worker.

Applies database migrations once, then runs the maintenance loop. Because Vercel runs this as a
single daemon instance that restarts on every deploy, this is where the schema is kept in step
with the code, so a deploy can no longer leave the database behind. Set TRUST_MEET_SKIP_MIGRATE=1
to run the loop without migrating (for example when migrations are applied by another process).
"""

import asyncio
import logging
import os

from .event_loop import factory
from .maintenance import run_worker
from .migrate import upgrade_to_head


def main():
    logging.basicConfig(level=logging.INFO)
    if os.getenv("TRUST_MEET_SKIP_MIGRATE") != "1":
        upgrade_to_head()
    with asyncio.Runner(loop_factory=factory) as runner:
        runner.run(run_worker())


if __name__ == "__main__":
    main()
