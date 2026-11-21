/* Lumen public web form (form.html): shows one published CRM form and sends the answers.
   Standalone: does not load the main app. No sign-in. Writes exactly { form, values, at, page } to
   workspaces/{ws}/formsubs, which firestore.rules allow for published forms; a team member's Lumen
   then turns it into a CRM lead (js/apps/forms.js). */
const V = "10.12.2"; // same Firebase version as js/cloud.js
const cfg = window.FIREBASE_CONFIG;
const params = new URLSearchParams(location.search);
const wsId = params.get("ws") || "", formId = params.get("f") || "";
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_FIELDS = 40, WAIT_MS = 2000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const site = location.origin + location.pathname.replace(/[^/]*$/, "");
const card = document.getElementById("card");
const CHECK = `<svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>`;
let fs = null, db = null, lite = false, form = null, booting = false;

/* tiny element builder: text only, never HTML from the form doc */
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "timeout" })), ms))]);
const offline = e => !navigator.onLine || ["unavailable", "timeout", "deadline-exceeded"].includes(e?.code);

/* ---------- page setup ---------- */
try { if (window.self !== window.top) document.documentElement.classList.add("embedded"); } catch { document.documentElement.classList.add("embedded"); }
const theme = params.get("theme");
if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
document.getElementById("madeWith").href = site;
addEventListener("online", () => { if (!form && card.dataset.state === "offline") boot(); });
boot();

async function boot() {
  if (booting) return;
  booting = true;
  try {
    if (!SAFE_ID.test(wsId) || !SAFE_ID.test(formId)) return fail("link");
    if (!cfg || !cfg.apiKey) return fail("setup");
    if (!navigator.onLine) return fail("offline");
    try { await loadFirebase(); } catch (e) { console.warn(e); return fail(navigator.onLine ? "load" : "offline"); }
    let snap;
    try { snap = await timeout(fs.getDoc(fs.doc(db, "workspaces", wsId, "forms", formId)), 15000); }
    catch (e) { console.warn(e); return fail(e.code === "permission-denied" || e.code === "not-found" ? "missing" : offline(e) ? "offline" : "load"); }
    const data = snap.exists() ? snap.data() : null;
    if (!data || data.published !== true) return fail("missing");
    form = data;
    show();
  } finally { booting = false; }
}
async function loadFirebase() {
  if (db) return;
  const app = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
  // Firestore Lite: small, no live connection, and fails fast when offline instead of queueing the write
  try { fs = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore-lite.js`); lite = true; }
  catch { fs = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`); lite = false; }
  const fapp = app.getApps().find(a => a.name === "lumen-form") || app.initializeApp(cfg, "lumen-form");
  db = fs.getFirestore(fapp);
}

/* ---------- friendly error states ---------- */
const STATES = {
  link: ["🔗", "This link looks incomplete", "Ask whoever shared it for the full form link."],
  setup: ["🧩", "This form isn't set up yet", "The site owner still needs to connect Lumen to its database."],
  missing: ["🫥", "This form isn't available", "It may have been closed or removed. Check the link with whoever shared it."],
  offline: ["📡", "You're offline", "Connect to the internet and the form will load."],
  load: ["⚠️", "Couldn't load the form", "Something went wrong on our side. Please try again in a moment."],
};
function fail(kind) {
  const [ic, title, text] = STATES[kind] || STATES.load;
  document.title = title + " · Lumen";
  card.dataset.state = kind;
  card.removeAttribute("aria-busy");
  const h2 = el("h2", { text: title, tabindex: "-1" });
  card.replaceChildren(el("div", { class: "state", role: "alert" }, el("div", { class: "ic", text: ic }), h2, el("p", { text }),
    kind === "offline" || kind === "load" ? el("button", { class: "ghost", type: "button", text: "Try again", onclick: () => boot() }) : null));
}

/* ---------- the form ---------- */
function problem(f, v) {
  if (f.type === "checkbox") return f.required && !v ? "Please tick this box" : "";
  v = String(v || "").trim();
  if (!v) return f.required ? (f.type === "select" ? "Please choose an option" : "Please fill this in") : "";
  if (f.type === "email" && !EMAIL.test(v)) return "Enter a valid email, like name@example.com";
  if (f.type === "tel" && (!/^[+()\-.\s\d]+$/.test(v) || v.replace(/\D/g, "").length < 5)) return "Enter a valid phone number";
  return "";
}
const TYPES = ["text", "email", "tel", "textarea", "select", "checkbox"];
function fieldsOf(f) {
  const seen = new Set();
  return (Array.isArray(f.fields) ? f.fields : []).filter(x => {
    const k = x && typeof x.key === "string" ? x.key.trim() : "";
    if (!k || k.length > 100 || seen.has(k)) return false;
    seen.add(k); return true;
  }).slice(0, MAX_FIELDS).map(x => ({ key: x.key.trim(), label: String(x.label || "Untitled field"), type: TYPES.includes(x.type) ? x.type : "text", required: !!x.required,
    placeholder: String(x.placeholder || ""), options: Array.isArray(x.options) ? x.options.map(String).filter(Boolean) : [] }));
}
// the public doc has no CRM mapping, so autofill is guessed from the type and label
const autocomplete = f => f.type === "email" ? "email" : f.type === "tel" ? "tel" : f.type !== "text" ? "off" : /compan|organi[sz]/i.test(f.label) ? "organization" : /name/i.test(f.label) ? "name" : "off";

