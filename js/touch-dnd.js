/* Touch drag & drop: phones don't fire HTML5 drag events, so this turns a long-press (or a drag on a
   block's ⋮⋮ handle) into dragstart / dragover / drop / dragend, with a floating copy that follows the finger.
   Existing desktop drag handlers (boards, blocks, sidebar pages) work unchanged. */
(function () {
  if (!("ontouchstart" in window)) return;
  const LONG_PRESS = 320, SLOP = 8, EDGE = 56;
  let st = null, raf = 0, blockClickUntil = 0;

  const shim = () => {
    const data = {};
    return { types: [], effectAllowed: "move", dropEffect: "move", setDragImage() {},
      setData(t, v) { data[t] = String(v); if (!this.types.includes(t)) this.types.push(t); }, getData: t => data[t] || "", clearData() {} };
  };
  function fire(el, type, related) {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(ev, { dataTransfer: { value: st.dt }, clientX: { value: st.x }, clientY: { value: st.y }, relatedTarget: { value: related || null } });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  }
  const scrollable = (el, axis) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (axis === "y" && /(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 2) return n;
      if (axis === "x" && /(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 2) return n;
    }
    return null;
  };

  // touchmove/touchend always go to the element the finger first touched, even if it was removed from the page
  // mid-drag (e.g. a live update re-rendered the board), so listen there rather than on the document.
  document.addEventListener("touchstart", e => {
    if (st && Date.now() - st.t0 > 15000) finish(true); // never let a lost drag block new ones
    if (e.touches.length !== 1 || st) return;
    const t = e.target, handle = t.closest?.(".gutter .drag");
    const src = handle ? handle.closest(".block") : t.closest?.('[draggable="true"]');
    if (!src) return;
    if (!handle && t.closest('input, textarea, select, [contenteditable="true"], button, a')) return;
    const p = e.touches[0];
    st = { src, target: t, t0: Date.now(), handle: !!handle, x0: p.clientX, y0: p.clientY, x: p.clientX, y: p.clientY, active: false };
    t.addEventListener("touchmove", onMove, { passive: false });
    t.addEventListener("touchend", onEnd); t.addEventListener("touchcancel", onCancel);
    if (!handle) st.timer = setTimeout(start, LONG_PRESS);
  }, { passive: true });

  const onEnd = () => finish(false), onCancel = () => finish(true);
  function onMove(e) {
    if (!st) return;
    const p = e.touches[0]; st.x = p.clientX; st.y = p.clientY;
    if (!st.active) {
      const moved = Math.hypot(st.x - st.x0, st.y - st.y0) > SLOP;
      if (!moved) return;
      if (st.handle) start(); else return finish(true); // a swipe before the long-press → normal scrolling
    }
    e.preventDefault();
    track();
  }
  // the long-press shouldn't open the browser's context menu / callout, and the drop shouldn't count as a tap
  document.addEventListener("contextmenu", e => { if (st) e.preventDefault(); }, true);
  document.addEventListener("click", e => { if (Date.now() < blockClickUntil) { e.preventDefault(); e.stopPropagation(); } }, true);

  function start() {
    if (!st || st.active) return;
    st.active = true; st.dt = shim();
    navigator.vibrate?.(12);
    if (st.handle) st.src.draggable = true;
    const r = st.src.getBoundingClientRect();
    st.offX = st.x0 - r.left; st.offY = st.y0 - r.top;
    getSelection()?.removeAllRanges();
    fire(st.src, "dragstart");
    const g = st.src.cloneNode(true);
    g.classList.add("touch-ghost"); g.classList.remove("dragging");
    Object.assign(g.style, { width: r.width + "px", height: Math.min(r.height, 220) + "px", left: "0px", top: "0px" });
    document.body.append(g); st.ghost = g;
    document.body.classList.add("touch-dragging");
    track();
    const loop = () => { if (!st?.active) return; autoscroll(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
  }
  function track() {
    st.ghost.style.transform = `translate(${st.x - st.offX}px, ${st.y - st.offY}px) rotate(1.5deg) scale(1.03)`;
    const el = document.elementFromPoint(st.x, st.y);
    if (el !== st.over) { if (st.over) fire(st.over, "dragleave", el); if (el) fire(el, "dragenter", st.over); st.over = el; }
    st.accepted = el ? fire(el, "dragover") : false;
  }
  function autoscroll() {
    const el = st.over || document.elementFromPoint(st.x, st.y); if (!el) return;
    let moved = false;
    const y = scrollable(el, "y") || document.getElementById("scroller");
    if (y) { const r = y.getBoundingClientRect(); const d = st.y < r.top + EDGE ? -(r.top + EDGE - st.y) : st.y > r.bottom - EDGE ? st.y - (r.bottom - EDGE) : 0; if (d) { y.scrollTop += d / 4; moved = true; } }
    const x = scrollable(el, "x");
    if (x) { const r = x.getBoundingClientRect(); const d = st.x < r.left + EDGE ? -(r.left + EDGE - st.x) : st.x > r.right - EDGE ? st.x - (r.right - EDGE) : 0; if (d) { x.scrollLeft += d / 3; moved = true; } }
    if (moved) track();
  }
  function finish(cancelled) {
    if (!st) return;
    clearTimeout(st.timer); cancelAnimationFrame(raf);
    st.target.removeEventListener("touchmove", onMove); st.target.removeEventListener("touchend", onEnd); st.target.removeEventListener("touchcancel", onCancel);
    try {
      if (st.active) {
        if (!cancelled && st.over && st.accepted) fire(st.over, "drop");
        fire(st.src, "dragend");
      }
    } finally {
      if (st.active) { st.ghost?.remove(); document.body.classList.remove("touch-dragging"); blockClickUntil = Date.now() + 450; }
      st = null;
    }
  }
})();
