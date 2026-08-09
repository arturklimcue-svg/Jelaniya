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


def webapp_url() -> str:
    for env in ("WEBAPP_URL", "SITE_URL", "DOMAIN"):
        v = os.getenv(env, "").strip()
        if v:
            return f"https://{v}" if env == "DOMAIN" else v
    return ""

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
        "🔔 Бот пришлёт уведомления, когда партнёр добавит или купит подарок\n"
        "📅 Напомню о важных датах"
    )
    url = webapp_url()
    if url:
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
        "• Бот напомнит о важных датах и пришлёт открытку"
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
    items = [(i["id"], i["userId"], i.get("bought"), i.get("gifted")) for i in data["wishlist"]]
    hist = [(i["id"], i.get("giftedBy")) for i in data["history"]]
    return items, hist


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
    prev_items = {i[0]: i for i in prev[0]}
    cur_items = {i[0]: i for i in snap[0]}
    prev_hist = {i[0]: i for i in prev[1]}
    cur_hist = {i[0]: i for i in snap[1]}
    for iid, rec in cur_items.items():
        _, owner, bought, gifted = rec
        it = next((x for x in data["wishlist"] if x["id"] == iid), None)
        if not it:
            continue
        if iid not in prev_items:
            if not it.get("surprise"):
                await notify_other(data, owner,
                    f"🎁 <b>{esc(webapp.display_name(data, owner))}</b> добавил(а) подарок: <b>{esc(it['title'])}</b>")
        else:
            old = prev_items[iid]
            if not old[2] and it.get("bought"):
                buyer = esc(webapp.display_name(data, it.get("boughtBy")) or "кто-то")
                await notify_other(data, owner, f"🛍 <b>{buyer}</b> купил(а): <b>{esc(it['title'])}</b> 🎉")
            if not old[3] and it.get("gifted"):
                await notify_other(data, owner, f"🎀 Подарок вручён: <b>{esc(it['title'])}</b>!")
    for hid in cur_hist:
        if hid in prev_hist:
            continue
        it = next((x for x in data["history"] if x["id"] == hid), None)
        if it:
            await notify_other(data, it["userId"], f"🎀 <b>{esc(it['title'])}</b> — подарок вручён! История пополнена.")


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


async def check_reminders():
    async with webapp.DATA_LOCK:
        data = webapp.load_data()
        sent = data.setdefault("remindersSent", {})
        now = webapp.now_ms()
        changed = False
        for ev in data["events"]:
            diff_days = round((ev["dateTs"] - now) / 86400000)
            if diff_days not in (0, 1, 2, 3, 7):
                continue
            key = f"{ev['id']}:{diff_days}"
            keys = sent.get(ev["id"], [])
            if key in keys:
                continue
            keys.append(key)
            sent[ev["id"]] = keys
            changed = True
            if diff_days == 0:
                text = f"🎉 <b>Сегодня: {esc(ev['title'])}!</b>\n{esc(ev.get('card', '')) or 'С праздником! 🥳'}"
            elif diff_days == 1:
                text = f"⏰ <b>Завтра: {esc(ev['title'])}</b> — не забудьте про подарок!"
            else:
                text = f"🗓 Через {diff_days} дн: <b>{esc(ev['title'])}</b>"
            for uid in list(data["chats"]):
                try:
                    await bot.send_message(data["chats"][uid], text)
                except Exception:
                    pass
        if changed:
            webapp.save_data(data)


async def reminder_loop():
    await asyncio.sleep(5)
    while True:
        try:
            await check_reminders()
        except Exception:
            logging.exception("reminders")
        await asyncio.sleep(60)


async def setup():
    dp["session"] = aiohttp.ClientSession()
    asyncio.create_task(notifier_loop())
    asyncio.create_task(reminder_loop())


async def stop():
    try:
        await dp["session"].close()
    except Exception:
        pass
    try:
        await bot.session.close()
    except Exception:
        pass
