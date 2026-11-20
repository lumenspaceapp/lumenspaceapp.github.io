/* Block editor: rendering, caret handling, keyboard, markdown shortcuts, drag reorder */
(function () {
  const { h, icon } = UI;
  const TEXT = new Set(["p", "h1", "h2", "h3", "bullet", "numbered", "todo", "toggle", "quote", "callout", "code"]);
  const LISTS = new Set(["bullet", "numbered", "todo", "toggle"]);
  const PH = { p: "Type '/' for commands", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", bullet: "List", numbered: "List", todo: "To-do", toggle: "Toggle", quote: "Quote", callout: "Callout", code: "Code" };
  let page, root, animIds = new Set(), firstPaint = false, dragBlock = null;

  /* ---------- caret utils ---------- */
  const sel = () => getSelection();
  function caretOffset(el) {
    const s = sel(); if (!s.rangeCount) return 0;
    const r = s.getRangeAt(0).cloneRange(); r.selectNodeContents(el); r.setEnd(s.getRangeAt(0).startContainer, s.getRangeAt(0).startOffset);
    return r.toString().length;
  }
  function setCaret(el, offset) {
    el.focus();
    const r = document.createRange(), s = sel();
    if (offset === "end" || offset == null) { r.selectNodeContents(el); r.collapse(false); }
    else {
      let left = offset, node, found = false;
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while ((node = walk.nextNode())) { if (left <= node.length) { r.setStart(node, left); found = true; break; } left -= node.length; }
      if (!found) { r.selectNodeContents(el); r.collapse(offset === 0); } else r.collapse(true);
    }
    s.removeAllRanges(); s.addRange(r);
  }
  const atStart = el => sel().isCollapsed && caretOffset(el) === 0;
  const atEnd = el => sel().isCollapsed && caretOffset(el) >= el.textContent.length;
  function onEdge(el, dir) { // first/last visual line?
    const s = sel(); if (!s.rangeCount) return true;
    const rects = s.getRangeAt(0).getClientRects(); const er = el.getBoundingClientRect();
    if (!rects.length) return dir < 0 ? atStart(el) : atEnd(el);
    const cr = rects[0], lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
    return dir < 0 ? cr.top - er.top < lh * .8 : er.bottom - cr.bottom < lh * .8;
  }
  function splitAtCaret(el) {
    const r = sel().getRangeAt(0); r.deleteContents();
    const tail = document.createRange(); tail.setStart(r.endContainer, r.endOffset); tail.setEnd(el, el.childNodes.length);
    const d = document.createElement("div"); d.append(tail.extractContents());
    return clean(d.innerHTML);
  }
  const clean = html => (html || "").replace(/^<br>$/, "").replace(/<br>$/, "");
  function stripChars(el, n) { // remove first n characters of text
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
    while (n > 0 && (node = walk.nextNode())) { const k = Math.min(n, node.length); node.data = node.data.slice(k); n -= k; }
  }

  /* ---------- model helpers ---------- */
  const idx = id => page.blocks.findIndex(b => b.id === id);
  const get = id => page.blocks.find(b => b.id === id);
  const elOf = id => root.querySelector(`.block[data-id="${id}"]`);
  const contentOf = id => elOf(id)?.querySelector(".block-content:not(.toggle-body)");
  const touch = () => Store.touch(page.id);
  function insertAfter(id, type = "p", props = {}) {
    const b = Store.block(type, "", props);
    const i = id ? idx(id) : page.blocks.length - 1;
    page.blocks.splice(i + 1, 0, b); animIds.add(b.id); touch();
    return b;
  }
  function remove(id, withUndo) {
    const i = idx(id); if (i < 0) return;
    const [b] = page.blocks.splice(i, 1);
    if (!page.blocks.length) page.blocks.push(Store.block("p"));
    touch(); render();
    if (withUndo) UI.toast("Block deleted", { label: "Undo", run: () => { page.blocks.splice(i, 0, b); animIds.add(b.id); touch(); render(); } });
    return i;
  }
  function turnInto(id, type, extra = {}) {
    const b = get(id); if (!b) return;
    if (b.type === "code" && type !== "code") b.text = UI.esc(b.text);
    if (type === "code" && b.type !== "code") b.text = Store.plainText(b.text);
    b.type = type; Object.assign(b, extra);
    if (type === "callout" && !b.icon) b.icon = "💡";
    if (type === "toggle" && b.body == null) b.body = "";
    if (type === "database" && !b.db) b.db = Store.newDb("table");
    touch(); render();
  }
  function focus(id, pos = "end") {
    const el = contentOf(id); if (!el) return;
    setCaret(el, pos === "start" ? 0 : pos);
  }
  const prevText = i => { for (let j = i - 1; j >= 0; j--) if (TEXT.has(page.blocks[j].type)) return page.blocks[j]; };
  const nextText = i => { for (let j = i + 1; j < page.blocks.length; j++) if (TEXT.has(page.blocks[j].type)) return page.blocks[j]; };

  /* ---------- rendering ---------- */
  function contentEl(b, type) {
    const ed = !page.locked;
    const c = h("div", { class: "block-content" + (/^h\d$/.test(type) ? " ph" : ""), contenteditable: ed ? (type === "code" ? "plaintext-only" : "true") : "false", spellcheck: type !== "code", "data-ph": PH[type] || "" });
    if (type === "code") c.innerHTML = EditorMenus.highlight(b.text, b.lang); else c.innerHTML = b.text || "";
    return c;
  }
  function blockEl(b, num) {
    const w = h("div", { class: `block t-${b.type}` + (b.checked ? " done" : "") + (b.open ? " open" : "") + (b.indent ? " lvl" + (b.indent % 3) : ""), dataset: { id: b.id } });
    if (b.color) w.dataset.color = b.color;
    if (b.bg) w.dataset.bg = b.bg;
    if (b.indent) w.style.marginLeft = b.indent * 26 + "px";
    if (animIds.has(b.id) || firstPaint) { w.classList.add("anim"); if (firstPaint) w.style.animationDelay = Math.min(num.i * 22, 380) + "ms"; }
    if (!page.locked) {
      const drag = h("button", { class: "drag", title: "Drag to move · Click for options", html: icon("drag") });
      drag.addEventListener("mousedown", () => (w.draggable = true));
      drag.addEventListener("click", e => EditorMenus.blockMenu(b, drag, w));
      w.append(h("div", { class: "gutter" },
        h("button", { class: "add", title: "Add block below", html: icon("plus"), onclick: () => { const nb = insertAfter(b.id); render(); focus(nb.id); EditorMenus.openSlash(contentOf(nb.id), nb, true); } }), drag));
    }
    const body = h("div", { class: "block-body" });
    const t = b.type;
    if (TEXT.has(t)) {
      const c = contentEl(b, t);
      if (t === "bullet") body.append(h("span", { class: "marker" }));
      if (t === "numbered") body.append(h("span", { class: "marker", text: num.n + "." }));
      if (t === "todo") {
        const ck = h("span", { class: "marker" }, h("span", { class: "check", html: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>' }));
        ck.addEventListener("click", () => { if (page.locked) return; b.checked = !b.checked; w.classList.toggle("done", b.checked); touch(); App.updateOutline(); });
        body.append(ck);
      }
      if (t === "callout") body.append(h("span", { class: "callout-icon", text: b.icon || "💡", onclick: e => !page.locked && UI.emojiPicker(e.currentTarget, em => { b.icon = em || "💡"; touch(); render(); }) }));
      if (t === "toggle") {
        const tb = h("button", { class: "toggle-btn", html: '<svg viewBox="0 0 24 24"><path d="M8 5l10 7-10 7z"/></svg>' });
        tb.addEventListener("click", () => { b.open = !b.open; w.classList.toggle("open", b.open); touch(); });
        const inner = h("div", { class: "block-content toggle-body", contenteditable: !page.locked, "data-ph": "Empty toggle. Click to add content." , html: b.body || "" });
        inner.addEventListener("input", () => { b.body = inner.innerHTML; touch(); });
        body.append(tb, h("div", { class: "toggle-wrap" }, c, h("div", { class: "toggle-inner" }, h("div", null, inner))));
      } else if (t === "code") {
        const langs = ["plain", "javascript", "typescript", "python", "html", "css", "json", "bash", "sql", "go", "rust", "java"];
        const sel = h("select", { class: "code-lang" }, ...langs.map(l => h("option", { value: l, selected: (b.lang || "plain") === l }, l)));
        sel.addEventListener("change", () => { b.lang = sel.value; c.innerHTML = EditorMenus.highlight(b.text, b.lang); touch(); });
        body.append(sel, h("button", { class: "code-copy", text: "Copy", onclick: e => { navigator.clipboard?.writeText(b.text); e.target.textContent = "Copied!"; setTimeout(() => (e.target.textContent = "Copy"), 1200); } }), c);
      } else body.append(c);
    } else if (t === "divider") body.append(h("hr"));
    else if (t === "image") {
      if (b.url) {
        body.append(h("img", { src: b.url, alt: "" }),
          h("div", { class: "block-content caption", contenteditable: !page.locked, "data-ph": "Add a caption", html: b.text || "", oninput: e => { b.text = e.target.innerHTML; touch(); } }));
      } else {
        const inp = h("input", { placeholder: "Paste image URL and press Enter" });
        inp.addEventListener("keydown", e => { if (e.key === "Enter" && inp.value.trim()) { b.url = inp.value.trim(); touch(); render(); } });
        const file = h("input", { type: "file", accept: "image/*", style: { display: "none" } });
        file.addEventListener("change", () => { const f = file.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { b.url = rd.result; touch(); render(); }; rd.readAsDataURL(f); });
        body.append(h("div", { class: "img-empty" }, h("span", { html: icon("image") }), inp, file, h("button", { class: "btn", text: "Upload", onclick: () => file.click() })));
        setTimeout(() => animIds.has(b.id) && inp.focus());
      }
    } else if (t === "page") {
      const sp = Store.page(b.pageId);
      if (!sp || sp.deleted) { body.append(h("span", { style: { color: "var(--faint)" }, text: "🗑️ Page moved to trash" })); }
      else body.append(h("span", { text: sp.icon || "📄" }), h("span", { class: "pg-title", text: sp.title || "Untitled" }));
      body.addEventListener("click", () => sp && !sp.deleted && App.go(sp.id));
    } else if (t === "database") body.append(Database.render(b, page));
    w.append(body);
    return w;
  }
  function render() {
    root.innerHTML = "";
    let n = 0, i = 0;
    page.blocks.forEach(b => {
      n = b.type === "numbered" ? n + 1 : 0;
      root.append(blockEl(b, { n, i: i++ }));
    });
    animIds.clear(); firstPaint = false;
    App.updateOutline();
  }
  function mount(el, p) { page = p; root = el; firstPaint = true; render(); bind(); }

  /* ---------- markdown shortcuts ---------- */
  const SHORTCUTS = [
    [/^#\s$/, "h1"], [/^##\s$/, "h2"], [/^###\s$/, "h3"], [/^[-*+]\s$/, "bullet"], [/^1[.)]\s$/, "numbered"],
    [/^\[\s?\]\s$/, "todo"], [/^\[x\]\s$/i, "todo", { checked: true }], [/^>\s$/, "toggle"], [/^"\s$/, "quote"], [/^```$/, "code"], [/^---$/, "divider"], [/^!!\s$/, "callout"],
  ];
  function tryShortcut(b, el) {
    if (b.type === "code") return false;
    const txt = el.textContent, off = caretOffset(el);
    for (const [re, type, extra] of SHORTCUTS) {
      const m = txt.slice(0, off).match(re);
      if (m && m.index === 0 && type !== b.type) {
        stripChars(el, m[0].length); b.text = el.innerHTML;
        if (type === "divider") { b.type = "divider"; b.text = ""; const nb = insertAfter(b.id); touch(); render(); focus(nb.id, "start"); return true; }
        turnInto(b.id, type, extra || {}); focus(b.id, "start"); return true;
      }
    }
    return false;
  }
  function inlineMarkdown(el) { // `code`, **bold**, *italic*, ~~strike~~
    const s = sel(); if (!s.isCollapsed) return;
    const node = s.anchorNode; if (!node || node.nodeType !== 3 || node.parentElement.closest("code")) return;
    const before = node.data.slice(0, s.anchorOffset);
    const rules = [[/`([^`]+)`$/, "code"], [/\*\*([^*]+)\*\*$/, "b"], [/~~([^~]+)~~$/, "s"], [/(?:^|[^*])\*([^*\s][^*]*)\*$/, "i"]];
    for (const [re, tag] of rules) {
      const m = before.match(re); if (!m) continue;
      const full = tag === "i" ? m[0].replace(/^[^*]/, "") : m[0];
      const start = s.anchorOffset - full.length;
      const r = document.createRange(); r.setStart(node, start); r.setEnd(node, s.anchorOffset); r.deleteContents();
      const wrap = document.createElement(tag); wrap.textContent = m[1]; r.insertNode(wrap);
      const space = document.createTextNode("​"); wrap.after(space);
      const c = document.createRange(); c.setStart(space, 1); c.collapse(true); s.removeAllRanges(); s.addRange(c);
      return true;
    }
  }

  /* ---------- events ---------- */
  function bind() {
    root.oninput = e => {
      const el = e.target; if (!el.classList.contains("block-content") || el.classList.contains("toggle-body") || el.classList.contains("caption")) return;
      const w = el.closest(".block"), b = get(w.dataset.id); if (!b) return;
      if (b.type === "code") {
        const off = caretOffset(el); b.text = el.textContent; el.innerHTML = EditorMenus.highlight(b.text, b.lang); setCaret(el, off);
      } else {
        if (tryShortcut(b, el)) return;
        if (e.inputType === "insertText" && /[`*~]/.test(e.data || "")) inlineMarkdown(el);
        b.text = clean(el.innerHTML);
        EditorMenus.slashInput(el, b, e);
      }
      touch(); App.updateOutline(true);
    };
    root.onkeydown = onKey;
    root.onclick = e => {
      const m = e.target.closest(".mention"); if (m) { e.preventDefault(); App.go(m.dataset.page); }
      const a = e.target.closest("a[href]:not(.mention)"); if (a && (e.ctrlKey || e.metaKey)) open(a.href, "_blank");
    };
    root.onpaste = e => {
      const el = e.target.closest(".block-content"); if (!el || el.closest(".t-code")) return;
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain"); if (!text) return;
      const lines = text.replace(/\r/g, "").split("\n");
      if (lines.length === 1 || el.classList.contains("toggle-body")) { document.execCommand("insertText", false, text); return; }
      document.execCommand("insertText", false, lines[0]);
      let last = get(el.closest(".block").dataset.id); last.text = el.innerHTML;
      lines.slice(1).forEach(l => { const m = l.match(/^(#{1,3}|[-*]|\d+\.|\[\s?\]|>)\s+(.*)$/); let type = "p", txt = l;
        if (m) { type = { "#": "h1", "##": "h2", "###": "h3", "-": "bullet", "*": "bullet", ">": "quote" }[m[1]] || (/^\d/.test(m[1]) ? "numbered" : "todo"); txt = m[2]; }
        last = insertAfter(last.id, type, { text: UI.esc(txt) }); });
      render(); focus(last.id);
    };
    // drag reorder
    root.ondragstart = e => { const w = e.target.closest?.(".block"); if (!w || !w.draggable) return; dragBlock = w.dataset.id; w.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); };
    root.ondragend = e => { root.querySelectorAll(".block").forEach(x => { x.draggable = false; x.classList.remove("dragging", "drop-above", "drop-below"); }); dragBlock = null; };
    root.ondragover = e => {
      if (!dragBlock) return; e.preventDefault();
      const w = e.target.closest(".block"); root.querySelectorAll(".drop-above,.drop-below").forEach(x => x.classList.remove("drop-above", "drop-below"));
      if (!w || w.dataset.id === dragBlock) return;
      const r = w.getBoundingClientRect(); w.classList.add(e.clientY < r.top + r.height / 2 ? "drop-above" : "drop-below");
    };
    root.ondrop = e => {
      if (!dragBlock) return; e.preventDefault();
      const w = root.querySelector(".drop-above,.drop-below"); if (!w) return;
      const below = w.classList.contains("drop-below");
      const [b] = page.blocks.splice(idx(dragBlock), 1);
      page.blocks.splice(idx(w.dataset.id) + (below ? 1 : 0), 0, b); animIds.add(b.id); touch(); render();
    };
  }

  function onKey(e) {
    const el = e.target;
    if (!el.classList?.contains("block-content") || el.classList.contains("caption")) return;
    if (el.classList.contains("toggle-body")) return;
    const w = el.closest(".block"), b = get(w.dataset.id); if (!b) return;
    if (EditorMenus.slashKey(e)) return;
    const i = idx(b.id), mod = e.ctrlKey || e.metaKey;

    if (e.key === "Enter" && !e.shiftKey) {
      if (b.type === "code" && !mod) return; // newline in code
      e.preventDefault();
      if (b.type === "code") { const nb = insertAfter(b.id); render(); return focus(nb.id, "start"); }
      if (LISTS.has(b.type) && !el.textContent.trim() && !el.querySelector("img")) {
        if (b.indent) { b.indent--; touch(); render(); return focus(b.id, "start"); }
        return turnInto(b.id, "p"), focus(b.id, "start");
      }
      const tail = splitAtCaret(el); b.text = clean(el.innerHTML);
      const type = LISTS.has(b.type) ? b.type : "p";
      const nb = insertAfter(b.id, type, { text: tail, indent: b.indent || 0, ...(type === "toggle" ? { body: "" } : {}) });
      render(); return focus(nb.id, "start");
    }
    if (e.key === "Backspace" && atStart(el) && !mod) {
      if (b.type !== "p" && b.type !== "code") { e.preventDefault(); turnInto(b.id, "p"); return focus(b.id, "start"); }
      if (b.indent) { e.preventDefault(); b.indent--; touch(); render(); return focus(b.id, "start"); }
      const prev = page.blocks[i - 1];
      if (!prev) return;
      e.preventDefault();
      if (TEXT.has(prev.type) && prev.type !== "code") {
        const pEl = contentOf(prev.id), len = pEl.textContent.length;
        prev.text = clean((prev.text || "") + (b.text || "")); page.blocks.splice(i, 1); touch(); render(); return focus(prev.id, len);
      }
      if (!el.textContent.length) { page.blocks.splice(i, 1); touch(); render(); const pt = prevText(i); pt && focus(pt.id); }
      else { const pw = elOf(prev.id); pw?.classList.add("flash"); }
      return;
    }
    if (e.key === "Delete" && atEnd(el)) {
      const next = page.blocks[i + 1];
      if (next && TEXT.has(next.type) && next.type !== "code" && b.type !== "code") {
        e.preventDefault(); const len = el.textContent.length;
        b.text = clean(el.innerHTML + (next.text || "")); page.blocks.splice(i + 1, 1); touch(); render(); focus(b.id, len);
      }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (b.type === "code") return document.execCommand("insertText", false, "  ");
      const off = caretOffset(el);
      b.indent = Math.max(0, Math.min(4, (b.indent || 0) + (e.shiftKey ? -1 : 1))); touch(); render(); return focus(b.id, off);
    }
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && mod && e.shiftKey) {
      e.preventDefault(); const j = i + (e.key === "ArrowUp" ? -1 : 1); if (j < 0 || j >= page.blocks.length) return;
      const off = caretOffset(el); [page.blocks[i], page.blocks[j]] = [page.blocks[j], page.blocks[i]]; animIds.add(b.id); touch(); render(); return focus(b.id, off);
    }
    if (e.key === "ArrowUp" && !e.shiftKey && onEdge(el, -1)) {
      const p = prevText(i); if (p) { e.preventDefault(); focus(p.id, "end"); }
      else if (i === 0 || !p) { e.preventDefault(); App.focusTitle(); }
      return;
    }
    if (e.key === "ArrowDown" && !e.shiftKey && onEdge(el, 1)) { const n = nextText(i); if (n) { e.preventDefault(); focus(n.id, "start"); } return; }
    if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); EditorMenus.duplicate(b); return; }
    if (mod && e.key.toLowerCase() === "e") { e.preventDefault(); EditorMenus.inlineCode(); return; }
    if (mod && e.altKey && /^[0-9]$/.test(e.key)) {
      e.preventDefault(); const map = { 0: "p", 1: "h1", 2: "h2", 3: "h3", 4: "todo", 5: "bullet", 6: "numbered", 7: "toggle", 8: "code" };
      if (map[e.key]) { turnInto(b.id, map[e.key]); focus(b.id); } return;
    }
    if (e.key === "Escape") { el.blur(); w.classList.add("selected"); selectedId = b.id; }
  }
  let selectedId = null;
  document.addEventListener("keydown", e => {
    if (!selectedId || document.activeElement?.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); const id = selectedId; selectedId = null; remove(id, true); }
    else if (e.key === "Enter") { e.preventDefault(); const id = selectedId; selectedId = null; elOf(id)?.classList.remove("selected"); focus(id); }
  });
  document.addEventListener("mousedown", () => { if (selectedId) { elOf(selectedId)?.classList.remove("selected"); selectedId = null; } });

  window.Editor = {
    mount, render, focus, insertAfter, remove, turnInto, get, idx, contentOf, elOf, setCaret, caretOffset, TEXT,
    get page() { return page; }, get root() { return root; }, markNew: id => animIds.add(id),
  };
})();
