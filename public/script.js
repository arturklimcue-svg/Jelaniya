"use strict";

const tg = window.Telegram?.WebApp || null;
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
const fmtFull = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });
function toDateLocal(ms) {
  const d = new Date(ms);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const S = {
  initData: tg?.initData || new URLSearchParams(location.search).get("initData") || "",
  data: null,
  view: "home",
  stack: [],
  wlTab: "mine",
  wlFilter: "all",
  search: "",
  ideasTab: "mine",
  lastDeleted: null,
  history: [],
};

const icons = {
  heart: '<svg viewBox="0 0 24 24"><path d="M19.3 4.9a4.5 4.5 0 0 0-6.4 0L12 5.9l-.9-1a4.5 4.5 0 0 0-6.4 6.4l.9.9L12 18.8l6.4-7.6.9-.9a4.5 4.5 0 0 0 0-6.4z" fill="currentColor"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M14 4h3v3l-2 2v5l3 2v2H6v-2l3-2V9L7 7V4h3V2h4v2z" fill="currentColor"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><path d="M8 8h12v12H8z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 16V4h12" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  gift: '<svg viewBox="0 0 24 24"><path d="M20 12v9H4v-9M2 7h20v5H2zM12 7v14" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7S8 2 5 4s3 3 7 3zm0 0s4-5 7-3-3 3-7 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  dice: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor"/><circle cx="8" cy="8" r="1.6" fill="var(--surface-solid)"/><circle cx="16" cy="8" r="1.6" fill="var(--surface-solid)"/><circle cx="8" cy="16" r="1.6" fill="var(--surface-solid)"/><circle cx="16" cy="16" r="1.6" fill="var(--surface-solid)"/><circle cx="12" cy="12" r="1.6" fill="var(--surface-solid)"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 7l2-3h4l2 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="13.5" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>',
};

function haptic(kind = "light") {
  try { tg?.HapticFeedback?.impactOccurred(kind); } catch (e) {}
}
function hapticOk() {
  try { tg?.HapticFeedback?.notificationOccurred("success"); } catch (e) {}
}

function toast(msg, actionText, onAction, dur = 3500) {
  const root = $("#toast-root");
  const t = el("div", "toast");
  t.innerHTML = esc(msg);
  if (actionText && onAction) {
    const b = el("button", "", esc(actionText));
    b.onclick = () => { onAction(); t.remove(); };
    t.appendChild(b);
  }
  root.appendChild(t);
  setTimeout(() => t.remove(), dur);
}

function openModal(html, title) {
  const root = $("#modal-root");
  root.innerHTML = "";
  const mask = el("div", "modal-mask");
  const modal = el("div", "modal");
  modal.innerHTML = (title
    ? `<div class="modal-head"><h2 class="modal-title">${esc(title)}</h2>
       <button class="modal-x" data-action="close-modal">${icons.x}</button></div>`
    : "") + html;
  mask.appendChild(modal);
  mask.addEventListener("click", (e) => { if (e.target === mask) closeModal(); });
  root.appendChild(mask);
  return modal;
}
function closeModal() { $("#modal-root").innerHTML = ""; }

function confirmModal(msg, onOk, okText = "Да", danger = false) {
  const m = openModal(`
    <p style="font-size:15px;margin:4px 0 6px">${esc(msg)}</p>
    <div class="modal-btns">
      <button class="btn ${danger ? "danger" : "primary"}" data-action="confirm-ok">${esc(okText)}</button>
      <button class="btn" data-action="close-modal">Отмена</button>
    </div>`);
  m._onOk = onOk;
  return m;
}

function confetti(n = 40) {
  const root = $("#confetti-root");
  const colors = ["#7c5cff", "#ff5c7c", "#ffd166", "#1dbf73", "#4dd0e1"];
  for (let i = 0; i < n; i++) {
    const c = el("div", "confetti");
    c.style.left = Math.random() * 100 + "vw";
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = (1.6 + Math.random() * 1.6) + "s";
    c.style.animationDelay = Math.random() * 0.3 + "s";
    root.appendChild(c);
    setTimeout(() => c.remove(), 3600);
  }
}

const PRIORITY = { must: "🔥 очень", want: "💜 хочу", maybe: "🤔 может" };

function api(path, opts = {}) {
  opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
  const sep = path.includes("?") ? "&" : "?";
  const url = S.initData ? path + sep + "initData=" + encodeURIComponent(S.initData) : path;
  return fetch(url, opts).then(async (res) => {
    let body;
    try { body = await res.json(); } catch (e) { body = { ok: false, error: "Ошибка сети" }; }
    if (!body.ok && res.status === 403 && !S.initData) showNeedBot();
    return body;
  });
}

function uploadFile(file) {
  const fd = new FormData();
  fd.append("file", file, file.name || "file.webm");
  return fetch("/api/upload?initData=" + encodeURIComponent(S.initData), { method: "POST", body: fd })
    .then((r) => r.json())
    .then((b) => { if (!b.ok) throw new Error(b.error || "Ошибка загрузки"); return b.url; });
}

async function loadData(silent) {
  const d = await api("/api/data");
  if (d.ok) {
    S.data = d;
    applyBackground();
    render();
  } else if (!silent) {
    render();
  }
  return d;
}

/* ============================ navigation ============================ */

function go(view) {
  if (S.view === view) return;
  S.stack.push(S.view);
  S.view = view;
  render();
}
function back() {
  const prev = S.stack.pop();
  if (prev) S.view = prev; else S.view = "home";
  render();
}

function updateTabbar() {
  document.querySelectorAll(".tb-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === S.view));
  $("#fab").style.display = (S.view === "wishlist" || S.view === "ideas") ? "flex" : "none";
  try {
    if (S.view === "home") { tg?.BackButton?.hide(); } else { tg?.BackButton?.show(); }
  } catch (e) {}
}

function render() {
  const main = $("#main");
  const v = S.view;
  if (!S.data) {
    main.innerHTML = `<section class="view" style="display:block">
      <div class="empty" style="padding-top:80px"><span class="emo">⏳</span>Загружаю вишлист…</div></section>`;
    updateTabbar();
    return;
  }
  if (v === "home") main.innerHTML = viewHome();
  else if (v === "wishlist") main.innerHTML = viewWishlist();
  else if (v === "ideas") main.innerHTML = viewIdeas();
  else if (v === "calendar") main.innerHTML = viewCalendar();
  else if (v === "recap") main.innerHTML = viewRecap();
  else if (v === "history") main.innerHTML = viewHistory();
  else if (v === "profile") main.innerHTML = viewProfile();
  main.querySelectorAll(".view").forEach((x) => x.style.display = "block");
  window.scrollTo({ top: 0 });
  updateTabbar();
}

function topbar(title, sub, actions = "") {
  return `<div class="view-head">
    <div><h1 class="view-title">${esc(title)}</h1>${sub ? `<div class="view-sub">${esc(sub)}</div>` : ""}</div>
    ${actions}
  </div>`;
}

function myName() { return S.data?.names?.[S.me] || "я"; }
function partnerName() { return S.data?.partner || "партнёр"; }
function catList() { return S.data?.categories?.[S.me] || []; }

/* ============================ home ============================ */

function viewHome() {
  const d = S.data;
  const meU = d.names[S.me] || "—";
  const paU = d.partner;
  const mine = d.wishlist.filter((i) => i.userId === S.me);
  const theirs = d.wishlist.filter((i) => i.userId !== S.me);
  const meDone = mine.filter((i) => i.bought).length;
  const thDone = theirs.filter((i) => i.bought).length;
  const nextEv = [...(d.events || [])].sort((a, b) => a.dateTs - b.dateTs).find((e) => e.dateTs >= Date.now());

  const card = (name, count, done, total) => `<div class="card" style="padding:14px">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="width:44px;height:44px;border-radius:14px;background:var(--grad);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:17px">${esc((name || "?").slice(0, 1).toUpperCase())}</div>
      <div><div style="font-weight:800">${esc(name)}</div>
      <div style="font-size:12.5px;color:var(--text2)">желаний: ${total}</div></div>
    </div>
    <div class="divider"></div>
    <div style="display:flex;justify-content:space-between;font-size:13px">
      <span>🛍 куплено: <b>${done}</b></span>
      <span>🎀 вручено: <b>${S.data.history.length}</b></span>
    </div>
  </div>`;

  const navBtn = (v, ico, t, sub) => `<button class="btn" data-action="nav" data-view="${v}" style="display:flex;justify-content:flex-start;text-align:left;align-items:center;gap:12px">
    <span style="width:38px;height:38px;border-radius:12px;background:var(--surface2);display:inline-flex;align-items:center;justify-content:center;flex:none">${ico}</span>
    <span style="flex:1"><b>${esc(t)}</b><br><span style="font-size:12px;color:var(--text2)">${esc(sub)}</span></span>
  </button>`;

  return `<section class="view" style="display:none">
    ${topbar("Вишлист вдвоём", "общий список подарков для двоих")}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      ${card(myName(), meDone, meDone, mine.length)}
      ${paU ? card(partnerName(), thDone, thDone, theirs.length) : `<div class="card empty" style="display:flex;flex-direction:column;justify-content:center">Нет партнёра.<br><span class="small-link">Расскажите второму открыть бота →</span></div>`}
    </div>
    ${nextEv ? `<button class="card ev" data-action="nav" data-view="calendar" style="width:100%;text-align:left;padding:14px;margin-bottom:14px;border:none;background:var(--surface)">
      <div style="display:flex;align-items:center;gap:12px">
        <span style="font-size:28px">📅</span>
        <div style="flex:1"><b>${esc(nextEv.title)}</b><br><span style="font-size:12.5px;color:var(--text2)">${fmt.format(nextEv.dateTs)} · ${countdown(nextEv.dateTs)}</span></div>
        <span class="icon-small">›</span>
      </div></button>` : ""}
    <div class="section-title">Разделы</div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${navBtn("wishlist", icons.heart, "Вишлист", `загадано: ${mine.length}, у партнёра: ${theirs.length}`)}
      ${navBtn("ideas", icons.dice, "Идеи подарков", `в копилке: ${d.ideas.length}`)}
      ${navBtn("calendar", "📅", "Календарь дат", `событий: ${d.events.length}`)}
      ${navBtn("recap", "📊", "Рекап года", "что загадали и подарили")}
      ${navBtn("history", "🎁", "История подарков", `вручено: ${d.history.length}`)}
      ${navBtn("profile", "⚙️", "Настройки", "категории, фоны, тема, события")}
    </div>
  </section>`;
}

/* ============================ wishlist ============================ */

function wlItems() {
  const uid = S.wlTab === "mine" ? S.me : S.data.partner;
  let items = (S.data.wishlist || []).filter((i) => i.userId === uid);
  if (S.wlFilter !== "all") items = items.filter((i) => i.category === S.wlFilter);
  const q = S.search.trim().toLowerCase();
  if (q) items = items.filter((i) => (i.title + " " + (i.category || "")).toLowerCase().includes(q));
  return items.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || a.createdAt - b.createdAt);
}

function tileHTML(it) {
  const who = it.userId === S.me ? "mine" : "theirs";
  const badges = [];
  if (it.bought) badges.push(`<span class="badge ok">🛍 куплено</span>`);
  if (it.gifted) badges.push(`<span class="badge grad">🎀 вручено</span>`);
  if (it.pinned) badges.push(`<span class="badge warn">📌</span>`);
  if (it.type === "certificate") badges.push(`<span class="badge dark">🎫 сертификат</span>`);
  if (it.price) badges.push(`<span class="badge dark">${esc(it.price)}</span>`);
  if (it.priority) badges.push(`<span class="badge ${it.priority === "must" ? "grad" : "dark"}">${PRIORITY[it.priority]}</span>`);
  if (badges.length === 0) badges.push(`<span class="badge dark">${it.category || "подарок"}</span>`);
  const surprise = it.surprise && it.revealDate && it.revealDate > (S.data.serverTime || Date.now());
  return `<button class="tile ${it.bought ? "done" : ""} ${surprise ? "surprise-blur" : ""}" data-action="open-item" data-id="${esc(it.id)}" aria-label="${esc(it.title)}">
    ${it.pinned ? `<span class="tile-pin">${icons.pin}</span>` : ""}
    <span class="tile-corner">${badges.slice(0, 2).join("")}</span>
    <span class="tile-img" ${it.image ? `style="background-image:url('${esc(it.image)}')"` : ""}></span>
    <span class="tile-shade"></span>
    <span class="tile-body">
      <span class="tile-title">${surprise ? "🎁 Сюрприз до " + fmt.format(it.revealDate) : esc(it.title)}</span>
      <span class="tile-meta">${badges.slice(2, 5).join("")}</span>
    </span>
  </button>`;
}

function viewWishlist() {
  const items = wlItems();
  const cats = [["all", "Все"], ...catList().map((c) => [c, c])];
  const chips = cats.map(([val, label]) => `<button class="chip ${S.wlFilter === val ? "active" : ""}" data-action="filter" data-val="${esc(val)}">${esc(label)}</button>`).join("")
    + `<button class="chip add" data-action="add-cat">+</button>`;
  const grid = items.length
    ? `<div class="tile-grid">${items.map(tileHTML).join("")}</div>`
    : `<div class="empty"><span class="emo">🎁</span>${S.wlTab === "mine" ? "Пока пусто — добавьте первое желание кнопкой «+» ниже." : `В списке ${esc(partnerName())} пока пусто.`}</div>`;

  const randBtn = S.data.partner ? `<button class="icon-btn" data-action="random" aria-label="Что подарить?" title="Что подарить?">${icons.dice}</button>` : "";
  return `<section class="view" style="display:none">
    ${topbar("Вишлист", "что загадано и что куплено", randBtn)}
    <div class="seg" style="margin-bottom:12px">
      <button class="${S.wlTab === "mine" ? "active" : ""}" data-action="wl-tab" data-val="mine">Мой</button>
      <button class="${S.wlTab === "theirs" ? "active" : ""}" data-action="wl-tab" data-val="theirs">${esc(S.data.partner ? partnerName() : "Партнёр")}</button>
    </div>
    <div class="search">${icons.search}<input data-action="search" placeholder="Поиск по вишлисту…" value="${esc(S.search)}"></div>
    <div class="chips">${chips}</div>
    ${grid}
  </section>`;
}

/* ============================ ideas ============================ */

function ideaList() {
  const uid = S.ideasTab === "mine" ? S.me : S.data.partner;
  let items = (S.data.ideas || []).filter((i) => i.userId === uid);
  const q = S.search.trim().toLowerCase();
  if (q) items = items.filter((i) => (i.title + " " + (i.category || "")).toLowerCase().includes(q));
  return items;
}

function viewIdeas() {
  const ideas = ideaList();
  const rows = ideas.map((it) => `<div class="row">
    <div class="row-avatar" ${it.image ? `style="background-image:url('${esc(it.image)}')"` : ""}></div>
    <div class="row-main">
      <div class="row-title">${esc(it.title)}</div>
      <div class="row-sub">${[it.category, it.price, it.priority ? PRIORITY[it.priority] : ""].filter(Boolean).join(" · ") || "идея"}</div>
    </div>
    <button class="icon-small" data-action="to-item" data-id="${esc(it.id)}" title="Перенести в вишлист">${icons.gift}</button>
    <button class="icon-small" data-action="del-idea" data-id="${esc(it.id)}" title="Удалить">${icons.x}</button>
  </div>`).join("");

  const gen = S.data.partner ? `<button class="btn primary" data-action="gen-ideas" style="margin-bottom:12px">${icons.dice} Подобрать идеи для партнёра</button>` : "";
  return `<section class="view" style="display:none">
    ${topbar("Идеи подарков", "копилка и генератор идей")}
    ${gen}
    <div class="card" style="padding:14px;margin-bottom:14px">
      <div class="field"><label>Новая идея</label>
        <input data-action="idea-title" placeholder="Что-нибудь классное…" maxlength="200"></div>
      <div class="row-2">
        <div class="field"><label>Ссылка (необязательно)</label>
          <input data-action="idea-link" placeholder="https://…"></div>
        <div class="field"><label>Цена</label>
          <input data-action="idea-price" placeholder="напр. 1 500 ₽"></div>
      </div>
      <div class="row-2">
        <div class="field"><label>Категория</label>
          <select data-action="idea-cat">${["", ...catList()].map((c) => `<option value="${esc(c)}">${esc(c || "—")}</option>`).join("")}</select></div>
        <div class="field"><label>Приоритет</label>
          <select data-action="idea-prio">${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
      </div>
      <button class="btn primary" data-action="add-idea">Сохранить идею</button>
    </div>
    ${rows ? `<div class="list">${rows}</div>` : `<div class="empty"><span class="emo">💡</span>Пока нет идей. Добавьте первую — это не обязательно для подарка.</div>`}
  </section>`;
}

function genIdeas() {
  const d = S.data;
  const pool = [];
  const bank = [
    "Сертификат в любимую кофейню", "Книга от любимого автора", "Уютный плед", "Светильник с тёплым светом",
    "Мастер-класс по гончарному делу", "Набор ароматических свечей", "Подписка на стриминговый сервис",
    "Романтический ужин при свечах", "Пикник в парке с корзинкой", "Поездка на выходные в другой город",
    "Киновечер с любимыми фильмами и попкорном", "Игровой вечер с настолками", "Расслабляющий спа-день дома",
    "Новая кружка необычной формы", "Органайзер для рабочего стола", "Фотокнига с нашими воспоминаниями",
    "Билеты в театр", "Билеты на концерт любимой группы", "Комнатное растение в кашпо", "Набор для рисования",
    "Электрический чайник необычного цвета", "Худи с любимым персонажем", "Домашний венок своими руками",
    "Неделя готовки: я готовлю каждый вечер", "Утренний кофе в постель", "Совместная фотосессия",
    "Компактный зарядный пауэрбанк", "Тёплые носки ручной вязки", "Настольный фонтанчик", "Мини-проектор для кино",
  ];
  for (const it of d.ideas) {
    if (it.userId !== S.me && it.title) pool.push(it.title);
    if (it.title) pool.push("по мотивам идеи: " + it.title);
  }
  const all = pool.length ? pool : bank;
  const pick = [...all].sort(() => Math.random() - 0.5).slice(0, 5);
  const m = openModal(`<div class="empty" style="padding:6px 0"><span class="emo">🎲</span>Подборка для <b>${esc(partnerName())}</b></div>
    <div class="list">${pick.map((t) => `<button class="row" data-action="prefill-idea" data-title="${esc(t)}" style="width:100%;text-align:left">
      <div class="row-main"><div class="row-title">${esc(t)}</div></div><span style="color:var(--accent)">добавить ›</span>
    </button>`).join("")}</div>
    <div class="modal-btns"><button class="btn" data-action="gen-again">${icons.dice} Перемешать</button></div>`, "Генератор идей");
  m._genPick = pick;
  return pick;
}

/* ============================ calendar ============================ */

function countdown(ts) {
  const days = Math.ceil((ts - Date.now()) / 86400000);
  if (days > 1) return `через ${days} дн`;
  if (days === 1) return "завтра";
  if (days === 0) return "сегодня 🎉";
  return "прошло";
}

function viewCalendar() {
  const evs = [...(S.data.events || [])].sort((a, b) => a.dateTs - b.dateTs);
  const today = new Date().toDateString();
  const rows = evs.map((e) => {
    const isToday = new Date(e.dateTs).toDateString() === today;
    const due = e.dateTs <= Date.now();
    return `<div class="card ev" style="padding:14px;margin-bottom:10px">
      <div class="ev-card-bg"></div>
      <div style="display:flex;align-items:center;gap:12px;position:relative">
        <div style="text-align:center;flex:none;min-width:58px">
          <div style="font-size:22px;font-weight:900">${fmt.format(e.dateTs)}</div>
          <div class="ev-count ${isToday ? "today" : ""}">${countdown(e.dateTs)}</div>
        </div>
        <div class="row-main">
          <div style="font-weight:800">${esc(e.title)}</div>
          ${e.card ? `<div style="font-size:12.5px;color:var(--text2);margin-top:2px">${esc(e.card.slice(0, 60))}</div>` : ""}
        </div>
        ${due ? `<button class="btn small primary" data-action="open-card" data-id="${esc(e.id)}">Открытка</button>` : ""}
        <button class="icon-small" data-action="del-event" data-id="${esc(e.id)}" title="Удалить">${icons.x}</button>
      </div>
    </div>`;
  }).join("");
  return `<section class="view" style="display:none">
    ${topbar("Календарь дат", "дни рождения, годовщины и праздники")}
    <div class="card" style="padding:14px;margin-bottom:14px">
      <div class="row-2">
        <div class="field"><label>Событие</label><input data-action="ev-title" placeholder="День рождения" maxlength="120"></div>
        <div class="field"><label>Дата и время</label><input data-action="ev-date" type="datetime-local"></div>
      </div>
      <div class="field"><label>Текст открытки (необязательно)</label><textarea data-action="ev-card" placeholder="С днём рождения, любимая…" maxlength="400"></textarea></div>
      <button class="btn primary" data-action="add-event">Добавить событие</button>
    </div>
    ${rows || `<div class="empty"><span class="emo">📅</span>Добавьте важные даты — бот напомнит о них.</div>`}
  </section>`;
}

/* ============================ history & recap ============================ */

function viewHistory() {
  const rows = S.data.history.map((it) => `<div class="row">
    <div class="row-avatar" ${(it.giftedPhoto || it.image) ? `style="background-image:url('${esc(it.giftedPhoto || it.image)}')"` : ""}></div>
    <div class="row-main">
      <div class="row-title">${esc(it.title)}</div>
      <div class="row-sub">🎀 вручено ${it.giftedAt ? new Date(it.giftedAt).toLocaleDateString("ru-RU") : ""} · дарил(а) ${it.giftedBy ? esc(S.data.names[it.giftedBy] || "кто-то") : "?"}</div>
    </div>
    <button class="icon-small" data-action="del-history" data-id="${esc(it.id)}" title="Удалить из истории">${icons.x}</button>
  </div>`).join("");
  return `<section class="view" style="display:none">
    ${topbar("История подарков", "что уже вручили")}
    ${rows ? `<div class="list">${rows}</div>` : `<div class="empty"><span class="emo">🎀</span>Здесь появятся вручённые подарки с фото.</div>`}
  </section>`;
}

function viewRecap() {
  const d = S.data;
  const mine = d.wishlist.filter((i) => i.userId === S.me);
  const total = mine.length + d.history.length;
  const bought = mine.filter((i) => i.bought).length + d.history.length;
  const gifted = d.history.length;
  const cats = {};
  [...d.wishlist, ...d.history].forEach((i) => { if (i.category) cats[i.category] = (cats[i.category] || 0) + 1; });
  const topCat = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
  const months = {};
  [...d.wishlist, ...d.history].forEach((i) => { const m = new Date(i.createdAt).getMonth(); months[m] = (months[m] || 0) + 1; });
  const topMonth = Object.entries(months).sort((a, b) => b[1] - a[1])[0];
  const mNames = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
  return `<section class="view" style="display:none">
    ${topbar("Рекап года", `итоги ${new Date().getFullYear()} года`)}
    <div class="stat-grid">
      <div class="card stat-card"><div class="stat-num">${total}</div><div class="stat-lbl">загадано подарков</div></div>
      <div class="card stat-card"><div class="stat-num">${bought}</div><div class="stat-lbl">куплено</div></div>
      <div class="card stat-card"><div class="stat-num">${gifted}</div><div class="stat-lbl">вручено</div></div>
      <div class="card stat-card"><div class="stat-num">${d.events.length}</div><div class="stat-lbl">отмечено дат</div></div>
    </div>
    <div class="card" style="padding:14px;margin-bottom:14px">
      <div style="font-weight:800;margin-bottom:10px">Интересное</div>
      <div style="font-size:13.5px;line-height:1.9">
        ${topCat ? `🗂 Любимая категория: <b>${esc(topCat[0])}</b> (${topCat[1]})<br>` : ""}
        ${topMonth ? `🗓 Самый активный месяц: <b>${mNames[topMonth[0]]}</b> (${topMonth[1]})<br>` : ""}
        💝 Идей в копилке: <b>${d.ideas.length}</b><br>
        🤝 Партнёр загадал: <b>${d.wishlist.filter((i) => i.userId !== S.me).length}</b><br>
        ${gifted ? `📸 Фото вручений: <b>${d.history.filter((h) => h.giftedPhoto).length}</b>` : ""}
      </div>
    </div>
    <button class="btn primary" data-action="export">📋 Поделиться вишлистом</button>
  </section>`;
}

/* ============================ profile ============================ */

function viewProfile() {
  const d = S.data;
  const bgs = d.backgrounds || [];
  const evs = d.events.map((e) => `<div class="row"><div class="row-main"><div class="row-title">${esc(e.title)}</div>
    <div class="row-sub">${fmtFull.format(e.dateTs)}</div></div>
    <button class="icon-small" data-action="del-event" data-id="${esc(e.id)}">${icons.x}</button></div>`).join("");
  const theme = localStorage.getItem("wltheme") || "auto";
  const ach = achievements();
  const achHTML = ach.map((a) => `<div class="ach-item">
    <div class="ach-ico ${a.ok ? "" : "locked"}">${a.ico}</div>
    <div class="row-main"><div style="font-weight:700">${esc(a.t)}</div><div style="font-size:12.5px;color:var(--text2)">${esc(a.d)}</div></div>
    ${a.ok ? `<div class="ach-done">✓</div>` : ""}
  </div>`).join("");
  const themeSel = (v, lbl) => `<button class="chip ${theme === v ? "active" : ""}" data-action="theme" data-val="${v}">${lbl}</button>`;

  return `<section class="view" style="display:none">
    ${topbar("Моё", `${esc(myName())} × ${esc(S.data.partner || "—")}`)}
    <div class="card" style="padding:14px;margin-bottom:14px">
      <div class="section-title" style="margin-top:0">Тема</div>
      <div class="chips">${themeSel("auto", "Авто")}${themeSel("light", "Светлая")}${themeSel("dark", "Тёмная")}</div>
      <div class="section-title">Фон приложения</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        ${bgs.length ? bgs.map((b, i) => `<button class="icon-small" data-action="bg-set" data-index="${i}" data-url="${esc(b.url)}" title="Поставить фон"
          style="width:64px;height:64px;border-radius:14px;background-image:url('${esc(b.url)}');background-size:cover;${i === d.backgroundIndex ? "outline:3px solid var(--accent);outline-offset:2px" : ""}"></button>`).join("") : `<span style="font-size:13px;color:var(--text2)">Фонов пока нет</span>`}
        <label class="icon-small" style="cursor:pointer" title="Добавить фон">
          ${icons.cam}<input type="file" accept="image/*" hidden data-action="bg-add">
        </label>
      </div>
      <div class="divider"></div>
      <div class="section-title">Категории</div>
      <div class="chips">
        ${catList().map((c) => `<button class="chip" data-action="del-cat" data-val="${esc(c)}">${esc(c)} ✕</button>`).join("")}
        <button class="chip add" data-action="add-cat">+</button>
      </div>
    </div>
    <div class="section-title">События и открытки</div>
    <div class="card" style="padding:14px;margin-bottom:14px">
      ${evs || `<span style="font-size:13.5px;color:var(--text2)">Событий нет — добавьте в разделе «Даты».</span>`}
    </div>
    <div class="section-title">Достижения</div>
    ${achHTML}
    <div class="divider"></div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <button class="btn" data-action="export">📋 Поделиться вишлистом</button>
      <button class="btn" data-action="offline">🛜 Проверить офлайн</button>
    </div>
    <div class="empty" style="padding-top:18px">Бот: <span class="small-link" data-action="open-bot">открыть в Telegram →</span></div>
  </section>`;
}

function achievements() {
  const d = S.data;
  const total = d.wishlist.length + d.history.length;
  const bought = d.wishlist.filter((i) => i.bought).length + d.history.length;
  return [
    { ico: "🌱", t: "Первое желание", d: "Добавить первый подарок", ok: total >= 1 },
    { ico: "📦", t: "Начинающий мечтатель", d: "Добавить 10 подарков", ok: total >= 10 },
    { ico: "💯", t: "Мечтатель 100", d: "Добавить 100 подарков", ok: total >= 100 },
    { ico: "🛍", t: "Первая покупка", d: "Отметить подарок купленным", ok: bought >= 1 },
    { ico: "🛒", t: "Шопоголик", d: "Купить 10 подарков", ok: bought >= 10 },
    { ico: "🎀", t: "Первое вручение", d: "Вручить первый подарок", ok: d.history.length >= 1 },
    { ico: "💡", t: "Генератор идей", d: "Добавить 10 идей", ok: d.ideas.length >= 10 },
    { ico: "📅", t: "Планировщик", d: "Добавить событие в календарь", ok: d.events.length >= 1 },
    { ico: "🖼", t: "Уют", d: "Установить общий фон", ok: d.backgrounds.length >= 1 },
    { ico: "💞", t: "Вдвоём", d: "Подарки в списке у обоих", ok: d.wishlist.filter((i) => i.userId !== S.me).length >= 1 },
  ];
}

/* ============================ add/edit item ============================ */

function openAddModal(prefill = {}) {
  const isIdea = S.view === "ideas";
  const mine = S.wlTab === "mine";
  const whoLabel = mine || !S.data.partner ? "в мой вишлист" : `в вишлист партнёра`;
  const p = prefill || {};
  const m = openModal(`
    <div class="field"><label>Что подарить *</label>
      <input data-action="f-title" maxlength="200" value="${esc(p.title || "")}" placeholder="Например, тёплый плед"></div>
    <div class="field"><label>Ссылка</label>
      <input data-action="f-link" value="${esc(p.link || "")}" placeholder="https://…"></div>
    <div class="field"><label>Фото</label>
      <div id="up-area"></div></div>
    <div class="row-2">
      <div class="field"><label>Категория</label>
        <input data-action="f-cat" value="${esc(p.category || "")}" placeholder="техника, косметика…" list="cat-datalist">
        <datalist id="cat-datalist">${catList().map((c) => `<option value="${esc(c)}">`).join("")}</datalist></div>
      <div class="field"><label>Цена</label>
        <input data-action="f-price" value="${esc(p.price || "")}" placeholder="напр. 2 000 ₽"></div>
    </div>
    <div class="row-2">
      <div class="field"><label>Приоритет</label>
        <select data-action="f-prio">${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}" ${p.priority === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div class="field"><label>Тип</label>
        <select data-action="f-type"><option value="gift" ${p.type !== "certificate" ? "selected" : ""}>Подарок</option>
        <option value="certificate" ${p.type === "certificate" ? "selected" : ""}>Сертификат</option></select></div>
    </div>
    <div class="field"><label>Голосовое пожелание</label><div id="rec-area"></div></div>
    <div class="modal-btns">
      <button class="btn primary" data-action="save-item">${isIdea ? "В копилку идей" : "Добавить в вишлист"}</button>
    </div>`, isIdea ? "Новая идея" : `Добавить подарок (${esc(whoLabel)})`);
  setupUpArea($("#up-area"), (url) => m._image = url);
  setupRecArea($("#rec-area"), (url) => m._voice = url);
  m._mode = isIdea ? "ideas" : "wishlist";
  m._prefill = p;
  return m;
}

function setupUpArea(area, onSet) {
  area._onSet = onSet;
  area.innerHTML = `<label class="upload-drop" style="display:block;cursor:pointer">${icons.cam} Выбрать фото<input type="file" accept="image/*" hidden data-action="pick-photo"></label>`;
  const inp = area.querySelector("input");
  inp.addEventListener("change", async () => {
    const file = inp.files[0];
    if (!file) return;
    try {
      const cropped = await openCropper(file);
      const url = await uploadFile(cropped);
      onSet(url);
      area.innerHTML = `<div class="upload-preview"><img src="${esc(url)}" alt=""><button class="upload-remove" data-action="remove-photo">${icons.x}</button></div>`;
    } catch (e) { toast(e.message || "Не удалось загрузить фото"); }
  });
}
function removePhoto(area) {
  area._onSet && area._onSet("");
  area.innerHTML = "";
  setupUpArea(area, area._onSet);
}

function setupRecArea(area, onSet) {
  area.innerHTML = `<button class="btn small" data-action="start-rec">${icons.mic} Записать голосовое</button>`;
  area._onSet = onSet;
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia) { toast("Запись не поддерживается"); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { toast("Нет доступа к микрофону"); return; }
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const m = openModal(`<div class="rec-bar"><span class="rec-dot"></span><span class="rec-time">0:00</span>
    <button class="btn small danger" data-action="stop-rec" style="margin-left:auto">${icons.stop} Готово</button></div>`, "Запись голосового");
  const t0 = Date.now();
  const timer = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    $(".rec-time", m).textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }, 250);
  rec.start();
  m._stopRec = async () => {
    clearInterval(timer);
    rec.stop();
    stream.getTracks().forEach((t) => t.stop());
    await new Promise((r) => rec.onstop = r);
    const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
    closeModal();
    try {
      const url = await uploadFile(blob);
      const area = $("#rec-area");
      area.innerHTML = `<div class="voice-play"><button class="icon-small" data-action="play-voice">${icons.play}</button>
        <audio src="${esc(url)}" controls preload="none"></audio>
        <button class="icon-small" data-action="del-voice">${icons.x}</button></div>`;
      area._onSet(url);
      hapticOk();
    } catch (e) { toast(e.message || "Не удалось загрузить запись"); }
  };
  return m;
}

