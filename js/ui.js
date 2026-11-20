/* UI helpers: element builder, popovers, menus, modals, toasts, pickers */
(function () {
  const layer = () => document.getElementById("layer");

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k === "text") el.textContent = v;
      else if (k === "style" && typeof v === "object") for (const [sk, sv] of Object.entries(v)) sk.startsWith("--") ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
      else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k === "draggable") el.setAttribute(k, v ? "true" : "false"); // must be the string "true"; "" means not draggable
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  // let replaceChildren skip null/false like h() does (otherwise it renders the text "null")
  const _rc = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function (...kids) { return _rc.apply(this, kids.flat().filter(k => k != null && k !== false)); };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const svg = d => `<svg class="ico sm" viewBox="0 0 24 24"><path d="${d}"/></svg>`;
  const ICONS = {
    plus: "M12 5v14M5 12h14", drag: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01", dots: "M5 12h.01M12 12h.01M19 12h.01",
    caret: "M9 6l6 6-6 6", trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3", copy: "M8 8h12v12H8zM4 16V4h12",
    link: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1", star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z",
    image: "M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4", smile: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01",
    restore: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5", x: "M6 6l12 12M18 6L6 18", arrow: "M5 12h14M13 6l6 6-6 6", page: "M6 3h8l4 4v14H6zM14 3v4h4",
    download: "M12 4v12M6 10l6 6 6-6M4 20h16", lock: "M6 11h12v9H6zM8 11V7a4 4 0 0 1 8 0v4", expand: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
    text: "M5 6h14M12 6v13", color: "M12 3l7 18M12 3L5 21M8 14h8", turn: "M4 7h12l-3-3M20 17H8l3 3", table: "M3 5h18v14H3zM3 10h18M9 5v14",
    board: "M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v13h-4z", gallery: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  };
  const icon = name => svg(ICONS[name] || ICONS.page);

  /* ---------- Popovers ---------- */
  const pops = [];
  function place(el, anchor, align = "start") {
    const r = anchor instanceof Element && anchor.isConnected ? anchor.getBoundingClientRect()
      : anchor && "top" in anchor ? anchor : { left: innerWidth / 2 - 130, right: innerWidth / 2 + 130, top: innerHeight / 3, bottom: innerHeight / 3 };
    const pw = el.offsetWidth, ph = el.offsetHeight, vw = innerWidth, vh = innerHeight;
    let x = align === "end" ? r.right - pw : r.left;
    let y = r.bottom + 6;
    if (y + ph > vh - 10) { y = r.top - ph - 6; el.style.transformOrigin = "bottom left"; }
    if (y < 10) y = 10;
    x = Math.max(10, Math.min(x, vw - pw - 10));
    el.style.left = x + "px"; el.style.top = y + "px";
  }
  function popover(anchor, content, opts = {}) {
    if (!opts.keep) closePops();
    const el = h("div", { class: "pop glass-strong " + (opts.className || "") }, content);
    layer().append(el);
    place(el, anchor, opts.align);
    const api = {
      el, closed: false,
      close() {
        if (api.closed) return; api.closed = true;
        pops.splice(pops.indexOf(api), 1);
        el.classList.add("closing"); setTimeout(() => el.remove(), 140);
        opts.onClose && opts.onClose();
      },
      reposition: a => place(el, a || anchor, opts.align),
    };
    pops.push(api);
    return api;
  }
  function closePops() { [...pops].forEach(p => p.close()); }
  document.addEventListener("mousedown", e => {
    for (const p of [...pops].reverse()) if (!p.el.contains(e.target) && !e.target.closest("[data-keep-pop]")) p.close();
  }, true);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && pops.length) { pops[pops.length - 1].close(); e.stopPropagation(); }
  }, true);

  /* ---------- Menu ---------- */
  function menu(anchor, items, opts = {}) {
    const wrap = h("div");
    let api;
    items.forEach(it => {
      if (!it) return;
      if (it.sep) return wrap.append(h("div", { class: "menu-sep" }));
      if (it.section) return wrap.append(h("div", { class: "menu-sec", text: it.section }));
      if (it.el) return wrap.append(it.el);
      const btn = h("button", { class: "mi compact" + (it.danger ? " danger" : "") },
        h("span", { class: "mi-ic", html: it.iconHtml || (it.icon ? icon(it.icon) : "") }),
        h("span", { class: "mi-t", text: it.label }),
        it.kbd ? h("span", { class: "mi-k", text: it.kbd }) : null,
        it.toggle != null ? h("span", { class: "switch" + (it.toggle ? " on" : "") }) : null);
      btn.addEventListener("click", e => {
        if (it.toggle != null) { btn.querySelector(".switch").classList.toggle("on"); it.onClick(e); return; }
        api.close(); it.onClick && it.onClick(e);
      });
      wrap.append(btn);
    });
    api = popover(anchor, wrap, opts);
    return api;
  }

  /* ---------- Modal ---------- */
  function modal(title, body, opts = {}) {
    closePops();
    const box = h("div", { class: "modal glass-strong " + (opts.className || "") },
      title ? h("div", { class: "modal-head" }, h("span", { text: title }),
        h("button", { class: "icon-btn", html: icon("x"), onclick: () => api.close() })) : null,
      h("div", { class: "modal-body" }, body));
    const bd = h("div", { class: "backdrop" }, box);
    bd.addEventListener("mousedown", e => { if (e.target === bd) api.close(); });
    const onKey = e => { if (e.key === "Escape") api.close(); };
    document.addEventListener("keydown", onKey);
    layer().append(bd);
    const api = {
      el: box, close() {
        document.removeEventListener("keydown", onKey);
        bd.classList.add("closing"); setTimeout(() => bd.remove(), 180); opts.onClose && opts.onClose();
      },
    };
    return api;
  }
  function confirm(msg, ok = "Delete") {
    return new Promise(res => {
      let done = false;
      const body = h("div", null, h("p", { style: { marginTop: 0, color: "var(--muted)" }, text: msg }),
        h("div", { style: { display: "flex", gap: "8px", justifyContent: "flex-end" } },
          h("button", { class: "btn", text: "Cancel", onclick: () => m.close() }),
          h("button", { class: "btn primary", text: ok, onclick: () => { done = true; res(true); m.close(); } })));
      const m = modal("Are you sure?", body, { onClose: () => !done && res(false) });
      m.el.style.width = "420px";
    });
  }

  /* ---------- Toast ---------- */
  function toast(msg, action) {
    const t = h("div", { class: "toast glass-strong" }, h("span", { text: msg }));
    if (action) t.append(h("button", { text: action.label, onclick: () => { action.run(); kill(); } }));
    document.getElementById("toasts").append(t);
    const kill = () => { t.classList.add("out"); setTimeout(() => t.remove(), 300); };
    setTimeout(kill, action ? 5000 : 2400);
  }

  /* ---------- Emoji picker ---------- */
  const EMOJI = {
    Smileys: "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😜 🤪 🤗 🤔 🤫 😐 😏 😌 😴 🤓 😎 🥳 😤 😭 😱 🤯 🥶 😈 👻 🤖 👽 💀 🙈",
    People: "👋 🤚 ✋ 👌 ✌️ 🤞 👍 👎 👏 🙌 🙏 💪 🧠 👀 👤 👥 🧑‍💻 🧑‍🎨 🧑‍🚀 🧑‍🔬 🧑‍🏫 🦸 🧙 🧘 🏃 💃 🕺 👑 💍 🎓",
    Nature: "🌱 🌿 🍀 🌵 🌴 🌲 🌸 🌺 🌻 🌷 🍁 🍂 🌊 🔥 ⭐ 🌙 ☀️ ⛅ 🌈 ❄️ ⚡ 🌍 🐶 🐱 🦊 🐻 🐼 🦁 🐸 🦋",
    Food: "🍎 🍊 🍋 🍉 🍇 🍓 🫐 🍒 🥑 🥕 🌽 🍞 🧀 🍕 🍔 🌮 🍣 🍜 🍩 🍪 🎂 🍫 ☕ 🍵 🧋 🍷 🍺 🥤",
    Objects: "📄 📝 📓 📔 📚 📖 🗂️ 📁 📋 📌 📎 ✏️ 🖊️ 🖌️ 💡 🔦 💻 🖥️ ⌨️ 📱 📷 🎧 🎮 🧩 🎯 🎲 🔑 🔒 🛠️ ⚙️ 🧪 🔭 💰 💳 📦 🎁 🏆 🗓️ ⏰ 📈 📊",
    Symbols: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💯 ✨ 💫 💥 💬 💭 ✅ ☑️ ❌ ⚠️ ❗ ❓ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🔶 🔷 ♻️ 🚀 ✈️ 🏠 🏁 🚩",
  };
  const allEmoji = Object.values(EMOJI).join(" ").split(" ");
  function emojiPicker(anchor, onPick, opts = {}) {
    const grid = h("div", { class: "emoji-grid" });
    const fill = list => { grid.innerHTML = ""; list.forEach(e => grid.append(h("button", { text: e, onclick: () => { api.close(); onPick(e); } }))); };
    const tabs = h("div", { class: "emoji-tabs" },
      ...Object.keys(EMOJI).map(k => h("button", { text: k, onclick: () => fill(EMOJI[k].split(" ")) })),
      h("button", { text: "🎲", title: "Random", onclick: () => { api.close(); onPick(allEmoji[Math.floor(Math.random() * allEmoji.length)]); } }),
      opts.remove ? h("button", { text: "Remove", onclick: () => { api.close(); onPick(""); } }) : null);
    fill(EMOJI.Smileys.split(" ").concat(EMOJI.Objects.split(" ").slice(0, 20)));
    const api = popover(anchor, h("div", null, tabs, grid), { className: "emoji-pop" });
    return api;
  }
  function coverPicker(anchor, onPick) {
    const grid = h("div", { class: "cover-grid" }, ...Store.COVERS.map(c => h("button", { style: { background: c }, onclick: () => { api.close(); onPick(c); } })));
    const url = h("input", { class: "menu-input", placeholder: "Paste an image link and press Enter…" });
    url.addEventListener("keydown", e => { if (e.key === "Enter" && url.value.trim()) { api.close(); onPick(`url("${url.value.trim().replace(/"/g, "")}")`); } });
    const api = popover(anchor, h("div", { style: { width: "360px" } }, h("div", { class: "menu-sec", text: "Gradients" }), grid, h("div", { class: "menu-sec", text: "Link" }), url,
      h("button", { class: "mi compact danger", onclick: () => { api.close(); onPick(""); } }, h("span", { class: "mi-ic", html: icon("trash") }), "Remove cover")), { align: "end" });
    return api;
  }

  function timeAgo(t) {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago"; if (s < 604800) return Math.floor(s / 86400) + "d ago";
    return new Date(t).toLocaleDateString();
  }

  window.UI = { h, esc, icon, ICONS, popover, closePops, menu, modal, confirm, toast, emojiPicker, coverPicker, timeAgo, place };
})();
