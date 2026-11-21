/* Settings (js/apps/settings.js): a full page at #/app/settings/<section>, laid out like Bitrix24 Settings.
   Personal sections (everyone): profile, appearance, notifications, sidebar menu, my language & region.
   Workspace sections (everyone sees them; owner and admins change them): tools, my workspace, communications, employees,
   company details, business hours, language & region, security, AI, privacy, members & levels, backup, shortcuts.
   Stores: workspace settings via Prefs.set / Prefs.setIn (settings/workspace), my preferences via Prefs.setMe (people/<me>.prefs),
   this device's look via Store.local.settings (theme, accent, blur, glass, motion, wallpaper, region override),
   company details in settings/company (also printed on invoices).
   Also runs in the background: automatic sign-out after inactivity, and caching the "email-link sign-in" switch for the sign-in screen. */
(function () {
  const { h } = UI;
  const S = () => Store.local.settings;
  const shared = () => !!(window.Cloud?.ws && window.Cloud?.user);
  // may I change workspace settings? owner and admins, plus any level an admin allowed to edit "Workspace settings" in Members & levels → Permissions
  const admin = () => (Apps.can ? Apps.can("settings", "edit") : Apps.isAdmin ? Apps.isAdmin() : true);
  const W = () => Prefs.ws();
  const meKey = () => Data.me().key;

  /* ---------- saving ---------- */
  let lastWrite = 0, pill = null, pillT;
  function saved(msg = "Saved") {
    lastWrite = Date.now();
    if (!pill || !pill.isConnected) { pill = h("div", { class: "st-saved glass-strong", role: "status", "aria-live": "polite" }); document.body.append(pill); }
    pill.textContent = "✓ " + msg; pill.classList.remove("out"); pill.classList.add("in");
    clearTimeout(pillT); pillT = setTimeout(() => { pill.classList.remove("in"); pill.classList.add("out"); }, 1400);
  }
  const deb = (fn, ms = 650) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  function wsSave(section, patch) {
    if (!admin()) return UI.toast("Only the owner and admins can change workspace settings");
    lastWrite = Date.now(); Prefs.setIn(section, patch); saved();
  }
  function meSave(patch) { lastWrite = Date.now(); Prefs.setMe(patch); saved(); }
  function localSave(fn) { fn(S()); Store.save(); App.applySettings(); saved(); }

  /* ---------- small controls ---------- */
  function row(title, desc, ctl, cls) {
    return h("div", { class: "st-row" + (cls ? " " + cls : "") }, h("div", { class: "l" }, h("b", { text: title }), desc ? h("span", { text: desc }) : null), ctl ? h("div", { class: "r" }, ctl) : null);
  }
  function sw(on, fn, label) {
    const b = h("button", { type: "button", class: "switch" + (on ? " on" : ""), role: "switch", "aria-checked": on ? "true" : "false", "aria-label": label || "Switch" });
    b.onclick = () => { const v = !b.classList.contains("on"); b.classList.toggle("on", v); b.setAttribute("aria-checked", v ? "true" : "false"); fn(v); };
    return b;
  }
  function seg(opts, val, fn) {
    const el = h("div", { class: "seg" });
    opts.forEach(([v, l]) => el.append(h("button", { type: "button", class: String(v) === String(val) ? "on" : "", text: l, onclick: e => { el.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); fn(v); } })));
    return el;
  }
  function sel(opts, val, fn, attrs = {}) {
    const s = h("select", { class: "menu-input st-sel", ...attrs }, ...opts.map(([v, l]) => h("option", { value: v, selected: String(v) === String(val ?? "") }, l)));
    s.onchange = () => fn(s.value);
    return s;
  }
  function txt(val, fn, attrs = {}) {
    const i = h(attrs.rows ? "textarea" : "input", { class: "menu-input st-in", ...attrs });
    i.value = val ?? "";
    const d = deb(() => fn(i.value.trim()));
    i.addEventListener("input", d);
    i.addEventListener("change", () => fn(i.value.trim()));
    return i;
  }
  const card = (title, desc, ...kids) => h("section", { class: "st-card glass" }, title ? h("div", { class: "st-card-h" }, h("h3", { text: title }), desc ? h("p", { text: desc }) : null) : null, ...kids);
  // a block only owner/admins may change: everyone else sees it read-only
  const lockable = (...kids) => h("fieldset", { class: "st-fs", disabled: !admin() }, ...kids);
  const lockNote = () => admin() ? null : h("div", { class: "st-lock" }, h("span", { html: UI.icon("lock") }), h("span", { text: "Only the owner and admins can change these settings. You can see them here." }));
  // Enterprise sections live in their own files (js/login-log.js, js/backups.js, js/branches.js, js/api-keys.js); they draw with these helpers
  const ext = (name, title) => ctx => (window[name] && window[name].draw ? window[name].draw(ctx, Apps.SettingsKit) : [card(title, "", h("div", { class: "st-empty", text: "Still loading. Reload the page if this stays." }))]);
  const download = (name, text, type = "application/json") => {
    const url = URL.createObjectURL(new Blob([text], { type })), a = h("a", { href: url, download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const readAsDataURL = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
  async function shrinkImage(file, max, type = "image/png") {
    const img = new Image(); img.src = await readAsDataURL(file);
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(type, .9);
  }

  /* ---------- reference data ---------- */
  const NOTIFY_LABELS = { chat: ["Chat messages", "New messages in DMs, groups and channels"], mentions: ["Mentions", "Someone @mentions you"], tasks: ["Tasks", "Assigned to you, comments, due today"],
    feed: ["Feed", "Announcements, posts and appreciation"], calendar: ["Calendar & booking", "Invitations and event reminders"], crm: ["CRM & marketing", "Deals, leads and activities"],
    hr: ["Company & HR", "Time off, work reports, meetings"], automation: ["Automation & approvals", "Approvals, workflows, e-signatures"], other: ["Everything else", "Anything that doesn't fit above"] };
  const FEATURES = {
    tasks: [["projects", "Projects"], ["scrum", "Scrum"], ["efficiency", "Efficiency"], ["templates", "Templates"], ["gantt", "Gantt chart"], ["timetracking", "Time tracking"]],
    crm: [["products", "Products"], ["estimates", "Estimates"], ["invoices", "Invoices"], ["forms", "Web forms"], ["smart", "Smart processes"], ["analytics", "Reports"]],
    company: [["structure", "Company structure"], ["absence", "Absence chart"], ["worktime", "Working time"], ["schedules", "Work schedules"], ["reports", "Work reports"], ["meetings", "Meetings & briefings"]],
    automation: [["rules", "Automation rules"], ["approvals", "Approvals"], ["rpa", "RPA"], ["lists", "Lists"]],
    chat: [["calls", "Video calls"]], feed: [["polls", "Polls"], ["appreciation", "Appreciation"]], drive: [["versions", "File versions"]], calendar: [["rooms", "Meeting rooms"]],
  };
  const PHONE_CODES = [["+1", "US / Canada"], ["+44", "United Kingdom"], ["+91", "India"], ["+971", "UAE"], ["+61", "Australia"], ["+64", "New Zealand"], ["+49", "Germany"], ["+33", "France"],
    ["+34", "Spain"], ["+39", "Italy"], ["+31", "Netherlands"], ["+41", "Switzerland"], ["+46", "Sweden"], ["+48", "Poland"], ["+353", "Ireland"], ["+90", "Turkey"], ["+7", "Russia / Kazakhstan"],
    ["+65", "Singapore"], ["+60", "Malaysia"], ["+62", "Indonesia"], ["+63", "Philippines"], ["+66", "Thailand"], ["+84", "Vietnam"], ["+81", "Japan"], ["+82", "South Korea"], ["+86", "China"],
    ["+852", "Hong Kong"], ["+92", "Pakistan"], ["+880", "Bangladesh"], ["+94", "Sri Lanka"], ["+977", "Nepal"], ["+966", "Saudi Arabia"], ["+974", "Qatar"], ["+965", "Kuwait"], ["+968", "Oman"],
    ["+20", "Egypt"], ["+27", "South Africa"], ["+234", "Nigeria"], ["+254", "Kenya"], ["+55", "Brazil"], ["+52", "Mexico"], ["+54", "Argentina"], ["+57", "Colombia"]];
  const CURRENCIES = ["USD", "EUR", "GBP", "INR", "AED", "AUD", "CAD", "NZD", "SGD", "JPY", "CNY", "HKD", "CHF", "SEK", "NOK", "DKK", "PLN", "ZAR", "BRL", "MXN", "SAR", "QAR", "MYR", "IDR", "PHP", "THB", "PKR", "BDT", "LKR", "NGN", "KES", "TRY"];
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const pad = n => String(n).padStart(2, "0");
  const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  let tzCache = null;
  function timezones() {
    if (tzCache && Date.now() - tzCache.at < 6e5) return tzCache.list;
    let names; try { names = Intl.supportedValuesOf("timeZone"); } catch { names = ["UTC", "Europe/London", "Europe/Berlin", "Europe/Paris", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Sao_Paulo", "Africa/Lagos"]; }
    const off = tz => { try { return (new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date()).find(p => p.type === "timeZoneName") || {}).value || ""; } catch { return ""; } };
    const list = names.map(n => { const o = off(n).replace("GMT", "UTC") || "UTC"; return [n, `(${o === "UTC" ? "UTC+0" : o}) ${n.replace(/_/g, " ")}`]; });
    tzCache = { at: Date.now(), list };
    return list;
  }
  const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } };
  function dateFormats() {
    const d = new Date(), y = d.getFullYear(), m = d.getMonth(), day = d.getDate(), M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m];
    return [["auto", `Automatic · ${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`], ["dmy", `${day} ${M} ${y}`], ["mdy_num", `${pad(m + 1)}/${pad(day)}/${y}`], ["dmy_num", `${pad(day)}/${pad(m + 1)}/${y}`], ["iso", `${y}-${pad(m + 1)}-${pad(day)}`]];
  }
  /* holiday presets */
  function nthWeekday(y, month, wd, n) {
    if (n > 0) { const d = new Date(y, month, 1); d.setDate(1 + ((wd - d.getDay() + 7) % 7) + (n - 1) * 7); return isoOf(d); }
    const d = new Date(y, month + 1, 0); d.setDate(d.getDate() - ((d.getDay() - wd + 7) % 7)); return isoOf(d);
  }
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), hh = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451), mo = Math.floor((hh + l - 7 * m + 114) / 31), dd = ((hh + l - 7 * m + 114) % 31) + 1;
    return new Date(y, mo - 1, dd);
  }
  const INDIA_FESTIVALS = { 2026: [["2026-03-04", "Holi"], ["2026-10-20", "Dussehra"], ["2026-11-08", "Diwali"]], 2027: [["2027-03-22", "Holi"], ["2027-10-29", "Diwali"]] };
  const PRESETS = {
    in: { label: "India", list: y => { const gf = easter(y); gf.setDate(gf.getDate() - 2); return [[`${y}-01-26`, "Republic Day"], [isoOf(gf), "Good Friday"], [`${y}-08-15`, "Independence Day"], [`${y}-10-02`, "Gandhi Jayanti"], [`${y}-12-25`, "Christmas"], ...(INDIA_FESTIVALS[y] || [])]; } },
    us: { label: "United States", list: y => [[`${y}-01-01`, "New Year's Day"], [nthWeekday(y, 0, 1, 3), "Martin Luther King Jr. Day"], [nthWeekday(y, 1, 1, 3), "Presidents' Day"], [nthWeekday(y, 4, 1, -1), "Memorial Day"],
      [`${y}-06-19`, "Juneteenth"], [`${y}-07-04`, "Independence Day"], [nthWeekday(y, 8, 1, 1), "Labor Day"], [nthWeekday(y, 9, 1, 2), "Columbus Day"], [`${y}-11-11`, "Veterans Day"], [nthWeekday(y, 10, 4, 4), "Thanksgiving"], [`${y}-12-25`, "Christmas Day"]] },
  };

  /* ======================================================================
     Sections
     ====================================================================== */

  /* ---------- 1. Your profile ---------- */
  function profile(ctx) {
    const me = Data.me(), prof = Data.get("people", me.key) || {}, cloud = shared();
    const put = patch => { lastWrite = Date.now(); Data.update("people", me.key, { ...patch, ...(cloud ? { email: me.email } : {}) }); saved(); };
    const avBox = h("span", { class: "st-av" }, Apps.avatar(me, 72));
    const nameIn = txt(me.name === "You" ? "" : me.name, v => {
      if (me.accountName) put({ alias: v && v !== me.accountName ? v : "" });
      else { S().userName = v || "You"; Store.save(); put({ name: v || "You" }); }
      window.Cloud?.renderAccount?.();
    }, { placeholder: me.accountName || "Your name", maxlength: 80 });
    const canDept = !cloud || (Apps.isManager ? Apps.isManager() : true);
    let deptCtl;
    if (canDept) {
      const names = [...new Set([...(Apps.HR?.departments?.() || []).map(d => d.name), prof.dept].filter(Boolean))].sort();
      deptCtl = names.length ? sel([["", "No department"], ...names.map(n => [n, n])], prof.dept || "", v => put({ dept: v })) : txt(prof.dept, v => put({ dept: v }), { placeholder: "e.g. Sales" });
    } else deptCtl = h("span", { class: "st-ro-val", text: prof.dept || "No department", title: "Ask HR or an admin to change your department" });
    const code = W().people.phoneCountry || "";
    const phone = txt(prof.phone, v => put({ phone: v }), { type: "tel", placeholder: (code ? code + " " : "+1 ") + "555 123 4567", autocomplete: "tel" });
    phone.addEventListener("focus", () => { if (!phone.value && code) { phone.value = code + " "; } });
    phone.addEventListener("blur", () => { if (phone.value.trim() === code) { phone.value = ""; put({ phone: "" }); } });
    const bday = h("input", { class: "menu-input st-in", type: "date", value: prof.birthday || "" });
    bday.onchange = () => put({ birthday: bday.value });
    return [
      card("", "",
        h("div", { class: "st-profile" }, avBox,
          h("div", { class: "grow" }, h("div", { class: "st-pname", text: me.name }), h("div", { class: "st-pmail", text: me.email || "Private workspace on this device" }),
            Apps.role && cloud ? h("div", { class: "st-plevel" }, Apps.Access?.badge ? Apps.Access.badge(Apps.role()) : null) : null),
          h("button", { class: "btn primary", text: "Change avatar", onclick: async () => { await Apps.chooseAvatar(); avBox.replaceChildren(Apps.avatar(Data.me(), 72)); } }))),
      card("Details", "Shown on your profile card, in the employee directory and next to your posts.",
        row("Name shown", me.accountName ? `Your account name is “${me.accountName}”. Leave empty to use it.` : "How teammates see you", nameIn),
        row("Job title", "", txt(prof.title, v => put({ title: v }), { placeholder: "e.g. Designer", maxlength: 80 })),
        row("Department", canDept ? "" : "Only managers and admins change departments", deptCtl),
        row("Phone", code ? `Starts with the workspace code ${code}` : "", phone),
        row("Birthday", W().people.showBirthYear ? "Teammates see the date and year" : "Teammates see only the day and month", bday),
        row("About me", "", txt(prof.about, v => put({ about: v }), { rows: 3, placeholder: "A few words about you", maxlength: 600 }), "st-row-top")),
      window.Cloud?.user ? card("Account", "",
        row("Signed in as", Cloud.user.email, h("button", { class: "btn danger", text: "Sign out", onclick: async () => { if (await UI.confirm("Sign out of Lumen on this device?", "Sign out")) Cloud.signOut(); } }))) : null,
    ];
  }

  /* ---------- 2. Appearance ---------- */
  function wallTile(id, name, on, onPick, extra) {
    const kind = id ? Prefs.wallKind(id) : "aurora";
    return h("button", { type: "button", class: "st-wall" + (on ? " on" : ""), title: name, "aria-pressed": on ? "true" : "false", onclick: onPick },
      h("span", { class: "wall-thumb", dataset: { wall: id || "aurora", wallKind: kind } }, h("span", { class: "wt-glass" }), extra || null),
      h("small", { text: name }));
  }
  function appearance(ctx) {
    const s = S(), b = W().brand || {};
    const ownTheme = App.ownTheme(s), ownAccent = App.ownAccent(s);
    const modeNow = !ownTheme && b.mode ? b.mode : s.theme || "light";
    const accentNow = (!ownAccent && b.accent) || s.accent || App.ACCENTS[0];
    const modeSeg = seg([["light", "☀️ Light"], ["dark", "🌙 Dark"], ["system", "💻 System"]], modeNow, v => { localSave(x => { x.theme = v; x.themeChosen = true; }); ctx.redraw(); });
    const accents = h("div", { class: "accents st-accents" },
      ...App.ACCENTS.map(c => h("button", { type: "button", title: c, class: accentNow === c ? "on" : "", style: { background: c, color: c }, onclick: () => { localSave(x => { x.accent = c; x.accentChosen = true; }); ctx.redraw(); } })));
    const custom = h("input", { type: "color", class: "st-color", value: /^#[0-9a-f]{6}$/i.test(accentNow) ? accentNow : "#7c5cff", title: "Any color" });
    custom.addEventListener("input", deb(() => localSave(x => { x.accent = custom.value; x.accentChosen = true; }), 120));
    accents.append(custom);
    const blur = h("input", { type: "range", min: 0, max: 60, value: s.blur ?? 26 }), blurVal = h("span", { class: "set-val", text: (s.blur ?? 26) + "px" });
    blur.addEventListener("input", () => { s.blur = +blur.value; blurVal.textContent = s.blur + "px"; App.applySettings(); Store.save(); });
    blur.addEventListener("change", () => saved());
    const glassNow = s.glass ?? Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ga")) * 100 || 52);
    const glass = h("input", { type: "range", min: 15, max: 90, value: glassNow }), glassVal = h("span", { class: "set-val", text: (100 - glassNow) + "%" });
    glass.addEventListener("input", () => { s.glass = +glass.value; glassVal.textContent = (100 - s.glass) + "%"; App.applySettings(); Store.save(); });
    glass.addEventListener("change", () => saved());
    const wsWall = b.theme || "aurora", wsName = (Prefs.WALLPAPERS.find(w => w.id === wsWall) || {}).name || "Aurora";
    const walls = h("div", { class: "st-walls" },
      wallTile(wsWall, "Workspace default", !s.wallpaper, () => { localSave(x => { x.wallpaper = ""; }); ctx.redraw(); }, h("span", { class: "wt-badge", text: wsName })),
      ...Prefs.WALLPAPERS.map(w => wallTile(w.id, w.name, s.wallpaper === w.id, () => { localSave(x => { x.wallpaper = w.id; }); ctx.redraw(); })));
    return [
      card("Theme", "Saved on this device. Your workspace's default look applies until you pick your own.",
        row("Appearance", "Light, dark or follow your system", h("div", { class: "st-stack" }, modeSeg,
          b.mode && ownTheme ? h("button", { class: "st-link", text: `Use workspace default (${b.mode})`, onclick: () => { localSave(x => { x.themeChosen = false; }); ctx.redraw(); } }) : null)),
        row("Accent color", "Buttons, highlights and checkboxes", h("div", { class: "st-stack" }, accents,
          b.accent && ownAccent ? h("button", { class: "st-link", text: "Use workspace default", onclick: () => { localSave(x => { x.accentChosen = false; }); ctx.redraw(); } }) : null)),
        row("Glass blur", "How frosted the panels look", h("span", { class: "set-ctl" }, blur, blurVal)),
        row("Glass transparency", "How much of the wallpaper shows through", h("span", { class: "set-ctl" }, glass, glassVal)),
        row("Animations", "Moving wallpaper and motion effects", sw(s.motion !== false, v => localSave(x => { x.motion = v; })))),
      card("Wallpaper", "The background behind the glass. Every wallpaper has a light and a dark version.", walls),
    ];
  }

  /* ---------- 3. Notifications ---------- */
  function notifications(ctx) {
    const me = Prefs.me(), n = me.notify || {}, dnd = me.dnd || {};
    const CH = [["card", "Pop-up"], ["sound", "Sound"], ["desktop", "Desktop"]];
    const grid = h("div", { class: "st-ntable", role: "table" },
      h("div", { class: "st-nrow st-nhead", role: "row" }, h("span", { text: "Notify me about" }), ...CH.map(([c, l]) => h("span", { class: "st-nc", text: l }))),
      ...Prefs.NOTIFY_TYPES.map(t => h("div", { class: "st-nrow", role: "row" },
        h("span", { class: "st-nl" }, h("b", { text: NOTIFY_LABELS[t]?.[0] || t }), h("small", { text: NOTIFY_LABELS[t]?.[1] || "" })),
        ...CH.map(([c, l]) => h("span", { class: "st-nc" }, sw((n[t] || {})[c] !== false, v => meSave({ notify: { [t]: { [c]: v } } }), `${l}: ${NOTIFY_LABELS[t]?.[0] || t}`))))));
    const allOn = Prefs.NOTIFY_TYPES.every(t => CH.every(([c]) => (n[t] || {})[c] !== false));
    const from = h("input", { class: "menu-input st-time", type: "time", value: dnd.from || "22:00" }), to = h("input", { class: "menu-input st-time", type: "time", value: dnd.to || "08:00" });
    const saveDnd = () => meSave({ dnd: { from: from.value || "22:00", to: to.value || "08:00" } });
    from.onchange = saveDnd; to.onchange = saveDnd;
    const dndNow = Prefs.inDnd();
    return [
      card("This device", "Pop-ups and sounds on this computer or phone.", ...(window.Notify ? Notify.settingsRows(row) : [row("Notifications", "Still loading…", null)])),
      card("What to notify me about", "Pick how each kind of update reaches you. Everything still shows in the 🔔 bell.",
        h("div", { class: "st-card-acts" }, h("button", { class: "btn", text: allOn ? "Turn all off" : "Turn all on", onclick: () => { meSave({ notify: Object.fromEntries(Prefs.NOTIFY_TYPES.map(t => [t, { card: !allOn, sound: !allOn, desktop: !allOn }])) }); ctx.redraw(); } })),
        grid),
      card("Do not disturb", "No pop-ups, sounds or desktop notifications during these hours. Notifications wait in the bell.",
        row("Do not disturb", dnd.on ? (dndNow ? "On right now" : "Scheduled") : "Off", sw(!!dnd.on, v => { meSave({ dnd: { on: v } }); ctx.redraw(); })),
        row("Quiet hours", "From – to, in this device's time. Over midnight works too.", h("span", { class: "st-inline" }, from, h("span", { text: "to" }), to))),
    ];
  }

  /* ---------- 4. Sidebar menu ---------- */
  function menu(ctx) {
    const m = Prefs.me().menu || {}, hidden = new Set(m.hidden || []);
    const apps = Apps.menuApps();
    const saveOrder = list => { meSave({ menu: { order: list } }); Apps.renderNav(); ctx.redraw(); };
    const move = (i, d) => { const l = [...apps], j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; saveOrder(l); };
    let dragged = null;
    const list = h("div", { class: "st-menu" }, ...apps.map((n, i) => {
      const d = Apps.reg[n], off = !Apps.toolOn(n), noAccess = Apps.can && !Apps.can(n, "view");
      const el = h("div", { class: "st-mi" + (hidden.has(n) ? " hid" : "") + (off || noAccess ? " dim" : ""), draggable: true, dataset: { app: n } },
        h("span", { class: "st-grip", title: "Drag to reorder", text: "⋮⋮" }),
        h("span", { class: "st-mi-ic", text: d.icon }), h("span", { class: "st-mi-t", text: d.title }),
        off ? h("small", { class: "st-mi-note", text: "Switched off for the workspace" }) : noAccess ? h("small", { class: "st-mi-note", text: "Your level can't open it" }) : null,
        h("span", { class: "st-mi-acts" },
          h("button", { type: "button", class: "icon-btn xs", title: "Move up", "aria-label": "Move up", text: "↑", disabled: i === 0, onclick: () => move(i, -1) }),
          h("button", { type: "button", class: "icon-btn xs", title: "Move down", "aria-label": "Move down", text: "↓", disabled: i === apps.length - 1, onclick: () => move(i, 1) }),
          sw(!hidden.has(n), v => { const s = new Set(hidden); v ? s.delete(n) : s.add(n); meSave({ menu: { hidden: [...s] } }); Apps.renderNav(); ctx.redraw(); }, "Show " + d.title)));
      el.addEventListener("dragstart", e => { dragged = n; el.classList.add("drag"); try { e.dataTransfer.setData("text/plain", n); e.dataTransfer.effectAllowed = "move"; } catch {} });
      el.addEventListener("dragend", () => { el.classList.remove("drag"); list.querySelectorAll(".over").forEach(x => x.classList.remove("over")); });
      el.addEventListener("dragover", e => { if (!dragged || dragged === n) return; e.preventDefault(); list.querySelectorAll(".over").forEach(x => x.classList.remove("over")); el.classList.add("over"); });
      el.addEventListener("drop", e => {
        e.preventDefault(); if (!dragged || dragged === n) return;
        const l = apps.filter(x => x !== dragged); l.splice(l.indexOf(n) + (apps.indexOf(dragged) < apps.indexOf(n) ? 1 : 0), 0, dragged); dragged = null; saveOrder(l);
      });
      return el;
    }));
    return [card("Apps in the sidebar", "Drag to change the order, switch off the ones you don't use. This only changes your own sidebar.",
      h("div", { class: "st-card-acts" }, h("button", { class: "btn", text: "Reset to default", onclick: () => { meSave({ menu: { order: [], hidden: [] } }); Apps.renderNav(); ctx.redraw(); } })), list)];
  }

  /* ---------- 5. My language & region ---------- */
  function myRegion(ctx) {
    const mine = S().region || {}, w = W().region;
    const set = (k, v) => localSave(x => { x.region = { ...(x.region || {}), [k]: v }; });
    const fmtName = id => (dateFormats().find(f => f[0] === id) || [, id])[1];
    const sample = h("div", { class: "st-sample" });
    const paint = () => sample.replaceChildren(h("span", { text: "Now: " }), h("b", { text: Apps.fmtDateTime(Date.now()) }), h("span", { text: " · today " + Apps.fmtDate(Apps.today(), { year: true }) }));
    paint();
    const after = fn => v => { fn(v); paint(); };
    return [
      card("Workspace defaults", "Set by your admins in Workspace → Language & region.",
        row("Time zone", "", h("span", { class: "st-ro-val", text: w.timezone || `Each device's own (${deviceTz() || "local"})` })),
        row("Date format", "", h("span", { class: "st-ro-val", text: fmtName(w.dateFormat || "auto") })),
        row("Time format", "", h("span", { class: "st-ro-val", text: w.time24 ? "24-hour" : "12-hour" }))),
      card("My overrides", "Only for you, on this device. Leave on “Workspace” to follow the defaults.",
        row("Time zone", "Times of messages, posts and reminders", sel([["", "Workspace" + (w.timezone ? ` (${w.timezone})` : "")], ...timezones()], mine.timezone || "", after(v => set("timezone", v)))),
        row("Date format", "", sel([["", "Workspace (" + fmtName(w.dateFormat || "auto").replace(/^Automatic · .*/, "automatic") + ")"], ...dateFormats()], mine.dateFormat || "", after(v => set("dateFormat", v)))),
        row("Time format", "", seg([["", "Workspace"], ["12", "12-hour"], ["24", "24-hour"]], mine.time24 === true ? "24" : mine.time24 === false ? "12" : "", after(v => set("time24", v === "" ? "" : v === "24")))),
        sample),
    ];
  }

  /* ---------- 6. Tools ---------- */
  function tools(ctx) {
    const t = W().tools || {};
    const apps = Object.keys(Apps.reg).filter(n => n !== "home" && n !== "settings");
    const save = (app, patch) => { const cur = t[app] || {}; wsSave("tools", { [app]: { on: cur.on !== false, features: { ...(cur.features || {}) }, ...patch } }); ctx.redraw(); };
    return [lockNote(), card("Tools", "Switch whole apps or parts of them off for everyone. Switched-off apps leave the sidebar; nothing is deleted, so you can switch them back on anytime.",
      lockable(h("div", { class: "st-tools" }, ...apps.map(n => {
        const d = Apps.reg[n], cur = t[n] || {}, on = cur.on !== false, feats = FEATURES[n] || [];
        return h("div", { class: "st-tool" + (on ? "" : " off") },
          h("div", { class: "st-tool-h" }, h("span", { class: "st-mi-ic", text: d.icon }), h("b", { text: d.title }), sw(on, v => save(n, { on: v }), "Switch " + d.title)),
          feats.length ? h("div", { class: "st-feats" }, ...feats.map(([k, l]) => {
            const fon = (cur.features || {})[k] !== false;
            return h("button", { type: "button", class: "st-feat" + (fon ? " on" : ""), disabled: !on, "aria-pressed": fon ? "true" : "false", onclick: () => save(n, { features: { ...(cur.features || {}), [k]: !fon } }) },
              h("span", { class: "st-check", text: fon ? "✓" : "" }), l);
          })) : null);
      }))))];
  }

  /* ---------- 7. My workspace ---------- */
  function workspace(ctx) {
    const b = W().brand || {};
    const nameIn = txt(Store.getName(), v => { if (!admin()) return; Store.setName(v || "My Workspace"); Sidebar.render(); saved(); }, { maxlength: 60 });
    const logo = b.logo, src = logo && typeof logo === "object" ? logo.url : "", emoji = typeof logo === "string" ? logo : "";
    const prev = h("span", { class: "st-logo" }, src ? h("img", { src, alt: "Logo" }) : emoji ? h("span", { text: emoji }) : h("img", { src: "assets/logo.svg", alt: "Lumen" }));
    const pickEmoji = h("button", { type: "button", class: "btn", text: "Emoji…", onclick: () => UI.emojiPicker(pickEmoji, e => { wsSave("brand", { logo: e || "" }); ctx.redraw(); }, { remove: true }) });
    const upload = h("button", { type: "button", class: "btn", text: "Upload image…", onclick: async () => {
      const [f] = await Apps.pickFiles(false); if (!f) return;
      if (!/^image\//.test(f.type)) return UI.toast("Pick an image file");
      try { const url = await shrinkImage(f, 96); wsSave("brand", { logo: { url, name: f.name } }); ctx.redraw(); } catch { UI.toast("Couldn't read that image"); }
    } });
    const accents = h("div", { class: "accents st-accents" },
      h("button", { type: "button", class: "st-none" + (!b.accent ? " on" : ""), title: "No default (people choose)", text: "∅", onclick: () => { wsSave("brand", { accent: "" }); ctx.redraw(); } }),
      ...App.ACCENTS.map(c => h("button", { type: "button", title: c, class: b.accent === c ? "on" : "", style: { background: c, color: c }, onclick: () => { wsSave("brand", { accent: c }); ctx.redraw(); } })));
    const walls = h("div", { class: "st-walls" }, ...Prefs.WALLPAPERS.map(w => wallTile(w.id, w.name, (b.theme || "aurora") === w.id, () => { wsSave("brand", { theme: w.id }); ctx.redraw(); })));
    const link = window.Cloud?.ws ? `${location.origin}${location.pathname}#/ws/${Cloud.ws.id}` : "";
    return [lockNote(),
      card("Name and logo", "Shown at the top of the sidebar for everyone.", lockable(
        row("Workspace name", "", nameIn),
        row("Logo", "An emoji or a small image (shown at 24 px)", h("div", { class: "st-inline" }, prev, pickEmoji, upload,
          logo ? h("button", { type: "button", class: "btn danger", text: "Remove", onclick: () => { wsSave("brand", { logo: "" }); ctx.redraw(); } }) : null)))),
      card("Default look", "What everyone sees until they pick their own in Appearance.", lockable(
        row("Appearance", "", seg([["", "People choose"], ["light", "Light"], ["dark", "Dark"], ["system", "System"]], b.mode || "", v => { wsSave("brand", { mode: v }); ctx.redraw(); })),
        row("Accent color", "", accents),
        h("div", { class: "st-sub", text: "Default wallpaper" }), walls)),
      card("Lumen address", "Where your team opens the workspace.",
        row("Address", "Lumen runs at this address for every workspace", h("a", { class: "st-ro-val", href: "https://lumenspaceapp.github.io", target: "_blank", rel: "noopener", text: "lumenspaceapp.github.io" })),
        link ? row("Link to this workspace", "Members open it after signing in", h("button", { class: "btn", text: "Copy link", onclick: () => { navigator.clipboard?.writeText(link); UI.toast("🔗 Link copied"); } })) : null),
    ];
  }

  /* ---------- 8. Communications ---------- */
  function comms(ctx) {
    const c = W().comms;
    const like = h("button", { type: "button", class: "st-like" }, h("span", { text: "♡" }), h("span", { class: "st-like-t", text: c.likeText || "Like" }), h("small", { text: "3" }));
    const likeIn = txt(c.likeText, v => { like.querySelector(".st-like-t").textContent = v || "Like"; wsSave("comms", { likeText: v || "Like" }); }, { maxlength: 20, placeholder: "Like" });
    likeIn.addEventListener("input", () => { like.querySelector(".st-like-t").textContent = likeIn.value || "Like"; });
    const vers = h("input", { type: "range", min: 1, max: 20, value: c.driveVersions || 5 }), versVal = h("span", { class: "set-val", text: String(c.driveVersions || 5) });
    vers.addEventListener("input", () => { versVal.textContent = vers.value; });
    vers.addEventListener("change", () => wsSave("comms", { driveVersions: +vers.value }));
    return [lockNote(),
      card("Feed", "", lockable(
        row("Who can post to all employees", "Others can still post to people and departments", sel([["all", "Everyone"], ["managers", "Managers and above"], ["admins", "Admins only"]], c.feedBroadcast, v => wsSave("comms", { feedBroadcast: v }))),
        row("“All employees” selected by default", "New posts start addressed to everyone", sw(c.feedDefaultAll !== false, v => wsSave("comms", { feedDefaultAll: v }))),
        row("Like button text", "Try “Like”, “👍” or “Kudos”", h("div", { class: "st-inline" }, likeIn, like)),
        h("div", { class: "st-chips" }, ...["Like", "👍", "Kudos", "❤️", "Agree", "🎉"].map(x => h("button", { type: "button", class: "chip-btn", text: x, onclick: () => { likeIn.value = x; like.querySelector(".st-like-t").textContent = x; wsSave("comms", { likeText: x }); } }))))),
      card("Chats", "", lockable(
        row("Who can post in #general", "", seg([["all", "Everyone"], ["admins", "Admins"], ["owner", "Owner"]], c.generalPost, v => wsSave("comms", { generalPost: v }))),
        row("Post a notice when someone joins or is removed", "A short message in #general", sw(c.announceJoins !== false, v => wsSave("comms", { announceJoins: v }))),
        row("Rich link previews", "Show a preview card for links in messages", sw(c.linkPreviews !== false, v => wsSave("comms", { linkPreviews: v }))))),
      card("Drive", "", lockable(
        row("File versions to keep", "Older versions are removed when a file is updated", h("span", { class: "set-ctl" }, vers, versVal)))),
    ];
  }

  /* ---------- 9. Employees ---------- */
  function employees(ctx) {
    const p = W().people, me = Data.me(), full = (me.name && me.name !== "You" && me.name.includes(" ")) ? me.name : "John Smith";
    const [f, ...rest] = full.split(/\s+/), l = rest.join(" ");
    const fmts = [["first_last", `${f} ${l}`], ["last_first", `${l} ${f}`], ["first_l", `${f} ${l[0]}.`], ["f_last", `${f[0]}. ${l}`]];
    const code = p.phoneCountry || "", known = PHONE_CODES.some(x => x[0] === code);
    return [lockNote(),
      card("Names and profiles", "", lockable(
        row("Name format", "How names appear everywhere in Lumen", sel(fmts, p.nameFormat || "first_last", v => wsSave("people", { nameFormat: v }))),
        row("Default phone country code", "Suggested when people type a phone number", sel([["", "None"], ...(code && !known ? [[code, code]] : []), ...PHONE_CODES.map(([c, n]) => [c, `${c} · ${n}`])], code, v => wsSave("people", { phoneCountry: v }))),
        row("Show year of birth", "Off: profiles show only the day and month", sw(p.showBirthYear !== false, v => wsSave("people", { showBirthYear: v }))))),
      card("Inviting people", "", lockable(
        row("Who can invite", "Admins can always invite", seg([["everyone", "Everyone"], ["managers", "Managers and above"], ["admins", "Admins"]], p.invite || "managers", v => wsSave("people", { invite: v }))),
        row("Allowed email domains", "Comma-separated, e.g. company.com. Empty: any address", txt((p.inviteDomains || []).join(", "), v => wsSave("people", { inviteDomains: v.split(/[\s,;]+/).map(x => x.trim().toLowerCase().replace(/^@/, "")).filter(Boolean) }), { placeholder: "Any domain" })))),
      card("New employees", "When someone opens the workspace for the first time.", lockable(
        row("Announce in #general chat", "", sw(!!(p.announceNew || {}).chat, v => wsSave("people", { announceNew: { ...(p.announceNew || {}), chat: v } }))),
        row("Announce in the Feed", "", sw(!!(p.announceNew || {}).feed, v => wsSave("people", { announceNew: { ...(p.announceNew || {}), feed: v } }))))),
    ];
  }

  /* ---------- 10. Company details (settings/company, printed on invoices) ---------- */
  function company(ctx) {
    const c = { ...(Data.get("settings", "company") || {}) }; // a copy: never change Data's cached doc in place
    const put = patch => {
      if (!admin()) return;
      const next = { ...c, ...patch }; Object.assign(c, patch);
      // the bank fields also make up the single "bank details" text printed on invoices
      const lines = [next.bankName, next.bankAddress, next.accountHolder && "Account holder: " + next.accountHolder, next.accountNumber && "Account no.: " + next.accountNumber, next.iban && "IBAN / SWIFT / routing: " + next.iban].filter(Boolean);
      if (["bankName", "bankAddress", "accountHolder", "accountNumber", "iban"].some(k => k in patch)) patch = { ...patch, bank: lines.join("\n") };
      lastWrite = Date.now(); Data.update("settings", "company", patch); saved();
    };
    const f = (k, ph, attrs) => txt(c[k], v => put({ [k]: v }), { placeholder: ph || "", ...attrs });
    const logoFile = c.logo?.id ? Data.get("files", c.logo.id) : null;
    const logoBox = h("span", { class: "st-logo big" }, logoFile?.data ? h("img", { src: logoFile.data, alt: "Logo" }) : h("span", { text: "🏢" }));
    const up = h("button", { type: "button", class: "btn", text: c.logo ? "Change logo" : "Upload logo", onclick: async () => {
      const [file] = await Apps.pickFiles(false); if (!file) return;
      if (!/^image\//.test(file.type)) return UI.toast("Pick an image file");
      up.disabled = true; up.textContent = "Uploading…";
      try {
        const url = await shrinkImage(file, 480), blob = await (await fetch(url)).blob();
        const [att] = await Apps.attach([new File([blob], file.name.replace(/\.\w+$/, "") + ".png", { type: "image/png" })]);
        if (att) put({ logo: att });
      } catch { UI.toast("Couldn't read that image"); }
      ctx.redraw();
    } });
    const oldBank = c.bank && !["bankName", "bankAddress", "accountHolder", "accountNumber", "iban"].some(k => c[k]);
    return [lockNote(),
      card("Business", "Your company's details, printed on estimates and invoices.", lockable(
        row("Business name", "", f("name", "Acme Studio")),
        row("Tax / VAT ID", "", f("taxId", "VAT, GST or tax number")),
        row("Address", "", f("address", "Street, city, postcode, country", { rows: 2 }), "st-row-top"),
        row("Phone", "", f("phone", "", { type: "tel" })),
        row("Email", "", f("email", "billing@example.com", { type: "email" })),
        row("Website", "", f("website", "example.com")),
        row("Logo", "PNG or JPG", h("div", { class: "st-inline" }, logoBox, up, c.logo ? h("button", { type: "button", class: "btn danger", text: "Remove", onclick: () => { put({ logo: null }); ctx.redraw(); } }) : null)))),
      card("Bank details", "Shown on invoices so clients know where to pay.", lockable(
        oldBank ? h("div", { class: "st-note", text: "Currently on invoices: " + c.bank.replace(/\n/g, " · ") + ". Filling in the fields below replaces it." }) : null,
        row("Bank name", "", f("bankName", "e.g. HDFC Bank")),
        row("Bank address", "", f("bankAddress", "Branch address")),
        row("Account holder", "", f("accountHolder", "Name on the account")),
        row("Account number", "", f("accountNumber", "")),
        row("IBAN / SWIFT / routing", "Whatever your clients need: IBAN, SWIFT/BIC, IFSC or routing number", f("iban", "")))),
      Apps.Sales?.settings ? card("", "", row("Numbering and default texts", "Invoice and estimate prefixes, next numbers, notes and terms", h("button", { class: "btn", text: "Open…", disabled: !admin(), onclick: () => Apps.Sales.settings() }))) : null,
    ];
  }

  /* ---------- 11. Business hours ---------- */
  function hours(ctx) {
    const hr = W().hours, weekend = new Set(hr.weekend || []);
    const start = h("input", { class: "menu-input st-time", type: "time", value: hr.start || "09:00" }), end = h("input", { class: "menu-input st-time", type: "time", value: hr.end || "18:00" });
    const saveTimes = () => { if (start.value && end.value && start.value >= end.value) return UI.toast("The working day must end after it starts"); wsSave("hours", { start: start.value || "09:00", end: end.value || "18:00" }); };
    start.onchange = saveTimes; end.onchange = saveTimes;
    const order = [1, 2, 3, 4, 5, 6, 0].sort((a, b) => ((a - hr.weekStart + 7) % 7) - ((b - hr.weekStart + 7) % 7));
    const days = h("div", { class: "st-days" }, ...order.map(d => h("button", { type: "button", class: "st-day" + (weekend.has(d) ? " on" : ""), "aria-pressed": weekend.has(d) ? "true" : "false", text: DAY[d].slice(0, 2), title: DAY[d],
      onclick: () => { const s = new Set(weekend); s.has(d) ? s.delete(d) : s.add(d); wsSave("hours", { weekend: [...s].sort() }); ctx.redraw(); } })));
    const hol = [...(hr.holidays || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const saveHol = list => { wsSave("hours", { holidays: list.sort((a, b) => String(a.date).localeCompare(String(b.date))) }); ctx.redraw(); };
    const nd = h("input", { class: "menu-input st-in", type: "date" }), nn = h("input", { class: "menu-input st-in", placeholder: "Holiday name", maxlength: 60 });
    const add = () => { if (!nd.value) return UI.toast("Pick a date"); saveHol([...hol, { date: nd.value, name: nn.value.trim() || "Holiday" }]); };
    nn.addEventListener("keydown", e => { if (e.key === "Enter") add(); });
    const y = new Date().getFullYear();
    let year = y;
    const yearSel = sel([[y, String(y)], [y + 1, String(y + 1)]], y, v => (year = +v));
    const preset = key => {
      const have = new Set(hol.map(x => x.date + "|" + x.name)), add = PRESETS[key].list(year).filter(([d, n]) => !have.has(d + "|" + n)).map(([date, name]) => ({ date, name }));
      if (!add.length) return UI.toast("Those holidays are already on the list");
      saveHol([...hol, ...add]); UI.toast(`Added ${add.length} holiday${add.length === 1 ? "" : "s"}. Check the dates for your region.`);
    };
    return [lockNote(),
      card("Working time", "Used by Calendar, time off, Booking and task deadlines.", lockable(
        row("Working day", "Start and end", h("span", { class: "st-inline" }, start, h("span", { text: "to" }), end)),
        row("Weekend", "Days off every week (highlighted)", days),
        row("First day of the week", "", seg([[1, "Monday"], [0, "Sunday"], [6, "Saturday"]], hr.weekStart, v => { wsSave("hours", { weekStart: +v }); ctx.redraw(); })))),
      card("Holidays", "Days off for everyone. They don't count as working days.", lockable(
        hol.length ? h("div", { class: "st-hols" }, ...hol.map((x, i) => h("div", { class: "st-hol" },
          h("span", { class: "st-hol-d", text: Apps.fmtDate(x.date, { year: true }) }), h("span", { class: "st-hol-n", text: x.name || "Holiday" }),
          h("button", { type: "button", class: "icon-btn xs", title: "Remove", "aria-label": "Remove " + (x.name || "holiday"), html: UI.icon("x"), onclick: () => saveHol(hol.filter((_, j) => j !== i)) })))) : h("div", { class: "st-empty", text: "No holidays yet." }),
        h("div", { class: "st-hol-add" }, nd, nn, h("button", { type: "button", class: "btn primary", text: "Add", onclick: add })),
        h("div", { class: "st-hol-presets" }, h("span", { text: "Add common holidays for" }), yearSel,
          ...Object.entries(PRESETS).map(([k, p]) => h("button", { type: "button", class: "btn", text: "🗓 " + p.label, onclick: () => preset(k) }))))),
    ];
  }

  /* ---------- 12. Language & region (workspace) ---------- */
  function region(ctx) {
    const r = W().region, cur = r.currency || "";
    const sample = h("div", { class: "st-sample" });
    const paint = () => sample.replaceChildren(h("span", { text: "Preview: " }), h("b", { text: Apps.fmtDateTime(Date.now()) }), h("span", { text: " · " + Apps.money(1234567) }));
    paint();
    const save = patch => { wsSave("region", patch); setTimeout(paint, 30); };
    return [lockNote(),
      card("Date and time", "Everyone sees dates and times like this, unless they set their own in My language & region.", lockable(
        row("Date format", "", sel(dateFormats(), r.dateFormat || "auto", v => save({ dateFormat: v }))),
        row("24-hour time", "Off: 9:30 PM · On: 21:30", sw(!!r.time24, v => save({ time24: v }))),
        row("Time zone", "Empty: each device uses its own", sel([["", `Each device's own (${deviceTz() || "local"})`], ...timezones()], r.timezone || "", v => save({ timezone: v }))),
        sample)),
      card("Money and language", "", lockable(
        row("Default currency", "Used by CRM, invoices, Booking and Inventory", sel([["", `Automatic (${Apps.currency()})`], ...(cur && !CURRENCIES.includes(cur) ? [[cur, cur]] : []), ...CURRENCIES.map(x => [x, x])], cur, v => save({ currency: v }))),
        row("Language", "More languages coming soon", sel([["en", "English"]], "en", () => {})))),
    ];
  }

  /* ---------- 13. Security ---------- */
  function security(ctx) {
    const sec = W().security;
    const people = shared() ? Data.people() : [];
    const pres = Object.fromEntries((window.Cloud?.people || []).map(p => [String(p.email || "").toLowerCase(), p.at?.toMillis?.() || 0]));
    const seen = k => { const t = pres[k]; if (!t) return "—"; return Date.now() - t < 70000 ? "Online now" : UI.timeAgo(t); };
    const rank = k => Apps.level ? Apps.level(k) : 3;
    return [lockNote(),
      card("Sign-in", "", lockable(
        row("Sign out automatically", "After this long without activity. A warning shows a minute before.", seg([[0, "Off"], [15, "15 min"], [30, "30 min"], [60, "1 hour"], [240, "4 hours"]], sec.idleSignOut || 0, v => wsSave("security", { idleSignOut: +v }))),
        row("Allow email-link sign-in", "Off: invites ask people to sign in with Google, and the sign-in screen on members' devices hides email links", sw(sec.emailLinks !== false, v => wsSave("security", { emailLinks: v }))))),
      shared() ? card("Members", "Who's in the workspace, their level and when they were last active.",
        h("div", { class: "st-members" }, ...people.sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name)).map(p => h("div", { class: "st-mem" },
          Apps.avatar(p, 30), h("span", { class: "st-mem-n" }, h("b", { text: p.name + (p.key === meKey() ? " (you)" : "") }), h("small", { text: p.email })),
          Apps.Access?.badge && Apps.role ? Apps.Access.badge(Apps.role(p.key)) : null,
          h("span", { class: "st-mem-seen", text: seen(p.key) })))),
        Apps.Access ? h("div", { class: "st-card-foot" }, h("button", { class: "btn", text: "Members & levels…", onclick: () => Apps.Access.open("people") })) : null)
        : card("Members", "", h("div", { class: "st-empty", text: "Members and levels are part of shared workspaces." })),
    ];
  }

  /* ---------- 14. AI ---------- */
  function ai(ctx) {
    const a = W().ai, on = !!window.LUMI_AI_URL;
    const places = [["tasks", "Tasks", "Write descriptions, split work into checklists"], ["feed", "Feed", "Draft posts and announcements"], ["crm", "CRM emails", "Draft emails to clients"],
      ["chat", "Chat", "Summarize conversations, suggest replies"], ["meetings", "Meetings", "Agendas and minutes"], ["kb", "Knowledge base", "Write and improve articles"]];
    return [lockNote(),
      card("CoPilot status", "",
        row("AI assistant", on ? "Connected to your AI server" : "Needs the AI server to be set up (window.LUMI_AI_URL, see SETUP.md)", h("span", { class: "st-status " + (on ? "ok" : "off"), text: on ? "● On" : "● Not set up" }))),
      card("Where CoPilot helps", "Switch the ✨ AI buttons on or off for each place.", lockable(
        ...places.map(([k, l, d]) => row(l, d, sw(a[k] !== false, v => wsSave("ai", { [k]: v }), "AI in " + l))))),
    ];
  }

  /* ---------- 15. Privacy (GDPR) ---------- */
  async function exportMine(btn) {
    const me = meKey(), cols = ["tasks", "projects", "feed", "chat", "channels", "events", "files", "folders", "leads", "deals", "contacts", "companies", "activities", "quotes", "absences", "timelog", "reports", "meetings",
      "bookings", "kbarticles", "boards", "signdocs", "listitems", "procitems", "wfruns", "dashboards", "campaigns"];
    const out = { app: "Lumen", kind: "personal data export", exportedAt: new Date().toISOString(), person: { key: me, ...(Data.get("people", me) || {}) }, workspace: window.Cloud?.ws ? { id: Cloud.ws.id, name: Cloud.ws.name } : { name: Store.getName(), private: true }, created: {} };
    btn.disabled = true; const label = btn.textContent; btn.textContent = "Collecting…";
    try {
      const fs = window.Cloud?.fs, cloud = shared() && fs?.ref();
      for (const col of cols) {
        if (Apps.canCol && !Apps.canCol(col)) continue;
        let rows = [];
        if (cloud) { try { const { fb, ref } = fs; const snap = await fb.getDocs(fb.query(fb.collection(ref(), col), fb.where("by", "==", me))); rows = snap.docs.map(d => ({ id: d.id, ...d.data() })); } catch (e) { console.warn(col, e); } }
        else rows = Data.list(col).filter(x => x.by === me);
        if (col === "files") rows = rows.map(({ data, ...meta }) => meta); // file contents stay out: metadata only
        if (rows.length) out.created[col] = rows;
      }
      download(`lumen-my-data-${Apps.today()}.json`, JSON.stringify(out, (k, v) => v && typeof v === "object" && typeof v.toMillis === "function" ? new Date(v.toMillis()).toISOString() : v, 2));
      UI.toast("⬇️ Your data was downloaded");
    } finally { btn.disabled = false; btn.textContent = label; }
  }
  function gdpr(ctx) {
    const g = W().gdpr, owner = Apps.level ? Apps.level() === 0 : true;
    return [
      card("Data protection", "Shown to members who ask how their data is handled.", lockNote(), lockable(
        row("Company name", "The data controller", txt(g.company, v => wsSave("gdpr", { company: v }), { placeholder: "Acme Ltd." })),
        row("Data protection officer", "", txt(g.dpo, v => wsSave("gdpr", { dpo: v }), { placeholder: "Name" })),
        row("Contact email", "For privacy requests", txt(g.email, v => wsSave("gdpr", { email: v }), { type: "email", placeholder: "privacy@example.com" })))),
      card("Your data", "",
        row("Export my data", "A JSON file of everything you created here: tasks, posts, messages, events, files (names and details, not contents) and your profile",
          h("button", { class: "btn primary", text: "Export my data", onclick: e => exportMine(e.currentTarget) })),
        owner && shared() && Apps.Access ? row("Full workspace export", "Owner only: every collection as JSON or CSV", h("button", { class: "btn", text: "Owner tools…", onclick: () => Apps.Access.open("owner") })) : null),
    ];
  }

  /* ---------- 17. Backup & reset (only with pages on) and shortcuts ---------- */
  function backup(ctx) {
    const file = h("input", { type: "file", accept: ".json", style: { display: "none" } });
    file.addEventListener("change", () => { const f = file.files[0]; if (!f) return; f.text().then(t => { try { Store.importAll(t); App.reboot(); UI.toast("Workspace imported"); } catch (e) { UI.toast("Import failed: " + e.message); } }); });
    return [card("Backup", "Pages in this workspace.",
      row("Backup", "Download or restore your whole workspace", h("div", { class: "st-inline" },
        h("button", { class: "btn", text: "Export", onclick: () => download("lumen-workspace.json", Store.exportAll()) }), h("button", { class: "btn", text: "Import", onclick: () => file.click() }), file)),
      row("Reset", "Replace everything with the demo workspace", h("button", { class: "btn danger", text: "Reset…", onclick: async () => { if (await UI.confirm("This erases all pages in this browser and restores the demo workspace. This can't be undone.", "Reset")) { Store.reset(); App.reboot(); UI.toast("Workspace reset"); } } })))];
  }
  function shortcuts() {
    const list = window.FEATURES.pages ? [["Search / commands", "Ctrl K"], ["New page", "Ctrl Alt N"], ["Toggle sidebar", "Ctrl \\"], ["Toggle theme", "Ctrl Shift L"], ["Slash menu", "/"], ["Move block", "Ctrl Shift ↑↓"],
      ["Indent / outdent", "Tab / Shift Tab"], ["Duplicate block", "Ctrl D"], ["Inline code", "Ctrl E"], ["Turn into heading", "Ctrl Alt 1-3"], ["Select block", "Esc"], ["Delete selected block", "Backspace"]]
      : [["Search and commands", "Ctrl K"], ["Toggle sidebar", "Ctrl \\"], ["Toggle theme", "Ctrl Shift L"], ["Ask Lumi", "Ctrl /"], ["Send a chat message", "Enter"], ["New line in chat", "Shift Enter"], ["Close a panel or window", "Esc"]];
    return [card("Keyboard shortcuts", "On a Mac use ⌘ instead of Ctrl.", h("div", { class: "st-keys" }, ...list.map(([a, k]) => h("div", { class: "st-key" }, h("span", { text: a }), h("kbd", { text: k })))))];
  }

  /* ---------- the sections (left nav) ---------- */
  const SECTIONS = [
    { group: "Personal" },
    { id: "profile", icon: "👤", title: "Your profile", desc: "Avatar, name, job title and contact details.", keys: "avatar photo name alias job title department phone birthday about me sign out account", draw: profile },
    { id: "appearance", icon: "🎨", title: "Appearance", desc: "Theme, accent color, glass and wallpaper.", keys: "theme dark light mode system accent color glass blur transparency animation motion wallpaper background aurora", draw: appearance },
    { id: "notifications", icon: "🔔", title: "Notifications", desc: "What reaches you, how, and quiet hours.", keys: "notifications alerts sound desktop popup pop-up do not disturb dnd quiet hours mentions chat", draw: notifications },
    { id: "menu", icon: "🧭", title: "Sidebar menu", desc: "Order of the apps in your sidebar and which ones show.", keys: "sidebar menu order reorder hide show apps configure", draw: menu },
    { id: "myregion", icon: "🕐", title: "My language & region", desc: "Your own time zone and date and time format.", keys: "time zone timezone date format time 12 24 hour personal region language", draw: myRegion },
    { group: "Workspace", ws: true },
    { id: "tools", icon: "🧰", title: "Tools", desc: "Switch apps and their features on or off for everyone.", keys: "tools apps features switch off on enable disable scrum gantt invoices web forms rpa calls polls versions rooms", draw: tools, ws: true },
    { id: "workspace", icon: "🏠", title: "My workspace", desc: "Name, logo, default look and address.", keys: "workspace name rename logo brand default wallpaper accent look address link", draw: workspace, ws: true },
    { id: "comms", icon: "💬", title: "Communications", desc: "Feed, chats and Drive rules.", keys: "feed post all employees like button kudos chat general announce join removed link preview drive versions", draw: comms, ws: true },
    { id: "employees", icon: "🧑‍🤝‍🧑", title: "Employees", desc: "Name format, phone code, invites and welcomes.", keys: "employees name format phone country code birth year invite domains announce new welcome", draw: employees, ws: true },
    { id: "company", icon: "🏢", title: "Company details", desc: "Business and bank details printed on invoices.", keys: "company details business name tax vat id address phone email website logo bank account iban swift routing invoice requisites", draw: company, ws: true },
    { id: "hours", icon: "🗓️", title: "Business hours", desc: "Working day, weekend, first day of the week and holidays.", keys: "business hours working day time weekend first day week holidays india us", draw: hours, ws: true },
    { id: "region", icon: "🌍", title: "Language & region", desc: "Date and time format, time zone, currency and language.", keys: "language region date format time 24 hour time zone timezone currency money", draw: region, ws: true },
    { id: "security", icon: "🔐", title: "Security", desc: "Automatic sign-out, sign-in options and members.", keys: "security sign out inactivity idle email link sign-in members last seen presence", draw: security, ws: true },
    { id: "signins", icon: "🕵️", title: "Sign-in history", desc: "Who signed in, when, and on which device.", keys: "sign-in login history log audit sessions devices browser security", draw: ext("LoginLog", "Sign-in history"), ws: true, show: shared },
    { id: "backups", icon: "💾", title: "Backups", desc: "Automatic daily backups to Google Drive, export and restore.", keys: "backup backups restore export import google drive daily 30 days recovery", draw: ext("Backups", "Backups"), ws: true, show: shared },
    { id: "branches", icon: "🏬", title: "Branches", desc: "Link branch workspaces and manage them from one place.", keys: "branches branch accounts offices centralized management head office multiple workspaces", draw: ext("Branches", "Branches"), ws: true, show: shared },
    { id: "api", icon: "🔌", title: "API & integrations", desc: "API keys that let other tools read and write this workspace.", keys: "api keys rest integrations developer webhook token connect zapier", draw: ext("ApiKeys", "API & integrations"), ws: true, show: shared },
    { id: "ai", icon: "✨", title: "AI (CoPilot)", desc: "Where the AI assistant may help.", keys: "ai copilot lumi assistant tasks feed crm emails chat meetings knowledge", draw: ai, ws: true },
    { id: "gdpr", icon: "🛡️", title: "Privacy (GDPR)", desc: "Data protection contacts and exporting your data.", keys: "privacy gdpr data protection officer dpo export my data download", draw: gdpr, ws: true },
    { id: "members", icon: "🔑", title: "Members & levels", desc: "People, levels and permissions.", keys: "members levels access permissions roles admin manager guest invite remove owner", action: () => Apps.Access ? Apps.Access.open("people") : UI.toast("Members & levels is still loading") },
    { id: "backup", icon: "💾", title: "Backup & reset", desc: "Download, restore or reset your pages.", keys: "backup export import reset pages", draw: backup, show: () => !!window.FEATURES.pages },
    { id: "shortcuts", icon: "⌨️", title: "Keyboard shortcuts", desc: "Work faster with the keyboard.", keys: "keyboard shortcuts keys hotkeys", draw: shortcuts },
  ];
  const visible = () => SECTIONS.filter(s => !s.id || !s.show || s.show());
  // helpers for the Enterprise section files: same look and saving behaviour as the built-in sections
  Apps.SettingsKit = { card, row, sw, seg, sel, txt, lockable, lockNote, admin, shared, saved, wsSave, markWrite: () => { lastWrite = Date.now(); } };
  const find = id => visible().find(s => s.id === id && s.draw);

  /* ---------- the page ---------- */
  function render(root, arg) {
    root.classList.add("st-root");
    let cur = find(arg) ? arg : "profile", q = "";
    const nav = h("nav", { class: "st-nav glass", "aria-label": "Settings sections" });
    const main = h("div", { class: "st-main" });
    const search = h("input", { class: "menu-input st-search", type: "search", placeholder: "Search settings…", "aria-label": "Search settings" });
    const list = h("div", { class: "st-nav-list" });
    nav.append(search, list);
    root.append(Apps.header("Settings", "⚙️", "Your preferences and how the workspace works"), h("div", { class: "st-wrap" }, nav, main));

    const matches = s => { if (!q) return true; const hay = (s.title + " " + s.desc + " " + s.keys).toLowerCase(); return q.split(/\s+/).every(w => hay.includes(w)); };
    function drawNav() {
      list.replaceChildren();
      let group = null, any = false;
      visible().forEach(s => {
        if (!s.id) { group = s; return; }
        if (!matches(s)) return;
        if (group) { list.append(h("div", { class: "st-grp" }, h("span", { text: group.group }), group.ws && !admin() ? h("span", { class: "st-grp-lock", title: "View only", html: UI.icon("lock") }) : null)); group = null; }
        any = true;
        list.append(h("button", { type: "button", class: "st-item" + (s.id === cur ? " on" : ""), "aria-current": s.id === cur ? "page" : null, onclick: () => open(s.id) },
          h("span", { class: "st-ic", text: s.icon }), h("span", { class: "st-t", text: s.title }), s.action ? h("span", { class: "st-ext", text: "↗" }) : null));
      });
      if (!any) list.append(h("div", { class: "st-empty", text: "No settings match." }));
    }
    function open(id) {
      const s = SECTIONS.find(x => x.id === id); if (!s) return;
      if (s.action) return s.action();
      if (id !== cur) { cur = id; history.pushState(null, "", "#/app/settings/" + id); }
      drawNav(); draw(true);
      if (innerWidth < 760) nav.querySelector(".st-item.on")?.scrollIntoView({ inline: "center", block: "nearest" });
    }
    const ctx = { redraw: () => draw() };
    function draw(top) {
      const s = find(cur) || find("profile");
      const kids = (s.draw(ctx) || []).flat().filter(Boolean);
      main.replaceChildren(h("div", { class: "st-head" }, h("span", { class: "st-head-ic", text: s.icon }), h("div", null, h("h2", { text: s.title }), h("p", { text: s.desc }))), ...kids);
      document.title = s.title + " · Settings · Lumen";
      if (top) document.getElementById("scroller").scrollTop = 0;
    }
    search.addEventListener("input", () => { q = search.value.trim().toLowerCase(); drawNav(); });
    search.addEventListener("keydown", e => { if (e.key === "Enter") { const first = visible().find(s => s.id && matches(s)); if (first) open(first.id); } if (e.key === "Escape") { search.value = ""; q = ""; drawNav(); } });
    drawNav(); draw();

    // someone else changed settings (or my profile synced): redraw, but not right after my own change and never while I'm typing
    const live = UI.liveDraw(main, () => { if (Date.now() - lastWrite > 1500) draw(); });
    const navLive = () => { drawNav(); lastWrite = 0; live(); }; // my level changed: locks and badges may differ
    const offs = [Data.on("settings", live), Data.on("people", live)];
    Apps.onAccess?.add(navLive);
    return () => { offs.forEach(f => f()); Apps.onAccess?.delete(navLive); };
  }

  Apps.register("settings", { title: "Settings", icon: "⚙️", hidden: true, noBanner: true, render });

  /* ======================================================================
     Background: automatic sign-out after inactivity (Settings → Security)
     ====================================================================== */
  const ACT_KEY = "lumen-last-activity";
  let lastAct = Date.now(), lastShared = 0, warnEl = null;
  const touch = () => {
    lastAct = Date.now();
    if (lastAct - lastShared > 15000) { lastShared = lastAct; try { localStorage.setItem(ACT_KEY, String(lastAct)); } catch {} } // other tabs count too
    if (warnEl) closeWarn();
  };
  ["pointerdown", "keydown", "wheel", "touchstart"].forEach(ev => addEventListener(ev, touch, { capture: true, passive: true }));
  let moveT = 0; addEventListener("mousemove", () => { const n = Date.now(); if (n - moveT > 5000) { moveT = n; touch(); } }, { passive: true });
  function closeWarn() { warnEl?.remove(); warnEl = null; }
  function idleCheck() {
    if (!shared()) return closeWarn();
    let min = 0; try { min = +Prefs.get("security.idleSignOut") || 0; } catch {}
    if (!min) return closeWarn();
    let other = 0; try { other = +localStorage.getItem(ACT_KEY) || 0; } catch {}
    const idle = Date.now() - Math.max(lastAct, other), limit = min * 60000;
    if (idle >= limit) { closeWarn(); UI.toast("Signed out after " + (min >= 60 ? min / 60 + " hour" + (min > 60 ? "s" : "") : min + " minutes") + " without activity"); Cloud.signOut?.(); return; }
    if (idle >= limit - 60000) {
      const left = Math.max(0, Math.ceil((limit - idle) / 1000));
      if (!warnEl) {
        warnEl = h("div", { class: "st-idle glass-strong", role: "alertdialog", "aria-live": "assertive" },
          h("span", { class: "st-idle-ic", text: "⏳" }), h("div", { class: "grow" }, h("b", { text: "Still there?" }), h("span", { class: "st-idle-t" })),
          h("button", { class: "btn primary", text: "Stay signed in", onclick: touch }));
        document.body.append(warnEl);
      }
      warnEl.querySelector(".st-idle-t").textContent = `For your security you'll be signed out in ${left} s.`;
    } else closeWarn();
  }
  setInterval(idleCheck, 1000);

  /* the sign-in screen shows before any workspace data loads: remember the last workspace's email-link switch on this device */
  Prefs.on(ws => { if (shared() && Data.get("settings", "workspace")) { try { localStorage.setItem("lumen-email-links", ws.security.emailLinks === false ? "0" : "1"); } catch {} } });
})();