function saveEdit(m) {
  const id = m._id;
  const [it, kind] = itemById(id);
  if (!it) return;
  const g = (a) => $("[data-action=" + a + "]", m)?.value || "";
  const payload = {
    title: g("e-title").trim() || it.title,
    link: g("e-link"),
    category: g("e-cat"),
    price: g("e-price"),
    priority: g("e-prio") || it.priority,
    note: g("e-note"),
  };
  const path = kind === "ideas" ? "/api/ideas/" : kind === "history" ? "/api/history/" : "/api/items/";
  api(path + id, { method: "PATCH", body: JSON.stringify(payload) }).then((d) => {
    if (d.ok) { S.data = d; closeModal(); hapticOk(); render(); }
    else toast(d.error || "Ошибка");
  });
}

function saveSurprise(m) {
  const id = m._id;
  const chk = $("[data-action=f-surprise]", m)?.checked || false;
  const rev = $("[data-action=f-reveal]", m)?.value || "";
  let revealDate = 0;
  if (chk && rev) {
    const ts = new Date(rev).getTime();
    if (ts > Date.now()) revealDate = ts;
  }
  patchItem(id, { surprise: chk, revealDate });
}

async function saveItemFromModal(m) {
  const g = (a) => $("[data-action=" + a + "]", m)?.value || "";
  const title = g("f-title").trim();
  if (!title) { toast("Введите название"); return; }
  const payload = {
    title,
    link: g("f-link"),
    category: g("f-cat"),
    price: g("f-price"),
    priority: g("f-prio"),
    type: g("f-type"),
    image: m._image || "",
    voice: m._voice || "",
    surprise: false,
    revealDate: 0,
  };
  const btn = $("[data-action=save-item]", m);
  btn.disabled = true; btn.textContent = "Сохраняю…";
  const d = await api("/api/items", { method: "POST", body: JSON.stringify(Object.assign({ kind: m._mode }, payload)) });
  if (!d.ok) { toast(d.error || "Ошибка"); btn.disabled = false; return; }
  S.data = d;
  closeModal();
  hapticOk();
  confetti(24);
  render();
}

