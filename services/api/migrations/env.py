import asyncio

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from conviya.config import settings
from conviya.event_loop import factory
from conviya.models import Base
from conviya import rooms_models  # Registers private-room tables with Base.metadata.


def migrate(connection):
    context.configure(connection=connection, target_metadata=Base.metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def online():
    engine = create_async_engine(settings.database_connection_url)
    try:
        async with engine.connect() as connection:
            await connection.run_sync(migrate)
    finally:
        await engine.dispose()


if context.is_offline_mode():
    context.configure(url=settings.database_url, target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    with asyncio.Runner(loop_factory=factory) as runner:
        runner.run(online())
