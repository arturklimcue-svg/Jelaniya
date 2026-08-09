import base64
import hashlib
import hmac
import json
from urllib.parse import urlencode

import aiohttp
import pytest
from aiohttp import web

import webapp as w

PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def make_init(tg_id, secret="test_secret"):
    values = {"user": json.dumps({"id": tg_id}), "auth_date": "0", "query_id": "q" + str(tg_id)}
    dcs = "\n".join(f"{k}={v}" for k, v in sorted(values.items()))
    key = hmac.new(b"WebAppData", secret.encode(), hashlib.sha256).digest()
    h = hmac.new(key, dcs.encode(), hashlib.sha256).hexdigest()
    return urlencode({"user": values["user"], "auth_date": "0", "query_id": values["query_id"], "hash": h})


class Api:
    def __init__(self, base):
        self.base = base
        self.session = aiohttp.ClientSession()

    def url(self, path):
        return self.base + path

    async def get(self, path, **kw):
        return await self.session.get(self.url(path), **kw)

    async def post(self, path, json=None, data=None, **kw):
        kw.setdefault("json", json)
        if data is not None:
            kw["data"] = data
            kw.pop("json", None)
        return await self.session.post(self.url(path), **kw)

    async def patch(self, path, json=None):
        return await self.session.patch(self.url(path), json=json)

    async def close(self):
        await self.session.close()


@pytest.fixture
async def api(tmp_path, monkeypatch):
    monkeypatch.setattr(w, "DATA_PATH", tmp_path / "data.json")
    monkeypatch.setattr(w, "UPLOADS_DIR", tmp_path / "uploads")
    monkeypatch.setattr(w, "BOT_TOKEN", "test_secret")
    w.UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    w.save_data(json.loads(json.dumps(w.DEFAULT_DATA)))

    app = w.create_app()
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    client = Api(f"http://127.0.0.1:{port}")
    try:
        yield client
    finally:
        await client.close()
        await runner.cleanup()
        await app["session"].close()


@pytest.fixture
async def pair(api):
    uid_a = await w.register_user("111", "Аня")
    uid_b = await w.register_user("222", "Боря")
    assert w.partner_of(w.load_data(), uid_a) == uid_b
    return api, uid_a, uid_b, make_init(111), make_init(222)


async def add(client, init, title="Тест", **kw):
    body = {"title": title, "kind": kw.pop("kind", "wishlist")}
    body.update(kw)
    return await client.post("/api/items?" + urlencode({"initData": init}), json=body)


async def get_data(client, init):
    r = await client.get("/api/data?" + urlencode({"initData": init}))
    return await r.json()


async def test_add_and_data(pair):
    client, uid_a, uid_b, ini_a, ini_b = pair
    r = await add(client, ini_a, title="Тёплый плед", price="2 000 ₽", priority="must",
                  category="уют", type="certificate")
    body = await r.json(); assert body["ok"] is True
    d = await get_data(client, ini_b)
    assert len(d["wishlist"]) == 1
    it = d["wishlist"][0]
    assert it["title"] == "Тёплый плед"
    assert it["price"] == "2 000 ₽"
    assert it["priority"] == "must"
    assert it["type"] == "certificate"
    assert it["userId"] == uid_a
    assert it["surprise"] is False
    assert d["names"][uid_a] == "Аня"


async def test_unauthorized(api):
    r = await api.get("/api/data")
    assert r.status == 403


async def test_health(api):
    r = await api.get("/api/health")
    assert (await r.json())["ok"] is True


def test_initdata_telegram_algorithm(monkeypatch):
    monkeypatch.setattr(w, "BOT_TOKEN", "test_secret")
    values = {"user": json.dumps({"id": 42}), "auth_date": "0", "query_id": "q42"}
    dcs = "\n".join(f"{k}={v}" for k, v in sorted(values.items()))
    correct = hmac.new(hmac.new(b"WebAppData", b"test_secret", hashlib.sha256).digest(), dcs.encode(), hashlib.sha256).hexdigest()
    old_wrong = hmac.new(hashlib.sha256(b"test_secret").digest(), dcs.encode(), hashlib.sha256).hexdigest()
    base = "&".join(f"{k}={v}" for k, v in values.items())
    assert w.validate_init_data(base + "&hash=" + correct)["query_id"] == "q42"
    assert w.validate_init_data(base + "&hash=" + old_wrong) == {}