/* ============================ item detail ============================ */

function itemById(id) {
  for (const k of ["wishlist", "ideas", "history"]) {
    const it = (S.data[k] || []).find((i) => i.id === id);
    if (it) return [it, k];
  }
  return [null, null];
}

function openItem(id) {
  const [it, kind] = itemById(id);
  if (!it) return;
  const d = S.data;
  const isMine = it.userId === S.me;
  const bought = it.bought;
  const reactionsHTML = `<div class="reactions">
    ${["❤️", "👍", "🔥", "😂", "🎉", "🥰"].map((e) => {
      const mine = it.reactions && it.reactions[S.me] === e;
      return `<button class="react-btn ${mine ? "mine" : ""}" data-action="react" data-id="${esc(id)}" data-emoji="${e}">${e}</button>`;
    }).join("")}
  </div>
  ${Object.keys(it.reactions || {}).length ? `<div class="react-count">${Object.entries(it.reactions).map(([u, e]) => esc(S.data.names[u] || u) + " " + e).join(" · ")}</div>` : ""}`;
  const actions = [];
  if (it.link) actions.push(`<button class="btn" data-action="open-link" data-link="${esc(it.link)}">🔗 Открыть ссылку</button>`);
  if (kind === "wishlist") {
    if (isMine && !it.bought) actions.push(`<button class="btn ${it.pinned ? "" : "primary"}" data-action="toggle-pin" data-id="${esc(id)}">${it.pinned ? "📌 Открепить" : "📌 Закрепить"}</button>`);
    if (!isMine && !bought) {
      actions.push(`<button class="btn primary" data-action="buy" data-id="${esc(id)}">🛍 Купил(а)!</button>`);
      actions.push(`<button class="btn" data-action="copy" data-id="${esc(id)}">${icons.copy} Мне тоже</button>`);
    }
    if (bought && !it.gifted && !isMine) actions.push(`<button class="btn primary" data-action="gift" data-id="${esc(id)}">🎀 Вручил(а)!</button>`);
    if (bought && !it.gifted && isMine) actions.push(`<button class="btn" data-action="unbuy" data-id="${esc(id)}">Вернуть в «не куплено»</button>`);
    if (it.gifted) actions.push(`<button class="btn small-link" data-action="restore-history" data-id="${esc(id)}">Вернуть в вишлист</button>`);
  }
  if (isMine) {
    actions.push(`<button class="btn" data-action="edit-item" data-id="${esc(id)}">✏️ Редактировать</button>`);
    actions.push(`<button class="btn danger" data-action="del-item" data-id="${esc(id)}">Удалить</button>`);
  } else if (kind !== "history") {
    actions.push(`<button class="btn" data-action="del-item" data-id="${esc(id)}">Удалить</button>`);
  }
  const img = it.giftedPhoto || it.image;
  const meta = [];
  if (it.price) meta.push(`<span class="badge dark">💵 ${esc(it.price)}</span>`);
  if (it.priority) meta.push(`<span class="badge ${it.priority === "must" ? "grad" : "muted"}">${PRIORITY[it.priority]}</span>`);
  if (it.category) meta.push(`<span class="badge muted">${esc(it.category)}</span>`);
  if (it.type === "certificate") meta.push(`<span class="badge dark">🎫 сертификат</span>`);
  if (it.bought && it.boughtBy) meta.push(`<span class="badge ok">🛍 купил(а) ${esc(S.data.names[it.boughtBy] || "?")}</span>`);
  if (it.gifted && it.giftedAt) meta.push(`<span class="badge grad">🎀 вручено ${new Date(it.giftedAt).toLocaleDateString("ru-RU")}</span>`);
  if (it.surprise) meta.push(`<span class="badge warn">🎁 сюрприз до ${it.revealDate ? fmt.format(it.revealDate) : "открытия"}</span>`);

  const surpriseHTML = kind === "wishlist" && !isMine ? `
    <div class="card" style="padding:12px;margin-top:10px;background:var(--surface2)">
      <label class="switch" style="padding:0">
        <span class="lbl">🎁 Сюрприз: скрыть от ${esc(S.data.names[it.userId] || "получателя")} до даты</span>
        <span class="sw-track ${it.surprise ? "on" : ""}"><input type="checkbox" class="sw-hidden" data-action="f-surprise" ${it.surprise ? "checked" : ""}></span>
      </label>
      <div id="surprise-row" style="display:${it.surprise ? "block" : "none"};margin-top:10px">
        <input type="datetime-local" data-action="f-reveal" value="${it.revealDate ? toDateLocal(it.revealDate) : ""}">
        <button class="btn small primary" style="margin-top:8px" data-action="save-surprise">Сохранить сюрприз</button>
      </div>
    </div>` : "";

  const m = openModal(`
    ${img ? `<img class="detail-img" src="${esc(img)}" alt="">` : ""}
    <h3 class="detail-title">${esc(it.title)}</h3>
    ${meta.length ? `<div class="detail-meta">${meta.join("")}</div>` : ""}
    ${it.note ? `<div class="card" style="padding:12px;background:var(--surface2);font-size:14px;margin:10px 0">${esc(it.note)}</div>` : ""}
    ${it.voice ? `<div class="field"><label>Голосовое</label><audio src="${esc(it.voice)}" controls preload="none"></audio></div>` : ""}
    ${reactionsHTML}
    ${surpriseHTML}
    <div class="modal-btns">${actions.join("")}</div>`, kind === "history" ? "Вручённый подарок" : (isMine ? "Мой подарок" : "Подарок партнёра"));
  m._id = id;
}

