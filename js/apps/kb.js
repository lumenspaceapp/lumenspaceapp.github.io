/* Knowledge base (Bitrix24 "Knowledge base 2.0"): spaces with nested articles, a clean WYSIWYG editor,
   favorites, drafts, archive, recycle bin, versions, search and templates.
   Collections: kbspaces { name, icon, desc, access, members, color, archived, deleted }
                kbarticles { space, parent, title, icon, body (sanitized HTML), tags, order, versions, favorites,
                             status, deleted, archived, helpful, unhelpful, editedAt, editedBy, editing, mentioned } */
(function () {
  const { h, esc, icon } = UI;
  const SP = "kbspaces", AR = "kbarticles";
  const me = () => Data.me().key;
  const canEdit = () => (Apps.can ? Apps.can("kb", "edit") : true);
  const isAdmin = () => (Apps.isAdmin ? Apps.isAdmin() : true);
  const COLORS = ["#7c5cff", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#64748b"];
  const MIN5 = 5 * 60e3;
  const svgI = d => `<svg class="ico sm" viewBox="0 0 24 24"><path d="${d}"/></svg>`;
  const I = {
    search: svgI("M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3"),
    menu: svgI("M4 6h16M4 12h16M4 18h16"),
    edit: svgI("M4 20h4L19 9l-4-4L4 16zM14 6l4 4"),
    print: svgI("M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"),
    history: svgI("M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3"),
    archive: svgI("M3 5h18v4H3zM5 9v10h14V9M10 13h4"),
    back: svgI("M15 18l-6-6 6-6"),
  };

  /* ---------- per-device memory: expanded rows, last article ---------- */
  const prefKey = () => "lumen-kb-" + (window.Cloud?.ws?.id || "local");
  const prefs = () => { try { return JSON.parse(localStorage.getItem(prefKey())) || {}; } catch { return {}; } };
  const setPref = patch => { try { localStorage.setItem(prefKey(), JSON.stringify({ ...prefs(), ...patch })); } catch {} };
  const isOpen = id => !!(prefs().open || {})[id];
  const setOpen = (id, on) => { const o = { ...(prefs().open || {}) }; if (on) o[id] = 1; else delete o[id]; setPref({ open: o }); };
  const spaceOpen = id => !(prefs().closed || {})[id];
  const setSpaceOpen = (id, on) => { const o = { ...(prefs().closed || {}) }; if (on) delete o[id]; else o[id] = 1; setPref({ closed: o }); };

  /* ---------- HTML sanitizer (used on save, on paste and on render) ---------- */
  const TAGS = new Set(["P", "BR", "H1", "H2", "H3", "STRONG", "EM", "U", "S", "CODE", "PRE", "BLOCKQUOTE", "UL", "OL", "LI", "A", "IMG", "HR",
    "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "DIV", "SPAN", "MARK", "SUB", "SUP"]);
  const RENAME = { B: "STRONG", I: "EM", STRIKE: "S", DEL: "S", INS: "U", H4: "H3", H5: "H3", H6: "H3", KBD: "CODE", SAMP: "CODE", TT: "CODE",
    SECTION: "DIV", ARTICLE: "DIV", HEADER: "DIV", FOOTER: "DIV", MAIN: "DIV", ASIDE: "DIV", FIGURE: "DIV", FIGCAPTION: "P", CAPTION: "P", TFOOT: "TBODY", DT: "P", DD: "P" };
  const DROP = /^(SCRIPT|STYLE|IFRAME|FRAME|FRAMESET|OBJECT|EMBED|APPLET|NOSCRIPT|TEMPLATE|SVG|MATH|HEAD|TITLE|META|LINK|BASE|FORM|INPUT|BUTTON|SELECT|OPTION|TEXTAREA|VIDEO|AUDIO|SOURCE|TRACK|CANVAS|MAP|AREA|DIALOG|PORTAL|XML|O:P|W:.*|V:.*|M:.*)$/i;
  const BLOCKS = /^(P|H1|H2|H3|UL|OL|TABLE|PRE|BLOCKQUOTE|DIV|HR|LI)$/;
  const CLASSES = { DIV: ["kb-callout", "info", "warning", "success", "kb-embed", "kb-toc"], SPAN: ["kb-mention"], A: ["kb-file"], UL: ["kb-check"] };
  const safeHref = u => { u = String(u || "").trim(); return /^(https?:|mailto:|tel:|#)/i.test(u) && !/[\u0000-\u001f]/.test(u) ? u : ""; };
  const safeImg = u => { u = String(u || "").trim(); return /^https:\/\/[^\s"'<>]+$/i.test(u) || (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(u) && u.length < 400000) ? u : ""; };
  const safeId = s => /^[\w-]{4,60}$/.test(String(s || "")) ? String(s) : "";

  function sanitize(html, opts = {}) {
    const src = new DOMParser().parseFromString("<body>" + String(html || "") + "</body>", "text/html").body;
    const out = document.createElement("div");
    walk(src, out, !!opts.paste);
    // drop empty inline wrappers left behind by pasted documents
    out.querySelectorAll("strong:empty, em:empty, u:empty, s:empty, code:empty, mark:empty, sub:empty, sup:empty").forEach(n => n.remove());
    return out.innerHTML.replace(/^(\s|<br>)+|(\s|<br>)+$/g, "");
  }
  function walk(node, out, paste) {
    for (const n of [...node.childNodes]) {
      if (n.nodeType === 3) { out.append(document.createTextNode(n.nodeValue)); continue; }
      if (n.nodeType !== 1) continue; // comments, processing instructions
      let tag = n.tagName.toUpperCase();
      if (DROP.test(tag)) continue;
      const style = n.getAttribute("style") || "";
      if (paste) {
        // Google Docs wraps everything in <b style="font-weight:normal">; Word and Docs use inline styles for formatting
        if (tag === "B" && /font-weight:\s*(normal|400)/i.test(style)) { walk(n, out, paste); continue; }
        if (tag === "SPAN" || tag === "FONT") {
          const chain = [];
          if (/font-weight:\s*(bold|[6-9]00)/i.test(style)) chain.push("strong");
          if (/font-style:\s*italic/i.test(style)) chain.push("em");
          if (/text-decoration[^;]*underline/i.test(style)) chain.push("u");
          if (/text-decoration[^;]*line-through/i.test(style)) chain.push("s");
          if (chain.length) { let w = out; chain.forEach(t => { const e = document.createElement(t); w.append(e); w = e; }); walk(n, w, paste); continue; }
        }
      }
      tag = RENAME[tag] || tag;
      if (!TAGS.has(tag)) { walk(n, out, paste); continue; } // unknown tag: keep its content
      const cls = (n.getAttribute("class") || "").split(/\s+/).filter(c => (CLASSES[tag] || []).includes(c));
      if (tag === "SPAN") {
        const key = n.getAttribute("data-key");
        if (cls.includes("kb-mention") && key && !paste) { out.append(h("span", { class: "kb-mention", dataset: { key: key.slice(0, 120) }, text: n.textContent.slice(0, 80) })); }
        else walk(n, out, paste);
        continue;
      }
      if (tag === "DIV") {
        if (cls.includes("kb-embed")) { const s = n.getAttribute("data-src"); if (embedOk(s) && !paste) out.append(h("div", { class: "kb-embed", dataset: { src: s } })); continue; }
        if (cls.includes("kb-toc")) { if (!paste) out.append(h("div", { class: "kb-toc" })); continue; }
        if (cls.includes("kb-callout")) {
          const kind = ["warning", "success"].find(k => cls.includes(k)) || "info";
          const el = h("div", { class: "kb-callout " + kind }); walk(n, el, paste); out.append(el); continue;
        }
        // a plain div: a paragraph when it only holds inline content, otherwise just its content
        if ([...n.children].some(c => BLOCKS.test(RENAME[c.tagName] || c.tagName))) { walk(n, out, paste); continue; }
        tag = "P"; cls.length = 0;
      }
      const el = document.createElement(tag);
      if (tag === "A") {
        const href = safeHref(n.getAttribute("href")), fid = safeId(n.getAttribute("data-file"));
        if (cls.includes("kb-file") && fid && !paste) {
          el.className = "kb-file"; el.dataset.file = fid;
          el.dataset.type = String(n.getAttribute("data-type") || "").slice(0, 100);
          el.dataset.size = String(+n.getAttribute("data-size") || 0);
          el.textContent = n.textContent.slice(0, 200); out.append(el); continue;
        }
        if (!href) { walk(n, out, paste); continue; }
        el.setAttribute("href", href);
      } else if (tag === "IMG") {
        const fid = safeId(n.getAttribute("data-file")), s = safeImg(n.getAttribute("src"));
        if (fid && (!paste || window.Data?.get("files", fid))) el.dataset.file = fid; // images copied between articles keep their file
        else if (s && !(paste && s.startsWith("data:"))) el.setAttribute("src", s);
        else continue;
        const alt = n.getAttribute("alt"); if (alt) el.setAttribute("alt", alt.slice(0, 200));
        const w = style.match(/(?:^|;)\s*width:\s*(\d{1,3})%/i); if (w && +w[1] >= 10 && +w[1] <= 100) el.style.width = w[1] + "%";
        out.append(el); continue;
      } else if (tag === "LI") {
        const c = n.getAttribute("data-checked"); if (c === "true" || c === "false") el.dataset.checked = c;
      } else if (tag === "TD" || tag === "TH") {
        ["colspan", "rowspan"].forEach(k => { const v = +n.getAttribute(k); if (v > 1 && v <= 20) el.setAttribute(k, v); });
      }
      if (cls.length) el.className = cls.join(" ");
      out.append(el);
      if (tag !== "BR" && tag !== "HR") walk(n, el, paste);
    }
  }

  /* ---------- embeds: YouTube, Loom, Google Docs, Figma only ---------- */
  const EMBED_HOSTS = ["www.youtube-nocookie.com", "www.youtube.com", "www.loom.com", "docs.google.com", "www.figma.com"];
  function embedOk(src) {
    try { const u = new URL(src); return u.protocol === "https:" && EMBED_HOSTS.includes(u.hostname); } catch { return false; }
  }
  function toEmbed(raw) {
    let u; try { u = new URL(String(raw || "").trim()); } catch { return null; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname.replace(/^www\.|^m\./, ""), path = u.pathname;
    if (host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
      const id = host === "youtu.be" ? path.slice(1) : u.searchParams.get("v") || (path.match(/^\/(?:embed|shorts|live)\/([\w-]+)/) || [])[1];
      return /^[\w-]{6,20}$/.test(id || "") ? { src: "https://www.youtube-nocookie.com/embed/" + id, kind: "YouTube" } : null;
    }
    if (host === "loom.com") { const id = (path.match(/^\/(?:share|embed)\/([\w-]+)/) || [])[1]; return id ? { src: "https://www.loom.com/embed/" + id, kind: "Loom" } : null; }
    if (host === "docs.google.com") {
      const m = path.match(/^\/(document|spreadsheets|presentation|forms)\/d\/(e\/)?([\w-]+)/);
      if (!m) return null;
      if (m[1] === "forms") return { src: `https://docs.google.com/forms/d/${m[2] || ""}${m[3]}/viewform?embedded=true`, kind: "Google Forms" };
      if (m[2]) return { src: `https://docs.google.com/${m[1]}/d/e/${m[3]}/${m[1] === "presentation" ? "embed" : "pubhtml"}`, kind: "Google Docs" };
      return { src: `https://docs.google.com/${m[1]}/d/${m[3]}/preview`, kind: "Google Docs" };
    }
    if (host === "figma.com" && /^\/(file|design|proto|board|slides)\//.test(path)) return { src: "https://www.figma.com/embed?embed_host=lumen&url=" + encodeURIComponent(u.href), kind: "Figma" };
    return null;
  }
  const embedKind = src => { try { const hst = new URL(src).hostname; return /youtube/.test(hst) ? "YouTube" : /loom/.test(hst) ? "Loom" : /figma/.test(hst) ? "Figma" : "Google Docs"; } catch { return ""; } };

  /* ---------- text helpers ---------- */
  function htmlText(html) {
    const s = String(html || "").replace(/<\/(p|h\d|li|div|td|th|pre|blockquote)>|<br\s*\/?>/gi, " $&");
    return (new DOMParser().parseFromString(s, "text/html").body.textContent || "").replace(/\s+/g, " ").trim();
  }
  const txtCache = new Map();
  function plain(a) {
    const k = a.id + ":" + (a.editedAt || a.at || 0) + ":" + String(a.body || "").length;
    let c = txtCache.get(a.id);
    if (!c || c.k !== k) { c = { k, t: htmlText(a.body) }; txtCache.set(a.id, c); }
    return c.t;
  }
  function hl(raw, terms) {
    raw = String(raw || ""); const low = raw.toLowerCase(), marks = [];
    terms.forEach(t => { let i = 0; while (t && (i = low.indexOf(t, i)) !== -1) { marks.push([i, i + t.length]); i += t.length; } });
    marks.sort((a, b) => a[0] - b[0]);
    let out = "", pos = 0;
    for (const [s, e] of marks) { if (s < pos) continue; out += esc(raw.slice(pos, s)) + "<mark>" + esc(raw.slice(s, e)) + "</mark>"; pos = e; }
    return out + esc(raw.slice(pos));
  }
  function snippet(text, terms) {
    const low = text.toLowerCase();
    const i = Math.min(...terms.map(t => { const x = low.indexOf(t); return x < 0 ? Infinity : x; }));
    if (!isFinite(i)) return text.slice(0, 160) + (text.length > 160 ? "…" : "");
    const s = Math.max(0, i - 70), e = Math.min(text.length, i + 120);
    return (s ? "…" : "") + text.slice(s, e) + (e < text.length ? "…" : "");
  }
  const mentionKeys = html => [...new DOMParser().parseFromString(String(html || ""), "text/html").querySelectorAll("span.kb-mention[data-key]")].map(s => s.dataset.key);
  const words = html => htmlText(html).toLowerCase().split(/\s+/).filter(Boolean);
  // is the new content different enough from the old one to keep a version?
  function meaningful(oldA, v) {
    const ow = words(oldA.body);
    if (!ow.length && !/<(img|table|div)/i.test(oldA.body || "")) return false;
    if ((oldA.title || "") !== (v.title || "")) return true;
    const cnt = {}; ow.forEach(w => (cnt[w] = (cnt[w] || 0) + 1));
    let diff = 0; words(v.body).forEach(w => { if (cnt[w]) cnt[w]--; else diff++; });
    diff += Object.values(cnt).reduce((s, n) => s + n, 0);
    const tags = s => (String(s || "").match(/<(img|table|hr|div)/gi) || []).length;
    return diff >= 3 || tags(oldA.body) !== tags(v.body);
  }
  function trimVersions(vers, body) {
    vers = vers.slice(-10);
    while (vers.length > 1 && JSON.stringify(vers).length + String(body || "").length > 800000) vers = vers.slice(1);
    return vers;
  }

  /* ---------- model ---------- */
  const canSeeSpace = s => !!s && (s.access !== "members" || (s.members || []).includes(me()) || s.by === me() || isAdmin());
  const spaceOk = s => canSeeSpace(s) && !s.deleted;
  const liveSpace = s => spaceOk(s) && !s.archived;
  const canManageSpace = s => canEdit() && (!s || s.by === me() || isAdmin() || (s.members || []).includes(me()));
  const spaces = () => Data.list(SP).filter(liveSpace).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name || "").localeCompare(String(b.name || "")));
  const draftOk = a => (a.status || "published") !== "draft" || a.by === me();
  const artOk = a => !!a && draftOk(a) && spaceOk(Data.get(SP, a.space));
  const liveArt = a => artOk(a) && !a.deleted && !a.archived && !Data.get(SP, a.space).archived;
  const ord = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.at || 0) - (b.at || 0);
  let _idx = null;
  function idx() {
    if (_idx) return _idx;
    const live = Data.list(AR).filter(liveArt), ids = new Set(live.map(a => a.id)), kidsMap = {};
    live.forEach(a => { const k = a.parent && ids.has(a.parent) && a.parent !== a.id ? a.parent : "root:" + a.space; (kidsMap[k] ||= []).push(a); });
    Object.values(kidsMap).forEach(l => l.sort(ord));
    return (_idx = { live, ids, kidsMap });
  }
  const kidsOf = (spaceId, parentId) => idx().kidsMap[parentId || "root:" + spaceId] || [];
  const effParent = a => (a.parent && idx().ids.has(a.parent) ? a.parent : null);
  function flatten(spaceId) {
    const out = [], seen = new Set();
    const walkT = (pid) => kidsOf(spaceId, pid).forEach(a => { if (seen.has(a.id)) return; seen.add(a.id); out.push(a); walkT(a.id); });
    walkT(null); return out;
  }
  function subtree(id) {
    const all = Data.list(AR), out = [], seen = new Set([id]);
    const walkS = pid => all.forEach(a => { if (a.parent === pid && !seen.has(a.id)) { seen.add(a.id); out.push(a); walkS(a.id); } });
    walkS(id); return out;
  }
  function ancestors(a) {
    const out = [], seen = new Set([a.id]);
    let p = a.parent && Data.get(AR, a.parent);
    while (p && !seen.has(p.id) && p.space === a.space) { seen.add(p.id); out.unshift(p); p = p.parent && Data.get(AR, p.parent); }
    return out;
  }
  const linkFor = id => location.href.split("#")[0] + "#/app/kb/a:" + id;
  const copy = (text, msg = "🔗 Link copied") => navigator.clipboard?.writeText(text).then(() => UI.toast(msg), () => UI.toast(text));
  const tagsOf = list => [...new Set(list.flatMap(a => a.tags || []))].sort((a, b) => a.localeCompare(b));
  const isFav = a => (a.favorites || []).includes(me());
  const toggleFav = a => { const on = !isFav(a); Data.arr(AR, a.id, "favorites", me(), on); UI.toast(on ? "⭐ Added to favorites" : "Removed from favorites"); };
  const readMins = a => Math.max(1, Math.round(plain(a).split(/\s+/).filter(Boolean).length / 200));

  /* ---------- templates ---------- */
  const check = items => `<ul class="kb-check">${items.map(t => `<li data-checked="false">${t}</li>`).join("")}</ul>`;
  const TEMPLATES = [
    { id: "blank", icon: "📄", name: "Blank", desc: "Start from an empty page", title: "", body: "<p><br></p>" },
    { id: "howto", icon: "🧭", name: "How-to guide", desc: "Step-by-step instructions", title: "How to …",
      body: `<p>Explain in one or two sentences what this guide helps people do.</p><div class="kb-callout info"><p><strong>Before you start:</strong> list what people need (access, tools, time).</p></div><h2>Steps</h2><ol><li>First step</li><li>Second step</li><li>Third step</li></ol><h2>Tips</h2><ul><li>A useful tip</li></ul><h2>Troubleshooting</h2><p><strong>Problem:</strong> describe it. <strong>Fix:</strong> how to solve it.</p><h2>Related</h2><p>Links to related articles.</p>` },
    { id: "meeting", icon: "🗒️", name: "Meeting notes", desc: "Agenda, notes, decisions and actions", title: "Meeting notes · " + new Date().toLocaleDateString(),
      body: `<p><strong>Date:</strong> ${new Date().toLocaleDateString()} · <strong>Attendees:</strong> @</p><h2>Agenda</h2><ol><li>Topic</li><li>Topic</li></ol><h2>Notes</h2><p><br></p><h2>Decisions</h2><ul><li>Decision</li></ul><h2>Action items</h2>${check(["Action · owner · due date", "Action · owner · due date"])}` },
    { id: "onboarding", icon: "🚀", name: "Onboarding checklist", desc: "Help a new teammate settle in", title: "Onboarding checklist",
      body: `<div class="kb-callout success"><p>Welcome aboard! Work through this list during your first weeks. Ask your buddy if anything is unclear.</p></div><h2>Day one</h2>${check(["Sign in to Lumen and set your avatar", "Meet your manager and buddy", "Read the company handbook"])}<h2>First week</h2>${check(["Set up your tools and accounts", "Join your team's channels", "Shadow a teammate"])}<h2>First month</h2>${check(["Ship your first piece of work", "Have a check-in with your manager"])}<h2>Who to ask</h2><table><tbody><tr><th>Topic</th><th>Person</th></tr><tr><td>IT and accounts</td><td><br></td></tr><tr><td>HR and payroll</td><td><br></td></tr></tbody></table>` },
    { id: "policy", icon: "📜", name: "Policy", desc: "Rules everyone should follow", title: "… policy",
      body: `<div class="kb-toc"></div><h2>Purpose</h2><p>Why this policy exists.</p><h2>Scope</h2><p>Who and what it applies to.</p><h2>Policy</h2><p>The rules, in plain words.</p><h2>Responsibilities</h2><ul><li><strong>Employees:</strong> …</li><li><strong>Managers:</strong> …</li></ul><h2>Exceptions</h2><p>How to ask for an exception.</p><div class="kb-callout warning"><p>Breaking this policy may lead to disciplinary action.</p></div><h2>Review history</h2><table><tbody><tr><th>Date</th><th>Change</th><th>Approved by</th></tr><tr><td>${new Date().toLocaleDateString()}</td><td>First version</td><td><br></td></tr></tbody></table>` },
    { id: "faq", icon: "❓", name: "FAQ", desc: "Common questions and answers", title: "Frequently asked questions",
      body: `<div class="kb-toc"></div><h3>What is this about?</h3><p>Answer.</p><h3>Who can I contact?</h3><p>Answer.</p><h3>Where can I find more?</h3><p>Answer.</p>` },
    { id: "spec", icon: "🧩", name: "Product spec", desc: "Problem, goals, requirements, launch", title: "Product spec: …",
      body: `<div class="kb-toc"></div><h2>Summary</h2><p>One paragraph describing the feature.</p><h2>Problem</h2><p>Who has the problem and why it matters.</p><h2>Goals</h2><ul><li>Goal</li></ul><h2>Non-goals</h2><ul><li>Out of scope</li></ul><h2>Requirements</h2><table><tbody><tr><th>#</th><th>Requirement</th><th>Priority</th></tr><tr><td>1</td><td><br></td><td>Must have</td></tr><tr><td>2</td><td><br></td><td>Nice to have</td></tr></tbody></table><h2>Design</h2><p>Mockups, flows and embeds.</p><h2>Open questions</h2>${check(["Question"])}<h2>Launch plan</h2><p>Milestones and dates.</p>` },
  ];

  async function sampleSpace() {
    const sid = await Data.add(SP, { name: "Company handbook", icon: "📘", color: "#3b82f6", desc: "Everything a new teammate needs to know: how we work, time off and the tools we use.", access: "all", members: [], archived: false });
    const base = { space: sid, tags: [], versions: [], favorites: [], status: "published", deleted: false, editedAt: Date.now(), editedBy: me() };
    const welcome = await Data.add(AR, { ...base, parent: null, order: 0, icon: "👋", title: "Welcome to the team", tags: ["onboarding"],
      body: `<p>We're glad you're here! This handbook explains how we work together. Start with this page, then read the others in order.</p><div class="kb-callout info"><p>Something missing or out of date? Click <strong>Edit</strong> and fix it: everyone can improve this handbook.</p></div><h2>Our values</h2><ul><li><strong>Be kind.</strong> Assume good intent and help each other.</li><li><strong>Keep it simple.</strong> Clear beats clever.</li><li><strong>Own it.</strong> If you see a problem, raise it or fix it.</li></ul><h2>Your first week</h2><ul class="kb-check"><li data-checked="false">Set up your profile and avatar</li><li data-checked="false">Say hello in the general chat</li><li data-checked="false">Read “How we work”</li></ul>` });
    const how = await Data.add(AR, { ...base, parent: null, order: 1, icon: "🤝", title: "How we work", tags: ["process"],
      body: `<div class="kb-toc"></div><h2>Working hours</h2><p>Core hours are 10:00 to 16:00 in your time zone. Outside them, work when it suits you and your team.</p><h2>Communication</h2><ul><li><strong>Chat</strong> for quick questions.</li><li><strong>Tasks</strong> for anything with an owner and a deadline.</li><li><strong>Knowledge base</strong> for answers people will need again.</li></ul><h2>Meetings</h2><p>Every meeting has an agenda and notes. No agenda, no meeting.</p><blockquote><p>Write things down. Future you will thank you.</p></blockquote>` });
    await Data.add(AR, { ...base, parent: how, order: 0, icon: "🌴", title: "Time off and holidays", tags: ["hr", "policy"],
      body: `<p>Everyone gets <strong>25 days</strong> of paid time off per year, plus public holidays.</p><h2>How to request time off</h2><ol><li>Open <strong>Company → Absences</strong>.</li><li>Choose the dates and type of leave.</li><li>Your manager approves the request.</li></ol><div class="kb-callout warning"><p>Please request leave of more than 3 days at least two weeks in advance.</p></div><h2>Sick days</h2><p>Feel unwell? Rest, and let your manager know as early as you can.</p>` });
    await Data.add(AR, { ...base, parent: null, order: 2, icon: "🛠️", title: "Tools and accounts", tags: ["onboarding", "it"],
      body: `<p>These are the tools we use every day.</p><table><tbody><tr><th>Tool</th><th>What for</th><th>Who sets it up</th></tr><tr><td>Lumen</td><td>Chat, tasks, calendar, knowledge base</td><td>Your manager</td></tr><tr><td>Email</td><td>Talking to clients</td><td>IT</td></tr><tr><td>Password manager</td><td>Storing shared passwords safely</td><td>IT</td></tr></tbody></table><h2>Security basics</h2><ul><li>Turn on two-step verification everywhere.</li><li>Never share passwords in chat.</li><li>Lock your screen when you step away.</li></ul>` });
    setSpaceOpen(sid, true); setOpen(how, true);
    UI.toast("📘 Sample space created");
    return { sid, welcome };
  }

  /* ---------- hydration: turn stored HTML into live blocks (images, embeds, contents, files) ---------- */
  function scrollToEl(el) {
    const sc = el.closest(".kb-scroll");
    if (!sc) return el.scrollIntoView({ behavior: "smooth", block: "start" });
    sc.scrollTo({ top: sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 16, behavior: "smooth" });
  }
  function headingsOf(root) { return [...root.querySelectorAll("h1, h2, h3")].filter(x => !x.closest(".kb-toc") && x.textContent.trim()); }
  function fillToc(div, root, edit) {
    const hs = headingsOf(root);
    hs.forEach((x, i) => { x.id = "kb-h-" + i; });
    const min = Math.min(...hs.map(x => +x.tagName[1]), 3);
    div.replaceChildren(h("div", { class: "kb-toc-t", text: "Contents" }),
      hs.length ? h("div", { class: "kb-toc-l" }, ...hs.map(x => h("a", { class: "lv" + (+x.tagName[1] - min), href: "#", text: x.textContent, onclick: e => { e.preventDefault(); scrollToEl(x); } })))
        : h("div", { class: "kb-toc-e", text: "Add headings and they'll show up here." }),
      edit ? h("button", { class: "kb-ui kb-x", type: "button", title: "Remove", text: "×" }) : null);
    if (edit) div.setAttribute("contenteditable", "false");
  }
  function fillEmbed(div, edit) {
    const src = div.dataset.src;
    div.replaceChildren(embedOk(src)
      ? h("iframe", { src, loading: "lazy", allowfullscreen: true, allow: "fullscreen; picture-in-picture; clipboard-write; encrypted-media", referrerpolicy: "strict-origin-when-cross-origin",
        sandbox: "allow-scripts allow-same-origin allow-popups allow-presentation allow-forms", title: embedKind(src) })
      : h("div", { class: "kb-embed-bad", text: "This embed isn't supported" }),
      edit ? h("span", { class: "kb-ui kb-embed-tag", text: embedKind(src) }) : null,
      edit ? h("button", { class: "kb-ui kb-x", type: "button", title: "Remove", text: "×" }) : null);
    if (edit) div.setAttribute("contenteditable", "false");
  }
  function hydrate(root, mode = "read") {
    const edit = mode === "edit";
    root.querySelectorAll("img[data-file]").forEach(img => {
      const f = Data.get("files", img.dataset.file);
      if (f?.data) { img.src = f.data; img.classList.remove("kb-missing"); } else img.classList.add("kb-missing");
    });
    root.querySelectorAll(".kb-embed").forEach(d => fillEmbed(d, edit));
    root.querySelectorAll(".kb-toc").forEach(d => fillToc(d, root, edit));
    root.querySelectorAll(".kb-mention").forEach(s => { if (edit) s.setAttribute("contenteditable", "false"); });
    root.querySelectorAll("a.kb-file").forEach(a => {
      if (edit) { a.setAttribute("contenteditable", "false"); a.title = "Attached file"; return; }
      a.replaceWith(Apps.fileChip({ id: a.dataset.file, name: a.textContent, type: a.dataset.type || "", size: +a.dataset.size || 0 }));
    });
    if (edit) return;
    headingsOf(root).forEach((x, i) => { x.id = "kb-h-" + i; });
    root.querySelectorAll("a[href]").forEach(a => { if (/^https?:/i.test(a.getAttribute("href"))) { a.target = "_blank"; a.rel = "noopener noreferrer"; } });
    root.querySelectorAll("img").forEach(img => { img.loading = "lazy"; img.onclick = () => { if (img.src) UI.modal("", h("img", { class: "kb-lightbox", src: img.src, alt: img.alt || "" }), { className: "kb-lightbox-m" }); }; });
    root.querySelectorAll("pre").forEach(pre => {
      const wrap = h("div", { class: "kb-pre" }); pre.replaceWith(wrap);
      wrap.append(pre, h("button", { class: "kb-ui kb-copy", type: "button", text: "Copy", onclick: () => copy(pre.innerText, "📋 Code copied") }));
    });
    root.querySelectorAll("table").forEach(t => { if (!t.parentElement.classList.contains("kb-table")) { const w = h("div", { class: "kb-table" }); t.replaceWith(w); w.append(t); } });
  }
  // editor HTML → clean HTML for storage
  function serialize(doc) {
    const c = doc.cloneNode(true);
    c.querySelectorAll(".kb-ui").forEach(n => n.remove());
    c.querySelectorAll(".kb-embed, .kb-toc").forEach(n => n.replaceChildren());
    c.querySelectorAll("img[data-file]").forEach(n => n.removeAttribute("src"));
    let out = sanitize(c.innerHTML).replace(/​/g, "");
    if (!htmlText(out) && !/<(img|table|hr|div|ul|ol)/i.test(out)) out = "";
    return out;
  }

  /* ---------- the editor ---------- */
  const SLASH = [
    { k: "p", ic: "¶", label: "Text", desc: "Plain paragraph", kw: "paragraph normal" },
    { k: "h1", ic: "H1", label: "Heading 1", desc: "Big section heading", kw: "title" },
    { k: "h2", ic: "H2", label: "Heading 2", desc: "Medium heading", kw: "subtitle" },
    { k: "h3", ic: "H3", label: "Heading 3", desc: "Small heading", kw: "" },
    { k: "ul", ic: "•", label: "Bulleted list", desc: "Simple list", kw: "bullet unordered" },
    { k: "ol", ic: "1.", label: "Numbered list", desc: "List with numbers", kw: "ordered number" },
    { k: "check", ic: "☑", label: "Checklist", desc: "Track tasks with checkboxes", kw: "todo task checkbox" },
    { k: "quote", ic: "❝", label: "Quote", desc: "Highlight a quote", kw: "blockquote" },
    { k: "info", ic: "💡", label: "Callout: info", desc: "Note that stands out", kw: "callout note tip" },
    { k: "warning", ic: "⚠️", label: "Callout: warning", desc: "Something to watch out for", kw: "callout caution" },
    { k: "success", ic: "✅", label: "Callout: success", desc: "Good news or a done state", kw: "callout ok" },
    { k: "code", ic: "</>", label: "Code block", desc: "Monospaced code", kw: "pre snippet" },
    { k: "hr", ic: "—", label: "Divider", desc: "Horizontal line", kw: "line separator rule" },
    { k: "table", ic: "▦", label: "Table", desc: "Rows and columns", kw: "grid" },
    { k: "image", ic: "🖼️", label: "Image", desc: "Upload a picture (up to 700 KB)", kw: "picture photo upload" },
    { k: "imageUrl", ic: "🌐", label: "Image from link", desc: "Paste an image URL", kw: "picture url" },
    { k: "file", ic: "📎", label: "File", desc: "Attach a file (up to 700 KB)", kw: "attachment upload" },
    { k: "embed", ic: "▶️", label: "Embed", desc: "YouTube, Loom, Google Docs, Figma", kw: "video iframe youtube loom figma google" },
    { k: "toc", ic: "📑", label: "Table of contents", desc: "Built from your headings", kw: "toc contents outline" },
    { k: "mention", ic: "@", label: "Mention someone", desc: "Notify a teammate", kw: "person people user" },
    { k: "emoji", ic: "😀", label: "Emoji", desc: "Insert an emoji", kw: "smiley" },
  ];

  function makeEditor(a0, hooks) {
    const id = a0.id, exec = (c, v = null) => document.execCommand(c, false, v);
    let curIcon = a0.icon || "📄", tags = [...(a0.tags || [])];
    let saved = { body: serialize(h("div", { html: sanitize(a0.body || "") })), title: a0.title || "", icon: curIcon, tags: tags.join("\n") };
    let baseAt = a0.editedAt || a0.at || 0, timer = null, destroyed = false, lastRange = null, cm = null, remoteShown = false, tocT = null;
    const layer = document.getElementById("layer");

    /* --- header: icon, title, tags --- */
    const statusEl = h("span", { class: "kb-saved", text: "Saved" });
    const setStatus = (t, cls = "") => { statusEl.textContent = t; statusEl.className = "kb-saved " + cls; };
    const iconBtn = h("button", { class: "kb-icon-btn", type: "button", text: curIcon, title: "Change icon", onclick: () => UI.emojiPicker(iconBtn, e => { curIcon = e || "📄"; iconBtn.textContent = curIcon; change(); }) });
    const titleIn = h("textarea", { class: "kb-title-in", rows: 1, placeholder: "Untitled", maxlength: 200 });
    titleIn.value = a0.title || "";
    const fit = () => { titleIn.style.height = "auto"; titleIn.style.height = titleIn.scrollHeight + "px"; };
    titleIn.addEventListener("input", () => { fit(); change(); });
    titleIn.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); doc.focus(); placeCaret(doc.firstChild || doc, false); } });
    const tagBox = h("div", { class: "kb-tags-edit" });
    const tagIn = h("input", { class: "kb-tag-in", placeholder: "Add tag…", maxlength: 40 });
    const paintTags = () => tagBox.replaceChildren(...tags.map(t => h("span", { class: "kb-tag" }, "#" + t, h("button", { type: "button", text: "×", title: "Remove tag", onclick: () => { tags = tags.filter(x => x !== t); paintTags(); change(); } }))), tagIn);
    const addTag = refocus => { const v = tagIn.value.trim().replace(/^#/, "").replace(/,/g, "").toLowerCase(); tagIn.value = ""; if (v && !tags.includes(v) && tags.length < 12) { tags.push(v); paintTags(); change(); } if (refocus) setTimeout(() => tagIn.focus()); };
    tagIn.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(true); } else if (e.key === "Backspace" && !tagIn.value && tags.length) { tags.pop(); paintTags(); change(); setTimeout(() => tagIn.focus()); } });
    tagIn.addEventListener("blur", () => { if (tagIn.value.trim()) addTag(false); });
    paintTags();

    /* --- the document --- */
    const doc = h("div", { class: "kb-doc kb-editor", contenteditable: "true", spellcheck: "true", "data-placeholder": "Write something, or type “/” for blocks…" });
    doc.innerHTML = sanitize(a0.body || "") || "<p><br></p>";
    hydrate(doc, "edit");
    try { exec("defaultParagraphSeparator", "p"); } catch {}

    /* --- selection helpers --- */
    const sel = () => getSelection();
    const selNode = () => { const s = sel(); if (!s.rangeCount) return null; const n = s.getRangeAt(0).startContainer; return doc.contains(n) ? (n.nodeType === 1 ? n : n.parentElement) : null; };
    function placeCaret(node, atEnd) {
      if (!node) return;
      if (atEnd && node.nodeType === 1 && node.childNodes.length === 1 && node.firstChild.nodeName === "BR") atEnd = false; // empty block: caret before its <br>
      const r = document.createRange();
      if (node.nodeType === 1 && /^(HR|IMG|BR)$/.test(node.tagName)) { r.setStartAfter(node); r.collapse(true); }
      else { r.selectNodeContents(node); r.collapse(!atEnd ? true : false); }
      const s = sel(); s.removeAllRanges(); s.addRange(r); lastRange = r.cloneRange();
    }
    function restore() {
      const s = sel();
      if (s.rangeCount && doc.contains(s.getRangeAt(0).startContainer) && document.activeElement === doc) return;
      doc.focus({ preventScroll: true });
      if (lastRange && doc.contains(lastRange.startContainer)) { s.removeAllRanges(); s.addRange(lastRange); }
      else placeCaret(doc.lastChild || doc, true);
    }
    // the top-level block that holds the caret (text directly in the editor gets wrapped in a paragraph)
    function curBlock() {
      let n = selNode(); if (!n) return null;
      while (n && n.parentNode !== doc) n = n.parentNode;
      if (n && (n.nodeType === 3 || !BLOCKS.test(n.tagName))) { const p = h("p"); n.replaceWith(p); p.append(n); placeCaret(p, true); return p; }
      return n;
    }
    const innerBlock = () => selNode()?.closest("p, h1, h2, h3, li, pre, td, th, blockquote, .kb-callout, div:not(.kb-editor)");
    const isEmpty = b => !!b && b.nodeType === 1 && /^(P|H1|H2|H3|DIV)$/.test(b.tagName) && !b.matches(".kb-callout, .kb-embed, .kb-toc")
      && !b.textContent.replace(/​/g, "").trim() && !b.querySelector("img, iframe, .kb-mention, .kb-file, hr, table");
    const caretRect = () => {
      const s = sel(); if (!s.rangeCount) return doc.getBoundingClientRect();
      const r = s.getRangeAt(0).cloneRange(), rs = r.getClientRects();
      if (rs.length) return rs[rs.length - 1];
      const el = selNode() || doc, b = el.getBoundingClientRect();
      return { left: b.left, right: b.left + 10, top: b.top, bottom: b.top + 22 };
    };

    /* --- inserting blocks --- */
    function insertBlock(el, focusIn) {
      restore();
      const b = curBlock();
      if (!b) doc.append(el); else if (isEmpty(b)) b.replaceWith(el); else b.after(el);
      let next = el.nextElementSibling;
      if (!next || !/^(P|H1|H2|H3)$/.test(next.tagName)) { next = h("p", null, h("br")); el.after(next); }
      placeCaret(focusIn || next, !focusIn);
      change();
    }
    function wrapBlock(make, same) {
      restore();
      let b = curBlock();
      if (!b) { b = h("p", null, h("br")); doc.append(b); }
      if (same(b)) { const kids = [...b.childNodes]; b.replaceWith(...kids); placeCaret(kids.find(k => k.nodeType === 1) || doc, true); return change(); }
      const box = make();
      if (b.matches(".kb-callout, blockquote")) { box.append(...b.childNodes); b.replaceWith(box); }
      else if (isEmpty(b)) { box.append(h("p", null, h("br"))); b.replaceWith(box); }
      else { b.replaceWith(box); box.append(b); }
      if (!box.nextElementSibling) box.after(h("p", null, h("br")));
      placeCaret(box.lastElementChild || box, true);
      change();
    }
    function toggleHeading(tag) {
      restore();
      const b = innerBlock();
      exec("formatBlock", b && b.tagName === tag.toUpperCase() ? "<p>" : "<" + tag + ">");
      change();
    }
    function makeTable(rows = 3, cols = 3) {
      return h("table", null, h("tbody", null, ...Array.from({ length: rows }, (_, r) => h("tr", null, ...Array.from({ length: cols }, () => h(r ? "td" : "th", null, h("br")))))));
    }
    function checklist() {
      restore();
      let ul = selNode()?.closest("ul");
      if (ul?.classList.contains("kb-check")) { ul.classList.remove("kb-check"); ul.querySelectorAll("li").forEach(li => li.removeAttribute("data-checked")); return change(); }
      if (!ul) { exec("insertUnorderedList"); ul = selNode()?.closest("ul"); }
      if (ul) { ul.classList.add("kb-check"); ul.querySelectorAll("li").forEach(li => { if (!li.dataset.checked) li.dataset.checked = "false"; }); }
      change();
    }
    async function insertImages(files) {
      const range = lastRange && lastRange.cloneRange();
      const atts = await Apps.attach(files.filter(f => /^image\//.test(f.type)));
      if (!atts.length || destroyed) return;
      if (range) lastRange = range;
      atts.forEach(att => {
        const img = h("img", { alt: att.name, dataset: { file: att.id } });
        const f = Data.get("files", att.id); if (f?.data) img.src = f.data;
        insertBlock(h("p", null, img));
      });
    }
    async function insertFiles(files) {
      const range = lastRange && lastRange.cloneRange();
      const atts = await Apps.attach(files);
      if (!atts.length || destroyed) return;
      if (range) lastRange = range;
      const p = h("p");
      atts.forEach(att => p.append(h("a", { class: "kb-file", contenteditable: "false", dataset: { file: att.id, type: att.type || "", size: String(att.size || 0) }, text: att.name }), " "));
      insertBlock(p);
    }
    // a small popover with one text field; onOk(value) runs with the editor selection restored
    function ask(anchor, placeholder, onOk, value = "") {
      const keep = lastRange && lastRange.cloneRange();
      const inp = h("input", { class: "menu-input", placeholder, value });
      const go = () => { const v = inp.value.trim(); pop.close(); if (keep) lastRange = keep; restore(); if (v) onOk(v); };
      inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); go(); } });
      const pop = UI.popover(anchor, h("div", { style: { width: "320px" } }, inp, h("div", { class: "kb-ask-row" }, h("button", { class: "btn primary", type: "button", text: "OK", onclick: go }))));
      setTimeout(() => inp.focus(), 30);
      return pop;
    }
    function link(anchor) {
      const a = selNode()?.closest("a:not(.kb-file)");
      ask(anchor || caretRect(), "Paste a link and press Enter…", url => {
        const href = safeHref(/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(url) ? "https://" + url : url);
        if (!href) return UI.toast("That link doesn't look right");
        if (a) { a.setAttribute("href", href); return change(); }
        if (sel().isCollapsed) exec("insertHTML", `<a href="${esc(href)}">${esc(url)}</a>`); else exec("createLink", href);
        change();
      }, a ? a.getAttribute("href") : "");
    }
    function inlineCode() {
      restore();
      const c = selNode()?.closest("code");
      if (c && !c.closest("pre")) { c.replaceWith(...c.childNodes); return change(); }
      const t = sel().toString(); if (!t) return;
      exec("insertHTML", "<code>" + esc(t) + "</code>&#8203;"); change();
    }
    function improve() {
      if (!Apps.AI?.available("kb")) return;
      restore();
      const s = sel(), text = s.toString().trim(), keep = s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
      const whole = !text, input = text || htmlText(serialize(doc)).slice(0, 6000);
      if (!input) return UI.toast("Write a few words first");
      Apps.AI.compose({ title: "Improve writing", task: "rewrite", input, insertLabel: whole ? "Add below" : "Replace",
        onInsert: out => {
          const paras = String(out).split(/\n{2,}|\n/).map(x => x.trim()).filter(Boolean);
          doc.focus({ preventScroll: true });
          if (!whole && keep && doc.contains(keep.startContainer)) { const ss = sel(); ss.removeAllRanges(); ss.addRange(keep); }
          else placeCaret(doc.lastChild || doc, true);
          if (paras.length <= 1 && !whole) exec("insertText", paras[0] || "");
          else if (whole) { doc.append(...paras.map(p => h("p", { text: p }))); }
          else exec("insertHTML", paras.map(p => "<p>" + esc(p) + "</p>").join(""));
          change();
        } });
    }
    function run(k, anchor) {
      switch (k) {
        case "p": restore(); exec("formatBlock", "<p>"); return change();
        case "h1": case "h2": case "h3": return toggleHeading(k);
        case "ul": restore(); exec("insertUnorderedList"); return change();
        case "ol": restore(); exec("insertOrderedList"); return change();
        case "check": return checklist();
        case "quote": return wrapBlock(() => h("blockquote"), b => b.tagName === "BLOCKQUOTE");
        case "info": case "warning": case "success": return wrapBlock(() => h("div", { class: "kb-callout " + k }), b => b.matches(".kb-callout." + k));
        case "code": { restore(); const pre = selNode()?.closest("pre"); exec("formatBlock", pre ? "<p>" : "<pre>"); return change(); }
        case "hr": return insertBlock(h("hr"));
        case "table": { const t = makeTable(); insertBlock(t, t.querySelector("th")); return; }
        case "image": return Apps.pickFiles(true).then(fs => fs.length && insertImages(fs));
        case "imageUrl": return ask(anchor || caretRect(), "Paste an image link (https://…)", url => { const s = safeImg(url); if (!s) return UI.toast("Use an https:// image link"); insertBlock(h("p", null, h("img", { src: s, alt: "" }))); });
        case "file": return Apps.pickFiles(true).then(fs => fs.length && insertFiles(fs));
        case "embed": return ask(anchor || caretRect(), "Paste a YouTube, Loom, Google Docs or Figma link", url => {
          const em = toEmbed(url); if (!em) return UI.toast("That link can't be embedded. Try YouTube, Loom, Google Docs or Figma.");
          const d = h("div", { class: "kb-embed", dataset: { src: em.src } }); fillEmbed(d, true); insertBlock(d);
        });
        case "toc": { const d = h("div", { class: "kb-toc" }); insertBlock(d); fillToc(d, doc, true); return; }
        case "mention": restore(); exec("insertText", "@"); return;
        case "emoji": { const keep = lastRange && lastRange.cloneRange(), at = anchor || caretRect(); UI.emojiPicker(at, e => { if (keep) lastRange = keep; restore(); if (e) exec("insertText", e); change(); }); return; }
        case "link": return link(anchor);
        case "bold": case "italic": case "underline": case "strikeThrough": restore(); exec(k); return change();
        case "inlineCode": return inlineCode();
        case "improve": return improve();
      }
    }

    /* --- "/" commands and @mentions at the caret --- */
    function closeCm() { if (cm) { const p = cm.pop; cm = null; p?.close(); } }
    function cmQuery() {
      const s = sel(); if (!cm || !s.rangeCount || !s.isCollapsed) return null;
      const r = s.getRangeAt(0);
      if (r.startContainer !== cm.node || r.startOffset <= cm.offset) return null;
      const q = cm.node.nodeValue.slice(cm.offset + 1, r.startOffset);
      return q.length > 30 || (cm.kind === "/" && /\s/.test(q)) || /\s\s/.test(q) ? null : q;
    }
    function cmItems(q) {
      q = q.toLowerCase();
      if (cm.kind === "/") return SLASH.filter(x => !q || (x.label + " " + x.kw + " " + x.k).toLowerCase().includes(q));
      return Data.people().filter(p => p.key !== me() && (p.name + " " + (p.email || "")).toLowerCase().includes(q)).slice(0, 8);
    }
    function cmPaint() {
      const q = cmQuery(); if (q == null) return closeCm();
      cm.items = cmItems(q); cm.idx = Math.min(cm.idx, Math.max(0, cm.items.length - 1));
      if (!cm.items.length && q.length > 2) return closeCm();
      const box = h("div", { class: "kb-cmenu" + (cm.kind === "@" ? " people" : "") },
        cm.kind === "/" ? h("div", { class: "menu-sec", text: "Blocks" }) : null,
        ...cm.items.map((it, i) => h("button", { type: "button", class: "mi compact" + (i === cm.idx ? " hl" : ""), onmousedown: e => { e.preventDefault(); cmPick(i); }, onmouseenter: () => { cm.idx = i; box.querySelectorAll(".mi").forEach((b, j) => b.classList.toggle("hl", j === i)); } },
          cm.kind === "/" ? h("span", { class: "kb-cm-ic", text: it.ic }) : Apps.avatar(it, 22),
          h("span", { class: "kb-cm-t" }, h("span", { class: "mi-t", text: it.label || it.name }), it.desc ? h("small", { text: it.desc }) : it.title ? h("small", { text: it.title }) : null))),
        !cm.items.length ? h("div", { class: "menu-empty", text: cm.kind === "/" ? "No blocks found" : "Nobody found" }) : null);
      if (cm.pop && !cm.pop.closed) { cm.pop.el.replaceChildren(box); cm.pop.reposition(caretRect()); }
      else { const c = cm; cm.pop = UI.popover(caretRect(), box, { className: "kb-cpop", onClose: () => { if (cm === c) cm = null; } }); }
      cm.pop.el.querySelector(".mi.hl")?.scrollIntoView({ block: "nearest" });
    }
    function cmPick(i) {
      const it = cm?.items[i]; if (!it) return;
      const s = sel(), r = document.createRange(), kind = cm.kind;
      const end = s.rangeCount && s.getRangeAt(0).startContainer === cm.node ? s.getRangeAt(0).startOffset : cm.node.nodeValue.length;
      r.setStart(cm.node, cm.offset); r.setEnd(cm.node, Math.min(end, cm.node.nodeValue.length));
      closeCm();
      r.deleteContents(); s.removeAllRanges(); s.addRange(r); lastRange = r.cloneRange();
      if (kind === "@") {
        const span = h("span", { class: "kb-mention", contenteditable: "false", dataset: { key: it.key }, text: "@" + it.name });
        const sp = document.createTextNode(" ");
        r.insertNode(sp); r.insertNode(span);
        const after = document.createRange(); after.setStartAfter(sp); after.collapse(true); s.removeAllRanges(); s.addRange(after); lastRange = after.cloneRange();
        return change();
      }
      const b = curBlock(); if (b && !b.textContent && !b.querySelector("br, img")) b.append(h("br"));
      run(it.k);
    }

    /* --- markdown shortcuts: # ## ### - * 1. [] > ``` --- --- */
    function markdown(e) {
      if (e.inputType !== "insertText") return false;
      const s = sel(); if (!s.rangeCount || !s.isCollapsed) return false;
      const blk = innerBlock(); if (!blk || blk.tagName !== "P" || blk.parentNode !== doc) return false;
      const r = document.createRange(); r.setStart(blk, 0); r.setEnd(s.anchorNode, s.anchorOffset);
      const before = r.toString().replace(/ /g, " ");
      let act = null;
      if (e.data === " ") act = { "# ": "h1", "## ": "h2", "### ": "h3", "- ": "ul", "* ": "ul", "1. ": "ol", "[] ": "check", "[ ] ": "check", "> ": "quote" }[before];
      else if (e.data === "`" && before === "```") act = "code";
      else if (e.data === "-" && before === "---") act = "hr";
      if (!act) return false;
      r.deleteContents();
      if (!blk.textContent && !blk.querySelector("br, img")) blk.append(h("br"));
      placeCaret(blk, false);
      if (act === "hr") { const hr = h("hr"); blk.before(hr); placeCaret(blk, false); change(); }
      else run(act);
      return true;
    }

    /* --- floating format bar and table tools (live in #layer so they float over everything) --- */
    const fb = (k, label, title, cls = "") => h("button", { type: "button", class: "kb-fb " + cls, dataset: { k }, title, html: label, onmousedown: e => e.preventDefault(), onclick: e => run(k, e.currentTarget) });
    const fmtBar = h("div", { class: "kb-fmt glass-strong" },
      fb("bold", "<b>B</b>", "Bold (Ctrl+B)"), fb("italic", "<i>I</i>", "Italic (Ctrl+I)"), fb("underline", "<u>U</u>", "Underline (Ctrl+U)"), fb("strikeThrough", "<s>S</s>", "Strikethrough"),
      fb("inlineCode", "&lt;/&gt;", "Inline code"), fb("link", icon("link"), "Link (Ctrl+K)"), h("span", { class: "kb-fb-sep" }),
      fb("h1", "H1", "Heading 1"), fb("h2", "H2", "Heading 2"), fb("h3", "H3", "Heading 3"), fb("quote", "❝", "Quote"),
      Apps.AI?.available("kb") ? fb("improve", "✨", "Improve writing", "ai") : null);
    const tbl = (label, title, fn) => h("button", { type: "button", class: "kb-fb", title, text: label, onmousedown: e => e.preventDefault(), onclick: () => { fn(); change(); requestAnimationFrame(onSel); } });
    function cellInfo() { const c = selNode()?.closest("td, th"); if (!c) return null; const tr = c.parentElement, table = c.closest("table"); return { c, tr, table, i: [...tr.children].indexOf(c) }; }
    const tableBar = h("div", { class: "kb-fmt kb-tblbar glass-strong" },
      tbl("+ Row", "Add a row below", () => { const x = cellInfo(); if (!x) return; const tr = h("tr", null, ...[...x.tr.children].map(() => h("td", null, h("br")))); x.tr.after(tr); placeCaret(tr.firstChild, false); }),
      tbl("+ Column", "Add a column to the right", () => { const x = cellInfo(); if (!x) return; x.table.querySelectorAll("tr").forEach(tr => { const ref = tr.children[x.i]; const cell = h(ref?.tagName === "TH" ? "th" : "td", null, h("br")); ref ? ref.after(cell) : tr.append(cell); }); }),
      tbl("− Row", "Delete this row", () => { const x = cellInfo(); if (!x) return; if (x.table.querySelectorAll("tr").length <= 1) return x.table.replaceWith(h("p", null, h("br"))); const n = x.tr.nextElementSibling || x.tr.previousElementSibling; x.tr.remove(); placeCaret(n.firstChild, false); }),
      tbl("− Column", "Delete this column", () => { const x = cellInfo(); if (!x) return; if (x.tr.children.length <= 1) return x.table.replaceWith(h("p", null, h("br"))); x.table.querySelectorAll("tr").forEach(tr => tr.children[x.i]?.remove()); placeCaret(x.tr.children[Math.max(0, x.i - 1)], false); }),
      tbl("🗑", "Delete table", () => { const x = cellInfo(); if (!x) return; const p = h("p", null, h("br")); (x.table.closest(".kb-table") || x.table).replaceWith(p); placeCaret(p, false); }));
    layer.append(fmtBar, tableBar);
    const hideBars = () => { fmtBar.classList.remove("show"); tableBar.classList.remove("show"); };
    function placeBar(bar, rect) {
      bar.classList.add("show");
      const bw = bar.offsetWidth, bh = bar.offsetHeight;
      let x = rect.left + rect.width / 2 - bw / 2, y = rect.top - bh - 8;
      if (y < 56) y = rect.bottom + 8;
      bar.style.left = Math.max(8, Math.min(x, innerWidth - bw - 8)) + "px"; bar.style.top = Math.max(8, y) + "px";
    }
    function onSel() {
      if (destroyed) return;
      const s = sel();
      if (!s.rangeCount || !doc.contains(s.getRangeAt(0).commonAncestorContainer)) { hideBars(); return; }
      const r = s.getRangeAt(0); lastRange = r.cloneRange();
      if (!s.isCollapsed && r.toString().trim()) {
        tableBar.classList.remove("show"); placeBar(fmtBar, r.getBoundingClientRect());
        const blk = innerBlock();
        fmtBar.querySelectorAll(".kb-fb").forEach(b => { const k = b.dataset.k;
          b.classList.toggle("on", ["bold", "italic", "underline", "strikeThrough"].includes(k) ? document.queryCommandState(k) : /^h\d$/.test(k) ? blk?.tagName === k.toUpperCase() : k === "quote" ? !!selNode()?.closest("blockquote") : k === "link" ? !!selNode()?.closest("a") : k === "inlineCode" ? !!selNode()?.closest("code") : false); });
      } else {
        fmtBar.classList.remove("show");
        const t = selNode()?.closest("table");
        if (t) placeBar(tableBar, t.getBoundingClientRect()); else tableBar.classList.remove("show");
      }
    }
    let selRaf = 0;
    const onSelSoon = () => { cancelAnimationFrame(selRaf); selRaf = requestAnimationFrame(onSel); };
    document.addEventListener("selectionchange", onSelSoon);

    /* --- editing events --- */
    doc.addEventListener("input", e => {
      if (!markdown(e)) {
        if (cm) cmPaint();
        else if (e.inputType === "insertText" && (e.data === "/" || e.data === "@")) {
          const s = sel(), r = s.rangeCount && s.getRangeAt(0);
          if (r && r.startContainer.nodeType === 3) {
            const prev = r.startContainer.nodeValue[r.startOffset - 2];
            if (r.startOffset === 1 || /[\s (]/.test(prev || "")) { cm = { kind: e.data, node: r.startContainer, offset: r.startOffset - 1, idx: 0 }; cmPaint(); }
          }
        }
      }
      clearTimeout(tocT); tocT = setTimeout(() => doc.querySelectorAll(".kb-toc").forEach(d => fillToc(d, doc, true)), 500);
      change();
    });
    doc.addEventListener("keydown", e => {
      if (cm && cm.pop && !cm.pop.closed) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const n = cm.items.length; if (n) { cm.idx = (cm.idx + (e.key === "ArrowDown" ? 1 : n - 1)) % n; cmPaint(); } return; }
        if (e.key === "Enter" || e.key === "Tab") { if (cm.items.length) { e.preventDefault(); cmPick(cm.idx); return; } closeCm(); }
        if (e.key === "Escape") { e.preventDefault(); closeCm(); return; }
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); return link(); }
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); return save(); }
      if (mod && e.key === "e") { e.preventDefault(); return inlineCode(); }
      const node = selNode(); if (!node) return;
      if (e.key === "Tab") {
        const cell = node.closest("td, th"), li = node.closest("li"), pre = node.closest("pre");
        if (cell) {
          e.preventDefault();
          const cells = [...cell.closest("table").querySelectorAll("td, th")], i = cells.indexOf(cell);
          let next = cells[i + (e.shiftKey ? -1 : 1)];
          if (!next && !e.shiftKey) { const tr = cell.parentElement, nr = h("tr", null, ...[...tr.children].map(() => h("td", null, h("br")))); tr.after(nr); next = nr.firstChild; change(); }
          if (next) placeCaret(next, true);
        } else if (li) { e.preventDefault(); exec(e.shiftKey ? "outdent" : "indent"); change(); }
        else if (pre) { e.preventDefault(); exec("insertText", "  "); }
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        const pre = node.closest("pre");
        if (pre) {
          e.preventDefault();
          const r = sel().getRangeAt(0), after = r.cloneRange(), before = r.cloneRange();
          after.setEnd(pre, pre.childNodes.length); before.setStart(pre, 0);
          const tail = after.toString(), head = before.toString();
          if (/^\n?$/.test(tail) && /\n$/.test(head)) { // Enter on an empty last line leaves the code block
            pre.textContent = head.replace(/\n$/, "");
            let p = pre.nextElementSibling; if (!p || p.tagName !== "P") { p = h("p", null, h("br")); pre.after(p); }
            placeCaret(p, false); change(); return;
          }
          // a trailing newline only shows once there's something after it, so add two and step back
          if (!tail) { exec("insertText", "\n\n"); sel().modify?.("move", "backward", "character"); }
          else exec("insertText", "\n");
          return;
        }
        const blk = innerBlock(), box = blk?.parentElement;
        if (blk && box && box.matches(".kb-callout, blockquote") && box.parentNode === doc && isEmpty(blk) && blk === box.lastElementChild && box.children.length > 1) {
          e.preventDefault(); box.after(blk); placeCaret(blk, false); change(); return;
        }
        if (node.closest("ul.kb-check")) setTimeout(() => { const li = selNode()?.closest("li"); if (li && !li.textContent.trim()) li.dataset.checked = "false"; });
        if (/^H[123]$/.test(blk?.tagName || "") ) setTimeout(() => { const nb = innerBlock(); if (nb && /^H[123]$/.test(nb.tagName) && isEmpty(nb)) exec("formatBlock", "<p>"); });
      }
      if (e.key === "Backspace") {
        const s = sel(); if (!s.isCollapsed) return;
        const blk = innerBlock(), box = blk?.parentElement;
        if (blk && box && box.matches(".kb-callout, blockquote") && box.parentNode === doc && isEmpty(blk) && box.children.length === 1) {
          e.preventDefault(); const p = h("p", null, h("br")); box.replaceWith(p); placeCaret(p, false); change();
        }
      }
    });
    doc.addEventListener("click", e => {
      const x = e.target.closest(".kb-x");
      if (x) { e.preventDefault(); const blk = x.closest(".kb-embed, .kb-toc"); const p = h("p", null, h("br")); blk.replaceWith(p); placeCaret(p, false); return change(); }
      const li = e.target.closest("ul.kb-check > li");
      if (li && e.target === li && e.clientX - li.getBoundingClientRect().left < 26) { e.preventDefault(); li.dataset.checked = li.dataset.checked === "true" ? "false" : "true"; return change(); }
      const img = e.target.closest("img");
      if (img) return imageMenu(img);
      if (e.target === doc) { // clicked below the last block: keep a paragraph there to type into
        const last = doc.lastElementChild;
        if (!last || e.clientY > last.getBoundingClientRect().bottom) { if (!last || !isEmpty(last)) doc.append(h("p", null, h("br"))); placeCaret(doc.lastElementChild, false); }
      }
    });
    function imageMenu(img) {
      const cur = parseInt(img.style.width) || 100;
      const range = h("input", { type: "range", min: 10, max: 100, step: 5, value: cur, class: "kb-range" });
      const lab = h("b", { text: cur + "%" });
      const set = v => { v = Math.max(10, Math.min(100, +v)); img.style.width = v === 100 ? "" : v + "%"; range.value = v; lab.textContent = v + "%"; change(); };
      range.oninput = () => set(range.value);
      const alt = h("input", { class: "menu-input", placeholder: "Describe the image (alt text)", value: img.getAttribute("alt") || "" });
      alt.oninput = () => { img.setAttribute("alt", alt.value); change(); };
      const pop = UI.popover(img, h("div", { class: "kb-imgpop" },
        h("div", { class: "kb-imgpop-row" }, h("span", { text: "Size" }), range, lab),
        h("div", { class: "seg" }, ...[25, 50, 75, 100].map(v => h("button", { type: "button", text: v === 100 ? "Full" : v + "%", onclick: () => set(v) }))),
        alt,
        h("button", { class: "mi compact danger", type: "button", onclick: () => { pop.close(); const p = img.closest("p"); img.remove(); if (p && isEmpty(p)) p.innerHTML = "<br>"; change(); } }, h("span", { class: "mi-ic", html: icon("trash") }), "Remove image")));
    }
    doc.addEventListener("paste", e => {
      const cd = e.clipboardData; if (!cd) return;
      const files = [...(cd.files || [])];
      if (files.length) { e.preventDefault(); const imgs = files.filter(f => /^image\//.test(f.type)); imgs.length ? insertImages(imgs) : insertFiles(files); return; }
      const html = cd.getData("text/html"), text = cd.getData("text/plain");
      e.preventDefault();
      const blk = curBlock();
      if (!selNode()?.closest("pre") && !html && /^https?:\/\/\S+$/.test(text.trim())) {
        const em = toEmbed(text.trim());
        if (em && blk && isEmpty(blk)) { const d = h("div", { class: "kb-embed", dataset: { src: em.src } }); fillEmbed(d, true); insertBlock(d); UI.toast("▶️ Embedded " + em.kind); return; }
        if (!sel().isCollapsed) { exec("createLink", safeHref(text.trim())); return change(); }
      }
      if (selNode()?.closest("pre") || !html) {
        if (selNode()?.closest("pre") || !/\n/.test(text)) exec("insertText", text);
        else exec("insertHTML", text.split(/\r?\n/).map(l => "<p>" + (esc(l) || "<br>") + "</p>").join(""));
      } else {
        const clean = sanitize(html, { paste: true });
        exec("insertHTML", clean || esc(text));
        doc.querySelectorAll("[style]").forEach(n => { if (n.tagName !== "IMG") n.removeAttribute("style"); });
      }
      change();
    });
    doc.addEventListener("drop", e => {
      const files = [...(e.dataTransfer?.files || [])]; if (!files.length) return;
      e.preventDefault();
      const r = document.caretRangeFromPoint?.(e.clientX, e.clientY);
      if (r && doc.contains(r.startContainer)) { const s = sel(); s.removeAllRanges(); s.addRange(r); lastRange = r.cloneRange(); }
      const imgs = files.filter(f => /^image\//.test(f.type));
      imgs.length === files.length ? insertImages(imgs) : insertFiles(files);
    });
    const onScroll = () => { if (fmtBar.classList.contains("show") || tableBar.classList.contains("show")) onSelSoon(); };

    /* --- toolbar --- */
    const tb = (k, html, title) => h("button", { type: "button", class: "kb-tb", title, html, onmousedown: e => e.preventDefault(), onclick: e => run(k, e.currentTarget) });
    const insertBtn = h("button", { type: "button", class: "kb-tb kb-tb-ins", title: "Insert a block", html: icon("plus") + "<span>Insert</span>", onmousedown: e => e.preventDefault(),
      onclick: () => { const keep = lastRange && lastRange.cloneRange(); UI.menu(insertBtn, SLASH.map(x => ({ label: x.label, iconHtml: `<span class="kb-cm-ic sm">${esc(x.ic)}</span>`, onClick: () => { if (keep) lastRange = keep; run(x.k, insertBtn); } })), { className: "kb-insmenu" }); } });
    const toolbar = h("div", { class: "kb-toolbar" }, insertBtn, h("span", { class: "kb-tb-sep" }),
      tb("bold", "<b>B</b>", "Bold"), tb("italic", "<i>I</i>", "Italic"), tb("underline", "<u>U</u>", "Underline"), h("span", { class: "kb-tb-sep" }),
      tb("h1", "H1", "Heading 1"), tb("h2", "H2", "Heading 2"), tb("ul", "•≡", "Bulleted list"), tb("ol", "1≡", "Numbered list"), tb("check", "☑", "Checklist"), tb("link", icon("link"), "Link"),
      tb("image", icon("image"), "Image"), tb("table", icon("table"), "Table"), tb("emoji", icon("smile"), "Emoji"),
      Apps.AI?.available("kb") ? h("button", { type: "button", class: "kb-tb kb-ai", title: "Improve the selected text, or the whole article", text: "✨ Improve writing", onmousedown: e => e.preventDefault(), onclick: () => run("improve") }) : null);

    /* --- banners: someone else editing / remote changes --- */
    const banner = h("div", { class: "kb-banner-slot" });
    function showLock(a) {
      const other = othersEditing(a);
      if (!other) return;
      banner.replaceChildren(h("div", { class: "kb-banner warn" }, h("span", { text: `✏️ ${Data.person(other).name} is editing this article right now. Your changes may overwrite theirs.` }),
        h("button", { class: "btn", type: "button", text: "OK", onclick: () => banner.replaceChildren() })));
    }
    function onRemote(a) {
      if (destroyed) return;
      if (!a || a.deleted) { UI.toast("This article was moved to the recycle bin"); return hooks.gone?.(); }
      if (remoteShown || !a.editedBy || a.editedBy === me() || (a.editedAt || 0) <= baseAt) return;
      if (a.body === saved.body && (a.title || "") === saved.title) { baseAt = a.editedAt; return; }
      remoteShown = true;
      const who = Data.person(a.editedBy).name;
      banner.replaceChildren(h("div", { class: "kb-banner" }, h("span", { text: `🔄 Updated by ${who} while you were editing.` }),
        h("button", { class: "btn", type: "button", text: "Reload", onclick: () => { const cur = Data.get(AR, id); if (cur) load(cur); remoteShown = false; banner.replaceChildren(); UI.toast("Loaded the latest version"); } }),
        h("button", { class: "btn primary", type: "button", text: "Keep mine", onclick: () => { baseAt = Data.get(AR, id)?.editedAt || Date.now(); remoteShown = false; banner.replaceChildren(); saved.body = "\u0000"; change(); } })));
    }
    function load(a) {
      clearTimeout(timer); timer = null;
      titleIn.value = a.title || ""; fit(); curIcon = a.icon || "📄"; iconBtn.textContent = curIcon; tags = [...(a.tags || [])]; paintTags();
      doc.innerHTML = sanitize(a.body || "") || "<p><br></p>"; hydrate(doc, "edit");
      saved = { body: serialize(doc), title: a.title || "", icon: curIcon, tags: tags.join("\n") };
      baseAt = a.editedAt || Date.now(); setStatus("Saved"); markEmpty();
    }

    /* --- saving --- */
    const markEmpty = () => doc.classList.toggle("is-empty", !doc.textContent.trim() && !doc.querySelector("img, table, hr, ul, ol, pre, blockquote, .kb-embed, .kb-toc, .kb-callout, h1, h2, h3"));
    function change() {
      if (destroyed) return;
      markEmpty();
      setStatus("Unsaved changes", "dirty");
      clearTimeout(timer); timer = setTimeout(save, 1500);
    }
    async function save() {
      clearTimeout(timer); timer = null;
      const cur = Data.get(AR, id); if (!cur || cur.deleted) return;
      const v = { title: titleIn.value.trim(), icon: curIcon, tags: [...tags], body: serialize(doc) };
      if (v.body === saved.body && v.title === saved.title && v.icon === saved.icon && v.tags.join("\n") === saved.tags) { setStatus("Saved"); return; }
      const now = Date.now(), patch = { ...v, editedAt: now, editedBy: me(), editing: { by: me(), at: now } };
      const vers = cur.versions || [];
      if (!vers.some(x => x.savedBy === me() && now - (x.savedAt || x.at || 0) < MIN5) && meaningful(cur, v))
        patch.versions = trimVersions([...vers, { at: cur.editedAt || cur.at || now, by: cur.editedBy || cur.by || me(), title: cur.title || "", body: cur.body || "", savedBy: me(), savedAt: now }], v.body);
      if ((cur.status || "published") !== "draft") Object.assign(patch, mentionPatch(cur, v.body, v.title));
      saved = { body: v.body, title: v.title, icon: v.icon, tags: v.tags.join("\n") }; baseAt = now;
      setStatus("Saving…", "saving");
      await Data.update(AR, id, patch);
      if (!destroyed && !timer) setStatus("Saved", "ok");
    }
    const flush = () => { if (timer) save(); };
    window.addEventListener("beforeunload", flush);

    function destroy() {
      if (destroyed) return;
      flush(); destroyed = true; closeCm();
      document.removeEventListener("selectionchange", onSelSoon);
      window.removeEventListener("beforeunload", flush);
      fmtBar.remove(); tableBar.remove(); clearTimeout(tocT);
      const cur = Data.get(AR, id);
      if (cur?.editing?.by === me()) Data.update(AR, id, { editing: null });
    }

    // mark that I'm editing (one write), so others see "… is editing"
    if (canEdit() && !(a0.editing?.by === me() && Date.now() - (a0.editing.at || 0) < 30e3)) Data.update(AR, id, { editing: { by: me(), at: Date.now() } });
    showLock(a0); markEmpty();
    setTimeout(fit);
    return { titleIn, iconBtn, tagBox, doc, toolbar, banner, statusEl, save, flush, destroy, onRemote, load, onScroll, get id() { return id; } };
  }
  // someone else saved or opened the editor within the last 60 s
  function othersEditing(a) {
    const now = Date.now();
    if (a.editing?.by && a.editing.by !== me() && now - (a.editing.at || 0) < 60e3) return a.editing.by;
    if (a.editedBy && a.editedBy !== me() && now - (a.editedAt || 0) < 60e3) return a.editedBy;
    return null;
  }
  // notify people newly @mentioned in a published article
  function mentionPatch(cur, body, title) {
    const already = cur.mentioned || [], fresh = [...new Set(mentionKeys(body))].filter(k => k !== me() && !already.includes(k));
    if (!fresh.length) return {};
    const text = htmlText(body);
    fresh.forEach(k => Data.notify(k, `<b>${esc(Data.me().name)}</b> mentioned you in <b>${esc(title || "Untitled")}</b>`, "#/app/kb/a:" + cur.id, text.slice(0, 200)));
    return { mentioned: [...already, ...fresh] };
  }

  /* ---------- article actions that don't need the screen ---------- */
  function moveArticle(id, to) {
    const a = Data.get(AR, id); if (!a) return;
    const sibs = kidsOf(to.space, to.parent).filter(x => x.id !== id);
    sibs.splice(Math.max(0, Math.min(to.index ?? sibs.length, sibs.length)), 0, a);
    const moved = a.space !== to.space || (effParent(a) || null) !== (to.parent || null);
    const oldSpace = a.space;
    sibs.forEach((x, i) => {
      if (x.id === id) { if (moved || x.order !== i) Data.update(AR, id, { space: to.space, parent: to.parent || null, order: i }); }
      else if (x.order !== i) Data.update(AR, x.id, { order: i });
    });
    if (oldSpace !== to.space) subtree(id).forEach(d => Data.update(AR, d.id, { space: to.space }));
  }
  // archive / delete / restore an article together with everything nested in it
  function batchSet(a, field, on) {
    const list = [a, ...subtree(a.id).filter(x => on ? !x[field] : x[field + "Batch"] === a.id)], now = Date.now();
    list.forEach(x => Data.update(AR, x.id, on ? { [field]: true, [field + "Batch"]: a.id, [field + "At"]: now, [field + "By"]: me() } : { [field]: false, [field + "Batch"]: null }));
    return list.length;
  }
  const isBatchRoot = (a, field) => !a[field + "Batch"] || a[field + "Batch"] === a.id;
  function publish(a) {
    const cur = Data.get(AR, a.id) || a;
    Data.update(AR, a.id, { status: "published", ...mentionPatch(cur, cur.body || "", cur.title || "") });
    UI.toast("🎉 Published: everyone in the space can see it now");
  }
  async function vote(a, field) {
    const other = field === "helpful" ? "unhelpful" : "helpful", has = (a[field] || []).includes(me());
    await Data.arr(AR, a.id, field, me(), !has);
    if (!has && (a[other] || []).includes(me())) await Data.arr(AR, a.id, other, me(), false);
    if (!has) UI.toast("Thanks for your feedback 🙏");
  }
  function spaceForm(s) {
    return new Promise(resolve => {
      const v = { name: s?.name || "", icon: s?.icon || "📚", color: s?.color || COLORS[0], desc: s?.desc || "", access: s?.access || "all", members: [...(s?.members || [])] };
      let done = false;
      const finish = val => { done = true; m.close(); resolve(val); };
      const name = h("input", { class: "menu-input", placeholder: "e.g. Company handbook", value: v.name, maxlength: 80 });
      const iconB = h("button", { type: "button", class: "kb-sf-icon", text: v.icon, title: "Choose an icon", onclick: () => UI.emojiPicker(iconB, e => { if (e) { v.icon = e; iconB.textContent = e; } }) });
      const colors = h("div", { class: "accents" }, ...COLORS.map(c => h("button", { type: "button", class: c === v.color ? "on" : "", style: { background: c, color: c }, onclick: e => { v.color = c; iconB.style.setProperty("--sc", c); colors.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); } })));
      iconB.style.setProperty("--sc", v.color);
      const desc = h("textarea", { class: "menu-input f-ta", rows: 3, placeholder: "What is this space for?", maxlength: 500 }); desc.value = v.desc;
      const who = h("button", { type: "button", class: "menu-input f-person" });
      const paintWho = () => who.replaceChildren(v.members.length ? Apps.avatars(v.members, 20) : "", h("span", { text: v.members.length ? v.members.map(k => Data.person(k).name.split(" ")[0]).join(", ") : "Choose members…" }));
      who.onclick = () => Apps.peoplePicker(who, v.members, ks => { v.members = ks; paintWho(); }); paintWho();
      const whoRow = h("label", { class: "f-row" }, h("span", { text: "Members" }), who);
      const seg = h("div", { class: "seg" }, ...[["all", "🌐 Everyone"], ["members", "🔒 Only members"]].map(([k, l]) => h("button", { type: "button", class: v.access === k ? "on" : "", text: l, onclick: e => { v.access = k; seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); whoRow.style.display = k === "members" ? "" : "none"; } })));
      whoRow.style.display = v.access === "members" ? "" : "none";
      const save = () => {
        v.name = name.value.trim(); v.desc = desc.value.trim();
        if (!v.name) { UI.toast("Give the space a name"); return name.focus(); }
        if (v.access === "members" && !v.members.includes(me())) v.members.push(me());
        finish(v);
      };
      const body = h("form", { class: "f-grid kb-sf", onsubmit: e => { e.preventDefault(); save(); } },
        h("div", { class: "kb-sf-top" }, iconB, h("label", { class: "f-row" }, h("span", { text: "Name" }), name)),
        h("label", { class: "f-row" }, h("span", { text: "Color" }), colors),
        h("label", { class: "f-row" }, h("span", { text: "Description" }), desc),
        h("div", { class: "f-row" }, h("span", { text: "Who can see it" }), seg), whoRow,
        h("div", { class: "f-actions" },
          s ? h("span", { style: { display: "flex", gap: "6px" } },
            h("button", { type: "button", class: "btn", text: s.archived ? "Restore" : "Archive", onclick: () => finish({ action: s.archived ? "unarchive" : "archive" }) }),
            h("button", { type: "button", class: "btn danger", text: "Delete", onclick: () => finish({ action: "delete" }) })) : h("span"),
          h("span", { style: { display: "flex", gap: "8px" } }, h("button", { type: "button", class: "btn", text: "Cancel", onclick: () => m.close() }), h("button", { type: "submit", class: "btn primary", text: s ? "Save" : "Create space" }))));
      const m = UI.modal(s ? "Edit space" : "New space", body, { onClose: () => !done && resolve(null) });
      m.el.style.width = "520px";
      setTimeout(() => name.focus(), 60);
    });
  }
  function pickTemplate(where) {
    return new Promise(res => {
      let done = false;
      const m = UI.modal("New article", h("div", null,
        where ? h("div", { class: "kb-tpl-where", text: "In " + where }) : null,
        h("div", { class: "kb-tpls" }, ...TEMPLATES.map((t, i) => h("button", { class: "kb-tpl", type: "button", style: { animationDelay: i * 30 + "ms" }, onclick: () => { done = true; m.close(); res(t); } },
          h("span", { class: "kb-tpl-ic", text: t.icon }), h("b", { text: t.name }), h("small", { text: t.desc }))))), { onClose: () => !done && res(null) });
      m.el.style.width = "660px";
    });
  }
  function pickSpace() {
    return new Promise(res => {
      let done = false;
      const m = UI.modal("Which space?", h("div", { class: "kb-pick" }, ...spaces().map(s => h("button", { class: "mi", type: "button", onclick: () => { done = true; m.close(); res(s.id); } },
        h("span", { class: "mi-ic", text: s.icon || "📚" }), h("span", null, h("div", { class: "mi-t", text: s.name }), h("div", { class: "mi-d", text: s.desc || "" }))))), { onClose: () => !done && res(null) });
      m.el.style.width = "420px";
    });
  }

  /* ---------- the app ---------- */
  function render(root, arg) {
    _idx = null;
    const st = { view: "home", space: null, art: null, q: "", fSpace: "", fTag: "", prev: null, sig: "", spy: null, pendingLast: null };
    let ed = null, drag = null, dragSub = new Set(), sidePending = false, ready = false;

    const side = h("aside", { class: "kb-side" });
    const searchIn = h("input", { class: "kb-search-in", type: "search", placeholder: "Search articles, tags and text…", "aria-label": "Search the knowledge base" });
    const scroll = h("div", { class: "kb-scroll" });
    const shell = h("div", { class: "kb" });
    const top = h("div", { class: "kb-top" },
      h("button", { class: "icon-btn kb-menu-btn", title: "Spaces and articles", html: I.menu, onclick: () => shell.classList.toggle("show-side") }),
      h("label", { class: "kb-search" }, h("span", { class: "kb-search-ic", html: I.search }), searchIn),
      canEdit() ? h("button", { class: "btn primary kb-new", html: icon("plus") + "<span>New</span>", onclick: e => newMenu(e.currentTarget) }) : null);
    shell.append(side, h("section", { class: "kb-main" }, top, scroll), h("div", { class: "kb-scrim", onclick: () => shell.classList.remove("show-side") }));
    root.append(shell);

    /* --- navigation --- */
    function hashFor(view, id) {
      if (view === "space") return "#/app/kb/" + id;
      if (view === "article" || view === "edit") return "#/app/kb/a:" + id;
      if (view === "home") return "#/app/kb";
      return "#/app/kb/~" + view;
    }
    function go(view, id, opts = {}) {
      if (ed && !(view === "edit" && id === ed.id)) { ed.destroy(); ed = null; }
      st.view = view; st.sig = ""; st.spy = null; st.pendingLast = opts.pending ? st.pendingLast : null;
      if (view === "space") st.space = id;
      if (view === "article" || view === "edit") {
        st.art = id; const a = Data.get(AR, id);
        if (a) { st.space = a.space; setPref({ last: id }); ancestors(a).forEach(x => setOpen(x.id, true)); if (!spaceOpen(a.space)) setSpaceOpen(a.space, true); }
      } else if (view !== "search") st.art = null;
      if (view !== "search" && !opts.keepQ) { st.q = ""; st.fTag = ""; searchIn.value = ""; }
      const hash = hashFor(view, id);
      if (!opts.noPush && location.hash !== hash) history[opts.replace ? "replaceState" : "pushState"](null, "", hash);
      shell.classList.remove("show-side");
      drawSide(); drawMain(); scroll.scrollTop = 0;
    }
    function newMenu(anchor) {
      const cur = st.space && liveSpace(Data.get(SP, st.space)) ? st.space : null;
      UI.menu(anchor, [
        { label: "New article", icon: "page", onClick: () => newArticle(cur, null) },
        { label: "New space", icon: "plus", onClick: () => newSpace() },
      ], { align: "end" });
    }
    async function newSpace() {
      if (!canEdit()) return UI.toast("You can't create spaces");
      const v = await spaceForm(null); if (!v) return null;
      const id = await Data.add(SP, { ...v, archived: false, deleted: false, order: spaces().length });
      UI.toast("✨ Space created"); go("space", id);
      return id;
    }
    async function editSpace(s) {
      const v = await spaceForm(s); if (!v) return;
      if (v.action === "archive") return archiveSpace(s, true);
      if (v.action === "unarchive") return archiveSpace(s, false);
      if (v.action === "delete") return trashSpace(s);
      Data.update(SP, s.id, v); UI.toast("Space saved");
    }
    function archiveSpace(s, on) {
      Data.update(SP, s.id, { archived: on, archivedAt: on ? Date.now() : null });
      UI.toast(on ? `🗄️ “${s.name}” archived` : `“${s.name}” restored`, on ? { label: "Undo", run: () => Data.update(SP, s.id, { archived: false }) } : null);
      if (on && st.space === s.id && st.view !== "archive") go("home", null, { replace: true });
    }
    function trashSpace(s) {
      Data.update(SP, s.id, { deleted: true, deletedAt: Date.now(), deletedBy: me() });
      UI.toast(`🗑️ “${s.name}” moved to the recycle bin`, { label: "Undo", run: () => Data.update(SP, s.id, { deleted: false }) });
      if (st.space === s.id && st.view !== "trash") go("home", null, { replace: true });
    }
    async function purgeSpace(s) {
      const arts = Data.list(AR).filter(a => a.space === s.id);
      if (!(await UI.confirm(`Delete “${s.name}” and its ${arts.length} article${arts.length === 1 ? "" : "s"} forever? This can't be undone.`, "Delete forever"))) return;
      arts.forEach(a => Data.remove(AR, a.id)); Data.remove(SP, s.id); UI.toast("Deleted forever");
    }
    async function newArticle(spaceId, parentId) {
      if (!canEdit()) return UI.toast("You can't create articles");
      if (!spaceId) {
        const sps = spaces();
        if (!sps.length) { spaceId = await newSpace(); if (!spaceId) return; }
        else if (sps.length === 1) spaceId = sps[0].id;
        else { spaceId = await pickSpace(); if (!spaceId) return; }
      }
      const s = Data.get(SP, spaceId), parent = parentId && Data.get(AR, parentId);
      const tpl = await pickTemplate((s?.icon || "") + " " + (s?.name || "") + (parent ? " › " + (parent.title || "Untitled") : "")); if (!tpl) return;
      const sibs = kidsOf(spaceId, parentId), now = Date.now();
      const id = await Data.add(AR, { space: spaceId, parent: parentId || null, title: tpl.title, icon: tpl.icon === "📄" ? "📄" : tpl.icon, body: tpl.body, tags: [],
        order: sibs.length ? Math.max(...sibs.map(x => x.order ?? 0)) + 1 : 0, versions: [], favorites: [], status: "draft", deleted: false, archived: false, editedAt: now, editedBy: me() });
      if (parentId) setOpen(parentId, true);
      go("edit", id);
    }
    function trashArt(a) {
      batchSet(a, "deleted", true);
      UI.toast(`🗑️ “${a.title || "Untitled"}” moved to the recycle bin`, { label: "Undo", run: () => { const c = Data.get(AR, a.id); if (c) batchSet(c, "deleted", false); } });
      leaveIfInside(a);
    }
    function archiveArt(a) {
      batchSet(a, "archived", true);
      UI.toast(`🗄️ “${a.title || "Untitled"}” archived`, { label: "Undo", run: () => { const c = Data.get(AR, a.id); if (c) batchSet(c, "archived", false); } });
      leaveIfInside(a);
    }
    function leaveIfInside(a) {
      if ((st.view === "article" || st.view === "edit") && (st.art === a.id || subtree(a.id).some(x => x.id === st.art))) {
        const p = effParent(a); p ? go("article", p, { replace: true }) : go("space", a.space, { replace: true });
      }
    }
    async function purgeArt(a) {
      const list = [a, ...subtree(a.id).filter(x => x.deletedBatch === a.id)];
      if (!(await UI.confirm(`Delete “${a.title || "Untitled"}”${list.length > 1 ? ` and ${list.length - 1} nested article${list.length > 2 ? "s" : ""}` : ""} forever? This can't be undone.`, "Delete forever"))) return;
      list.forEach(x => Data.remove(AR, x.id)); UI.toast("Deleted forever");
    }
    async function duplicate(a) {
      const now = Date.now();
      const id = await Data.add(AR, { space: a.space, parent: effParent(a), title: (a.title || "Untitled") + " (copy)", icon: a.icon || "📄", body: a.body || "", tags: [...(a.tags || [])],
        order: (a.order ?? 0) + 0.5, versions: [], favorites: [], status: a.status || "published", deleted: false, archived: false, editedAt: now, editedBy: me() });
      UI.toast("📄 Duplicated"); go("article", id);
    }
    function moveToSpace(anchor, a) {
      const others = spaces().filter(s => s.id !== a.space);
      if (!others.length) return UI.toast("Create another space first");
      UI.menu(anchor, [{ section: "Move to" }, ...others.map(s => ({ label: s.name, iconHtml: `<span>${esc(s.icon || "📚")}</span>`, onClick: () => { moveArticle(a.id, { space: s.id, parent: null, index: Infinity }); setSpaceOpen(s.id, true); UI.toast(`Moved to ${s.name}`); if (st.art === a.id) { st.space = s.id; drawMain(); } } }))], { align: "end" });
    }
    function renameInline(a, row) {
      const t = row?.querySelector(".kb-row-t");
      if (!t) return Apps.form("Rename article", [{ key: "title", label: "Title", required: true }], { title: a.title || "" }).then(v => v && Data.update(AR, a.id, { title: v.title.trim(), editedAt: Date.now(), editedBy: me() }));
      const inp = h("input", { class: "kb-rename", value: a.title || "", maxlength: 200 });
      let done = false;
      const commit = ok => { if (done) return; done = true; const v = inp.value.trim(); if (ok && v && v !== a.title) Data.update(AR, a.id, { title: v, editedAt: Date.now(), editedBy: me() }); else drawSide(); };
      inp.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") commit(true); if (e.key === "Escape") commit(false); });
      inp.addEventListener("blur", () => commit(true));
      inp.addEventListener("click", e => e.stopPropagation());
      t.replaceWith(inp); row.draggable = false; inp.focus(); inp.select();
    }
    function artMenu(anchor, a, row) {
      const ed_ = canEdit() && liveArt(a);
      UI.menu(anchor, [
        { label: "Open", icon: "page", onClick: () => go("article", a.id) },
        ed_ && { label: "Edit", iconHtml: I.edit, onClick: () => go("edit", a.id) },
        ed_ && { label: "Add article inside", icon: "plus", onClick: () => newArticle(a.space, a.id) },
        ed_ && { label: "Rename", icon: "text", onClick: () => renameInline(a, row) },
        ed_ && { label: "Move to space…", icon: "arrow", onClick: () => moveToSpace(anchor, a) },
        ed_ && { label: "Duplicate", icon: "copy", onClick: () => duplicate(a) },
        ed_ && (a.status || "published") === "draft" && { label: "Publish", iconHtml: "🎉", onClick: () => publish(a) },
        ed_ && (a.status || "published") !== "draft" && a.by === me() && { label: "Move back to drafts", iconHtml: "📝", onClick: () => { Data.update(AR, a.id, { status: "draft" }); UI.toast("Moved to your drafts"); } },
        { label: isFav(a) ? "Remove from favorites" : "Add to favorites", icon: "star", onClick: () => toggleFav(a) },
        { label: "Copy link", icon: "link", onClick: () => copy(linkFor(a.id)) },
        !row && { label: "Version history", iconHtml: I.history, onClick: () => historyPanel(a.id) },
        !row && { label: "Print", iconHtml: I.print, onClick: printArticle },
        ed_ && { sep: true },
        ed_ && { label: "Archive", iconHtml: I.archive, onClick: () => archiveArt(a) },
        ed_ && { label: "Delete", icon: "trash", danger: true, onClick: () => trashArt(a) },
      ], { align: "end" });
    }
    function spaceMenu(anchor, s) {
      const mg = canManageSpace(s);
      UI.menu(anchor, [
        canEdit() && { label: "New article", icon: "plus", onClick: () => newArticle(s.id, null) },
        mg && { label: "Edit space", iconHtml: I.edit, onClick: () => editSpace(s) },
        { label: "Copy link", icon: "link", onClick: () => copy(location.href.split("#")[0] + "#/app/kb/" + s.id) },
        mg && { sep: true },
        mg && { label: "Archive space", iconHtml: I.archive, onClick: () => archiveSpace(s, true) },
        mg && { label: "Delete space", icon: "trash", danger: true, onClick: () => trashSpace(s) },
      ], { align: "end" });
    }
    function printArticle() {
      document.body.classList.add("kb-printing");
      const off = () => { document.body.classList.remove("kb-printing"); removeEventListener("afterprint", off); };
      addEventListener("afterprint", off);
      setTimeout(() => { window.print(); setTimeout(off, 1500); }, 50);
    }
    function summarise(a) {
      const input = ((a.title || "") + "\n\n" + plain(a)).slice(0, 6000);
      const editable = canEdit() && liveArt(a);
      Apps.AI.compose({ title: "Summary", task: "rewrite", tone: "shorter", input, context: "Knowledge base article: " + (a.title || ""),
        insertLabel: "Add to the top", onInsert: editable ? out => {
          const cur = Data.get(AR, a.id); if (!cur) return;
          const box = `<div class="kb-callout info"><p><strong>Summary</strong></p>${String(out).split(/\n+/).map(x => x.trim()).filter(Boolean).map(x => "<p>" + esc(x.replace(/^[-•*]\s*/, "")) + "</p>").join("")}</div>`;
          Data.update(AR, a.id, { body: sanitize(box + (cur.body || "")), editedAt: Date.now(), editedBy: me() }); UI.toast("✨ Summary added");
        } : undefined });
    }

    /* --- version history --- */
    function historyPanel(id) {
      ed?.flush();
      const a = Data.get(AR, id); if (!a) return;
      const vers = [...(a.versions || [])].reverse(), view = h("div", { class: "kb-ver-view" }), list = h("div", { class: "kb-ver-list" });
      const when = t => Apps.fmtDateTime?.(t) ?? new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); // Settings → Region
      const show = (v, i, rowEl) => {
        list.querySelectorAll(".kb-ver-row").forEach(r => r.classList.toggle("on", r === rowEl));
        const d = h("div", { class: "kb-doc kb-ver-doc", html: sanitize(v.body || "") }); hydrate(d, "preview");
        view.replaceChildren(h("div", { class: "kb-ver-head" },
          h("div", null, h("b", { text: v.title || "Untitled" }), h("small", { text: `${when(v.at)} · ${Data.person(v.by).name}` })),
          i >= 0 ? (canEdit() && liveArt(a) ? h("button", { class: "btn primary", text: "Restore", onclick: () => restoreVersion(id, v, p) }) : null) : h("span", { class: "kb-badge", text: "Current" })), d);
        view.scrollTop = 0;
      };
      const row = (v, i) => { const r = h("button", { class: "kb-ver-row", type: "button", onclick: () => show(v, i, r) }, Apps.avatar(Data.person(v.by), 26),
        h("span", { class: "kb-ver-b" }, h("b", { text: i < 0 ? "Current version" : when(v.at) }), h("small", { text: Data.person(v.by).name + " · " + UI.timeAgo(v.at) }))); return r; };
      const cur = { at: a.editedAt || a.at, by: a.editedBy || a.by, title: a.title, body: a.body };
      const rows = [row(cur, -1), ...vers.map((v, i) => row(v, i))];
      list.append(...rows, !vers.length ? h("div", { class: "kb-ver-empty", text: "Older versions show up here as the article changes. Lumen keeps the last 10." }) : null);
      const p = Apps.panel("Version history", h("div", { class: "kb-ver" }, list, view));
      p.el.classList.add("kb-ver-panel");
      show(cur, -1, rows[0]);
    }
    async function restoreVersion(id, v, p) {
      if (!(await UI.confirm("Restore this version? The current text stays in the history.", "Restore"))) return;
      const a = Data.get(AR, id); if (!a) return;
      const now = Date.now(), body = sanitize(v.body || "");
      const snap = { at: a.editedAt || a.at || now, by: a.editedBy || a.by || me(), title: a.title || "", body: a.body || "", savedBy: me(), savedAt: now };
      await Data.update(AR, id, { title: v.title || "", body, versions: trimVersions([...(a.versions || []), snap], body), editedAt: now, editedBy: me() });
      p.close();
      if (ed && ed.id === id) ed.load(Data.get(AR, id));
      UI.toast("⏪ Version restored");
    }

    /* --- sidebar tree --- */
    function clearMarks() { side.querySelectorAll("[data-pos]").forEach(x => { x.classList.remove("drop-before", "drop-after", "drop-inside"); delete x.dataset.pos; }); }
    function wireDrop(row, pos, to) {
      row.addEventListener("dragover", e => {
        if (!drag) return;
        const p = pos(e); if (!p) return;
        e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        if (row.dataset.pos !== p) { clearMarks(); row.classList.add("drop-" + p); row.dataset.pos = p; }
      });
      row.addEventListener("dragleave", e => { if (!row.contains(e.relatedTarget)) { row.classList.remove("drop-before", "drop-after", "drop-inside"); delete row.dataset.pos; } });
      row.addEventListener("drop", e => {
        if (!drag) return; e.preventDefault();
        const p = row.dataset.pos, id = drag; clearMarks(); drag = null;
        const target = p && to(p, id); if (target) moveArticle(id, target);
      });
    }
    const plusBtn = (title, fn) => h("button", { class: "icon-btn xs", type: "button", title, html: icon("plus"), onclick: e => { e.stopPropagation(); fn(); } });
    const dotsBtn = fn => h("button", { class: "icon-btn xs", type: "button", title: "More", html: icon("dots"), onclick: e => { e.stopPropagation(); fn(e.currentTarget); } });
    function artNode(a, depth) {
      const kids = kidsOf(a.space, a.id), open = isOpen(a.id) && kids.length > 0;
      const on = st.art === a.id && (st.view === "article" || st.view === "edit");
      const row = h("div", { class: "kb-row" + (on ? " on" : ""), style: { "--d": depth }, draggable: canEdit(), dataset: { id: a.id }, role: "treeitem", tabindex: 0,
        onclick: () => go("article", a.id), onkeydown: e => { if (e.key === "Enter") go("article", a.id); } },
        h("button", { class: "kb-caret" + (open ? " open" : "") + (kids.length ? "" : " none"), type: "button", html: icon("caret"), tabindex: -1, onclick: e => { e.stopPropagation(); setOpen(a.id, !open); drawSide(); } }),
        h("span", { class: "kb-row-ic", text: a.icon || "📄" }),
        h("span", { class: "kb-row-t", text: a.title || "Untitled" }),
        (a.status || "published") === "draft" ? h("span", { class: "kb-draft-dot", title: "Draft: only you can see it" }) : null,
        canEdit() ? h("span", { class: "kb-row-acts" }, plusBtn("Add article inside", () => newArticle(a.space, a.id)), dotsBtn(b => artMenu(b, a, row))) : null);
      if (canEdit()) {
        row.addEventListener("dragstart", e => {
          drag = a.id; dragSub = new Set(subtree(a.id).map(x => x.id));
          if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", a.title || a.id); } catch {} }
          requestAnimationFrame(() => row.classList.add("dragging"));
        });
        row.addEventListener("dragend", () => { drag = null; row.classList.remove("dragging"); clearMarks(); if (sidePending) { sidePending = false; drawSide(); } });
        wireDrop(row, e => {
          if (drag === a.id || dragSub.has(a.id)) return null;
          const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
          return y < .3 ? "before" : y > .7 ? "after" : "inside";
        }, (p, id) => {
          if (p === "inside") { setOpen(a.id, true); return { space: a.space, parent: a.id, index: Infinity }; }
          const par = effParent(a), sibs = kidsOf(a.space, par).filter(x => x.id !== id);
          return { space: a.space, parent: par, index: sibs.findIndex(x => x.id === a.id) + (p === "after" ? 1 : 0) };
        });
      }
      return h("div", { class: "kb-node" }, row, open ? h("div", { class: "kb-kids" }, ...kids.map(k => artNode(k, depth + 1))) : null);
    }
    function spaceNode(s) {
      const roots = kidsOf(s.id, null), open = spaceOpen(s.id) && roots.length > 0, on = st.view === "space" && st.space === s.id;
      const row = h("div", { class: "kb-row kb-space-row" + (on ? " on" : ""), style: { "--sc": s.color || COLORS[0] }, role: "treeitem", tabindex: 0,
        onclick: () => go("space", s.id), onkeydown: e => { if (e.key === "Enter") go("space", s.id); } },
        h("button", { class: "kb-caret" + (open ? " open" : "") + (roots.length ? "" : " none"), type: "button", tabindex: -1, html: icon("caret"), onclick: e => { e.stopPropagation(); setSpaceOpen(s.id, !open); drawSide(); } }),
        h("span", { class: "kb-space-ic", text: s.icon || "📚" }),
        h("span", { class: "kb-row-t", text: s.name || "Untitled space" }),
        s.access === "members" ? h("span", { class: "kb-lock", title: "Only members", html: icon("lock") }) : null,
        canEdit() ? h("span", { class: "kb-row-acts" }, plusBtn("New article", () => newArticle(s.id, null)), dotsBtn(b => spaceMenu(b, s))) : null);
      if (canEdit()) wireDrop(row, () => "inside", () => { setSpaceOpen(s.id, true); return { space: s.id, parent: null, index: Infinity }; });
      return h("div", { class: "kb-node kb-space-node" }, row, open ? h("div", { class: "kb-kids" }, ...roots.map(a => artNode(a, 1))) : null);
    }
    function drawSide() {
      if (!ready) return;
      const old = side.querySelector(".kb-tree"), keep = old ? old.scrollTop : 0;
      const sps = spaces(), favs = idx().live.filter(isFav).sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
      const drafts = Data.list(AR).filter(a => a.status === "draft" && a.by === me() && !a.deleted && spaceOk(Data.get(SP, a.space))).length;
      const binN = Data.list(SP).filter(s => s.deleted && canSeeSpace(s)).length + Data.list(AR).filter(a => a.deleted && isBatchRoot(a, "deleted") && artOk(a)).length;
      const footLink = (ic, label, view, n) => h("button", { class: "kb-foot-link" + (st.view === view ? " on" : ""), type: "button", onclick: () => go(view) },
        h("span", { text: ic }), h("span", { class: "grow", text: label }), n ? h("span", { class: "kb-count", text: n }) : null);
      const tree = h("div", { class: "kb-tree", role: "tree" },
        h("button", { class: "kb-row kb-home-row" + (st.view === "home" ? " on" : ""), type: "button", onclick: () => go("home") }, h("span", { class: "kb-row-ic", text: "🏠" }), h("span", { class: "kb-row-t", text: "Overview" })),
        favs.length ? h("div", { class: "kb-sec" }, h("span", { text: "Favorites" })) : null,
        ...favs.map(a => h("div", { class: "kb-row kb-fav-row" + (st.art === a.id && st.view === "article" ? " on" : ""), onclick: () => go("article", a.id) },
          h("span", { class: "kb-row-ic", text: a.icon || "📄" }), h("span", { class: "kb-row-t", text: a.title || "Untitled" }), h("span", { class: "kb-fav-star", text: "★" }))),
        h("div", { class: "kb-sec" }, h("span", { text: "Spaces" }), canEdit() ? plusBtn("New space", () => newSpace()) : null),
        ...sps.map(spaceNode),
        !sps.length ? h("div", { class: "kb-side-empty", text: canEdit() ? "No spaces yet. Create one to start writing." : "No spaces yet." }) : null);
      side.replaceChildren(
        h("div", { class: "kb-side-head" }, h("span", { class: "kb-logo", text: "📚" }), h("b", { text: "Knowledge base" }), h("span", { class: "grow" }),
          h("button", { class: "icon-btn kb-side-close", type: "button", title: "Close", html: icon("x"), onclick: () => shell.classList.remove("show-side") })),
        tree,
        h("div", { class: "kb-side-foot" }, footLink("📝", "My drafts", "drafts", drafts), footLink("🗄️", "Archive", "archive"), footLink("🗑️", "Recycle bin", "trash", binN)));
      tree.scrollTop = keep;
    }

    /* --- shared bits for views --- */
    const sepEl = () => h("span", { class: "kb-crumb-sep", text: "›" });
    const subOf = a => { const s = Data.get(SP, a.space); return (s ? s.name + " · " : "") + "Updated " + UI.timeAgo(a.editedAt || a.at || Date.now()); };
    const item = (a, sub, extra) => h("div", { class: "kb-item", role: "button", tabindex: 0, onclick: e => { if (!e.target.closest("button")) go("article", a.id); }, onkeydown: e => { if (e.key === "Enter") go("article", a.id); } },
      h("span", { class: "kb-item-ic", text: a.icon || "📄" }),
      h("span", { class: "kb-item-b" }, h("span", { class: "kb-item-t", text: a.title || "Untitled" }), h("small", { text: sub ?? subOf(a) })),
      (a.status || "published") === "draft" ? h("span", { class: "kb-badge draft", text: "Draft" }) : null, extra || null);
    const section = (title, ...kids) => h("section", { class: "kb-sec-block" }, h("h3", { class: "kb-h3", text: title }), ...kids);
    const tagChip = t => h("button", { class: "kb-tag", type: "button", text: "#" + t, onclick: () => searchTag(t) });
    function notFound(title, text) {
      return h("div", { class: "kb-view" }, Apps.empty("🔍", title, h("div", null, h("p", { class: "kb-muted", text }), h("button", { class: "btn primary", text: "Back to the knowledge base", onclick: () => go("home") }))));
    }
    function searchTag(t) {
      if (st.view !== "search") st.prev = { view: st.view, id: st.view === "space" ? st.space : st.art };
      st.fTag = t; st.q = ""; searchIn.value = ""; go("search", null, { keepQ: true });
    }
    const editedSort = (a, b) => (b.editedAt || b.at || 0) - (a.editedAt || a.at || 0);

    /* --- views --- */
    function viewHome() {
      const sps = spaces(), live = idx().live;
      const anySpace = Data.list(SP).some(s => !s.deleted);
      const hero = h("div", { class: "kb-hero" },
        h("div", null, h("h1", { text: "Knowledge base" }), h("p", { text: "Guides, policies and answers your team can find in seconds." })),
        canEdit() && sps.length ? h("div", { class: "kb-hero-acts" }, h("button", { class: "btn", text: "New space", onclick: () => newSpace() }), h("button", { class: "btn primary", html: icon("plus") + "<span>New article</span>", onclick: () => newArticle(null, null) })) : null);
      if (!sps.length) {
        return h("div", { class: "kb-view" }, hero, h("div", { class: "kb-starter glass" },
          h("div", { class: "kb-starter-ic", text: "📚" }),
          h("h2", { text: anySpace ? "No spaces you can see yet" : "Start your knowledge base" }),
          h("p", { text: anySpace ? "Spaces you're a member of will show up here." : "Make a space for each team or topic, then write articles inside it. Not sure where to begin? Try a sample." }),
          canEdit() && !anySpace ? h("div", { class: "kb-starter-acts" },
            h("button", { class: "btn primary big", text: "✨ Create a sample space", onclick: async e => { e.currentTarget.disabled = true; const r = await sampleSpace(); go("space", r.sid); } }),
            h("button", { class: "btn big", text: "New space", onclick: () => newSpace() })) : canEdit() ? h("button", { class: "btn primary", text: "New space", onclick: () => newSpace() }) : null));
      }
      const cards = h("div", { class: "kb-scards" }, ...sps.map((s, i) => {
        const arts = live.filter(a => a.space === s.id), last = Math.max(0, ...arts.map(a => a.editedAt || a.at || 0));
        return h("button", { class: "kb-scard glass", type: "button", style: { "--sc": s.color || COLORS[0], animationDelay: i * 40 + "ms" }, onclick: () => go("space", s.id) },
          h("div", { class: "kb-scard-top" }, h("span", { class: "kb-scard-ic", text: s.icon || "📚" }), s.access === "members" ? h("span", { class: "kb-lock", title: "Only members", html: icon("lock") }) : null),
          h("b", { text: s.name || "Untitled space" }), h("p", { text: s.desc || "No description yet" }),
          h("div", { class: "kb-scard-foot", text: `${arts.length} article${arts.length === 1 ? "" : "s"}` + (last ? " · updated " + UI.timeAgo(last) : "") }));
      }), canEdit() ? h("button", { class: "kb-scard kb-scard-add", type: "button", onclick: () => newSpace() }, h("span", { class: "kb-scard-ic", html: icon("plus") }), h("b", { text: "New space" })) : null);
      const recent = [...live].sort(editedSort).slice(0, 8), favs = live.filter(isFav).slice(0, 6);
      return h("div", { class: "kb-view" }, hero, cards,
        h("div", { class: "kb-cols" },
          section("Recently updated", recent.length ? h("div", { class: "kb-list glass" }, ...recent.map(a => item(a))) : h("p", { class: "kb-muted", text: "No articles yet." })),
          favs.length ? section("Your favorites", h("div", { class: "kb-list glass" }, ...favs.map(a => item(a)))) : null));
    }
    function viewSpace(id) {
      const s = Data.get(SP, id);
      if (!s || !spaceOk(s)) return notFound("This space isn't available", s?.deleted ? "It's in the recycle bin." : "It may have been deleted, or it's only for its members.");
      const all = flatten(s.id), roots = kidsOf(s.id, null), mg = canManageSpace(s);
      const counts = {};
      Data.list(AR).filter(a => a.space === s.id && liveArt(a)).forEach(a => [a.by, a.editedBy, ...(a.versions || []).map(v => v.by)].filter(Boolean).forEach(k => (counts[k] = (counts[k] || 0) + 1)));
      const people = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12);
      const hero = h("div", { class: "kb-space-hero glass", style: { "--sc": s.color || COLORS[0] } },
        h("span", { class: "kb-space-big", text: s.icon || "📚" }),
        h("div", { class: "kb-space-info" }, h("h1", { text: s.name || "Untitled space" }), s.desc ? h("p", { text: s.desc }) : null,
          h("div", { class: "kb-space-meta" },
            s.access === "members" ? h("span", { class: "kb-pill" }, h("span", { html: icon("lock") }), "Only members ", Apps.avatars(s.members, 18, 5)) : h("span", { class: "kb-pill", text: "🌐 Everyone in the workspace" }),
            h("span", { class: "kb-pill", text: `${all.length} article${all.length === 1 ? "" : "s"}` }))),
        h("div", { class: "kb-space-acts" },
          canEdit() && !s.archived ? h("button", { class: "btn primary", html: icon("plus") + "<span>New article</span>", onclick: () => newArticle(s.id, null) }) : null,
          mg ? h("button", { class: "icon-btn", title: "Edit space", html: I.edit, onclick: () => editSpace(s) }) : null,
          h("button", { class: "icon-btn", title: "More", html: icon("dots"), onclick: e => spaceMenu(e.currentTarget, s) })));
      const banner = s.archived ? h("div", { class: "kb-banner" }, h("span", { text: "🗄️ This space is archived. Its articles are read-only and hidden from the tree." }), mg ? h("button", { class: "btn primary", text: "Restore", onclick: () => archiveSpace(s, false) }) : null) : null;
      const list = roots.length || s.archived
        ? h("div", { class: "kb-list glass" }, ...(s.archived ? Data.list(AR).filter(a => a.space === s.id && artOk(a) && !a.deleted && !a.parent).sort(ord) : roots).map(a => {
          const n = kidsOf(s.id, a.id).length;
          return item(a, (n ? `${n} nested article${n === 1 ? "" : "s"} · ` : "") + "Updated " + UI.timeAgo(a.editedAt || a.at || Date.now()));
        }))
        : h("div", { class: "kb-empty-card glass" }, h("div", { class: "kb-starter-ic", text: "✍️" }), h("b", { text: "No articles yet" }), h("p", { class: "kb-muted", text: "Write the first one: a guide, a policy or a set of answers." }),
          canEdit() ? h("button", { class: "btn primary", html: icon("plus") + "<span>New article</span>", onclick: () => newArticle(s.id, null) }) : null);
      const recent = [...all].sort(editedSort).slice(0, 5);
      return h("div", { class: "kb-view" }, hero, banner,
        h("div", { class: "kb-space-grid" },
          section("Articles", list),
          h("div", { class: "kb-space-side" },
            recent.length ? section("Recently updated", h("div", { class: "kb-list glass" }, ...recent.map(a => item(a, "Updated " + UI.timeAgo(a.editedAt || a.at || Date.now()) + " by " + Data.person(a.editedBy || a.by).name.split(" ")[0])))) : null,
            people.length ? section("Contributors", h("div", { class: "kb-people glass" }, ...people.map(([k, n]) => { const p = Data.person(k); return h("div", { class: "kb-person", title: `${p.name}: ${n} edit${n === 1 ? "" : "s"}` }, Apps.avatar(p, 30), h("span", { text: p.name.split(" ")[0] })); }))) : null)));
    }
    function artSig(a) {
      const flat = flatten(a.space), i = flat.findIndex(x => x.id === a.id);
      return JSON.stringify([a.title, a.icon, a.body, a.tags, a.status, a.editedAt, a.editedBy, a.helpful, a.unhelpful, isFav(a), a.archived, a.deleted, othersEditing(a),
        flat[i - 1]?.id, flat[i - 1]?.title, flat[i + 1]?.id, flat[i + 1]?.title, kidsOf(a.space, a.id).map(x => x.title + x.icon), ancestors(a).map(x => x.title), Data.get(SP, a.space)?.name, canEdit()]);
    }
    function viewArticle(id) {
      const a = Data.get(AR, id);
      if (!a || !artOk(a)) return notFound("This article isn't available", "It may be someone's draft, deleted for good, or in a space you can't see.");
      const s = Data.get(SP, a.space), live = liveArt(a), editable = canEdit() && live;
      const author = Data.person(a.by), editor = Data.person(a.editedBy || a.by), other = othersEditing(a);
      const doc = h("div", { class: "kb-doc kb-read-doc", html: sanitize(a.body || "") });
      hydrate(doc, "read");
      if (!doc.textContent.trim() && !doc.querySelector("img, table, iframe, hr")) doc.replaceChildren(h("p", { class: "kb-muted", text: editable ? "This article is empty. Click Edit to start writing." : "This article is empty." }));
      // editors can tick checklist items while reading
      if (editable) doc.querySelectorAll("ul.kb-check > li").forEach((li, i) => li.addEventListener("click", e => {
        if (e.target !== li || e.clientX - li.getBoundingClientRect().left > 26) return;
        const d = h("div", { html: sanitize(Data.get(AR, a.id)?.body || "") }), t = d.querySelectorAll("ul.kb-check > li")[i]; if (!t) return;
        li.dataset.checked = t.dataset.checked = t.dataset.checked === "true" ? "false" : "true";
        Data.update(AR, a.id, { body: sanitize(d.innerHTML) });
      }));
      const hs = headingsOf(doc), nWords = plain(a).split(/\s+/).filter(Boolean).length;
      const tocLinks = hs.map(x => h("a", { href: "#", class: "lv" + (+x.tagName[1] - Math.min(...hs.map(y => +y.tagName[1]))), text: x.textContent, onclick: e => { e.preventDefault(); scrollToEl(x); } }));
      const tocSide = hs.length >= 3 || (hs.length >= 2 && nWords > 500) ? h("aside", { class: "kb-toc-side" }, h("div", { class: "kb-toc-t", text: "On this page" }), h("div", { class: "kb-toc-l" }, ...tocLinks)) : null;
      st.spy = tocSide ? () => {
        const topY = scroll.getBoundingClientRect().top + 90; let cur = 0;
        hs.forEach((x, i) => { if (x.getBoundingClientRect().top < topY) cur = i; });
        tocLinks.forEach((l, i) => l.classList.toggle("on", i === cur));
      } : null;
      const flat = flatten(a.space), i = flat.findIndex(x => x.id === a.id), prev = i > 0 ? flat[i - 1] : null, next = i >= 0 ? flat[i + 1] : null;
      const kids = kidsOf(a.space, a.id), up = a.helpful || [], down = a.unhelpful || [];
      const vb = (e, list, field, label) => h("button", { class: "kb-vote" + (list.includes(me()) ? " on" : ""), type: "button", title: label, onclick: () => vote(a, field) }, h("span", { text: e }), h("b", { text: String(list.length) }));
      const banners = [
        (a.status || "published") === "draft" ? h("div", { class: "kb-banner draft" }, h("span", { text: "📝 This is a draft. Only you can see it until you publish it." }), editable ? h("button", { class: "btn primary", text: "Publish", onclick: () => publish(a) }) : null) : null,
        a.deleted ? h("div", { class: "kb-banner warn" }, h("span", { text: "🗑️ This article is in the recycle bin." }), canEdit() ? h("button", { class: "btn primary", text: "Restore", onclick: () => batchSet(Data.get(AR, a.deletedBatch) || a, "deleted", false) }) : null) : null,
        !a.deleted && (a.archived || s.archived) ? h("div", { class: "kb-banner" }, h("span", { text: s.archived ? "🗄️ This article's space is archived." : "🗄️ This article is archived." }), canEdit() && a.archived ? h("button", { class: "btn primary", text: "Restore", onclick: () => batchSet(Data.get(AR, a.archivedBatch) || a, "archived", false) }) : null) : null,
      ];
      const art = h("article", { class: "kb-article kb-print-area" },
        h("nav", { class: "kb-crumbs" }, h("button", { class: "kb-crumb", type: "button", text: s.icon + " " + s.name, onclick: () => go("space", s.id) }),
          ...ancestors(a).flatMap(x => [sepEl(), h("button", { class: "kb-crumb", type: "button", text: x.title || "Untitled", onclick: () => go("article", x.id) })])),
        ...banners,
        h("header", { class: "kb-art-head" },
          h("span", { class: "kb-art-ic", text: a.icon || "📄" }),
          h("h1", { class: "kb-art-title", text: a.title || "Untitled" }),
          h("div", { class: "kb-art-acts" },
            h("button", { class: "icon-btn kb-star" + (isFav(a) ? " on" : ""), type: "button", title: isFav(a) ? "Remove from favorites" : "Add to favorites", html: icon("star"), onclick: () => toggleFav(a) }),
            Apps.AI?.available("kb") && nWords > 30 ? h("button", { class: "btn kb-ai-btn", type: "button", text: "✨ Summarise", onclick: () => summarise(a) }) : null,
            editable ? h("button", { class: "btn primary", type: "button", html: I.edit + "<span>Edit</span>", onclick: () => go("edit", a.id) }) : null,
            h("button", { class: "icon-btn", type: "button", title: "More", html: icon("dots"), onclick: e => artMenu(e.currentTarget, a, null) }))),
        h("div", { class: "kb-meta" }, Apps.avatar(author, 22), h("span", { text: author.name }), h("span", { class: "kb-dot" }),
          h("span", { text: "Updated " + UI.timeAgo(a.editedAt || a.at || Date.now()) + (editor.key !== author.key ? " by " + editor.name : "") }), h("span", { class: "kb-dot" }),
          h("span", { text: readMins(a) + " min read" }),
          other ? h("span", { class: "kb-editing", text: "✏️ " + Data.person(other).name + " is editing" }) : null),
        (a.tags || []).length ? h("div", { class: "kb-tags" }, ...a.tags.map(tagChip)) : null,
        doc,
        kids.length ? h("div", { class: "kb-subs" }, h("h3", { class: "kb-h3", text: "In this section" }), h("div", { class: "kb-sub-grid" }, ...kids.map(k => h("button", { class: "kb-sub glass", type: "button", onclick: () => go("article", k.id) },
          h("span", { class: "kb-item-ic", text: k.icon || "📄" }), h("span", { class: "kb-item-b" }, h("b", { text: k.title || "Untitled" }), h("small", { text: snippet(plain(k), []).slice(0, 90) })))))) : null,
        live ? h("div", { class: "kb-helpful" }, h("span", { text: "Was this helpful?" }), vb("👍", up, "helpful", "Yes"), vb("👎", down, "unhelpful", "No"),
          h("span", { class: "grow" }),
          h("button", { class: "btn", type: "button", html: icon("link") + "<span>Copy link</span>", onclick: () => copy(linkFor(a.id)) }),
          h("button", { class: "btn", type: "button", html: I.print + "<span>Print</span>", onclick: printArticle })) : null,
        live && (prev || next) ? h("div", { class: "kb-prevnext" },
          prev ? h("button", { class: "kb-pn glass", type: "button", onclick: () => go("article", prev.id) }, h("small", { text: "← Previous" }), h("b", { text: (prev.icon || "📄") + " " + (prev.title || "Untitled") })) : h("span"),
          next ? h("button", { class: "kb-pn next glass", type: "button", onclick: () => go("article", next.id) }, h("small", { text: "Next →" }), h("b", { text: (next.icon || "📄") + " " + (next.title || "Untitled") })) : h("span")) : null);
      return h("div", { class: "kb-read" + (tocSide ? " has-toc" : "") }, art, tocSide);
    }
    function drawEdit() {
      const a = Data.get(AR, st.art);
      if (!a || !canEdit() || !liveArt(a)) { st.view = "article"; scroll.replaceChildren(viewArticle(st.art)); return; }
      const s = Data.get(SP, a.space), id = a.id;
      ed = makeEditor(a, { gone: () => { ed?.destroy(); ed = null; go("space", a.space, { replace: true }); } });
      const draft = (a.status || "published") === "draft";
      const done = async () => { await ed.save(); go("article", id); };
      const publishNow = async () => { await ed.save(); publish(Data.get(AR, id)); go("article", id); };
      const bar = h("div", { class: "kb-edit-bar" },
        h("button", { class: "icon-btn", type: "button", title: "Back to reading", html: I.back, onclick: done }),
        h("span", { class: "kb-edit-where", text: (s.icon || "📚") + " " + s.name }),
        draft ? h("span", { class: "kb-badge draft", text: "Draft · only you can see it" }) : null,
        h("span", { class: "grow" }), ed.statusEl,
        h("button", { class: "icon-btn", type: "button", title: "Version history", html: I.history, onclick: () => historyPanel(id) }),
        draft ? h("button", { class: "btn", type: "button", text: "Save draft", onclick: done }) : null,
        h("button", { class: "btn primary", type: "button", text: draft ? "Publish" : "Done", onclick: draft ? publishNow : done }));
      scroll.replaceChildren(h("div", { class: "kb-edit" },
        h("div", { class: "kb-edit-top" }, bar, ed.toolbar), ed.banner,
        h("div", { class: "kb-paper" }, h("div", { class: "kb-edit-head" }, ed.iconBtn, ed.titleIn), ed.tagBox, ed.doc)));
      setTimeout(() => { if (!a.title) ed.titleIn.focus(); else { ed.doc.focus({ preventScroll: true }); } }, 60);
    }
    function viewSearch() {
      const terms = st.q.toLowerCase().split(/\s+/).filter(Boolean), live = idx().live;
      const sel = (val, opts, onch) => h("select", { class: "app-select", onchange: e => onch(e.target.value) }, ...opts.map(([v, l]) => h("option", { value: v, selected: val === v, text: l })));
      const filters = h("div", { class: "kb-filters" },
        sel(st.fSpace, [["", "All spaces"], ...spaces().map(s => [s.id, (s.icon || "") + " " + s.name])], v => { st.fSpace = v; drawMain(); }),
        sel(st.fTag, [["", "All tags"], ...tagsOf(live).map(t => [t, "#" + t])], v => { st.fTag = v; drawMain(); }),
        st.fTag || st.fSpace ? h("button", { class: "chip-btn", type: "button", text: "Clear filters", onclick: () => { st.fTag = ""; st.fSpace = ""; if (!st.q) { const p = st.prev || { view: "home" }; go(p.view, p.id, { replace: true }); } else drawMain(); } }) : null);
      const res = live.filter(a => (!st.fSpace || a.space === st.fSpace) && (!st.fTag || (a.tags || []).includes(st.fTag))).map(a => {
        const title = String(a.title || "").toLowerCase(), tg = (a.tags || []).join(" ").toLowerCase(), body = plain(a).toLowerCase();
        let score = 0;
        for (const t of terms) { const sc = (title.includes(t) ? 6 : 0) + (tg.includes(t) ? 3 : 0) + (body.includes(t) ? 1 : 0); if (!sc) return null; score += sc; }
        return { a, score };
      }).filter(Boolean).sort((x, y) => y.score - x.score || editedSort(x.a, y.a)).slice(0, 60);
      const spaceHits = terms.length ? spaces().filter(s => terms.every(t => (s.name + " " + (s.desc || "")).toLowerCase().includes(t))) : [];
      const label = st.q ? `Results for “${st.q}”` : st.fTag ? "Tagged #" + st.fTag : "Search";
      return h("div", { class: "kb-view" },
        h("div", { class: "kb-view-head" }, h("h2", { text: label }), h("span", { class: "kb-muted", text: `${res.length} article${res.length === 1 ? "" : "s"}` })),
        filters,
        spaceHits.length ? h("div", { class: "kb-space-hits" }, ...spaceHits.map(s => h("button", { class: "kb-pill big", type: "button", style: { "--sc": s.color }, onclick: () => go("space", s.id) }, (s.icon || "📚") + " " + s.name))) : null,
        res.length ? h("div", { class: "kb-results" }, ...res.map(({ a }, i) => {
          const s = Data.get(SP, a.space), crumb = [s?.name, ...ancestors(a).map(x => x.title || "Untitled")].filter(Boolean).join(" › ");
          return h("button", { class: "kb-res glass", type: "button", style: { animationDelay: Math.min(i, 12) * 25 + "ms" }, onclick: () => go("article", a.id) },
            h("div", { class: "kb-res-top" }, h("span", { class: "kb-item-ic", text: a.icon || "📄" }), h("span", { class: "kb-res-t", html: hl(a.title || "Untitled", terms) }), (a.status || "published") === "draft" ? h("span", { class: "kb-badge draft", text: "Draft" }) : null),
            h("div", { class: "kb-res-crumb", text: crumb }),
            h("div", { class: "kb-res-snip", html: hl(snippet(plain(a), terms), terms) }),
            (a.tags || []).length ? h("div", { class: "kb-res-tags", html: a.tags.map(t => `<span class="kb-tag">${hl("#" + t, terms)}</span>`).join("") }) : null);
        })) : Apps.empty("🔎", st.q ? `Nothing found for “${st.q}”` : "No articles match these filters", h("p", { class: "kb-muted", text: "Try other words, or check the spelling." })));
    }
    function viewList(kind) {
      const binRow = (ic, title, sub, acts, onOpen) => h("div", { class: "kb-item kb-bin-row", role: onOpen ? "button" : null, onclick: e => { if (onOpen && !e.target.closest("button")) onOpen(); } },
        h("span", { class: "kb-item-ic", text: ic }), h("span", { class: "kb-item-b" }, h("span", { class: "kb-item-t", text: title }), h("small", { text: sub })), h("span", { class: "kb-bin-acts" }, ...acts));
      const btn = (label, fn, cls = "") => h("button", { class: "btn " + cls, type: "button", text: label, onclick: fn });
      let head, body;
      if (kind === "favorites") {
        const favs = idx().live.filter(isFav).sort(editedSort);
        head = ["⭐ Favorites", "Articles you starred, on every device."];
        body = favs.length ? h("div", { class: "kb-list glass" }, ...favs.map(a => item(a))) : Apps.empty("⭐", "No favorites yet. Star an article to keep it close.");
      } else if (kind === "drafts") {
        const ds = Data.list(AR).filter(a => a.status === "draft" && a.by === me() && !a.deleted && !a.archived && liveSpace(Data.get(SP, a.space))).sort(editedSort);
        head = ["📝 My drafts", "Only you can see drafts until you publish them."];
        body = ds.length ? h("div", { class: "kb-list glass" }, ...ds.map(a => item(a, null, canEdit() ? h("span", { class: "kb-bin-acts" }, btn("Edit", () => go("edit", a.id)), btn("Publish", () => publish(a), "primary")) : null))) : Apps.empty("📝", "No drafts. New articles start here until you publish them.");
      } else if (kind === "archive") {
        const sps = Data.list(SP).filter(s => spaceOk(s) && s.archived);
        const arts = Data.list(AR).filter(a => a.archived && !a.deleted && artOk(a) && !Data.get(SP, a.space).archived && isBatchRoot(a, "archived")).sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
        head = ["🗄️ Archive", "Archived spaces and articles are hidden but kept. Restore them any time."];
        const rows = [
          ...sps.map(s => binRow(s.icon || "📚", s.name, "Space · archived " + (s.archivedAt ? UI.timeAgo(s.archivedAt) : ""), canManageSpace(s) ? [btn("Restore", () => archiveSpace(s, false), "primary"), btn("Delete", () => trashSpace(s), "danger")] : [], () => go("space", s.id))),
          ...arts.map(a => { const n = subtree(a.id).filter(x => x.archivedBatch === a.id).length; return binRow(a.icon || "📄", a.title || "Untitled", (Data.get(SP, a.space)?.name || "") + " · archived " + UI.timeAgo(a.archivedAt || a.at) + (n ? ` · ${n} nested` : ""),
            canEdit() ? [btn("Restore", () => { batchSet(a, "archived", false); UI.toast("Restored"); }, "primary"), btn("Delete", () => { batchSet(a, "deleted", true); UI.toast("Moved to the recycle bin"); }, "danger")] : [], () => go("article", a.id)); }),
        ];
        body = rows.length ? h("div", { class: "kb-list glass" }, ...rows) : Apps.empty("🗄️", "The archive is empty.");
      } else {
        const sps = Data.list(SP).filter(s => s.deleted && canSeeSpace(s));
        const arts = Data.list(AR).filter(a => a.deleted && isBatchRoot(a, "deleted") && artOk(a)).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
        head = ["🗑️ Recycle bin", "Restore deleted spaces and articles, or delete them forever."];
        const rows = [
          ...sps.map(s => binRow(s.icon || "📚", s.name, `Space · ${Data.list(AR).filter(a => a.space === s.id).length} articles · deleted ${UI.timeAgo(s.deletedAt || s.at)}`,
            canManageSpace(s) ? [btn("Restore", () => { Data.update(SP, s.id, { deleted: false }); UI.toast("Space restored"); }, "primary"), btn("Delete forever", () => purgeSpace(s), "danger")] : [])),
          ...arts.map(a => { const n = subtree(a.id).filter(x => x.deletedBatch === a.id).length; return binRow(a.icon || "📄", a.title || "Untitled", (Data.get(SP, a.space)?.name || "") + " · deleted " + UI.timeAgo(a.deletedAt || a.at) + (a.deletedBy ? " by " + Data.person(a.deletedBy).name.split(" ")[0] : "") + (n ? ` · ${n} nested` : ""),
            canEdit() ? [btn("Restore", () => { batchSet(a, "deleted", false); UI.toast("Restored"); }, "primary"), btn("Delete forever", () => purgeArt(a), "danger")] : [], () => go("article", a.id)); }),
        ];
        const empty = rows.length && canEdit() ? btn("Empty recycle bin", async () => {
          if (!(await UI.confirm(`Delete everything in the recycle bin forever (${rows.length} item${rows.length === 1 ? "" : "s"})? This can't be undone.`, "Empty"))) return;
          arts.forEach(a => [a, ...subtree(a.id).filter(x => x.deletedBatch === a.id)].forEach(x => Data.remove(AR, x.id)));
          sps.filter(canManageSpace).forEach(s => { Data.list(AR).filter(a => a.space === s.id).forEach(a => Data.remove(AR, a.id)); Data.remove(SP, s.id); });
          UI.toast("Recycle bin emptied");
        }, "danger") : null;
        body = h("div", null, empty ? h("div", { class: "kb-bin-top" }, empty) : null, rows.length ? h("div", { class: "kb-list glass" }, ...rows) : Apps.empty("🗑️", "The recycle bin is empty."));
      }
      return h("div", { class: "kb-view" }, h("div", { class: "kb-view-head" }, h("h2", { text: head[0] }), h("span", { class: "kb-muted", text: head[1] })), body);
    }
    function drawMain() {
      if (!ready) return;
      if (st.view === "edit") { if (!ed) drawEdit(); return; }
      if (st.view === "article") {
        const a = Data.get(AR, st.art), sig = a && artOk(a) ? artSig(a) : "none";
        if (sig === st.sig && scroll.firstChild) return;
        st.sig = sig;
      }
      const keep = scroll.scrollTop;
      const el = st.view === "space" ? viewSpace(st.space) : st.view === "article" ? viewArticle(st.art) : st.view === "search" ? viewSearch()
        : ["favorites", "drafts", "archive", "trash"].includes(st.view) ? viewList(st.view) : viewHome();
      scroll.replaceChildren(el);
      scroll.scrollTop = keep;
      st.spy?.();
    }
    const liveMain = UI.liveDraw(scroll, drawMain);

    /* --- search box --- */
    let qT;
    searchIn.addEventListener("input", () => {
      clearTimeout(qT);
      qT = setTimeout(() => {
        st.q = searchIn.value.trim();
        if (st.q || st.fTag) {
          if (st.view !== "search") { st.prev = { view: st.view, id: st.view === "space" ? st.space : st.art }; go("search", null, { keepQ: true, replace: true }); }
          else drawMain();
        } else if (st.view === "search") { const p = st.prev || { view: "home" }; go(p.view, p.id, { replace: true }); }
      }, 180);
    });
    searchIn.addEventListener("keydown", e => {
      if (e.key === "Escape") { searchIn.value = ""; st.fTag = ""; searchIn.dispatchEvent(new Event("input")); searchIn.blur(); }
      if (e.key === "Enter") { e.preventDefault(); clearTimeout(qT); st.q = searchIn.value.trim(); if (st.view !== "search" && st.q) { st.prev = { view: st.view, id: st.view === "space" ? st.space : st.art }; go("search", null, { keepQ: true, replace: true }); } scroll.querySelector(".kb-res")?.click(); }
    });

    /* --- live data --- */
    const changed = () => {
      _idx = null;
      if (!ready) return;
      if (st.pendingLast) { const la = Data.get(AR, st.pendingLast); if (la && liveArt(la)) return go("article", la.id, { replace: true }); }
      if (drag) sidePending = true; else drawSide();
      if (st.view === "edit") { if (ed) ed.onRemote(Data.get(AR, st.art)); return; }
      liveMain();
    };
    const filesChanged = () => {
      if (!ready) return;
      scroll.querySelectorAll("img[data-file]").forEach(img => { if (img.getAttribute("src")) return; const f = Data.get("files", img.dataset.file); if (f?.data) { img.src = f.data; img.classList.remove("kb-missing"); } });
    };
    const onScroll = () => { ed?.onScroll(); st.spy?.(); };
    scroll.addEventListener("scroll", onScroll, { passive: true });
    const offs = [Data.on(SP, changed), Data.on(AR, changed), Data.on("files", filesChanged)];
    ready = true;

    const p = (() => {
      const s = String(arg || "");
      if (s.startsWith("a:")) return { view: "article", id: s.slice(2) };
      if (s.startsWith("~")) return ["favorites", "drafts", "archive", "trash"].includes(s.slice(1)) ? { view: s.slice(1) } : null;
      return s ? { view: "space", id: s } : null;
    })();
    if (p) go(p.view, p.id, { noPush: true });
    else {
      const last = prefs().last, la = last && Data.get(AR, last);
      if (la && liveArt(la)) go("article", last, { replace: true });
      else { go("home", null, { noPush: true }); if (last && !la && !Data.list(AR).length) st.pendingLast = last; }
    }

    return () => {
      offs.forEach(f => f());
      if (ed) { ed.destroy(); ed = null; }
      clearTimeout(qT); scroll.removeEventListener("scroll", onScroll);
      document.body.classList.remove("kb-printing");
    };
  }

  Apps.register("kb", { title: "Knowledge base", icon: "📚", render });
})();
