import asyncio
import logging
import os

from aiohttp import web

import webapp

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("main")


async def start_web(app, port):
    runner = web.AppRunner(app)
    await runner.setup()
    try:
        await web.TCPSite(runner, host="0.0.0.0", port=port).start()
    except OSError as exc:
        await runner.cleanup()
        log.warning("Порт %s занят (%s). Веб-сервер пропущен, работает только бот.", port, exc)
        return False
    log.info("Сайт и API запущены на http://0.0.0.0:%s", port)
    return True


async def main():
    port = int(os.getenv("PORT", "8080"))
    http_app = webapp.create_app()
    web_started = await start_web(http_app, port)
    if web_started:
        webapp.start_background(http_app)

    if not os.getenv("BOT_TOKEN"):
        log.error("BOT_TOKEN не задан — бот не запущен.")
        while True:
            await asyncio.sleep(86400)

    import bot

    await bot.setup()
    try:
        await bot.dp.start_polling(bot.bot)
    finally:
        await bot.stop()


if __name__ == "__main__":
    asyncio.run(main())
