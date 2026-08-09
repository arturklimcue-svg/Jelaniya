import asyncio
import hmac
import json
import os
import time
from collections import deque
from hashlib import sha256
from pathlib import Path
from urllib.parse import unquote_plus, urlparse

import aiohttp
from aiohttp import web

BASE_DIR = Path(__file__).resolve().parent
DATA_PATH = BASE_DIR / "data.json"
UPLOADS_DIR = BASE_DIR / "uploads"

BOT_TOKEN = os.getenv("BOT_TOKEN", "BOT_TOKEN")
GITHUB_USER = os.getenv("GITHUB_USER", "")

DATA_LOCK = asyncio.Lock()

DEFAULT_DATA = {
    "users": {},
    "names": {},
    "tg": {},
    "wishlist": [],
    "ideas": [],
    "history": [],
    "events": [],
    "categories": {},
    "backgrounds": [],
    "backgroundIndex": 0,
    "chats": {},
}

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
UPLOAD_RATE_LIMIT = 20
UPLOAD_WINDOW = 60

CONTENT_TYPES = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "gif": "image/gif",
    "webp": "image/webp",
    "m4a": "audio/mp4",
    "ogg": "audio/ogg",
    "opus": "audio/ogg",
    "webm": "audio/webm",
}
IMAGE_EXT = ("jpg", "jpeg", "png", "gif", "webp")
AUDIO_EXT = ("m4a", "ogg", "opus", "webm")


def now_ms():
    return int(time.time() * 1000)


def load_data():
    if DATA_PATH.exists():
        try:
            data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
            for k, v in DEFAULT_DATA.items():
                data.setdefault(k, [] if isinstance(v, list) else (dict(v) if isinstance(v, dict) else v))
            data["wishlist"] = [normalize_item(x) for x in data["wishlist"]]
            data["ideas"] = [normalize_item(x) for x in data["ideas"]]
            data["history"] = [normalize_item(x) for x in data["history"]]
            return data
        except (json.JSONDecodeError, OSError):
            pass
    return json.loads(json.dumps(DEFAULT_DATA))


def save_data(data):
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = DATA_PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, DATA_PATH)


def new_id():
    return f"{int(time.time() * 1000)}"


def sanitize_url(url):
    if not url or not url.strip():
        return ""
    url = url.strip()
    if "://" not in url:
        url = "https://" + url
    return url


def normalize_item(it):
    base = {
        "id": "", "userId": "", "title": "", "link": "", "image": "",
        "category": "", "createdAt": 0, "price": "", "priority": "",
        "type": "gift", "bought": False, "boughtBy": "", "boughtAt": 0,
        "gifted": False, "giftedBy": "", "giftedAt": 0, "giftedPhoto": "",
        "surprise": False, "revealDate": 0, "note": "", "pinned": False,
        "reactions": {}, "voice": "",
    }
    base.update(it or {})
    base["reactions"] = dict(base.get("reactions") or {})
    return base


def user_uid(data, tg_user):
    return data.get("tg", {}).get(tg_user)


def display_name(data, uid):
    return data.get("names", {}).get(uid, "?")


def is_partner(data, uid_a, uid_b):
    return data["users"].get(uid_a) == uid_b


def partner_of(data, uid):
    return data["users"].get(uid)


async def transaction(fn):
    async with DATA_LOCK:
        data = load_data()
        result = fn(data)
        save_data(data)
        return result


async def register_user(tg_id, name):
    async with DATA_LOCK:
        data = load_data()
        uid = data["tg"].get(tg_id)
        if not uid:
            uid = new_id()
            data["tg"][tg_id] = uid
            paired = set(data["users"]) | set(data["users"].values())
            solo = [u for u in data["names"] if u not in paired]
            if solo:
                other = solo[0]
                data["users"][uid] = other
                data["users"][other] = uid
        data["names"][uid] = (name or "я").strip()[:60] or "я"
        save_data(data)
        return uid


async def set_chat(uid, chat_id):
    async with DATA_LOCK:
        data = load_data()
        data["chats"][uid] = int(chat_id)
        save_data(data)


