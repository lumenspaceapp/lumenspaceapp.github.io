/* API & integrations (js/api-keys.js): Settings → API & integrations, shared workspaces, owner and admins only.
   - Create an API key (name, read only or read & write, optionally limited to some collections). The key
     "lmn_<workspaceId>_<40 random letters/digits>" is shown ONCE; only its SHA-256 is stored.
   - List keys (name, last 4, access, created, by, last used) with Revoke and Delete.
   - Shows the API address (window.LUMEN_API_URL || window.LUMI_AI_URL, + "/v1"), checks the worker is live, setup steps, curl examples.
   Stores workspaces/{ws}/apikeys/{keyId}: { name, hash (hex SHA-256 of the whole key), last4, scopes: ["read"] | ["read","write"],
   collections: [] (empty = every allowed one), created (ms), by (email), revoked (bool), lastUsed (ms, written by the worker) }.
   keyId = first 24 hex chars of the hash. Written straight to Firestore (not Data: members must never load this collection).
   The worker side is worker/src/api.js; the guide is docs/API.md.
   Exposes window.ApiKeys = { draw(ctx, kit) } for js/apps/settings.js. */
(function () {
  const { h } = UI;
  const DOCS = "https://github.com/lumenspaceapp/lumenspaceapp.github.io/blob/main/docs/API.md";
  // keep in sync with ALLOWED in worker/src/api.js
  const COLS = [["tasks", "Tasks"], ["projects", "Projects & workgroups"], ["leads", "Leads"], ["deals", "Deals"], ["contacts", "Contacts"], ["companies", "Companies"],
    ["products", "Products"], ["quotes", "Estimates & invoices"], ["activities", "CRM activities"], ["events", "Calendar events"], ["feed", "Feed posts"],
    ["inventory", "Inventory"], ["bookings", "Bookings"], ["absences", "Absences"], ["timelog", "Time log"], ["lists", "Lists"], ["listitems", "List items"],
    ["kbspaces", "Knowledge base spaces"], ["kbarticles", "Knowledge base articles"], ["formsubs", "Web form entries (read only)"]];
  const LABEL = Object.fromEntries(COLS);
  const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  /* ---------- state (module level, so Settings redraws don't refetch) ---------- */
  const S = { ws: "", keys: null, loadedAt: 0, loading: false, error: "", fresh: null, listEl: null, health: { base: "", state: "", at: 0 }, healthEl: null };

  const fs = () => window.Cloud?.fs;
  const wsId = () => window.Cloud?.ws?.id || "";
  const shared = () => !!(window.Cloud?.ws && window.Cloud?.user && fs()?.ref?.());
  const isAdmin = () => (Apps.isAdmin ? Apps.isAdmin() : window.Cloud?.ws?.owner === window.Cloud?.user?.uid);
  const myEmail = () => String(window.Cloud?.user?.email || "").toLowerCase();
  const base = () => String(window.LUMEN_API_URL || window.LUMI_AI_URL || "").trim().replace(/\/+$/, "");
  const apiUrl = () => (base() ? base() + "/v1" : "");
  const ago = ms => (ms ? UI.timeAgo(ms) : "");

  /* ---------- key generation ---------- */
  function secret(n = 40) {
    // rejection sampling: bytes ≥ 248 are skipped so every one of the 62 characters is equally likely
    let out = "";
    while (out.length < n) {
      for (const b of crypto.getRandomValues(new Uint8Array(64))) { if (b < 248 && out.length < n) out += ALNUM[b % 62]; }
    }
    return out;
  }
  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  /* ---------- Firestore ---------- */
  function load(force) {
    const id = wsId();
    if (!id || !shared()) return;
    if (S.ws !== id) Object.assign(S, { ws: id, keys: null, loadedAt: 0, error: "", fresh: null });
    if (S.loading || (!force && S.keys && Date.now() - S.loadedAt < 60000)) return;
    const { fb, ref } = fs();
    S.loading = true;
    fb.getDocs(fb.collection(ref(), "apikeys")).then(snap => {
      if (S.ws !== id) return;
      S.keys = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.created || 0) - (a.created || 0));
      S.error = "";
    }).catch(e => {
      if (S.ws !== id) return;
      console.warn("api keys", e);
      S.error = e?.code === "permission-denied" ? "rules" : e?.message || "Couldn't load the keys.";
      S.keys = S.keys || [];
    }).finally(() => {
      S.loading = false; S.loadedAt = Date.now();
      if (S.listEl?.isConnected) S.listEl.replaceChildren(...listRows());
    });
  }
  const keyRef = id => { const { fb, ref } = fs(); return fb.doc(ref(), "apikeys", id); };
  const errText = e => (e?.code === "permission-denied" ? "The database rules don't allow API keys yet (see docs/API.md, “Firestore rules”)." : e?.message || "Something went wrong.");

  async function createKey(ctx, kit, { name, write, cols }) {
    const ws = wsId();
    const key = `lmn_${ws}_${secret()}`, hash = await sha256Hex(key), keyId = hash.slice(0, 24);
    const doc = { name, hash, last4: key.slice(-4), scopes: write ? ["read", "write"] : ["read"], collections: cols, created: Date.now(), by: myEmail(), revoked: false, lastUsed: 0 };
    kit.markWrite();
    await fs().fb.setDoc(keyRef(keyId), doc);
    S.keys = [{ id: keyId, ...doc }, ...(S.keys || []).filter(k => k.id !== keyId)];
    S.fresh = { key, name, keyId };
    ctx.redraw();
  }
  async function revoke(k, kit) {
    if (!(await UI.confirm(`Revoke “${k.name || "this key"}”? Tools using it stop working within a minute. You can't undo this.`, "Revoke"))) return;
    try { kit.markWrite(); await fs().fb.updateDoc(keyRef(k.id), { revoked: true }); k.revoked = true; kit.saved("Key revoked"); repaintList(); }
    catch (e) { console.warn(e); UI.toast(errText(e)); }
  }
  async function remove(k, kit) {
    const msg = k.revoked ? `Delete “${k.name || "this key"}” from the list?` : `Delete “${k.name || "this key"}”? Tools using it stop working within a minute.`;
    if (!(await UI.confirm(msg, "Delete"))) return;
    try { kit.markWrite(); await fs().fb.deleteDoc(keyRef(k.id)); S.keys = (S.keys || []).filter(x => x.id !== k.id); if (S.fresh?.keyId === k.id) S.fresh = null; kit.saved("Key deleted"); repaintList(); }
    catch (e) { console.warn(e); UI.toast(errText(e)); }
  }

  /* ---------- worker health ---------- */
  function checkHealth() {
    const b = base();
    if (!b || (S.health.base === b && S.health.state && S.health.state !== "checking" && Date.now() - S.health.at < 5 * 60000)) return;
    if (S.health.base === b && S.health.state === "checking") return;
    S.health = { base: b, state: "checking", at: Date.now() };
    fetch(b + "/v1", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(j => { S.health.state = j && j.name === "Lumen API" ? (j.configured ? "ok" : "nosa") : "old"; })
      .catch(st => { S.health.state = st === 404 ? "old" : "down"; })
      .finally(() => { S.health.at = Date.now(); if (S.healthEl?.isConnected) S.healthEl.replaceChildren(...healthView()); });
  }
  const HEALTH = {
    checking: ["off", "● Checking…", ""],
    ok: ["ok", "● Online", ""],
    nosa: ["warn", "● Needs setup", "The worker is live but has no service account yet. Add the FIREBASE_SERVICE_ACCOUNT secret, then deploy again (step 2 below)."],
    old: ["warn", "● Update needed", "Your worker doesn't include the API yet. Deploy the latest worker: in the worker folder run npx wrangler deploy."],
    down: ["bad", "● Can't reach", "Lumen couldn't reach the worker. Check the address and that the worker is deployed."],
  };
  function healthView() {
    const [cls, text, note] = HEALTH[S.health.state] || HEALTH.checking;
    return [h("span", { class: "st-status ak-st " + cls, text }), note ? h("div", { class: "ak-hnote", text: note }) : null];
  }

  /* ---------- small UI pieces ---------- */
  async function copy(text, btn) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch {
      const t = h("textarea", { style: { position: "fixed", opacity: "0", top: "0", left: "0" } }); t.value = text; document.body.append(t); t.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      t.remove();
    }
    UI.toast(ok ? "Copied" : "Couldn't copy. Select the text and copy it yourself.");
    if (ok && btn) { const old = btn.innerHTML; btn.classList.add("ak-done"); btn.textContent = "✓ Copied"; setTimeout(() => { btn.innerHTML = old; btn.classList.remove("ak-done"); }, 1600); }
  }
  const copyBtn = (text, label = "Copy") => {
    const b = h("button", { type: "button", class: "btn ak-copy", html: UI.icon("copy") + " " + UI.esc(label) });
    b.onclick = () => copy(typeof text === "function" ? text() : text, b);
    return b;
  };
  const codeLine = (text, extraCls) => h("div", { class: "ak-codeline" + (extraCls ? " " + extraCls : "") }, h("code", { class: "ak-code", text }), copyBtn(text));
  const chip = (text, cls, title) => h("span", { class: "ak-chip" + (cls ? " " + cls : ""), text, title: title || null });

  /* ---------- the "new key" dialog ---------- */
  function newKeyDialog(ctx, kit) {
    let write = false, some = false;
    const name = h("input", { class: "menu-input", placeholder: "e.g. Zapier, website, weekly report", maxlength: 60 });
    const picks = h("div", { class: "ak-cols", hidden: true },
      ...COLS.map(([id, label]) => h("label", { class: "ak-col" }, h("input", { type: "checkbox", value: id }), h("span", { text: label }))));
    const access = kit.seg([["read", "Read only"], ["write", "Read & write"]], "read", v => { write = v === "write"; });
    const scope = kit.seg([["all", "Everything allowed"], ["some", "Only some"]], "all", v => { some = v === "some"; picks.hidden = !some; });
    const err = h("div", { class: "ak-err", role: "alert" });
    const go = h("button", { class: "btn primary", text: "Create key" });
    const body = h("div", { class: "ak-form" },
      h("label", { class: "ak-f" }, h("b", { text: "Name" }), h("span", { text: "Where it will be used, so you can recognise it later." }), name),
      h("div", { class: "ak-f" }, h("b", { text: "Access" }), h("span", { text: "Read only is safest for reports and dashboards." }), access),
      h("div", { class: "ak-f" }, h("b", { text: "What it can use" }), h("span", { text: "Settings, people and sign-ins are never available through the API." }), scope, picks),
      err,
      h("div", { class: "ak-actions" }, h("button", { class: "btn", text: "Cancel", onclick: () => m.close() }), go));
    const m = UI.modal("New API key", body, { className: "ak-modal" });
    setTimeout(() => name.focus(), 50);
    name.addEventListener("keydown", e => { if (e.key === "Enter") go.click(); });
    go.onclick = async () => {
      const n = name.value.trim();
      const cols = some ? [...picks.querySelectorAll("input:checked")].map(i => i.value) : [];
      if (!n) { err.textContent = "Give the key a name."; name.focus(); return; }
      if (some && !cols.length) { err.textContent = "Pick at least one, or choose “Everything allowed”."; return; }
      if (!window.crypto?.subtle) { err.textContent = "This browser can't create keys here (it needs a secure https page)."; return; }
      go.disabled = true; go.textContent = "Creating…"; err.textContent = "";
      try { await createKey(ctx, kit, { name: n, write, cols }); m.close(); }
      catch (e) { console.warn(e); err.textContent = errText(e); go.disabled = false; go.textContent = "Create key"; }
    };
  }

  /* ---------- keys list ---------- */
  function repaintList() { if (S.listEl?.isConnected) S.listEl.replaceChildren(...listRows()); }
  let kitRef = null;
  function listRows() {
    if (S.error === "rules") return [h("div", { class: "st-note", text: "The database rules don't allow API keys yet. The workspace owner needs to publish the Firestore rules from docs/API.md (“Firestore rules”)." })];
    if (S.error && !(S.keys || []).length) return [h("div", { class: "st-empty", text: "Couldn't load the keys: " + S.error })];
    if (!S.keys) return [h("div", { class: "st-empty", text: "Loading keys…" })];
    if (!S.keys.length) return [h("div", { class: "st-empty ak-none", text: "No API keys yet. Create one for each tool you connect, so you can switch one off without touching the others." })];
    return S.keys.map(k => {
      const scopes = Array.isArray(k.scopes) ? k.scopes : ["read"], cols = Array.isArray(k.collections) ? k.collections : [];
      const colText = cols.length ? (cols.length === 1 ? LABEL[cols[0]] || cols[0] : cols.length + " collections") : "Everything allowed";
      return h("div", { class: "ak-key" + (k.revoked ? " revoked" : "") },
        h("div", { class: "ak-k-main" },
          h("div", { class: "ak-k-top" }, h("b", { class: "ak-k-name", text: k.name || "Unnamed key" }), h("code", { class: "ak-k-last", text: "••••" + (k.last4 || "????") }),
            k.revoked ? chip("Revoked", "bad") : chip(scopes.includes("write") ? "Read & write" : "Read only", scopes.includes("write") ? "warn" : ""),
            chip(colText, "", cols.length ? cols.map(c => LABEL[c] || c).join(", ") : "Every collection the API allows")),
          h("div", { class: "ak-k-meta", text: [`Created ${ago(k.created) || "—"}${k.by ? " by " + k.by : ""}`, k.lastUsed ? "Last used " + ago(k.lastUsed) : "Never used"].join(" · ") })),
        h("div", { class: "ak-k-acts" },
          k.revoked ? null : h("button", { class: "btn", text: "Revoke", onclick: () => revoke(k, kitRef) }),
          h("button", { class: "icon-btn", title: "Delete key", "aria-label": "Delete key " + (k.name || ""), html: UI.icon("trash"), onclick: () => remove(k, kitRef) })));
    });
  }

  /* ---------- sections ---------- */
  function connectionCard(kit) {
    const url = apiUrl(), row = kit.row;
    if (!url) {
      return kit.card("Connection", "The API runs on your Cloudflare worker (the same one as Lumi AI).",
        row("API address", "Not set up on this site yet. You can still create keys: they start working once the worker is live.", h("span", { class: "st-status off", text: "● Not set up" })),
        h("ol", { class: "ak-steps" },
          h("li", { html: "In the <b>Firebase console</b>, open <b>Project settings → Service accounts</b> and click <b>Generate new private key</b>. Keep the file private." }),
          h("li", { html: "Give it to the worker as the secret <code>FIREBASE_SERVICE_ACCOUNT</code>: in the Cloudflare dashboard (Worker → Settings → Variables and secrets → Add → Secret, paste the whole file), or run <code>npx wrangler secret put FIREBASE_SERVICE_ACCOUNT</code> in the worker folder." }),
          h("li", { html: "Deploy the worker (<code>npx wrangler deploy</code>) and put its address in <code>js/firebase-config.js</code> as <code>window.LUMEN_API_URL</code> (or <code>LUMI_AI_URL</code> if Lumi AI uses the same worker)." })),
        h("div", { class: "st-card-foot" }, h("a", { class: "btn", href: DOCS, target: "_blank", rel: "noopener", text: "Open the setup guide" })));
    }
    S.healthEl = h("div", { class: "ak-health" }, ...healthView());
    checkHealth();
    return kit.card("Connection", "Other tools send requests to this address with a key.",
      row("API address", "", S.healthEl),
      codeLine(url),
      row("Workspace ID", "Already part of every key. Shown here for support.", h("code", { class: "ak-code ak-small", text: wsId() })),
      h("div", { class: "st-card-foot" }, h("a", { class: "btn", href: DOCS, target: "_blank", rel: "noopener", text: "API guide" })));
  }

  function freshCard(ctx, kit) {
    const f = S.fresh;
    const input = h("input", { class: "menu-input ak-keyin", readonly: true, value: f.key, "aria-label": "Your new API key", spellcheck: "false" });
    input.addEventListener("focus", () => input.select());
    return kit.card("Your new key: " + f.name, "",
      h("div", { class: "ak-warn" }, h("b", { text: "Copy it now. " }), h("span", { text: "For your safety it's shown only this once. If you lose it, delete it and create a new one. Treat it like a password: don't paste it into web pages or share it in chat." })),
      h("div", { class: "ak-codeline" }, input, copyBtn(() => f.key)),
      h("div", { class: "st-card-foot" }, h("button", { class: "btn primary", text: "Done, I've saved it", onclick: () => { S.fresh = null; ctx.redraw(); } })));
  }

  function keysCard(ctx, kit) {
    S.listEl = h("div", { class: "ak-list" }, ...listRows());
    const refresh = h("button", { class: "icon-btn", title: "Refresh", "aria-label": "Refresh keys", text: "↻", onclick: () => { load(true); repaintList(); } });
    return kit.card("API keys", "One key per tool. Revoke a key to cut that tool off.",
      kit.row("Create a key", "Name it after the tool, choose read only or read & write.", h("div", { class: "st-inline" }, refresh, h("button", { class: "btn primary", text: "+ New key", onclick: () => newKeyDialog(ctx, kit) }))),
      S.listEl);
  }

  function examplesCard(kit) {
    const u = apiUrl() || "https://YOUR-WORKER.workers.dev/v1";
    const auth = `-H "Authorization: Bearer YOUR_KEY"`;
    const ex = [
      ["Check your key", `curl ${auth} ${u}/me`],
      ["List tasks", `curl ${auth} "${u}/tasks?limit=20"`],
      ["Create a task", `curl -X POST ${auth} -H "Content-Type: application/json" -d '{"title":"Call Anna","status":"todo"}' ${u}/tasks`],
      ["Mark it done", `curl -X PATCH ${auth} -H "Content-Type: application/json" -d '{"status":"done"}' ${u}/tasks/TASK_ID`],
      ["Add a lead", `curl -X POST ${auth} -H "Content-Type: application/json" -d '{"name":"Ravi Shah","email":"ravi@example.com","source":"Website"}' ${u}/leads`],
    ];
    return kit.card("Try it", "Replace YOUR_KEY with your key. On Windows, run these in Git Bash or WSL (PowerShell treats quotes differently).",
      ...ex.map(([t, c]) => h("div", { class: "ak-ex" }, h("div", { class: "ak-ex-t", text: t }), codeLine(c, "ak-pre"))),
      h("div", { class: "st-sub", text: "What the API can use" }),
      h("div", { class: "ak-allowed" }, ...COLS.map(([id, label]) => chip(id, "", label))),
      h("div", { class: "st-note", text: "Limits: 120 requests a minute per key, 256 KB per request, up to 200 items per page. Changes made through the API don't send Lumen notifications." }));
  }

  window.ApiKeys = {
    draw(ctx, kit) {
      kitRef = kit;
      if (!shared()) return [kit.card("API & integrations", "", h("div", { class: "st-empty", text: "API keys are part of shared workspaces. Sign in and open a shared workspace to use them." }))];
      if (!isAdmin()) {
        return [kit.card("API & integrations", "API keys let other tools (Zapier, scripts, your website) read and write this workspace.",
          h("div", { class: "st-lock" }, h("span", { html: UI.icon("lock") }), h("span", { text: "Only the owner and admins can create and manage API keys. Ask one of them if you need to connect a tool." })))];
      }
      load(false);
      return [
        S.fresh && S.fresh.keyId && S.ws === wsId() ? freshCard(ctx, kit) : null,
        connectionCard(kit),
        keysCard(ctx, kit),
        examplesCard(kit),
      ].filter(Boolean);
    },
  };
})();
