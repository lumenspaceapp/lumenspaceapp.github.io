/* Sign-in history (Settings → Sign-in history), like Bitrix24 Enterprise "Login history".
   Every time someone opens a shared workspace in a new browser session we note it in workspaces/{ws}/logins:
   { email, at, kind: "signin" (a fresh sign-in) | "open" (already signed in), provider, browser, os, device, tz, lang }.
   No IP addresses or locations: only what this browser itself reports. Owner and admins see everyone's entries, members see their own.
   Entries older than KEEP_DAYS are cleared when an admin opens the page. Firestore rules: see the `logins` match in firestore.rules. */
(function () {
  const { h } = UI;
  const KEEP_DAYS = 180, LIMIT = 400;
  const PROVIDERS = { "google.com": "Google", "microsoft.com": "Microsoft", password: "Email link", emailLink: "Email link", google: "Google", microsoft: "Microsoft" };

  /* ---------- what this browser is ---------- */
  function device() {
    const ua = navigator.userAgent || "", d = navigator.userAgentData;
    const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox\//.test(ua) ? "Firefox"
      : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
    const plat = (d && d.platform) || "";
    const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /CrOS/.test(ua) ? "ChromeOS" : /Windows/.test(ua) || plat === "Windows" ? "Windows"
      : /Mac OS X|Macintosh/.test(ua) ? (navigator.maxTouchPoints > 1 ? "iPadOS" : "macOS") : /Linux/.test(ua) ? "Linux" : plat || "Unknown";
    const kind = /iPad|Tablet/.test(ua) || (os === "iPadOS") || (/Android/.test(ua) && !/Mobile/.test(ua)) ? "Tablet" : (d && d.mobile) || /Mobi|iPhone/.test(ua) ? "Phone" : "Computer";
    return { browser, os, device: kind };
  }

  /* ---------- recording ---------- */
  let lastWs = "";
  async function record() {
    const C = window.Cloud, ws = C && C.ws, u = C && C.user;
    if (!ws || !u || !C.fs || !C.fs.ref()) return;
    const key = "lumen-login-noted-" + ws.id;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { if (lastWs === ws.id) return; }
    lastWs = ws.id;
    const fresh = Date.now() - (Date.parse(u.metadata?.lastSignInTime || "") || 0) < 3 * 60000;
    let via = ""; try { via = sessionStorage.getItem("lumen-signin-via") || ""; } catch {}
    const provider = PROVIDERS[via] || PROVIDERS[(u.providerData || [])[0]?.providerId] || "Google";
    const rec = { email: u.email.toLowerCase(), at: Date.now(), kind: fresh ? "signin" : "open", provider, ...device(),
      tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || "").slice(0, 60), lang: (navigator.language || "").slice(0, 20) };
    try { const { fb, ref } = C.fs; await fb.addDoc(fb.collection(ref(), "logins"), rec); cache = null; }
    catch (e) { if (e.code !== "permission-denied") console.warn("sign-in history", e); } // rules not published yet: stay quiet
  }
  Apps.onWorkspace?.add(() => setTimeout(record, 2500));

  /* ---------- reading ---------- */
  let cache = null, loading = null, cacheWs = "";
  async function load(all) {
    const { fb, ref } = Cloud.fs, col = fb.collection(ref(), "logins");
    const q = all ? fb.query(col, fb.orderBy("at", "desc"), fb.limit(LIMIT))
      : fb.query(col, fb.where("email", "==", Data.me().key), fb.limit(LIMIT)); // no orderBy: avoids needing a composite index
    const snap = await fb.getDocs(q);
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.at - a.at);
    if (all) prune(rows);
    return rows;
  }
  // admins: clear entries older than KEEP_DAYS (a few at a time)
  async function prune(rows) {
    const cut = Date.now() - KEEP_DAYS * 864e5, old = rows.filter(r => r.at < cut).slice(0, 200);
    if (!old.length) return;
    try { const { fb, ref } = Cloud.fs, b = fb.writeBatch(Cloud.fs.db); old.forEach(r => b.delete(fb.doc(ref(), "logins", r.id))); await b.commit(); } catch (e) { console.warn(e); }
  }

  /* ---------- the settings section ---------- */
  const fmt = t => { const d = new Date(t); return (Apps.fmtDateTime ? Apps.fmtDateTime(d) : d.toLocaleString()); };
  const ago = t => (UI.timeAgo ? UI.timeAgo(t) : "");
  function csv(rows) {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["When", "Person", "Email", "What", "Method", "Browser", "System", "Device", "Time zone", "Language"].map(q).join(",")]
      .concat(rows.map(r => [new Date(r.at).toISOString(), Data.person(r.email).name, r.email, r.kind === "signin" ? "Signed in" : "Opened Lumen", r.provider, r.browser, r.os, r.device, r.tz, r.lang].map(q).join(",")));
    const a = h("a", { href: URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv" })), download: `lumen-sign-in-history-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove();
  }
  let filter = { who: "", kind: "" };
  function draw(ctx, kit) {
    const { card, row } = kit;
    const all = Apps.isAdmin ? Apps.isAdmin() : false;
    const wsId = Cloud.ws?.id || "";
    if (cacheWs !== wsId + (all ? "*" : "")) { cache = null; cacheWs = wsId + (all ? "*" : ""); }
    if (!cache && !loading) loading = load(all).then(r => { cache = r; }, e => { cache = { error: e }; }).finally(() => { loading = null; ctx.redraw(); });

    const intro = card(all ? "Everyone's sign-ins" : "Your sign-ins",
      all ? "Each time someone opens this workspace in a new browser session. Kept for 6 months. Only the owner and admins see everyone."
        : "Each time you opened this workspace in a new browser session. The owner and admins can see these too.");
    if (!cache) return [intro, card("", "", h("div", { class: "st-empty", text: "Loading sign-in history…" }))];
    if (cache.error) return [intro, card("", "", h("div", { class: "st-empty", text: cache.error.code === "permission-denied"
      ? "Sign-in history needs the latest database rules. The workspace owner publishes firestore.rules once." : "Couldn't load sign-in history: " + (cache.error.code || cache.error.message) }))];

    const rows = cache;
    // first time we see this person on this browser + system (oldest first) → "New device"
    const seen = new Set(), firstIds = new Set();
    [...rows].reverse().forEach(r => { const k = r.email + "|" + r.browser + "|" + r.os + "|" + r.device; if (!seen.has(k)) { seen.add(k); firstIds.add(r.id); } });
    const people = [...new Set(rows.map(r => r.email))];
    const shown = rows.filter(r => (!filter.who || r.email === filter.who) && (!filter.kind || r.kind === filter.kind));
    const day = 864e5, now = Date.now();
    const stats = h("div", { class: "ll-stats" },
      ...[["Last 24 hours", rows.filter(r => now - r.at < day).length], ["Last 7 days", rows.filter(r => now - r.at < 7 * day).length],
        ["People", people.length], ["Devices", seen.size]].map(([l, n]) => h("div", { class: "ll-stat" }, h("b", { text: String(n) }), h("span", { text: l }))));

    const pick = h("select", { class: "menu-input st-sel", "aria-label": "Person" }, h("option", { value: "" }, "Everyone"),
      ...people.map(e => h("option", { value: e, selected: filter.who === e }, Data.person(e).name + " · " + e)));
    pick.onchange = () => { filter.who = pick.value; ctx.redraw(); };
    const kinds = kit.seg([["", "All"], ["signin", "Sign-ins"], ["open", "Opened"]], filter.kind, v => { filter.kind = v; ctx.redraw(); });
    const tools = h("div", { class: "ll-tools" }, all ? pick : null, kinds, h("span", { class: "grow" }),
      h("button", { class: "btn", text: "↻ Refresh", onclick: () => { cache = null; ctx.redraw(); } }),
      h("button", { class: "btn", text: "Export CSV", onclick: () => csv(shown) }));

    const list = shown.length ? h("div", { class: "ll-list" }, ...shown.slice(0, 200).map(r => {
      const p = Data.person(r.email);
      return h("div", { class: "ll-row" },
        all ? Apps.avatar(p, 28) : h("span", { class: "ll-ic", text: r.device === "Phone" ? "📱" : r.device === "Tablet" ? "📲" : "💻" }),
        h("div", { class: "ll-main" },
          h("div", { class: "ll-top" }, all ? h("b", { text: p.name }) : null,
            h("span", { class: "ll-kind " + r.kind, text: r.kind === "signin" ? "Signed in" : "Opened Lumen" }),
            h("span", { class: "ll-via", text: "via " + (r.provider || "Google") }),
            firstIds.has(r.id) && rows.length > 1 ? h("span", { class: "ll-new", title: "The first time we saw this person on this browser and system", text: "New device" }) : null),
          h("small", { text: `${r.browser || "Browser"} on ${r.os || "unknown system"} · ${r.device || "Computer"}${r.tz ? " · " + r.tz : ""}` })),
        h("div", { class: "ll-when" }, h("span", { text: ago(r.at) }), h("small", { text: fmt(r.at) })));
    }), shown.length > 200 ? h("div", { class: "st-empty", text: `Showing the newest 200 of ${shown.length}. Export CSV for all of them.` }) : null)
      : h("div", { class: "st-empty", text: rows.length ? "Nothing matches this filter." : "No sign-ins recorded yet. New ones appear here from now on." });

    return [intro, card("", "", stats, tools, list),
      card("About this log", "",
        row("What's recorded", "Date and time, sign-in method, browser, system, device type, time zone and language. Not IP addresses or locations.", null),
        row("Something looks wrong?", "If you see a device nobody recognises, remove that person from Members & levels and ask them to sign out everywhere from their Google or Microsoft account.", null))];
  }

  window.LoginLog = { draw, record, device };
})();