function show() {
  const fields = fieldsOf(form);
  document.title = (form.title || "Form") + " · Lumen";
  card.dataset.state = "form";
  card.removeAttribute("aria-busy");
  const ctls = {}, errs = {};
  const status = el("div", { class: "status", role: "status", "aria-live": "polite" });
  const f = el("form", { novalidate: true, "aria-label": form.title || "Form" });

  fields.forEach((fd, i) => {
    const id = "f-" + i, eid = id + "-err";
    let c;
    if (fd.type === "textarea") c = el("textarea", { id, name: fd.key, rows: "4", maxlength: "5000", placeholder: fd.placeholder || null });
    else if (fd.type === "select") c = el("select", { id, name: fd.key }, el("option", { value: "", text: fd.placeholder || "Choose…" }), ...fd.options.slice(0, 50).map(o => el("option", { value: o, text: o })));
    else if (fd.type === "checkbox") c = el("input", { id, name: fd.key, type: "checkbox" });
    else c = el("input", { id, name: fd.key, type: fd.type, maxlength: "500", placeholder: fd.placeholder || null, autocomplete: autocomplete(fd),
      inputmode: fd.type === "tel" ? "tel" : fd.type === "email" ? "email" : null, spellcheck: fd.type === "email" ? "false" : null });
    c.setAttribute("aria-describedby", eid);
    if (fd.required) { c.required = true; c.setAttribute("aria-required", "true"); }
    ctls[fd.key] = c;
    errs[fd.key] = el("div", { class: "err", id: eid });
    const star = fd.required ? el("span", { class: "star", "aria-hidden": "true", text: " *" }) : null;
    const validate = () => { const msg = problem(fd, fd.type === "checkbox" ? c.checked : c.value); errs[fd.key].textContent = msg; msg ? c.setAttribute("aria-invalid", "true") : c.removeAttribute("aria-invalid"); return msg; };
    c.addEventListener("input", () => { if (c.getAttribute("aria-invalid") === "true") validate(); });
    c.addEventListener("change", () => { if (c.getAttribute("aria-invalid") === "true" || fd.type === "checkbox") validate(); });
    c.addEventListener("blur", () => { if (fd.type !== "checkbox" && c.value.trim()) validate(); });
    c._validate = validate;
    const row = fd.type === "checkbox"
      ? el("div", { class: "row" }, el("label", { class: "check", for: id }, c, el("span", null, fd.label, star)), errs[fd.key])
      : el("div", { class: "row" }, el("label", { for: id }, fd.label, star), c, errs[fd.key]);
    row.style.animationDelay = Math.min(i, 10) * 40 + "ms";
    f.append(row);
  });

  // honeypot: people never see or fill it; simple bots do
  const trap = el("input", { type: "text", name: "website", id: "website", tabindex: "-1", autocomplete: "off" });
  f.append(el("div", { class: "hp", "aria-hidden": "true" }, el("label", { for: "website", text: "Leave this empty" }), trap));

  const label = form.button || "Send";
  const btn = el("button", { class: "send", type: "submit", disabled: true }, el("span", { text: label }));
  const shownAt = Date.now();
  setTimeout(() => { btn.disabled = false; }, WAIT_MS); // bots submit instantly; people don't
  f.append(btn, status, el("p", { class: "privacy", text: "Your answers go only to the team that shared this form." }));

  f.addEventListener("submit", async e => {
    e.preventDefault();
    if (btn.disabled || Date.now() - shownAt < WAIT_MS) return;
    status.textContent = "";
    let first = null;
    fields.forEach(fd => { if (ctls[fd.key]._validate() && !first) first = ctls[fd.key]; });
    if (first) { status.textContent = "Please check the highlighted fields."; first.focus(); return; }
    const values = {};
    fields.forEach(fd => { const c = ctls[fd.key]; values[fd.key] = fd.type === "checkbox" ? c.checked : c.value.trim().slice(0, fd.type === "textarea" ? 5000 : 500); });
    btn.disabled = true;
    btn.replaceChildren(el("span", { class: "spin", "aria-hidden": "true" }), el("span", { text: "Sending…" }));
    if (trap.value) { setTimeout(() => thanks(), 700); return; } // pretend it worked, write nothing
    try {
      if (!navigator.onLine) throw Object.assign(new Error("offline"), { code: "unavailable" });
      await timeout(fs.addDoc(fs.collection(db, "workspaces", wsId, "formsubs"), { form: formId, values, at: Date.now(), page: (document.referrer || "").slice(0, 500) }), lite ? 20000 : 12000);
      thanks();
    } catch (err) {
      console.warn(err);
      btn.disabled = false; btn.replaceChildren(el("span", { text: label }));
      status.textContent = err.code === "permission-denied" ? "This form was just closed, so your answers weren't sent."
        : offline(err) ? "You seem to be offline. Your answers are still here: connect and press the button again."
        : "Couldn't send your answers. Please try again.";
    }
  });

  card.replaceChildren(
    form.title ? el("h1", { text: form.title }) : null,
    form.desc ? el("p", { class: "desc", text: form.desc }) : null,
    fields.length ? f : el("div", { class: "state" }, el("div", { class: "ic", text: "📝" }), el("p", { text: "This form has no questions yet." })));
}

function thanks() {
  card.dataset.state = "done";
  const h2 = el("h2", { text: "Thank you!", tabindex: "-1" });
  const ok = el("div", { class: "ok" }); ok.innerHTML = CHECK; // static markup, never from the form doc
  card.replaceChildren(el("div", { class: "state done", role: "status", "aria-live": "polite" }, ok, h2,
    el("p", { text: form.thanks || "We got your answers and will be in touch soon." }),
    el("button", { class: "ghost", type: "button", text: "Send another response", onclick: () => show() })));
  h2.focus({ preventScroll: true });
  if (!document.documentElement.classList.contains("embedded")) card.scrollIntoView({ block: "start", behavior: "smooth" }); // never scroll the host page
}
