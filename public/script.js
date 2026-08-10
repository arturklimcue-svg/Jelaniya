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
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L20 8l-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
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
function closeModal() {
  const root = $("#modal-root");
  const last = root.lastElementChild;
  if (last && last.classList.contains("modal-mask")) last.remove();
}

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
  const t = file.type || "";
  let ext = "webm";
  if (t === "image/png") ext = "png";
  else if (t === "image/webp") ext = "webp";
  else if (t === "image/gif") ext = "gif";
  else if (t.startsWith("image/")) ext = "jpg";
  else if (t === "audio/ogg" || t === "audio/opus") ext = "ogg";
  else if (t === "audio/mp4" || t === "audio/m4a") ext = "m4a";
  else if (t === "audio/wav" || t === "audio/x-wav" || t === "audio/x-pn-wav") ext = "wav";
  let name = file.name || "file";
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += "." + ext;
  fd.append("file", file, name);
  return fetch("/api/upload?initData=" + encodeURIComponent(S.initData), { method: "POST", body: fd })
    .then((r) => r.json().catch(() => ({ ok: false, error: "Ошибка сервера при загрузке (HTTP " + r.status + ")" })))
    .then((b) => { if (!b.ok) throw new Error(b.error || "Ошибка загрузки"); return b.url; });
}

