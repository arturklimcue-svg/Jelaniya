import base64
import hashlib
import hmac
import json
from urllib.parse import quote, urlencode

import aiohttp
import pytest
from aiohttp import web

import webapp as w

PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def make_init(tg_id, secret="test_secret"):
    values = {"user": json.dumps({"id": tg_id}, separators=(",", ":")), "auth_date": "0", "query_id": "q" + str(tg_id)}
    dcs = "\n".join(f"{k}={v}" for k, v in sorted(values.items()))
    key = hmac.new(b"WebAppData", secret.encode(), hashlib.sha256).digest()
    h = hmac.new(key, dcs.encode(), hashlib.sha256).hexdigest()
    return urlencode({**values, "hash": h})


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


async def test_add_returns_full_data(pair):
    client, uid_a, _, ini_a, _ = pair
    r = await add(client, ini_a, title="Плед")
    body = await r.json()
    assert body["ok"] is True
    assert body["me"] == uid_a
    assert body["names"][uid_a] == "Аня"
    assert len(body["wishlist"]) == 1
    assert body["wishlist"][0]["userId"] == uid_a


async def test_mutations_return_full_data(pair):
    client, uid_a, uid_b, ini_a, ini_b = pair
    r = await add(client, ini_a, title="Книга")
    iid = (await r.json())["item"]["id"]
    r = await client.patch(f"/api/items/{iid}?" + urlencode({"initData": ini_a}), json={"bought": True})
    body = await r.json()
    assert body["me"] == uid_a
    assert body["wishlist"][0]["bought"] is True
    assert body["wishlist"][0]["boughtBy"] == uid_a
    assert isinstance(body["ideas"], list) and isinstance(body["events"], list)


async def test_unauthorized(api):
    r = await api.get("/api/data")
    assert r.status == 403


async def test_user_param_backdoor_removed(api):
    r = await api.get("/api/data?" + urlencode({"user": json.dumps({"id": "111"})}))
    assert r.status == 403


async def test_diag(pair):
    client, _, _, ini_a, _ = pair
    r = await client.get("/api/diag?" + urlencode({"initData": ini_a, "v": ini_a}))
    assert r.status == 200
    body = await r.json()
    assert body["ok"] is True
    assert body["user"]["id"] == 111
    r = await client.get("/api/diag?" + urlencode({"initData": ini_a, "v": "мусор"}))
    assert (await r.json())["ok"] is False


async def test_add_bad_reveal_date(pair):
    client, _, _, ini_a, _ = pair
    r = await add(client, ini_a, title="Плед", revealDate="не-число")
    assert r.status == 400


async def test_health(api):
    r = await api.get("/api/health")
    assert (await r.json())["ok"] is True


def test_initdata_telegram_algorithm(monkeypatch):
    monkeypatch.setattr(w, "BOT_TOKEN", "test_secret")
    user = json.dumps({"id": 42}, separators=(",", ":"))
    values = {"user": user, "auth_date": "0", "query_id": "q42"}
    dcs_dec = "\n".join(f"{k}={v}" for k, v in sorted(values.items()))
    pairs_enc = [f"{k}={quote(str(v), safe='')}" for k, v in values.items()]
    dcs_enc = "\n".join(sorted(pairs_enc))
    key = hmac.new(b"WebAppData", b"test_secret", hashlib.sha256).digest()
    correct = hmac.new(key, dcs_dec.encode(), hashlib.sha256).hexdigest()
    wrong = hmac.new(key, dcs_enc.encode(), hashlib.sha256).hexdigest()
    init = "&".join(pairs_enc)
    assert w.validate_init_data(init + "&hash=" + correct)["query_id"] == "q42"
    assert w.validate_init_data(init + "&hash=" + wrong) == {}


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
    # партнёр не может отметить чужие подарки купленными
    r = await client.patch(f"/api/items/{iid}?" + urlencode({"initData": ini_b}), json={"bought": True})
    assert r.status == 400
    # владелец отмечает свой подарок купленным
    r = await client.patch(f"/api/items/{iid}?" + urlencode({"initData": ini_a}), json={"bought": True})
    assert r.status == 200
    d = await get_data(client, ini_b)
    it = d["wishlist"][0]
    assert it["bought"] is True
    assert it["boughtBy"] == uid_a


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
    # партнёр вручает без предварительной пометки «куплено»
    r = await client.post(f"/api/items/{iid}/gift?" + urlencode({"initData": ini_b}), json={"photo": "/uploads/happy.png"})
    assert r.status == 200
    d = await get_data(client, ini_a)
    assert d["wishlist"] == []
    assert len(d["history"]) == 1
    h = d["history"][0]
    assert h["gifted"] is True
    assert h["giftedPhoto"] == "/uploads/happy.png"
    assert h["giftedBy"] == uid_b
    assert h["boughtBy"] == uid_b


async def test_gift_only_partner(pair):
    client, _, _, ini_a, _ = pair
    r = await add(client, ini_a, title="Часы")
    iid = (await r.json())["item"]["id"]
    # владелец не может вручить свой же подарок
    r = await client.post(f"/api/items/{iid}/gift?" + urlencode({"initData": ini_a}), json={})
    assert r.status == 400