async def add_item(uid, body, kind="wishlist"):
    async with DATA_LOCK:
        data = load_data()
        item = _build_item(data, uid, body)
        lst = data["wishlist"] if kind == "wishlist" else data["ideas"]
        lst.insert(0, item)
        save_data(data)
        return item


def validate_init_data(query_string):
    if not BOT_TOKEN or BOT_TOKEN == "BOT_TOKEN":
        return {}
    try:
        values = dict(x.split("=", 1) for x in query_string.split("&"))
    except ValueError:
        return {}
    for k in values:
        values[k] = unquote_plus(values[k])
    hash_ = values.pop("hash", "")
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(values.items()))
    secret = sha256(BOT_TOKEN.encode()).digest()
    calc = hmac.new(secret, data_check_string.encode(), sha256).hexdigest()
    if not hmac.compare_digest(calc, hash_):
        return {}
    return values


def auth_user(request):
    query = request.query
    if "user" in query:
        try:
            return json.loads(query["user"]), query.get("_nonce", "")
        except (ValueError, TypeError):
            return None, ""
    v = validate_init_data(query.get("initData", ""))
    if not v:
        return None, ""
    try:
        return json.loads(v.get("user", "{}")), v.get("_nonce", "")
    except (ValueError, TypeError):
        return None, ""


def deny(reason="Для доступа зайдите через бота 😉"):
    return web.json_response({"ok": False, "error": reason}, status=403)


def api(data, **kw):
    kw.setdefault("ok", True)
    return web.json_response(kw)


def now_display():
    return time.strftime("%d.%m %H:%M")


async def read_json(request):
    try:
        return await request.json(), None
    except (ValueError, json.JSONDecodeError):
        return None, "Неверный JSON"
    except Exception:
        return None, "Слишком большое тело запроса"


def _resize_file(path, size=1200):
    try:
        from PIL import Image
        im = Image.open(path)
        im.thumbnail((size, size), Image.LANCZOS)
        im = im.convert("RGB")
        im.save(path, "JPEG", quality=88)
    except Exception:
        pass


def _check_image_magic(head):
    if head[:3] in (b"\xff\xd8\xff", b"\x89PN"):
        return True
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return True
    if head[:4] == b"GIF8":
        return True
    return False


def _upload_rate_ok(request):
    log = request.app["upload_log"]
    now = time.time()
    while log and now - log[0] > UPLOAD_WINDOW:
        log.popleft()
    if len(log) >= UPLOAD_RATE_LIMIT:
        return False
    log.append(now)
    return True


async def uploads_handler(request):
    user, _ = auth_user(request)
    if not user:
        return deny()
    if not _upload_rate_ok(request):
        return web.json_response({"ok": False, "error": "Слишком много загрузок, подождите"}, status=429)
    reader = await request.multipart()
    file_bytes = bytearray()
    fname = ""
    field = await reader.next()
    if not field:
        return web.json_response({"ok": False, "error": "Файл не отправлен"}, status=400)
    fname = field.filename or ""
    if fname:
        fname = Path(fname).name
    while True:
        chunk = await field.read_chunk()
        if not chunk:
            break
        file_bytes.extend(chunk)
        if len(file_bytes) > MAX_UPLOAD_BYTES:
            return web.json_response({"ok": False, "error": "Файл больше 5 МБ"}, status=400)
    if not file_bytes:
        return web.json_response({"ok": False, "error": "Пустой файл"}, status=400)
    ext = (Path(fname).suffix or "").lstrip(".").lower()
    content_type = field.headers.get("Content-Type", "").lower()
    if ext not in CONTENT_TYPES:
        return web.json_response({"ok": False, "error": "Не поддерживаемый формат"}, status=400)
    head = bytes(file_bytes[:16])
    if ext in IMAGE_EXT and not _check_image_magic(head):
        return web.json_response({"ok": False, "error": "Это не изображение"}, status=400)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    uid = f"{int(time.time() * 1000)}{os.urandom(3).hex()}"
    fname = f"{uid}.{ext}"
    fpath = UPLOADS_DIR / fname
    try:
        with open(fpath, "wb") as f:
            f.write(file_bytes)
    except OSError:
        return web.json_response({"ok": False, "error": "Не удалось сохранить файл"}, status=500)
    if ext in IMAGE_EXT:
        _resize_file(fpath)
    return web.json_response({"ok": True, "url": "/uploads/" + fname})