async def test_patch_permissions(pair):
    client, uid_a, uid_b, ini_a, ini_b = pair
    r = await add(client, ini_a, title="Книга")
    d = await r.json()
    iid = d["item"]["id"]
    assert (await client.patch(f"/api/items/{iid}?" + urlencode({"initData": ini_a}), json={"title": "Новая книга"})).status == 200
    d = await get_data(client, ini_b)
    assert d["wishlist"][0]["title"] == "Новая книга"
    r = await client.patch(f"/api/items/{iid}?" + urlencode({"initData": ini_b}), json={"title": "Хакер!"})
    assert r.status == 200
    d = await get_data(client, ini_a)
    assert d["wishlist"][0]["title"] == "Хакер!"
    r = await client.patch(f"/api/items/{iid}?" + urlencode({"initData": ini_b}), json={"bought": True})
    assert r.status == 200
    d = await get_data(client, ini_a)
    it = d["wishlist"][0]
    assert it["bought"] is True
    assert it["boughtBy"] == uid_b


async def test_reactions(pair):
    client, uid_a, uid_b, ini_a, ini_b = pair
    r = await add(client, ini_a, title="Кофеварка")
    iid = (await r.json())["item"]["id"]
    await client.patch(f"/api/items/{iid}?" + urlencode({"initData": ini_b}), json={"reactions": "🔥"})
    d = await get_data(client, ini_a)
    it = d["wishlist"][0]
    assert it["reactions"].get(uid_b) == "🔥"
    await client.patch(f"/api/items/{iid}?" + urlencode({"initData": ini_b}), json={"reactions": ""})
    d = await get_data(client, ini_a)
    assert uid_b not in d["wishlist"][0]["reactions"]


async def test_surprise_hides_from_owner(pair):
    client, uid_a, uid_b, ini_a, ini_b = pair
    r = await add(client, ini_a, title="Тайное")
    iid = (await r.json())["item"]["id"]
    future = w.now_ms() + 100_000_000
    r = await client.patch(f"/api/items/{iid}?" + urlencode({"initData": ini_b}), json={"surprise": True, "revealDate": future})
    assert r.status == 200
    d_a = await get_data(client, ini_a)
    assert d_a["wishlist"] == []
    d_b = await get_data(client, ini_b)
    assert d_b["wishlist"][0]["surprise"] is True


async def test_copy_me_too(pair):
    client, uid_a, uid_b, ini_a, ini_b = pair
    r = await add(client, ini_a, title="Наушники", image="/uploads/x.png")
    iid = (await r.json())["item"]["id"]
    r = await client.post(f"/api/items/{iid}/copy?" + urlencode({"initData": ini_b}))
    assert r.status == 200
    d = await get_data(client, ini_b)
    mine = [i for i in d["wishlist"] if i["userId"] == uid_b]
    assert len(mine) == 1
    assert mine[0]["title"] == "Наушники"
    r = await client.post(f"/api/items/{iid}/copy?" + urlencode({"initData": ini_a}))
    assert r.status == 400


async def test_idea_to_item(pair):
    client, uid_a, uid_b, ini_a, ini_b = pair
    r = await add(client, ini_a, title="Идея: сходить в музей", kind="ideas")
    iid = (await r.json())["item"]["id"]
    d = await get_data(client, ini_b)
    assert d["ideas"][0]["title"].startswith("Идея")
    r = await client.post(f"/api/ideas/{iid}/to-item?" + urlencode({"initData": ini_a}))
    assert r.status == 200
    d = await get_data(client, ini_a)
    assert len(d["ideas"]) == 0
    assert len(d["wishlist"]) == 1
    r = await client.post(f"/api/ideas/{iid}/to-item?" + urlencode({"initData": ini_b}))
    assert r.status == 404


async def test_gift_flow(pair):
    client, uid_a, uid_b, ini_a, ini_b = pair
    r = await add(client, ini_a, title="Часы")
    iid = (await r.json())["item"]["id"]
    await client.patch(f"/api/items/{iid}?" + urlencode({"initData": ini_b}), json={"bought": True})
    r = await client.post(f"/api/items/{iid}/gift?" + urlencode({"initData": ini_b}), json={"photo": "/uploads/happy.png"})
    assert r.status == 200
    d = await get_data(client, ini_a)
    assert d["wishlist"] == []
    assert len(d["history"]) == 1
    h = d["history"][0]
    assert h["gifted"] is True
    assert h["giftedPhoto"] == "/uploads/happy.png"
    assert h["giftedBy"] == uid_b


async def test_gift_requires_bought(pair):
    client, _, _, ini_a, ini_b = pair
    r = await add(client, ini_a, title="Без покупки")
    iid = (await r.json())["item"]["id"]
    r = await client.post(f"/api/items/{iid}/gift?" + urlencode({"initData": ini_b}), json={})
    assert r.status == 400