function openCard(id) {
  const e = (S.data.events || []).find((x) => x.id === id);
  if (!e) return;
  openModal(`
    <div style="text-align:center;padding:14px 6px">
      <div style="font-size:52px;margin-bottom:10px">💌</div>
      <div style="font-weight:800;font-size:18px">${esc(e.title)}</div>
      <div style="color:var(--text2);font-size:13px;margin-top:4px">${fmtFull.format(e.dateTs)}</div>
      <div class="divider"></div>
      <div style="font-size:15px;line-height:1.7;white-space:pre-wrap">${esc(e.card || "С праздником! 🎉")}</div>
    </div>`);
}

function restoreHistory(id) {
  const [it] = itemById(id);
  if (!it) return;
  api("/api/items/" + id + "/restore", { method: "POST", body: JSON.stringify({ item: it }) }).then((d) => {
    if (d.ok) { S.data = d; closeModal(); toast("Возвращено в вишлист"); render(); }
  });
}

/* ============================ actions ============================ */

const actions = {
  "nav": (b) => go(b.dataset.view),
  "close-modal": () => closeModal(),
  "welcome-ok": (b) => { try { localStorage.setItem("wl_welcome_seen", "1"); } catch (e) {} closeModal(); },
  "confirm-ok": (b) => { const m = b.closest(".modal"); const fn = m._onOk; closeModal(); fn && fn(); },
  "wl-tab": (b) => { S.wlTab = b.dataset.val; S.wlFilter = "all"; S.search = ""; render(); },
  "filter": (b) => { S.wlFilter = b.dataset.val; render(); },
  "search": (b) => { S.search = b.value; render(); },
  "ideas-tab": (b) => { S.ideasTab = b.dataset.val; render(); },
  "open-item": (b) => openItem(b.dataset.id),
  "open-card": (b) => openCard(b.dataset.id),
  "add-cat": () => promptCat(),
  "del-cat": (b) => confirmModal(`Удалить категорию «${b.dataset.val}»?`, () =>
    api("/api/categories/" + encodeURIComponent(b.dataset.val) + "/delete", { method: "POST" }).then((d) => { if (d.ok) { S.data = d; render(); } })),
  "random": () => randomPick(),
  "add-idea": () => addIdeaQuick(),
  "gen-ideas": () => genIdeas(),
  "gen-again": (b) => { b.closest(".modal").remove(); genIdeas(); },
  "prefill-idea": (b) => { closeModal(); openAddModal({ title: b.dataset.title }); },
  "to-item": (b) => api("/api/ideas/" + b.dataset.id + "/to-item", { method: "POST" }).then((d) => { if (d.ok) { S.data = d; hapticOk(); render(); } }),
  "del-idea": (b) => confirmModal("Удалить идею?", () =>
    api("/api/ideas/" + b.dataset.id + "/delete", { method: "POST" }).then((d) => { if (d.ok) { S.data = d; render(); } })),
  "del-history": (b) => confirmModal("Удалить из истории?", () =>
    api("/api/history/" + b.dataset.id + "/delete", { method: "POST" }).then((d) => { if (d.ok) { S.data = d; render(); } })),
  "add-event": (b) => addEventQuick(),
  "del-event": (b) => api("/api/events/" + b.dataset.id + "/delete", { method: "POST" }).then((d) => { if (d.ok) { S.data = d; render(); } }),
  "theme": (b) => setTheme(b.dataset.val),
  "bg-set": (b) => api("/api/background/set", { method: "POST", body: JSON.stringify({ index: +b.dataset.index }) }).then((d) => { if (d.ok) { S.data = d; applyBackground(); toast("Фон обновлён"); } }),
  "bg-add": (b) => pickBackground(b),
  "export": () => exportList(),
  "reload": () => { try { tg?.HapticFeedback?.notificationOccurred?.("warning"); } catch (e) {} location.reload(); },
  "open-bot": () => { try { tg?.openTelegramLink?.("https://t.me/" + (window.WL_BOT || "")); } catch (e) {} },
  "offline": () => toast(navigator.onLine ? "Вы онлайн 🌐" : "Вы офлайн — работает из кэша"),
  "f-surprise": (b) => {
    const row = b.closest(".modal")?.querySelector("#surprise-row");
    if (row) row.style.display = b.checked ? "block" : "none";
    const tr = b.closest(".switch")?.querySelector(".sw-track");
    tr && tr.classList.toggle("on", b.checked);
  },
  "save-item": (b) => saveItemFromModal(b.closest(".modal")),
  "save-edit": (b) => saveEdit(b.closest(".modal")),
  "save-surprise": (b) => saveSurprise(b.closest(".modal")),
  "crop-ok": (b) => { const m = b.closest(".modal"); m._crop && m._crop(); },
  "pick-photo": () => { },
  "remove-photo": (b) => removePhoto(b.closest("#up-area") || b.closest(".modal")),
  "start-rec": () => startRecording(),
  "stop-rec": (b) => { const m = b.closest(".modal"); m._stopRec && m._stopRec(); },
  "play-voice": () => {},
  "del-voice": (b) => { const area = b.closest("#rec-area"); if (area) { setupRecArea(area, area._onSet); area._onSet(""); } },
  "react": (b) => toggleReact(b.dataset.id, b.dataset.emoji),
  "open-link": (b) => { try { tg?.openLink(b.dataset.link); } catch (e) { window.open(b.dataset.link, "_blank"); } },
  "toggle-pin": (b) => patchItem(b.dataset.id, { pinned: !itemById(b.dataset.id)[0].pinned }),
  "buy": (b) => { hapticOk(); patchItem(b.dataset.id, { bought: true }); confetti(30); },
  "unbuy": (b) => patchItem(b.dataset.id, { bought: false }),
  "copy": (b) => api("/api/items/" + b.dataset.id + "/copy", { method: "POST" }).then((d) => { if (d.ok) { S.data = d; closeModal(); hapticOk(); toast("Добавлено «мне тоже»"); render(); } }),
  "gift": (b) => openGiftModal(b.dataset.id),
  "restore-history": (b) => restoreHistory(b.dataset.id),
  "edit-item": (b) => openEditModal(b.dataset.id),
  "del-item": (b) => doDelete(b),
  "gift-photo": (b) => { const m = b.closest(".modal"); const f = $("#gift-file", m).files[0]; m._giftPhoto(f); },
  "gift-confirm": (b) => { const m = b.closest(".modal"); m._onGift(); },
};

