import asyncio
import os

from aiohttp import web

import bot
import webapp


async def main():
    http_app = webapp.create_app()
    webapp.start_background(http_app)
    runner = web.AppRunner(http_app)
    await runner.setup()
    port = int(os.getenv("PORT", "8080"))
    site = web.TCPSite(runner, "0.0.0.0", port)
    await site.start()
    print(f"Web app: http://0.0.0.0:{port}")

    await bot.setup()
    try:
        await bot.dp.start_polling(bot.bot)
    finally:
        await bot.stop()
        await runner.cleanup()


if __name__ == "__main__":
    asyncio.run(main())