def remove_upload(url):
    if not url or not url.startswith("/uploads/"):
        return
    try:
        (UPLOADS_DIR / Path(urlparse(url).path).name).unlink(missing_ok=True)
    except OSError:
        pass


def api_data(data, uid):
    partner = partner_of(data, uid)
    now = now_ms()

    def visible(it):
        if it.get("surprise") and it.get("revealDate") and it["revealDate"] > now:
            if it.get("userId") == uid:
                return False
        return True

    return {
        "ok": True,
        "users": data["users"],
        "names": data["names"],
        "wishlist": [it for it in data["wishlist"] if visible(it)],
        "ideas": data["ideas"],
        "history": data["history"],
        "events": data["events"],
        "categories": data["categories"],
        "backgrounds": data["backgrounds"],
        "backgroundIndex": data["backgroundIndex"],
        "serverTime": now,
        "partner": partner,
        "me": uid,
        "now": now_display(),
    }


async def api_data_handler(request):
    user, _ = auth_user(request)
    if not user:
        return deny()
    data = await _load()
    uid = user_uid(data, str(user.get("id")))
    if not uid:
        return deny()
    return api(data, **api_data(data, uid))


def _build_item(data, uid, body):
    item = {
        "id": new_id(),
        "userId": uid,
        "title": str(body.get("title") or "").strip()[:200],
        "link": sanitize_url(body.get("link") or ""),
        "image": str(body.get("image") or "").strip()[:2000],
        "category": str(body.get("category") or "").strip()[:60],
        "createdAt": now_ms(),
        "price": str(body.get("price") or "").strip()[:30],
        "priority": body.get("priority") if body.get("priority") in ("must", "want", "maybe") else "",
        "type": "certificate" if body.get("type") == "certificate" else "gift",
        "bought": False, "boughtBy": "", "boughtAt": 0,
        "gifted": False, "giftedBy": "", "giftedAt": 0, "giftedPhoto": "",
        "surprise": bool(body.get("surprise")), "revealDate": int(body.get("revealDate") or 0),
        "note": str(body.get("note") or "").strip()[:1000],
        "pinned": bool(body.get("pinned")),
        "reactions": {}, "voice": str(body.get("voice") or "").strip()[:2000],
    }
    item = normalize_item(item)
    if item.get("revealDate") and item["revealDate"] <= now_ms():
        item["revealDate"] = 0
    return item


async def add_handler(request):
    user, _ = auth_user(request)
    if not user:
        return deny()
    data = await _load()
    uid = user_uid(data, str(user.get("id")))
    if not uid:
        return deny()
    body, err = await read_json(request)
    if err:
        return web.json_response({"ok": False, "error": err}, status=400)
    kind = body.get("kind", "wishlist")
    if kind not in ("wishlist", "ideas"):
        kind = "wishlist"
    lst = data["wishlist"] if kind == "wishlist" else data["ideas"]
    item = _build_item(data, uid, body)
    if not item["title"]:
        return web.json_response({"ok": False, "error": "Название не заполнено"}, status=400)
    lst.insert(0, item)
    await _save(data)
    return api(data, item=item)


def _find_item(data, kind, item_id):
    lst = data[kind]
    for i, it in enumerate(lst):
        if it["id"] == item_id:
            return lst, i, it
    return None, None, None


def _kind_from_path(request, default="wishlist"):
    for prefix in ("/api/ideas", "/api/history"):
        if request.path.startswith(prefix):
            return prefix.split("/")[2]
    return default


