import asyncio
import logging
import os
import re

import aiohttp
from aiogram import Bot, Dispatcher
from aiogram import html
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command, CommandStart
from aiogram.types import MenuButtonWebApp, Message, WebAppInfo

import webapp

logging.basicConfig(level=logging.INFO)

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
PAGES_FALLBACK = os.getenv("PAGES_FALLBACK", "https://arturklimcue-svg.github.io/Jelaniya/")


def webapp_url() -> str:
    for env in ("WEBAPP_URL", "SITE_URL", "DOMAIN"):
        v = os.getenv(env, "").strip()
        if v:
            return f"https://{v}" if env == "DOMAIN" else v
    return PAGES_FALLBACK

bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
dp = Dispatcher()

esc = html.quote
URL_RE = re.compile(r"https?://[^\s<>\"']+")


async def ensure_user(message: Message):
    tg_id = str(message.from_user.id)
    uid = await webapp.register_user(tg_id, message.from_user.full_name)
    await webapp.set_chat(uid, message.chat.id)
    return uid


@dp.message(CommandStart())
async def cmd_start(message: Message):
    await ensure_user(message)
    await message.answer(
        "Привет! 👋 Это общий вишлист подарков для двоих.\n\n"
        "Как пользоваться:\n"
        "🎁 Откройте вишлист в меню — загадывайте желания и смотрите список партнёра\n"
        "🔗 Просто перешлите сюда ссылку на вещь — я добавлю её в ваш вишлист\n"
        "🔔 Бот пришлёт уведомление, когда партнёр добавит подарок\n"
    )
    url = webapp_url()
    if url:
        logging.info("Кнопка «Вишлист» ведёт на: %s", url)
        try:
            await bot.set_chat_menu_button(
                chat_id=message.chat.id,
                menu_button=MenuButtonWebApp(text="Вишлист 🎁", web_app=WebAppInfo(url=url)),
            )
        except TelegramBadRequest:
            pass


@dp.message(Command("help"))
async def cmd_help(message: Message):
    await message.answer(
        "📖 Как пользоваться:\n"
        "• Добавляйте подарки в вишлист в мини-приложении\n"
        "• Перешлите ссылку сюда — она попадёт в ваш вишлист\n"
        "• Партнёр увидит ваш список, а вы — его\n"
        "• Покупку и вручение отмечайте в приложении\n"
        "• Бот пришлёт уведомление, когда партнёр добавит подарок"
    )


@dp.message()
async def forward_link(message: Message):
    if not message.text or message.text.startswith("/"):
        return
    m = URL_RE.search(message.text)
    if not m:
        return
    url = m.group(0)
    uid = await ensure_user(message)
    session = dp["session"]
    try:
        title = await webapp.fetch_og_title(session, url)
    except Exception:
        title = ""
    title = title or url
    await webapp.add_item(uid, {"title": title, "link": url})
    await message.answer(f"Добавил в ваш вишлист 🎁\n<b>{esc(title)}</b>")


def _snapshot(data):
    return {(i["id"], i["userId"], i.get("bought"), i.get("gifted")) for i in data["wishlist"]}


async def notify_other(data, owner_uid, text):
    other = data["users"].get(owner_uid)
    chat = data["chats"].get(other)
    if not chat:
        return
    try:
        await bot.send_message(chat, text)
    except Exception:
        pass


async def notify_changes(data, prev, snap):
    for iid, owner, _bought, _gifted in snap - prev:
        it = next((x for x in data["wishlist"] if x["id"] == iid), None)
        if not it or it.get("surprise"):
            continue
        await notify_other(data, owner,
            f"🎁 <b>{esc(webapp.display_name(data, owner))}</b> добавил(а) подарок: <b>{esc(it['title'])}</b>")


async def notifier_loop():
    prev = None
    await asyncio.sleep(3)
    while True:
        try:
            data = await webapp._load()
            snap = _snapshot(data)
            if prev is not None and snap != prev:
                await notify_changes(data, prev, snap)
            prev = snap
        except Exception:
            logging.exception("notifier")
        await asyncio.sleep(45)


async def setup():
    dp["session"] = aiohttp.ClientSession()
    asyncio.create_task(notifier_loop())


async def stop():
    try:
        await dp["session"].close()
    except Exception:
        pass
    try:
        await bot.session.close()
    except Exception:
        pass
