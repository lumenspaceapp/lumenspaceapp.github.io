/* Marketing (Bitrix24 "Marketing"): Start, Campaigns, Segments, My templates, Recipients, Black list, Settings.
   Lumen has no mail server, so nothing is sent from here by itself: campaigns are built, personalised and tracked in
   Lumen, then sent from the user's own mail app (one personal email per person via mailto), as a BCC list, or through a
   mail-merge tool (CSV with a personal subject and body per person). SMS works the same way (sms: links, CSV, copy).
   Data: segments, campaigns, settings "marketing" { from, replyTo, signature, unsub, color, blacklist: [], templates: [] }. */
(function () {
  const { h, esc } = UI;
  const APP = "marketing";
  const DAY = 864e5;
  const TOUCH = "ontouchstart" in window;
  const me = () => Data.me().key;
  const uid = () => Math.random().toString(36).slice(2, 10);
  const low = s => String(s ?? "").trim().toLowerCase();
  const digits = s => String(s ?? "").replace(/\D/g, "");
  const clone = o => JSON.parse(JSON.stringify(o ?? {}));
  const clamp = (n, a, b) => Math.max(a, Math.min(b, isNaN(n) ? a : n));
  const num = n => (+n || 0).toLocaleString();
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many || one + "s"}`;
  const pct = (a, b) => b ? Math.round((+a || 0) / b * 100) + "%" : "—";
  const pad = n => String(n).padStart(2, "0");
  const canEdit = () => (Apps.can ? Apps.can(APP, "edit") : true);
  const canAdmin = () => (Apps.isAdmin ? Apps.isAdmin() : canEdit());
  const tag = (text, c) => h("span", { class: "tag mk-tag", dataset: { tc: c || "gray" }, text });
  const chip = (text, cls) => h("span", { class: "mk-chip" + (cls ? " " + cls : ""), text });
  const ls = {
    get(k, d) { try { return localStorage.getItem("lumen-mk-" + k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("lumen-mk-" + k, v); } catch {} },
    del(k) { try { localStorage.removeItem("lumen-mk-" + k); } catch {} },
  };
  const monthStart = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const when = ts => ts ? (Apps.fmtDateTime?.(ts) ?? new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) : ""; // Settings → Region
  const dayOf = ts => ts ? new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : "numeric" }) : "";
  const toLocalInput = ts => { const d = new Date(ts); return Apps.iso(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  const tomorrow10 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d.getTime(); };
  const scrollTop = () => document.getElementById("scroller")?.scrollTo({ top: 0 });
  const fileSafe = s => String(s || "campaign").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 48) || "campaign";
  function seg(items, val, onChange, cls = "") {
    const el = h("div", { class: "seg " + cls });
    items.forEach(([k, l]) => el.append(h("button", { type: "button", class: String(k) === String(val) ? "on" : "", text: l,
      onclick: e => { el.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); onChange(k); } })));
    return el;
  }

  /* ---------- settings "marketing" ---------- */
  const cfg = () => Data.get("settings", "marketing") || {};
  const saveCfg = patch => Data.update("settings", "marketing", patch);
  const DEF_UNSUB = "Don't want these emails? Just reply “unsubscribe” and we'll take you off the list.";
  const senderName = () => cfg().from || Data.me().name || "";
  const replyTo = () => cfg().replyTo || Data.me().email || "";
  const unsubText = () => (cfg().unsub != null && String(cfg().unsub).trim() !== "" ? cfg().unsub : DEF_UNSUB);
  const signature = () => cfg().signature || senderName();
  const COLORS = ["#7c5cff", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#1f2430"];
  const BGS = ["#eef0f6", "#ffffff", "#f6f1ea", "#e9f5ef", "#eaf1fb", "#fbeef3"];
  const okColor = (c, d) => /^#[0-9a-f]{3,8}$/i.test(String(c || "")) ? c : d;
  const themeOf = doc => ({ color: okColor(doc?.theme?.color, okColor(cfg().color, "#7c5cff")), bg: okColor(doc?.theme?.bg, "#eef0f6") });

  /* ---------- black list: emails and phone numbers that never get a campaign ---------- */
  const blacklist = () => (cfg().blacklist || []).filter(Boolean).map(String);
  const isEmail = s => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(String(s || "").trim());
  const phoneKey = s => { const d = digits(s); return d.length >= 5 ? d.slice(-9) : ""; };
  const entryKey = x => String(x).includes("@") ? low(x) : "p" + phoneKey(x);
  function blSets() {
    const em = new Set(), ph = new Set();
    blacklist().forEach(x => { if (x.includes("@")) em.add(low(x)); else { const k = phoneKey(x); if (k) ph.add(k); } });
    return { em, ph };
  }
  const isBlocked = (sets, email, phone) => !!((email && sets.em.has(low(email))) || (phoneKey(phone) && sets.ph.has(phoneKey(phone))));
  // every email and phone number in pasted text or a CSV file
  function parseEntries(text) {
    const out = [], seen = new Set(); text = String(text || "");
    const emails = text.match(/[^\s,;<>"'()[\]]+@[^\s,;<>"'()[\]]+\.[a-z]{2,}/gi) || [];
    emails.forEach(e => { e = low(e).replace(/^mailto:/, ""); if (!seen.has(e)) { seen.add(e); out.push(e); } });
    let rest = text; emails.forEach(e => { rest = rest.split(e).join(" "); });
    (rest.match(/\+?\d[\d\s().-]{5,}\d/g) || []).forEach(p => {
      const t = p.trim();
      if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(t) || /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(t)) return; // a date, not a phone
      const d = digits(t); if (d.length < 7 || d.length > 15) return;
      const k = "p" + d.slice(-9); if (seen.has(k)) return;
      seen.add(k); out.push((t.startsWith("+") ? "+" : "") + d);
    });
    return out;
  }
  async function addToBlacklist(entries) {
    const cur = blacklist(), have = new Set(cur.map(entryKey));
    const fresh = entries.filter(x => { const k = entryKey(x); if (!k || k === "p" || have.has(k)) return false; have.add(k); return true; });
    if (!fresh.length) return 0;
    if (fresh.length === 1) await Data.arr("settings", "marketing", "blacklist", fresh[0], true);
    else await saveCfg({ blacklist: [...cur, ...fresh] });
    return fresh.length;
  }
  const removeFromBlacklist = x => Data.arr("settings", "marketing", "blacklist", x, false);

  /* ---------- CRM people ---------- */
  const SRC = { contacts: ["👤", "Contacts", "contact"], leads: ["🧲", "Leads", "lead"], companies: ["🏢", "Companies", "company"] };
  const live = col => (Apps.CRM?.live ? Apps.CRM.live(col) : Data.list(col).filter(r => r && !r.deleted));
  const companyOf = (col, r) => col === "companies" ? r.name || "" : col === "leads" ? r.companyName || "" : (r.company && Data.get("companies", r.company)?.name) || "";
  function personOf(col, r) {
    const name = String(r.name || r.title || "").trim();
    return { col, id: r.id, key: col + ":" + r.id, name: name || "No name", first: col === "companies" ? name : name.split(/\s+/)[0] || "",
      company: companyOf(col, r), email: String(r.email || "").trim(), phone: String(r.phone || "").trim() };
  }
  const SAMPLE = { col: null, id: null, key: "sample", name: "Alex Morgan", first: "Alex", company: "Northwind", email: "alex@example.com", phone: "+1 555 0100", sample: true };
  function samplePeople(channel = "email") {
    const list = live("contacts").map(r => personOf("contacts", r)).filter(p => channel === "sms" ? phoneKey(p.phone) : isEmail(p.email)).slice(0, 25);
    return list.length ? list : [SAMPLE];
  }
  function openCRM(p) {
    if (!p || !p.col || !p.id) return UI.toast("This person isn't in the CRM any more");
    const r = Data.get(p.col, p.id);
    if (!r || r.deleted) return UI.toast("This record was deleted from the CRM");
    if (Apps.CRM?.openRecord) Apps.CRM.openRecord(p.col, p.id); else Apps.go("crm");
  }
  function personRow(p, channel, why) {
    return h("div", { class: "mk-prow" + (why ? " ex" : ""), title: p.col ? "Open in CRM" : "", onclick: () => p.col && openCRM(p) },
      h("span", { class: "mk-ini", text: (p.name[0] || "?").toUpperCase(), style: { background: Apps.colorFor(p.key) } }),
      h("span", { class: "mk-prow-t" }, h("b", { text: p.name }),
        h("small", { text: [channel === "sms" ? p.phone : p.email, p.company && p.company !== p.name ? p.company : ""].filter(Boolean).join(" · ") || "—" })),
      why ? tag(why, why === "Do not contact" ? "red" : "gray") : null);
  }

  /* ---------- personal fields ---------- */
  const PH = [["first", "First name"], ["name", "Full name"], ["company", "Company"], ["email", "Email"], ["sender", "Your name"]];
  const FALLBACK = { first: "there", name: "there", company: "your company", email: "", phone: "" };
  function fill(text, p) {
    return String(text ?? "").replace(/\{(first|name|company|email|phone|sender)\}/gi, (m, k) => {
      k = k.toLowerCase();
      if (k === "sender") return senderName();
      const v = p && p[k]; return v ? String(v) : FALLBACK[k] ?? "";
    });
  }
  const unknownPH = text => [...new Set((String(text || "").match(/\{[^{}\s]{1,24}\}/g) || []).filter(x => !/^\{(first|name|company|email|phone|sender)\}$/i.test(x)))];

  /* ---------- segment rules ---------- */
  const LEAD_ST = [["new", "New"], ["contacted", "Contacted"], ["qualified", "Qualified"], ["junk", "Junk"], ["converted", "Converted"]];
  const SOURCES = ["Website", "Web form", "Referral", "Social media", "Ads", "Cold call", "Event", "Other"];
  const CTYPES = [["client", "Client"], ["vendor", "Vendor"], ["partner", "Partner"]];
  const SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"];
  const created = r => r.at ? Apps.iso(new Date(r.at)) : "";
  const F = (key, label, type = "text", get, options) => ({ key, label, type, get: get || (r => r[key]), options });
  const peopleOpts = () => Data.people().map(p => [p.key, p.name + (p.key === me() ? " (you)" : "")]);
  const optPairs = o => (o || []).map(x => Array.isArray(x) ? x : [x, x]);
  function fieldsOf(src) {
    const base = {
      contacts: () => [F("name", "Name"), F("email", "Email"), F("phone", "Phone"), F("company", "Company", "text", r => companyOf("contacts", r)), F("position", "Position"),
        F("source", "Source", "select", null, SOURCES), F("owner", "Responsible", "person"), F("at", "Created", "date", created)],
      leads: () => [F("name", "Name"), F("companyName", "Company"), F("email", "Email"), F("phone", "Phone"), F("status", "Status", "select", r => r.status || "new", LEAD_ST),
        F("source", "Source", "select", null, SOURCES), F("value", "Potential value", "number"), F("owner", "Responsible", "person"), F("at", "Created", "date", created)],
      companies: () => [F("name", "Name"), F("type", "Type", "select", r => r.type || "client", CTYPES), F("industry", "Industry"), F("size", "Employees", "select", null, SIZES),
        F("email", "Email"), F("phone", "Phone"), F("website", "Website"), F("owner", "Responsible", "person"), F("at", "Created", "date", created)],
    }[src];
    const list = base ? base() : [];
    (((Data.get("settings", "crm") || {}).fields || {})[src] || []).filter(f => f && f.key).forEach(f => {
      const type = f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "select" || f.type === "checkbox" ? "select" : "text";
      const options = f.type === "checkbox" ? [["true", "Yes"], ["false", "No"]] : f.type === "select" ? (f.options || []) : null;
      list.push(F("custom." + f.key, f.label || f.key, type, r => { const v = (r.custom || {})[f.key]; return f.type === "checkbox" ? String(!!v) : v; }, options));
    });
    return list;
  }
  const OPS = { is: "is", not: "is not", contains: "contains", starts: "starts with", empty: "is empty", filled: "is not empty", before: "before", after: "after", gt: "greater than", lt: "less than" };
  const OPS_FOR = { text: ["contains", "is", "not", "starts", "empty", "filled"], select: ["is", "not", "empty", "filled"], person: ["is", "not", "empty", "filled"],
    number: ["gt", "lt", "is", "empty", "filled"], date: ["after", "before", "is", "empty", "filled"] };
  const NOVAL = new Set(["empty", "filled"]);
  const DATE_PRESETS = [["@today", "Today"], ["@week", "Start of this week"], ["@month", "Start of this month"], ["@year", "Start of this year"], ["@-7d", "7 days ago"], ["@-30d", "30 days ago"], ["@-90d", "90 days ago"]];
  function relDate(v) {
    v = String(v || ""); if (v[0] !== "@") return v;
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (v === "@week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    else if (v === "@month") d.setDate(1);
    else if (v === "@year") d.setMonth(0, 1);
    else { const m = v.match(/^@(-?\d+)d$/); if (m) d.setDate(d.getDate() + +m[1]); }
    return Apps.iso(d);
  }
  function test(rule, r, f) {
    const raw = f.get(r), s = low(raw), v = low(rule.value);
    switch (rule.op) {
      case "empty": return !s;
      case "filled": return !!s;
      case "is": return f.type === "date" ? s.slice(0, 10) === relDate(rule.value) : f.type === "number" ? s !== "" && +raw === +rule.value : s === v;
      case "not": return s !== v;
      case "contains": return s.includes(v);
      case "starts": return s.startsWith(v);
      case "gt": return s !== "" && +raw > +rule.value;
      case "lt": return s !== "" && +raw < +rule.value;
      case "before": return !!s && s.slice(0, 10) < relDate(rule.value);
      case "after": return !!s && s.slice(0, 10) >= relDate(rule.value);
    }
    return true;
  }
  function validRules(sg) {
    const fs = fieldsOf(sg.source);
    return (sg.rules || []).map(x => ({ x, f: fs.find(f => f.key === x.field) }))
      .filter(({ x, f }) => f && OPS_FOR[f.type].includes(x.op) && (NOVAL.has(x.op) || String(x.value ?? "").trim() !== ""));
  }
  // who a segment reaches on a channel: blacklisted people, people without an address and duplicates are left out
  function audience(sg, channel) {
    const out = { list: [], total: 0, blocked: [], missing: [], dupes: 0 };
    if (!sg) return out;
    channel = channel || sg.channel || "email";
    const rules = validRules(sg), sets = blSets(), seen = new Set(), src = sg.source || "contacts";
    const ok = r => !rules.length || (sg.match === "any" ? rules.some(({ x, f }) => test(x, r, f)) : rules.every(({ x, f }) => test(x, r, f)));
    live(src).forEach(r => {
      if (!ok(r)) return;
      out.total++;
      const p = personOf(src, r);
      const has = channel === "sms" ? !!phoneKey(p.phone) : isEmail(p.email);
      if (!has) return out.missing.push(p);
      if (isBlocked(sets, p.email, p.phone)) return out.blocked.push(p);
      const k = channel === "sms" ? phoneKey(p.phone) : low(p.email);
      if (seen.has(k)) { out.dupes++; return; }
      seen.add(k); out.list.push(p);
    });
    out.list.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }
  const READY = [
    { id: "ready:email", ready: true, icon: "✉️", name: "All contacts with email", source: "contacts", match: "all", channel: "email", rules: [{ field: "email", op: "filled", value: "" }] },
    { id: "ready:newleads", ready: true, icon: "🧲", name: "New leads this month", source: "leads", match: "all", channel: "email", rules: [{ field: "at", op: "after", value: "@month" }, { field: "status", op: "not", value: "junk" }] },
    { id: "ready:clients", ready: true, icon: "🏢", name: "Clients", source: "companies", match: "all", channel: "email", rules: [{ field: "type", op: "is", value: "client" }] },
  ];
  const mySegments = () => Data.list("segments").filter(s => s && !s.deleted).sort((a, b) => (b.updatedAt || b.at || 0) - (a.updatedAt || a.at || 0));
  const allSegments = () => [...READY, ...mySegments()];
  const segById = id => id ? READY.find(s => s.id === id) || Data.get("segments", id) || null : null;
  function ruleText(src, x) {
    const f = fieldsOf(src).find(f => f.key === x.field); if (!f) return "";
    let v = x.value;
    if (f.type === "select") v = optPairs(f.options).find(o => String(o[0]) === String(v))?.[1] ?? v;
    else if (f.type === "person") v = Data.person(v).name;
    else if (f.type === "date") v = DATE_PRESETS.find(d => d[0] === v)?.[1].toLowerCase() ?? Apps.fmtDate(v);
    return `${f.label} ${OPS[x.op]}${NOVAL.has(x.op) ? "" : " " + (f.type === "text" ? `“${v}”` : v)}`;
  }
  function rulesSummary(sg) {
    const rs = validRules(sg);
    if (!rs.length) return "Everyone in " + (SRC[sg.source] || SRC.contacts)[1].toLowerCase();
    return rs.map(({ x }) => ruleText(sg.source, x)).join(sg.match === "any" ? " or " : " and ");
  }

  /* ---------- email blocks ---------- */
  const BLOCKS = {
    heading: { label: "Heading", ic: "H", make: () => ({ text: "Your headline", size: 26, align: "left" }) },
    text: { label: "Text", ic: "¶", make: () => ({ text: "Hi {first},\n\nWrite your message here.", align: "left" }) },
    button: { label: "Button", ic: "🔘", make: () => ({ text: "Learn more", url: "https://", align: "center", full: false }) },
    image: { label: "Image", ic: "🖼️", make: () => ({ src: "", att: null, alt: "", link: "", width: 100 }) },
    divider: { label: "Divider", ic: "➖", make: () => ({}) },
    spacer: { label: "Spacer", ic: "↕️", make: () => ({ h: 24 }) },
    columns: { label: "Two columns", ic: "▥", make: () => ({ lt: "Left title", lx: "A few words for the left column.", rt: "Right title", rx: "A few words for the right column." }) },
    footer: { label: "Footer", ic: "🔻", make: () => ({ text: signature() }) },
  };
  const B = (type, props) => ({ id: uid(), type, ...BLOCKS[type].make(), ...(props || {}) });
  const AL = a => ["left", "center", "right"].includes(a) ? a : "left";
  function safeUrl(u) {
    u = String(u || "").trim();
    if (!u || /^https?:\/*$/i.test(u)) return "#";
    if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
    if (/^[\w.-]+\.[a-z]{2,}/i.test(u)) return "https://" + u;
    return "#";
  }
  function imgSrc(b) {
    if (b.att?.id) { const f = Data.get("files", b.att.id); return f?.data || ""; }
    return /^https?:\/\//i.test(b.src || "") ? b.src : "";
  }
  const CARD_STYLE = "max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;color:#1f2430;font-family:Helvetica,Arial,sans-serif;text-align:left";
  const ED_PH = { text: "Type here…", lt: "Title", rt: "Title", lx: "Text", rx: "Text" };
  // one block as email-safe HTML with inline styles (always light). p: person (fill fields) | null (keep {first} as typed)
  function blockHTML(b, th, p, editor) {
    const t = s => esc(p ? fill(s, p) : String(s ?? "")).replace(/\n/g, "<br>");
    const ed = k => editor ? ` data-edit="${k}" data-ph="${ED_PH[k] || "Type here…"}"` : "";
    switch (b.type) {
      case "heading": return `<h2${ed("text")} style="margin:0;padding:22px 32px 6px;font-size:${clamp(+b.size || 26, 16, 44)}px;line-height:1.25;font-weight:700;color:#151925;text-align:${AL(b.align)}">${t(b.text)}</h2>`;
      case "text": return `<div${ed("text")} style="padding:8px 32px;font-size:15px;line-height:1.65;color:#3b4252;text-align:${AL(b.align)}">${t(b.text)}</div>`;
      case "button": return `<div style="padding:14px 32px;text-align:${AL(b.align)}"><a${ed("text")} href="${esc(safeUrl(b.url))}" target="_blank" style="display:${b.full ? "block" : "inline-block"};text-align:center;background:${th.color};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 28px;border-radius:8px">${t(b.text)}</a></div>`;
      case "image": {
        const src = imgSrc(b);
        if (!src) return editor ? `<div class="mk-img-ph" style="margin:10px 32px;padding:34px 10px;border:2px dashed #cfd3df;border-radius:10px;text-align:center;color:#8a90a0;font-size:14px;cursor:pointer">🖼️ Click to add an image</div>` : "";
        const img = `<img src="${esc(src)}" alt="${esc(b.alt || "")}" style="display:inline-block;max-width:100%;width:${clamp(+b.width || 100, 20, 100)}%;height:auto;border:0;border-radius:8px">`;
        return `<div style="padding:10px 32px;text-align:center">${b.link && !editor && safeUrl(b.link) !== "#" ? `<a href="${esc(safeUrl(b.link))}" target="_blank">${img}</a>` : img}</div>`;
      }
      case "divider": return `<div style="padding:14px 32px"><div style="border-top:1px solid #e3e6ee;height:0;line-height:0;font-size:0">&nbsp;</div></div>`;
      case "spacer": return `<div style="height:${clamp(+b.h || 24, 4, 120)}px;line-height:0;font-size:0">&nbsp;</div>`;
      case "columns": return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${["l", "r"].map(s =>
        `<td class="mk-col" valign="top" width="50%" style="width:50%;vertical-align:top;padding:10px ${s === "l" ? "10px" : "32px"} 10px ${s === "l" ? "32px" : "10px"}"><div${ed(s + "t")} style="font-weight:700;font-size:16px;line-height:1.35;color:#151925;margin-bottom:4px">${t(b[s + "t"])}</div><div${ed(s + "x")} style="font-size:14.5px;line-height:1.6;color:#3b4252">${t(b[s + "x"])}</div></td>`).join("")}</tr></table>`;
      case "footer": return `<div style="margin-top:14px;padding:22px 32px 26px;background:#f5f6fa;text-align:center;font-size:12.5px;line-height:1.6;color:#7b8191"><div${ed("text")}>${t(b.text)}</div><div style="margin-top:8px;color:#9aa0ae">${t(unsubText())}</div></div>`;
    }
    return "";
  }
  // the whole email: opts.full gives a complete .html document (download / mail-merge tools)
  function emailHTML(doc, p, opts = {}) {
    const th = themeOf(doc);
    const blocks = (doc.blocks || []).map(b => blockHTML(b, th, p, false)).join("");
    const pre = doc.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(p ? fill(doc.preheader, p) : doc.preheader)}</div>` : "";
    const outer = `<div style="background:${th.bg};padding:28px 12px">${pre}<div class="mk-mail" style="${CARD_STYLE}"><div style="height:6px;background:${th.color}"></div>${blocks}</div></div>`;
    if (!opts.full) return outer;
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p ? fill(doc.subject, p) : doc.subject || "")}</title>` +
      `<style>body{margin:0}@media (max-width:620px){.mk-col{display:block!important;width:auto!important;padding:8px 24px!important}}</style></head><body style="margin:0;background:${th.bg}">${outer}</body></html>`;
  }
  // the plain-text version (mail app links, CSV body, the `body` field of the campaign)
  function emailText(doc, p) {
    const t = s => p ? fill(s, p) : String(s ?? "");
    const out = [];
    (doc.blocks || []).forEach(b => {
      if (b.type === "heading" || b.type === "text") out.push(t(b.text));
      else if (b.type === "button") out.push(t(b.text) + (safeUrl(b.url) !== "#" ? ": " + safeUrl(b.url) : ""));
      else if (b.type === "image" && b.link && safeUrl(b.link) !== "#") out.push(safeUrl(b.link));
      else if (b.type === "divider") out.push("———");
      else if (b.type === "columns") out.push([t(b.lt), t(b.lx)].filter(Boolean).join("\n"), [t(b.rt), t(b.rx)].filter(Boolean).join("\n"));
      else if (b.type === "footer") out.push(["—", t(b.text), t(unsubText())].filter(Boolean).join("\n"));
    });
    return out.filter(s => s && s.trim()).join("\n\n");
  }
  const MERGE = { first: "*|FNAME|*", name: "*|FNAME|* *|LNAME|*", company: "*|COMPANY|*", email: "*|EMAIL|*" };

  /* ---------- SMS length ---------- */
  const GSM = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;
  function smsInfo(text) {
    text = String(text || "");
    const uni = !GSM.test(text);
    const len = [...text].length + (uni ? 0 : (text.match(/[\^{}\\[~\]|€]/g) || []).length);
    const single = uni ? 70 : 160, multi = uni ? 67 : 153;
    const parts = len <= single ? 1 : Math.ceil(len / multi);
    return { len, parts, uni, single, left: parts === 1 ? single - len : parts * multi - len };
  }

  /* ---------- starter templates ---------- */
  let _starters = null;
  const starters = () => _starters || (_starters = [
    { id: "starter:newsletter", starter: true, channel: "email", icon: "📰", name: "Newsletter", desc: "News, tips and a link to read more",
      subject: "{first}, here's what's new this month", preheader: "A quick round-up from {sender}", theme: { color: "#3b82f6", bg: "#eaf1fb" },
      blocks: [B("heading", { text: "What's new this month", size: 28 }), B("text", { text: "Hi {first},\n\nHere's a quick round-up of what we've been working on, and what's coming next." }),
        B("image"), B("columns", { lt: "New feature", lx: "A short line about something new you've launched.", rt: "Tip of the month", rx: "One useful trick your customers will love." }),
        B("button", { text: "Read more" }), B("divider"), B("text", { text: "Thanks for reading,\n{sender}" }), B("footer", { text: "You're getting this newsletter from {sender}." })] },
    { id: "starter:promo", starter: true, channel: "email", icon: "🏷️", name: "Promotion", desc: "A special offer with a clear call to action",
      subject: "{first}, 20% off this week only", preheader: "A thank-you offer for {company}", theme: { color: "#ef4444", bg: "#fbeef3" },
      blocks: [B("spacer", { h: 12 }), B("heading", { text: "20% off, this week only", size: 32, align: "center" }),
        B("text", { text: "Hi {first}, as a thank you for being with us, here's a special offer for {company}.", align: "center" }),
        B("button", { text: "Claim the offer", align: "center" }), B("text", { text: "Use the code THANKS20 at checkout. Ends Sunday.", align: "center" }), B("spacer", { h: 8 }),
        B("footer", { text: "{sender}" })] },
    { id: "starter:event", starter: true, channel: "email", icon: "🎟️", name: "Event invitation", desc: "Invite people to an event or webinar",
      subject: "You're invited, {first}", preheader: "Join us for an evening of talks and demos", theme: { color: "#7c5cff", bg: "#eef0f6" },
      blocks: [B("heading", { text: "You're invited 🎉", size: 30, align: "center" }), B("text", { text: "Hi {first},\n\nJoin us for an evening of short talks, live demos and good conversation." }),
        B("columns", { lt: "When", lx: "Thursday, 6:00 PM", rt: "Where", rx: "Our office, 2nd floor" }), B("button", { text: "Save my seat", align: "center" }),
        B("text", { text: "Can't make it? Just reply and let us know.\n\nSee you there,\n{sender}" }), B("footer", { text: "{sender}" })] },
    { id: "starter:thanks", starter: true, channel: "email", icon: "💚", name: "Thank you", desc: "Say thanks after a purchase or a project",
      subject: "Thank you, {first}!", preheader: "It was a pleasure working with {company}", theme: { color: "#10b981", bg: "#e9f5ef" },
      blocks: [B("spacer", { h: 10 }), B("heading", { text: "Thank you, {first}!", size: 30, align: "center" }),
        B("text", { text: "It was a real pleasure working with {company}. If there's anything we can do better, just hit reply. We read every message.", align: "center" }),
        B("button", { text: "Leave a review", align: "center" }), B("text", { text: "Warm regards,\n{sender}", align: "center" }), B("footer", { text: "{sender}" })] },
    { id: "starter:sms-offer", starter: true, channel: "sms", icon: "🏷️", name: "Quick offer", desc: "A short promo text",
      sms: "Hi {first}! This week only: 20% off for {company}. Reply YES to claim it. Reply STOP to opt out." },
    { id: "starter:sms-reminder", starter: true, channel: "sms", icon: "⏰", name: "Reminder", desc: "A friendly nudge before a meeting or event",
      sms: "Hi {first}, a quick reminder about our meeting tomorrow. Reply to reschedule. – {sender}" },
  ]);
  const myTemplates = () => (cfg().templates || []).filter(t => t && t.id);
  const allTemplates = () => [...myTemplates(), ...starters()];
  const tplById = id => allTemplates().find(t => t.id === id);
  async function saveTemplate(t) {
    const rec = clone(t); delete rec.starter; rec.updatedAt = Date.now(); rec.by = rec.by || me();
    const list = myTemplates(), i = list.findIndex(x => x.id === rec.id);
    if (i >= 0) list[i] = rec; else list.unshift(rec);
    await saveCfg({ templates: list });
    return rec.id;
  }
  const deleteTemplate = id => saveCfg({ templates: myTemplates().filter(t => t.id !== id) });

  /* ---------- campaigns ---------- */
  const campaigns = () => Data.list("campaigns").filter(c => c && !c.deleted && c.status !== "template");
  const isReady = c => c.status === "scheduled" && !!c.scheduledAt && c.scheduledAt <= Date.now();
  const ownerOf = c => c.owner || c.by;
  function statusTag(c) {
    if (c.status === "sent") return tag("Sent", "green");
    if (c.status === "scheduled") return isReady(c) ? tag("Ready to send", "orange") : tag("Scheduled", "blue");
    return tag("Draft", "gray");
  }
  const segNameOf = c => segById(c.segment)?.name || c.segmentName || (c.segment ? "Deleted segment" : "No audience yet");
  const CFIELDS = ["name", "channel", "segment", "subject", "preheader", "blocks", "theme", "sms", "template", "status", "scheduledAt", "owner"];
  async function duplicateCampaign(c) {
    const rec = {};
    ["channel", "segment", "subject", "preheader", "blocks", "theme", "sms", "template", "body"].forEach(k => { if (c[k] !== undefined) rec[k] = c[k]; });
    Object.assign(rec, { name: (c.name || "Campaign") + " (copy)", status: "draft", stats: {}, owner: me() });
    return Data.add("campaigns", clone(rec));
  }
  // everyone reached by sent campaigns, newest campaign last
  function recipientsIndex() {
    const map = new Map();
    campaigns().filter(c => c.status === "sent").sort((a, b) => (a.sentAt || 0) - (b.sentAt || 0)).forEach(c => (c.recipients || []).forEach(r => {
      if (!r) return;
      const k = r.key || (r.col && r.id ? r.col + ":" + r.id : low(r.email || r.phone));
      if (!k) return;
      const cur = map.get(k) || { key: k, col: r.col || null, id: r.id || null, n: "", email: "", phone: "", count: 0, last: null, channels: new Set() };
      if (r.email) cur.email = r.email; if (r.phone) cur.phone = r.phone; if (r.n) cur.n = r.n;
      cur.count++; cur.last = c; cur.channels.add(c.channel || "email");
      map.set(k, cur);
    }));
    return map;
  }

  /* ---------- files, clipboard, links ---------- */
  const csvCell = v => { v = v == null ? "" : String(v); return /[",\n\r;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const toCsv = rows => "﻿" + rows.map(r => r.map(csvCell).join(",")).join("\r\n");
  function download(filename, text, type = "text/csv;charset=utf-8") {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h("a", { href: url, download: filename }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function copyText(text, msg = "Copied") {
    const done = () => UI.toast("📋 " + msg);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text) ? done() : UI.toast("Couldn't copy"));
    else if (fallbackCopy(text)) done(); else UI.toast("Couldn't copy");
  }
  function fallbackCopy(text) {
    const ta = h("textarea", { style: { position: "fixed", opacity: "0", left: "-9999px" } }); ta.value = text; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch {} ta.remove(); return ok;
  }
  // the designed email as rich text: paste it into a new message in Gmail, Outlook or Apple Mail
  async function copyHTML(html, text) {
    try {
      if (!window.ClipboardItem || !navigator.clipboard?.write) throw 0;
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
      UI.toast("📋 Email copied: paste it into a new message");
    } catch { copyText(text, "Copied as plain text (this browser can't copy the design)"); }
  }
  const mailto = (to, subject, body, extra = {}) => "mailto:" + String(to || "").replace(/[?&#\s,;]/g, "") + "?" +
    [["subject", subject], ["body", body], ...Object.entries(extra)].filter(([, v]) => v).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
  const smsto = (to, body) => "sms:" + String(to || "").replace(/[^\d+]/g, "") + "?&body=" + encodeURIComponent(body || "");
  function openLink(url) {
    if (url.startsWith("sms:")) { location.href = url; return; }
    const a = h("a", { href: url, target: "_blank", rel: "noopener" }); document.body.append(a); a.click(); a.remove();
  }

  /* ---------- personal-field picker: inserts {first} etc. where the cursor was ---------- */
  let lastEd = null, lastRange = null;
  function trackField(el) {
    const remember = () => {
      lastEd = el;
      if (el.isContentEditable) { const s = getSelection(); if (s.rangeCount && el.contains(s.anchorNode)) lastRange = s.getRangeAt(0).cloneRange(); }
    };
    ["focus", "keyup", "mouseup", "input"].forEach(ev => el.addEventListener(ev, remember));
    return el;
  }
  function insertAtCaret(text, fallback) {
    const el = lastEd && lastEd.isConnected ? lastEd : fallback;
    if (!el) return UI.toast("Click into a text first, then insert a field");
    el.focus();
    if (el.isContentEditable) {
      const s = getSelection(); s.removeAllRanges();
      if (lastRange && el.contains(lastRange.startContainer)) s.addRange(lastRange);
      else { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); s.addRange(r); }
      document.execCommand("insertText", false, text);
    } else {
      const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
      el.setRangeText(text, a, b, "end"); el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  function phButton(fallback, scope) {
    return h("button", { type: "button", class: "chip-btn mk-ph-btn", title: "Insert a personal field like {first}", onmousedown: e => e.preventDefault(),
      onclick: e => {
        const fb = typeof fallback === "function" ? fallback() : fallback;
        const sc = scope || fb; // only insert into fields of this editor (or into its own field)
        if (sc && lastEd && sc !== lastEd && !sc.contains(lastEd)) lastEd = null;
        UI.menu(e.currentTarget, [{ section: "Personal fields" }, ...PH.map(([k, l]) => ({ label: l, kbd: "{" + k + "}", onClick: () => insertAtCaret("{" + k + "}", fb) }))]);
      } }, h("b", { text: "{ }" }), "Insert field");
  }
  function cyclerEl(list, i, go) {
    const n = list.length, p = list[i] || SAMPLE;
    return h("div", { class: "mk-cycler" },
      h("button", { type: "button", class: "icon-btn xs", text: "‹", title: "Previous person", disabled: n < 2, onclick: () => go(-1) }),
      h("span", { class: "mk-cyc-t" }, h("b", { text: p.name }), h("small", { text: (p.sample ? "Sample data" : p.email || p.phone || "") + (n > 1 ? ` · ${i + 1} of ${num(n)}` : "") })),
      h("button", { type: "button", class: "icon-btn xs", text: "›", title: "Next person", disabled: n < 2, onclick: () => go(1) }));
  }

  /* ---------- previews ---------- */
  function previewEl(doc, p, device) {
    const mail = h("div", { class: "mk-prev-mail", html: emailHTML(doc, p) });
    mail.querySelectorAll("a").forEach(a => { a.target = "_blank"; a.rel = "noopener"; });
    return h("div", { class: "mk-prev" + (device === "mobile" ? " mobile" : "") },
      h("div", { class: "mk-inbox" },
        h("div", { class: "mk-ib-row" }, h("span", { text: "From" }), h("b", { text: senderName() || "You" }), replyTo() ? h("small", { text: `<${replyTo()}>` }) : null),
        h("div", { class: "mk-ib-row" }, h("span", { text: "To" }), h("b", { text: p.email || p.name })),
        h("div", { class: "mk-ib-subj", text: fill(doc.subject, p) || "(no subject)" }),
        doc.preheader ? h("div", { class: "mk-ib-pre", text: fill(doc.preheader, p) }) : null),
      mail);
  }
  function smsBubble(text, p) {
    return h("div", { class: "mk-phone-in" }, h("div", { class: "mk-phone-top" }, h("span", { class: "mk-ini sm", text: (p.name[0] || "?").toUpperCase(), style: { background: Apps.colorFor(p.key) } }), h("b", { text: p.name }), h("small", { text: p.phone || "" })),
      h("div", { class: "mk-phone-msgs" }, h("div", { class: "mk-bubble", text: text || "Your message will appear here" })));
  }
  function tplThumb(t) {
    if ((t.channel || "email") === "sms") return h("div", { class: "mk-thumb sms" }, h("div", { class: "mk-bubble", text: fill(t.sms, SAMPLE) || "Empty message" }));
    return h("div", { class: "mk-thumb", style: { background: themeOf(t).bg } }, h("div", { class: "mk-thumb-in", html: emailHTML(t, SAMPLE) }));
  }
  function tplCard(t, onOpen, menuItems) {
    const sms = (t.channel || "email") === "sms";
    return h("div", { class: "mk-tcard glass", role: "button", tabindex: 0, onclick: e => { if (!e.target.closest(".icon-btn")) onOpen(); }, onkeydown: e => { if (e.key === "Enter") onOpen(); } },
      tplThumb(t),
      h("div", { class: "mk-tc-b" },
        h("div", { class: "mk-tc-t" }, h("b", { text: (t.icon ? t.icon + " " : "") + (t.name || "Untitled") }),
          menuItems ? h("button", { class: "icon-btn xs", title: "More", html: UI.icon("dots"), onclick: e => { e.stopPropagation(); UI.menu(e.currentTarget, menuItems(), { align: "end" }); } }) : null),
        h("small", { text: t.starter ? t.desc : sms ? `${smsInfo(t.sms).len} characters` : t.subject || "No subject yet" }),
        h("div", { class: "mk-tc-tags" }, tag(sms ? "SMS" : "Email", sms ? "green" : "blue"), t.starter ? tag("Starter", "purple") : null)));
  }
  // pick a template: mine first, then the starters (withBlank adds an empty email)
  function templateGallery(channel, onPick, withBlank) {
    const mine = myTemplates().filter(t => (t.channel || "email") === channel), st = starters().filter(t => t.channel === channel);
    const blank = h("div", { class: "mk-tcard glass mk-blank", role: "button", tabindex: 0, onclick: () => onPick(null) },
      h("div", { class: "mk-thumb blank" }, h("span", { text: "＋" })), h("div", { class: "mk-tc-b" }, h("div", { class: "mk-tc-t" }, h("b", { text: "Start from scratch" })), h("small", { text: "A heading, text, button and footer" })));
    return h("div", { class: "mk-gal" },
      mine.length ? h("div", { class: "td-sec", text: "My templates" }) : null,
      mine.length ? h("div", { class: "mk-tgrid" }, ...mine.map(t => tplCard(t, () => onPick(t)))) : null,
      h("div", { class: "td-sec", text: "Starter templates" }),
      h("div", { class: "mk-tgrid" }, withBlank ? blank : null, ...st.map(t => tplCard(t, () => onPick(t)))));
  }

  /* ---------- email builder: blocks, drag to reorder, inline editing, theme, desktop / mobile, preview ---------- */
  function builder(doc, onChange, opts = {}) {
    if (!Array.isArray(doc.blocks)) doc.blocks = [];
    if (!doc.theme || typeof doc.theme !== "object") doc.theme = {};
    const bs = { sel: null, device: ls.get("device", "desktop"), mode: "edit", pi: 0 };
    let dragId = null, dragNew = null, card = null;
    const el = h("div", { class: "mk-builder" });
    const bar = h("div", { class: "mk-bbar" }), main = h("div", { class: "mk-bmain" });
    const palette = h("div", { class: "mk-palette" }), stage = h("div", { class: "mk-stage" }), insp = h("div", { class: "mk-insp" });
    el.append(bar, main);
    const changed = () => onChange?.();
    const people = () => { const l = opts.people?.() || []; return l.length ? l : samplePeople(); };
    const byId = id => doc.blocks.find(b => b.id === id);
    const SINGLE = new Set(["heading", "button"]);

    function drawBar() {
      const th = themeOf(doc);
      const colorIn = h("input", { type: "color", class: "mk-color-in", title: "Any color", value: /^#[0-9a-f]{6}$/i.test(th.color) ? th.color : "#7c5cff",
        oninput: () => { doc.theme = { ...doc.theme, color: colorIn.value }; bar.querySelectorAll(".mk-sw:not(.bg)").forEach(x => x.classList.remove("on")); changed(); drawCanvas(); } });
      let right;
      if (bs.mode === "edit") right = phButton(null, el);
      else { const l = people(); bs.pi = ((bs.pi % l.length) + l.length) % l.length; right = cyclerEl(l, bs.pi, d => { bs.pi += d; drawBar(); drawMain(); }); }
      bar.replaceChildren(
        seg([["edit", "✏️ Edit"], ["preview", "👁️ Preview"]], bs.mode, v => { bs.mode = v; drawBar(); drawMain(); }),
        seg([["desktop", "🖥️"], ["mobile", "📱"]], bs.device, v => { bs.device = v; ls.set("device", v); drawMain(); }, "mk-dev"),
        bs.mode === "edit" ? h("div", { class: "mk-swatches" }, h("span", { class: "mk-sw-l", text: "Color" }),
          ...COLORS.map(c => h("button", { type: "button", class: "mk-sw" + (th.color === c ? " on" : ""), style: { background: c }, title: c, onclick: () => setTheme({ color: c }) })), colorIn) : null,
        bs.mode === "edit" ? h("div", { class: "mk-swatches" }, h("span", { class: "mk-sw-l", text: "Background" }),
          ...BGS.map(c => h("button", { type: "button", class: "mk-sw bg" + (th.bg === c ? " on" : ""), style: { background: c }, title: c, onclick: () => setTheme({ bg: c }) }))) : null,
        h("span", { class: "grow" }), right);
    }
    function setTheme(p) { doc.theme = { ...doc.theme, ...p }; changed(); drawBar(); drawCanvas(); }

    function drawMain() {
      main.classList.toggle("is-preview", bs.mode === "preview");
      if (bs.mode === "preview") { const l = people(); main.replaceChildren(previewEl(doc, l[bs.pi % l.length] || SAMPLE, bs.device)); return; }
      main.replaceChildren(palette, stage, insp);
      drawPalette(); drawCanvas(); drawInsp();
    }
    function drawPalette() {
      palette.replaceChildren(h("div", { class: "mk-pal-h", text: "Blocks" }), ...Object.entries(BLOCKS).map(([type, d]) => h("div", { class: "mk-pal", role: "button", tabindex: 0, draggable: true, title: "Click or drag into the email",
        onclick: () => insert(type), onkeydown: e => { if (e.key === "Enter") insert(type); },
        ondragstart: e => { dragNew = type; try { e.dataTransfer.setData("text/plain", "mk:" + type); e.dataTransfer.effectAllowed = "copy"; } catch {} },
        ondragend: () => { dragNew = null; clearInd(); } }, h("span", { class: "mk-pal-ic", text: d.ic }), h("span", { class: "mk-pal-l", text: d.label }))));
    }
    function drawCanvas() {
      const th = themeOf(doc);
      stage.className = "mk-stage" + (bs.device === "mobile" ? " mobile" : "");
      stage.style.background = th.bg;
      card = h("div", { class: "mk-mail mk-canvas" });
      card.setAttribute("style", CARD_STYLE);
      card.append(h("div", { style: { height: "6px", background: th.color } }));
      doc.blocks.forEach(b => card.append(blockEl(b)));
      if (!doc.blocks.length) card.append(h("div", { class: "mk-canvas-empty" }, h("div", { class: "mk-ce-ic", text: "✨" }), h("b", { text: "Your email is empty" }), h("span", { text: "Click a block or drag it here" })));
      stage.replaceChildren(card);
    }
    function blockEl(b) {
      const inner = h("div", { class: "mk-blk-in", html: blockHTML(b, themeOf(doc), null, true) });
      inner.querySelectorAll("a, img").forEach(x => { x.setAttribute("draggable", "false"); if (x.tagName === "A") x.addEventListener("click", e => e.preventDefault()); });
      inner.querySelectorAll("[data-edit]").forEach(x => editable(x, b));
      inner.querySelector(".mk-img-ph")?.addEventListener("click", () => uploadImage(b));
      const tb = (ic, title, fn, cls) => h("button", { type: "button", class: "mk-tb" + (cls ? " " + cls : ""), title, html: ic, onclick: e => { e.stopPropagation(); fn(); } });
      const handle = h("span", { class: "mk-blk-drag", title: "Drag to move", html: UI.icon("drag") });
      const el = h("div", { class: "mk-blk" + (bs.sel === b.id ? " on" : ""), dataset: { id: b.id, type: b.type }, draggable: TOUCH, onclick: e => { if (!e.target.closest(".mk-blk-tools")) select(b.id); } },
        h("span", { class: "mk-blk-label", text: BLOCKS[b.type]?.label || b.type }), inner,
        h("div", { class: "mk-blk-tools" }, handle, tb("↑", "Move up", () => move(b.id, -1)), tb("↓", "Move down", () => move(b.id, 1)),
          tb(UI.icon("copy"), "Duplicate", () => dup(b.id)), tb(UI.icon("trash"), "Delete", () => del(b.id), "danger")));
      handle.addEventListener("mousedown", () => { el.draggable = true; addEventListener("mouseup", () => { if (!TOUCH && !dragId) el.draggable = false; }, { once: true }); });
      el.addEventListener("dragstart", e => {
        if (e.target !== el) return;
        dragId = b.id; try { e.dataTransfer.setData("text/plain", "mk-block"); e.dataTransfer.effectAllowed = "move"; } catch {}
        setTimeout(() => el.classList.add("dragging"));
      });
      el.addEventListener("dragend", () => { el.classList.remove("dragging"); if (!TOUCH) el.draggable = false; dragId = null; clearInd(); });
      return el;
    }
    const readText = x => x.innerText.replace(/ /g, " ").replace(/\n$/, "");
    function editable(x, b) {
      const key = x.dataset.edit, single = SINGLE.has(b.type) || key === "lt" || key === "rt";
      x.setAttribute("contenteditable", "true"); x.spellcheck = true; x.classList.add("mk-ed");
      trackField(x);
      x.addEventListener("focus", () => select(b.id));
      x.addEventListener("input", () => {
        b[key] = readText(x); changed();
        const mirror = bs.sel === b.id && insp.querySelector(`[data-k="${key}"]`); if (mirror) mirror.value = b[key];
      });
      x.addEventListener("paste", e => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData)?.getData("text/plain") || ""; document.execCommand("insertText", false, single ? t.replace(/\s*\n\s*/g, " ") : t); });
      x.addEventListener("keydown", e => { if (e.key === "Enter" && single) { e.preventDefault(); x.blur(); } });
      x.addEventListener("drop", e => { if (!dragId && !dragNew) e.preventDefault(); });
    }
    // drop position: before the block whose middle is below the pointer
    const blockEls = () => [...stage.querySelectorAll(".mk-blk")];
    function indexAt(y) { const els = blockEls(); for (let i = 0; i < els.length; i++) { const r = els[i].getBoundingClientRect(); if (y < r.top + r.height / 2) return i; } return els.length; }
    function clearInd() { stage.querySelectorAll(".drop-before,.drop-after").forEach(x => x.classList.remove("drop-before", "drop-after")); card?.classList.remove("drop-into"); }
    function showInd(i) {
      clearInd(); const els = blockEls();
      if (!els.length) return card?.classList.add("drop-into");
      if (i < els.length) els[i].classList.add("drop-before"); else els[els.length - 1].classList.add("drop-after");
    }
    stage.addEventListener("dragover", e => { if (!dragId && !dragNew) return; e.preventDefault(); try { e.dataTransfer.dropEffect = dragNew ? "copy" : "move"; } catch {} showInd(indexAt(e.clientY)); });
    stage.addEventListener("dragleave", e => { if (!stage.contains(e.relatedTarget)) clearInd(); });
    stage.addEventListener("drop", e => {
      if (!dragId && !dragNew) return;
      e.preventDefault(); const i = indexAt(e.clientY); clearInd();
      if (dragNew) insert(dragNew, i);
      else {
        const from = doc.blocks.findIndex(b => b.id === dragId);
        if (from >= 0 && i !== from && i !== from + 1) { const [b] = doc.blocks.splice(from, 1); doc.blocks.splice(i > from ? i - 1 : i, 0, b); changed(); drawCanvas(); }
      }
      dragId = dragNew = null;
    });
    stage.addEventListener("click", e => { if (e.target === stage) select(null); });

    function select(id) {
      if (bs.sel === id) return;
      bs.sel = id;
      stage.querySelectorAll(".mk-blk").forEach(x => x.classList.toggle("on", x.dataset.id === id));
      drawInsp();
    }
    function insert(type, at) {
      const b = B(type);
      let i = at;
      if (i == null) { const s = doc.blocks.findIndex(x => x.id === bs.sel); i = s >= 0 ? s + 1 : doc.blocks.length; }
      const foot = doc.blocks.findIndex(x => x.type === "footer");
      if (at == null && type !== "footer" && foot >= 0 && i > foot) i = foot; // new blocks go above the footer
      doc.blocks.splice(i, 0, b); bs.sel = b.id; changed(); drawCanvas(); drawInsp();
      requestAnimationFrame(() => { const x = stage.querySelector(`.mk-blk[data-id="${b.id}"]`); if (x) { x.classList.add("fresh"); x.scrollIntoView({ block: "nearest", behavior: "smooth" }); } });
    }
    function move(id, d) {
      const i = doc.blocks.findIndex(b => b.id === id), j = i + d;
      if (i < 0 || j < 0 || j >= doc.blocks.length) return;
      [doc.blocks[i], doc.blocks[j]] = [doc.blocks[j], doc.blocks[i]]; changed(); drawCanvas();
    }
    function dup(id) {
      const i = doc.blocks.findIndex(b => b.id === id); if (i < 0) return;
      const c = { ...clone(doc.blocks[i]), id: uid() }; doc.blocks.splice(i + 1, 0, c); bs.sel = c.id; changed(); drawCanvas(); drawInsp();
    }
    function del(id) {
      const i = doc.blocks.findIndex(b => b.id === id); if (i < 0) return;
      const [gone] = doc.blocks.splice(i, 1); if (bs.sel === id) bs.sel = null; changed(); drawCanvas(); drawInsp();
      UI.toast(`${BLOCKS[gone.type]?.label || "Block"} deleted`, { label: "Undo", run: () => { if (!el.isConnected) return; doc.blocks.splice(Math.min(i, doc.blocks.length), 0, gone); changed(); drawCanvas(); } });
    }
    function refresh(b) { const old = stage.querySelector(`.mk-blk[data-id="${b.id}"]`); if (old) old.replaceWith(blockEl(b)); }
    async function uploadImage(b) {
      const [f] = await Apps.pickFiles(false); if (!f) return;
      if (!/^image\//.test(f.type)) return UI.toast("Please choose an image file");
      const [att] = await Apps.attach([f]); if (!att) return;
      b.att = att; b.src = ""; if (!b.alt) b.alt = f.name.replace(/\.[^.]+$/, "");
      changed(); refresh(b); if (bs.sel === b.id) drawInsp();
    }

    function drawInsp() {
      const b = byId(bs.sel);
      if (!b) {
        insp.replaceChildren(h("div", { class: "mk-insp-empty" }, h("div", { class: "mk-ie-ic", text: "👆" }), h("b", { text: "Select a block" }),
          h("span", { text: "Click any part of the email to change it. Text is edited right in the email." }),
          h("div", { class: "mk-insp-tip" }, "Tip: ", h("b", { text: "Insert field" }), " adds {first} or {company}, so every person gets their own version.")));
        return;
      }
      const row = (label, ctl) => h("div", { class: "mk-f" }, h("span", { text: label }), ctl);
      const input = (key, ph, after) => {
        const i = h("input", { class: "menu-input", placeholder: ph || "", value: b[key] ?? "", dataset: { k: key } });
        i.oninput = () => { b[key] = i.value; changed(); refresh(b); after?.(); };
        if (key === "text") trackField(i);
        return i;
      };
      const alignSeg = () => seg([["left", "Left"], ["center", "Center"], ["right", "Right"]], AL(b.align), v => { b.align = v; changed(); refresh(b); });
      const range = (key, min, max, step, suffix, def) => {
        const out = h("b", { text: (b[key] ?? def) + suffix });
        const r = h("input", { type: "range", min, max, step, value: b[key] ?? def, oninput: () => { b[key] = +r.value; out.textContent = r.value + suffix; changed(); refresh(b); } });
        return h("div", { class: "mk-range" }, r, out);
      };
      const hint = t => h("p", { class: "mk-hint", text: t });
      const rows = [];
      if (b.type === "heading") rows.push(row("Size", seg([["20", "S"], ["26", "M"], ["32", "L"], ["40", "XL"]], String(b.size || 26), v => { b.size = +v; changed(); refresh(b); })), row("Align", alignSeg()), hint("Click the heading in the email to change the words."));
      if (b.type === "text") rows.push(row("Align", alignSeg()), hint("Click the text in the email to edit it. Press Enter for a new line."), phButton(null, el));
      if (b.type === "button") rows.push(row("Label", input("text", "Button text")), row("Link", input("url", "https://…")), row("Align", alignSeg()),
        h("label", { class: "mk-check-row" }, h("input", { type: "checkbox", checked: !!b.full, onchange: e => { b.full = e.target.checked; changed(); refresh(b); } }), h("span", { text: "Full width" })),
        safeUrl(b.url) === "#" ? h("p", { class: "mk-warn", text: "Add a link so the button goes somewhere." }) : null);
      if (b.type === "image") {
        const src = imgSrc(b);
        rows.push(src ? h("img", { class: "mk-insp-img", src, alt: "" }) : null,
          h("div", { class: "mk-f-row" }, h("button", { class: "btn", text: src ? "Replace image" : "Upload image", onclick: () => uploadImage(b) }),
            src ? h("button", { class: "btn danger", text: "Remove", onclick: () => { b.att = null; b.src = ""; changed(); refresh(b); drawInsp(); } }) : null),
          row("…or an image link", input("src", "https://example.com/photo.jpg", () => { if (b.src) b.att = null; })),
          row("Describe the image", input("alt", "Shown if images are off")), row("Opens when clicked", input("link", "https://… (optional)")),
          row("Width", range("width", 20, 100, 5, "%", 100)),
          b.att ? hint("Uploaded images are embedded in the email. Some mail apps hide them; an image link (https://…) works best.") : null);
      }
      if (b.type === "divider") rows.push(hint("A thin line to separate sections."));
      if (b.type === "spacer") rows.push(row("Height", range("h", 8, 96, 4, " px", 24)));
      if (b.type === "columns") rows.push(hint("Click the titles and text in the email to edit them. On phones the columns stack."), phButton(null, el));
      if (b.type === "footer") rows.push(hint("Add your company, address or signature. The unsubscribe line comes from Marketing settings:"), h("div", { class: "mk-quote", text: unsubText() }));
      insp.replaceChildren(
        h("div", { class: "mk-insp-h" }, h("span", { class: "mk-pal-ic", text: BLOCKS[b.type]?.ic || "" }), h("b", { text: BLOCKS[b.type]?.label || b.type }), h("span", { class: "grow" }),
          h("button", { class: "icon-btn xs", title: "Done", html: UI.icon("x"), onclick: () => select(null) })),
        ...rows.filter(Boolean),
        h("div", { class: "mk-insp-acts" }, h("button", { class: "chip-btn", text: "↑ Up", onclick: () => move(b.id, -1) }), h("button", { class: "chip-btn", text: "↓ Down", onclick: () => move(b.id, 1) }),
          h("button", { class: "chip-btn", text: "Duplicate", onclick: () => dup(b.id) }), h("button", { class: "chip-btn danger", text: "Delete", onclick: () => del(b.id) })));
    }

    drawBar(); drawMain();
    return { el, mode: () => bs.mode, redraw: () => { drawBar(); drawMain(); } };
  }

  /* ---------- SMS editor with a 160-character counter ---------- */
  function smsEditor(doc, onChange, opts = {}) {
    const vs = { pi: 0 };
    const ta = trackField(h("textarea", { class: "menu-input mk-sms-ta", rows: 6, placeholder: "Hi {first}! …" }));
    ta.value = doc.sms || "";
    const counter = h("div", { class: "mk-sms-count" }), prev = h("div", { class: "mk-phone" });
    const people = () => { const l = opts.people?.() || []; return l.length ? l : samplePeople("sms"); };
    function paint() {
      const i = smsInfo(ta.value);
      counter.className = "mk-sms-count" + (i.parts > 1 ? " over" : "");
      counter.replaceChildren(h("b", { text: i.parts > 1 ? `${i.len} characters` : `${i.len} / ${i.single}` }),
        h("span", { text: i.parts > 1 ? ` · sent as ${i.parts} messages` : ` · ${i.left} left` }),
        i.uni ? h("small", { text: "Emoji or special letters: 70 characters per SMS" }) : null);
      const l = people(); vs.pi = ((vs.pi % l.length) + l.length) % l.length; const p = l[vs.pi], text = fill(ta.value, p), fi = smsInfo(text);
      prev.replaceChildren(cyclerEl(l, vs.pi, d => { vs.pi += d; paint(); }), smsBubble(text, p),
        h("small", { class: "mk-muted", text: `For ${p.first || p.name}: ${fi.len} characters · ${plural(fi.parts, "message")}` }));
    }
    ta.addEventListener("input", () => { doc.sms = ta.value; onChange?.(); paint(); });
    paint();
    return h("div", { class: "mk-sms" },
      h("div", { class: "mk-sms-ed glass" }, h("div", { class: "mk-sms-bar" }, phButton(() => ta), ...(opts.extra || [])), ta, counter,
        h("p", { class: "mk-hint", text: "Keep it short and friendly, and add a way to opt out, like “Reply STOP to opt out”." })),
      prev);
  }

  /* ---------- segment editor (slider) ---------- */
  function editSegment(src, onSaved) {
    const ready = !!src?.ready, isNew = !src || !src.id, ro = ready || !canEdit();
    const s = clone(src || { name: "", source: "contacts", match: "all", channel: "email", rules: [{ field: "email", op: "filled", value: "" }] });
    s.source = SRC[s.source] ? s.source : "contacts"; s.match = s.match === "any" ? "any" : "all"; s.channel = s.channel === "sms" ? "sms" : "email";
    s.rules = Array.isArray(s.rules) ? s.rules : []; s.name = s.name || "";
    let showEx = false, T = 0;
    const nameIn = h("input", { class: "menu-input mk-seg-name", placeholder: "Segment name, e.g. “Clients in Berlin”", value: s.name, disabled: ro, oninput: () => { s.name = nameIn.value; } });
    const rulesBox = h("div", { class: "mk-rules" }), result = h("div", { class: "mk-seg-res" }), srcBox = h("div");
    const later = () => { clearTimeout(T); T = setTimeout(drawResult, 160); };

    function drawSource() {
      srcBox.replaceChildren(
        h("div", { class: "mk-f" }, h("span", { text: "Build it from" }), ro ? h("b", { text: SRC[s.source][0] + " " + SRC[s.source][1] }) :
          seg(Object.entries(SRC).map(([k, v]) => [k, v[0] + " " + v[1]]), s.source, v => {
            s.source = v; const fs = fieldsOf(v); s.rules = s.rules.filter(x => fs.some(f => f.key === x.field)); drawRules(); later();
          })),
        h("div", { class: "mk-f" }, h("span", { text: "Include people who match" }), ro ? h("b", { text: s.match === "any" ? "Any rule" : "All rules" }) :
          seg([["all", "All rules"], ["any", "Any rule"]], s.match, v => { s.match = v; drawRules(); later(); })));
    }
    function valueCtl(f, x) {
      if (NOVAL.has(x.op)) return h("span", { class: "mk-rule-v none" });
      const set = v => { x.value = v; later(); };
      if (f.type === "select" || f.type === "person") {
        const opts = f.type === "person" ? peopleOpts() : optPairs(f.options);
        const sel = h("select", { class: "menu-input mk-rule-v", disabled: ro, onchange: () => set(sel.value) }, h("option", { value: "" }, "Choose…"),
          ...opts.map(([v, l]) => h("option", { value: v, selected: String(v) === String(x.value) }, l)));
        return sel;
      }
      if (f.type === "date") {
        const custom = !!x.value && x.value[0] !== "@";
        const din = h("input", { class: "menu-input", type: "date", value: custom ? x.value : "", disabled: ro, oninput: () => set(din.value) });
        const sel = h("select", { class: "menu-input", disabled: ro, onchange: () => { if (sel.value === "custom") { x.value = Apps.today(); drawRules(); later(); } else set(sel.value); } },
          ...(x.value ? [] : [h("option", { value: "", selected: true }, "Choose…")]),
          ...DATE_PRESETS.map(([v, l]) => h("option", { value: v, selected: v === x.value }, l)), h("option", { value: "custom", selected: custom }, "Pick a date…"));
        return h("div", { class: "mk-rule-v mk-rule-date" }, sel, custom ? din : null);
      }
      const inp = h("input", { class: "menu-input mk-rule-v", type: f.type === "number" ? "number" : "text", value: x.value ?? "", placeholder: f.type === "number" ? "0" : "Value", disabled: ro, oninput: () => set(inp.value) });
      return inp;
    }
    function drawRules() {
      const fs = fieldsOf(s.source);
      rulesBox.replaceChildren(
        ...s.rules.map((x, i) => {
          let f = fs.find(f => f.key === x.field);
          if (!f) { f = fs[0]; x.field = f.key; x.op = OPS_FOR[f.type][0]; x.value = ""; }
          if (!OPS_FOR[f.type].includes(x.op)) x.op = OPS_FOR[f.type][0];
          const fieldSel = h("select", { class: "menu-input", disabled: ro, onchange: () => {
            const nf = fs.find(f => f.key === fieldSel.value); x.field = nf.key; x.op = OPS_FOR[nf.type][0]; x.value = nf.type === "date" ? "@month" : ""; drawRules(); later();
            setTimeout(() => rulesBox.children[i]?.querySelector("input.mk-rule-v")?.focus(), 30);
          } }, ...fs.map(ff => h("option", { value: ff.key, selected: ff.key === x.field }, ff.label)));
          const opSel = h("select", { class: "menu-input", disabled: ro, onchange: () => { x.op = opSel.value; drawRules(); later(); } }, ...OPS_FOR[f.type].map(o => h("option", { value: o, selected: o === x.op }, OPS[o])));
          return h("div", { class: "mk-rule" }, h("span", { class: "mk-rule-n", text: i === 0 ? "Where" : s.match === "any" ? "or" : "and" }), fieldSel, opSel, valueCtl(f, x),
            ro ? null : h("button", { class: "icon-btn xs", title: "Remove rule", html: UI.icon("x"), onclick: () => { s.rules.splice(i, 1); drawRules(); later(); } }));
        }),
        !s.rules.length ? h("p", { class: "mk-hint", text: `No rules: everyone in ${SRC[s.source][1].toLowerCase()} is included.` }) : null,
        ro ? null : h("button", { class: "chip-btn mk-add-rule", text: "＋ Add rule", onclick: () => {
          const f = fs[0]; s.rules.push({ field: f.key, op: OPS_FOR[f.type][0], value: "" }); drawRules(); later();
          setTimeout(() => rulesBox.querySelectorAll(".mk-rule")[s.rules.length - 1]?.querySelector("input.mk-rule-v")?.focus(), 30);
        } }));
    }
    function drawResult() {
      const a = audience(s, s.channel), what = s.channel === "sms" ? "phone" : "email";
      result.replaceChildren(
        h("div", { class: "mk-count" },
          h("div", { class: "mk-count-n" }, h("b", { text: num(a.list.length) }), h("span", { text: a.list.length === 1 ? "person can get it" : "people can get it" })),
          seg([["email", "✉️ Email"], ["sms", "💬 SMS"]], s.channel, v => { s.channel = v; drawResult(); })),
        h("div", { class: "mk-ex-chips" }, chip(`${num(a.total)} match the rules`),
          a.blocked.length ? chip(`🚫 ${num(a.blocked.length)} on the black list`, "red") : null,
          a.missing.length ? chip(`${num(a.missing.length)} without ${what === "phone" ? "a phone" : "an email"}`) : null,
          a.dupes ? chip(`${num(a.dupes)} duplicates`) : null,
          a.blocked.length || a.missing.length ? h("button", { class: "chip-btn", text: showEx ? "Hide excluded" : "Show excluded", onclick: () => { showEx = !showEx; drawResult(); } }) : null),
        h("div", { class: "mk-plist" }, ...a.list.slice(0, 50).map(p => personRow(p, s.channel)),
          a.list.length > 50 ? h("div", { class: "mk-more", text: `+ ${num(a.list.length - 50)} more` }) : null,
          !a.list.length ? h("p", { class: "mk-hint", text: a.total ? "Everyone who matches is excluded below." : "Nobody matches yet. Try fewer or looser rules." }) : null),
        showEx ? h("div", { class: "mk-plist ex" }, h("div", { class: "td-sec", text: "Not included" }),
          ...a.blocked.slice(0, 50).map(p => personRow(p, s.channel, "Do not contact")), ...a.missing.slice(0, 50).map(p => personRow(p, s.channel, what === "phone" ? "No phone" : "No email"))) : null);
    }
    async function save() {
      if (!s.name.trim()) { nameIn.focus(); return UI.toast("Give the segment a name"); }
      const rec = { name: s.name.trim(), source: s.source, match: s.match, channel: s.channel, rules: s.rules.map(x => ({ field: x.field, op: x.op, value: x.value ?? "" })),
        count: audience(s, s.channel).list.length, updatedAt: Date.now() };
      let id = src?.id;
      if (isNew) id = await Data.add("segments", rec); else await Data.update("segments", id, rec);
      pnl.close(); UI.toast(isNew ? "🎯 Segment created" : "Segment saved"); onSaved?.(id);
    }
    const body = h("div", { class: "mk-seged" },
      ready ? h("div", { class: "mk-note" }, "✨ A ready-made segment. ", canEdit() ? "Duplicate it to change the rules." : "") : null,
      h("div", { class: "mk-f" }, h("span", { text: "Name" }), nameIn), srcBox,
      h("div", { class: "mk-f" }, h("span", { text: "Rules" }), rulesBox), result,
      h("div", { class: "mk-seg-actions" },
        !isNew && !ready && canEdit() ? h("button", { class: "btn danger", text: "Delete", onclick: async () => {
          if (!(await UI.confirm(`Delete the segment “${s.name}”? Campaigns that used it keep their history.`))) return;
          await Data.remove("segments", src.id); pnl.close(); UI.toast("Segment deleted"); onSaved?.(null);
        } }) : null,
        h("span", { class: "grow" }),
        h("button", { class: "btn", text: ro ? "Close" : "Cancel", onclick: () => pnl.close() }),
        ready && canEdit() ? h("button", { class: "btn primary", text: "Duplicate to edit", onclick: () => {
          pnl.close(); const copy = clone(src); delete copy.id; delete copy.ready; delete copy.icon; copy.name = src.name + " (copy)"; setTimeout(() => editSegment(copy, onSaved), 300);
        } }) : null,
        !ro ? h("button", { class: "btn primary", text: isNew ? "Create segment" : "Save", onclick: save }) : null));
    drawSource(); drawRules(); drawResult();
    const pnl = Apps.panel(isNew ? "New segment" : ready ? "Ready-made segment" : "Edit segment", body);
    pnl.el.classList.add("mk-panel");
    if (isNew && !ro) setTimeout(() => nameIn.focus(), 80);
    return pnl;
  }

  /* ---------- template editor (full view inside the app) ---------- */
  function templateView(ctx, tplIn, preset = {}) {
    const isStarter = !!tplIn?.starter, isCopy = !!preset.copy;
    let saved = !!tplIn && !isStarter && !isCopy, dirty = false;
    const t = tplIn ? clone(tplIn) : { channel: preset.channel === "sms" ? "sms" : "email" };
    if (!saved) { t.id = "t" + uid(); delete t.starter; delete t.desc; delete t.by; if (isCopy) t.name = (t.name || "Template") + " (copy)"; }
    t.channel = t.channel === "sms" ? "sms" : "email";
    if (!t.name) t.name = t.channel === "sms" ? "New SMS template" : "New email template";
    if (t.channel === "email" && !tplIn) { t.subject = ""; t.blocks = [B("heading"), B("text"), B("button"), B("footer")]; }
    if (t.channel === "email" && Array.isArray(t.blocks)) t.blocks = t.blocks.map(b => ({ ...b, id: b.id || uid() }));
    const touch = () => { dirty = true; };
    const el = h("div", { class: "mk-view mk-anim" });
    async function save() {
      if (!canEdit()) return UI.toast("You can't edit marketing templates");
      if (!t.name.trim()) return UI.toast("Give the template a name");
      await saveTemplate(t); saved = true; dirty = false; UI.toast("💾 Template saved"); draw();
    }
    async function leave() {
      if (dirty && canEdit() && !(await UI.confirm("Leave without saving? Your changes to this template will be lost.", "Leave"))) return;
      ctx.back("templates");
    }
    function draw() {
      const nameIn = h("input", { class: "mk-title-in", value: t.name, placeholder: "Template name", disabled: !canEdit(), oninput: () => { t.name = nameIn.value; touch(); } });
      const menu = e => UI.menu(e.currentTarget, [
        { label: "Use in a campaign", iconHtml: "📣", onClick: async () => { if (dirty || !saved) await saveTemplate(t); dirty = false; ctx.newCampaign({ channel: t.channel, template: t.id }); } },
        saved ? { label: "Duplicate", icon: "copy", onClick: () => ctx.openTemplate(t, { copy: true }) } : null,
        saved && canEdit() ? { label: "Delete", icon: "trash", danger: true, onClick: async () => { if (await UI.confirm(`Delete the template “${t.name}”?`)) { await deleteTemplate(t.id); dirty = false; ctx.back("templates"); UI.toast("Template deleted"); } } } : null,
      ], { align: "end" });
      const head = h("div", { class: "mk-vhead" },
        h("button", { class: "btn mk-back", text: "← Templates", onclick: leave }),
        h("span", { class: "mk-vic", text: t.channel === "sms" ? "💬" : "✉️" }), nameIn,
        !saved ? tag(isStarter ? "Copy of a starter" : "Not saved yet", "purple") : null,
        h("span", { class: "grow" }),
        h("button", { class: "icon-btn", title: "More", html: UI.icon("dots"), onclick: menu }),
        canEdit() ? h("button", { class: "btn primary", text: "Save template", onclick: save }) : null);
      let content;
      if (t.channel === "sms") content = smsEditor(t, touch);
      else {
        const subj = trackField(h("input", { class: "menu-input", placeholder: "Subject line, e.g. “{first}, here's what's new”", value: t.subject || "", oninput: () => { t.subject = subj.value; touch(); if (bApi.mode() === "preview") bApi.redraw(); } }));
        const pre = trackField(h("input", { class: "menu-input", placeholder: "Short text shown after the subject in the inbox (optional)", value: t.preheader || "", oninput: () => { t.preheader = pre.value; touch(); } }));
        const bApi = builder(t, touch);
        content = h("div", null, h("div", { class: "mk-subj glass" },
          h("div", { class: "mk-f" }, h("span", { text: "Subject" }), h("div", { class: "mk-f-row" }, subj, phButton(() => subj))),
          h("div", { class: "mk-f" }, h("span", { text: "Preview text" }), pre)), bApi.el);
      }
      el.replaceChildren(head, content);
    }
    draw();
    return { el, cleanup: null };
  }

  /* ---------- campaign wizard: channel → audience → content → check & test → send ---------- */
  const STEPS = [["channel", "Channel"], ["audience", "Audience"], ["content", "Content"], ["test", "Check & test"], ["send", "Send"]];
  function newCampaign(preset = {}) {
    const ch = preset.channel === "sms" ? "sms" : "email";
    const c = { name: `${ch === "sms" ? "SMS" : "Email"} campaign · ${Apps.fmtDate(Apps.today())}`, channel: ch, segment: preset.segment || "", subject: "", preheader: "", blocks: [], theme: {}, sms: "", status: "draft", stats: {} };
    if (preset.template) applyTemplate(c, tplById(preset.template));
    return c;
  }
  function applyTemplate(c, t) {
    if (!t) return;
    if ((t.channel || "email") === "sms") c.sms = t.sms || "";
    else { c.subject = t.subject || ""; c.preheader = t.preheader || ""; c.blocks = clone(t.blocks || []).map(b => ({ ...b, id: uid() })); c.theme = clone(t.theme || {}); }
    c.template = t.id;
  }
  function campaignView(ctx, id, preset = {}) {
    const src = id ? Data.get("campaigns", id) : null;
    const c = src ? clone(src) : newCampaign(preset);
    c.blocks = Array.isArray(c.blocks) ? c.blocks : []; c.stats = c.stats || {};
    let cid = src ? id : null, dirty = false, saveT = 0, saving = null, statsT = 0, statsDirty = false;
    const vs = { step: 0, pi: 0, send: null, mode: null, page: 0, picked: c.blocks.length > 0 || !!src };
    if (c.status === "sent") vs.step = -1;
    else if (c.status === "scheduled") vs.step = 4;
    else if (src) vs.step = c.segment ? 2 : 1;
    else vs.step = preset.channel ? (preset.segment ? 2 : 1) : 0;
    const el = h("div", { class: "mk-view mk-wiz mk-anim" });
    const email = () => c.channel !== "sms";
    const collect = () => {
      const rec = {}; CFIELDS.forEach(k => { if (c[k] !== undefined) rec[k] = c[k]; });
      rec.body = email() ? emailText(c, null) : c.sms || ""; rec.owner = c.owner || me();
      return clone(rec);
    };
    async function persist(force) {
      clearTimeout(saveT);
      if (saving) await saving;
      if (!canEdit() || c.status === "sent") return;
      if (!dirty && (cid || !force)) return;
      dirty = false;
      const rec = collect();
      saving = (async () => { if (!cid) { cid = await Data.add("campaigns", rec); c.id = cid; } else await Data.update("campaigns", cid, rec); })();
      try { await saving; } finally { saving = null; }
    }
    const touch = () => { if (!canEdit()) return; dirty = true; clearTimeout(saveT); saveT = setTimeout(() => persist(true), 1500); };
    let pc = { t: 0, list: [] };
    const people = () => { if (Date.now() - pc.t > 3000) { const sg = segById(c.segment); pc = { t: Date.now(), list: sg ? audience(sg, c.channel).list : [] }; } return pc.list; };

    function okContent() { return email() ? !!(c.subject || "").trim() && c.blocks.length > 0 : !!(c.sms || "").trim(); }
    function blocker(i) {
      if (i >= 3 && !segById(c.segment)) return "Choose who gets it first";
      if (i >= 3 && !okContent()) return email() ? (!(c.subject || "").trim() ? "Add a subject line first" : "Add some content first") : "Write your message first";
      return "";
    }
    function go(i) {
      if (i > vs.step) {
        if (vs.step === 1 && !segById(c.segment)) return UI.toast("Choose who gets it first");
        const b = blocker(i); if (b) return UI.toast(b);
      }
      vs.step = i; persist(true); draw(); scrollTop();
    }
    function head() {
      const nameIn = h("input", { class: "mk-title-in", value: c.name || "", placeholder: "Campaign name", disabled: !canEdit() || c.status === "sent", oninput: () => { c.name = nameIn.value; touch(); } });
      if (c.status === "sent") nameIn.disabled = !canEdit();
      if (c.status === "sent") nameIn.oninput = () => { c.name = nameIn.value; clearTimeout(saveT); saveT = setTimeout(() => cid && Data.update("campaigns", cid, { name: c.name }), 1200); };
      const more = cid ? h("button", { class: "icon-btn", title: "More", html: UI.icon("dots"), onclick: e => UI.menu(e.currentTarget, [
        canEdit() ? { label: "Duplicate", icon: "copy", onClick: async () => { await persist(); const nid = await duplicateCampaign(Data.get("campaigns", cid) || c); UI.toast("Campaign duplicated"); ctx.openCampaign(nid); } } : null,
        canEdit() ? { label: "Delete", icon: "trash", danger: true, onClick: async () => {
          if (!(await UI.confirm(`Delete the campaign “${c.name || "Untitled"}”?`))) return;
          dirty = false; clearTimeout(saveT); await Data.remove("campaigns", cid); ls.del("done-" + cid); ctx.back("campaigns"); UI.toast("Campaign deleted");
        } } : null], { align: "end" }) }) : null;
      return h("div", { class: "mk-vhead" }, h("button", { class: "btn mk-back", text: "← Campaigns", onclick: () => ctx.back("campaigns") }),
        h("span", { class: "mk-vic", text: email() ? "✉️" : "💬" }), nameIn, statusTag(c), h("span", { class: "grow" }), more);
    }
    function stepper() {
      return h("div", { class: "mk-steps" }, ...STEPS.map(([, l], i) => h("button", { class: "mk-stp" + (i === vs.step ? " on" : "") + (i < vs.step ? " done" : ""), onclick: () => go(i) },
        h("span", { class: "mk-stp-n", text: i < vs.step ? "✓" : String(i + 1) }), h("span", { class: "mk-stp-l", text: l }))));
    }
    function footer() {
      const back = vs.step > 0 ? h("button", { class: "btn", text: "← Back", onclick: () => go(vs.step - 1) }) : h("span");
      if (vs.step >= 4) return h("div", { class: "mk-wiz-foot" }, back);
      return h("div", { class: "mk-wiz-foot" }, back, h("span", { class: "mk-saved", text: cid && canEdit() ? "Saved as a draft automatically" : "" }),
        h("button", { class: "btn primary", text: `Next: ${STEPS[vs.step + 1][1]} →`, onclick: () => go(vs.step + 1) }));
    }
    function draw() {
      if (vs.step === -1) { el.replaceChildren(head(), reportView()); return; }
      el.replaceChildren(head(), stepper(), h("div", { class: "mk-step-body" }, [channelStep, audienceStep, contentStep, testStep, sendStep][vs.step]()), footer());
    }

    /* 1. channel */
    function channelStep() {
      const card = (k, ic, t, d) => h("button", { class: "mk-chan glass" + (c.channel === k ? " on" : ""), onclick: () => {
        if (c.channel !== k) { c.channel = k; if (/^(Email|SMS) campaign · /.test(c.name || "")) c.name = c.name.replace(/^(Email|SMS)/, k === "sms" ? "SMS" : "Email"); pc.t = 0; touch(); }
        draw();
      } }, h("span", { class: "mk-chan-ic", text: ic }), h("b", { text: t }), h("span", { text: d }), h("span", { class: "mk-chan-check", text: "✓" }));
      return h("div", { class: "mk-step" }, h("h2", { text: "How do you want to reach people?" }),
        h("div", { class: "mk-chan-grid" },
          card("email", "✉️", "Email", "Designed emails with images and buttons. Sent from your own mail app or a mail-merge tool."),
          card("sms", "💬", "SMS", "Short text messages up to 160 characters. Sent from your phone or an SMS service.")),
        h("p", { class: "mk-hint", text: "Lumen prepares a personal message for everyone; the final send happens in your own mail or messages app." }));
    }

    /* 2. audience */
    function audienceStep() {
      const memo = new Map(), aud = sg => { if (!memo.has(sg.id)) memo.set(sg.id, audience(sg, c.channel)); return memo.get(sg.id); };
      const pickCard = sg => {
        const a = aud(sg);
        return h("button", { class: "mk-segpick" + (c.segment === sg.id ? " on" : ""), onclick: () => { c.segment = sg.id; pc.t = 0; touch(); draw(); } },
          h("span", { class: "mk-radio" }), h("span", { class: "mk-sp-ic", text: sg.icon || SRC[sg.source]?.[0] || "🎯" }),
          h("span", { class: "mk-sp-t" }, h("b", { text: sg.name }), h("small", { text: rulesSummary(sg) })),
          h("span", { class: "mk-sp-n" }, h("b", { text: num(a.list.length) }), h("small", { text: email() ? "with email" : "with phone" })));
      };
      const sel = segById(c.segment), mine = mySegments();
      const after = nid => { if (nid) { c.segment = nid; touch(); } pc.t = 0; draw(); };
      return h("div", { class: "mk-step mk-aud" },
        h("div", { class: "mk-aud-l" },
          h("div", { class: "mk-sec-h" }, h("h2", { text: "Who gets it?" }), canEdit() ? h("button", { class: "btn", text: "＋ New segment", onclick: () => editSegment(null, after) }) : null),
          h("div", { class: "td-sec", text: "Ready-made" }), ...READY.map(pickCard),
          h("div", { class: "td-sec", text: "My segments" }),
          ...(mine.length ? mine.map(pickCard) : [h("p", { class: "mk-hint", text: "No segments yet. Create one to reach exactly the people you want." })])),
        h("div", { class: "mk-aud-r" }, sel ? audDetail(sel, aud(sel), after) : h("div", { class: "mk-aud-d glass mk-aud-empty" }, h("div", { class: "mk-ce-ic", text: "🎯" }), h("span", { text: "Pick a segment to see who gets this campaign." }))));
    }
    function audDetail(sg, a, after) {
      const what = email() ? "an email address" : "a phone number";
      return h("div", { class: "mk-aud-d glass" },
        h("div", { class: "mk-count-n big" }, h("b", { text: num(a.list.length) }), h("span", { text: a.list.length === 1 ? "person will get this" : "people will get this" })),
        h("div", { class: "mk-ex-chips" }, chip(`${num(a.total)} in “${sg.name}”`),
          a.blocked.length ? chip(`🚫 ${num(a.blocked.length)} on the black list`, "red") : null,
          a.missing.length ? chip(`${num(a.missing.length)} without ${what}`) : null,
          a.dupes ? chip(`${num(a.dupes)} duplicates`) : null),
        h("div", { class: "mk-plist" }, ...a.list.slice(0, 12).map(p => personRow(p, c.channel)), a.list.length > 12 ? h("div", { class: "mk-more", text: `+ ${num(a.list.length - 12)} more` }) : null,
          !a.list.length ? h("p", { class: "mk-hint", text: "Nobody here can get this campaign yet." }) : null),
        h("div", { class: "mk-aud-acts" }, h("button", { class: "btn", text: sg.ready || !canEdit() ? "View rules" : "Edit segment", onclick: () => editSegment(sg, after) })));
    }

    /* 3. content */
    function pickTemplate() {
      const go2 = async t => {
        if (vs.picked && (email() ? c.blocks.length : (c.sms || "").trim()) && !(await UI.confirm("Replace the current content with this template?", "Replace"))) return;
        if (t) applyTemplate(c, t); else if (email()) { c.blocks = [B("heading"), B("text"), B("button"), B("footer")]; c.template = null; }
        vs.picked = true; touch(); m.close(); draw();
      };
      const m = UI.modal("Choose a template", templateGallery(c.channel, go2, email()), { className: "mk-gal-modal" });
      m.el.style.width = "min(980px, 96vw)";
    }
    async function saveAsTemplate() {
      const v = await Apps.form("Save as template", [{ key: "name", label: "Template name", required: true }], { name: c.name });
      if (!v) return;
      await saveTemplate({ id: "t" + uid(), name: v.name.trim(), channel: c.channel, subject: c.subject || "", preheader: c.preheader || "", blocks: clone(c.blocks), theme: clone(c.theme || {}), sms: c.sms || "" });
      UI.toast("💾 Saved to My templates");
    }
    function contentStep() {
      const tplBtn = h("button", { class: "chip-btn", text: "📄 Use a template", onclick: pickTemplate });
      const saveBtn = canEdit() ? h("button", { class: "chip-btn", text: "💾 Save as template", onclick: saveAsTemplate }) : null;
      if (!email()) return h("div", { class: "mk-step" }, h("div", { class: "mk-sec-h" }, h("h2", { text: "Write your message" })), smsEditor(c, touch, { people, extra: [tplBtn, saveBtn] }));
      if (!vs.picked && !c.blocks.length) return h("div", { class: "mk-step" }, h("h2", { text: "Pick a starting point" }),
        templateGallery("email", t => { if (t) applyTemplate(c, t); else { c.blocks = [B("heading"), B("text"), B("button"), B("footer")]; } vs.picked = true; touch(); draw(); }, true));
      let bApi;
      const subj = trackField(h("input", { class: "menu-input mk-subj-in", placeholder: "Subject line, e.g. “{first}, here's what's new”", value: c.subject || "", oninput: () => { c.subject = subj.value; touch(); if (bApi?.mode() === "preview") bApi.redraw(); } }));
      const pre = trackField(h("input", { class: "menu-input", placeholder: "Short text shown after the subject in the inbox (optional)", value: c.preheader || "", oninput: () => { c.preheader = pre.value; touch(); if (bApi?.mode() === "preview") bApi.redraw(); } }));
      const ai = Apps.AI?.button && Apps.AI.available?.() ? Apps.AI.button("Suggest", () => `Write one short, friendly email subject line (at most 60 characters, no quotes) for this email:\n\n${emailText(c, null).slice(0, 1500)}`,
        res => { c.subject = String(res || "").split("\n").map(x => x.trim()).filter(Boolean)[0]?.replace(/^["“']|["”']$/g, "") || c.subject; subj.value = c.subject; touch(); }) : null;
      bApi = builder(c, touch, { people });
      return h("div", { class: "mk-step" },
        h("div", { class: "mk-subj glass" },
          h("div", { class: "mk-f" }, h("span", { text: "Subject" }), h("div", { class: "mk-f-row" }, subj, phButton(() => subj), ai)),
          h("div", { class: "mk-f" }, h("span", { text: "Preview text" }), pre),
          h("div", { class: "mk-subj-acts" }, tplBtn, saveBtn)),
        bApi.el);
    }

    /* 4. check & test */
    function testStep() {
      const sg = segById(c.segment), a = sg ? audience(sg, c.channel) : { list: [], blocked: [], missing: [] };
      const checks = [];
      const ck = (state, text, fix) => checks.push(h("div", { class: "mk-check " + (state === true ? "ok" : state === "info" ? "info" : "warn") },
        h("span", { class: "mk-ck-ic", text: state === true ? "✓" : state === "info" ? "i" : "!" }), h("span", { class: "grow", text }), fix ? h("button", { class: "chip-btn", text: fix[0], onclick: fix[1] }) : null));
      ck(a.list.length > 0, a.list.length ? `${plural(a.list.length, "person", "people")} will get it` : "Nobody in the audience yet", a.list.length ? null : ["Choose audience", () => go(1)]);
      if (a.blocked.length) ck("info", `${plural(a.blocked.length, "person", "people")} on the black list will be skipped`);
      const sample = a.list[0] || SAMPLE;
      if (email()) {
        ck(!!(c.subject || "").trim(), c.subject ? `Subject: “${fill(c.subject, sample)}”` : "No subject line", c.subject ? null : ["Add one", () => go(2)]);
        const foot = c.blocks.some(b => b.type === "footer");
        ck(foot, foot ? "Has a footer with an unsubscribe line" : "No footer with an unsubscribe line", foot ? null : ["Add footer", () => { c.blocks.push(B("footer")); touch(); draw(); }]);
        const bad = c.blocks.filter(b => b.type === "button" && safeUrl(b.url) === "#").length;
        if (c.blocks.some(b => b.type === "button")) ck(!bad, bad ? `${plural(bad, "button")} without a link` : "Every button has a link", bad ? ["Fix it", () => go(2)] : null);
        const unk = unknownPH((c.subject || "") + " " + (c.preheader || "") + " " + emailText(c, null));
        if (unk.length) ck(false, `Unknown fields: ${unk.join(", ")}. Use {first}, {name} or {company}.`, ["Fix it", () => go(2)]);
        if (c.blocks.some(b => b.type === "image" && b.att)) ck("info", "Uploaded images are embedded. Some mail apps hide them; image links (https://…) work best.");
        if (mailto(sample.email, fill(c.subject, sample), emailText(c, sample)).length > 1900) ck("info", "This email is long. Mail apps may cut long emails opened from a link, so “Copy designed email” or the CSV works better.");
      } else {
        const i = smsInfo(fill(c.sms, sample));
        ck(i.parts === 1 ? true : "info", i.parts === 1 ? `${i.len} characters: fits in one SMS` : `${i.len} characters: goes out as ${i.parts} messages`);
        const optout = /stop|opt.?out|unsubscribe/i.test(c.sms || "");
        ck(optout ? true : "info", optout ? "Has an opt-out line" : "Tip: add “Reply STOP to opt out”");
        const unk = unknownPH(c.sms); if (unk.length) ck(false, `Unknown fields: ${unk.join(", ")}`, ["Fix it", () => go(2)]);
      }
      const list = a.list.length ? a.list : [SAMPLE];
      vs.pi = ((vs.pi % list.length) + list.length) % list.length; const p = list[vs.pi];
      if (vs.testTo == null) vs.testTo = email() ? replyTo() : (Data.people().find(x => x.key === me())?.phone || "");
      const to = h("input", { class: "menu-input", type: email() ? "email" : "tel", value: vs.testTo, placeholder: email() ? "Your email" : "Your phone number", oninput: () => { vs.testTo = to.value; } });
      const send = () => {
        const v = to.value.trim();
        if (email()) { if (!isEmail(v)) return UI.toast("Enter your email address"); openLink(mailto(v, "[Test] " + fill(c.subject, p), emailText(c, p))); }
        else { if (!phoneKey(v)) return UI.toast("Enter your phone number"); openLink(smsto(v, fill(c.sms, p))); }
        UI.toast("Opening your " + (email() ? "mail" : "messages") + " app…");
      };
      return h("div", { class: "mk-step mk-testgrid" },
        h("div", { class: "mk-test-l" },
          h("div", { class: "mk-checks glass" }, h("h3", { text: "Before you send" }), ...checks),
          h("div", { class: "mk-test glass" }, h("h3", { text: "Send a test to yourself" }),
            h("p", { class: "mk-hint", text: `Opens your ${email() ? "mail" : "messages"} app with a test, filled in with this person's details:` }),
            cyclerEl(list, vs.pi, d => { vs.pi += d; draw(); }),
            h("div", { class: "mk-f-row" }, to, h("button", { class: "btn primary", text: email() ? "✉️ Open test email" : "💬 Open test SMS", onclick: send })),
            email() ? h("button", { class: "chip-btn", text: "📋 Copy designed email", onclick: () => copyHTML(emailHTML(c, p), emailText(c, p)) }) : null)),
        h("div", { class: "mk-test-r" }, email() ? previewEl(c, p, "desktop") : h("div", { class: "mk-phone" }, smsBubble(fill(c.sms, p), p))));
    }

    /* 5. send or schedule */
    function sendStep() {
      const sg = segById(c.segment), a = sg ? audience(sg, c.channel) : null;
      if (!a) return h("div", { class: "mk-step" }, Apps.empty("🎯", "Choose who gets it first", h("button", { class: "btn primary", text: "Choose audience", onclick: () => go(1) })));
      if (!vs.mode) vs.mode = c.status === "scheduled" && !isReady(c) ? "schedule" : "now";
      const parts = [h("div", { class: "mk-send-top" },
        h("div", { class: "mk-count-n" }, h("b", { text: num(a.list.length) }), h("span", { text: `${a.list.length === 1 ? "person" : "people"} in “${sg.name}”` })),
        canEdit() ? seg([["now", "Send now"], ["schedule", "Schedule"]], vs.mode, v => { vs.mode = v; draw(); }) : null)];
      if (c.status === "scheduled") parts.push(h("div", { class: "mk-banner" + (isReady(c) ? " ready" : "") },
        h("span", { class: "grow", text: isReady(c) ? `⏰ Scheduled for ${when(c.scheduledAt)}. It's time to send!` : `🗓️ Scheduled for ${when(c.scheduledAt)}. Lumen will remind ${ownerOf(c) === me() ? "you" : Data.person(ownerOf(c)).name} then.` }),
        canEdit() ? h("button", { class: "btn", text: "Unschedule", onclick: async () => { c.status = "draft"; c.scheduledAt = null; dirty = true; await persist(true); vs.mode = "now"; draw(); UI.toast("Back to draft"); } }) : null));
      parts.push(vs.mode === "schedule" ? scheduleBox() : sendBox(sg, a));
      return h("div", { class: "mk-step" }, ...parts);
    }
    function scheduleBox() {
      const inp = h("input", { class: "menu-input", type: "datetime-local", value: toLocalInput(c.scheduledAt || tomorrow10()) });
      return h("div", { class: "mk-sched glass" }, h("h3", { text: "When should it go out?" }),
        h("p", { class: "mk-hint", text: "Lumen can't send on its own. At that time it reminds you with a notification and marks the campaign “Ready to send”; finishing the send takes a minute from here." }),
        h("div", { class: "mk-f-row" }, inp, h("button", { class: "btn primary", text: c.status === "scheduled" ? "Change time" : "Schedule", onclick: async () => {
          const t = new Date(inp.value).getTime();
          if (!inp.value || isNaN(t)) return UI.toast("Pick a date and time");
          if (t < Date.now() - 60000) return UI.toast("Pick a time in the future");
          c.status = "scheduled"; c.scheduledAt = t; dirty = true; await persist(true);
          UI.toast(`🗓️ Scheduled for ${when(t)}`); draw();
        } })));
    }
    function sendBox(sg, a) {
      const isMail = email(), doneKey = "done-" + (cid || "new");
      let done; try { done = new Set(JSON.parse(ls.get(doneKey, "[]"))); } catch { done = new Set(); }
      const saveDone = () => ls.set(doneKey, JSON.stringify([...done]));
      const methods = isMail ? [["mail", "✉️ My mail app"], ["bcc", "👥 BCC list"], ["csv", "📊 Mail merge"]] : [["phone", "📱 Messages app"], ["copy", "📋 Copy numbers"], ["csv", "📊 CSV"]];
      if (!methods.some(m => m[0] === vs.send)) vs.send = methods[0][0];
      const body = h("div", { class: "mk-method" });
      const BATCH = 10;
      const fileBase = fileSafe(c.name);
      function oneByOne() {
        const list = a.list, n = list.length, nDone = list.filter(p => done.has(p.key)).length, next = list.find(p => !done.has(p.key));
        const pages = Math.ceil(n / BATCH); vs.page = clamp(vs.page, 0, Math.max(0, pages - 1));
        const open = p => {
          openLink(isMail ? mailto(p.email, fill(c.subject, p), emailText(c, p)) : smsto(p.phone, fill(c.sms, p)));
          done.add(p.key); saveDone();
          const nx = list.find(x => !done.has(x.key)); if (nx) vs.page = Math.floor(list.indexOf(nx) / BATCH);
          fillM();
        };
        return [
          h("p", { class: "mk-hint", text: isMail ? "Opens a personal email in your mail app for each person, already filled in. Press Send there, then come back for the next one." : "Opens your messages app with a personal text for each person. Works best on your phone." }),
          h("div", { class: "mk-progress" }, h("div", { class: "mk-bar" }, h("span", { style: { width: (n ? nDone / n * 100 : 0) + "%" } })), h("small", { text: `${num(nDone)} of ${num(n)} opened` })),
          next ? h("button", { class: "btn primary big mk-next", onclick: () => open(next) }, `${isMail ? "✉️" : "💬"} Open next: ${next.name}`, h("small", { text: ` · ${list.indexOf(next) + 1} of ${num(n)}` }))
            : h("div", { class: "mk-alldone", text: "🎉 All opened. Mark the campaign as sent below." }),
          h("div", { class: "mk-batch" }, ...list.slice(vs.page * BATCH, vs.page * BATCH + BATCH).map(p => h("div", { class: "mk-brow" + (done.has(p.key) ? " done" : "") },
            h("span", { class: "mk-bcheck", text: done.has(p.key) ? "✓" : "" }), h("span", { class: "mk-prow-t" }, h("b", { text: p.name }), h("small", { text: isMail ? p.email : p.phone })),
            h("button", { class: "chip-btn", text: done.has(p.key) ? "Again" : "Open", onclick: () => open(p) })))),
          h("div", { class: "mk-pager" },
            pages > 1 ? h("button", { class: "icon-btn xs", text: "‹", disabled: vs.page === 0, onclick: () => { vs.page--; fillM(); } }) : null,
            pages > 1 ? h("span", { text: `Batch ${vs.page + 1} of ${pages}` }) : null,
            pages > 1 ? h("button", { class: "icon-btn xs", text: "›", disabled: vs.page >= pages - 1, onclick: () => { vs.page++; fillM(); } }) : null,
            h("span", { class: "grow" }),
            nDone ? h("button", { class: "chip-btn", text: "Start over", onclick: () => { done.clear(); saveDone(); vs.page = 0; fillM(); } }) : null)];
      }
      function bcc() {
        const size = +(vs.bsize || 50), list = a.list, batches = [];
        for (let i = 0; i < list.length; i += size) batches.push(list.slice(i, i + size));
        const generic = {}, subj = fill(c.subject, generic), text = emailText(c, generic);
        return [
          h("p", { class: "mk-hint", text: "Everyone gets the same email and nobody sees the other addresses. Personal fields become friendly defaults (“Hi there”)." }),
          h("div", { class: "mk-f-row wrap" }, h("span", { class: "mk-muted", text: "Batch size" }), seg([["25", "25"], ["50", "50"], ["100", "100"]], String(size), v => { vs.bsize = v; fillM(); }),
            h("small", { class: "mk-muted", text: "Most mail apps limit how many people one email can go to." })),
          h("div", { class: "mk-batch" }, ...batches.map((b, i) => h("div", { class: "mk-brow" },
            h("span", { class: "mk-prow-t" }, h("b", { text: `Batch ${i + 1}` }), h("small", { text: `${plural(b.length, "address", "addresses")} · ${b[0].name}${b.length > 1 ? " … " + b[b.length - 1].name : ""}` })),
            h("button", { class: "chip-btn", text: "📋 Copy", onclick: () => copyText(b.map(p => p.email).join(", "), `${b.length} addresses copied`) }),
            h("button", { class: "chip-btn", text: "✉️ Open", title: "Opens your mail app with these people in BCC", onclick: () => openLink(mailto(replyTo(), subj, text, { bcc: b.map(p => p.email).join(",") })) })))),
          h("div", { class: "mk-f-row wrap" }, h("button", { class: "btn", text: "📋 Copy designed email", onclick: () => copyHTML(emailHTML(c, generic), text) }), h("button", { class: "btn", text: "Copy subject", onclick: () => copyText(subj, "Subject copied") })),
          h("p", { class: "mk-hint", text: "Tip: open a batch, then paste the designed email into the message to keep the layout, colors and images." })];
      }
      function numbers() {
        const nums = a.list.map(p => p.phone), ta = h("textarea", { class: "menu-input mk-copy-ta", rows: 5, readonly: true });
        ta.value = nums.join("\n");
        return [h("p", { class: "mk-hint", text: "Copy every number and paste it into your SMS service or a group message. Personal fields become friendly defaults." }), ta,
          h("div", { class: "mk-f-row wrap" }, h("button", { class: "btn primary", text: `📋 Copy ${plural(nums.length, "number")}`, onclick: () => copyText(nums.join(", "), "Numbers copied") }),
            h("button", { class: "btn", text: "Copy message", onclick: () => copyText(fill(c.sms, {}), "Message copied") }))];
      }
      function csv() {
        if (!isMail) return [h("p", { class: "mk-hint", text: "A spreadsheet with each person's number and their personal message, ready to upload to an SMS service (Twilio, MessageBird, ClickSend…)." }),
          h("button", { class: "btn primary", text: `📊 Download CSV (${plural(a.list.length, "row")})`, onclick: () => download(fileBase + ".csv", toCsv([["Phone", "Name", "First name", "Company", "Message"], ...a.list.map(p => [p.phone, p.name, p.first, p.company, fill(c.sms, p)])])) })];
        return [
          h("p", { class: "mk-hint", text: "A spreadsheet with each person's address plus their own subject and message. Import it into a mail-merge tool to send everything in one go." }),
          h("div", { class: "mk-f-row wrap" },
            h("button", { class: "btn primary", text: `📊 Download CSV (${plural(a.list.length, "row")})`, onclick: () => download(fileBase + ".csv", toCsv([["Email", "First name", "Last name", "Name", "Company", "Subject", "Body"],
              ...a.list.map(p => { const parts = p.name.split(/\s+/); return [p.email, p.first, p.col === "companies" ? "" : parts.slice(1).join(" "), p.name, p.company, fill(c.subject, p), emailText(c, p)]; })])) }),
            h("button", { class: "btn", text: "🧩 Download HTML email", title: "Uses Mailchimp merge tags like *|FNAME|*", onclick: () => download(fileBase + ".html", emailHTML({ ...c, subject: fill(c.subject, MERGE) }, MERGE, { full: true }), "text/html;charset=utf-8") })),
          h("div", { class: "mk-howto" },
            h("div", null, h("b", { text: "Gmail" }), h("span", { text: "Import the CSV into Google Sheets, then use Gmail mail merge (Google Workspace) or an add-on such as YAMM with the Subject and Body columns." })),
            h("div", null, h("b", { text: "Mailchimp" }), h("span", { text: "Audience → Import contacts → upload the CSV. Then create an email with “Code your own” and paste the HTML file: it already uses *|FNAME|* merge tags." })),
            h("div", null, h("b", { text: "Outlook / Word" }), h("span", { text: "Mailings → Start mail merge → E-mail messages, and pick the CSV as your list." })))];
      }
      function fillM() { body.replaceChildren(...{ mail: oneByOne, phone: oneByOne, bcc, copy: numbers, csv }[vs.send]()); }
      async function markSent() {
        const doneList = a.list.filter(p => done.has(p.key)), partial = doneList.length && doneList.length < a.list.length;
        const v = await Apps.form("Mark as sent", [
          ...(partial ? [{ key: "who", label: "Who got it?", type: "select", options: [["opened", `Only the ${doneList.length} I opened here`], ["all", `Everyone in the audience (${a.list.length})`]] }] : []),
          { key: "opened", label: "Opened (optional)", type: "number", half: true, placeholder: "Add it later" },
          { key: "replied", label: "Replied (optional)", type: "number", half: true, placeholder: "Add it later" }], { who: partial ? "opened" : "all" }, { ok: "Mark as sent", width: 460 });
        if (!v) return;
        const list = v.who === "opened" ? doneList : a.list;
        const stats = { ...(c.stats || {}), sent: list.length };
        ["opened", "replied"].forEach(k => { if (v[k] !== "" && v[k] != null && !isNaN(+v[k])) stats[k] = Math.max(0, +v[k]); });
        clearTimeout(saveT); dirty = false;
        Object.assign(c, { status: "sent", sentAt: Date.now(), stats });
        const rec = { ...collect(), status: "sent", sentAt: c.sentAt, stats, recipientsCount: list.length, segmentName: sg.name,
          recipients: list.slice(0, 2000).map(p => ({ key: p.key, col: p.col, id: p.id, n: p.name.slice(0, 80), ...(isMail ? { email: p.email } : { phone: p.phone }) })) };
        if (!cid) cid = await Data.add("campaigns", rec); else await Data.update("campaigns", cid, rec);
        c.recipients = rec.recipients; c.recipientsCount = list.length; c.segmentName = sg.name;
        ls.del(doneKey); UI.toast("📣 Campaign marked as sent"); vs.step = -1; draw(); scrollTop();
      }
      if (!a.list.length) return h("div", { class: "mk-sendbox glass" }, Apps.empty("🫥", "Nobody in this audience can get the campaign right now.", h("button", { class: "btn", text: "Change audience", onclick: () => go(1) })));
      fillM();
      return h("div", { class: "mk-sendbox glass" }, h("h3", { text: "How do you want to send it?" }), seg(methods, vs.send, v => { vs.send = v; fillM(); }, "mk-mseg"), body,
        canEdit() ? h("div", { class: "mk-mark" }, h("span", { text: "Done sending? Mark it as sent to keep track of who got it." }), h("button", { class: "btn primary", text: "✅ Mark as sent", onclick: markSent })) : null);
    }

    /* sent: report with manual stats */
    function reportView() {
      const sent = +c.stats?.sent || c.recipientsCount || (c.recipients || []).length;
      const saveStats = () => { clearTimeout(statsT); statsDirty = false; if (cid) Data.update("campaigns", cid, { stats: c.stats }); };
      const stat = (k, label, ic) => {
        const v = c.stats?.[k];
        const rate = h("small", { text: k === "sent" ? (c.recipientsCount && c.recipientsCount !== sent ? `${num(c.recipientsCount)} in the list` : "people") : v != null && v !== "" ? pct(v, sent) + " of sent" : "Add it when you know" });
        const i = h("input", { class: "mk-stat-in", type: "number", min: 0, value: v ?? "", placeholder: "—", disabled: !canEdit(), oninput: () => {
          const nv = i.value === "" ? null : Math.max(0, +i.value || 0);
          c.stats = { ...(c.stats || {}), [k]: nv };
          if (k !== "sent") rate.textContent = nv != null ? pct(nv, +c.stats.sent || sent) + " of sent" : "Add it when you know";
          statsDirty = true; clearTimeout(statsT); statsT = setTimeout(saveStats, 900);
        } });
        return h("div", { class: "mk-stat glass" }, h("span", { class: "mk-stat-ic", text: ic }), h("span", { class: "mk-stat-l", text: label }), i, rate);
      };
      const rp = (c.recipients || []).map(r => {
        const rec = r.col && r.id && Data.get(r.col, r.id);
        return rec && !rec.deleted ? personOf(r.col, rec) : { key: r.key || uid(), col: r.col, id: r.id, name: r.n || r.email || r.phone || "Someone", first: String(r.n || "").split(" ")[0], company: "", email: r.email || "", phone: r.phone || "" };
      });
      vs.pi = rp.length ? ((vs.pi % rp.length) + rp.length) % rp.length : 0;
      const p = rp[vs.pi] || SAMPLE;
      vs.rn = vs.rn || 60;
      return h("div", { class: "mk-report" },
        h("div", { class: "mk-banner sent" }, h("span", { class: "grow", text: `✅ Sent ${dayOf(c.sentAt)} to ${plural(sent, "person", "people")} · ${c.segmentName || segNameOf(c)} · ${email() ? "Email" : "SMS"}` }),
          canEdit() ? h("button", { class: "btn", text: "Send again as new", onclick: async () => { const nid = await duplicateCampaign(c); ctx.openCampaign(nid); } }) : null),
        h("div", { class: "mk-stats" }, stat("sent", "Sent", "📤"), stat("opened", "Opened", "📬"), stat("clicked", "Clicked", "🖱️"), stat("replied", "Replied", "💬")),
        h("p", { class: "mk-hint", text: "Lumen can't see your mail app, so add opens, clicks and replies yourself (for example from your mail-merge tool's report)." }),
        h("div", { class: "mk-rep-grid" },
          h("div", { class: "mk-rep-l" }, h("div", { class: "mk-sec-h" }, h("h3", { text: "What they got" }), rp.length > 1 ? cyclerEl(rp, vs.pi, d => { vs.pi += d; draw(); }) : null),
            email() ? previewEl(c, p, "desktop") : h("div", { class: "mk-phone" }, smsBubble(fill(c.sms, p), p))),
          h("div", { class: "mk-rep-r glass" }, h("div", { class: "mk-sec-h" }, h("h3", { text: `Recipients (${num(rp.length)})` }),
            (c.recipientsCount || 0) > rp.length ? h("small", { class: "mk-muted", text: `first ${num(rp.length)} kept` }) : null),
            h("div", { class: "mk-plist" }, ...rp.slice(0, vs.rn).map(x => personRow(x, c.channel)),
              rp.length > vs.rn ? h("button", { class: "chip-btn mk-more-btn", text: `Show more (${num(rp.length - vs.rn)})`, onclick: () => { vs.rn += 200; draw(); } }) : null,
              !rp.length ? h("p", { class: "mk-hint", text: "No recipient list was saved for this campaign." }) : null))));
    }

    draw();
    return { el, cleanup: () => { if (dirty) persist(true); if (statsDirty && cid) { clearTimeout(statsT); Data.update("campaigns", cid, { stats: c.stats }); } } };
  }

  /* ---------- tabs ---------- */
  const TABS = [["start", "Start"], ["campaigns", "Campaigns"], ["segments", "Segments"], ["templates", "My templates"], ["recipients", "Recipients"], ["blacklist", "Black list"], ["settings", "Settings"]];
  function newMenu(anchor, ctx, extra = {}) {
    UI.menu(anchor, [{ label: "Email campaign", iconHtml: "✉️", onClick: () => ctx.newCampaign({ ...extra, channel: "email" }) }, { label: "SMS campaign", iconHtml: "💬", onClick: () => ctx.newCampaign({ ...extra, channel: "sms" }) }], { align: "end" });
  }
  function howItWorks() {
    const step = (n, t, d) => h("div", { class: "mk-how-s" }, h("span", { class: "mk-how-n", text: n }), h("div", null, h("b", { text: t }), h("span", { text: d })));
    return h("div", { class: "mk-how glass" },
      h("div", { class: "mk-how-h" }, h("span", { class: "mk-how-ic", text: "💡" }), h("div", null, h("h3", { text: "How sending works" }),
        h("p", { text: "Lumen doesn't send email or SMS by itself: there's no mail server behind it. It builds the audience and a personal message for every person, then hands them to the tools you already use." }))),
      h("div", { class: "mk-how-steps" },
        step("1", "Pick the audience", "Segments pull people from your CRM and skip anyone on the black list."),
        step("2", "Write it once", "Design the email or SMS. {first} and {company} make each copy personal."),
        step("3", "Send your way", "Open each email in your mail app, copy a BCC list, or export a CSV for Gmail mail merge or Mailchimp."),
        step("4", "Track it", "Mark the campaign as sent and add opens, clicks and replies when you know them.")));
  }
  function startTab(ctx) {
    const cs = campaigns(), m0 = monthStart(), idx = recipientsIndex();
    const sent = cs.filter(c => c.status === "sent"), thisMonth = cs.filter(c => (c.sentAt || c.at || 0) >= m0).length;
    const sentSum = sent.reduce((s, c) => s + (+c.stats?.sent || 0), 0), openSum = sent.filter(c => c.stats?.opened != null).reduce((s, c) => s + (+c.stats.opened || 0), 0);
    const withOpen = sent.filter(c => c.stats?.opened != null).reduce((s, c) => s + (+c.stats?.sent || 0), 0);
    const ready = cs.filter(c => isReady(c));
    const recent = [...cs].sort((a, b) => (b.sentAt || b.scheduledAt || b.at || 0) - (a.sentAt || a.scheduledAt || a.at || 0)).slice(0, 5);
    const kpi = (ic, value, label, sub, tab) => h("button", { class: "mk-kpi glass", onclick: () => tab && ctx.tab(tab) }, h("span", { class: "mk-kpi-ic", text: ic }),
      h("span", { class: "mk-kpi-t" }, h("b", { text: value }), h("span", { text: label }), sub ? h("small", { text: sub }) : null));
    const qa = (ic, label, fn) => canEdit() || !fn.edit ? h("button", { class: "mk-qa", onclick: fn }, h("span", { class: "mk-qa-ic", text: ic }), h("span", { text: label })) : null;
    const editOnly = fn => Object.assign(fn, { edit: true });
    return h("div", { class: "mk-start" },
      ready.length ? h("div", { class: "mk-ready glass" }, h("b", { text: `⏰ ${plural(ready.length, "campaign")} ready to send` }),
        ...ready.map(c => h("button", { class: "mk-ready-r", onclick: () => ctx.openCampaign(c.id) }, h("span", { text: c.channel === "sms" ? "💬" : "✉️" }), h("span", { class: "grow", text: c.name || "Untitled campaign" }), h("small", { text: "was due " + when(c.scheduledAt) }), h("span", { class: "mk-go", text: "Send →" })))) : null,
      h("div", { class: "mk-kpis" },
        kpi("🎯", num(mySegments().length + READY.length), "Segments", `${READY.length} ready-made`, "segments"),
        kpi("📣", num(thisMonth), "Campaigns this month", `${num(cs.length)} in total`, "campaigns"),
        kpi("👥", num(idx.size), "People reached", `${plural(sent.length, "campaign")} sent`, "recipients"),
        kpi("📬", withOpen ? pct(openSum, withOpen) : "—", "Open rate", withOpen ? `from ${num(sentSum)} sent` : "Add opens to sent campaigns", "campaigns")),
      h("div", { class: "mk-start-grid" },
        h("div", { class: "mk-card glass" }, h("div", { class: "mk-sec-h" }, h("h3", { text: "Recent campaigns" }), cs.length ? h("button", { class: "chip-btn", text: "See all", onclick: () => ctx.tab("campaigns") }) : null),
          recent.length ? h("div", { class: "mk-mini-list" }, ...recent.map(c => h("button", { class: "mk-mini", onclick: () => ctx.openCampaign(c.id) },
            h("span", { class: "mk-ch-ic", text: c.channel === "sms" ? "💬" : "✉️" }), h("span", { class: "mk-mini-t" }, h("b", { text: c.name || "Untitled campaign" }), h("small", { text: segNameOf(c) + (c.sentAt ? " · " + dayOf(c.sentAt) : "") })), statusTag(c))))
            : h("div", { class: "mk-card-empty" }, h("span", { text: "No campaigns yet. Your first one takes about five minutes." }), canEdit() ? h("button", { class: "btn primary", text: "Create a campaign", onclick: e => newMenu(e.currentTarget, ctx) }) : null)),
        h("div", { class: "mk-card glass" }, h("h3", { text: "Quick actions" }),
          h("div", { class: "mk-qas" },
            qa("✉️", "Email campaign", editOnly(() => ctx.newCampaign({ channel: "email" }))), qa("💬", "SMS campaign", editOnly(() => ctx.newCampaign({ channel: "sms" }))),
            qa("🎯", "New segment", editOnly(() => editSegment(null, () => ctx.redraw()))), qa("🎨", "New template", editOnly(() => ctx.openTemplate(null, { channel: "email" }))),
            qa("🚫", "Black list", () => ctx.tab("blacklist")), qa("⚙️", "Sender settings", () => ctx.tab("settings"))))),
      howItWorks());
  }

  function campaignsTab(ctx) {
    const st = ctx.st, list = h("div", { class: "mk-clist" }), memo = new Map();
    const count = c => {
      if (c.status === "sent") return c.recipientsCount ?? c.stats?.sent ?? (c.recipients || []).length;
      const sg = segById(c.segment); if (!sg) return null;
      const k = sg.id + "|" + (c.channel || "email"); if (!memo.has(k)) memo.set(k, audience(sg, c.channel).list.length); return memo.get(k);
    };
    const dateOf = c => c.status === "sent" ? "Sent " + dayOf(c.sentAt) : c.status === "scheduled" ? (isReady(c) ? "Was due " : "") + when(c.scheduledAt) : "Edited " + UI.timeAgo(c.at || Date.now());
    const statsOf = c => {
      if (c.status !== "sent") return "—";
      const s = c.stats || {}, n = +s.sent || 0;
      return [s.opened != null ? pct(s.opened, n) + " opened" : null, s.clicked != null ? pct(s.clicked, n) + " clicked" : null, s.replied != null ? num(s.replied) + " replied" : null].filter(Boolean).join(" · ") || "No stats yet";
    };
    const rowMenu = (anchor, c) => UI.menu(anchor, [
      { label: "Open", icon: "arrow", onClick: () => ctx.openCampaign(c.id) },
      canEdit() ? { label: "Duplicate", icon: "copy", onClick: async () => { await duplicateCampaign(c); UI.toast("Campaign duplicated"); } } : null,
      canEdit() ? { label: "Delete", icon: "trash", danger: true, onClick: async () => { if (await UI.confirm(`Delete the campaign “${c.name || "Untitled"}”?`)) { await Data.remove("campaigns", c.id); ls.del("done-" + c.id); UI.toast("Campaign deleted"); } } } : null,
    ], { align: "end" });
    function fill() {
      const q = low(st.q);
      const rows = campaigns().filter(c => (st.cf === "all" || (st.cf === "ready" ? isReady(c) : c.status === st.cf)) && (st.cc === "all" || (c.channel || "email") === st.cc)
        && (!q || low([c.name, c.subject, c.sms, segNameOf(c)].join(" ")).includes(q)))
        .sort((a, b) => (isReady(b) - isReady(a)) || ((b.sentAt || b.scheduledAt || b.at || 0) - (a.sentAt || a.scheduledAt || a.at || 0)));
      if (!rows.length) return list.replaceChildren(campaigns().length ? Apps.empty("🔍", "No campaigns match.") :
        Apps.empty("📣", "No campaigns yet. Build an audience, write one message, and send it your way.", canEdit() ? h("button", { class: "btn primary", text: "＋ New campaign", onclick: e => newMenu(e.currentTarget, ctx) }) : null));
      list.replaceChildren(h("div", { class: "mk-crow head" }, h("span"), h("span", { text: "Campaign" }), h("span", { text: "Status" }), h("span", { text: "Audience" }), h("span", { class: "r", text: "People" }), h("span", { text: "Date" }), h("span", { text: "Results" }), h("span")),
        ...rows.map((c, i) => { const n = count(c); return h("div", { class: "mk-crow" + (isReady(c) ? " ready" : ""), style: { animationDelay: Math.min(i, 20) * 18 + "ms" }, onclick: () => ctx.openCampaign(c.id) },
          h("span", { class: "mk-ch-ic", text: c.channel === "sms" ? "💬" : "✉️" }),
          h("span", { class: "mk-cname" }, h("b", { text: c.name || "Untitled campaign" }), h("small", { text: c.channel === "sms" ? (c.sms || "No message yet").slice(0, 90) : c.subject || "No subject yet" })),
          h("span", null, statusTag(c)), h("span", { class: "mk-cseg", text: segNameOf(c) }), h("span", { class: "mk-cnum r", text: n == null ? "—" : num(n) }),
          h("span", { class: "mk-cdate", text: dateOf(c) }), h("span", { class: "mk-cstats", text: statsOf(c) }),
          h("button", { class: "icon-btn xs", title: "More", html: UI.icon("dots"), onclick: e => { e.stopPropagation(); rowMenu(e.currentTarget, c); } })); }));
    }
    const ready = campaigns().filter(isReady).length;
    const search = h("input", { class: "app-search", placeholder: "Search campaigns…", value: st.q, oninput: () => { st.q = search.value; fill(); } });
    fill();
    return h("div", null, h("div", { class: "app-toolbar mk-toolbar" }, search,
      seg([["all", "All"], ["draft", "Drafts"], ["scheduled", "Scheduled"], ...(ready ? [["ready", `Ready (${ready})`]] : []), ["sent", "Sent"]], st.cf, v => { st.cf = v; fill(); }),
      seg([["all", "Any channel"], ["email", "✉️ Email"], ["sms", "💬 SMS"]], st.cc, v => { st.cc = v; fill(); }),
      h("span", { class: "grow" }), canEdit() ? h("button", { class: "btn primary", text: "＋ New campaign", onclick: e => newMenu(e.currentTarget, ctx) }) : null), list);
  }

  function segmentsTab(ctx) {
    const card = (sg, i) => {
      const ae = audience(sg, "email"), as = audience(sg, "sms");
      const items = () => [
        { label: sg.ready || !canEdit() ? "View rules" : "Edit", icon: "page", onClick: () => editSegment(sg, () => ctx.redraw()) },
        canEdit() ? { label: "New campaign", iconHtml: "📣", onClick: () => ctx.newCampaign({ segment: sg.id, channel: ae.list.length || !as.list.length ? "email" : "sms" }) } : null,
        canEdit() ? { label: "Duplicate", icon: "copy", onClick: async () => { const r = clone(sg); delete r.id; delete r.ready; delete r.icon; delete r.at; delete r.by; r.name = sg.name + " (copy)"; r.updatedAt = Date.now(); await Data.add("segments", r); UI.toast("Segment duplicated"); } } : null,
        !sg.ready && canEdit() ? { label: "Delete", icon: "trash", danger: true, onClick: async () => { if (await UI.confirm(`Delete the segment “${sg.name}”?`)) { await Data.remove("segments", sg.id); UI.toast("Segment deleted"); } } } : null];
      return h("div", { class: "mk-scard glass", style: { animationDelay: Math.min(i, 20) * 25 + "ms" }, onclick: e => { if (!e.target.closest("button")) editSegment(sg, () => ctx.redraw()); } },
        h("div", { class: "mk-sc-top" }, h("span", { class: "mk-sc-ic", text: sg.icon || SRC[sg.source]?.[0] || "🎯" }),
          h("div", { class: "mk-sc-t" }, h("b", { text: sg.name || "Untitled segment" }), h("small", { text: (SRC[sg.source] || SRC.contacts)[1] + (sg.ready ? " · ready-made" : "") })),
          h("button", { class: "icon-btn xs", title: "More", html: UI.icon("dots"), onclick: e => { e.stopPropagation(); UI.menu(e.currentTarget, items(), { align: "end" }); } })),
        h("div", { class: "mk-sc-rules", text: rulesSummary(sg) }),
        h("div", { class: "mk-sc-counts" }, h("span", null, h("b", { text: num(ae.list.length) }), " with email"), h("span", null, h("b", { text: num(as.list.length) }), " with phone"),
          ae.blocked.length || as.blocked.length ? h("span", { class: "mk-sc-bl", text: `🚫 ${num(new Set([...ae.blocked, ...as.blocked].map(p => p.key)).size)} blocked` }) : null),
        h("div", { class: "mk-sc-foot" }, h("small", { text: sg.ready ? "Always up to date" : sg.updatedAt ? "Updated " + UI.timeAgo(sg.updatedAt) : "" }), h("span", { class: "grow" }),
          canEdit() ? h("button", { class: "chip-btn", text: "📣 Use", onclick: () => ctx.newCampaign({ segment: sg.id, channel: ae.list.length || !as.list.length ? "email" : "sms" }) }) : null));
    };
    const mine = mySegments();
    return h("div", null,
      h("div", { class: "app-toolbar mk-toolbar" }, h("p", { class: "mk-hint grow", text: "Segments are live lists from your CRM: counts update as contacts, leads and companies change." }),
        canEdit() ? h("button", { class: "btn primary", text: "＋ New segment", onclick: () => editSegment(null, () => ctx.redraw()) }) : null),
      h("div", { class: "td-sec", text: "Ready-made" }), h("div", { class: "mk-sgrid" }, ...READY.map(card)),
      h("div", { class: "td-sec", text: "My segments" }),
      mine.length ? h("div", { class: "mk-sgrid" }, ...mine.map(card)) : h("div", { class: "mk-card-empty glass" }, h("span", { text: "🎯 Build your own audience with rules, like “Leads from the website this month” or “Clients in retail”." }),
        canEdit() ? h("button", { class: "btn primary", text: "Create a segment", onclick: () => editSegment(null, () => ctx.redraw()) }) : null));
  }

  function templatesTab(ctx) {
    const st = ctx.st, f = st.tf;
    const ok = t => f === "all" || (t.channel || "email") === f;
    const mine = myTemplates().filter(ok), base = starters().filter(ok);
    const mineItems = t => () => [
      { label: "Edit", icon: "page", onClick: () => ctx.openTemplate(t) },
      canEdit() ? { label: "Use in a campaign", iconHtml: "📣", onClick: () => ctx.newCampaign({ channel: t.channel || "email", template: t.id }) } : null,
      canEdit() ? { label: "Duplicate", icon: "copy", onClick: async () => { await saveTemplate({ ...clone(t), id: "t" + uid(), name: (t.name || "Template") + " (copy)", by: me() }); UI.toast("Template duplicated"); } } : null,
      canEdit() ? { label: "Delete", icon: "trash", danger: true, onClick: async () => { if (await UI.confirm(`Delete the template “${t.name}”?`)) { await deleteTemplate(t.id); UI.toast("Template deleted"); } } } : null];
    const starterItems = t => () => [
      canEdit() ? { label: "Use in a campaign", iconHtml: "📣", onClick: () => ctx.newCampaign({ channel: t.channel, template: t.id }) } : null,
      { label: canEdit() ? "Customize a copy" : "Preview", icon: "page", onClick: () => ctx.openTemplate(t) }];
    const newT = e => UI.menu(e.currentTarget, [{ label: "Email template", iconHtml: "✉️", onClick: () => ctx.openTemplate(null, { channel: "email" }) }, { label: "SMS template", iconHtml: "💬", onClick: () => ctx.openTemplate(null, { channel: "sms" }) }], { align: "end" });
    return h("div", null,
      h("div", { class: "app-toolbar mk-toolbar" }, seg([["all", "All"], ["email", "✉️ Email"], ["sms", "💬 SMS"]], f, v => { st.tf = v; ctx.redraw(); }), h("span", { class: "grow" }),
        canEdit() ? h("button", { class: "btn primary", text: "＋ New template", onclick: newT }) : null),
      h("div", { class: "td-sec", text: "My templates" }),
      mine.length ? h("div", { class: "mk-tgrid" }, ...mine.map(t => tplCard(t, () => ctx.openTemplate(t), mineItems(t))))
        : h("div", { class: "mk-card-empty glass" }, h("span", { text: "🎨 Save emails you send often as templates. Start from a starter below or from scratch." }), canEdit() ? h("button", { class: "btn primary", text: "Create a template", onclick: newT }) : null),
      h("div", { class: "td-sec", text: "Starter templates" }),
      h("div", { class: "mk-tgrid" }, ...base.map(t => tplCard(t, () => ctx.openTemplate(t), starterItems(t)))));
  }

  function recipientsTab(ctx) {
    const st = ctx.st, list = h("div", { class: "mk-rlist" }), sets = blSets();
    const all = [...recipientsIndex().values()].map(r => {
      const rec = r.col && r.id ? Data.get(r.col, r.id) : null, ok = rec && !rec.deleted;
      const p = ok ? personOf(r.col, rec) : null;
      return { ...r, name: p?.name || r.n || r.email || r.phone || "Someone", email: p?.email || r.email, phone: p?.phone || r.phone, company: p?.company || "", inCRM: !!ok };
    }).sort((a, b) => (b.last?.sentAt || 0) - (a.last?.sentAt || 0));
    function fill() {
      const q = low(st.rq);
      const rows = all.filter(r => (st.rc === "all" || r.channels.has(st.rc)) && (!q || low([r.name, r.email, r.phone, r.company].join(" ")).includes(q)));
      if (!all.length) return list.replaceChildren(Apps.empty("👥", "Nobody reached yet. People show up here once you mark a campaign as sent."));
      if (!rows.length) return list.replaceChildren(Apps.empty("🔍", "Nobody matches."));
      list.replaceChildren(h("div", { class: "mk-rrow head" }, h("span"), h("span", { text: "Person" }), h("span", { text: "Type" }), h("span", { text: "Last campaign" }), h("span", { class: "r", text: "Campaigns" }), h("span")),
        ...rows.slice(0, st.rn).map((r, i) => {
          const bl = isBlocked(sets, r.email, r.phone);
          return h("div", { class: "mk-rrow" + (r.inCRM ? "" : " gone"), style: { animationDelay: Math.min(i, 20) * 15 + "ms" }, onclick: () => r.inCRM ? openCRM(r) : UI.toast("This person was removed from the CRM") },
            h("span", { class: "mk-ini", text: (r.name[0] || "?").toUpperCase(), style: { background: Apps.colorFor(r.key) } }),
            h("span", { class: "mk-prow-t" }, h("b", null, r.name, bl ? tag("Do not contact", "red") : null), h("small", { text: [r.email, r.phone].filter(Boolean).join(" · ") })),
            h("span", { class: "mk-rtype", text: r.col ? cap(SRC[r.col]?.[2] || r.col) : "—" }),
            h("span", { class: "mk-rlast" }, h("span", { class: "tt", text: r.last?.name || "" }), h("small", { text: dayOf(r.last?.sentAt) })),
            h("span", { class: "r mk-rcount", text: num(r.count) }),
            h("button", { class: "icon-btn xs", title: "More", html: UI.icon("dots"), onclick: e => { e.stopPropagation(); UI.menu(e.currentTarget, [
              r.inCRM ? { label: "Open in CRM", icon: "arrow", onClick: () => openCRM(r) } : null,
              r.last ? { label: "Open last campaign", iconHtml: "📣", onClick: () => ctx.openCampaign(r.last.id) } : null,
              canEdit() && !bl ? { label: "Add to black list", iconHtml: "🚫", onClick: async () => { const n = await addToBlacklist([r.email, r.phone].filter(Boolean).map(x => x.includes("@") ? low(x) : x)); UI.toast(n ? `🚫 ${r.name} won't get campaigns any more` : "Already on the black list"); } } : null], { align: "end" }); } }));
        }),
        rows.length > st.rn ? h("button", { class: "chip-btn mk-more-btn", text: `Show more (${num(rows.length - st.rn)})`, onclick: () => { st.rn += 200; fill(); } }) : null);
    }
    const search = h("input", { class: "app-search", placeholder: "Search people…", value: st.rq, oninput: () => { st.rq = search.value; fill(); } });
    fill();
    return h("div", null, h("div", { class: "app-toolbar mk-toolbar" }, search, seg([["all", "All"], ["email", "✉️ Email"], ["sms", "💬 SMS"]], st.rc, v => { st.rc = v; fill(); }), h("span", { class: "grow" }),
      all.length ? h("span", { class: "mk-muted", text: plural(all.length, "person", "people") + " reached" }) : null,
      all.length ? h("button", { class: "btn", text: "Export", onclick: () => download("lumen-recipients.csv", toCsv([["Name", "Email", "Phone", "Type", "Campaigns", "Last campaign", "Last sent"],
        ...all.map(r => [r.name, r.email || "", r.phone || "", r.col ? SRC[r.col]?.[2] || r.col : "", r.count, r.last?.name || "", r.last?.sentAt ? Apps.iso(new Date(r.last.sentAt)) : ""])])) }) : null), list);
  }
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : "";

  function blacklistTab(ctx) {
    const st = ctx.st, list = h("div", { class: "mk-bl" }), entries = blacklist();
    const names = new Map();
    ["contacts", "leads", "companies"].forEach(col => live(col).forEach(r => {
      const p = personOf(col, r);
      if (p.email) names.set(low(p.email), p);
      if (phoneKey(p.phone)) names.set("p" + phoneKey(p.phone), p);
    }));
    async function addFlow() {
      const ta = h("textarea", { class: "menu-input mk-bl-ta", rows: 7, placeholder: "Paste emails or phone numbers: one per line, or separated by commas" });
      const preview = h("small", { class: "mk-muted", text: "" });
      ta.oninput = () => { const n = parseEntries(ta.value).length; preview.textContent = n ? `${plural(n, "entry", "entries")} found` : ""; };
      const ok = h("button", { class: "btn primary", text: "Add to black list" });
      const m = UI.modal("Add to black list", h("div", { class: "mk-bl-add" }, h("p", { class: "mk-hint", text: "People with these emails or numbers never get a campaign, even if a segment includes them." }), ta,
        h("div", { class: "f-actions" }, preview, h("span", { style: { display: "flex", gap: "8px" } }, h("button", { class: "btn", text: "Cancel", onclick: () => m.close() }), ok))));
      m.el.style.width = "520px"; setTimeout(() => ta.focus(), 60);
      ok.onclick = async () => {
        const found = parseEntries(ta.value); if (!found.length) return UI.toast("No emails or phone numbers found");
        const n = await addToBlacklist(found); m.close();
        UI.toast(n ? `🚫 Added ${plural(n, "entry", "entries")}` + (n < found.length ? ` (${found.length - n} already listed)` : "") : "They're all on the list already");
      };
    }
    async function importFlow() {
      const [f] = await Apps.pickFiles(false); if (!f) return;
      if (f.size > 5 * 1048576) return UI.toast("That file is too big. Try a CSV under 5 MB.");
      const found = parseEntries(await f.text()), have = new Set(entries.map(entryKey)), fresh = found.filter(x => !have.has(entryKey(x)));
      if (!found.length) return UI.toast("No emails or phone numbers found in that file");
      if (!fresh.length) return UI.toast("Everyone in that file is already on the list");
      if (!(await UI.confirm(`Add ${plural(fresh.length, "entry", "entries")} from “${f.name}” to the black list? For example: ${fresh.slice(0, 3).join(", ")}${fresh.length > 3 ? "…" : ""}`, "Add them"))) return;
      const n = await addToBlacklist(fresh); UI.toast(`🚫 Added ${plural(n, "entry", "entries")}`);
    }
    function fill() {
      const q = low(st.bq);
      const rows = entries.filter(x => !q || low(x).includes(q) || low(names.get(entryKey(x))?.name).includes(q)).reverse();
      if (!entries.length) return list.replaceChildren(Apps.empty("🚫", "The black list is empty. Add people who asked not to be contacted.", canEdit() ? h("button", { class: "btn primary", text: "Add emails or numbers", onclick: addFlow }) : null));
      if (!rows.length) return list.replaceChildren(Apps.empty("🔍", "Not on the list."));
      list.replaceChildren(...rows.slice(0, st.bn).map((x, i) => {
        const p = names.get(entryKey(x));
        return h("div", { class: "mk-blrow", style: { animationDelay: Math.min(i, 20) * 12 + "ms" } }, h("span", { class: "mk-bl-ic", text: x.includes("@") ? "✉️" : "📱" }),
          h("span", { class: "mk-prow-t" }, h("b", { text: x }), p ? h("small", null, h("a", { class: "mk-link", text: p.name + " · " + cap(SRC[p.col][2]), onclick: () => openCRM(p) })) : h("small", { text: "Not in the CRM" })),
          tag("Do not contact", "red"),
          canEdit() ? h("button", { class: "icon-btn xs", title: "Remove from the black list", html: UI.icon("x"), onclick: async () => { await removeFromBlacklist(x); UI.toast(`${x} can get campaigns again`, { label: "Undo", run: () => addToBlacklist([x]) }); } }) : null);
      }), rows.length > st.bn ? h("button", { class: "chip-btn mk-more-btn", text: `Show more (${num(rows.length - st.bn)})`, onclick: () => { st.bn += 300; fill(); } }) : null);
    }
    const search = h("input", { class: "app-search", placeholder: "Search the list…", value: st.bq, oninput: () => { st.bq = search.value; fill(); } });
    fill();
    return h("div", null,
      h("div", { class: "app-toolbar mk-toolbar" }, search, h("span", { class: "mk-muted", text: plural(entries.length, "entry", "entries") }), h("span", { class: "grow" }),
        entries.length ? h("button", { class: "btn", text: "Export", onclick: () => download("lumen-black-list.csv", toCsv([["Email or phone", "CRM name"], ...entries.map(x => [x, names.get(entryKey(x))?.name || ""])])) }) : null,
        canEdit() ? h("button", { class: "btn", text: "Import CSV", onclick: importFlow }) : null,
        canEdit() ? h("button", { class: "btn primary", text: "＋ Add", onclick: addFlow }) : null),
      h("p", { class: "mk-hint", text: "Blacklisted people are never included in a campaign, whatever segment they're in. CRM records stay as they are." }), list);
  }

  function settingsTab(ctx) {
    const st = ctx.st, s = cfg(), ro = !canAdmin();
    const d = st.sd || (st.sd = { from: s.from || "", replyTo: s.replyTo || "", signature: s.signature || "", unsub: s.unsub || "", color: okColor(s.color, "#7c5cff") });
    const field = (key, label, ph, type = "text", help) => {
      const ctl = type === "textarea" ? h("textarea", { class: "menu-input f-ta", rows: 3, placeholder: ph, disabled: ro }) : h("input", { class: "menu-input", type, placeholder: ph, disabled: ro });
      ctl.value = d[key]; ctl.oninput = () => { d[key] = ctl.value; };
      return h("label", { class: "mk-f" }, h("span", { text: label }), ctl, help ? h("small", { class: "mk-muted", text: help }) : null);
    };
    const sw = h("div", { class: "mk-swatches" }, ...COLORS.map(c => h("button", { type: "button", class: "mk-sw" + (d.color === c ? " on" : ""), style: { background: c }, disabled: ro,
      onclick: e => { d.color = c; sw.querySelectorAll(".mk-sw").forEach(x => x.classList.toggle("on", x === e.currentTarget)); } })));
    const save = async () => {
      if (d.replyTo && !isEmail(d.replyTo)) return UI.toast("The reply-to address doesn't look like an email");
      await saveCfg({ from: d.from.trim(), replyTo: d.replyTo.trim(), signature: d.signature.trim(), unsub: d.unsub.trim(), color: d.color });
      st.sd = null; UI.toast("⚙️ Settings saved"); ctx.redraw();
    };
    return h("div", { class: "mk-set-grid" },
      h("div", { class: "mk-card glass mk-set" }, h("h3", { text: "Sender" }),
        ro ? h("div", { class: "mk-note", text: "🔒 Only admins can change these settings." }) : null,
        field("from", "Sender name", Data.me().name || "Your name or company", "text", "Shown in previews and used for {sender}."),
        field("replyTo", "Reply-to email", Data.me().email || "you@company.com", "email", "Where test emails go, and the “To” address of BCC emails."),
        field("signature", "Default footer", "Company name, address or signature", "textarea", "Added to the footer block of new emails."),
        field("unsub", "Unsubscribe text", DEF_UNSUB, "textarea", "The last line of every email footer. Tell people how to opt out."),
        h("div", { class: "mk-f" }, h("span", { text: "Default email color" }), sw),
        ro ? null : h("div", { class: "mk-f-row end" }, h("button", { class: "btn primary", text: "Save settings", onclick: save }))),
      h("div", { class: "mk-set-side" }, howItWorks(),
        h("div", { class: "mk-card glass" }, h("h3", { text: "Good to know" }),
          h("ul", { class: "mk-tips" },
            h("li", { text: "Mail apps cap how many people one email can go to, often 50 to 100 for BCC and around 500 a day for Gmail." }),
            h("li", { text: "Personal emails opened one by one are the most likely to land in the inbox." }),
            h("li", { text: "For big lists, use the CSV with a mail-merge tool such as Gmail mail merge or Mailchimp." }),
            h("li", { text: "Always honor opt-outs: add people to the black list as soon as they ask." })))));
  }

  /* ---------- the app ---------- */
  function render(root, arg) {
    const wrap = h("div", { class: "mk" }); root.append(wrap);
    const st = { tab: ls.get("tab", "start"), view: null, q: "", cf: "all", cc: "all", tf: "all", rq: "", rc: "all", rn: 200, bq: "", bn: 300, sd: null };
    if (!TABS.some(t => t[0] === st.tab)) st.tab = "start";
    let viewCleanup = null, T = 0, armed = false, waitT = 0;
    const ctx = {
      st,
      tab: k => { closeView(); st.tab = k; ls.set("tab", k); draw(); scrollTop(); },
      openCampaign: id => openView({ kind: "campaign", id }),
      newCampaign: preset => { if (!canEdit()) return UI.toast("You can't create campaigns"); openView({ kind: "campaign", id: null, preset }); },
      openTemplate: (tpl, preset) => openView({ kind: "template", tpl, preset }),
      back: tab => { closeView(); if (tab) { st.tab = tab; ls.set("tab", tab); } draw(); scrollTop(); },
      redraw: () => { if (!st.view) draw(); },
    };
    function closeView() { if (viewCleanup) { try { viewCleanup(); } catch (e) { console.warn(e); } viewCleanup = null; } st.view = null; clearTimeout(waitT); }
    function openView(v) { closeView(); UI.closePops(); st.view = v; draw(); scrollTop(); }
    function draw() {
      if (st.view) {
        const v = st.view;
        if (v.drawn) return;
        if (v.kind === "campaign" && v.id && !Data.get("campaigns", v.id)) {
          wrap.replaceChildren(h("div", { class: "app-empty" }, h("div", { class: "ae-ic", text: "📣" }), h("div", { text: "Opening the campaign…" })));
          clearTimeout(waitT); waitT = setTimeout(() => { if (st.view === v && !v.drawn) { UI.toast("That campaign isn't available any more"); ctx.back("campaigns"); } }, 8000);
          return;
        }
        clearTimeout(waitT);
        const out = v.kind === "campaign" ? campaignView(ctx, v.id, v.preset) : templateView(ctx, v.tpl, v.preset);
        v.drawn = true; viewCleanup = out.cleanup; wrap.replaceChildren(out.el);
        return;
      }
      const head = Apps.header("Marketing", "📣", "Email and SMS campaigns for the people in your CRM",
        canEdit() ? h("button", { class: "btn primary", text: "＋ New campaign", onclick: e => newMenu(e.currentTarget, ctx) }) : null);
      const ready = campaigns().filter(isReady).length, bl = blacklist().length;
      const tabs = Apps.tabs(TABS.map(([k, l]) => [k, l + (k === "campaigns" && ready ? ` (${ready})` : k === "blacklist" && bl ? ` (${bl})` : "")]), st.tab, k => { st.tab = k; ls.set("tab", k); body.replaceChildren(tabBody()); });
      const body = h("div", { class: "mk-body" }, tabBody());
      wrap.replaceChildren(head, tabs, body);
      remindTick();
    }
    function tabBody() {
      const fn = { start: startTab, campaigns: campaignsTab, segments: segmentsTab, templates: templatesTab, recipients: recipientsTab, blacklist: blacklistTab, settings: settingsTab }[st.tab] || startTab;
      try { return h("div", { class: "mk-tab mk-anim" }, fn(ctx)); }
      catch (e) { console.error(e); return Apps.empty("⚠️", "Something went wrong showing this tab."); }
    }
    const safeDraw = UI.liveDraw(wrap, draw);
    const queue = () => { if (!armed) return; clearTimeout(T); T = setTimeout(() => { if (!st.view || !st.view.drawn) safeDraw(); }, 90); };

    const m = /^(campaign|new|template):?(.*)$/.exec(arg || "");
    if (TABS.some(t => t[0] === arg)) st.tab = arg;
    else if (m?.[1] === "campaign" && m[2]) st.view = { kind: "campaign", id: m[2] };
    else if (m?.[1] === "new" && canEdit()) st.view = { kind: "campaign", id: null, preset: { channel: m[2] === "sms" ? "sms" : "email" } };
    draw();
    const offs = ["campaigns", "segments", "settings", "contacts", "leads", "companies"].map(col => Data.on(col, queue));
    armed = true;
    const tick = setInterval(() => { if (!st.view) queue(); }, 60000); // "Ready to send" flips on time
    return () => { offs.forEach(f => f()); clearTimeout(T); clearInterval(tick); closeView(); };
  }

  /* ---------- reminders: scheduled campaigns ping their owner at the time, whether or not Marketing is open ---------- */
  const remKey = () => "reminded-" + (window.Cloud?.ws?.id || "local");
  function remindTick() {
    if (!window.Data || !window.Apps?.badge) return;
    if (Apps.can && !Apps.can(APP, "view")) { Apps.badge(APP, 0); return; }
    const now = Date.now(), mine = me();
    let fired; try { fired = JSON.parse(ls.get(remKey(), "{}")) || {}; } catch { fired = {}; }
    let n = 0, changed = false;
    campaigns().forEach(c => {
      if (c.status !== "scheduled" || !c.scheduledAt || c.scheduledAt > now || ownerOf(c) !== mine) return;
      n++;
      const k = c.id + "|" + c.scheduledAt; if (fired[k]) return;
      fired[k] = now; changed = true;
      if (now - c.scheduledAt < 2 * DAY && window.Notify?.alert) Notify.alert({ title: `📣 Time to send “${c.name || "your campaign"}”`, body: `${c.channel === "sms" ? "SMS" : "Email"} · ${segNameOf(c)} · open it to finish sending`,
        link: "#/app/marketing/campaign:" + c.id, icon: "📣", tag: "mk-" + c.id, dedupe: "mk-" + k });
    });
    Apps.badge(APP, n);
    if (changed) { for (const x in fired) if (now - fired[x] > 30 * DAY) delete fired[x]; ls.set(remKey(), JSON.stringify(fired)); }
  }
  const safeTick = () => { try { remindTick(); } catch (e) { console.warn("marketing reminders", e); } };
  setInterval(safeTick, 60000);
  setTimeout(safeTick, 8000);

  Apps.register(APP, { title: "Marketing", icon: "📣", render });
  Apps.Marketing = { audience: (segmentId, channel) => audience(segById(segmentId), channel).list, blacklisted: (email, phone) => isBlocked(blSets(), email, phone), editSegment };
})();