async def delete_handler(request):
    user, _ = auth_user(request)
    if not user:
        return deny()
    data = await _load()
    uid = user_uid(data, str(user.get("id")))
    if not uid:
        return deny()
    item_id = request.match_info["id"]
    kind = _kind_from_path(request, "wishlist")
    lst, i, it = _find_item(data, kind, item_id)
    if not it:
        return web.json_response({"ok": False, "error": "Не найдено"}, status=404)
    if it["userId"] != uid and it["userId"] != partner_of(data, uid):
        return deny()
    lst.pop(i)
    remove_upload(it.get("image"))
    remove_upload(it.get("voice"))
    remove_upload(it.get("giftedPhoto"))
    await _save(data)
    return api(data)


def _validated_patch(item, user, field, value):
    if field == "title":
        return str(value or "").strip()[:200]
    if field == "link":
        return sanitize_url(value or "")[:2000]
    if field == "category":
        return str(value or "").strip()[:60]
    if field == "price":
        return str(value or "").strip()[:30]
    if field == "note":
        return str(value or "").strip()[:1000]
    if field == "priority":
        return value if value in ("must", "want", "maybe") else item.get("priority", "")
    if field == "type":
        return "certificate" if value == "certificate" else "gift"
    if field == "pinned":
        return bool(value)
    if field == "surprise":
        return bool(value)
    if field == "revealDate":
        return int(value) if value else 0
    if field == "giftedPhoto":
        return str(value or "").strip()[:2000]
    raise ValueError(field)


async def patch_handler(request):
    user, _ = auth_user(request)
    if not user:
        return deny()
    data = await _load()
    uid = user_uid(data, str(user.get("id")))
    if not uid:
        return deny()
    body, err = await read_json(request)
    if err:
        return web.json_response({"ok": False, "error": err}, status=400)
    item_id = request.match_info["id"]
    kind = _kind_from_path(request, "wishlist")
    if kind not in ("wishlist", "ideas", "history"):
        kind = "wishlist"
    lst, i, it = _find_item(data, kind, item_id)
    if not it:
        return web.json_response({"ok": False, "error": "Не найдено"}, status=404)
    now = now_ms()
    for field, value in body.items():
        if field in ("bought",):
            it["bought"] = bool(value)
            it["boughtBy"] = uid if bool(value) else ""
            it["boughtAt"] = now if bool(value) else 0
            continue
        if field == "reactions":
            emoji = str(value or "").strip()[:8]
            if emoji:
                it["reactions"][uid] = emoji
            else:
                it["reactions"].pop(uid, None)
            continue
        if field in ("surprise", "revealDate"):
            try:
                it[field] = _validated_patch(it, user, field, value)
            except ValueError:
                return web.json_response({"ok": False, "error": f"Плохое поле: {field}"}, status=400)
            if field == "revealDate" and it.get("revealDate") and it["revealDate"] <= now:
                it["revealDate"] = 0
            continue
        if field not in ("title", "link", "category", "price", "note", "priority",
                         "type", "pinned", "giftedPhoto"):
            return web.json_response({"ok": False, "error": f"Нельзя менять поле: {field}"}, status=400)
        if it["userId"] != uid and it["userId"] != partner_of(data, uid):
            return deny()
        try:
            it[field] = _validated_patch(it, user, field, value)
        except ValueError:
            return web.json_response({"ok": False, "error": f"Плохое поле: {field}"}, status=400)
    if it.get("pinned"):
        lst.insert(0, lst.pop(i))
    await _save(data)
    return api(data, item=it)


async def restore_handler(request):
    user, _ = auth_user(request)
    if not user:
        return deny()
    data = await _load()
    uid = user_uid(data, str(user.get("id")))
    if not uid:
        return deny()
    body, err = await read_json(request)
    if err:
        return web.json_response({"ok": False, "error": err}, status=400)
    item = body.get("item")
    if not isinstance(item, dict):
        return web.json_response({"ok": False, "error": "Нет данных"}, status=400)
    if item.get("userId") != uid and item.get("userId") != partner_of(data, uid):
        return deny()
    kind = body.get("kind") if body.get("kind") in ("wishlist", "ideas", "history") else "wishlist"
    item = normalize_item(item)
    for lst in (data["wishlist"], data["ideas"], data["history"]):
        if any(x["id"] == item["id"] for x in lst):
            return web.json_response({"ok": False, "error": "Уже существует"}, status=400)
    data[kind].insert(0, item)
    await _save(data)
    return api(data, item=item)