async function loadData(silent) {
  const d = await api("/api/data");
  if (d.ok) {
    S.data = d;
    S.me = d.me;
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
  else if (v === "plans") main.innerHTML = viewPlans();
  else if (v === "ideas") main.innerHTML = viewIdeas();
  else if (v === "profile") main.innerHTML = viewProfile();
  else { S.view = "home"; main.innerHTML = viewHome(); }
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
function partnerName() { const p = S.data?.partner; return (p && S.data.names?.[p]) || p || "партнёр"; }
function catList() { return S.data?.categories?.[S.me] || []; }
function catOptions(sel) {
  const cats = catList();
  const opts = cats.map((c) => `<option value="${esc(c)}" ${c === sel ? "selected" : ""}>${esc(c)}</option>`);
  if (sel && !cats.includes(sel)) opts.unshift(`<option value="${esc(sel)}" selected>${esc(sel)}</option>`);
  return opts.join("");
}
function bindCatNew(m, a, a2) {
  const sel = $("[data-action=" + a + "]", m);
  const inp = $("[data-action=" + a2 + "]", m);
  if (!sel || !inp) return;
  inp.style.display = sel.value === "__new__" ? "block" : "none";
  sel.addEventListener("change", () => { inp.style.display = sel.value === "__new__" ? "block" : "none"; });
}
function catFrom(m, a, a2) {
  const v = $("[data-action=" + a + "]", m)?.value || "";
  if (v !== "__new__") return v;
  return ($("[data-action=" + a2 + "]", m)?.value || "").trim();
}

/* ============================ home ============================ */

function viewHome() {
  const d = S.data;
  const meU = d.names[S.me] || "—";
  const paU = d.partner;
  const mine = d.wishlist.filter((i) => i.userId === S.me);
  const theirs = d.wishlist.filter((i) => i.userId !== S.me);
  const meDone = mine.filter((i) => i.bought).length;
  const thDone = theirs.filter((i) => i.bought).length;

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

  const plans = Object.entries(d.plans || {});
  const plansHTML = plans.length
    ? `<div class="list" style="margin-bottom:14px">${plans.slice(0, 5).map(([id, p]) => `
      <button class="row" data-action="open-plan" data-id="${esc(id)}" style="width:100%;text-align:left;cursor:pointer">
        <div class="row-avatar" ${p.src && p.src.image ? `style="background-image:url('${esc(p.src.image)}')"` : ""}></div>
        <div class="row-main">
          <div class="row-title">${esc((p.src && p.src.title) || "Без названия")}</div>
          <div class="row-sub">${esc(p.category || "Без категории")}${p.note ? " · " + esc(p.note) : ""}</div>
        </div>
        <span style="color:var(--accent)">›</span>
      </button>`).join("")}
    </div>
    <button class="btn" data-action="nav" data-view="plans" style="margin-bottom:14px">Все планы (${plans.length})</button>`
    : `<button class="card empty" data-action="nav" data-view="plans" style="cursor:pointer;width:100%;padding:14px;margin-bottom:14px;border:none;background:var(--surface);text-align:left">
      <span class="emo">🎁</span>Планов пока нет — отметьте подарок партнёра в вишлисте.<br><span class="small-link">Открыть вишлист партнёра →</span>
    </button>`;

  return `<section class="view" style="display:none">
    ${topbar("Вишлист вдвоём", "общий список подарков для двоих")}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      ${card(myName(), meDone, meDone, mine.length)}
      ${paU ? card(partnerName(), thDone, thDone, theirs.length) : `<div class="card empty" style="display:flex;flex-direction:column;justify-content:center">Нет партнёра.<br><span class="small-link">Расскажите второму открыть бота →</span></div>`}
    </div>
    <div class="section-title">Мои планы</div>
    ${plansHTML}
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
  if (it.userId !== S.me && (S.data.plans || {})[it.id]) badges.push(`<span class="badge grad">🎁 в планах</span>`);
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

/* ============================ plans ============================ */

function viewPlans() {
  const plans = Object.entries(S.data.plans || {});
  if (!plans.length) {
    return `<section class="view" style="display:none">
      ${topbar("Мои планы", "выбрано в подарок партнёру")}
      <div class="empty"><span class="emo">🎁</span>Здесь будут подарки, которые вы отметили из вишлиста ${esc(partnerName())}.<br>Откройте его подарок и нажмите «В планы».</div>
    </section>`;
  }
  const byCat = new Map();
  plans.forEach(([id, p]) => { const key = p.category || ""; (byCat.get(key) || byCat.set(key, []).get(key)).push([id, p]); });
  const order = [];
  if (byCat.has("")) order.push(["Без категории", byCat.get("")]);
  byCat.forEach((arr, key) => { if (key) order.push([key, arr]); });
  const rows = order.map(([title, arr], idx) => {
    const items = arr.map(([id, p]) => planCard(id, p)).join("");
    return `<div class="section-title" style="margin-top:${idx === 0 ? 0 : 18}px">${esc(title)}</div>${items}`;
  }).join("");
  return `<section class="view" style="display:none">
    ${topbar("Мои планы", `выбрано для ${esc(partnerName())}`)}
    ${rows}
  </section>`;
}

function planCard(id, p) {
  const src = p.src || {};
  const live = S.data.wishlist.find((i) => i.id === id && i.userId !== S.me);
  const img = live?.image || src.image;
  return `<div class="card" style="padding:12px;margin-bottom:10px">
    <div style="display:flex;gap:10px;align-items:flex-start">
      <div style="width:56px;height:56px;border-radius:10px;background-size:cover;background-position:center;flex:none;background-color:var(--surface2);background-image:url('${esc(img)}')"></div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700">${esc(src.title || "Без названия")}</div>
        <div style="font-size:12.5px;color:var(--text2)">${esc(src.price || "")}</div>
        ${p.note ? `<div style="font-size:13px;color:var(--text2);margin-top:4px">${esc(p.note)}</div>` : ""}
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      ${live && src.link ? `<button class="btn small" data-action="open-link" data-link="${esc(src.link)}">🔗 Открыть</button>` : ""}
      ${live ? `<button class="btn small" data-action="copy" data-id="${esc(id)}">${icons.copy} Мне тоже</button>` : ""}
      <button class="btn small danger" data-action="plan-remove" data-id="${esc(id)}">Убрать</button>
    </div>
  </div>`;
}

function openPlanModal(id) {
  const cur = (S.data.plans || {})[id];
  const m = openModal(`
    <div class="field"><label>Категория</label>
      <select data-action="plan-cat">${["", ...catList()].map((c) => `<option value="${esc(c)}" ${cur && cur.category === c ? "selected" : ""}>${esc(c || "—")}</option>`).join("")}</select>
    </div>
    <button class="chip add" style="margin-top:8px" data-action="plan-new-cat">+ новая категория</button>
    <div class="field" id="plan-new-row" style="display:none"><label>Новая категория</label><input data-action="plan-cat-new" placeholder="напр. Новый год" maxlength="60"></div>
    <div class="field"><label>Заметка</label><textarea data-action="plan-note" placeholder="например: «лампочка → подарю на Новый год»" maxlength="500">${esc(cur ? cur.note : "")}</textarea></div>
    <div class="modal-btns">
      <button class="btn" data-action="close-modal">Отмена</button>
      <button class="btn primary" data-action="plan-save" data-id="${esc(id)}">Сохранить</button>
    </div>`, "🎁 В планы");
  return m;
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

/* ============================ history ============================ */

function historyRows() {
  return S.data.history.map((it) => `<div class="row">
    <button class="row-avatar" data-action="open-item" data-id="${esc(it.id)}" ${(it.giftedPhoto || it.image) ? `style="background-image:url('${esc(it.giftedPhoto || it.image)}')"` : ""}></button>
    <button class="row-main" data-action="open-item" data-id="${esc(it.id)}" style="text-align:left;flex:1;min-width:0;background:none;border:none;padding:0;cursor:pointer">
      <div class="row-title">${esc(it.title)}</div>
      <div class="row-sub">🎀 вручено ${it.giftedAt ? new Date(it.giftedAt).toLocaleDateString("ru-RU") : ""} · дарил(а) ${it.giftedBy ? esc(S.data.names[it.giftedBy] || "кто-то") : "?"}</div>
    </button>
    <button class="icon-small" data-action="del-history" data-id="${esc(it.id)}" title="Удалить из истории">${icons.x}</button>
  </div>`).join("");
}

/* ============================ profile ============================ */

function interestRow(int, i) {
  return `<div class="row">
    <div class="row-main"><div class="row-title">${esc(int.name)}</div>
    ${int.buy ? `<div class="row-sub">🎁 ${esc(int.buy)}</div>` : ""}
    ${int.link ? `<button class="btn small" data-action="open-link" data-link="${esc(int.link)}" style="margin-top:6px">🔗 Открыть</button>` : ""}</div>
    <button class="icon-small" data-action="int-edit" data-index="${i}" title="Редактировать">${icons.edit}</button>
    <button class="icon-small" data-action="int-del" data-index="${i}" title="Убрать">${icons.x}</button>
  </div>`;
}

function interestModal(p = {}) {
  const m = openModal(`
    <div class="field"><label>Интерес / хобби</label>
      <input data-action="i-name" value="${esc(p.name || "")}" maxlength="60" placeholder="напр. вязание"></div>
    <div class="field"><label>Что купить (подсказка)</label>
      <input data-action="i-buy" value="${esc(p.buy || "")}" maxlength="120" placeholder="напр. пряжа, спицы"></div>
    <div class="field"><label>Ссылка на товар</label>
      <input data-action="i-link" value="${esc(p.link || "")}" maxlength="300" placeholder="https://…"></div>
    <div class="modal-btns">
      <button class="btn primary" data-action="i-save">Сохранить</button>
      <button class="btn" data-action="close-modal">Отмена</button>
    </div>`, p.name ? "Редактировать интерес" : "Новый интерес");
  m._index = typeof p._index === "number" ? p._index : -1;
  return m;
}

function saveInterests(list) {
  api("/api/interests", { method: "POST", body: JSON.stringify({ list }) }).then((d) => {
    if (d.ok) { S.data = d; hapticOk(); toast("Сохранено"); render(); }
    else toast(d.error || "Ошибка");
  });
}

function viewProfile() {
  const d = S.data;
  const myInt = (d.interests && d.interests[S.me]) || [];
  const paInt = d.partner ? ((d.interests && d.interests[d.partner]) || []) : [];
  const bgs = d.backgrounds || [];
  const theme = localStorage.getItem("wltheme") || "auto";
  const hist = historyRows();
  const themeSel = (v, lbl) => `<button class="chip ${theme === v ? "active" : ""}" data-action="theme" data-val="${v}">${lbl}</button>`;

  return `<section class="view" style="display:none">
    ${topbar("Моё", `${esc(myName())} × ${esc(partnerName())}`)}
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
    </div>
    <div class="section-title">Интересы и хобби</div>
    <div class="card" style="padding:14px;margin-bottom:14px">
      <div style="font-size:12.5px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.4px">Мои интересы</div>
      <div style="font-size:13px;color:var(--text2);margin:6px 0 10px">Добавьте увлечения и подсказки, что к ним подарить — партнёр увидит список</div>
      <div id="interests-list">${myInt.length
        ? `<div class="list">${myInt.map(interestRow).join("")}</div>`
        : `<div style="font-size:13px;color:var(--text2)">Пока пусто — добавьте первое увлечение.</div>`}</div>
      <button class="btn small" data-action="int-add" style="margin-top:10px">＋ Добавить интерес</button>
      <div class="divider"></div>
      <div style="font-size:13px;color:var(--text2)">Интересы <b>${esc(partnerName())}</b>:
        ${paInt.length ? `<div class="list" style="margin-top:8px">${paInt.map((x) => `<div class="row">
          <div class="row-main"><div class="row-title">${esc(x.name)}</div>
          ${x.buy ? `<div class="row-sub">🎁 ${esc(x.buy)}</div>` : `<div class="row-sub">—</div>`}
          ${x.link ? `<button class="btn small" data-action="open-link" data-link="${esc(x.link)}" style="margin-top:6px">🔗 Открыть</button>` : ""}</div>
        </div>`).join("")}</div>` : `<span> пока не добавил(а)</span>`}
      </div>
    </div>
    <div class="section-title">История подарков</div>
    <div class="card" style="padding:14px;margin-bottom:14px">
      ${hist ? `<div class="list">${hist}</div>` : `<span style="font-size:13.5px;color:var(--text2)">Вручённых подарков пока нет.</span>`}
    </div>
    <div class="section-title">Поделиться</div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <button class="btn" data-action="export">📋 Поделиться вишлистом</button>
      <button class="btn" data-action="export-csv">⬇️ Скачать CSV</button>
      <button class="btn" data-action="offline">🛜 Проверить офлайн</button>
    </div>
    <div class="empty" style="padding-top:18px">Бот: <span class="small-link" data-action="open-bot">открыть в Telegram →</span></div>
  </section>`;
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
        <select data-action="f-cat">${catOptions(p.category)}<option value="__new__">➕ Новая категория…</option></select>
        <input data-action="f-cat-new" placeholder="Название новой категории" style="display:none;margin-top:8px"></div>
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
    <div class="field"><label>Размер (необязательно)</label>
      <input data-action="f-size" value="${esc(p.size || "")}" placeholder="напр. 42 / M"></div>
    <div class="field"><label>Голосовое пожелание</label><div id="rec-area"></div></div>
    <div class="modal-btns">
      <button class="btn primary" data-action="save-item">${isIdea ? "В копилку идей" : "Добавить в вишлист"}</button>
    </div>`, isIdea ? "Новая идея" : `Добавить подарок (${esc(whoLabel)})`);
  setupUpArea($("#up-area"), (url) => m._image = url);
  setupRecArea($("#rec-area"), (url) => m._voice = url);
  bindCatNew(m, "f-cat", "f-cat-new");
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

function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const dv = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); dv.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVE");
  w(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, "data"); dv.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) dv.setInt16(44 + i * 2, samples[i], true);
  return buf;
}