async def test_gift_blocked_when_owner_bought(pair):
    client, _, _, ini_a, ini_b = pair
    r = await add(client, ini_a, title="Себе")
    iid = (await r.json())["item"]["id"]
    await client.patch(f"/api/items/{iid}?" + urlencode({"initData": ini_a}), json={"bought": True})
    # партнёр не может «вручить» подарок, который владелец купил себе
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

async def test_size_field(pair):
    client, uid_a, _, ini_a, ini_b = pair
    r = await add(client, ini_a, title="Кроссовки", size="42")
    iid = (await r.json())["item"]["id"]
    d = await get_data(client, ini_b)
    assert d["wishlist"][0]["size"] == "42"
    r = await client.patch(f"/api/items/{iid}?" + urlencode({"initData": ini_b}), json={"size": "M"})
    assert r.status == 200
    d = await get_data(client, ini_a)
    assert d["wishlist"][0]["size"] == "M"


async def test_copy_keeps_size(pair):
    client, uid_a, uid_b, ini_a, ini_b = pair
    await add(client, ini_a, title="Футболка", size="L")
    iid = (await get_data(client, ini_b))["wishlist"][0]["id"]
    r = await client.post(f"/api/items/{iid}/copy?" + urlencode({"initData": ini_b}))
    assert r.status == 200
    d = await get_data(client, ini_b)
    mine = [i for i in d["wishlist"] if i["userId"] == uid_b]
    assert mine[0]["title"] == "Футболка"
    assert mine[0]["size"] == "L"


async def test_about(pair):
    client, uid_a, uid_b, ini_a, ini_b = pair
    r = await client.post("/api/about?" + urlencode({"initData": ini_a}), json={"text": "люблю фильмы и кофе"})
    assert r.status == 200
    d = await get_data(client, ini_b)
    assert d["about"][uid_a] == "люблю фильмы и кофе"
    r = await client.post("/api/about?" + urlencode({"initData": ini_a}), json={"text": ""})
    assert r.status == 200
    d = await get_data(client, ini_a)
    assert d["about"][uid_a] == ""


async def test_about_unauthorized(api):
    r = await api.post("/api/about", json={"text": "x"})
    assert r.status == 403


async def test_plans_private_and_flow(pair):
    client, uid_a, uid_b, ini_a, ini_b = pair
    await add(client, ini_a, title="Лампочка", category="Техника")
    it = (await get_data(client, ini_b))["wishlist"][0]
    # партнёр отмечает подарок с новой категорией и заметкой
    r = await client.post(f"/api/items/{it['id']}/plan?" + urlencode({"initData": ini_b}),
                          json={"category": "Новый год", "note": "в «Диком»"})
    body = await r.json()
    assert body["ok"] is True
    plan = body["plans"][it["id"]]
    assert plan["category"] == "Новый год"
    assert plan["note"] == "в «Диком»"
    assert plan["src"]["title"] == "Лампочка"
    # новая категория автоматически добавлена партнёру
    assert "Новый год" in body["categories"][uid_b]
    # владелец не видит чужие планы
    d = await get_data(client, ini_a)
    assert d["plans"] == {}
    # партнёр видит свои планы
    d2 = await get_data(client, ini_b)
    assert it["id"] in d2["plans"]
    # свой подарок отметить нельзя
    r = await client.post(f"/api/items/{it['id']}/plan?" + urlencode({"initData": ini_a}), json={"category": "x"})
    assert r.status == 400
    # удаление плана
    r = await client.post(f"/api/plans/{it['id']}/delete?" + urlencode({"initData": ini_b}))
    body = await r.json()
    assert body["ok"] is True
    assert body["plans"] == {}


async def test_plans_empty_and_event(pair):
    client, uid_a, uid_b, ini_a, ini_b = pair
    await add(client, ini_a, title="Лампочка", category="Техника")
    it = (await get_data(client, ini_b))["wishlist"][0]
    r = await client.post("/api/events?" + urlencode({"initData": ini_b}),
                          json={"title": "Новый год", "dateTs": w.now_ms() + 86_400_000, "card": ""})
    ev = (await r.json())["events"][0]
    # пустой план (без категории и заметки) сохраняется
    r = await client.post(f"/api/items/{it['id']}/plan?" + urlencode({"initData": ini_b}), json={})
    assert r.status == 200
    body = await r.json()
    assert body["plans"][it["id"]]["category"] == ""
    assert body["plans"][it["id"]]["note"] == ""
    assert body["plans"][it["id"]].get("eventId", "") == ""
    # привязка к событию
    r = await client.post(f"/api/items/{it['id']}/plan?" + urlencode({"initData": ini_b}),
                          json={"category": "Техника", "eventId": ev["id"]})
    assert r.status == 200
    body = await r.json()
    assert body["plans"][it["id"]]["eventId"] == ev["id"]
    # несуществующее событие отклоняется
    r = await client.post(f"/api/items/{it['id']}/plan?" + urlencode({"initData": ini_b}),
                          json={"eventId": "nope"})
    assert r.status == 400