async def test_delete_and_restore(pair):
    client, uid_a, uid_b, ini_a, ini_b = pair
    r = await add(client, ini_a, title="Удалю")
    d = await r.json()
    iid = d["item"]["id"]
    item = d["item"]
    r = await client.post(f"/api/items/{iid}/delete?" + urlencode({"initData": ini_b}))
    assert r.status == 200
    d = await get_data(client, ini_b)
    assert d["wishlist"] == []
    r = await client.post(f"/api/items/{iid}/restore?" + urlencode({"initData": ini_b}), json={"item": item, "kind": "wishlist"})
    assert r.status == 200
    d = await get_data(client, ini_b)
    assert d["wishlist"][0]["id"] == iid


async def test_events(pair):
    client, _, _, ini_a, ini_b = pair
    r = await client.post("/api/events?" + urlencode({"initData": ini_a}),
                          json={"title": "ДР Ани", "dateTs": w.now_ms() + 86_400_000, "card": "Счастья!"})
    assert r.status == 200
    d = await get_data(client, ini_b)
    assert d["events"][0]["title"] == "ДР Ани"
    eid = d["events"][0]["id"]
    r = await client.post(f"/api/events/{eid}/delete?" + urlencode({"initData": ini_b}))
    assert r.status == 200
    d = await get_data(client, ini_b)
    assert d["events"] == []


async def test_categories(pair):
    client, uid_a, _, ini_a, ini_b = pair
    await client.post("/api/categories?" + urlencode({"initData": ini_a}), json={"name": "уют"})
    await add(client, ini_a, title="Плед", category="уют")
    d = await get_data(client, ini_b)
    assert "уют" in d["categories"][uid_a]
    assert d["wishlist"][0]["category"] == "уют"
    await client.post("/api/categories/%D1%83%D1%8E%D1%82/delete?" + urlencode({"initData": ini_a}))
    d = await get_data(client, ini_b)
    assert d["categories"][uid_a] == []
    assert d["wishlist"][0]["category"] == ""


async def test_upload_png(api):
    init = make_init(999)
    await w.register_user("999", "Тест")
    data = aiohttp.FormData()
    data.add_field("file", PNG_1PX, filename="a.png", content_type="image/png")
    r = await api.post("/api/upload?" + urlencode({"initData": init}), data=data)
    body = await r.json()
    assert body["ok"] is True
    assert body["url"].startswith("/uploads/")
    name = body["url"].rsplit("/", 1)[1]
    assert (w.UPLOADS_DIR / name).exists()


async def test_upload_rejects_not_image(api):
    init = make_init(998)
    await w.register_user("998", "Хакер")
    data = aiohttp.FormData()
    data.add_field("file", b"this is not an image at all" * 10, filename="f.png", content_type="image/png")
    r = await api.post("/api/upload?" + urlencode({"initData": init}), data=data)
    assert r.status == 400


async def test_upload_unauthorized(api):
    data = aiohttp.FormData()
    data.add_field("file", PNG_1PX, filename="a.png", content_type="image/png")
    r = await api.post("/api/upload", data=data)
    assert r.status == 403


async def test_backgrounds(pair):
    client, _, _, ini_a, ini_b = pair
    r = await client.post("/api/background?" + urlencode({"initData": ini_a}), json={"url": "/uploads/bg.png"})
    assert r.status == 200
    d = await get_data(client, ini_b)
    assert len(d["backgrounds"]) == 1
    r = await client.post("/api/background/set?" + urlencode({"initData": ini_b}), json={"index": 0})
    assert r.status == 200
    d = await get_data(client, ini_b)
    assert d["backgroundIndex"] == 0
    r = await client.post("/api/background/0/delete?" + urlencode({"initData": ini_b}))
    assert r.status == 200
    d = await get_data(client, ini_a)
    assert d["backgrounds"] == []


async def test_pin_moves_to_top(pair):
    client, _, _, ini_a, ini_b = pair
    await add(client, ini_a, title="Первый")
    r = await add(client, ini_a, title="Закреплю")
    iid = (await r.json())["item"]["id"]
    await client.patch(f"/api/items/{iid}?" + urlencode({"initData": ini_a}), json={"pinned": True})
    d = await get_data(client, ini_b)
    assert d["wishlist"][0]["title"] == "Закреплю"


async def test_index_served(api):
    r = await api.get("/")
    assert r.status == 200
    assert "Вишлист" in await r.text()


async def test_static_assets_served(api):
    for path, ctype in (("/style.css", "text/css"), ("/script.js", "text/javascript"),
                        ("/sw.js", "text/javascript"), ("/manifest.json", "application/manifest+json")):
        r = await api.get(path)
        assert r.status == 200, path
        assert ctype in r.headers.get("Content-Type", "")