async function blobToWav(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error("Декодирование недоступно");
  const ctx = new AC();
  try {
    const ab = await blob.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(ab);
    const rate = 22050;
    const out = new Float32Array(Math.ceil(audioBuf.length * rate / audioBuf.sampleRate));
    const ch = audioBuf.getChannelData(0);
    for (let i = 0; i < out.length; i++) out[i] = ch[Math.floor(i * audioBuf.sampleRate / rate)];
    const pcm = new Int16Array(out.length);
    for (let i = 0; i < out.length; i++) { const v = Math.max(-1, Math.min(1, out[i])); pcm[i] = v < 0 ? v * 0x8000 : v * 0x7FFF; }
    return new Blob([encodeWav(pcm, rate)], { type: "audio/wav" });
  } finally { ctx.close(); }
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
    let blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
    if (!blob.type.includes("wav")) {
      try { blob = await blobToWav(blob); } catch (e) {}
    }
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
    category: catFrom(m, "e-cat", "e-cat-new"),
    price: g("e-price"),
    priority: g("e-prio") || it.priority,
    size: g("e-size"),
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
    category: catFrom(m, "f-cat", "f-cat-new"),
    price: g("f-price"),
    priority: g("f-prio"),
    type: g("f-type"),
    size: g("f-size"),
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
    if (isMine && !it.gifted) {
      if (!it.bought) {
        actions.push(`<button class="btn ${it.pinned ? "" : "primary"}" data-action="toggle-pin" data-id="${esc(id)}">${it.pinned ? "📌 Открепить" : "📌 Закрепить"}</button>`);
        actions.push(`<button class="btn primary" data-action="buy" data-id="${esc(id)}">🛍 Я купил(а)!</button>`);
      } else {
        actions.push(`<button class="btn" data-action="unbuy" data-id="${esc(id)}">Вернуть в «не куплено»</button>`);
      }
    }
    if (!isMine && !it.gifted) {
      actions.push(`<button class="btn primary" data-action="gift" data-id="${esc(id)}">🎀 Вручил(а)!</button>`);
      actions.push(`<button class="btn" data-action="copy" data-id="${esc(id)}">${icons.copy} Мне тоже</button>`);
      const inPlans = (S.data.plans || {})[id];
      actions.push(`<button class="btn ${inPlans ? "" : "primary"}" data-action="plan-add" data-id="${esc(id)}">${icons.gift} ${inPlans ? "В планах · изменить" : "В планы"}</button>`);
    }
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
  if (it.size) meta.push(`<span class="badge muted">📏 ${esc(it.size)}</span>`);
  if (it.priority) meta.push(`<span class="badge ${it.priority === "must" ? "grad" : "muted"}">${PRIORITY[it.priority]}</span>`);
  if (it.category) meta.push(`<span class="badge muted">${esc(it.category)}</span>`);
  if (it.type === "certificate") meta.push(`<span class="badge dark">🎫 сертификат</span>`);
  if (it.bought) meta.push(`<span class="badge ok">🛍 куплено</span>`);
  if (it.gifted && it.giftedAt) meta.push(`<span class="badge grad">🎀 вручено ${new Date(it.giftedAt).toLocaleDateString("ru-RU")}</span>`);
  if (it.surprise) meta.push(`<span class="badge warn">🎁 сюрприз до ${it.revealDate ? fmt.format(it.revealDate) : "открытия"}</span>`);
  if (!isMine && (S.data.plans || {})[id]) meta.push(`<span class="badge grad">🎁 в планах</span>`);

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
  "add-cat": () => promptCat(),
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
  "theme": (b) => setTheme(b.dataset.val),
  "bg-set": (b) => api("/api/background/set", { method: "POST", body: JSON.stringify({ index: +b.dataset.index }) }).then((d) => { if (d.ok) { S.data = d; applyBackground(); toast("Фон обновлён"); } }),
  "bg-add": (b) => pickBackground(b),
  "export": () => exportList(),
  "export-csv": () => exportCSV(),
  "int-add": () => interestModal({}),
  "int-edit": (b) => {
    const list = S.data.interests?.[S.me] || [];
    const it = list[+b.dataset.index];
    if (it) interestModal({ ...it, _index: +b.dataset.index });
  },
  "int-del": (b) => {
    const list = [...(S.data.interests?.[S.me] || [])];
    list.splice(+b.dataset.index, 1);
    saveInterests(list);
  },
  "i-save": (b) => {
    const m = b.closest(".modal");
    const g = (a) => ($("[data-action=" + a + "]", m)?.value || "").trim();
    const name = g("i-name");
    if (!name) { toast("Введите название интереса"); return; }
    const list = [...(S.data.interests?.[S.me] || [])];
    const item = { name, buy: g("i-buy"), link: g("i-link") };
    if (m._index >= 0) list[m._index] = item;
    else list.push(item);
    saveInterests(list);
    closeModal();
  },
  "reload": () => { try { tg?.HapticFeedback?.notificationOccurred?.("warning"); } catch (e) {} location.reload(); },
  "open-bot": () => { try { tg?.openTelegramLink?.("https://t.me/" + (window.WL_BOT || "")); } catch (e) {} },
  "offline": () => toast(navigator.onLine ? "Вы онлайн 🌐" : "Вы офлайн — работает из кэша"),
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
  "plan-add": (b) => openPlanModal(b.dataset.id),
  "open-plan": (b) => openPlanModal(b.dataset.id),
  "plan-new-cat": (b) => { const m = b.closest(".modal"); $("#plan-new-row", m).style.display = "block"; $("[data-action=plan-cat-new]", m).focus(); },
  "plan-save": async (b) => {
    const m = b.closest(".modal");
    const id = b.dataset.id;
    const sel = $("[data-action=plan-cat]", m).value;
    const newRow = $("#plan-new-row", m);
    const newCat = (newRow.style.display === "none" ? "" : ($("[data-action=plan-cat-new]", m).value || "").trim());
    const category = newCat || sel;
    const note = ($("[data-action=plan-note]", m).value || "").trim();
    b.disabled = true; b.textContent = "Сохраняю…";
    const d = await api("/api/items/" + id + "/plan", { method: "POST", body: JSON.stringify({ category, note }) });
    if (!d.ok) { toast(d.error || "Ошибка"); b.disabled = false; return; }
    S.data = d; closeModal(); hapticOk(); toast("Добавлено в планы 🎁"); render();
  },
  "plan-remove": (b) => api("/api/plans/" + b.dataset.id + "/delete", { method: "POST" }).then((d) => { if (d.ok) { S.data = d; hapticOk(); toast("Убрано из планов"); render(); } }),
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

/* ============================ sharing ============================ */

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
    <p style="font-size:15px">Отметить «${esc(it.title)}» как вручённый? 🎉 Фото вручения — по желанию:</p>
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
    <div class="field"><label>Размер (необязательно)</label><input data-action="e-size" value="${esc(it.size || "")}" placeholder="напр. 42 / M"></div>
    <div class="field"><label>Категория</label><select data-action="e-cat">${catOptions(it.category)}<option value="__new__">➕ Новая категория…</option></select>
      <input data-action="e-cat-new" placeholder="Название новой категории" style="display:none;margin-top:8px"></div>
    <div class="field"><label>Приоритет</label>
      <select data-action="e-prio">${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}" ${it.priority === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    <div class="field"><label>Заметка</label><textarea data-action="e-note" maxlength="1000">${esc(it.note || "")}</textarea></div>
    <div class="modal-btns">
      <button class="btn primary" data-action="save-edit">Сохранить</button>
    </div>`, "Редактировать");
  bindCatNew(m, "e-cat", "e-cat-new");
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

function exportCSV() {
  const rows = [["Название", "Цена", "Размер", "Категория", "Приоритет", "Ссылка"]];
  (S.data.wishlist || []).forEach((i) => {
    rows.push([i.title, i.price || "", i.size || "", i.category || "", i.priority ? PRIORITY[i.priority] : "", i.link || ""]);
  });
  const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "wishlist.csv";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  toast("CSV скачан ⬇️");
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
        const finish = (blob) => {
          URL.revokeObjectURL(url);
          closeModal();
          if (blob) resolve(blob);
          else reject(new Error("Не удалось подготовить фото"));
        };
        if (out.toBlob) {
          out.toBlob(finish, "image/jpeg", 0.88);
        } else {
          try {
            const dataUrl = out.toDataURL("image/jpeg", 0.88);
            const bin = atob(dataUrl.split(",")[1]);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            finish(new Blob([arr], { type: "image/jpeg" }));
          } catch (err) { reject(err); }
        }
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

function renderKeepFocus() {
  const a = document.activeElement;
  const keep = a?.dataset?.action === "search";
  const pos = keep ? a.selectionStart : -1;
  render();
  if (keep) {
    const nx = document.querySelector("[data-action=search]");
    if (nx) { nx.focus(); if (pos >= 0) nx.setSelectionRange(pos, pos); }
  }
}

function bindGlobal() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const a = actions[btn.dataset.action];
    if (!a) return;
    if (btn.matches("input, select, textarea")) return;
    e.preventDefault();
    haptic();
    a(btn, e);
  });
  document.addEventListener("change", (e) => {
    if (e.target?.dataset?.action === "bg-add") { pickBackground(e.target); return; }
    if (e.target?.dataset?.action !== "f-surprise") return;
    const row = e.target.closest(".modal")?.querySelector("#surprise-row");
    if (row) row.style.display = e.target.checked ? "block" : "none";
    const tr = e.target.closest(".switch")?.querySelector(".sw-track");
    tr && tr.classList.toggle("on", e.target.checked);
  });
  document.addEventListener("input", (e) => {
    if (e.target.dataset?.action !== "search") return;
    S.search = e.target.value;
    clearTimeout(S._searchTimer);
    S._searchTimer = setTimeout(renderKeepFocus, 350);
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