function promptCat() {
  const name = prompt("Название категории:");
  if (!name || !name.trim()) return;
  api("/api/categories", { method: "POST", body: JSON.stringify({ name: name.trim() }) }).then((d) => {
    if (d.ok) { S.data = d; render(); }
  });
}

function addIdeaQuick() {
  const title = $("#main [data-action=idea-title]")?.value?.trim();
  if (!title) { toast("Введите название идеи"); return; }
  const payload = {
    title,
    link: $("#main [data-action=idea-link]")?.value,
    category: $("#main [data-action=idea-cat]")?.value,
    price: $("#main [data-action=idea-price]")?.value,
    priority: $("#main [data-action=idea-prio]")?.value,
  };
  api("/api/items", { method: "POST", body: JSON.stringify(Object.assign({ kind: "ideas" }, payload)) }).then((d) => {
    if (d.ok) {
      S.data = d;
      ["idea-title", "idea-link", "idea-price"].forEach((n) => { const x = $("#main [data-action=" + n + "]"); if (x) x.value = ""; });
      hapticOk();
      render();
    } else toast(d.error);
  });
}

function addEventQuick() {
  const title = $("#main [data-action=ev-title]")?.value?.trim();
  const dateVal = $("#main [data-action=ev-date]")?.value;
  const card = $("#main [data-action=ev-card]")?.value?.trim() || "";
  if (!title || !dateVal) { toast("Заполните название и дату"); return; }
  const ts = new Date(dateVal).getTime();
  api("/api/events", { method: "POST", body: JSON.stringify({ title, dateTs: ts, card }) }).then((d) => {
    if (d.ok) {
      S.data = d;
      ["ev-title", "ev-date", "ev-card"].forEach((n) => { const x = $("#main [data-action=" + n + "]"); if (x) x.value = ""; });
      hapticOk();
      render();
    } else toast(d.error);
  });
}

