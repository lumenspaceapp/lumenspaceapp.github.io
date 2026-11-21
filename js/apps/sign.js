/* e-Signature (Bitrix24 "e-Signature" + "e-Signature for HR")
   Prepare a PDF, place fields for each signer, send in order, sign by drawing / typing / uploading,
   then get a stamped PDF with a signature certificate (audit trail + SHA-256 of the original).
   Collection: signdocs (schema in docs/BUILD-BRIEF.md, phase 4). Libraries load lazily from CDNs:
   pdf.js renders pages, pdf-lib builds PDFs. */
(function () {
  const { h, esc } = UI;
  const COL = "signdocs";
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const PDFLIB = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
  const MAX = 700 * 1024;
  const HOUR = 3600 * 1000;
  const COLORS = ["#7c5cff", "#0ea5e9", "#f59e0b", "#10b981", "#ec4899", "#ef4444", "#8b5cf6", "#14b8a6"];
  // default sizes in px on a 600 px wide page
  const FIELD = {
    signature: { label: "Signature", icon: "✍️", w: 170, h: 52, ask: "Sign here" },
    initials: { label: "Initials", icon: "🔤", w: 76, h: 44, ask: "Initial here" },
    date: { label: "Date", icon: "📅", w: 112, h: 26, ask: "Date" },
    text: { label: "Text", icon: "🅣", w: 180, h: 26, ask: "Fill in" },
  };
  const STATUS = { draft: "Draft", sent: "In progress", completed: "Completed", declined: "Declined", cancelled: "Cancelled" };
  const ACTIONS = { created: "Created the document", sent: "Sent it for signing", viewed: "Opened the document", signed: "Signed", declined: "Declined to sign",
    reminded: "Sent a reminder", cancelled: "Cancelled the document", completed: "Everyone signed: signed PDF created", resent: "Sent it again" };
  const SECURITY = "Simple electronic signature: Lumen records each signer's sign-in identity, the time and the file's SHA-256 hash. It's not a qualified or certified e-signature service.";

  /* ---------- lazy libraries ---------- */
  const scripts = {};
  function loadScript(src) {
    return scripts[src] ||= new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = src; s.async = true; s.crossOrigin = "anonymous";
      s.onload = () => res(); s.onerror = () => { delete scripts[src]; s.remove(); rej(new Error("Couldn't load the PDF tools. Check your connection and try again.")); };
      document.head.append(s);
    });
  }
  async function pdfjs() { await loadScript(PDFJS); const lib = window.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return lib; }
  async function pdflib() { await loadScript(PDFLIB); return window.PDFLib; }

  /* ---------- small helpers ---------- */
  const meKey = () => Data.me().key;
  const now = () => Date.now();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r4 = n => Math.round(n * 10000) / 10000;
  const fid = () => Math.random().toString(36).slice(2, 10);
  const isAdmin = () => (Apps.isAdmin ? !!Apps.isAdmin() : true);
  const canEdit = () => (Apps.can ? Apps.can("sign", "edit") : true);
  const pname = k => k === "__employee" ? "Employee" : k === "__company" ? "Company" : Data.person(k).name;
  const first = k => String(pname(k) || "").split(" ")[0];
  const fmtTs = t => t ? new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
  const fmtDay = t => t ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" }) : "";
  const utc = t => t ? new Date(t).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "—";
  const todayText = () => new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const safeName = s => String(s || "document").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "document";
  const initialsOf = n => String(n || "").split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase()).slice(0, 3).join("") || "X";
  const pos = (f, c) => ({ left: f.x * 100 + "%", top: f.y * 100 + "%", width: f.w * 100 + "%", height: f.h * 100 + "%", "--sc": c });
  const note = (text, cls = "") => h("div", { class: "sg-note " + cls }, text);
  const security = () => h("div", { class: "sg-sec" }, h("span", { text: "🔒" }), h("span", { text: SECURITY }));

  function dataToBytes(url) {
    const b64 = String(url).slice(String(url).indexOf(",") + 1), bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  const mimeOf = url => (String(url).match(/^data:([^;,]+)/) || [])[1] || "application/octet-stream";
  const dataToFile = (url, name, type) => new File([dataToBytes(url)], name, { type: type || mimeOf(url) });
  async function sha256(bytes) {
    if (!window.crypto?.subtle) return "";
    const d = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  function download(data, name, type = "application/pdf") {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const u = URL.createObjectURL(blob), a = h("a", { href: u, download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000);
  }
  // the files doc of an attachment (it may still be loading from the workspace)
  function waitFile(id, ms = 12000) {
    const f = id && Data.get("files", id);
    if (!id || f?.data) return Promise.resolve(f || null);
    return new Promise(res => {
      let off = null, done = false;
      const end = v => { if (done) return; done = true; clearTimeout(t); setTimeout(() => off && off()); res(v); };
      const t = setTimeout(() => end(Data.get("files", id) || null), ms);
      off = Data.on("files", () => { const x = Data.get("files", id); if (x?.data) end(x); });
    });
  }
  async function fileBytes(att) {
    const f = await waitFile(att && att.id);
    if (!f?.data) throw new Error("The document file isn't available any more.");
    return dataToBytes(f.data);
  }
  // an <img> for an attachment, filled when the file arrives
  function attImg(att, cls = "") {
    const img = h("img", { class: cls, alt: "" });
    if (att) waitFile(att.id).then(f => { if (f?.data) img.src = f.data; });
    return img;
  }
  function seg(options, value, onChange) {
    const el = h("div", { class: "seg" });
    options.forEach(([k, l]) => el.append(h("button", { type: "button", class: k === value ? "on" : "", text: l, onclick: e => { el.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); onChange(k); } })));
    return el;
  }
  function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Couldn't read that image")); i.src = src; }); }
  const canvas = (w, hh) => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(hh)); return c; };
  const toBlob = (cv, type, q) => new Promise(r => cv.toBlob(r, type, q));
  // crop a canvas to what's drawn on it; returns a PNG data URL or null when empty
  function trimCanvas(cv, pad = 10) {
    const w = cv.width, hh = cv.height, px = cv.getContext("2d").getImageData(0, 0, w, hh).data;
    let x0 = w, y0 = hh, x1 = -1, y1 = -1;
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(hh - 1, y1 + pad);
    const out = canvas(x1 - x0 + 1, y1 - y0 + 1);
    out.getContext("2d").drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  }
  // a typed value (text or date field) as a PNG that fills the field box: works for every script
  function textPng(text, wPt, hPt) {
    const k = Math.min(4, 1800 / Math.max(1, wPt)), cv = canvas(wPt * k, hPt * k), ctx = cv.getContext("2d"), pad = cv.height * .12;
    let size = cv.height * .62;
    const font = s => `${s}px Helvetica, Arial, "Segoe UI", sans-serif`;
    ctx.font = font(size);
    while (size > 6 && ctx.measureText(text).width > cv.width - pad * 2) { size *= .92; ctx.font = font(size); }
    ctx.fillStyle = "#111827"; ctx.textBaseline = "middle"; ctx.fillText(text, pad, cv.height / 2);
    return cv.toDataURL("image/png");
  }

  /* ---------- document model ---------- */
  // signers with what they've done: "done" entries are written atomically (arrayUnion) when someone signs
  function signersOf(d) {
    const dm = {}; (d.done || []).forEach(x => { if (x && x.key) dm[x.key] = x; });
    return (d.signers || []).map((s, i) => {
      const x = dm[s.key], base = { order: i + 1, status: "waiting", ...s };
      return x && base.status !== "declined" ? { ...base, status: "signed", signedAt: x.signedAt || base.signedAt, sig: x.sig || base.sig || null, ini: x.ini || base.ini || null, values: x.values || base.values || {} } : base;
    }).sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  const fieldValue = (d, f, ss) => { const s = (ss || signersOf(d)).find(x => x.key === f.signer); return (s && s.values && s.values[f.id]) ?? f.value ?? ""; };
  function myTurn(d, k = meKey()) {
    if (!d || d.status !== "sent") return false;
    const ss = signersOf(d), s = ss.find(x => x.key === k);
    if (!s || s.status !== "waiting") return false;
    if (d.order !== "sequence") return true;
    return ss.filter(x => (x.order || 0) < (s.order || 0)).every(x => x.status === "signed");
  }
  // whose turn it is now
  function nextUp(d) {
    const w = signersOf(d).filter(s => s.status === "waiting");
    if (d.order !== "sequence" || !w.length) return w;
    const min = Math.min(...w.map(s => s.order || 0));
    return w.filter(s => (s.order || 0) === min);
  }
  const involved = (d, k = meKey()) => d.by === k || (d.signers || []).some(s => s.key === k);
  const canSee = d => involved(d) || isAdmin();
  const progressOf = d => { const ss = signersOf(d); return [ss.filter(s => s.status === "signed").length, ss.length]; };
  const colorFor = (d, k) => { const i = (d.signers || []).findIndex(s => s.key === k); return COLORS[(i < 0 ? 0 : i) % COLORS.length]; };
  const audit = (id, action, info) => Data.arr(COL, id, "audit", { at: now(), by: meKey(), action, ...(info ? { info: String(info).slice(0, 300) } : {}) });
  const touch = (id, patch) => Data.update(COL, id, { ...patch, updatedAt: now() });
  const stripSigner = s => ({ key: s.key, name: s.name || pname(s.key), order: s.order || 1, status: s.status || "waiting", signedAt: s.signedAt || null, sig: s.sig || null, ...(s.ini ? { ini: s.ini } : {}), ip: "" });
  const newSigner = (key, order) => ({ key, name: pname(key), order, status: "waiting", signedAt: null, sig: null, ip: "" });
  const askText = d => `✍️ ${esc(Data.me().name)} asked you to sign “${esc(d.title || "Untitled")}”`;
  const link = id => "#/app/sign/" + id;
  function chip(status) { return h("span", { class: "sg-chip s-" + (status || "draft"), text: STATUS[status] || "Draft" }); }
  function kindChip(d) { return d.kind === "hr" ? h("span", { class: "sg-kind", text: "HR" }) : null; }

  /* ---------- PDF viewing (pdf.js) ---------- */
  const pdfCache = new Map();
  function openPdf(att) {
    if (!pdfCache.has(att.id)) pdfCache.set(att.id, (async () => {
      const lib = await pdfjs(), bytes = await fileBytes(att);
      return lib.getDocument({ data: bytes }).promise;
    })().catch(e => { pdfCache.delete(att.id); throw e; }));
    return pdfCache.get(att.id);
  }
  // a scrollable column of pages; onPage(p) runs for every page ({ i, wrap, layer, w, h }) to add overlays
  function viewer(att, opts = {}) {
    const inner = h("div", { class: "sg-pages" }), el = h("div", { class: "sg-scroll " + (opts.cls || "") }, inner);
    const api = { el, pages: [], zoom: 1, alive: true };
    let io = null;
    const status = h("div", { class: "sg-loading" }, h("span", { class: "sg-spin" }), "Loading the document…");
    inner.append(status);
    async function draw(p) {
      if (p.drawn || !api.alive) return; p.drawn = true;
      const target = Math.min(1700, Math.round(900 * Math.min(2, window.devicePixelRatio || 1)));
      const vp = p.pg.getViewport({ scale: target / p.w });
      p.canvas.width = Math.round(vp.width); p.canvas.height = Math.round(vp.height);
      const ctx = p.canvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, p.canvas.width, p.canvas.height);
      try { await p.pg.render({ canvasContext: ctx, viewport: vp }).promise; } catch (e) { console.warn(e); }
      p.wrap.classList.add("drawn");
    }
    api.ready = (async () => {
      try {
        const pdf = await openPdf(att);
        if (!api.alive) return api;
        status.remove();
        for (let i = 0; i < pdf.numPages; i++) {
          const pg = await pdf.getPage(i + 1), vp = pg.getViewport({ scale: 1 });
          if (!api.alive) return api;
          const canvasEl = h("canvas", { class: "sg-canvas" }), layer = h("div", { class: "sg-layer" });
          const wrap = h("div", { class: "sg-page", dataset: { page: i }, style: { aspectRatio: vp.width + " / " + vp.height, animationDelay: Math.min(i, 6) * 50 + "ms" } }, canvasEl, layer,
            pdf.numPages > 1 ? h("span", { class: "sg-pno", text: `${i + 1} / ${pdf.numPages}` }) : null);
          const p = { i, wrap, layer, canvas: canvasEl, w: vp.width, h: vp.height, pg, drawn: false };
          api.pages.push(p); inner.append(wrap);
          opts.onPage && opts.onPage(p);
        }
        io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) draw(api.pages[+e.target.dataset.page]); }), { root: el, rootMargin: "900px 0px" });
        api.pages.forEach(p => io.observe(p.wrap));
        opts.onReady && opts.onReady(api);
      } catch (e) {
        console.warn(e);
        status.replaceChildren(h("span", { text: "⚠️ " + (e.message || "Couldn't open this PDF.") }));
      }
      return api;
    })();
    api.setZoom = (z, anchor) => {
      z = clamp(z, .5, 3); if (Math.abs(z - api.zoom) < .001) return;
      const r = el.getBoundingClientRect(), ax = anchor ? anchor.x - r.left : r.width / 2, ay = anchor ? anchor.y - r.top : r.height / 2;
      const cx = el.scrollLeft + ax, cy = el.scrollTop + ay, k = z / api.zoom;
      api.zoom = z; inner.style.setProperty("--z", z);
      el.scrollLeft = cx * k - ax; el.scrollTop = cy * k - ay;
      opts.onZoom && opts.onZoom(z);
    };
    // pinch to zoom (touch) and ctrl + wheel (trackpads, mice)
    let pinch = null;
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = t => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    el.addEventListener("touchstart", e => { if (e.touches.length === 2) pinch = { d: dist(e.touches), z: api.zoom }; }, { passive: true });
    el.addEventListener("touchmove", e => { if (pinch && e.touches.length === 2) { e.preventDefault(); api.setZoom(pinch.z * dist(e.touches) / pinch.d, mid(e.touches)); } }, { passive: false });
    el.addEventListener("touchend", e => { if (e.touches.length < 2) pinch = null; });
    el.addEventListener("wheel", e => { if (!e.ctrlKey) return; e.preventDefault(); api.setZoom(api.zoom * (1 - e.deltaY * .0025), { x: e.clientX, y: e.clientY }); }, { passive: false });
    api.destroy = () => { api.alive = false; io && io.disconnect(); };
    api.scrollToEl = (target, block = "center") => target && target.scrollIntoView({ behavior: "smooth", block, inline: "center" });
    return api;
  }
  function zoomBar(v) {
    const lbl = h("span", { class: "sg-zoom-l", text: "100%" });
    const set = z => { v.setZoom(z); lbl.textContent = Math.round(v.zoom * 100) + "%"; };
    const prevZoom = v.setZoom;
    v.setZoom = (z, a) => { prevZoom(z, a); lbl.textContent = Math.round(v.zoom * 100) + "%"; };
    return h("div", { class: "sg-zoom" },
      h("button", { type: "button", class: "icon-btn xs", title: "Zoom out", text: "−", onclick: () => set(v.zoom / 1.2) }), lbl,
      h("button", { type: "button", class: "icon-btn xs", title: "Zoom in", text: "+", onclick: () => set(v.zoom * 1.2) }),
      h("button", { type: "button", class: "icon-btn xs", title: "Fit width", html: UI.icon("expand"), onclick: () => set(1) }));
  }
  // a small image of page 1
  function thumb(att, width = 150) {
    const el = h("div", { class: "sg-thumb" }, h("span", { class: "sg-spin" }));
    openPdf(att).then(async pdf => {
      const pg = await pdf.getPage(1), vp0 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: width * 2 / vp0.width });
      const cv = canvas(vp.width, vp.height), ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      el.replaceChildren(cv);
    }).catch(() => el.replaceChildren(h("span", { class: "sg-thumb-ic", text: "📄" })));
    return el;
  }
  // a field as others see it: placeholder with the signer's colour, or the signed value
  function staticField(f, d, ss) {
    const s = ss.find(x => x.key === f.signer), signed = s && s.status === "signed";
    const el = h("div", { class: "sg-f static t-" + f.type + (signed ? " done" : ""), style: pos(f, colorFor(d, f.signer)), title: `${FIELD[f.type]?.label || "Field"} · ${pname(f.signer)}` });
    if (signed && (f.type === "signature" || f.type === "initials")) el.append(attImg(f.type === "initials" ? (s.ini || s.sig) : s.sig, "sg-f-img"));
    else if (signed) el.append(h("span", { class: "sg-f-val", text: fieldValue(d, f, ss) }));
    else el.append(h("span", { class: "sg-f-lab", text: `${FIELD[f.type]?.label || "Field"} · ${first(f.signer)}` }));
    return el;
  }

  /* ---------- building PDFs (pdf-lib) ---------- */
  // map a point given as fractions of the page as displayed (rotation applied) to PDF user space
  function mapper(page) {
    const b = page.getCropBox(), rot = (((page.getRotation().angle || 0) % 360) + 360) % 360;
    const dispW = rot % 180 ? b.height : b.width, dispH = rot % 180 ? b.width : b.height;
    const P = (u, v) => rot === 90 ? { x: b.x + v * b.width, y: b.y + u * b.height }
      : rot === 180 ? { x: b.x + (1 - u) * b.width, y: b.y + v * b.height }
      : rot === 270 ? { x: b.x + (1 - v) * b.width, y: b.y + (1 - u) * b.height }
      : { x: b.x + u * b.width, y: b.y + (1 - v) * b.height };
    return { dispW, dispH, P, rot };
  }
  async function imageToPdf(file) {
    const L = await pdflib(), url = URL.createObjectURL(file);
    let img; try { img = await loadImg(url); } finally { URL.revokeObjectURL(url); }
    const k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.round(img.naturalWidth * k), hh = Math.round(img.naturalHeight * k);
    const cv = canvas(w, hh), ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, hh); ctx.drawImage(img, 0, 0, w, hh);
    let q = .86, blob = await toBlob(cv, "image/jpeg", q);
    while (blob && blob.size > 600 * 1024 && q > .4) { q -= .12; blob = await toBlob(cv, "image/jpeg", q); }
    const pdf = await L.PDFDocument.create(), jpg = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const [PW, PH] = w > hh ? [841.89, 595.28] : [595.28, 841.89], s = Math.min((PW - 48) / w, (PH - 48) / hh);
    pdf.addPage([PW, PH]).drawImage(jpg, { x: (PW - w * s) / 2, y: (PH - hh * s) / 2, width: w * s, height: hh * s });
    pdf.setTitle(file.name.replace(/\.\w+$/, "")); pdf.setProducer("Lumen e-Signature");
    return new File([await pdf.save()], file.name.replace(/\.\w+$/, "") + ".pdf", { type: "application/pdf" });
  }
  // the stamped PDF: signatures and values on the original pages + a signature certificate page
  async function buildSigned(d) {
    const L = await pdflib(), { PDFDocument, degrees } = L;
    const src = await fileBytes(d.file);
    const hash = (await sha256(src).catch(() => "")) || d.hash || "";
    const pdf = await PDFDocument.load(src, { ignoreEncryption: true });
    const pages = pdf.getPages(), ss = signersOf(d), cache = {};
    const pngOf = async att => {
      if (!att) return null;
      if (!(att.id in cache)) { const f = await waitFile(att.id); cache[att.id] = f?.data ? await pdf.embedPng(dataToBytes(f.data)).catch(() => null) : null; }
      return cache[att.id];
    };
    for (const f of d.fields || []) {
      const page = pages[f.page], s = ss.find(x => x.key === f.signer);
      if (!page || !s || s.status !== "signed") continue;
      const m = mapper(page), fw = f.w * m.dispW, fh = f.h * m.dispH;
      let img, fill = false;
      if (f.type === "signature" || f.type === "initials") img = await pngOf(f.type === "initials" ? (s.ini || s.sig) : s.sig);
      else { const v = String(fieldValue(d, f, ss) || ""); if (!v) continue; img = await pdf.embedPng(dataToBytes(textPng(v, fw, fh))); fill = true; }
      if (!img) continue;
      const a = img.width / img.height;
      let dw = Math.min(fw, fh * a), dh = dw / a, ox = (fw - dw) / 2, oy = (fh - dh) / 2;
      if (fill) { dw = fw; dh = fh; ox = 0; oy = 0; }
      const P = m.P(f.x + ox / m.dispW, f.y + (oy + dh) / m.dispH);
      page.drawImage(img, { x: P.x, y: P.y, width: dw, height: dh, rotate: degrees(m.rot) });
    }
    await certificate(pdf, L, d, ss, hash, pngOf);
    pdf.setTitle(d.title || "Signed document"); pdf.setProducer("Lumen e-Signature"); pdf.setModificationDate(new Date());
    return pdf.save();
  }
  const ANSI = /^[\x20-\x7e -ÿ–—‘’“”•…€]*$/;
  function wrapText(str, font, size, maxW) {
    const out = []; let line = "";
    for (const word of str.split(" ")) {
      const t = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(t, size) <= maxW) { line = t; continue; }
      if (line) out.push(line);
      line = word;
      while (font.widthOfTextAtSize(line, size) > maxW && line.length > 1) {
        let n = line.length; while (n > 1 && font.widthOfTextAtSize(line.slice(0, n), size) > maxW) n--;
        out.push(line.slice(0, n)); line = line.slice(n);
      }
    }
    if (line || !out.length) out.push(line);
    return out;
  }
  // one line of text the standard PDF fonts can't encode (other scripts, emoji), drawn as an image
  function lineImage(str, size, bold, color, maxW) {
    const k = 4, ctx0 = canvas(1, 1).getContext("2d"), font = `${bold ? "bold " : ""}${size * k}px Helvetica, Arial, "Segoe UI", sans-serif`;
    ctx0.font = font;
    let s = str; while (s.length > 1 && ctx0.measureText(s).width > maxW * k) s = s.slice(0, -2) + "…";
    const cv = canvas(Math.min(maxW * k, ctx0.measureText(s).width + 4), size * k * 1.3), ctx = cv.getContext("2d");
    ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = "alphabetic"; ctx.fillText(s, 0, size * k);
    return { url: cv.toDataURL("image/png"), w: cv.width / k, h: cv.height / k };
  }
  async function certificate(pdf, L, d, ss, hash, pngOf) {
    const { StandardFonts, rgb } = L;
    const F = { reg: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold), mono: await pdf.embedFont(StandardFonts.Courier) };
    const W = 595.28, H = 841.89, M = 48, ink = rgb(.11, .12, .17), mute = rgb(.42, .44, .5), acc = rgb(.486, .361, 1), line = rgb(.86, .87, .91);
    const certPages = []; let page, y;
    const add = () => { page = pdf.addPage([W, H]); certPages.push(page); y = H - M; };
    const room = need => { if (y - need < M + 30) add(); };
    async function text(str, o = {}) {
      const { x = M, size = 10, font = F.reg, color = ink, maxW = W - 2 * M - (x - M), gap = 1.45, css = "#1c1f2b" } = o;
      str = String(str ?? "").replace(/[\r\n\t]+/g, " ");
      if (ANSI.test(str)) {
        for (const ln of wrapText(str, font, size, maxW)) { room(size * gap); page.drawText(ln, { x, y: y - size, size, font, color }); y -= size * gap; }
      } else {
        room(size * gap);
        const im = lineImage(str, size, font === F.bold, css, maxW), img = await pdf.embedPng(dataToBytes(im.url));
        page.drawImage(img, { x, y: y - size * 1.3, width: im.w, height: im.h }); y -= size * gap;
      }
    }
    const kv = async (k, v, mono) => {
      room(16); const top = y;
      page.drawText(k, { x: M, y: y - 9.5, size: 9, font: F.bold, color: mute });
      await text(v || "—", { x: M + 128, size: mono ? 8.4 : 9.5, font: mono ? F.mono : F.reg });
      if (y > top - 15) y = top - 15;
    };
    add();
    page.drawRectangle({ x: 0, y: H - 7, width: W, height: 7, color: acc });
    await text("LUMEN E-SIGNATURE", { size: 8.5, font: F.bold, color: acc, css: "#7c5cff" });
    y -= 2;
    await text("Signature certificate", { size: 22, font: F.bold });
    y -= 8;
    const f = Data.get("files", d.file?.id), sender = Data.person(d.by);
    await kv("Document", d.title || "Untitled");
    await kv("Document ID", d.id || "");
    await kv("Type", d.kind === "hr" ? "HR document" : "General document");
    await kv("Original file", `${d.file?.name || f?.name || "document.pdf"} (${Apps.fileSize(d.file?.size || f?.size || 0)}, ${pdf.getPageCount() - 1} page${pdf.getPageCount() - 1 === 1 ? "" : "s"})`);
    await kv("SHA-256 of original", hash || "unavailable", true);
    await kv("Sent by", `${sender.name}${sender.email ? " <" + sender.email + ">" : ""}`);
    await kv("Sent", utc(d.sentAt || d.at));
    await kv("Completed", utc(now()));
    await kv("Signing order", d.order === "sequence" ? "In sequence" : "Any order");
    y -= 12;
    room(30); page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: .8, color: line }); y -= 14;
    await text("Signers", { size: 13, font: F.bold }); y -= 4;
    for (const s of ss) {
      room(70); const top = y, p = Data.person(s.key);
      page.drawRectangle({ x: M, y: top - 62, width: W - 2 * M, height: 60, color: rgb(.975, .975, .99), borderColor: line, borderWidth: .8 });
      y -= 9;
      await text(p.name || s.name || s.key, { x: M + 12, size: 11, font: F.bold, maxW: 300 });
      await text(p.email || (s.key === "me" ? "Private workspace" : s.key), { x: M + 12, size: 9, color: mute, maxW: 300, css: "#6b7183" });
      await text(`Signed ${utc(s.signedAt)}`, { x: M + 12, size: 9, maxW: 300 });
      const img = await pngOf(s.sig);
      if (img) {
        const bw = 150, bh = 44, a = img.width / img.height, w = Math.min(bw, bh * a), hh = w / a;
        page.drawImage(img, { x: W - M - 12 - w, y: top - 8 - bh + (bh - hh) / 2, width: w, height: hh });
      }
      y = top - 70;
    }
    y -= 4;
    room(40); page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: .8, color: line }); y -= 14;
    await text("Audit trail", { size: 13, font: F.bold }); y -= 2;
    const trail = [...(d.audit || [])].sort((a, b) => (a.at || 0) - (b.at || 0));
    trail.push({ at: now(), by: meKey(), action: "completed" });
    for (const a of trail) await text(`${utc(a.at)}  ·  ${Data.person(a.by).name}  ·  ${ACTIONS[a.action] || a.action}${a.info ? ": " + a.info : ""}`, { size: 8.6, gap: 1.6 });
    const foot = "Simple electronic signature recorded by Lumen with each signer's sign-in identity, time and the SHA-256 hash of the original file. Not a qualified electronic signature.";
    certPages.forEach((pg, i) => {
      wrapText(foot, F.reg, 7.2, W - 2 * M - 90).forEach((ln, j) => pg.drawText(ln, { x: M, y: M - 8 - j * 9.5, size: 7.2, font: F.reg, color: mute }));
      const t = `Certificate ${i + 1} / ${certPages.length}`;
      pg.drawText(t, { x: W - M - F.reg.widthOfTextAtSize(t, 7.2), y: M - 8, size: 7.2, font: F.reg, color: mute });
    });
  }

  /* ---------- finishing: when everyone has signed ---------- */
  const finalizing = new Set();
  async function finalize(id) {
    finalizing.add(id);
    const d = Data.get(COL, id);
    if (!d || d.status !== "sent") return;
    const ss = signersOf(d);
    if (!ss.length || !ss.every(s => s.status === "signed")) return;
    let att = null, big = false;
    try {
      const bytes = await buildSigned(d);
      if (bytes.length <= MAX) [att] = await Apps.attach([new File([bytes], safeName(d.title) + " (signed).pdf", { type: "application/pdf" })]);
      else big = true;
    } catch (e) { console.warn(e); big = true; }
    const cur = Data.get(COL, id);
    if (!cur || cur.status !== "sent") return;
    await touch(id, { status: "completed", completedAt: now(), signers: signersOf(cur).map(stripSigner), fields: (cur.fields || []).map(f => ({ ...f, value: fieldValue(cur, f) || null })), ...(att ? { signed: att } : { signedBig: !!big }) });
    await audit(id, "completed");
    const msg = `✅ “${esc(cur.title || "Untitled")}” is signed by everyone`;
    new Set([cur.by, ...ss.map(s => s.key)]).forEach(k => Data.notify(k, msg, link(id), att ? "The signed PDF is ready to download." : "Download the signed PDF from the document page."));
    if (window.Notify) Notify.alert({ title: "✅ Signed by everyone", body: cur.title || "", link: link(id), icon: "✅", tag: "sign-done-" + id });
  }

  /* ---------- background: badge + finishing documents ---------- */
  let bgOff = null;
  function startBg() {
    bgOff && bgOff();
    bgOff = Data.on(COL, all => {
      try {
        Apps.badge("sign", all.filter(d => myTurn(d)).length);
        all.forEach(d => {
          if (d.status !== "sent" || finalizing.has(d.id)) return;
          const ss = signersOf(d);
          if (!ss.length || !ss.every(s => s.status === "signed")) return;
          // the last person to sign builds the final PDF (everyone computes the same answer)
          const last = ss.slice().sort((a, b) => (b.signedAt || 0) - (a.signedAt || 0))[0];
          if (last.key === meKey()) finalize(d.id).catch(e => console.warn(e));
        });
      } catch (e) { console.warn(e); }
    });
  }

  /* ---------- signature pad ---------- */
  const INKS = ["#14152b", "#1d4ed8"];
  const TYPE_FONTS = [
    ["italic 400", '"Segoe Script", "Bradley Hand", "Snell Roundhand", "Dancing Script", cursive'],
    ["400", '"Brush Script MT", "Brush Script Std", "Lucida Calligraphy", "Apple Chancery", cursive'],
    ["italic 600", '"Lucida Handwriting", "Segoe Print", "Chalkboard SE", "Comic Sans MS", cursive'],
  ];
  async function saveMySignature(png) {
    const k = meKey(), old = (Data.get("people", k) || {}).signature;
    const [att] = await Apps.attach([dataToFile(png, "signature.png", "image/png")]);
    if (!att) return null;
    await Data.update("people", k, { signature: att });
    if (old && old.id !== att.id && Data.get("files", old.id)?.folder === "__attachments") Data.remove("files", old.id);
    return att;
  }
  function signaturePad({ mode = "signature", forceSave = false } = {}) {
    return new Promise(async resolve => {
      const ini = mode === "initials", meP = Data.me();
      const savedAtt = !ini && (Data.get("people", meP.key) || {}).signature;
      const savedData = savedAtt ? (await waitFile(savedAtt.id, 4000))?.data || null : null;
      let tab = savedData && !forceSave ? "saved" : "draw", ink = INKS[0], fontI = 0, done = false, dirty = false;
      const W = ini ? 600 : 900, HH = 300;

      // draw: a smooth pen whose width follows the speed
      const drawCv = h("canvas", { class: "sg-pad-cv", width: W, height: HH }), dctx = drawCv.getContext("2d");
      dctx.lineCap = "round"; dctx.lineJoin = "round";
      let pts = [], pen = false, lw = 4;
      const base = W / 190;
      const at = e => { const r = drawCv.getBoundingClientRect(); return { x: (e.clientX - r.left) * drawCv.width / r.width, y: (e.clientY - r.top) * drawCv.height / r.height, t: e.timeStamp || performance.now() }; };
      drawCv.addEventListener("pointerdown", e => {
        e.preventDefault(); drawCv.setPointerCapture?.(e.pointerId); pen = true; dirty = true; drawHint.classList.add("gone");
        const p = at(e); pts = [p]; lw = base;
        dctx.fillStyle = ink; dctx.beginPath(); dctx.arc(p.x, p.y, lw / 2, 0, Math.PI * 2); dctx.fill();
      });
      drawCv.addEventListener("pointermove", e => {
        if (!pen) return;
        for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : null) || [e]) {
          const p = at(ev), a = pts[pts.length - 1], dd = Math.hypot(p.x - a.x, p.y - a.y);
          if (dd < 1.5) continue;
          const speed = dd / Math.max(1, p.t - a.t), target = clamp(base * 1.55 - speed * base * .45, base * .5, base * 1.55);
          lw = lw * .72 + target * .28; pts.push(p);
          const n = pts.length;
          if (n >= 3) {
            const p0 = pts[n - 3], p1 = pts[n - 2], p2 = pts[n - 1];
            dctx.strokeStyle = ink; dctx.lineWidth = lw; dctx.beginPath();
            dctx.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2); dctx.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2); dctx.stroke();
          } else { dctx.strokeStyle = ink; dctx.lineWidth = lw; dctx.beginPath(); dctx.moveTo(a.x, a.y); dctx.lineTo(p.x, p.y); dctx.stroke(); }
        }
      });
      const penUp = () => { if (!pen) return; pen = false; const n = pts.length; if (n >= 2) { const a = pts[n - 2], b = pts[n - 1]; dctx.strokeStyle = ink; dctx.lineWidth = lw; dctx.beginPath(); dctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2); dctx.lineTo(b.x, b.y); dctx.stroke(); } };
      drawCv.addEventListener("pointerup", penUp); drawCv.addEventListener("pointercancel", penUp); drawCv.addEventListener("lostpointercapture", penUp);
      const drawHint = h("div", { class: "sg-pad-hint", text: ini ? "Draw your initials here" : "Draw your signature here" });
      const clearDraw = () => { dctx.clearRect(0, 0, W, HH); dirty = false; drawHint.classList.remove("gone"); };

      // type: three handwriting-style renderings
      const nameIn = h("input", { class: "menu-input", maxlength: 60, placeholder: ini ? "Your initials" : "Your full name" });
      nameIn.value = ini ? initialsOf(meP.name) : meP.name;
      const renderTyped = (i, cv) => {
        const ctx = cv.getContext("2d"), t = nameIn.value.trim();
        ctx.clearRect(0, 0, cv.width, cv.height); if (!t) return;
        const [style, stack] = TYPE_FONTS[i]; let size = cv.height * .5;
        ctx.font = `${style} ${size}px ${stack}`;
        while (size > 12 && ctx.measureText(t).width > cv.width * .9) { size *= .92; ctx.font = `${style} ${size}px ${stack}`; }
        ctx.fillStyle = ink; ctx.textBaseline = "middle"; ctx.textAlign = "center"; ctx.fillText(t, cv.width / 2, cv.height * .54);
      };
      const typeOpts = h("div", { class: "sg-type-opts" });
      const drawTypeOpts = () => typeOpts.replaceChildren(...TYPE_FONTS.map((_, i) => {
        const cv = canvas(W, HH); renderTyped(i, cv);
        return h("button", { type: "button", class: "sg-type-opt" + (i === fontI ? " on" : ""), onclick: () => { fontI = i; drawTypeOpts(); } }, cv);
      }));
      nameIn.addEventListener("input", drawTypeOpts);

      // upload: an image of a signature; white paper becomes transparent
      const upCv = h("canvas", { class: "sg-pad-cv", width: W, height: HH }); let upImg = null;
      const whiteBox = h("input", { type: "checkbox", checked: true });
      const paintUp = () => {
        const ctx = upCv.getContext("2d"); ctx.clearRect(0, 0, W, HH); if (!upImg) return;
        const k = Math.min(W * .94 / upImg.naturalWidth, HH * .9 / upImg.naturalHeight), w = upImg.naturalWidth * k, hh = upImg.naturalHeight * k;
        ctx.drawImage(upImg, (W - w) / 2, (HH - hh) / 2, w, hh);
        if (whiteBox.checked) {
          const im = ctx.getImageData(0, 0, W, HH), px = im.data;
          for (let i = 0; i < px.length; i += 4) { const l = (px[i] + px[i + 1] + px[i + 2]) / 3; if (l > 215) px[i + 3] = 0; else if (l > 170) px[i + 3] = Math.round(px[i + 3] * (215 - l) / 45); }
          ctx.putImageData(im, 0, 0);
        }
      };
      whiteBox.onchange = paintUp;
      const pickUp = async () => {
        const [file] = await Apps.pickFiles(false); if (!file) return;
        if (!/^image\//.test(file.type)) return UI.toast("Choose a PNG or JPG image");
        const u = URL.createObjectURL(file);
        try { upImg = await loadImg(u); paintUp(); paint(); } catch (e) { UI.toast(e.message); } finally { URL.revokeObjectURL(u); }
      };

      const inkRow = () => h("div", { class: "sg-inks" }, ...INKS.map(c => h("button", { type: "button", class: "sg-ink" + (c === ink ? " on" : ""), title: c === INKS[0] ? "Black ink" : "Blue ink", style: { background: c },
        onclick: () => { ink = c; if (tab === "type") drawTypeOpts(); paint(); } })));
      const area = h("div", { class: "sg-pad-area" });
      const tabsEl = h("div", { class: "sg-pad-tabs" });
      const paintTabs = () => tabsEl.replaceChildren(seg([...(savedData ? [["saved", "Saved"]] : []), ["draw", "Draw"], ["type", "Type"], ["upload", "Upload"]], tab, k => { tab = k; paint(); }));
      function paint() {
        if (tab === "saved") area.replaceChildren(h("div", { class: "sg-pad-box saved" }, h("img", { src: savedData, alt: "Saved signature" })), h("div", { class: "sg-pad-sub", text: "Your saved signature" }));
        else if (tab === "draw") area.replaceChildren(h("div", { class: "sg-pad-box draw" + (ini ? " ini" : "") }, drawCv, h("div", { class: "sg-pad-line" }), drawHint),
          h("div", { class: "sg-pad-tools" }, inkRow(), h("button", { type: "button", class: "btn", text: "Clear", onclick: clearDraw })));
        else if (tab === "type") { drawTypeOpts(); area.replaceChildren(nameIn, typeOpts, h("div", { class: "sg-pad-tools" }, inkRow(), h("span", { class: "sg-pad-sub", text: "Pick a style" }))); }
        else area.replaceChildren(h("div", { class: "sg-pad-box up" + (ini ? " ini" : ""), onclick: () => !upImg && pickUp() }, upCv, upImg ? null : h("div", { class: "sg-pad-hint", text: "Choose an image of your signature" })),
          h("div", { class: "sg-pad-tools" }, h("label", { class: "sg-check" }, whiteBox, "Remove white background"), h("button", { type: "button", class: "btn", text: upImg ? "Choose another" : "Choose image", onclick: pickUp })));
        saveRow.style.display = !ini && tab !== "saved" ? "" : "none";
        paintTabs();
      }
      const result = () => {
        if (tab === "saved") return savedData;
        if (tab === "draw") return dirty ? trimCanvas(drawCv) : null;
        if (tab === "type") { if (!nameIn.value.trim()) return null; const cv = canvas(W, HH); renderTyped(fontI, cv); return trimCanvas(cv); }
        return upImg ? trimCanvas(upCv) : null;
      };
      const saveBox = h("input", { type: "checkbox", checked: forceSave });
      const saveRow = h("label", { class: "sg-check sg-save" }, saveBox, "Save my signature for next time");
      const adopt = h("button", { class: "btn primary", text: forceSave ? "Save signature" : ini ? "Use these initials" : "Adopt and sign" });
      const body = h("div", { class: "sg-pad" }, tabsEl, area, saveRow,
        h("div", { class: "sg-pad-legal", text: forceSave ? "Saved to your profile so you can sign with one tap." : "By adopting, you agree this is your electronic signature for this document." }),
        h("div", { class: "sg-pad-actions" }, h("button", { class: "btn", text: "Cancel", onclick: () => m.close() }), adopt));
      const m = UI.modal(forceSave ? "My signature" : ini ? "Add your initials" : "Add your signature", body, { className: "sg-pad-modal", backdropClass: "sg-pad-bd", onClose: () => { if (!done) resolve(null); } });
      m.el.style.width = "640px";
      adopt.onclick = async () => {
        const png = result();
        if (!png) return UI.toast(tab === "draw" ? "Draw first, then adopt" : tab === "type" ? "Type your name first" : "Choose an image first");
        adopt.disabled = true;
        try { if (!ini && tab !== "saved" && (saveBox.checked || forceSave)) { await saveMySignature(png); UI.toast("💾 Signature saved for next time"); } } catch (e) { console.warn(e); }
        done = true; m.close(); resolve(png);
      };
      paint();
    });
  }
  async function mySignature() {
    const att = (Data.get("people", meKey()) || {}).signature;
    const box = h("div", { class: "sg-mysig" });
    const m = UI.modal("My signature", box); m.el.style.width = "480px";
    const fill = cur => box.replaceChildren(
      cur ? h("div", { class: "sg-pad-box saved" }, attImg(cur)) : h("div", { class: "sg-mysig-empty", text: "No saved signature yet. Save one to sign with a single tap." }),
      h("div", { class: "sg-pad-actions" },
        cur ? h("button", { class: "btn danger", text: "Remove", onclick: async () => { await Data.update("people", meKey(), { signature: null }); if (Data.get("files", cur.id)?.folder === "__attachments") Data.remove("files", cur.id); UI.toast("Signature removed"); fill(null); } }) : h("span"),
        h("button", { class: "btn primary", text: cur ? "Replace" : "Create signature", onclick: async () => { m.close(); await signaturePad({ forceSave: true }); } })));
    fill(att);
  }

  /* ---------- picking a file ---------- */
  async function prepareFile(file) {
    const isImg = /^image\/(png|jpe?g)$/i.test(file.type) || /\.(png|jpe?g)$/i.test(file.name);
    const isPdf = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name);
    if (!isImg && !isPdf) throw new Error("Choose a PDF, JPG or PNG file.");
    if (isPdf && file.size > MAX) throw new Error(`“${file.name}” is ${Apps.fileSize(file.size)}. PDFs can be up to 700 KB on the free plan.`);
    let out = isImg ? await imageToPdf(file) : file;
    if (out.size > MAX) throw new Error(`That image makes a ${Apps.fileSize(out.size)} PDF. Try a smaller image (up to 700 KB).`);
    if (!out.type) out = new File([out], out.name, { type: "application/pdf" });
    const lib = await pdfjs();
    let pages = 0;
    try { const pdf = await lib.getDocument({ data: new Uint8Array(await out.arrayBuffer()) }).promise; pages = pdf.numPages; pdf.destroy(); }
    catch (e) { throw new Error(e && e.name === "PasswordException" ? "This PDF is password-protected. Remove the password and try again." : "This file doesn't look like a valid PDF."); }
    const [att] = await Apps.attach([out]);
    if (!att) throw new Error("Upload failed.");
    return { att, pages };
  }
  function drivePicker() {
    return new Promise(resolve => {
      let done = false;
      const files = Data.list("files").filter(f => f.folder !== "__attachments" && !f.deleted && f.type !== "link" && f.data && !(f.scope === "personal" && (f.owner || f.by) !== meKey()) && (/pdf/i.test(f.type) || /^image\/(png|jpe?g)$/i.test(f.type))).sort((a, b) => (b.at || 0) - (a.at || 0));
      const q = h("input", { class: "menu-input", placeholder: "Search Drive…" }), list = h("div", { class: "sg-drive-list" });
      const draw = () => {
        const s = q.value.toLowerCase(), fs = files.filter(f => (f.name || "").toLowerCase().includes(s));
        list.replaceChildren(...(fs.length ? fs.map(f => h("button", { class: "mi compact sg-drive-row", onclick: () => { done = true; m.close(); resolve(dataToFile(f.data, f.name, f.type)); } },
          h("span", { class: "mi-ic", text: /pdf/i.test(f.type) ? "📕" : "🖼️" }), h("span", { class: "mi-t", text: f.name }), h("span", { class: "mi-k", text: Apps.fileSize(f.size) }))) : [h("div", { class: "menu-empty", text: files.length ? "Nothing found" : "No PDFs or images in Drive yet" })]));
      };
      q.addEventListener("input", draw); draw();
      const m = UI.modal("Pick from Drive", h("div", null, q, list), { onClose: () => { if (!done) resolve(null); } });
      m.el.style.width = "460px"; setTimeout(() => q.focus(), 50);
    });
  }

  /* ---------- actions on a document ---------- */
  async function remind(d, keys) {
    const r = { ...(d.reminded || {}) }, t = now();
    const ok = keys.filter(k => k !== meKey() && !(r[k] > t - HOUR));
    if (!ok.length) return UI.toast(keys.some(k => k !== meKey()) ? "You can remind each signer once an hour" : "Nobody to remind");
    ok.forEach(k => { r[k] = t; Data.notify(k, `⏰ ${esc(Data.me().name)} reminds you to sign “${esc(d.title || "Untitled")}”`, link(d.id), d.note || ""); });
    await touch(d.id, { reminded: r });
    await audit(d.id, "reminded", ok.map(pname).join(", "));
    UI.toast(`⏰ Reminder sent to ${ok.map(first).join(", ")}`);
  }
  async function cancelDoc(d) {
    if (!(await UI.confirm(`Cancel “${d.title}”? Signers can't sign it any more.`, "Cancel document"))) return;
    await touch(d.id, { status: "cancelled", cancelledAt: now() });
    await audit(d.id, "cancelled");
    signersOf(d).forEach(s => Data.notify(s.key, `🚫 ${esc(Data.me().name)} cancelled “${esc(d.title || "Untitled")}”`, link(d.id)));
    UI.toast("Document cancelled");
  }
  async function duplicate(d) {
    const hr = d.kind === "hr", map = k => !hr ? k : k === d.company && d.company ? "__company" : "__employee";
    const fields = (d.fields || []).map(f => { const { value, ...rest } = f; return { ...rest, id: fid(), signer: map(f.signer) }; });
    const doc = { title: (d.title || "Untitled").replace(/ · [^·]+$/, hr ? "" : "$&") + " (copy)", file: d.file, kind: d.kind || "general", order: d.order || "sequence", status: "draft", note: d.note || "", pages: d.pages || 0,
      signers: hr ? [] : (d.signers || []).map(s => ({ key: s.key, name: s.name || pname(s.key) })), company: hr ? (d.company || "") : "", employees: hr ? (d.employee ? [d.employee] : d.employees || []) : [],
      fields, audit: [{ at: now(), by: meKey(), action: "created", info: "Copy of “" + (d.title || "Untitled") + "”" }], updatedAt: now() };
    const id = await Data.add(COL, doc);
    UI.toast("📄 Copy saved to drafts");
    Apps.go("sign", "e:" + id);
  }
  async function deleteDoc(d) {
    if (!(await UI.confirm(`Delete “${d.title || "Untitled"}”? This can't be undone.`))) return;
    await Data.remove(COL, d.id);
    const others = Data.list(COL);
    if (d.file && !others.some(x => x.file?.id === d.file.id) && Data.get("files", d.file.id)?.folder === "__attachments") Data.remove("files", d.file.id);
    (d.done || []).forEach(x => [x.sig, x.ini].forEach(a => { if (a && Data.get("files", a.id)?.folder === "__attachments") Data.remove("files", a.id); }));
    UI.toast("Deleted");
    Apps.go("sign");
  }
  async function downloadSigned(d, btn) {
    if (d.signed) { const f = await waitFile(d.signed.id); if (f?.data) return download(dataToBytes(f.data), safeName(d.title) + " (signed).pdf"); }
    const old = btn && btn.textContent; if (btn) { btn.disabled = true; btn.textContent = "Preparing…"; }
    try { download(await buildSigned(d), safeName(d.title) + " (signed).pdf"); }
    catch (e) { console.warn(e); UI.toast("Couldn't build the signed PDF: " + (e.message || e)); }
    finally { if (btn) { btn.disabled = false; btn.textContent = old; } }
  }
  async function downloadOriginal(d) {
    const f = await waitFile(d.file?.id);
    if (!f?.data) return UI.toast("That file is no longer available");
    download(dataToBytes(f.data), safeName(d.title) + ".pdf");
  }

  /* ================= views ================= */
  function render(root, arg) {
    const ctx = { root, cleanups: [] };
    const route = String(arg || "");
    if (!route) listView(ctx);
    else if (route === "new") { if (canEdit()) wizard(ctx, null); else Apps.go("sign"); }
    else {
      const m = route.match(/^([dse]):(.+)$/), kind = m ? m[1] : "", id = m ? m[2] : route;
      withDoc(ctx, id, d => {
        if (!canSee(d)) { root.replaceChildren(Apps.empty("🔒", "You're not a signer of this document.", h("button", { class: "btn", text: "Back to documents", onclick: () => Apps.go("sign") }))); return; }
        const mine = d.by === meKey();
        if (kind === "e" || (!kind && d.status === "draft")) { if (d.status === "draft" && mine) wizard(ctx, d); else docView(ctx, id); }
        else if (kind === "s" || (!kind && myTurn(d))) { if (myTurn(d)) signView(ctx, d); else docView(ctx, id); }
        else docView(ctx, id);
      });
    }
    return () => ctx.cleanups.forEach(f => { try { f(); } catch (e) { console.warn(e); } });
  }
  // wait for a document to arrive from the workspace
  function withDoc(ctx, id, fn) {
    const d = Data.get(COL, id);
    if (d) return fn(d);
    const loading = h("div", { class: "sg-loading big" }, h("span", { class: "sg-spin" }), "Opening the document…");
    ctx.root.append(loading);
    let off = null, done = false;
    const t = setTimeout(() => { if (done) return; done = true; off && off(); ctx.root.replaceChildren(Apps.empty("🔍", "This document was deleted or you don't have access.", h("button", { class: "btn", text: "Back to documents", onclick: () => Apps.go("sign") }))); }, 8000);
    off = Data.on(COL, () => { const x = Data.get(COL, id); if (x && !done) { done = true; clearTimeout(t); setTimeout(() => { off && off(); loading.remove(); fn(x); }); } });
    ctx.cleanups.push(() => { done = true; clearTimeout(t); off && off(); });
  }

  /* ---------- list ---------- */
  function listView(ctx) {
    const { root } = ctx;
    let tab = localStorage.getItem("lumen-sign-tab") || "tosign", q = "", kind = "";
    if (tab === "all" && !isAdmin()) tab = "tosign";
    const tabsBox = h("div"), listBox = h("div", { class: "sg-list" });
    const search = h("input", { class: "app-search", placeholder: "Search documents or people…", oninput: () => { q = search.value.toLowerCase(); draw(); } });
    const kindSel = h("select", { class: "app-select", onchange: () => { kind = kindSel.value; draw(); } }, h("option", { value: "" }, "All types"), h("option", { value: "general" }, "General"), h("option", { value: "hr" }, "HR documents"));
    root.append(
      Apps.header("e-Signature", "✍️", "Send documents for signature and sign them online",
        h("button", { class: "btn", text: "🖋️ My signature", onclick: mySignature }),
        canEdit() ? h("button", { class: "btn primary", text: "+ New document", onclick: () => Apps.go("sign", "new") }) : null),
      tabsBox, h("div", { class: "app-toolbar" }, search, kindSel), listBox, security());

    function rows() {
      const me = meKey(), all = Data.list(COL);
      const sets = {
        tosign: all.filter(d => myTurn(d)),
        upcoming: all.filter(d => d.status === "sent" && !myTurn(d) && signersOf(d).some(s => s.key === me && s.status === "waiting")),
        sent: all.filter(d => d.by === me && d.status !== "draft"),
        done: all.filter(d => d.status === "completed" && involved(d)),
        drafts: all.filter(d => d.status === "draft" && d.by === me),
        all: isAdmin() ? all.filter(d => d.status !== "draft" || d.by === me) : [],
      };
      return sets;
    }
    function match(d) {
      if (kind && (d.kind || "general") !== kind) return false;
      if (!q) return true;
      const names = [d.title, pname(d.by), ...(d.signers || []).map(s => pname(s.key)), ...(d.employees || []).map(pname)].join(" ").toLowerCase();
      return names.includes(q);
    }
    function draw() {
      const sets = rows(), n = k => sets[k].length;
      tabsBox.replaceChildren(Apps.tabs([["tosign", "To sign" + (n("tosign") ? ` (${n("tosign")})` : "")], ["sent", "Sent by me"], ["done", "Completed"], ["drafts", "Drafts" + (n("drafts") ? ` (${n("drafts")})` : "")], ...(isAdmin() ? [["all", "All"]] : [])], tab,
        k => { tab = k; try { localStorage.setItem("lumen-sign-tab", k); } catch {} draw(); }));
      const sort = a => a.filter(match).sort((x, y) => (y.updatedAt || y.at || 0) - (x.updatedAt || x.at || 0));
      const list = sort(sets[tab]);
      const out = [];
      if (list.length) out.push(...list.map((d, i) => row(d, i)));
      if (tab === "tosign") {
        const up = sort(sets.upcoming);
        if (up.length) out.push(h("div", { class: "td-sec", text: "Up next: waiting for others to sign first" }), ...up.map((d, i) => row(d, i, true)));
      }
      if (!out.length) out.push(Apps.empty(...{
        tosign: ["🎉", "Nothing waiting for your signature."],
        sent: ["📤", "Documents you send for signature show up here."],
        done: ["✅", "Fully signed documents land here."],
        drafts: ["📝", "No drafts. Start a new document to prepare one."],
        all: ["🗂️", "No documents in this workspace yet."],
      }[tab], canEdit() && tab !== "done" ? h("button", { class: "btn primary", text: "+ New document", onclick: () => Apps.go("sign", "new") }) : null));
      listBox.replaceChildren(...out);
    }
    function row(d, i, dim) {
      const ss = signersOf(d), [a, b] = progressOf(d), turn = myTurn(d);
      const hrDraft = d.status === "draft" && d.kind === "hr";
      const people = hrDraft ? (d.employees || []).map(k => ({ key: k, status: "waiting" })) : ss;
      const avs = h("span", { class: "sg-avs" }, ...people.slice(0, 5).map(s => h("span", { class: "sg-av s-" + s.status, title: `${pname(s.key)} · ${s.status}` }, Apps.avatar(Data.person(s.key), 26))),
        people.length > 5 ? h("span", { class: "av-more", text: "+" + (people.length - 5) }) : null);
      const waitingFor = d.status === "sent" ? nextUp(d).map(s => s.key === meKey() ? "you" : first(s.key)).join(", ") : "";
      return h("div", { class: "sg-row glass" + (turn ? " turn" : "") + (dim ? " dim" : ""), style: { animationDelay: Math.min(i, 12) * 30 + "ms" }, role: "button", tabindex: 0,
        onclick: () => Apps.go("sign", d.id), onkeydown: e => { if (e.key === "Enter") Apps.go("sign", d.id); } },
        h("div", { class: "sg-doc-ic", text: d.kind === "hr" ? "🧑‍💼" : "📄" }),
        h("div", { class: "sg-row-main" },
          h("div", { class: "sg-row-title" }, h("b", { text: d.title || "Untitled" }), kindChip(d)),
          h("div", { class: "sg-row-sub" }, d.by === meKey() ? "From you" : "From " + pname(d.by), waitingFor ? ` · Waiting for ${waitingFor}` : "", d.status === "declined" && d.declined ? ` · ${first(d.declined.by)} declined` : "")),
        h("div", { class: "sg-row-st" }, chip(d.status)),
        h("div", { class: "sg-row-signers" }, avs, people.length ? h("div", { class: "sg-prog" }, h("small", { text: hrDraft ? `${people.length} employee${people.length === 1 ? "" : "s"}` : `${a}/${b} signed` }),
          hrDraft ? null : h("div", { class: "sg-bar" }, h("span", { style: { width: (b ? a / b * 100 : 0) + "%" } }))) : h("small", { class: "sg-muted", text: "No signers yet" })),
        h("div", { class: "sg-row-date" }, h("span", { text: "Created " + fmtDay(d.at) }), h("small", { text: "Updated " + UI.timeAgo(d.updatedAt || d.at) })),
        turn ? h("button", { class: "btn primary sg-row-btn", text: "Sign", onclick: e => { e.stopPropagation(); Apps.go("sign", "s:" + d.id); } }) : h("span", { class: "sg-row-go", html: UI.icon("caret") }));
    }
    const redraw = UI.liveDraw(root, draw);
    const off = Data.on(COL, redraw), off2 = Data.on("people", redraw);
    ctx.cleanups.push(off, off2);
  }

  /* ---------- new document wizard ---------- */
  const STEPS = ["Document", "Signers", "Fields", "Review"];
  function wizard(ctx, existing) {
    const { root } = ctx;
    const d = existing ? JSON.parse(JSON.stringify(existing)) : { title: "", file: null, pages: 0, kind: "general", order: "sequence", signers: [], fields: [], note: "", employees: [], company: meKey(), status: "draft" };
    d.signers ||= []; d.fields ||= []; d.employees ||= []; d.kind ||= "general"; d.order ||= "sequence"; if (d.company == null) d.company = meKey();
    let step = 0, saveT = null, ed = null, sending = false;
    const editable = () => ({ title: d.title, file: d.file, pages: d.pages || 0, kind: d.kind, order: d.order, signers: d.signers, fields: d.fields, note: d.note || "", employees: d.employees, company: d.company || "" });
    const save = () => { clearTimeout(saveT); if (d.id && d.status === "draft" && Data.get(COL, d.id)?.status === "draft") return touch(d.id, editable()); };
    const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(save, 900); };
    ctx.cleanups.push(() => { if (!sending) save(); ed && ed.destroy(); });

    const stepsEl = h("div", { class: "sg-steps" }), body = h("div", { class: "sg-wbody" }), foot = h("div", { class: "sg-wfoot" });
    root.append(
      h("div", { class: "sg-whead" },
        h("button", { class: "btn sg-back", text: "← Documents", onclick: () => Apps.go("sign") }),
        h("h1", { text: existing ? "Edit draft" : "New document" }),
        h("div", { class: "grow" }),
        h("button", { class: "btn", text: "Save draft", onclick: async () => { if (!d.id) return UI.toast("Add a file first"); await save(); UI.toast("💾 Draft saved"); } })),
      stepsEl, body, foot);

    const signerList = () => d.kind === "hr"
      ? [...(d.company ? [{ key: "__company", name: "Company · " + first(d.company) }] : []), { key: "__employee", name: "Employee" }]
      : d.signers.map(s => ({ key: s.key, name: pname(s.key) }));
    const canGo = i => i === 0 || !!(d.file && (d.title || "").trim());
    function go(i) {
      if (i > step) {
        if (step === 0 && !d.file) return UI.toast("Add a PDF first");
        if (step === 0 && !(d.title || "").trim()) return UI.toast("Give the document a title");
        if (step === 1 && d.kind !== "hr" && !d.signers.length) return UI.toast("Add at least one signer");
        if (step === 1 && d.kind === "hr" && !d.employees.filter(k => k !== d.company).length) return UI.toast("Add at least one employee");
      }
      if (!canGo(i)) return;
      ed && ed.destroy(); ed = null;
      step = i; save(); paint();
    }
    function paint() {
      stepsEl.replaceChildren(...STEPS.map((s, i) => h("button", { type: "button", class: "sg-step" + (i === step ? " on" : "") + (i < step ? " past" : ""), disabled: !canGo(i), onclick: () => go(i) },
        h("span", { class: "sg-step-n", text: i < step ? "✓" : String(i + 1) }), h("span", { text: s }))));
      body.replaceChildren(); body.classList.remove("sg-fade"); void body.offsetWidth; body.classList.add("sg-fade");
      [stepFile, stepSigners, stepFields, stepReview][step]();
      foot.replaceChildren(
        step > 0 ? h("button", { class: "btn", text: "← Back", onclick: () => go(step - 1) }) : h("span"),
        step < 3 ? h("button", { class: "btn primary", text: "Next →", onclick: () => go(step + 1) }) : h("button", { class: "btn primary big sg-send", text: d.kind === "hr" ? "Send to employees" : "Send for signing", onclick: e => send(e.currentTarget) }));
    }

    /* step 1: file, title, kind */
    function stepFile() {
      const status = h("div", { class: "sg-up-status" });
      const busy = on => { status.replaceChildren(...(on ? [h("span", { class: "sg-spin" }), on] : [])); };
      async function use(file) {
        if (!file) return;
        busy("Preparing your document…");
        try {
          const { att, pages } = await prepareFile(file);
          const old = d.file;
          d.file = att; d.pages = pages;
          d.fields = d.fields.filter(f => f.page < pages);
          if (!d.title.trim()) d.title = file.name.replace(/\.\w+$/, "").replace(/[_-]+/g, " ").trim();
          if (!d.id) {
            d.id = await Data.add(COL, { ...editable(), status: "draft", audit: [{ at: now(), by: meKey(), action: "created" }], updatedAt: now() });
            try { history.replaceState(null, "", "#/app/sign/" + encodeURIComponent("e:" + d.id)); } catch {}
          } else await save();
          if (old && old.id !== att.id && !Data.list(COL).some(x => x.id !== d.id && x.file?.id === old.id) && Data.get("files", old.id)?.folder === "__attachments") Data.remove("files", old.id);
          pdfCache.delete(att.id);
          paint();
        } catch (e) { console.warn(e); busy(""); UI.toast(e.message || "Couldn't use that file"); }
      }
      const pick = async () => { const [f] = await Apps.pickFiles(false); use(f); };
      const fromDrive = async () => use(await drivePicker());
      const zone = h("div", { class: "sg-drop" + (d.file ? " has" : "") },
        d.file ? h("div", { class: "sg-filecard" }, thumb(d.file, 120),
          h("div", { class: "sg-filemeta" }, h("b", { text: d.file.name }), h("small", { text: `${Apps.fileSize(d.file.size)} · ${d.pages || "?"} page${d.pages === 1 ? "" : "s"}` }),
            h("div", { class: "sg-filebtns" }, h("button", { class: "btn", text: "Replace", onclick: pick }), h("button", { class: "btn", text: "From Drive", onclick: fromDrive }))))
          : h("div", { class: "sg-drop-in" }, h("div", { class: "sg-drop-ic", text: "📄" }), h("b", { text: "Drop a PDF here" }),
            h("small", { text: "PDF up to 700 KB. JPG and PNG images become a one-page PDF." }),
            h("div", { class: "sg-filebtns" }, h("button", { class: "btn primary", text: "⬆ Upload file", onclick: pick }), h("button", { class: "btn", text: "🗂️ From Drive", onclick: fromDrive }))),
        status);
      zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("over"));
      zone.addEventListener("drop", e => { e.preventDefault(); zone.classList.remove("over"); use(e.dataTransfer?.files?.[0]); });
      const title = h("input", { class: "menu-input", placeholder: "e.g. Employment contract", maxlength: 140 });
      title.value = d.title; title.oninput = () => { d.title = title.value; saveSoon(); stepsEl.querySelectorAll(".sg-step").forEach((b, i) => { b.disabled = !canGo(i); }); };
      const noteIn = h("textarea", { class: "menu-input f-ta", rows: 3, placeholder: "Optional: a short note for the signers", maxlength: 600 });
      noteIn.value = d.note || ""; noteIn.oninput = () => { d.note = noteIn.value; saveSoon(); };
      const kindHint = h("small", { class: "sg-hint" });
      const paintHint = () => { kindHint.textContent = d.kind === "hr" ? "Send the same document to many employees: each one gets a personal copy to sign, after the company signer if you add one." : "One document, signed by the people you choose."; };
      paintHint();
      body.append(h("div", { class: "sg-card glass" }, zone,
        h("label", { class: "f-row" }, h("span", { text: "Title" }), title),
        h("div", { class: "f-row" }, h("span", { text: "Type" }), seg([["general", "General"], ["hr", "HR document"]], d.kind, k => { d.kind = k; if (k === "hr" && d.fields.some(f => !f.signer.startsWith("__"))) d.fields = []; if (k === "general" && d.fields.some(f => f.signer.startsWith("__"))) d.fields = []; paintHint(); saveSoon(); }), kindHint),
        h("label", { class: "f-row" }, h("span", { text: "Message to signers" }), noteIn)));
      setTimeout(() => { if (d.file && !d.title) title.focus(); }, 60);
    }

    /* step 2: signers */
    function stepSigners() {
      const card = h("div", { class: "sg-card glass" });
      body.append(note("👥 Signers must be members of this workspace. External signers aren't supported in this version.", "info"), card);
      d.kind === "hr" ? hrSigners(card) : generalSigners(card);
    }
    function generalSigners(card) {
      const listEl = h("div", { class: "sg-signers" });
      const setKeys = keys => {
        const keep = d.signers.filter(s => keys.includes(s.key));
        keys.forEach(k => { if (!keep.some(s => s.key === k)) keep.push({ key: k, name: pname(k) }); });
        d.signers = keep; d.fields = d.fields.filter(f => keys.includes(f.signer)); saveSoon(); drawList();
      };
      let dragI = -1;
      function drawList() {
        const seq = d.order === "sequence";
        listEl.replaceChildren(...(d.signers.length ? d.signers.map((s, i) => {
          const r = h("div", { class: "sg-signer" + (seq ? " seq" : ""), draggable: seq, style: { "--sc": COLORS[i % COLORS.length] } },
            seq ? h("span", { class: "sg-grip", html: UI.icon("drag"), title: "Drag to reorder" }) : null,
            h("span", { class: "sg-signer-n", text: seq ? String(i + 1) : "" }),
            Apps.avatar(Data.person(s.key), 30),
            h("div", { class: "sg-signer-t" }, h("b", { text: pname(s.key) + (s.key === meKey() ? " (you)" : "") }), h("small", { text: Data.person(s.key).email || Data.person(s.key).title || "" })),
            h("span", { class: "sg-signer-c", text: `${d.fields.filter(f => f.signer === s.key).length} fields` }),
            seq ? h("button", { class: "icon-btn xs", title: "Move up", text: "↑", disabled: i === 0, onclick: () => move(i, i - 1) }) : null,
            seq ? h("button", { class: "icon-btn xs", title: "Move down", text: "↓", disabled: i === d.signers.length - 1, onclick: () => move(i, i + 1) }) : null,
            h("button", { class: "icon-btn xs", title: "Remove", html: UI.icon("x"), onclick: () => setKeys(d.signers.filter(x => x.key !== s.key).map(x => x.key)) }));
          if (seq) {
            r.addEventListener("dragstart", e => { dragI = i; r.classList.add("dragging"); try { e.dataTransfer.setData("text/plain", String(i)); e.dataTransfer.effectAllowed = "move"; } catch {} });
            r.addEventListener("dragend", () => { r.classList.remove("dragging"); listEl.querySelectorAll(".over").forEach(x => x.classList.remove("over")); });
            r.addEventListener("dragover", e => { e.preventDefault(); r.classList.add("over"); });
            r.addEventListener("dragleave", () => r.classList.remove("over"));
            r.addEventListener("drop", e => { e.preventDefault(); r.classList.remove("over"); if (dragI >= 0 && dragI !== i) move(dragI, i); dragI = -1; });
          }
          return r;
        }) : [h("div", { class: "sg-empty-s", text: "No signers yet. Add the people who need to sign." })]));
      }
      function move(a, b) { if (b < 0 || b >= d.signers.length) return; const [x] = d.signers.splice(a, 1); d.signers.splice(b, 0, x); saveSoon(); drawList(); }
      const addBtn = h("button", { class: "btn primary", text: "+ Add signers", onclick: () => Apps.peoplePicker(addBtn, d.signers.map(s => s.key), setKeys) });
      card.append(
        h("div", { class: "f-row" }, h("span", { text: "Signing order" }), seg([["sequence", "In sequence"], ["any", "Any order"]], d.order, k => { d.order = k; saveSoon(); drawList(); }),
          h("small", { class: "sg-hint", text: "In sequence: each signer gets the document after the previous one signs. Drag to reorder." })),
        listEl,
        h("div", { class: "sg-filebtns" }, addBtn, d.signers.some(s => s.key === meKey()) ? null : h("button", { class: "btn", text: "Add me", onclick: () => setKeys([...d.signers.map(s => s.key), meKey()]) })));
      drawList();
    }
    function hrSigners(card) {
      const compBtn = h("button", { class: "menu-input f-person sg-comp", type: "button" });
      const paintComp = () => { compBtn.replaceChildren(d.company ? Apps.avatar(Data.person(d.company), 22) : "", h("span", { text: d.company ? pname(d.company) : "No company signer" })); };
      compBtn.onclick = () => Apps.personPicker(compBtn, p => {
        d.company = p ? p.key : ""; if (!d.company) d.fields = d.fields.filter(f => f.signer !== "__company");
        d.employees = d.employees.filter(k => k !== d.company); paintComp(); drawEmps(); saveSoon();
      }, { allowNone: true });
      paintComp();
      const emps = h("div", { class: "sg-emps" }), count = h("div", { class: "sg-hint" });
      const setEmps = keys => { d.employees = [...new Set(keys)].filter(k => k !== d.company); saveSoon(); drawEmps(); };
      function drawEmps() {
        emps.replaceChildren(...(d.employees.length ? d.employees.map(k => h("span", { class: "sg-emp" }, Apps.avatar(Data.person(k), 22), h("span", { text: pname(k) }),
          h("button", { type: "button", class: "fc-x", title: "Remove", text: "×", onclick: () => setEmps(d.employees.filter(x => x !== k)) }))) : [h("div", { class: "sg-empty-s", text: "No employees yet." })]));
        count.textContent = d.employees.length ? `${d.employees.length} employee${d.employees.length === 1 ? "" : "s"} · each gets a personal copy to sign` : "";
      }
      const depts = () => {
        const names = (Apps.HR?.departments?.() || []).map(x => x.name);
        return [...new Set([...names, ...Data.people().map(p => p.dept).filter(Boolean)])].sort();
      };
      const addBtn = h("button", { class: "btn primary", text: "+ Add employees", onclick: () => Apps.peoplePicker(addBtn, d.employees, setEmps, { exclude: d.company ? [d.company] : [] }) });
      const deptBtn = h("button", { class: "btn", text: "🏢 Add a department ▾", onclick: () => {
        const ds = depts();
        UI.menu(deptBtn, ds.length ? [{ section: "Add everyone in" }, ...ds.map(n => { const ps = Data.people().filter(p => p.dept === n); return { label: `${n} (${ps.length})`, onClick: () => { setEmps([...d.employees, ...ps.map(p => p.key)]); UI.toast(`Added ${ps.length} from ${n}`); } }; })]
          : [{ section: "No departments yet" }, { label: "Set departments in Company & HR", onClick: () => Apps.go("company") }]);
      } });
      card.append(
        h("div", { class: "f-row" }, h("span", { text: "Company signer" }), compBtn, h("small", { class: "sg-hint", text: "Signs every copy on behalf of the company (optional)." })),
        h("div", { class: "f-row" }, h("span", { text: "Signing order" }), seg([["sequence", "Company signs first"], ["any", "Any order"]], d.order, k => { d.order = k; saveSoon(); })),
        h("div", { class: "f-row" }, h("span", { text: "Employees" }), emps, count),
        h("div", { class: "sg-filebtns" }, addBtn, deptBtn, h("button", { class: "btn", text: "Everyone", onclick: () => setEmps(Data.people().map(p => p.key)) }),
          d.employees.length ? h("button", { class: "btn", text: "Clear", onclick: () => setEmps([]) }) : null));
      drawEmps();
    }

    /* step 3: place fields */
    function stepFields() {
      const sl = signerList();
      d.fields = d.fields.filter(f => sl.some(s => s.key === f.signer));
      ed = fieldEditor(d, sl, saveSoon);
      body.append(ed.el);
    }

    /* step 4: review and send */
    function stepReview() {
      const sl = signerList(), problems = [];
      if (!d.file) problems.push("Add a PDF.");
      if (!(d.title || "").trim()) problems.push("Give the document a title.");
      if (d.kind === "hr" && !d.employees.filter(k => k !== d.company).length) problems.push("Add at least one employee.");
      if (d.kind !== "hr" && !d.signers.length) problems.push("Add at least one signer.");
      sl.forEach(s => { if (!d.fields.some(f => f.signer === s.key)) problems.push(`Place at least one field for ${s.name}.`); });
      const counts = k => Object.keys(FIELD).map(t => [t, d.fields.filter(f => f.signer === k && f.type === t).length]).filter(x => x[1]).map(([t, n]) => `${n} ${FIELD[t].label.toLowerCase()}`).join(", ") || "no fields";
      const seq = d.order === "sequence";
      const emps = d.employees.filter(k => k !== d.company);
      body.append(h("div", { class: "sg-review" },
        h("div", { class: "sg-card glass sg-rv-doc" }, d.file ? thumb(d.file, 130) : null,
          h("div", null, h("div", { class: "sg-rv-title", text: d.title || "Untitled" }), h("div", { class: "sg-row-sub" }, d.kind === "hr" ? "HR document" : "General document", ` · ${d.pages || "?"} page${d.pages === 1 ? "" : "s"} · ${d.fields.length} field${d.fields.length === 1 ? "" : "s"}`),
            d.note ? h("div", { class: "sg-rv-note", text: "“" + d.note + "”" }) : null)),
        h("div", { class: "sg-card glass" },
          h("div", { class: "td-sec", style: { marginTop: 0 }, text: d.kind === "hr" ? "Who signs each copy" : seq ? "Signers, in this order" : "Signers, in any order" }),
          ...sl.map((s, i) => h("div", { class: "sg-rv-signer", style: { "--sc": COLORS[i % COLORS.length] } },
            h("span", { class: "sg-signer-n", text: seq ? String(i + 1) : "•" }),
            s.key.startsWith("__") ? h("span", { class: "sg-role-ic", text: s.key === "__company" ? "🏢" : "🧑‍💼" }) : Apps.avatar(Data.person(s.key), 28),
            h("div", { class: "sg-signer-t" }, h("b", { text: s.key === "__company" ? pname(d.company) + " (company)" : s.name }), h("small", { text: counts(s.key) })))),
          d.kind === "hr" ? h("div", { class: "sg-rv-emps" }, h("small", { text: `${emps.length} cop${emps.length === 1 ? "y" : "ies"} will be sent, one per employee:` }), Apps.avatars(emps, 24, 12)) : null),
        problems.length ? note(h("div", null, h("b", { text: "Before sending" }), h("ul", null, ...problems.map(p => h("li", { text: p })))), "warn") : note("✅ Ready to send. Signers get a notification in Lumen" + (seq ? ", one after another." : "."), "ok"),
        security()));
    }

    async function send(btn) {
      const sl = signerList();
      if (!d.file || !(d.title || "").trim()) return UI.toast("Add a file and a title first");
      if (d.kind !== "hr" && !d.signers.length) return UI.toast("Add at least one signer");
      const emps = d.employees.filter(k => k !== d.company);
      if (d.kind === "hr" && !emps.length) return UI.toast("Add at least one employee");
      const missing = sl.find(s => !d.fields.some(f => f.signer === s.key));
      if (missing) return UI.toast(`Place at least one field for ${missing.name}`);
      sending = true; clearTimeout(saveT);
      btn.disabled = true; btn.textContent = "Sending…";
      try {
        const hash = await sha256(await fileBytes(d.file)).catch(() => "");
        const t = now();
        if (d.kind !== "hr") {
          const doc = { ...editable(), title: d.title.trim(), signers: d.signers.map((s, i) => newSigner(s.key, i + 1)), status: "sent", hash, sentAt: t };
          await touch(d.id, doc);
          await audit(d.id, "sent");
          d.status = "sent";
          nextUp(Data.get(COL, d.id)).forEach(s => Data.notify(s.key, askText(d), link(d.id), d.note));
          UI.toast("📨 Sent for signing");
          Apps.go("sign", "d:" + d.id);
        } else {
          const prevAudit = Data.get(COL, d.id)?.audit || [];
          for (let i = 0; i < emps.length; i++) {
            const e = emps[i], signers = [];
            if (d.company) signers.push(newSigner(d.company, 1));
            signers.push(newSigner(e, signers.length + 1));
            const fields = d.fields.filter(f => d.company || f.signer !== "__company").map(f => ({ ...f, signer: f.signer === "__company" ? d.company : e }));
            const doc = { title: `${d.title.trim()} · ${pname(e)}`, file: d.file, pages: d.pages || 0, kind: "hr", order: d.order, note: d.note || "", status: "sent", hash, sentAt: t, updatedAt: t,
              signers, fields, company: d.company || "", employee: e, employees: [], batch: d.id };
            let id;
            if (i === 0) { id = d.id; await Data.update(COL, id, { ...doc, audit: [...prevAudit, { at: t, by: meKey(), action: "sent" }] }); }
            else id = await Data.add(COL, { ...doc, audit: [{ at: t, by: meKey(), action: "created" }, { at: t, by: meKey(), action: "sent" }] });
            nextUp(doc).forEach(s => Data.notify(s.key, askText(doc), link(id), d.note));
            if (emps.length > 3 && i % 5 === 4) btn.textContent = `Sending… ${i + 1}/${emps.length}`;
          }
          d.status = "sent";
          UI.toast(`📨 Sent ${emps.length} cop${emps.length === 1 ? "y" : "ies"}`);
          try { localStorage.setItem("lumen-sign-tab", "sent"); } catch {}
          Apps.go("sign", emps.length === 1 ? "d:" + d.id : "");
        }
      } catch (e) {
        console.warn(e); sending = false; btn.disabled = false; btn.textContent = "Try again";
        UI.toast("Couldn't send: " + (e.message || e));
      }
    }
    paint();
  }

  /* ---------- field editor (step 3) ---------- */
  function fieldEditor(d, signers, onChange) {
    let active = signers[0]?.key, armed = null, selected = null;
    const colorOf = k => COLORS[Math.max(0, signers.findIndex(s => s.key === k)) % COLORS.length];
    const nameOf = k => (signers.find(s => s.key === k) || {}).name || "?";
    const palette = h("div", { class: "sg-palette glass" });
    const info = h("span", { class: "sg-ed-info" });
    const v = viewer(d.file, {
      cls: "sg-edit-scroll",
      onPage: p => {
        p.layer.addEventListener("click", e => {
          if (e.target !== p.layer) return;
          if (armed) placeAt(p, armed, e.clientX, e.clientY);
          else if (selected) { selected = null; v.el.querySelectorAll(".sg-f.sel").forEach(x => x.classList.remove("sel")); }
        });
        paintPage(p);
      },
    });
    const changed = () => { drawPalette(); onChange(); };
    function drawPalette() {
      info.textContent = `${d.fields.length} field${d.fields.length === 1 ? "" : "s"} placed`;
      palette.replaceChildren(
        h("div", { class: "sg-pal-sec", text: "Fields for" }),
        h("div", { class: "sg-pal-signers" }, ...signers.map(s => h("button", { type: "button", class: "sg-pal-signer" + (s.key === active ? " on" : ""), style: { "--sc": colorOf(s.key) }, onclick: () => { active = s.key; drawPalette(); } },
          h("i"), h("span", { class: "sg-pal-name", text: s.name }), h("small", { text: String(d.fields.filter(f => f.signer === s.key).length) })))),
        h("div", { class: "sg-pal-sec drag", text: "Drag onto the page" }),
        h("div", { class: "sg-pal-fields" }, ...Object.entries(FIELD).map(([t, F]) => palItem(t, F))),
        h("div", { class: "sg-pal-tip", text: armed ? `Tap the page to place a ${FIELD[armed].label.toLowerCase()} field` : "Drag a field onto a page, or tap it and then tap the page. Drag to move, use the corner to resize." }));
    }
    function palItem(t, F) {
      const b = h("button", { type: "button", class: "sg-pal-item" + (armed === t ? " armed" : ""), style: { "--sc": colorOf(active) } }, h("span", { class: "sg-pal-ic", text: F.icon }), h("span", { text: F.label }));
      b.addEventListener("pointerdown", e => startPalDrag(e, t, b));
      return b;
    }
    function startPalDrag(e, t, b) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch {}
      const sx = e.clientX, sy = e.clientY; let ghost = null;
      const move = ev => {
        if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) {
          const pw = v.pages[0]?.wrap.getBoundingClientRect().width || 600, F = FIELD[t];
          ghost = h("div", { class: "sg-ghost t-" + t, style: { "--sc": colorOf(active), width: F.w / 600 * pw + "px", height: F.h / 600 * pw + "px" } }, h("span", { text: F.icon + " " + F.label }));
          document.body.append(ghost);
        }
        if (ghost) { ghost.style.left = ev.clientX + "px"; ghost.style.top = ev.clientY + "px"; }
      };
      const up = ev => {
        b.removeEventListener("pointermove", move); b.removeEventListener("pointerup", up); b.removeEventListener("pointercancel", up);
        if (ghost) {
          ghost.remove();
          const pageEl = ev.type === "pointerup" && document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".sg-page");
          const p = pageEl && v.el.contains(pageEl) ? v.pages[+pageEl.dataset.page] : null;
          if (p) placeAt(p, t, ev.clientX, ev.clientY);
        } else if (ev.type === "pointerup") { armed = armed === t ? null : t; v.el.classList.toggle("armed", !!armed); drawPalette(); }
      };
      b.addEventListener("pointermove", move); b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up);
    }
    function placeAt(p, t, cx, cy) {
      if (!active) return UI.toast("Add a signer first");
      const r = p.wrap.getBoundingClientRect(), F = FIELD[t], w = F.w / 600, hh = F.h * p.w / (600 * p.h);
      const f = { id: fid(), signer: active, page: p.i, type: t, x: r4(clamp((cx - r.left) / r.width - w / 2, 0, 1 - w)), y: r4(clamp((cy - r.top) / r.height - hh / 2, 0, 1 - hh)), w: r4(w), h: r4(hh) };
      if (t === "text") f.label = "";
      d.fields.push(f); selected = f.id; armed = null; v.el.classList.remove("armed");
      paintPage(p); changed();
      setTimeout(() => p.layer.querySelector(`[data-fid="${f.id}"]`)?.focus({ preventScroll: true }));
    }
    const pageOf = f => v.pages[f.page];
    function remove(f) { d.fields = d.fields.filter(x => x.id !== f.id); if (selected === f.id) selected = null; const p = pageOf(f); p && paintPage(p); changed(); }
    function paintPage(p) { p.layer.replaceChildren(...d.fields.filter(f => f.page === p.i).map(f => editField(f, p))); }
    function editField(f, p) {
      const F = FIELD[f.type] || FIELD.text;
      const el = h("div", { class: "sg-f edit t-" + f.type + (selected === f.id ? " sel" : ""), style: pos(f, colorOf(f.signer)), tabindex: 0, dataset: { fid: f.id }, title: `${F.label} · ${nameOf(f.signer)}` },
        h("span", { class: "sg-f-lab" }, F.icon + " " + (f.type === "text" && f.label ? f.label : F.label)),
        h("span", { class: "sg-f-who", text: nameOf(f.signer).replace(/^Company · /, "") }),
        h("button", { type: "button", class: "sg-f-x", title: "Remove", text: "×", onpointerdown: e => e.stopPropagation(), onclick: e => { e.stopPropagation(); remove(f); } }),
        h("button", { type: "button", class: "sg-f-menu", title: "Options", text: "⋯", onpointerdown: e => e.stopPropagation(), onclick: e => { e.stopPropagation(); fieldMenu(e.currentTarget, f, p); } }),
        h("span", { class: "sg-f-rs", title: "Resize" }));
      el.addEventListener("pointerdown", e => startMove(e, f, p, el, e.target.classList.contains("sg-f-rs")));
      el.addEventListener("keydown", e => {
        if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(f); return; }
        const step = e.shiftKey ? .02 : .004, dx = { ArrowLeft: -step, ArrowRight: step }[e.key] || 0, dy = { ArrowUp: -step, ArrowDown: step }[e.key] || 0;
        if (dx || dy) { e.preventDefault(); f.x = r4(clamp(f.x + dx, 0, 1 - f.w)); f.y = r4(clamp(f.y + dy, 0, 1 - f.h)); Object.assign(el.style, { left: f.x * 100 + "%", top: f.y * 100 + "%" }); onChange(); }
      });
      return el;
    }
    function startMove(e, f, p, el, resize) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch {}
      if (selected !== f.id) { selected = f.id; v.el.querySelectorAll(".sg-f.sel").forEach(x => x.classList.remove("sel")); el.classList.add("sel"); }
      el.focus({ preventScroll: true });
      const r = p.wrap.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, o = { ...f };
      let moved = false;
      el.classList.add("moving");
      const move = ev => {
        const dx = (ev.clientX - sx) / r.width, dy = (ev.clientY - sy) / r.height;
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 2) return;
        moved = true;
        if (resize) { f.w = clamp(o.w + dx, .03, 1 - f.x); f.h = clamp(o.h + dy, .012, 1 - f.y); el.style.width = f.w * 100 + "%"; el.style.height = f.h * 100 + "%"; }
        else { f.x = clamp(o.x + dx, 0, 1 - f.w); f.y = clamp(o.y + dy, 0, 1 - f.h); el.style.left = f.x * 100 + "%"; el.style.top = f.y * 100 + "%"; }
      };
      const up = () => {
        el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
        el.classList.remove("moving");
        if (moved) { f.x = r4(f.x); f.y = r4(f.y); f.w = r4(f.w); f.h = r4(f.h); onChange(); }
      };
      el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    }
    function fieldMenu(anchor, f, p) {
      UI.menu(anchor, [
        { section: "Who fills it" },
        ...signers.map(s => ({ label: s.name + (s.key === f.signer ? "  ✓" : ""), onClick: () => { f.signer = s.key; paintPage(p); changed(); } })),
        { sep: true },
        f.type === "text" ? { label: "Hint for the signer…", icon: "text", onClick: async () => { const r = await Apps.form("Text field", [{ key: "label", label: "Hint shown to the signer", placeholder: "e.g. Job title" }], { label: f.label || "" }, { ok: "Save" }); if (r) { f.label = String(r.label || "").trim().slice(0, 60); paintPage(p); onChange(); } } } : null,
        { label: "Duplicate", icon: "copy", onClick: () => { const c = { ...f, id: fid(), x: r4(clamp(f.x + .02, 0, 1 - f.w)), y: r4(clamp(f.y + .02, 0, 1 - f.h)) }; d.fields.push(c); selected = c.id; paintPage(p); changed(); } },
        v.pages.length > 1 && (f.type === "initials" || f.type === "date") ? { label: "Copy to every page", icon: "copy", onClick: () => {
          v.pages.forEach(pp => { if (pp.i !== f.page && !d.fields.some(x => x.page === pp.i && x.signer === f.signer && x.type === f.type && Math.abs(x.y - f.y) < .01)) d.fields.push({ ...f, id: fid(), page: pp.i }); paintPage(pp); });
          changed(); UI.toast("Copied to every page");
        } } : null,
        { label: "Remove", icon: "trash", danger: true, onClick: () => remove(f) },
      ], { align: "end" });
    }
    const clearAll = async () => {
      const mine = d.fields.filter(f => f.signer === active);
      if (!mine.length) return UI.toast("No fields for " + nameOf(active));
      if (!(await UI.confirm(`Remove all ${mine.length} fields for ${nameOf(active)}?`, "Remove"))) return;
      d.fields = d.fields.filter(f => f.signer !== active); v.pages.forEach(paintPage); changed();
    };
    drawPalette();
    const el = h("div", { class: "sg-editor" }, palette,
      h("div", { class: "sg-ed-main" }, h("div", { class: "sg-ed-bar" }, info, h("div", { class: "grow" }), h("button", { class: "btn sg-clear", text: "Clear signer's fields", onclick: clearAll }), zoomBar(v)), v.el));
    const onKey = e => { if (e.key === "Escape" && armed) { armed = null; v.el.classList.remove("armed"); drawPalette(); } };
    document.addEventListener("keydown", onKey);
    return { el, destroy: () => { v.destroy(); document.removeEventListener("keydown", onKey); } };
  }

  /* ---------- signing ---------- */
  function signView(ctx, d0) {
    const { root } = ctx, id = d0.id, me = meKey();
    let d = d0, sigData = null, iniData = null, current = null, finishing = false;
    const ss = () => signersOf(d);
    const mineFields = () => (d.fields || []).filter(f => f.signer === me).sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
    const vals = {};
    mineFields().forEach(f => { if (f.type === "date") vals[f.id] = todayText(); });
    if (!(d.audit || []).some(a => a.by === me && a.action === "viewed")) audit(id, "viewed");
    // use the saved signature when there is one
    const saved = (Data.get("people", me) || {}).signature;
    let savedData = null, toldSaved = false;
    if (saved) waitFile(saved.id, 5000).then(f => { if (f?.data && !sigData) { sigData = savedData = f.data; } });

    const filled = f => f.type === "signature" ? !!(vals[f.id] && sigData) : f.type === "initials" ? !!(vals[f.id] && iniData) : !!String(vals[f.id] || "").trim();
    const prog = h("span", { class: "sg-prog-l" });
    const finishBtn = h("button", { class: "btn primary", text: "Finish signing", onclick: () => finish() });
    const nextBtn = h("button", { class: "btn sg-next", text: "Next field ↓", onclick: () => nextField() });
    const bnext = h("button", { class: "btn sg-next", text: "Next field", onclick: () => nextField() });
    const bfinish = h("button", { class: "btn primary", text: "Finish", onclick: () => finish() });
    const moreBtn = h("button", { class: "icon-btn", title: "More", html: UI.icon("dots"), onclick: () => UI.menu(moreBtn, [
      { label: "Document details", icon: "page", onClick: () => Apps.go("sign", "d:" + id) },
      { label: "Download original", icon: "download", onClick: () => downloadOriginal(d) },
      { sep: true },
      { label: "Decline to sign…", icon: "x", danger: true, onClick: decline },
    ], { align: "end" }) });
    function progress() {
      const ms = mineFields(), n = ms.filter(filled).length;
      prog.textContent = `${n} of ${ms.length} done`;
      const all = n === ms.length;
      [finishBtn, bfinish].forEach(b => b.classList.toggle("ready", all));
      [nextBtn, bnext].forEach(b => b.classList.toggle("hidden", all));
    }
    const sender = Data.person(d.by);
    const v = viewer(d.file, { cls: "sg-sign-scroll", onPage: p => paintPage(p), onReady: () => setTimeout(() => nextField(true), 300) });
    const stateBox = h("div");
    root.append(
      h("div", { class: "sg-signhead glass" },
        h("button", { class: "icon-btn", title: "Back", text: "←", onclick: () => Apps.go("sign") }),
        h("div", { class: "sg-sh-t" }, h("b", { text: d.title || "Untitled" }), h("small", { text: `From ${sender.name} · ${d.order === "sequence" ? "signing in sequence" : "any order"}` })),
        prog, nextBtn, finishBtn, moreBtn),
      stateBox,
      d.note ? note(h("span", null, h("b", { text: sender.name.split(" ")[0] + ": " }), d.note), "info") : null,
      h("div", { class: "sg-sign-tools" }, h("span", { class: "sg-muted", text: "Your fields are highlighted. Tap one to fill it in." }), h("div", { class: "grow" }), zoomBar(v)),
      v.el,
      h("div", { class: "sg-signbar glass" }, bnext, bfinish),
      security());
    progress();

    function paintPage(p) {
      const all = ss();
      p.layer.replaceChildren(...(d.fields || []).filter(f => f.page === p.i).map(f => f.signer === me ? myField(f) : staticField(f, d, all)));
    }
    const repaint = () => v.pages.forEach(paintPage);
    function myField(f) {
      const F = FIELD[f.type] || FIELD.text, ok = filled(f);
      const el = h("div", { class: "sg-f mine t-" + f.type + (ok ? " filled" : "") + (current === f.id ? " cur" : ""), style: pos(f, "var(--accent)"), dataset: { fid: f.id }, title: F.label },
        ok ? null : h("span", { class: "sg-arrow", text: F.ask }));
      if (f.type === "signature" || f.type === "initials") {
        el.append(ok ? h("img", { class: "sg-f-img", src: f.type === "initials" ? iniData : sigData, alt: "" }) : h("span", { class: "sg-f-lab", text: F.icon + " " + F.label }));
        el.setAttribute("role", "button"); el.tabIndex = 0;
        el.onclick = () => clickSig(f);
        el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); clickSig(f); } };
      } else if (f.type === "date") el.append(h("span", { class: "sg-f-val", text: vals[f.id] || "" }));
      else {
        const inp = h("input", { class: "sg-f-input", placeholder: f.label || "Type here", maxlength: 200 });
        inp.value = vals[f.id] || "";
        inp.oninput = () => { vals[f.id] = inp.value; const fl = filled(f); el.classList.toggle("filled", fl); el.querySelector(".sg-arrow")?.classList.toggle("gone", fl); progress(); };
        inp.onfocus = () => { current = f.id; };
        inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); nextField(); } };
        el.append(inp);
      }
      return el;
    }
    async function clickSig(f) {
      current = f.id;
      const ini = f.type === "initials", have = ini ? iniData : sigData;
      if (have && !vals[f.id]) {
        vals[f.id] = true; repaint(); progress(); flash(f);
        if (!ini && !toldSaved && saved && have === savedData) { toldSaved = true; UI.toast("Used your saved signature. Tap it again to change it."); }
        return;
      }
      const png = await signaturePad({ mode: f.type });
      if (!png) return;
      if (ini) iniData = png; else sigData = png;
      vals[f.id] = true; repaint(); progress(); flash(f);
    }
    const elOf = f => v.el.querySelector(`[data-fid="${f.id}"]`);
    function flash(f) { const el = elOf(f); if (el) { el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); } }
    function nextField(initial) {
      const ms = mineFields(); if (!ms.length) return;
      const todo = ms.filter(f => !filled(f));
      if (!todo.length) { if (!initial) { finishBtn.focus(); UI.toast("All set. Press Finish signing."); } return; }
      const ci = ms.findIndex(f => f.id === current);
      const nx = todo.find(f => ms.indexOf(f) > ci) || todo[0];
      current = nx.id;
      v.el.querySelectorAll(".sg-f.cur").forEach(x => x.classList.remove("cur"));
      const el = elOf(nx);
      if (!el) return;
      el.classList.add("cur"); v.scrollToEl(el); flash(nx);
      if (nx.type === "text") setTimeout(() => el.querySelector("input")?.focus({ preventScroll: true }), 350);
    }
    async function finish() {
      if (finishing) return;
      const ms = mineFields(), todo = ms.filter(f => !filled(f));
      if (todo.length) { UI.toast(`Fill in ${todo.length} more field${todo.length === 1 ? "" : "s"} first`); current = null; nextField(); return; }
      const fresh = Data.get(COL, id);
      if (!fresh || !myTurn(fresh)) return UI.toast("This document changed and can't be signed now");
      finishing = true;
      [finishBtn, bfinish].forEach(b => { b.disabled = true; b.textContent = "Signing…"; });
      try {
        const needSig = ms.some(f => f.type === "signature"), needIni = ms.some(f => f.type === "initials");
        const sigAtt = needSig && sigData ? (await Apps.attach([dataToFile(sigData, "signature.png", "image/png")]))[0] : null;
        const iniAtt = needIni && iniData ? (await Apps.attach([dataToFile(iniData, "initials.png", "image/png")]))[0] : null;
        if ((needSig && !sigAtt) || (needIni && !iniAtt)) throw new Error("Couldn't save your signature image");
        const values = {}; ms.forEach(f => { if (f.type === "date" || f.type === "text") values[f.id] = String(vals[f.id] || "").trim(); });
        const willComplete = signersOf(fresh).every(s => s.key === me || s.status === "signed");
        if (willComplete) finalizing.add(id);
        const t = now();
        await Data.arr(COL, id, "done", { key: me, signedAt: t, sig: sigAtt || null, ini: iniAtt || null, values });
        const cur = Data.get(COL, id);
        await touch(id, { signers: signersOf(cur).map(stripSigner), fields: (cur.fields || []).map(f => f.signer === me && f.id in values ? { ...f, value: values[f.id] } : f) });
        await audit(id, "signed");
        if (cur.by !== me) Data.notify(cur.by, `✍️ ${esc(Data.me().name)} signed “${esc(cur.title || "Untitled")}”`, link(id));
        if (willComplete) {
          [finishBtn, bfinish].forEach(b => { b.textContent = "Creating signed PDF…"; });
          await finalize(id);
          UI.toast("🎉 Signed! Everyone has signed, the signed PDF is ready.");
        } else {
          if (cur.order === "sequence") nextUp(Data.get(COL, id)).forEach(s => Data.notify(s.key, `✍️ ${esc(pname(cur.by))} asked you to sign “${esc(cur.title || "Untitled")}”`, link(id), cur.note || ""));
          UI.toast("✍️ Signed. Thank you!");
        }
        Apps.go("sign", "d:" + id);
      } catch (e) {
        console.warn(e); finishing = false;
        [finishBtn, bfinish].forEach((b, i) => { b.disabled = false; b.textContent = i ? "Finish" : "Finish signing"; });
        UI.toast("Couldn't finish: " + (e.message || e));
      }
    }
    async function decline() {
      const r = await Apps.form("Decline to sign", [{ key: "reason", label: "Why are you declining? The sender will see this.", type: "textarea", required: true, placeholder: "e.g. The start date is wrong" }], {}, { ok: "Decline" });
      if (!r) return;
      const cur = Data.get(COL, id); if (!cur || cur.status !== "sent") return;
      const reason = String(r.reason || "").trim().slice(0, 500);
      await touch(id, { status: "declined", declined: { by: me, reason, at: now() }, signers: signersOf(cur).map(s => stripSigner(s.key === me ? { ...s, status: "declined" } : s)) });
      await audit(id, "declined", reason);
      const msg = `⛔ ${esc(Data.me().name)} declined to sign “${esc(cur.title || "Untitled")}”`;
      new Set([cur.by, ...signersOf(cur).filter(s => s.status === "signed").map(s => s.key)]).forEach(k => Data.notify(k, msg, link(id), reason));
      UI.toast("You declined this document");
      Apps.go("sign", "d:" + id);
    }
    // the document may change while I'm here (cancelled, someone else declined)
    const off = Data.on(COL, () => {
      const x = Data.get(COL, id); if (!x || finishing) return;
      d = { ...x };
      if (!myTurn(x)) stateBox.replaceChildren(note(h("span", null, x.status === "cancelled" ? "🚫 The sender cancelled this document." : x.status === "declined" ? "⛔ This document was declined." : "This document can't be signed by you right now.", " ",
        h("button", { class: "btn", text: "View details", onclick: () => Apps.go("sign", "d:" + id) })), "warn"));
    });
    ctx.cleanups.push(off, () => v.destroy());
  }

  /* ---------- document page ---------- */
  function docView(ctx, id) {
    const { root } = ctx;
    let preview = null, previewKey = "", previewMode = null;
    const top = h("div"), grid = h("div", { class: "sg-docgrid" }), left = h("div", { class: "sg-doc-left" }), right = h("div", { class: "sg-doc-right" });
    grid.append(left, right);
    root.append(top, grid, security());
    function draw() {
      const d = Data.get(COL, id);
      if (!d) { root.replaceChildren(Apps.empty("🗑️", "This document was deleted.", h("button", { class: "btn", text: "Back to documents", onclick: () => Apps.go("sign") }))); return; }
      const me = meKey(), mine = d.by === me, ss = signersOf(d), [a, b] = progressOf(d), turn = myTurn(d);
      const allSigned = ss.length && ss.every(s => s.status === "signed");
      const dlBtn = h("button", { class: "btn", text: "⬇ Download ▾", onclick: () => UI.menu(dlBtn, [
        { label: "Original PDF", icon: "download", onClick: () => downloadOriginal(d) },
        d.status === "completed" ? { label: d.signed ? "Signed PDF" : "Signed PDF (built now)", icon: "download", onClick: () => downloadSigned(d, dlBtn) } : null,
      ], { align: "end" }) });
      const moreItems = [
        canEdit() ? { label: "Duplicate as new draft", icon: "copy", onClick: () => duplicate(d) } : null,
        mine && d.status === "sent" ? { label: "Cancel document", icon: "x", danger: true, onClick: () => cancelDoc(d) } : null,
        (mine || isAdmin()) && ["draft", "cancelled", "declined"].includes(d.status) ? { label: "Delete", icon: "trash", danger: true, onClick: () => deleteDoc(d) } : null,
      ].filter(Boolean);
      const moreBtn = moreItems.length ? h("button", { class: "icon-btn", title: "More", html: UI.icon("dots"), onclick: () => UI.menu(moreBtn, moreItems, { align: "end" }) }) : null;
      const current = d.status === "sent" ? nextUp(d) : [];
      top.replaceChildren(
        h("button", { class: "btn sg-back", text: "← Documents", onclick: () => Apps.go("sign") }),
        h("div", { class: "sg-dochead" },
          h("div", { class: "app-ic", text: d.kind === "hr" ? "🧑‍💼" : "📄" }),
          h("div", { class: "sg-dh-t" }, h("h1", { text: d.title || "Untitled" }),
            h("div", { class: "sg-dh-sub" }, chip(d.status), kindChip(d), h("span", { text: `${a}/${b} signed · from ${mine ? "you" : pname(d.by)} · ${fmtDay(d.at)}` }))),
          h("div", { class: "app-actions" },
            turn ? h("button", { class: "btn primary", text: "✍️ Review and sign", onclick: () => Apps.go("sign", "s:" + id) }) : null,
            d.status === "draft" && mine ? h("button", { class: "btn primary", text: "Continue editing", onclick: () => Apps.go("sign", "e:" + id) }) : null,
            mine && d.status === "sent" && current.some(s => s.key !== me) ? h("button", { class: "btn", text: "⏰ Remind", onclick: () => remind(d, current.map(s => s.key)) }) : null,
            d.status === "sent" && allSigned && (mine || ss.some(s => s.key === me)) ? h("button", { class: "btn primary", text: "Create signed PDF", onclick: async e => { e.currentTarget.disabled = true; e.currentTarget.textContent = "Creating…"; await finalize(id); } }) : null,
            dlBtn, moreBtn)),
        d.status === "declined" && d.declined ? note(h("span", null, h("b", { text: `⛔ ${pname(d.declined.by)} declined` }), d.declined.reason ? `: “${d.declined.reason}”` : ""), "warn") : null,
        d.status === "cancelled" ? note("🚫 This document was cancelled. Nobody can sign it any more.", "warn") : null,
        d.status === "completed" && !d.signed ? note("✅ Everyone signed. The stamped PDF is bigger than 700 KB, so Lumen keeps the signatures and builds the signed PDF when you download it.", "ok") : null,
        turn ? note("✍️ It's your turn to sign this document.", "info") : null);

      // preview: rebuilt only when what it shows changes
      const hasSigned = d.status === "completed" && d.signed;
      const mode = previewMode || (hasSigned ? "signed" : "original");
      const key = [mode, d.status, d.signed?.id || "", ss.map(s => s.status).join(","), (d.fields || []).length].join("|");
      if (key !== previewKey || !preview) {
        preview && preview.destroy();
        previewKey = key;
        const att = mode === "signed" && hasSigned ? d.signed : d.file;
        const allNow = ss;
        preview = d.file ? viewer(att, { cls: "sg-prev-scroll", onPage: p => { if (att === d.file) p.layer.replaceChildren(...(d.fields || []).filter(f => f.page === p.i).map(f => staticField(f, d, allNow))); } }) : null;
        left.replaceChildren(h("div", { class: "sg-card glass sg-prev" },
          h("div", { class: "sg-prev-bar" },
            hasSigned ? seg([["signed", "Signed PDF"], ["original", "Original"]], mode, k => { previewMode = k; previewKey = ""; draw(); }) : h("b", { text: d.status === "completed" ? "Signed preview" : "Preview" }),
            h("div", { class: "grow" }), preview ? zoomBar(preview) : null),
          preview ? preview.el : Apps.empty("📄", "No file yet")));
      }

      // signers
      const seq = d.order === "sequence", rem = d.reminded || {};
      const signersCard = h("div", { class: "sg-card glass" },
        h("div", { class: "sg-card-h" }, h("b", { text: "Signers" }), h("small", { text: seq ? "In sequence" : "Any order" })),
        ...(d.status === "draft" && d.kind === "hr" ? (d.employees || []).map(k => h("div", { class: "sg-sg" }, Apps.avatar(Data.person(k), 30), h("div", { class: "sg-signer-t" }, h("b", { text: pname(k) }), h("small", { text: "Employee · gets a personal copy" }))))
          : ss.map((s, i) => {
            const p = Data.person(s.key), isCur = current.some(c => c.key === s.key), last = rem[s.key] || 0, wait = last > now() - HOUR;
            return h("div", { class: "sg-sg s-" + s.status + (isCur ? " cur" : ""), style: { "--sc": colorFor(d, s.key) } },
              h("span", { class: "sg-signer-n", text: seq ? String(i + 1) : "" }),
              h("span", { class: "sg-av s-" + s.status }, Apps.avatar(p, 30)),
              h("div", { class: "sg-signer-t" }, h("b", { text: p.name + (s.key === me ? " (you)" : "") + (d.company && s.key === d.company && d.kind === "hr" ? " · company" : "") }),
                h("small", { text: s.status === "signed" ? "Signed " + fmtTs(s.signedAt) : s.status === "declined" ? "Declined" : d.status === "sent" ? (isCur ? "Waiting to sign" : "Waits for earlier signers") : "Didn't sign" })),
              s.status === "signed" && s.sig ? attImg(s.sig, "sg-sg-sig") : null,
              mine && d.status === "sent" && isCur && s.key !== me ? h("button", { class: "btn sg-rem", text: wait ? "Reminded" : "Remind", disabled: wait, title: wait ? `Reminded ${UI.timeAgo(last)}. You can remind again in an hour.` : "Send a reminder", onclick: () => remind(d, [s.key]) }) : null);
          })));
      // details
      const f = Data.get("files", d.file?.id);
      const details = h("div", { class: "sg-card glass" },
        h("div", { class: "sg-card-h" }, h("b", { text: "Details" })),
        h("div", { class: "sg-kv" },
          h("span", { text: "Sender" }), h("span", { class: "who" }, Apps.avatar(Data.person(d.by), 20), pname(d.by)),
          h("span", { text: "Created" }), h("span", { text: fmtTs(d.at) }),
          d.sentAt ? h("span", { text: "Sent" }) : null, d.sentAt ? h("span", { text: fmtTs(d.sentAt) }) : null,
          d.completedAt ? h("span", { text: "Completed" }) : null, d.completedAt ? h("span", { text: fmtTs(d.completedAt) }) : null,
          h("span", { text: "File" }), h("span", null, d.file ? Apps.fileChip(d.file) : "—"),
          d.signed ? h("span", { text: "Signed PDF" }) : null, d.signed ? h("span", null, Apps.fileChip(d.signed)) : null,
          h("span", { text: "Pages" }), h("span", { text: String(d.pages || "—") }),
          d.hash ? h("span", { text: "SHA-256" }) : null, d.hash ? h("code", { class: "sg-hash", text: d.hash, title: "Fingerprint of the original file" }) : null,
          h("span", { text: "Document ID" }), h("code", { class: "sg-hash", text: id })),
        d.note ? h("div", { class: "sg-rv-note", text: "“" + d.note + "”" }) : null);
      if (!f && d.file) waitFile(d.file.id, 3000);
      // timeline
      const trail = [...(d.audit || [])].sort((x, y) => (x.at || 0) - (y.at || 0));
      const ic = { created: "📝", sent: "📨", viewed: "👀", signed: "✍️", declined: "⛔", reminded: "⏰", cancelled: "🚫", completed: "✅" };
      const timeline = h("div", { class: "sg-card glass" },
        h("div", { class: "sg-card-h" }, h("b", { text: "Timeline" }), h("small", { text: `${trail.length} event${trail.length === 1 ? "" : "s"}` })),
        h("div", { class: "sg-tl" }, ...trail.map((x, i) => h("div", { class: "sg-tl-i", style: { animationDelay: Math.min(i, 10) * 40 + "ms" } },
          h("span", { class: "sg-tl-ic", text: ic[x.action] || "•" }),
          h("div", null, h("div", null, h("b", { text: pname(x.by) }), " ", (ACTIONS[x.action] || x.action).replace(/^./, c => c.toLowerCase())), x.info ? h("div", { class: "sg-tl-info", text: x.info }) : null,
            h("small", { text: fmtTs(x.at) }))))));
      right.replaceChildren(signersCard, details, timeline);
    }
    const redraw = UI.liveDraw(root, draw);
    draw();
    const off = Data.on(COL, redraw);
    ctx.cleanups.push(off, () => preview && preview.destroy());
  }

  Apps.register("sign", { title: "e-Signature", icon: "✍️", render });
  Apps.onWorkspace.add(startBg);
  setTimeout(startBg, 0);
})();
