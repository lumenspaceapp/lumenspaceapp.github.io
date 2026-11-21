/* Board drag & drop with real motion (mouse / pen). Kanban cards ([draggable] inside .b-cards: Tasks, CRM, Workgroups,
   databases…) are dragged by a floating copy that lifts, tilts with the movement and follows the pointer; a slot opens
   where the card will land and the other cards slide out of the way; on release the copy glides into its new place.
   The boards' own handlers stay as they are: this fires the same dragstart / dragenter / dragover / dragleave / drop /
   dragend events (with a small dataTransfer stand-in) that the browser would. Touch keeps using js/touch-dnd.js. */
(function () {
  const SLOP = 5, EDGE = 64, EASE = "cubic-bezier(.2,.8,.2,1)";
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  let st = null, raf = 0, blockClickUntil = 0, settleTimer = 0;

  const shim = () => {
    const data = {};
    return { types: [], effectAllowed: "move", dropEffect: "move", files: [], items: [], setDragImage() {},
      setData(t, v) { data[t] = String(v); if (!this.types.includes(t)) this.types.push(t); }, getData: t => data[t] || "", clearData() {} };
  };
  function fire(el, type, related) {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(ev, { dataTransfer: { value: st.dt }, clientX: { value: st.x }, clientY: { value: st.y }, pageX: { value: st.x + scrollX }, pageY: { value: st.y + scrollY }, relatedTarget: { value: related || null } });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  }
  const isCard = el => el && el.nodeType === 1 && el.parentElement?.classList.contains("b-cards") && !el.classList.contains("kd-ph");
  const cardsOf = box => box ? [...box.children].filter(c => isCard(c) && !c.classList.contains("kd-hidden")) : [];
  const keyOf = el => (el.textContent || "").replace(/\s+/g, " ").trim();
  const scrollable = (el, axis) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (axis === "y" && /(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 2) return n;
      if (axis === "x" && /(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 2) return n;
    }
    return null;
  };

  // slide every card in these lists from where it was to where it is now (FLIP)
  function flip(boxes, mutate) {
    const els = [...new Set(boxes.filter(Boolean).flatMap(b => [...b.children]))];
    const before = new Map(els.map(e => [e, e.getBoundingClientRect()]));
    mutate();
    if (reduce()) return;
    for (const [e, a] of before) {
      if (!e.isConnected || e.classList.contains("kd-hidden")) continue;
      const b = e.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 260, easing: EASE });
    }
  }

  document.addEventListener("pointerdown", e => {
    if (st || e.button !== 0 || e.pointerType === "touch" || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const src = e.target.closest?.('[draggable="true"]');
    if (!isCard(src) || e.target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
    src.draggable = false; // no native drag: we draw our own
    st = { src, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false, t0: Date.now() };
    addEventListener("pointermove", onMove, true);
    addEventListener("pointerup", onUp, true);
    addEventListener("pointercancel", onCancel, true);
    addEventListener("keydown", onKey, true);
  }, true);
  // backup: if the browser still starts a native drag for a card we're handling, stop it
  document.addEventListener("dragstart", e => { if (st && e.isTrusted) e.preventDefault(); }, true);
  document.addEventListener("click", e => { if (Date.now() < blockClickUntil) { e.preventDefault(); e.stopPropagation(); } }, true);

  function onMove(e) {
    if (!st) return;
    st.x = e.clientX; st.y = e.clientY;
    if (!st.active) { if (Math.hypot(st.x - st.x0, st.y - st.y0) < SLOP) return; start(); }
    e.preventDefault();
    track();
  }
  const onUp = () => finish(false), onCancel = () => finish(true);
  const onKey = e => { if (e.key === "Escape" && st) { e.preventDefault(); e.stopPropagation(); finish(true); } };

  function start() {
    const { src } = st;
    const r = src.getBoundingClientRect();
    st.active = true; st.dt = shim();
    st.offX = st.x0 - r.left; st.offY = st.y0 - r.top; st.w = r.width; st.h = r.height;
    st.home = { box: src.parentElement, next: src.nextSibling, rect: r };
    st.tilt = 0; st.px = st.x; st.lift = 0;
    getSelection()?.removeAllRanges();
    fire(src, "dragstart");
    // the floating copy
    const g = src.cloneNode(true);
    g.classList.remove("dragging"); g.classList.add("kd-ghost"); g.removeAttribute("draggable");
    Object.assign(g.style, { width: r.width + "px", height: r.height + "px" });
    document.body.append(g); st.ghost = g;
    // the slot it leaves behind (same size, so nothing jumps)
    const ph = document.createElement("div");
    ph.className = "kd-ph"; ph.style.height = r.height + "px";
    src.before(ph); src.classList.add("kd-hidden"); st.ph = ph;
    document.body.classList.add("kd-dragging");
    paint();
    const loop = () => { if (!st?.active) return; step(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
  }

  // per frame: ease the lift in, tilt with the horizontal speed, scroll near the edges
  function step() {
    st.lift += (1 - st.lift) * 0.25;
    const vx = st.x - st.px; st.px = st.x;
    st.tilt += (Math.max(-9, Math.min(9, vx * 0.7)) - st.tilt) * 0.18;
    paint();
    autoscroll();
  }
  function paint() {
    const s = 1 + 0.045 * st.lift, rot = (reduce() ? 0 : st.tilt) + 1.5 * st.lift;
    st.ghost.style.transform = `translate3d(${st.x - st.offX}px, ${st.y - st.offY}px, 0) rotate(${rot.toFixed(2)}deg) scale(${s.toFixed(3)})`;
  }

  function track() {
    const el = document.elementFromPoint(st.x, st.y);
    if (el !== st.over) { if (st.over) fire(st.over, "dragleave", el); if (el) fire(el, "dragenter", st.over); st.over = el; }
    st.accepted = el ? fire(el, "dragover") : false;
    st.ghost.classList.toggle("kd-no", !st.accepted);
    placeSlot(el);
  }

  // move the slot to where the card would land: the column under the pointer (if it takes the card), between the cards
  function placeSlot(el) {
    const col = st.accepted && el ? el.closest(".b-col") : null;
    const box = col ? col.querySelector(".b-cards") : null;
    if (!box) return; // pointer outside any column (or one that won't take it): keep the slot where it was
    const cards = cardsOf(box);
    const before = cards.find(c => { const r = c.getBoundingClientRect(); return st.y < r.top + r.height / 2; }) || null;
    const ph = st.ph;
    if (ph.parentElement === box && (before ? ph.nextElementSibling === before : cards.every(c => c.compareDocumentPosition(ph) & Node.DOCUMENT_POSITION_FOLLOWING))) return;
    const from = ph.parentElement;
    flip([from, box], () => { if (before) box.insertBefore(ph, before); else { const last = cards[cards.length - 1]; last ? last.after(ph) : box.prepend(ph); } });
    if (from !== box && !reduce()) ph.animate([{ opacity: 0, transform: "scaleY(.5)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: EASE });
  }

  function autoscroll() {
    const el = st.over || document.elementFromPoint(st.x, st.y); if (!el) return;
    let moved = false;
    const y = scrollable(el, "y") || document.getElementById("scroller");
    if (y) { const r = y.getBoundingClientRect(); const d = st.y < r.top + EDGE ? -(r.top + EDGE - st.y) : st.y > r.bottom - EDGE ? st.y - (r.bottom - EDGE) : 0; if (d) { y.scrollTop += d / 5; moved = true; } }
    const x = el.closest(".board") || scrollable(el, "x");
    if (x && x.scrollWidth > x.clientWidth + 2) { const r = x.getBoundingClientRect(); const d = st.x < r.left + EDGE ? -(r.left + EDGE - st.x) : st.x > r.right - EDGE ? st.x - (r.right - EDGE) : 0; if (d) { x.scrollLeft += d / 4; moved = true; } }
    if (moved) track();
  }

  // glide the floating copy onto a rectangle, then run done()
  function land(rect, done) {
    const g = st.ghost, from = g.style.transform;
    const to = `translate3d(${rect.left}px, ${rect.top}px, 0) rotate(0deg) scale(1)`;
    g.classList.add("kd-landing");
    if (reduce()) { done(); return; }
    const a = g.animate([{ transform: from, width: g.style.width, height: g.style.height }, { transform: to, width: rect.width + "px", height: rect.height + "px" }],
      { duration: 280, easing: "cubic-bezier(.25,1.1,.4,1)", fill: "forwards" });
    let ran = false; const once = () => { if (!ran) { ran = true; done(); } };
    a.onfinish = once; setTimeout(once, 450);
  }

  function finish(cancelled) {
    if (!st) return;
    const s = st;
    removeEventListener("pointermove", onMove, true); removeEventListener("pointerup", onUp, true);
    removeEventListener("pointercancel", onCancel, true); removeEventListener("keydown", onKey, true);
    cancelAnimationFrame(raf);
    s.src.draggable = true;
    if (!s.active) { st = null; return; }
    blockClickUntil = Date.now() + 350;
    s.active = false; // stop the frame loop, keep the copy on screen
    const dropped = !cancelled && s.over && s.accepted;
    const key = keyOf(s.src), toCol = dropped ? s.over.closest(".b-col") : null;
    const slot = s.ph.isConnected ? s.ph.getBoundingClientRect() : s.home.rect;
    const cleanup = () => {
      s.ghost.remove(); document.body.classList.remove("kd-dragging");
      if (s.ph.isConnected) flip([s.ph.parentElement, s.src.parentElement], () => { s.ph.remove(); s.src.classList.remove("kd-hidden"); });
      else s.src.classList.remove("kd-hidden");
      st = null;
    };

    if (!dropped) {
      // back to where it came from
      flip([s.ph.parentElement, s.home.box], () => { s.ph.remove(); s.src.classList.remove("kd-hidden"); });
      if (s.over) fire(s.over, "dragleave", null);
      const home = s.src.isConnected ? s.src.getBoundingClientRect() : s.home.rect;
      s.src.style.opacity = "0";
      land(home, () => { s.src.style.opacity = ""; try { fire(s.src, "dragend"); } finally { s.ghost.remove(); document.body.classList.remove("kd-dragging"); st = null; } });
      return;
    }

    // dropped: the boards re-draw from the saved data, so keep that redraw calm (no pop-in) and find the card again
    document.body.classList.add("kd-settle"); clearTimeout(settleTimer);
    settleTimer = setTimeout(() => document.body.classList.remove("kd-settle"), 900);
    try { fire(s.over, "drop"); fire(s.src, "dragend"); } catch (err) { console.error(err); }
    land(slot, () => {
      // after a redraw the original card is gone: find its new copy and slide it from where the copy landed
      const fresh = !s.src.isConnected && [...document.querySelectorAll(".b-cards > *")].find(c => isCard(c) && keyOf(c) === key && (!toCol || !toCol.isConnected || c.closest(".b-col")));
      if (fresh) {
        const r = fresh.getBoundingClientRect(), dx = slot.left - r.left, dy = slot.top - r.top;
        s.ghost.remove(); document.body.classList.remove("kd-dragging"); st = null;
        if (!reduce() && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) fresh.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 260, easing: EASE });
        fresh.classList.add("kd-dropped"); setTimeout(() => fresh.classList.remove("kd-dropped"), 800);
        return;
      }
      cleanup();
    });
  }
})();