function patchItem(id, payload) {
  const [it, kind] = itemById(id);
  if (!it) return;
  const old = JSON.parse(JSON.stringify(it));
  Object.assign(it, payload);
  if (kind === "wishlist") {
    if (payload.bought === true) { it.bought = true; it.boughtBy = S.me; it.boughtAt = Date.now(); }
    if (payload.bought === false) { it.bought = false; it.boughtBy = ""; }
  }
  closeModal();
  render();
  const path = kind === "ideas" ? "/api/ideas/" : kind === "history" ? "/api/history/" : "/api/items/";
  api(path + id, { method: "PATCH", body: JSON.stringify(payload) }).then((d) => {
    if (d.ok) { S.data = d; render(); }
    else { Object.assign(it, old); toast(d.error || "Ошибка"); render(); }
  });
}

function toggleReact(id, emoji) {
  const [it] = itemById(id);
  if (!it) return;
  const cur = it.reactions?.[S.me];
  const next = cur === emoji ? "" : emoji;
  patchItem(id, { reactions: next });
}

function randomPick() {
  const theirs = (S.data.wishlist || []).filter((i) => i.userId !== S.me && !i.bought && !i.gifted);
  if (!theirs.length) { toast("В списке партнёра пока нет идей"); return; }
  const pick = theirs[Math.floor(Math.random() * theirs.length)];
  openItem(pick.id);
}

