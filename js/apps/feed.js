/* Activity feed (Bitrix24 "Feed"): posts, announcements, polls, events, appreciation and files,
   sent to everyone or chosen people / departments; likes, comments, replies, @mentions, read receipts */
(function () {
  const { h, esc } = UI;
  const BADGES = { thanks: ["🏅", "Thank you"], rocket: ["🚀", "Great job"], idea: ["💡", "Great idea"], team: ["🤝", "Team player"] };
  const KINDS = [["post", "✍️ Post"], ["announce", "📣 Announcement"], ["poll", "📊 Poll"], ["event", "📅 Event"], ["thanks", "🏅 Appreciation"], ["file", "📎 File"]];
  const HINT = { post: "Share something with your team…", announce: "Important news for your team…", poll: "Ask a question…", event: "Add a description (optional)…", thanks: "Say thanks for something great…", file: "Say something about these files (optional)…" };
  const TYPES = [["any", "Any type"], ["post", "Posts"], ["announce", "Announcements"], ["poll", "Polls"], ["event", "Events"], ["thanks", "Appreciation"], ["files", "With files"]];
  const RANGES = [["all", "All time"], ["week", "This week"], ["month", "This month"]];
  const MAX_FILE = 700 * 1024;
  const toList = v => [].concat(v || []).filter(Boolean);
  const isImg = a => /^image\//.test((a && a.type) || "");
  const link = id => "#/app/feed/" + encodeURIComponent(id);
  const cid = c => c.id || `${c.at}~${c.by}`; // older comments have no id
  const firstName = n => String(n || "").split(" ")[0];

  /* ---------- text: links + highlighted @mentions ---------- */
  function rich(s) {
    const handles = new Set(Data.people().map(Apps.handleOf).filter(Boolean));
    return esc(s).replace(/(https?:\/\/[^\s<]+)|(^|[\s(])@([\w.-]+)/g, (m, url, pre, name) => {
      if (url) return `<a href="${url}" target="_blank" rel="noopener">${url}</a>`;
      const handle = name.replace(/[.-]+$/, ""), rest = name.slice(handle.length);
      return handles.has(handle.toLowerCase()) ? `${pre}<span class="fd-mention">@${handle}</span>${rest}` : m;
    }).replace(/\n/g, "<br>");
  }

  /* ---------- audience ---------- */
  const isAll = a => !a || a.all || (!toList(a.people).length && !toList(a.depts).length);
  const inAudience = (a, person) => isAll(a) || toList(a.people).includes(person.key) || (!!person.dept && toList(a.depts).includes(person.dept));
  const recipients = a => Data.people().filter(p => inAudience(a, p)).map(p => p.key);
  const self = () => { const me = Data.me(); return Data.people().find(p => p.key === me.key) || { ...me, dept: "" }; };
  // workgroup posts (p.group = projects id) are visible to that group's members only
  const inGroup = (p, me) => { const g = Data.get("projects", p.group); if (!g) return false; return window.Apps?.Groups?.isMember ? Apps.Groups.isMember(g, me.key) : !Array.isArray(g.members) || g.members.includes(me.key) || g.owner === me.key; };
  const groupName = id => (Data.get("projects", id) || {}).name || "a workgroup";
  const canSee = (p, me) => p.group ? inGroup(p, me) : p.by === me.key || inAudience(p.audience, me) || toList(p.to).includes(me.key);
  const depts = () => [...new Set(Data.people().map(p => p.dept).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  function audienceLabel(a) {
    if (isAll(a)) return "All employees";
    const me = Data.me().key, names = [...toList(a.people).map(k => k === me ? "you" : firstName(Data.person(k).name)), ...toList(a.depts)];
    return names.length > 3 ? names.slice(0, 3).join(", ") + ` +${names.length - 3}` : names.join(", ");
  }
  const RECEIPTS_SINCE = Date.parse("2026-11-21T00:00:00Z"); // older announcements had no "I've read it" button
  const unreadImportant = (p, me) => p.kind === "announce" && (p.at || 0) >= RECEIPTS_SINCE && p.by !== me.key && inAudience(p.audience, me) && !toList(p.readBy).includes(me.key);

  function audiencePicker(anchor, aud, onChange) {
    const inp = h("input", { class: "menu-input", placeholder: "Search people or departments…" }), list = h("div", { class: "fd-aud-list" });
    const toggle = (set, v) => { aud.all = false; set.has(v) ? set.delete(v) : set.add(v); if (!aud.people.size && !aud.depts.size) aud.all = true; };
    const row = (on, lead, label, sub, click) => h("button", { class: "mi compact" + (on ? " on" : ""), onclick: () => { click(); onChange(); draw(); } },
      h("span", { class: "fd-check", text: on ? "✓" : "" }), lead, h("span", { class: "mi-t", text: label }), sub ? h("span", { class: "mi-k", text: sub }) : null);
    const draw = () => {
      const q = inp.value.trim().toLowerCase(), ppl = Data.people(), out = [];
      if (!q || "all employees everyone".includes(q)) out.push(row(aud.all, h("span", { class: "fd-aud-ic", text: "👥" }), "All employees", ppl.length + (ppl.length === 1 ? " person" : " people"), () => { aud.all = true; aud.people.clear(); aud.depts.clear(); }));
      const ds = depts().filter(d => d.toLowerCase().includes(q));
      if (ds.length) out.push(h("div", { class: "menu-sec", text: "Departments" }), ...ds.map(d => row(!aud.all && aud.depts.has(d), h("span", { class: "fd-aud-ic", text: "🏢" }), d, String(ppl.filter(p => p.dept === d).length), () => toggle(aud.depts, d))));
      const ps = ppl.filter(p => (p.name + " " + p.email + " " + (p.dept || "")).toLowerCase().includes(q));
      if (ps.length) out.push(h("div", { class: "menu-sec", text: "People" }), ...ps.map(p => row(!aud.all && aud.people.has(p.key), Apps.avatar(p, 22), p.name + (p.key === Data.me().key ? " (you)" : ""), p.dept || p.title || "", () => toggle(aud.people, p.key))));
      list.replaceChildren(...(out.length ? out : [h("div", { class: "menu-empty", text: "Nobody found" })]));
    };
    inp.addEventListener("input", draw); draw();
    UI.popover(anchor, h("div", { class: "fd-aud" }, inp, list));
    setTimeout(() => inp.focus(), 30);
  }

  // popover listing people in groups: [[title, keys]]
  function whoPop(anchor, groups) {
    const gs = groups.filter(([, ks]) => ks.length);
    UI.popover(anchor, h("div", { class: "fd-who" }, ...(gs.length ? gs.map(([t, ks]) => h("div", null, h("div", { class: "menu-sec", text: `${t} · ${ks.length}` }),
      ...ks.map(k => h("div", { class: "fd-who-row" }, Apps.avatar(Data.person(k), 22), h("span", { text: Data.person(k).name }))))) : [h("div", { class: "menu-empty", text: "Nobody yet" })])));
  }

  /* ---------- files ---------- */
  function lightbox(atts, i) {
    let idx = i;
    const img = h("img", { class: "fd-lb-img", alt: "" }), cap = h("span", { class: "fd-lb-cap" });
    const show = () => { const f = Data.get("files", atts[idx].id); img.src = f?.data || ""; cap.textContent = atts[idx].name + (atts.length > 1 ? ` · ${idx + 1} of ${atts.length}` : ""); };
    const step = n => { idx = (idx + n + atts.length) % atts.length; show(); };
    const onKey = e => { if (e.key === "ArrowLeft") step(-1); if (e.key === "ArrowRight") step(1); };
    const m = UI.modal(null, h("div", { class: "fd-lb" }, img,
      h("div", { class: "fd-lb-bar" }, atts.length > 1 ? h("button", { class: "icon-btn", text: "‹", title: "Previous", onclick: () => step(-1) }) : null, cap,
        atts.length > 1 ? h("button", { class: "icon-btn", text: "›", title: "Next", onclick: () => step(1) }) : null,
        h("button", { class: "btn", text: "Open", onclick: () => Apps.openFile(atts[idx]) }), h("button", { class: "icon-btn", title: "Close", html: UI.icon("x"), onclick: () => m.close() }))),
      { className: "fd-lb-modal", onClose: () => document.removeEventListener("keydown", onKey) });
    document.addEventListener("keydown", onKey);
    img.onclick = () => atts.length > 1 && step(1);
    show();
  }
  function filesBlock(files) {
    files = toList(files); if (!files.length) return null;
    const imgs = files.filter(a => isImg(a) && Data.get("files", a.id)?.data), other = files.filter(a => !imgs.includes(a));
    return h("div", { class: "fd-files" },
      imgs.length ? h("div", { class: "fd-grid n" + Math.min(imgs.length, 4) }, ...imgs.slice(0, 4).map((a, i) => h("button", { class: "fd-thumb", type: "button", title: a.name, onclick: () => lightbox(imgs, i) },
        h("img", { src: Data.get("files", a.id).data, alt: a.name, loading: "lazy" }), i === 3 && imgs.length > 4 ? h("span", { class: "fd-more", text: "+" + (imgs.length - 4) }) : null))) : null,
      other.length ? h("div", { class: "fd-chips" }, ...other.map(a => Apps.fileChip(a))) : null);
  }
  // chip for a File that isn't uploaded yet
  const pendingChip = (x, onRemove) => h("span", { class: "file-chip" + (x.url ? " img" : ""), title: x.file.name },
    x.url ? h("img", { src: x.url, alt: "" }) : h("span", { class: "fc-ic", text: "📎" }), h("span", { class: "fc-n", text: x.file.name }), h("small", { text: Apps.fileSize(x.file.size) }),
    h("button", { class: "fc-x", type: "button", title: "Remove", text: "×", onclick: e => { e.stopPropagation(); onRemove(); } }));
  function toPending(files) {
    const out = [];
    for (let f of files || []) {
      if (f.size > MAX_FILE) { UI.toast(`“${f.name}” is ${Apps.fileSize(f.size)}. Files can be up to 700 KB; share bigger ones as a link.`); continue; }
      if (/^image\//.test(f.type) && /^image\.\w+$/.test(f.name)) f = new File([f], "Pasted image " + new Date().toLocaleTimeString().replace(/:/g, ".") + "." + (f.type.split("/")[1] || "png"), { type: f.type });
      out.push({ file: f, url: /^image\//.test(f.type) ? URL.createObjectURL(f) : null });
    }
    return out;
  }
  const revoke = xs => xs.forEach(x => x.url && URL.revokeObjectURL(x.url));

  /* ---------- events ---------- */
  const longDate = d => d ? new Date(d + "T00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : "";
  const timeText = ev => ev.allDay || !ev.start ? "All day" : ev.start + (ev.finish ? " – " + ev.finish : "");
  const whenText = ev => longDate(ev.date) + (ev.end && ev.end > ev.date ? " – " + longDate(ev.end) : "") + " · " + timeText(ev) + (ev.where ? " · " + ev.where : "");

  function render(root, arg) {
    let kind = "post", tab = "all", busy = false, focusId = arg || null;
    const flt = { q: "", author: null, range: "all", type: "any" };
    const aud = { all: true, people: new Set(), depts: new Set() };
    let pending = [], thanksTo = [], badge = "thanks";
    const expanded = new Set(), cfiles = new Map(); // post id -> pending comment files

    /* ---------- composer ---------- */
    const text = h("textarea", { class: "feed-input", rows: 1, placeholder: HINT.post });
    const grow = () => { text.style.height = "auto"; text.style.height = Math.min(text.scrollHeight, 360) + "px"; };
    text.addEventListener("input", grow);
    Apps.mentionAssist(text);
    const evTitle = h("input", { class: "fd-title-in", placeholder: "Event title", maxlength: 140 });
    const main = h("div", { class: "fd-main" }, evTitle, text);

    const kinds = h("div", { class: "seg fd-kinds" }, ...KINDS.map(([k, l]) => h("button", { type: "button", class: k === kind ? "on" : "", dataset: { k }, text: l, onclick: () => setKind(k) })));

    // event fields
    const evDate = h("input", { class: "menu-input", type: "date", value: Apps.today() });
    const evStart = h("input", { class: "menu-input", type: "time", value: "10:00" }), evFinish = h("input", { class: "menu-input", type: "time", value: "11:00" });
    evStart.onchange = () => { if (evStart.value && (!evFinish.value || evFinish.value <= evStart.value)) { const [hh, mm] = evStart.value.split(":").map(Number); evFinish.value = String(Math.min(hh + 1, 23)).padStart(2, "0") + ":" + String(hh >= 23 ? 59 : mm).padStart(2, "0"); } };
    let allDay = false;
    const allDaySw = h("span", { class: "switch" }), lab = (l, el) => h("label", { class: "fd-lab" }, h("span", { text: l }), el);
    const times = h("div", { class: "fd-times" }, lab("Starts", evStart), lab("Ends", evFinish));
    const allDayBtn = h("button", { type: "button", class: "chip-btn fd-allday", onclick: () => { allDay = !allDay; allDaySw.classList.toggle("on", allDay); times.classList.toggle("off", allDay); evStart.disabled = evFinish.disabled = allDay; } }, allDaySw, "All day");
    const evWhere = h("input", { class: "menu-input", placeholder: "📍 Place or meeting link" });
    const evBox = h("div", { class: "fd-box fd-evbox" }, h("div", { class: "fd-evrow" }, lab("Date", evDate), times, allDayBtn), evWhere,
      h("div", { class: "fd-hint", text: "Everyone in “To” gets an invitation and can answer Going, Maybe or Can't go." }));

    // poll fields
    const opts = [];
    const addOpt = () => { const i = h("input", { class: "menu-input", placeholder: "Option " + (opts.length + 1) }); opts.push(i); pollBox.insertBefore(i, addOptBtn); return i; };
    const addOptBtn = h("button", { type: "button", class: "chip-btn", text: "+ Option", onclick: () => addOpt().focus() });
    const pollBox = h("div", { class: "fd-box poll-edit" }, addOptBtn);
    addOpt(); addOpt();

    // appreciation fields
    const thanksBtn = h("button", { type: "button", class: "chip-btn fd-thanks-btn", onclick: () => Apps.peoplePicker(thanksBtn, thanksTo, ks => { thanksTo = ks; paintThanks(); }, { exclude: [Data.me().key], placeholder: "Who are you thanking?" }) });
    const paintThanks = () => thanksBtn.replaceChildren(thanksTo.length ? Apps.avatars(thanksTo, 20) : "🙌", h("span", { text: thanksTo.length ? thanksTo.map(k => firstName(Data.person(k).name)).join(", ") : "Choose teammates…" }));
    const badgeSeg = h("div", { class: "seg fd-badges" }, ...Object.entries(BADGES).map(([k, [e, l]]) => h("button", { type: "button", class: k === badge ? "on" : "", text: e + " " + l, onclick: ev => { badge = k; badgeSeg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === ev.currentTarget)); } })));
    const thanksBox = h("div", { class: "fd-box fd-thanksbox" }, thanksBtn, badgeSeg);
    paintThanks();

    // attachments
    const filesBox = h("div", { class: "fd-pending" });
    const pickInto = async () => { const fs = await Apps.pickFiles(true); addFiles(fs); };
    const addFiles = fs => { const xs = toPending(fs); if (!xs.length) return; pending.push(...xs); expand(); paintFiles(); };
    function paintFiles() {
      filesBox.replaceChildren(...pending.map(x => pendingChip(x, () => { revoke([x]); pending = pending.filter(y => y !== x); paintFiles(); })),
        kind === "file" || pending.length ? h("button", { type: "button", class: "fd-drop", onclick: pickInto }, pending.length ? "+ Add more" : "📎 Choose files or drop them here · images can be pasted") : null);
    }

    // audience ("To:")
    const toRow = h("div", { class: "fd-torow" });
    const tag = (label, onRemove, lead) => h("span", { class: "fd-tag" }, lead || null, h("span", { text: label }), h("button", { type: "button", class: "fd-tag-x", title: "Remove", text: "×", onclick: onRemove }));
    const settle = () => { if (!aud.people.size && !aud.depts.size) aud.all = true; paintTo(); };
    function paintTo() {
      const chips = aud.all ? [h("span", { class: "fd-tag all", text: "👥 All employees" })]
        : [...[...aud.depts].map(d => tag("🏢 " + d, () => { aud.depts.delete(d); settle(); })), ...[...aud.people].map(k => tag(Data.person(k).name, () => { aud.people.delete(k); settle(); }, Apps.avatar(Data.person(k), 18)))];
      toRow.replaceChildren(h("span", { class: "fd-to-l", text: "To:" }), ...chips, h("button", { type: "button", class: "fd-tag add", text: aud.all ? "Change" : "+ Add", onclick: e => audiencePicker(e.currentTarget, aud, paintTo) }));
    }
    paintTo();

    const pubBtn = h("button", { class: "btn primary", text: "Publish", onclick: publish });
    const bar = h("div", { class: "fc-bar" },
      h("button", { type: "button", class: "icon-btn fd-attach", title: "Attach files", text: "📎", onclick: pickInto }),
      h("button", { type: "button", class: "icon-btn fd-at", title: "Mention someone", text: "@", onclick: () => { const p = text.selectionStart ?? text.value.length, pre = text.value.slice(0, p); const ins = (pre && !/\s$/.test(pre) ? " " : "") + "@"; text.value = pre + ins + text.value.slice(p); text.focus(); text.selectionStart = text.selectionEnd = p + ins.length; text.dispatchEvent(new Event("input")); } }),
      h("span", { class: "grow" }),
      h("button", { type: "button", class: "btn fd-cancel", text: "Cancel", onclick: () => reset() }), pubBtn);
    const extra = h("div", { class: "fd-extra" }, evBox, pollBox, thanksBox, filesBox, toRow, bar);
    const composer = h("div", { class: "feed-compose glass collapsed", dataset: { kind: "post" } }, h("div", { class: "fd-kinds-wrap" }, kinds), h("div", { class: "fc-top" }, Apps.avatar(Data.me(), 36), main), extra);

    function setKind(k) {
      kind = k;
      kinds.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.k === k));
      composer.dataset.kind = k;
      text.placeholder = HINT[k];
      paintFiles(); expand();
      setTimeout(() => (k === "event" ? evTitle : k === "file" && !pending.length ? null : text)?.focus(), 20);
    }
    function expand() { if (composer.classList.contains("collapsed")) { composer.classList.remove("collapsed"); composer.dataset.kind = kind; } }
    const isEmpty = () => kind === "post" && !text.value.trim() && !pending.length;
    const collapse = () => { composer.classList.add("collapsed"); text.blur(); };
    composer.addEventListener("focusin", expand);
    composer.addEventListener("click", e => { if (composer.classList.contains("collapsed") && !e.target.closest("button")) { expand(); text.focus(); } });
    const onDocDown = e => { if (!composer.classList.contains("collapsed") && !composer.contains(e.target) && !e.target.closest("#layer") && isEmpty()) collapse(); };
    document.addEventListener("mousedown", onDocDown);
    text.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); publish(); } if (e.key === "Escape" && isEmpty()) collapse(); });
    text.addEventListener("paste", e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } });
    composer.addEventListener("dragover", e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); composer.classList.add("drag"); } });
    composer.addEventListener("dragleave", e => { if (!composer.contains(e.relatedTarget)) composer.classList.remove("drag"); });
    composer.addEventListener("drop", e => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); composer.classList.remove("drag"); addFiles([...e.dataTransfer.files]); });

    function reset() {
      text.value = ""; evTitle.value = ""; evWhere.value = ""; evDate.value = Apps.today(); evStart.value = "10:00"; evFinish.value = "11:00";
      if (allDay) allDayBtn.click();
      opts.forEach(o => (o.value = "")); thanksTo = []; paintThanks();
      revoke(pending); pending = [];
      aud.all = true; aud.people.clear(); aud.depts.clear(); paintTo();
      kind = "post"; kinds.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.k === "post")); text.placeholder = HINT.post; composer.dataset.kind = "post";
      paintFiles(); grow(); collapse();
    }

    async function publish() {
      if (busy) return;
      const t = text.value.trim(), me = Data.me();
      const audience = aud.all ? { all: true } : { people: [...aud.people], depts: [...aud.depts] };
      const options = opts.map(o => o.value.trim()).filter(Boolean);
      if (kind === "poll" && (!t || options.length < 2)) return UI.toast("A poll needs a question and at least 2 options");
      if (kind === "thanks" && !thanksTo.length) return UI.toast("Choose who you're thanking");
      if (kind === "event") {
        if (!evTitle.value.trim()) { evTitle.focus(); return UI.toast("Give the event a title"); }
        if (!evDate.value) return UI.toast("Pick a date");
        if (!allDay && evStart.value && evFinish.value && evFinish.value <= evStart.value) return UI.toast("The event ends before it starts");
      }
      if (kind === "file" && !pending.length) { pickInto(); return UI.toast("Add at least one file"); }
      if ((kind === "post" || kind === "announce") && !t && !pending.length) return text.focus();
      busy = true; pubBtn.disabled = true; pubBtn.textContent = pending.length ? "Uploading…" : "Publishing…";
      try {
        const files = pending.length ? await Apps.attach(pending.map(x => x.file)) : [];
        if (kind === "file" && !files.length && !t) return;
        const base = { text: t, audience, files, likes: [], comments: [] };
        const rcpt = recipients(audience).filter(k => k !== me.key), told = new Set(), who = `<b>${esc(me.name)}</b>`;
        let id;
        if (kind === "poll") id = await Data.add("feed", { ...base, kind: "poll", poll: options.map(o => ({ t: o, votes: [] })) });
        else if (kind === "thanks") {
          const [e, l] = BADGES[badge];
          id = await Data.add("feed", { ...base, kind: "thanks", text: t || l + "!", to: thanksTo, badge });
          thanksTo.forEach(k => { Data.notify(k, `${e} ${who} ${badge === "thanks" ? "thanked you" : `gave you a “${esc(l)}” badge`} on the feed`, link(id), t || l + "!"); told.add(k); });
        } else if (kind === "event") {
          const title = evTitle.value.trim();
          const ev = { title, date: evDate.value, allDay, start: allDay ? "" : evStart.value, finish: allDay ? "" : evFinish.value, where: evWhere.value.trim(), desc: t, color: "#7c5cff",
            owner: me.key, attendees: { ...Object.fromEntries(rcpt.map(k => [k, "pending"])), [me.key]: "yes" }, calendar: "company", repeat: null, remind: null, files };
          const evId = await Data.add("events", ev);
          id = await Data.add("feed", { ...base, kind: "event", event: evId });
          rcpt.forEach(k => { Data.notify(k, `📅 ${who} invited you to “${esc(title)}”`, "#/app/calendar/" + encodeURIComponent(evId), whenText(ev)); told.add(k); });
        } else {
          const ann = kind === "announce";
          id = await Data.add("feed", { ...base, kind: ann ? "announce" : "post", pinned: ann, ...(ann ? { readBy: [] } : {}) });
          if (ann) rcpt.forEach(k => { Data.notify(k, `📣 ${who} posted an announcement`, link(id), t || "📎 " + files.map(f => f.name).join(", ")); told.add(k); });
        }
        const reach = new Set([...rcpt, ...thanksTo]);
        Apps.mentioned(t).filter(k => k !== me.key && !told.has(k) && reach.has(k)).forEach(k => Data.notify(k, `💬 ${who} mentioned you in a post`, link(id), t));
        UI.toast(kind === "event" ? "📅 Event published and added to the calendar" : "Published");
        reset();
      } finally { busy = false; pubBtn.disabled = false; pubBtn.textContent = "Publish"; }
    }

    /* ---------- tabs + filter bar ---------- */
    const tabsEl = Apps.tabs([["all", "All"], ["announce", "Announcements"], ["poll", "Polls"], ["thanks", "Appreciation"], ["unread", "Unread important"], ["mine", "My posts"]], tab, k => { tab = k; draw(); });
    const unreadTab = [...tabsEl.children][4];
    const search = h("input", { class: "menu-input fd-search", type: "search", placeholder: "Search posts, people, files…" });
    let sT; search.addEventListener("input", () => { clearTimeout(sT); sT = setTimeout(() => { flt.q = search.value; paintFilters(); draw(); }, 150); });
    const authorBtn = h("button", { type: "button", class: "chip-btn", onclick: e => { if (e.target.closest(".fd-x")) { flt.author = null; paintFilters(); return draw(); } Apps.personPicker(authorBtn, p => { flt.author = p?.key || null; paintFilters(); draw(); }, { allowNone: true }); } });
    const pickMenu = (btn, items, key) => UI.menu(btn, items.map(([k, l]) => ({ label: l, iconHtml: flt[key] === k ? "✓" : "", onClick: () => { flt[key] = k; paintFilters(); draw(); } })));
    const rangeBtn = h("button", { type: "button", class: "chip-btn", onclick: () => pickMenu(rangeBtn, RANGES, "range") });
    const typeBtn = h("button", { type: "button", class: "chip-btn", onclick: () => pickMenu(typeBtn, TYPES, "type") });
    const clearBtn = h("button", { type: "button", class: "fd-clear", text: "Clear filters", onclick: () => { resetFilters(); draw(); } });
    // group posts stay in their workgroup; members can choose to see them here too
    let showGroups = false; try { showGroups = localStorage.getItem("lumen-feed-groups") === "1"; } catch {}
    const groupsBtn = h("button", { type: "button", class: "chip-btn", title: "Show posts from your workgroups", text: "👥 Group posts", style: { display: "none" },
      onclick: () => { showGroups = !showGroups; try { localStorage.setItem("lumen-feed-groups", showGroups ? "1" : "0"); } catch {} groupsBtn.classList.toggle("on", showGroups); draw(); } });
    groupsBtn.classList.toggle("on", showGroups);
    const filtersOn = () => !!(flt.q.trim() || flt.author || flt.range !== "all" || flt.type !== "any");
    function paintFilters() {
      authorBtn.replaceChildren(...(flt.author ? [Apps.avatar(Data.person(flt.author), 18), h("span", { text: Data.person(flt.author).name }), h("span", { class: "fd-x", title: "Anyone", text: "×" })] : [h("span", { text: "👤 Anyone" })]));
      rangeBtn.textContent = "🗓️ " + RANGES.find(r => r[0] === flt.range)[1];
      typeBtn.textContent = "🏷️ " + TYPES.find(r => r[0] === flt.type)[1];
      authorBtn.classList.toggle("on", !!flt.author); rangeBtn.classList.toggle("on", flt.range !== "all"); typeBtn.classList.toggle("on", flt.type !== "any");
      clearBtn.style.display = filtersOn() ? "" : "none";
    }
    function resetFilters() {
      Object.assign(flt, { q: "", author: null, range: "all", type: "any" }); search.value = ""; paintFilters();
      tab = "all"; [...tabsEl.children].forEach((b, i) => b.classList.toggle("on", i === 0));
    }
    paintFilters();
    const filterBar = h("div", { class: "fd-filters glass" }, search, authorBtn, rangeBtn, typeBtn, groupsBtn, clearBtn);

    const list = h("div", { class: "feed-list" });
    root.append(Apps.header("Activity Feed", "📰", "News and updates from your workspace"), composer, tabsEl, filterBar, list);

    /* ---------- list (only rebuilds posts that changed) ---------- */
    const built = new Map(); // post id -> { sig, el }
    let firstDraw = true;
    const watched = new Set(); let laterT;
    const later = () => { clearTimeout(laterT); laterT = setTimeout(draw, 40); };
    let dead = false;
    const watch = col => { if (watched.has(col)) return; watched.add(col); setTimeout(() => { if (!dead) offs.push(Data.on(col, later)); }); };
    const weekStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
    const haystack = p => {
      const ev = p.kind === "event" ? Data.get("events", p.event) : null;
      return [p.text, Data.person(p.by).name, ev?.title, ev?.where, ...toList(p.files).map(f => f.name), ...toList(p.poll).map(o => o.t), ...toList(p.to).map(k => Data.person(k).name),
        ...toList(p.comments).map(c => c.text)].join(" ").toLowerCase();
    };
    function sig(p) {
      const ev = p.kind === "event" ? Data.get("events", p.event) : null;
      const atts = [...toList(p.files), ...toList(p.comments).flatMap(c => toList(c.files))];
      return JSON.stringify([p.text, p.likes, p.comments, p.poll, p.pinned, p.to, p.kind, p.audience, p.files, p.readBy, p.edited, p.commentLikes, p.badge,
        ev ? [ev.title, ev.date, ev.end, ev.allDay, ev.start, ev.finish, ev.where, ev.attendees] : 0, atts.map(a => !!Data.get("files", a.id)), expanded.has(p.id)]);
    }
    function draw() {
      const me = self(), vis = Data.list("feed").filter(p => canSee(p, me));
      const all = vis.filter(p => !p.group || showGroups || p.id === focusId);
      if (Data.list("feed").some(p => p.group)) watch("projects");
      groupsBtn.style.display = vis.some(p => p.group) ? "" : "none";
      if (all.some(p => p.kind === "event")) watch("events");
      if (all.some(p => toList(p.files).length || toList(p.comments).some(c => toList(c.files).length))) watch("files");
      const unread = all.filter(p => unreadImportant(p, me)).length;
      unreadTab.textContent = "Unread important" + (unread ? ` · ${unread}` : "");
      const now = new Date(), since = flt.range === "week" ? weekStart() : flt.range === "month" ? new Date(now.getFullYear(), now.getMonth(), 1).getTime() : 0, q = flt.q.trim().toLowerCase();
      const posts = all.filter(p => tab === "all" || (tab === "mine" ? p.by === me.key : tab === "unread" ? unreadImportant(p, me) : p.kind === tab))
        .filter(p => (!flt.author || p.by === flt.author) && (!since || (p.at || 0) >= since)
          && (flt.type === "any" || (flt.type === "files" ? toList(p.files).length > 0 : (p.kind || "post") === flt.type)) && (!q || haystack(p).includes(q)))
        .sort((a, b) => !!b.pinned - !!a.pinned || (b.at || 0) - (a.at || 0));
      const exists = new Set(Data.list("feed").map(p => p.id));
      for (const id of built.keys()) if (!exists.has(id)) built.delete(id);
      if (!posts.length) {
        list.replaceChildren(Apps.empty(tab === "unread" ? "✅" : filtersOn() ? "🔎" : "📰", tab === "unread" ? "You've read every important post." : filtersOn() || tab !== "all" ? "No posts match these filters." : "Nothing here yet. Write the first post!",
          filtersOn() ? h("button", { class: "btn", text: "Clear filters", onclick: () => { resetFilters(); draw(); } }) : null));
      } else {
        let refocus = null;
        const els = posts.map((p, i) => {
          const s = sig(p), old = built.get(p.id);
          if (old && old.sig === s) return old.el;
          const el = post(p, i);
          if (!firstDraw) el.classList.add(old ? "no-anim" : "fd-new");
          if (old) { // keep a comment someone is typing on this post
            const was = old.el.querySelector(".fp-cin"), now = el.querySelector(".fp-cin");
            if (was && now) { if (was.value) now.value = was.value; if (document.activeElement === was) refocus = [now, was.selectionStart, was.selectionEnd]; }
          }
          built.set(p.id, { sig: s, el });
          return el;
        });
        els.forEach((el, i) => { if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null); });
        while (list.children.length > els.length) list.lastChild.remove();
        if (refocus) { const [el, a, b] = refocus; el.focus(); try { el.setSelectionRange(a, b); } catch {} }
      }
      firstDraw = false;
      refreshTimes();
      if (focusId) {
        const b = built.get(focusId);
        if (b && b.el.isConnected) {
          const el = b.el; focusId = null;
          requestAnimationFrame(() => { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.remove("flash", "fd-new"); el.classList.add("no-anim"); el.style.animationDelay = "0ms"; void el.offsetWidth; el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 2600); });
        } else if (all.some(p => p.id === focusId) && (tab !== "all" || filtersOn())) { resetFilters(); draw(); }
      }
    }
    function refreshTimes() { list.querySelectorAll(".fd-time[data-at]").forEach(el => { const t = UI.timeAgo(+el.dataset.at); if (el.textContent !== t) el.textContent = t; }); }
    const redrawAll = () => {
      const typed = {}; let focus = null;
      built.forEach(({ el }, id) => { const c = el.querySelector(".fp-cin"); if (c?.value) typed[id] = c.value; if (c && document.activeElement === c) focus = id; });
      built.clear(); draw();
      built.forEach(({ el }, id) => { const c = el.querySelector(".fp-cin"); if (c && typed[id]) c.value = typed[id]; if (c && id === focus) c.focus(); });
    };

    /* ---------- one post ---------- */
    async function editPost(p) {
      const pr = Apps.form("Edit post", [{ key: "text", label: p.kind === "poll" ? "Question" : "Text", type: "textarea", rows: 6 }], { text: p.text || "" }, { ok: "Save" });
      const ta = [...document.querySelectorAll("#layer .modal textarea")].pop(); if (ta) Apps.mentionAssist(ta);
      const v = await pr; if (!v) return;
      const t = String(v.text || "").trim();
      if (t === (p.text || "")) return;
      if (!t && (p.kind === "post" || p.kind === "announce" || p.kind === "poll") && !toList(p.files).length) return UI.toast("A post can't be empty");
      Data.update("feed", p.id, { text: t, edited: true });
      const before = new Set(Apps.mentioned(p.text)), reach = new Set([...recipients(p.audience), ...toList(p.to)]), me = Data.me();
      Apps.mentioned(t).filter(k => !before.has(k) && k !== me.key && reach.has(k)).forEach(k => Data.notify(k, `💬 <b>${esc(me.name)}</b> mentioned you in a post`, link(p.id), t));
    }
    async function deletePost(p) {
      const ev = p.kind === "event" ? Data.get("events", p.event) : null, withEv = ev && ev.owner === Data.me().key;
      if (!(await UI.confirm(withEv ? "Delete this post and its calendar event?" : "Delete this post?"))) return;
      Data.remove("feed", p.id); if (withEv) Data.remove("events", ev.id);
    }
    function copyLink(p) {
      const url = location.origin + location.pathname + link(p.id);
      (navigator.clipboard?.writeText(url) || Promise.reject()).then(() => UI.toast("🔗 Link copied"), () => UI.toast(url));
    }

    function eventCard(p, me) {
      const ev = Data.get("events", p.event);
      if (!ev) return h("div", { class: "fd-event missing", text: "📅 This event is no longer in the calendar" });
      const att = ev.attendees || {}, mine = att[me], st = s => Object.keys(att).filter(k => att[k] === s);
      const invited = mine != null || isAll(p.audience), d = new Date(ev.date + "T00:00");
      const rsvp = (v, l) => h("button", { type: "button", class: "fd-rsvp " + v + (mine === v ? " on" : ""), text: l, onclick: () => Data.update("events", ev.id, { attendees: { ...(ev.attendees || {}), [me]: v } }) });
      const [yes, maybe, no, wait] = ["yes", "maybe", "no", "pending"].map(st);
      return h("div", { class: "fd-event" },
        h("div", { class: "fd-date" }, h("small", { text: d.toLocaleDateString(undefined, { month: "short" }) }), h("b", { text: d.getDate() }), h("span", { text: d.toLocaleDateString(undefined, { weekday: "short" }) })),
        h("div", { class: "fd-ev-main" },
          h("div", { class: "fd-ev-title", text: ev.title || "Event" }),
          h("div", { class: "fd-ev-line", text: "🕒 " + longDate(ev.date) + (ev.end && ev.end > ev.date ? " – " + longDate(ev.end) : "") + " · " + timeText(ev) }),
          ev.where ? h("div", { class: "fd-ev-line", text: "📍 " + ev.where }) : null,
          h("button", { type: "button", class: "fd-ev-counts", title: "See who's coming", onclick: e => whoPop(e.currentTarget, [["Going", yes], ["Maybe", maybe], ["Can't go", no], ["No answer yet", wait]]) },
            h("span", { class: "g", text: `${yes.length} going` }), h("span", { text: `${maybe.length} maybe` }), h("span", { text: `${no.length} declined` }), wait.length ? h("span", { class: "w", text: `${wait.length} no answer` }) : null),
          h("div", { class: "fd-ev-acts" }, invited ? [rsvp("yes", "✓ Going"), rsvp("maybe", "Maybe"), rsvp("no", "Can't go")] : null,
            h("a", { class: "btn fd-ev-open", href: "#/app/calendar/" + encodeURIComponent(ev.id), text: "Open in calendar" }))));
    }

    function post(p, i) {
      const meP = self(), me = meP.key, author = Data.person(p.by), likes = toList(p.likes), liked = likes.includes(me);
      const body = [];
      if (p.kind === "announce") body.push(h("div", { class: "fp-badge announce", text: "📣 Announcement" }));
      if (p.kind === "thanks") {
        const tos = toList(p.to), [e, l] = BADGES[p.badge] || BADGES.thanks;
        body.push(h("div", { class: "thanks-card fd-thanks b-" + (BADGES[p.badge] ? p.badge : "thanks") }, h("span", { class: "medal", text: e }), Apps.avatars(tos, 38, 5),
          h("div", { class: "fd-thanks-t" }, h("b", { text: tos.map(k => Data.person(k).name).join(", ") || "A teammate" }), h("div", { text: `${l} · from ${author.name}` }))));
      }
      if (p.text) body.push(h("div", { class: "fd-text", html: rich(p.text) }));
      if (p.kind === "event") body.push(eventCard(p, me));
      if (p.kind === "poll" && Array.isArray(p.poll)) {
        const total = p.poll.reduce((a, o) => a + toList(o.votes).length, 0), voted = p.poll.some(o => toList(o.votes).includes(me));
        body.push(h("div", { class: "poll" }, ...p.poll.map((o, idx) => {
          const votes = toList(o.votes), pct = total ? Math.round(votes.length / total * 100) : 0, mine = votes.includes(me);
          return h("button", { class: "poll-opt" + (mine ? " on" : ""), onclick: () => Data.update("feed", p.id, { poll: p.poll.map((x, j) => ({ ...x, votes: j === idx ? (mine ? toList(x.votes).filter(k => k !== me) : [...toList(x.votes).filter(k => k !== me), me]) : toList(x.votes).filter(k => k !== me) })) }) },
            h("span", { class: "po-bar", style: { width: (voted ? pct : 0) + "%" } }), h("span", { class: "po-t", text: (mine ? "✓ " : "") + o.t }), voted ? h("span", { class: "po-p", text: pct + "%" }) : null);
        }), h("small", { text: `${total} vote${total === 1 ? "" : "s"}` })));
      }
      const fb = filesBlock(p.files); if (fb) body.push(fb);
      if (p.kind === "announce") {
        const rc = recipients(p.audience).filter(k => k !== p.by), rb = toList(p.readBy), read = rc.filter(k => rb.includes(k)), iRead = rb.includes(me);
        body.push(h("div", { class: "fd-read" },
          p.by !== me && inAudience(p.audience, meP) ? h("button", { type: "button", class: "btn " + (iRead ? "fd-done" : "primary"), text: iRead ? "✓ You've read it" : "I've read it ✓", disabled: iRead, onclick: () => Data.arr("feed", p.id, "readBy", me) }) : null,
          h("button", { type: "button", class: "fd-readby", title: "See who has read it", onclick: e => whoPop(e.currentTarget, [["Read", read], ["Not yet", rc.filter(k => !rb.includes(k))]]) },
            h("span", { class: "fd-meter" }, h("i", { style: { width: (rc.length ? Math.round(read.length / rc.length * 100) : 0) + "%" } })), `Read by ${read.length} of ${rc.length}`)));
      }

      // comments
      const cs = toList(p.comments), open = expanded.has(p.id), shown = open || cs.length <= 3 ? cs : cs.slice(-3), clikes = toList(p.commentLikes);
      const cin = h("input", { class: "menu-input fp-cin", placeholder: "Write a comment…  @ to mention" });
      const cfBox = h("div", { class: "fd-cfiles" });
      const paintCF = () => cfBox.replaceChildren(...(cfiles.get(p.id) || []).map(x => pendingChip(x, () => { revoke([x]); cfiles.set(p.id, (cfiles.get(p.id) || []).filter(y => y !== x)); paintCF(); })));
      const addCF = fs => { const xs = toPending(fs); if (!xs.length) return; cfiles.set(p.id, [...(cfiles.get(p.id) || []), ...xs]); paintCF(); cin.focus(); };
      paintCF();
      Apps.mentionAssist(cin);
      cin.addEventListener("paste", e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addCF(fs); } });
      const reply = who => { if (who.key !== me) { const tagTxt = "@" + Apps.handleOf(who) + " "; if (!cin.value.includes(tagTxt.trim())) cin.value = tagTxt + cin.value; } cin.focus(); cin.setSelectionRange(cin.value.length, cin.value.length); };
      async function send() {
        const txt = cin.value.trim(), fl = cfiles.get(p.id) || [];
        if (!txt && !fl.length) return;
        cin.value = ""; cfiles.delete(p.id); paintCF(); // clear first: saving redraws the post straight away
        const files = fl.length ? await Apps.attach(fl.map(x => x.file)) : []; revoke(fl);
        if (!txt && !files.length) return;
        const c = { id: Data.uid(), by: me, text: txt, at: Date.now(), ...(files.length ? { files } : {}) };
        Data.arr("feed", p.id, "comments", c);
        const who = `<b>${esc(Data.me().name)}</b>`, told = new Set([me]), preview = txt || "📎 " + files.map(f => f.name).join(", ");
        if (p.by !== me) { Data.notify(p.by, `💬 ${who} commented on your post`, link(p.id), preview); told.add(p.by); }
        const reach = new Set([...recipients(p.audience), p.by, ...toList(p.to)]);
        Apps.mentioned(txt).filter(k => !told.has(k) && reach.has(k)).forEach(k => Data.notify(k, `💬 ${who} mentioned you in a comment`, link(p.id), txt));
      }
      cin.onkeydown = e => { if (e.key !== "Enter" || e.isComposing || e.shiftKey) return; e.preventDefault(); send(); };
      const cmt = c => {
        const id = cid(c), mineLikes = clikes.filter(x => x.startsWith(id + "|")), cl = mineLikes.includes(id + "|" + me), who = Data.person(c.by);
        return h("div", { class: "cmt" }, Apps.avatar(who, 28), h("div", { class: "fd-cbody" },
          h("div", { class: "fd-bubble" }, h("div", { class: "cmt-h" }, h("b", { text: who.name }), h("small", { class: "fd-time", dataset: { at: c.at }, text: UI.timeAgo(c.at) })),
            c.text ? h("div", { class: "cmt-t", html: rich(c.text) }) : null, filesBlock(c.files)),
          h("div", { class: "fd-cacts" },
            h("button", { type: "button", class: cl ? "on" : "", title: mineLikes.map(x => Data.person(x.split("|")[1]).name).join(", "), text: (cl ? "❤️ Liked" : "Like") + (mineLikes.length ? " · " + mineLikes.length : ""), onclick: () => Data.arr("feed", p.id, "commentLikes", id + "|" + me, !cl) }),
            h("button", { type: "button", text: "Reply", onclick: () => reply(who) }),
            c.by === me ? h("button", { type: "button", text: "Delete", onclick: async () => { if (await UI.confirm("Delete this comment?")) Data.arr("feed", p.id, "comments", c, false); } }) : null)));
      };

      const menuItems = [
        { label: "Copy link", icon: "link", onClick: () => copyLink(p) },
        ...(p.by === me ? [
          { label: "Edit", icon: "text", onClick: () => editPost(p) },
          { label: p.pinned ? "Unpin" : "Pin to top", icon: "star", onClick: () => Data.update("feed", p.id, { pinned: !p.pinned }) },
          { sep: true },
          { label: "Delete post", icon: "trash", danger: true, onClick: () => deletePost(p) }] : []),
      ];
      const sub = [p.group ? h("span", { class: "fd-tol" }, "in ", h("a", { href: "#/app/groups/" + encodeURIComponent(p.group) + "/feed", text: groupName(p.group), style: { color: "var(--accent)", fontWeight: 600, textDecoration: "none" } }))
        : h("span", { class: "fd-tol" }, "To: ", h("b", { text: audienceLabel(p.audience) })), " · ", h("span", { class: "fd-time", dataset: { at: p.at }, text: UI.timeAgo(p.at) }),
        p.kind === "poll" ? " · Poll" : p.kind === "event" ? " · Event" : null, p.edited ? h("span", { class: "fd-edited", text: " · edited" }) : null];
      const cls = "feed-post glass" + (p.kind === "announce" ? " announce" : "") + (p.pinned ? " pinned" : "") + (unreadImportant(p, meP) ? " unread-imp" : "");
      return h("article", { class: cls, dataset: { id: p.id }, style: { animationDelay: firstDraw ? Math.min(i * 40, 300) + "ms" : "0ms" } },
        h("div", { class: "fp-head" }, Apps.avatar(author, 40),
          h("div", { class: "grow fd-headt" }, h("div", { class: "fd-name" }, h("b", { text: author.name }), p.pinned ? h("span", { class: "fd-pin", text: "📌 Pinned" }) : null), h("div", { class: "app-sub fd-sub" }, ...sub)),
          h("button", { class: "icon-btn xs", title: "More", html: UI.icon("dots"), onclick: e => UI.menu(e.currentTarget, menuItems, { align: "end" }) })),
        ...body,
        h("div", { class: "fp-bar" },
          h("button", { type: "button", class: "like" + (liked ? " on" : ""), title: likes.map(k => Data.person(k).name).join(", "), onclick: () => Data.arr("feed", p.id, "likes", me, !liked) }, (liked ? "❤️" : "🤍") + " " + (likes.length || "Like")),
          h("button", { type: "button", class: "like", onclick: () => cin.focus() }, `💬 ${cs.length || "Comment"}`),
          h("span", { class: "grow" }),
          likes.length ? h("span", { class: "fd-likers" }, Apps.avatars(likes, 20, 4)) : null),
        cs.length ? h("div", { class: "comments" },
          cs.length > 3 ? h("button", { type: "button", class: "fd-more-c", text: open ? "Show fewer comments" : `Show all ${cs.length} comments`, onclick: () => { open ? expanded.delete(p.id) : expanded.add(p.id); draw(); } }) : null,
          ...shown.map(cmt)) : null,
        h("div", { class: "fd-cin" }, Apps.avatar(Data.me(), 28), cin,
          h("button", { type: "button", class: "icon-btn xs fd-cattach", title: "Attach files", text: "📎", onclick: async () => addCF(await Apps.pickFiles(true)) })),
        cfBox);
    }

    // live: every like, comment, vote, RSVP and new post from anyone shows up immediately
    const offs = [Data.on("feed", draw), Data.on("people", redrawAll)];
    // keep "2 min ago" fresh without rebuilding posts
    const tick = setInterval(refreshTimes, 60000);
    offs.push(() => (dead = true), () => clearInterval(tick), () => clearTimeout(laterT), () => document.removeEventListener("mousedown", onDocDown), () => { revoke(pending); cfiles.forEach(revoke); });
    return () => offs.forEach(f => f());
  }

  Apps.register("feed", { title: "Feed", icon: "📰", render });
  // shared: who can see a post (used by the Home dashboard)
  window.FeedAPI = { canSee: p => canSee(p, self()) };
})();