async def copy_handler(request):
    user, _ = auth_user(request)
    if not user:
        return deny()
    data = await _load()
    uid = user_uid(data, str(user.get("id")))
    if not uid:
        return deny()
    item_id = request.match_info["id"]
    _, _, it = _find_item(data, "wishlist", item_id)
    if not it:
        return web.json_response({"ok": False, "error": "Не найдено"}, status=404)
    if it["userId"] == uid:
        return web.json_response({"ok": False, "error": "Это уже ваш подарок"}, status=400)
    copy = normalize_item({
        "id": new_id(),
        "userId": uid,
        "title": it.get("title", ""),
        "link": it.get("link", ""),
        "image": it.get("image", ""),
        "category": it.get("category", ""),
        "createdAt": now_ms(),
        "price": it.get("price", ""),
        "priority": it.get("priority", ""),
        "type": it.get("type", "gift"),
    })
    data["wishlist"].insert(0, copy)
    await _save(data)
    return api(data, item=copy)


async def gift_handler(request):
    user, _ = auth_user(request)
    if not user:
        return deny()
    data = await _load()
    uid = user_uid(data, str(user.get("id")))
    if not uid:
        return deny()
    item_id = request.match_info["id"]
    body, err = await read_json(request)
    if err:
        return web.json_response({"ok": False, "error": err}, status=400)
    lst, i, it = _find_item(data, "wishlist", item_id)
    if not it:
        return web.json_response({"ok": False, "error": "Не найдено"}, status=404)
    if not it.get("bought"):
        return web.json_response({"ok": False, "error": "Сначала отметьте как купленное"}, status=400)
    now = now_ms()
    it["gifted"] = True
    it["giftedBy"] = uid
    it["giftedAt"] = now
    it["giftedPhoto"] = str(body.get("photo") or "").strip()[:2000]
    data["history"].insert(0, it)
    lst.pop(i)
    await _save(data)
    return api(data, item=it)


async def to_item_handler(request):
    user, _ = auth_user(request)
    if not user:
        return deny()
    data = await _load()
    uid = user_uid(data, str(user.get("id")))
    if not uid:
        return deny()
    idea_id = request.match_info["id"]
    lst, i, it = _find_item(data, "ideas", idea_id)
    if not it:
        return web.json_response({"ok": False, "error": "Не найдено"}, status=404)
    if it["userId"] != uid:
        return deny()
    it["id"] = new_id()
    data["wishlist"].insert(0, it)
    lst.pop(i)
    await _save(data)
    return api(data, item=it)


async def add_event_handler(request):
    user, _ = auth_user(request)
    if not user:
        return deny()
    data = await _load()
    uid = user_uid(data, str(user.get("id")))
    if not uid:
        return deny()
    body, err = await read_json(request)
    if err:
        return web.json_response({"ok": False, "error": err}, status=400)
    title = str(body.get("title") or "").strip()[:120]
    date_ts = int(body.get("dateTs") or 0)
    card = str(body.get("card") or "").strip()[:400]
    if not title or not date_ts:
        return web.json_response({"ok": False, "error": "Название и дата обязательны"}, status=400)
    data["events"].append({"id": new_id(), "title": title, "dateTs": date_ts,
                           "card": card, "userId": uid, "createdAt": now_ms()})
    data["events"].sort(key=lambda e: e["dateTs"])
    await _save(data)
    return api(data)


async def delete_event_handler(request):
    user, _ = auth_user(request)
    if not user:
        return deny()
    data = await _load()
    uid = user_uid(data, str(user.get("id")))
    if not uid:
        return deny()
    event_id = request.match_info["id"]
    data["events"] = [e for e in data["events"] if e["id"] != event_id]
    await _save(data)
    return api(data)