function doDelete(b) {
  const id = b.dataset.id;
  const [it, kind] = itemById(id);
  if (!it) return;
  confirmModal(`Удалить «${it.title}»?`, () => {
    const path = kind === "ideas" ? "/api/ideas/" : kind === "history" ? "/api/history/" : "/api/items/";
    api(path + id + "/delete", { method: "POST" }).then((d) => {
      if (d.ok) {
        S.data = d;
        S.lastDeleted = { item: it, kind };
        toast("Удалено", "Отменить", undoDelete, 5000);
        closeModal();
        render();
      }
    });
  }, "Удалить", true);
}

function undoDelete() {
  if (!S.lastDeleted) return;
  const it = S.lastDeleted.item;
  api("/api/items/" + it.id + "/restore", { method: "POST", body: JSON.stringify({ item: it, kind: S.lastDeleted.kind || "wishlist" }) }).then((d) => {
    if (d.ok) { S.data = d; S.lastDeleted = null; hapticOk(); render(); }
  });
}

function openGiftModal(id) {
  const [it] = itemById(id);
  if (!it) return;
  const m = openModal(`
    <p style="font-size:15px">Поздравляем с покупкой «${esc(it.title)}»! 🎉 Добавьте фото вручения:</p>
    <label class="upload-drop" style="display:block;cursor:pointer;margin-bottom:12px">${icons.cam} Выбрать фото<input type="file" accept="image/*" id="gift-file" hidden></label>
    <div class="modal-btns">
      <button class="btn primary" data-action="gift-confirm">🎀 Вручил(а)!</button>
      <button class="btn" data-action="close-modal">Позже</button>
    </div>`, "Вручение подарка");
  m._giftPhoto = (file) => {
    if (!file) return;
    uploadFile(file).then((url) => {
      api("/api/items/" + id + "/gift", { method: "POST", body: JSON.stringify({ photo: url }) }).then((d) => {
        if (d.ok) { S.data = d; closeModal(); hapticOk(); confetti(50); toast("Подарок вручён! 🎀"); render(); }
      });
    }).catch((e) => toast(e.message));
  };
  m._onGift = () => m._giftPhoto($("#gift-file", m)?.files[0]);
  $("#gift-file", m)?.addEventListener("change", () => m._giftPhoto($("#gift-file", m)?.files[0]));
}

function openEditModal(id) {
  const [it] = itemById(id);
  if (!it) return;
  const m = openModal(`
    <div class="field"><label>Название</label><input data-action="e-title" value="${esc(it.title)}" maxlength="200"></div>
    <div class="field"><label>Ссылка</label><input data-action="e-link" value="${esc(it.link || "")}"></div>
    <div class="field"><label>Цена</label><input data-action="e-price" value="${esc(it.price || "")}"></div>
    <div class="field"><label>Категория</label><input data-action="e-cat" value="${esc(it.category || "")}" list="cat-datalist2">
      <datalist id="cat-datalist2">${catList().map((c) => `<option value="${esc(c)}">`).join("")}</datalist></div>
    <div class="field"><label>Приоритет</label>
      <select data-action="e-prio">${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}" ${it.priority === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    <div class="field"><label>Заметка</label><textarea data-action="e-note" maxlength="1000">${esc(it.note || "")}</textarea></div>
    <div class="modal-btns">
      <button class="btn primary" data-action="save-edit">Сохранить</button>
    </div>`, "Редактировать");
  m._id = id;
}

