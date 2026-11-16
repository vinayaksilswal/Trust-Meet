import asyncio
import sys


def factory():
    if sys.platform == "win32":
        return asyncio.SelectorEventLoop()
    return asyncio.new_event_loop()