async def add_category_handler(request):
    user, _ = auth_user(request)
    if not user:
        return deny()
    data = await _load()
    uid = user_uid(data, str(user.get("id")))
    if not uid:
        return deny()
    body, err = await read_json(request)
    if err:
        return web.json_response({"ok": False, "error": err}, status=400)
    name = str(body.get("name") or "").strip()[:60]
    if not name:
        return web.json_response({"ok": False, "error": "Введите название категории"}, status=400)
    cats = data["categories"].setdefault(uid, [])
    if name not in cats:
        cats.append(name)
    await _save(data)
    return api(data)


async def delete_category_handler(request):
    user, _ = auth_user(request)
    if not user:
        return deny()
    data = await _load()
    uid = user_uid(data, str(user.get("id")))
    if not uid:
        return deny()
    name = str(request.match_info["name"] or "")
    cats = data["categories"].get(uid, [])
    if name in cats:
        cats.remove(name)
    for lst in (data["wishlist"], data["ideas"]):
        for it in lst:
            if it.get("category") == name:
                it["category"] = ""
    await _save(data)
    return api(data)


async def background_handler(request):
    user, _ = auth_user(request)
    if not user:
        return deny()
    data = await _load()
    uid = user_uid(data, str(user.get("id")))
    if not uid:
        return deny()
    body, err = await read_json(request)
    if err:
        return web.json_response({"ok": False, "error": err}, status=400)
    url = str(body.get("url") or "").strip()[:2000]
    if not url:
        return web.json_response({"ok": False, "error": "Нет картинки"}, status=400)
    if len(data["backgrounds"]) >= 12:
        return web.json_response({"ok": False, "error": "Максимум 12 фонов"}, status=400)
    data["backgrounds"].append({"url": url, "userId": uid, "createdAt": now_ms()})
    data["backgroundIndex"] = len(data["backgrounds"]) - 1
    await _save(data)
    return api(data)


async def background_set_handler(request):
    user, _ = auth_user(request)
    if not user:
        return deny()
    data = await _load()
    uid = user_uid(data, str(user.get("id")))
    if not uid:
        return deny()
    body, err = await read_json(request)
    if err:
        return web.json_response({"ok": False, "error": err}, status=400)
    index = int(body.get("index") or 0)
    if not (0 <= index < len(data["backgrounds"])):
        return web.json_response({"ok": False, "error": "Нет такого фона"}, status=400)
    data["backgroundIndex"] = index
    await _save(data)
    return api(data)


async def background_delete_handler(request):
    user, _ = auth_user(request)
    if not user:
        return deny()
    data = await _load()
    uid = user_uid(data, str(user.get("id")))
    if not uid:
        return deny()
    index = int(request.match_info["index"] or 0)
    if not (0 <= index < len(data["backgrounds"])):
        return web.json_response({"ok": False, "error": "Нет такого фона"}, status=404)
    bg = data["backgrounds"].pop(index)
    remove_upload(bg.get("url"))
    if data["backgroundIndex"] >= len(data["backgrounds"]):
        data["backgroundIndex"] = max(0, len(data["backgrounds"]) - 1)
    await _save(data)
    return api(data)


async def diag_handler(request):
    user, _ = auth_user(request)
    if not user:
        return deny()
    if not user.get("id"):
        return deny()
    v = request.query.get("v")
    ok = v and validate_init_data(v)
    return api(data, user=user, ok=bool(ok), github=GITHUB_USER)


async def _load():
    async with DATA_LOCK:
        return load_data()


async def _save(data):
    async with DATA_LOCK:
        save_data(data)


async def image_refresh_loop(app):
    while True:
        await asyncio.sleep(6 * 3600)
        try:
            async with DATA_LOCK:
                data = load_data()
                changed = False
                for lst in (data["wishlist"], data["ideas"]):
                    for it in lst:
                        if it.get("link") and not it.get("image"):
                            try:
                                img = await fetch_og_image(app["session"], it["link"])
                            except Exception:
                                img = None
                            if img:
                                it["image"] = img
                                changed = True
                if changed:
                    save_data(data)
        except Exception:
            pass