/* ============================ export ============================ */

function exportList() {
  const lines = (S.data.wishlist || []).map((i) => `${i.title}${i.price ? " — " + i.price : ""}${i.link ? " " + i.link : ""}`);
  const text = "🎁 Мой вишлист:\n" + (lines.join("\n") || "пока пуст");
  const copy = () => {
    if (navigator.clipboard) return navigator.clipboard.writeText(text);
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove();
    return Promise.resolve();
  };
  copy().then(() => toast("Вишлист скопирован 📋")).catch(() => toast("Не удалось скопировать"));
}

/* ============================ backgrounds & theme ============================ */

function applyBackground() {
  const d = S.data;
  const bgs = d?.backgrounds || [];
  const img = bgs[d.backgroundIndex];
  const wall = $("#bgwall-img");
  if (wall) {
    if (img?.url) wall.style.backgroundImage = `url('${img.url}')`;
    else wall.style.backgroundImage = "";
  }
}

function setTheme(t) {
  localStorage.setItem("wltheme", t);
  applyTheme();
  render();
}
function applyTheme() {
  const t = localStorage.getItem("wltheme") || "auto";
  const dark = t === "dark" || (t === "auto" && (tg?.colorScheme === "dark" || window.matchMedia?.("(prefers-color-scheme: dark)").matches));
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

function pickBackground(input) {
  const file = input.files[0];
  if (!file) return;
  uploadFile(file).then((url) => {
    api("/api/background", { method: "POST", body: JSON.stringify({ url }) }).then((d) => {
      if (d.ok) { S.data = d; applyBackground(); toast("Фон добавлен"); render(); }
    });
  }).catch((e) => toast(e.message));
}

/* ============================ cropper ============================ */

function openCropper(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const RATIO = 3 / 4;
      const m = openModal(`<div id="crop-wrap" style="position:relative;overflow:hidden;border-radius:14px;touch-action:none;user-select:none"></div>
        <div style="display:flex;align-items:center;gap:10px;margin:10px 0">
          <span style="font-size:12px;color:var(--text2)">масштаб</span>
          <input type="range" id="crop-zoom" min="1" max="3" step="0.05" value="1" style="flex:1">
        </div>
        <div class="modal-btns"><button class="btn primary" data-action="crop-ok">Обрезать и продолжить</button></div>`, "Обрезка фото");
      const wrap = $("#crop-wrap", m);
      const W = Math.min(460, wrap.clientWidth || 320);
      const H = W / RATIO;
      wrap.style.height = H + "px";
      const canvas = el("canvas"); canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");
      const draw = () => {
        ctx.clearRect(0, 0, W, H);
        const scale = +$("#crop-zoom", m)?.value || 1;
        const dispW = W * scale, dispH = dispW / img.width * img.height;
        const dx = state.dx, dy = state.dy;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(img, dx, dy, dispW, dispH);
        const off = (ctx, t) => { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.strokeRect(...t); };
        off(ctx, [0, 0, W, H]);
        const g = ctx.createLinearGradient(0, H * 0.35, 0, H * 0.75);
        g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(124,92,255,.28)");
        ctx.fillStyle = g; ctx.fillRect(0, H * 0.55, W, H * 0.2);
        wrap.appendChild(canvas);
      };
      const state = { dx: 0, dy: 0, sx: 0, sy: 0, tx: 0, ty: 0, drag: false };
      const dispDims = () => {
        const scale = +$("#crop-zoom", m)?.value || 1;
        const dispW = W * scale;
        const dispH = dispW / img.width * img.height;
        return [dispW, dispH];
      };
      wrap.addEventListener("pointerdown", (e) => { state.drag = true; state.sx = e.clientX; state.sy = e.clientY; state.tx = state.dx; state.ty = state.dy; wrap.setPointerCapture(e.pointerId); });
      wrap.addEventListener("pointermove", (e) => {
        if (!state.drag) return;
        const [dispW, dispH] = dispDims();
        state.dx = Math.min(0, Math.max(W - dispW, state.tx + (e.clientX - state.sx)));
        state.dy = Math.min(0, Math.max(H - dispH, state.ty + (e.clientY - state.sy)));
        draw();
      });
      wrap.addEventListener("pointerup", () => state.drag = false);
      $("#crop-zoom", m)?.addEventListener("input", draw);
      draw();
      m._crop = () => {
        const [dispW, dispH] = dispDims();
        const scale = +$("#crop-zoom", m)?.value || 1;
        const sx = Math.max(0, -state.dx) / (dispW / img.width);
        const sy = Math.max(0, -state.dy) / (dispH / img.height);
        const sw = W / (dispW / img.width);
        const sh = H / (dispH / img.height);
        const out = document.createElement("canvas");
        out.width = 900; out.height = 1200;
        out.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, 900, 1200);
        out.toBlob((blob) => {
          URL.revokeObjectURL(url);
          resolve(blob);
        }, "image/jpeg", 0.88);
      };
    };
    img.onerror = () => reject(new Error("Не удалось открыть фото"));
    img.src = url;
  });
}

/* ============================ entry ============================ */

function showNeedBot(reason = "") {
  const inTg = Boolean(S.initData);
  const why = reason
    || (inTg
      ? "Сервер вишлиста недоступен. Возможно, открыта статическая копия — полная версия работает через бота."
      : "Этот мини-приложение открывается через Telegram-бота.");
  $("#main").innerHTML = `<section class="view" style="display:block">
    <div class="empty" style="padding-top:60px"><span class="emo">🤖</span>${esc(why)}<br>
    <button class="btn primary" style="margin-top:16px" data-action="reload">Повторить</button></div>
  </section>`;
  updateTabbar();
}

function bindGlobal() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const a = actions[btn.dataset.action];
    if (a) { e.preventDefault(); haptic(); a(btn, e); }
  });
  document.addEventListener("input", (e) => {
    if (e.target.dataset?.action === "search") S.search = e.target.value;
  });
  $("#fab").addEventListener("click", () => { haptic(); openAddModal(); });
  document.querySelectorAll(".tb-btn").forEach((b) => b.addEventListener("click", () => go(b.dataset.view)));
  try {
    tg?.BackButton?.onClick(() => back());
    tg?.onEvent?.("themeChanged", () => applyTheme());
  } catch (e) {}
  window.addEventListener("online", () => toast("Снова онлайн 🌐"));
  window.addEventListener("offline", () => toast("Вы офлайн — данные из кэша"));
}

function swRegister() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

async function boot() {
  try { tg?.expand?.(); tg?.ready?.(); } catch (e) {}
  bindGlobal();
  applyTheme();
  swRegister();
  const d = await loadData();
  if (!d?.ok) { showNeedBot(d.error ? `Ошибка: ${d.error}` : ""); return; }
  if (window.location.search.includes("initData")) history.replaceState(null, "", "/");
  try { if (localStorage.getItem("wl_welcome_seen")) return; } catch (e) {}
  const m = openModal(`<div style="display:flex;gap:12px;align-items:center;padding:8px 0">
    <div style="width:38px;height:38px;border-radius:12px;background:var(--grad);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800">🧡</div>
    <div><b>Добро пожаловать!</b><div style="font-size:13px;color:var(--text2)">Загадывайте желания и радуйте друг друга 🎁</div></div></div>
    <div class="modal-btns"><button class="btn primary" data-action="welcome-ok">Понятно</button></div>`);
  m._welcome = true;
}

boot();