async def fetch_og_image(session, url, timeout=7):
    if not url:
        return ""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return ""
    head = {"User-Agent": "Mozilla/5.0 (compatible; WishlistBot/1.0)"}
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout), headers=head) as resp:
            if resp.status != 200:
                return ""
            if (resp.content_type or "").startswith("image/"):
                return url
            chunk = await resp.content.read(300_000)
            text = chunk.decode("utf-8", errors="ignore")
    except Exception:
        return ""
    low = text.lower()
    for tag in ("property=\"og:image\"", "property='og:image'", 'name="twitter:image"'):
        idx = low.find(tag)
        if idx >= 0:
            rest = text[idx:]
            st = rest.find("content=\"")
            if st < 0:
                st = rest.find("content='")
            if st >= 0:
                content = rest[st + len("content=\""):]
                end = content.find("\"")
                if end < 0:
                    end = content.find("'")
                img = content[:end] if end >= 0 else content
                img = img.strip()
                if img.startswith("//"):
                    img = "https:" + img
                elif img.startswith("/"):
                    img = f"{parsed.scheme}://{parsed.netloc}{img}"
                return img[:2000]
    return ""


async def fetch_og_title(session, url, timeout=7):
    if not url:
        return ""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return ""
    head = {"User-Agent": "Mozilla/5.0 (compatible; WishlistBot/1.0)"}
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout), headers=head) as resp:
            if resp.status != 200:
                return ""
            chunk = await resp.content.read(200_000)
            text = chunk.decode("utf-8", errors="ignore")
    except Exception:
        return ""
    low = text.lower()
    for tag in ("property=\"og:title\"", "property='og:title'", "<title", "<h1"):
        idx = low.find(tag)
        if idx >= 0:
            rest = text[idx:idx + 2000]
            st = rest.find(">")
            if st >= 0:
                end = rest.find("<", st)
                t = rest[st + 1:end if end > 0 else None].strip()
                if t and len(t) > 2:
                    return t[:200]
    return parsed.netloc.replace("www.", "")[:200]


def create_app():
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    app = web.Application()
    app["lock"] = DATA_LOCK
    app["session"] = aiohttp.ClientSession()
    app["upload_log"] = deque()

    app.router.add_get("/", index)
    app.router.add_static("/uploads/", path=UPLOADS_DIR)
    app.router.add_get("/api/data", api_data_handler)
    app.router.add_post("/api/items", add_handler)
    app.router.add_post("/api/items/{id}/delete", delete_handler)
    app.router.add_post("/api/items/{id}/copy", copy_handler)
    app.router.add_post("/api/items/{id}/gift", gift_handler)
    app.router.add_post("/api/items/{id}/restore", restore_handler)
    app.router.add_patch("/api/items/{id}", patch_handler)
    app.router.add_patch("/api/ideas/{id}", patch_handler)
    app.router.add_patch("/api/history/{id}", patch_handler)
    app.router.add_post("/api/ideas/{id}/to-item", to_item_handler)
    app.router.add_post("/api/ideas/{id}/delete", delete_handler)
    app.router.add_post("/api/history/{id}/delete", delete_handler)
    app.router.add_post("/api/events", add_event_handler)
    app.router.add_post("/api/events/{id}/delete", delete_event_handler)
    app.router.add_post("/api/categories", add_category_handler)
    app.router.add_post("/api/categories/{name}/delete", delete_category_handler)
    app.router.add_post("/api/upload", uploads_handler)
    app.router.add_post("/api/background", background_handler)
    app.router.add_post("/api/background/set", background_set_handler)
    app.router.add_post("/api/background/{index}/delete", background_delete_handler)
    app.router.add_get("/api/diag", diag_handler)

    return app


async def index(request):
    path = BASE_DIR / "public" / "index.html"
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return web.Response(text="index.html не найден", status=404)
    return web.Response(text=text, content_type="text/html", charset="utf-8")


def start_background(app):
    return asyncio.create_task(image_refresh_loop(app))
