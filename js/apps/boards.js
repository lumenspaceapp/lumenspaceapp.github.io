/* Boards: collaborative whiteboards in the style of Bitrix24 "Boards".
   boards   { name, icon, members: [keys] (empty/missing = everyone), bg: "dots"|"grid"|"plain", edited, editedBy, viewers: { key: ts }, deleted, deletedAt }
   boardels { board, type: sticky|text|shape|line|arrow|pen|image|frame, x, y, w, h, rot, z, color, text, shape, stroke, sw, fs, tc, bold,
              points (flat [x0,y0,x1,y1…]: Firestore can't store nested arrays), vw/vh (pen: natural size), from/to (connectors), dash, curve,
              file (att), locked, lockedBy, lockedAt, comments: [{by,text,at}], votes: [keys] }  — one doc per element */
(function () {
  const { h, esc, icon } = UI;
  const BC = "boards", EC = "boardels";
  const myKey = () => Data.me().key;
  const canEdit = () => Apps.can?.("boards", "edit") ?? true;
  const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

  /* ---------- colors (resolved through CSS variables so light and dark themes both look right) ---------- */
  const PASTEL = ["yellow", "orange", "pink", "purple", "blue", "teal", "green", "gray", "white", "none"];
  const INKS = ["ink", "gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "white", "none"];
  const NAMES = new Set([...PASTEL, ...INKS]);
  const okC = (c, d) => (typeof c === "string" && (NAMES.has(c) || /^#[0-9a-f]{3,8}$/i.test(c))) ? c : d;
  const fillCss = c => { c = okC(c, "yellow"); return c === "none" ? "transparent" : c[0] === "#" ? c : `var(--bd-p-${c})`; };
  const inkCss = c => { c = okC(c, "ink"); return c === "none" ? "transparent" : c[0] === "#" ? c : `var(--bd-${c})`; };
  const cssR = (c, kind) => kind === "p" ? fillCss(c) : kind === "i" ? inkCss(c) : kind === "paper" ? "var(--bd-paper)" : kind === "fline" ? "var(--bd-fline)" : "var(--bd-muted)";

  const DEF = {
    sticky: { w: 200, h: 200, color: "yellow", fs: 20 },
    text: { w: 260, h: 32, color: "ink", fs: 22 },
    shape: { w: 200, h: 120, color: "blue", stroke: "blue", sw: 2, fs: 18, tc: "ink" },
    frame: { w: 720, h: 460, color: "none", text: "Frame" },
    line: { color: "ink", sw: 2 }, arrow: { color: "ink", sw: 2 }, pen: { color: "ink", sw: 3 }, image: {},
  };

  /* ---------- small helpers ---------- */
  const f1 = n => Math.round((+n || 0) * 10) / 10;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rad = d => (+d || 0) * Math.PI / 180;
  const rotP = (x, y, a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };
  // text inside a filled shape stays dark (pastel fills are light in both themes); on no fill it follows the theme
  const shapeTc = (e, R) => (!e.tc || e.tc === "ink") && (e.color ?? "blue") !== "none" ? "#1d2130" : R(e.tc || "ink", "i");
  const isLine = e => !!e && (e.type === "line" || e.type === "arrow");
  const textual = e => !!e && ["sticky", "text", "shape", "frame"].includes(e.type);
  const lockedByOther = e => !!e && !!e.lockedBy && e.lockedBy !== myKey() && Date.now() - (e.lockedAt || 0) < 30000;
  const IC = {
    select: "M5 3l13 7.5-5.8 1.6L9.5 18z", hand: "M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.8-2.4L3.6 14.2a1.5 1.5 0 0 1 2.4-1.8L8 15",
    sticky: "M4 4h16v10l-6 6H4zM14 20v-6h6", text: "M5 7V5h14v2M12 5v14M9 19h6", rect: "M4 6h16v12H4z",
    ellipse: "M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z", diamond: "M12 3l9 9-9 9-9-9z", line: "M5 19L19 5", arrow: "M5 19L19 5M10 5h9v9",
    pen: "M4 20l4-1L19 8a2.1 2.1 0 0 0-3-3L5 16zM14 7l3 3", eraser: "M8 20h12M5.5 14.5l8.6-8.6a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 18H9zM9 11l5 5",
    image: "M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M15 9h.01", frame: "M7 3v18M17 3v18M3 7h18M3 17h18",
    undo: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3", redo: "M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3", fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
    minus: "M5 12h14", plus: "M12 5v14M5 12h14", comment: "M4 5h16v11H9l-5 4z", lock: "M6 11h12v9H6zM8 11V7a4 4 0 0 1 8 0v4", unlock: "M6 11h12v9H6zM8 11V7a4 4 0 0 1 7.5-2",
    front: "M12 19V6M6 11l6-6 6 6M5 21h14", back2: "M12 5v13M6 13l6 6 6-6M5 3h14", play: "M7 4l13 8-13 8z", search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
    back: "M15 6l-6 6 6 6", users: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.9M15.5 3.1a3.5 3.5 0 0 1 0 6.8",
    map: "M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15", vote: "M7 11v9H4v-9zM7 11l4-8a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7",
    next: "M9 6l6 6-6 6", prev: "M15 6l-6 6 6 6", x: "M6 6l12 12M18 6L6 18", up: "M6 15l6-6 6 6", down: "M6 9l6 6 6-6",
  };
  const ico = d => `<svg class="ico" viewBox="0 0 24 24"><path d="${d}"/></svg>`;

  /* ---------- geometry ---------- */
  function pts(e) {
    const p = (e && e.points) || [];
    if (Array.isArray(p[0])) return p.map(a => [+a[0] || 0, +a[1] || 0]);
    const out = []; for (let i = 0; i + 1 < p.length; i += 2) out.push([+p[i] || 0, +p[i + 1] || 0]);
    return out;
  }
  const flat = a => a.flatMap(p => [f1(p[0]), f1(p[1])]);
  const center = e => [e.x + e.w / 2, e.y + e.h / 2];
  // where a connector meets the outline of an element, heading toward a point
  function edgePt(e, to) {
    const c = center(e); let dx = to[0] - c[0], dy = to[1] - c[1];
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return c;
    [dx, dy] = rotP(dx, dy, -rad(e.rot));
    const hw = e.w / 2 + 5, hh = e.h / 2 + 5; let t;
    if (e.type === "shape" && e.shape === "ellipse") t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
    else if (e.type === "shape" && e.shape === "diamond") t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    else t = Math.min(hw / Math.max(Math.abs(dx), 1e-6), hh / Math.max(Math.abs(dy), 1e-6));
    const [rx, ry] = rotP(dx * t, dy * t, rad(e.rot));
    return [c[0] + rx, c[1] + ry];
  }
  function ends(l, get) {
    const p = pts(l); let a = p[0] || [0, 0], b = p[p.length - 1] || a;
    const A = l.from ? get(l.from) : null, B = l.to ? get(l.to) : null;
    const okA = A && !isLine(A), okB = B && !isLine(B);
    const ca = okA ? center(A) : a, cb = okB ? center(B) : b;
    if (okA) a = edgePt(A, cb);
    if (okB) b = edgePt(B, ca);
    return [a, b];
  }
  function bbox(e, get) {
    if (isLine(e)) { const [a, b] = ends(e, get); return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) }; }
    const w = +e.w || 0, hh = +e.h || 0;
    if (!e.rot) return { x: e.x, y: e.y, w, h: hh };
    const cx = e.x + w / 2, cy = e.y + hh / 2, a = rad(e.rot);
    const cs = [[-w / 2, -hh / 2], [w / 2, -hh / 2], [w / 2, hh / 2], [-w / 2, hh / 2]].map(([x, y]) => rotP(x, y, a));
    const xs = cs.map(c => c[0] + cx), ys = cs.map(c => c[1] + cy);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  function union(bs) {
    bs = bs.filter(Boolean); if (!bs.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    bs.forEach(b => { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  const P2 = p => f1(p[0]) + " " + f1(p[1]);
  function linePath(l, a, b) {
    if (l.curve) {
      const dx = (b[0] - a[0]) / 2, dy = (b[1] - a[1]) / 2, horiz = Math.abs(dx) >= Math.abs(dy);
      const c1 = horiz ? [a[0] + dx, a[1]] : [a[0], a[1] + dy], c2 = horiz ? [b[0] - dx, b[1]] : [b[0], b[1] - dy];
      return { d: `M${P2(a)}C${P2(c1)} ${P2(c2)} ${P2(b)}`, tail: c2 };
    }
    return { d: `M${P2(a)}L${P2(b)}`, tail: a };
  }
  function headPath(tip, from, s) {
    const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
    const p1 = [tip[0] - s * Math.cos(ang - .45), tip[1] - s * Math.sin(ang - .45)], p2 = [tip[0] - s * Math.cos(ang + .45), tip[1] - s * Math.sin(ang + .45)];
    return `M${P2(p1)}L${P2(tip)}L${P2(p2)}`;
  }
  // smooth freehand path through points (quadratic curves via midpoints)
  function smoothD(q) {
    if (!q.length) return "";
    if (q.length < 3) { const b = q[1] || q[0]; return `M${P2(q[0])}L${f1(b[0] + .01)} ${f1(b[1])}`; }
    let d = `M${P2(q[0])}`;
    for (let i = 1; i < q.length - 1; i++) d += `Q${P2(q[i])} ${P2([(q[i][0] + q[i + 1][0]) / 2, (q[i][1] + q[i + 1][1]) / 2])}`;
    return d + `L${P2(q[q.length - 1])}`;
  }
  const penD = e => { const sx = e.w / (e.vw || e.w || 1), sy = e.h / (e.vh || e.h || 1); return smoothD(pts(e).map(([x, y]) => [x * sx, y * sy])); };
  function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = clamp(t, 0, 1);
    return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
  }
  function simplify(p, eps) {
    if (p.length < 3) return p;
    const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
    const st = [[0, p.length - 1]];
    while (st.length) {
      const [s, e] = st.pop(); let md = 0, mi = -1;
      for (let i = s + 1; i < e; i++) { const d = segDist(p[i], p[s], p[e]); if (d > md) { md = d; mi = i; } }
      if (md > eps && mi > 0) { keep[mi] = 1; st.push([s, mi], [mi, e]); }
    }
    return p.filter((_, i) => keep[i]);
  }

  /* ---------- SVG of a scene (list previews, SVG export, PNG export) ---------- */
  const mctx = document.createElement("canvas").getContext("2d");
  function wrapLines(text, fs, bold, maxW) {
    mctx.font = `${bold ? 700 : 400} ${fs}px ${FONT}`;
    const out = [];
    for (const par of String(text || "").split("\n")) {
      let line = "";
      for (const tk of par.split(/(\s+)/)) {
        if (!tk) continue;
        const t = line + tk;
        if (line.trim() && mctx.measureText(t.trimEnd()).width > maxW) { out.push(line.trimEnd()); line = tk.trimStart(); }
        else line = t;
      }
      out.push(line.trimEnd());
    }
    return out;
  }
  function fitText(e) {
    const pad = e.type === "sticky" ? 16 : e.type === "shape" ? 12 : 0;
    const maxW = Math.max(10, e.w - pad * 2), maxH = Math.max(10, e.h - pad * 2);
    let fs = +e.fs || DEF[e.type]?.fs || 18, lines = wrapLines(e.text, fs, e.bold, maxW);
    if (e.type === "sticky" || e.type === "shape") while (fs > 8 && lines.length * fs * 1.3 > maxH) { fs -= 1; lines = wrapLines(e.text, fs, e.bold, maxW); }
    return { fs, lines };
  }
  function svgText(e, color) {
    if (!String(e.text || "").trim()) return "";
    const { fs, lines } = fitText(e), lh = fs * 1.3, mid = e.type !== "text";
    const x = mid ? e.w / 2 : 0, y0 = mid ? (e.h - lines.length * lh) / 2 : 0;
    return `<text font-family="${esc(FONT)}" font-size="${fs}" font-weight="${e.bold ? 700 : 400}" style="fill:${color}"${mid ? ' text-anchor="middle"' : ""}>` +
      lines.map((l, i) => `<tspan x="${f1(x)}" y="${f1(y0 + i * lh + (lh - fs) / 2 + fs * .82)}">${esc(l)}</tspan>`).join("") + "</text>";
  }
  function elSVG(e, get, R, full) {
    const sw = +(e.sw ?? DEF[e.type]?.sw ?? 2) || 0;
    if (isLine(e)) {
      const [a, b] = ends(e, get), { d, tail } = linePath(e, a, b), st = R(e.color || "ink", "i"), lw = sw || 2;
      let s = `<path d="${d}" style="fill:none;stroke:${st}" stroke-width="${lw}" stroke-linecap="round"${e.dash ? ` stroke-dasharray="${lw * 3} ${lw * 2.5}"` : ""}/>`;
      if (e.type === "arrow") s += `<path d="${headPath(b, tail, 8 + lw * 2.5)}" style="fill:none;stroke:${st}" stroke-width="${lw}" stroke-linecap="round" stroke-linejoin="round"/>`;
      return s;
    }
    const w = f1(e.w), hh = f1(e.h); let s = "";
    if (e.type === "sticky") s = `<rect width="${w}" height="${hh}" rx="6" style="fill:${R(e.color || "yellow", "p")}"/>` + (full ? svgText(e, "#1d2130") : "");
    else if (e.type === "shape") {
      const i = sw / 2, st = sw ? R(e.stroke || "blue", "i") : "none";
      const geo = e.shape === "ellipse" ? `<ellipse cx="${w / 2}" cy="${hh / 2}" rx="${f1(Math.max(1, w / 2 - i))}" ry="${f1(Math.max(1, hh / 2 - i))}"`
        : e.shape === "diamond" ? `<polygon points="${w / 2},${i} ${f1(w - i)},${hh / 2} ${w / 2},${f1(hh - i)} ${i},${hh / 2}"`
        : `<rect x="${i}" y="${i}" width="${f1(Math.max(1, w - sw))}" height="${f1(Math.max(1, hh - sw))}" rx="10"`;
      s = `${geo} style="fill:${R(e.color ?? "blue", "p")};stroke:${st}" stroke-width="${sw}" stroke-linejoin="round"/>` + (full ? svgText(e, shapeTc(e, R)) : "");
    }
    else if (e.type === "text") s = full ? svgText(e, R(e.color || "ink", "i")) : `<rect y="${f1(hh * .3)}" width="${f1(w * .75)}" height="${f1(Math.max(3, hh * .3))}" rx="2" style="fill:${R(e.color || "ink", "i")}" opacity=".4"/>`;
    else if (e.type === "frame") {
      s = `<rect width="${w}" height="${hh}" rx="8" style="fill:${R(null, "paper")};stroke:${R(null, "fline")}" stroke-width="1.5"/>`;
      if (e.color && e.color !== "none") s += `<rect width="${w}" height="${hh}" rx="8" style="fill:${R(e.color, "p")}" opacity=".35"/>`;
      if (full) s += `<text x="2" y="-9" font-family="${esc(FONT)}" font-size="15" font-weight="600" style="fill:${R(null, "muted")}">${esc(e.text || "Frame")}</text>`;
    }
    else if (e.type === "pen") s = `<path d="${penD(e)}" style="fill:none;stroke:${R(e.color || "ink", "i")}" stroke-width="${sw || 3}" stroke-linecap="round" stroke-linejoin="round"/>`;
    else if (e.type === "image") {
      const f = full && e.file && Data.get("files", e.file.id);
      s = f?.data ? `<image href="${esc(f.data)}" xlink:href="${esc(f.data)}" width="${w}" height="${hh}" preserveAspectRatio="xMidYMid slice"/>` : `<rect width="${w}" height="${hh}" rx="4" style="fill:${R("gray", "p")}"/>`;
    }
    return `<g transform="translate(${f1(e.x)} ${f1(e.y)})${e.rot ? ` rotate(${f1(e.rot)} ${w / 2} ${hh / 2})` : ""}">${s}</g>`;
  }
  function sceneSVG(list, get, R, { full = true, pad = 40, bg = "", fluid = false } = {}) {
    const items = [...list].sort((a, b) => (a.z || 0) - (b.z || 0));
    const B = union(items.map(e => { const b = bbox(e, get); return e.type === "frame" && full ? { ...b, y: b.y - 28, h: b.h + 28 } : b; })) || { x: 0, y: 0, w: 400, h: 300 };
    const x = f1(B.x - pad), y = f1(B.y - pad), w = f1(Math.max(B.w, 1) + pad * 2), hh = f1(Math.max(B.h, 1) + pad * 2);
    const size = fluid ? `width="100%" height="100%" preserveAspectRatio="xMidYMid meet"` : `width="${w}" height="${hh}"`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${x} ${y} ${w} ${hh}" ${size}>` +
      (bg ? `<rect x="${x}" y="${y}" width="${w}" height="${hh}" style="fill:${bg}"/>` : "") + items.map(e => elSVG(e, get, R, full)).join("") + "</svg>";
    return { svg, w, h: hh };
  }
  function download(blob, name) {
    const u = URL.createObjectURL(blob), a = h("a", { href: u, download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 30000);
  }

  /* ---------- templates ---------- */
  const TEMPLATES = [
    { id: "blank", name: "Blank", icon: "⬜", desc: "An empty canvas" },
    { id: "brainstorm", name: "Brainstorm", icon: "💡", desc: "Columns for ideas" },
    { id: "retro", name: "Retrospective", icon: "🔁", desc: "Went well, to improve, actions" },
    { id: "kanban", name: "Kanban", icon: "📋", desc: "To do, doing, done" },
    { id: "mindmap", name: "Mind map", icon: "🧠", desc: "A central idea with branches" },
  ];
  function columns(title, cols) {
    const out = [{ type: "text", x: 0, y: -120, w: 1300, h: 48, text: title, fs: 36, bold: true, color: "ink" }];
    cols.forEach(([name, color, notes], i) => {
      const x = i * 460;
      out.push({ type: "frame", x, y: 0, w: 420, h: 640, text: name, color });
      notes.forEach((n, j) => out.push({ type: "sticky", x: x + 20 + (j % 2) * 196, y: 24 + Math.floor(j / 2) * 196, w: 180, h: 180, text: n, color: color === "none" ? "yellow" : color, fs: 18 }));
    });
    return out;
  }
  function template(id) {
    if (id === "brainstorm") return columns("Brainstorm", [["Ideas", "yellow", ["Write one idea per note", "Go for quantity"]], ["Questions", "blue", ["What do we need to find out?"]], ["Next steps", "green", ["Vote on the best ideas 👍"]]]);
    if (id === "retro") return columns("Retrospective", [["Went well", "green", ["What helped us?"]], ["To improve", "orange", ["What slowed us down?"]], ["Actions", "blue", ["Who does what by when?"]]]);
    if (id === "kanban") return columns("Kanban", [["To do", "gray", ["First task", "Second task"]], ["Doing", "yellow", ["Work in progress"]], ["Done", "green", ["Something finished 🎉"]]]);
    if (id === "mindmap") {
      const out = [{ ref: "c", type: "shape", shape: "ellipse", x: -140, y: -65, w: 280, h: 130, text: "Main idea", color: "purple", stroke: "purple", sw: 2, fs: 24, bold: true, tc: "ink" }];
      [["Goals", -560, -230, "blue"], ["Ideas", 300, -230, "green"], ["Risks", -560, 150, "orange"], ["Next steps", 300, 150, "pink"]].forEach(([t, x, y, c], i) => {
        out.push({ ref: "b" + i, type: "shape", shape: "rect", x, y, w: 240, h: 84, text: t, color: c, stroke: c, sw: 2, fs: 20, tc: "ink" });
        out.push({ type: "line", fromRef: "c", toRef: "b" + i, curve: true, color: "gray", sw: 2, points: [0, 0, 0, 0] });
      });
      return out;
    }
    return [];
  }
  // write a list of elements to a board; `ref`/`fromRef`/`toRef` wire connectors to new ids
  function seedEls(boardId, objs) {
    const ids = {};
    objs.forEach(o => { o._id = Data.uid(); if (o.ref) ids[o.ref] = o._id; });
    let zi = 0, zf = -1000;
    objs.forEach(o => {
      const { _id, ref, fromRef, toRef, ...rest } = o;
      const rec = { ...DEF[rest.type], ...rest, board: boardId, rot: rest.rot || 0 };
      if (rec.z == null) rec.z = rec.type === "frame" ? zf++ : ++zi;
      if (fromRef !== undefined) rec.from = ids[fromRef] || null;
      if (toRef !== undefined) rec.to = ids[toRef] || null;
      if (isLine(rec) && !rec.points) rec.points = [0, 0, 0, 0];
      Data.add(EC, rec, _id);
    });
  }

  /* ---------- boards list ---------- */
  const visible = b => !(b.members || []).length || b.members.includes(myKey()) || b.by === myKey();
  const liveViewers = b => Object.entries(b.viewers || {}).filter(([k, t]) => k !== myKey() && Date.now() - (+t || 0) < 70000).map(([k]) => k);
  function seg(items, val, onChange) {
    const el = h("div", { class: "seg" });
    items.forEach(([k, l]) => el.append(h("button", { type: "button", class: k === val ? "on" : "", text: l, onclick: e => { el.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); onChange(k); } })));
    return el;
  }

  function renderList(root) {
    root.classList.add("bd-listview");
    let q = "", trash = false;
    const editable = canEdit();
    const search = h("input", { class: "app-search", placeholder: "Search boards…", oninput: () => { q = search.value.trim().toLowerCase(); draw(); } });
    const trashBtn = h("button", { class: "chip-btn", text: "🗑️ Trash", onclick: () => { trash = !trash; trashBtn.classList.toggle("on", trash); draw(); } });
    const newBtn = editable ? h("button", { class: "btn primary", text: "+ New board", onclick: () => newBoard() }) : null;
    const tpls = editable ? h("div", { class: "bd-tpls" }, h("span", { class: "bd-tpls-l", text: "Start with a template" }),
      ...TEMPLATES.map(t => h("button", { class: "bd-tpl-chip glass", onclick: () => newBoard(t.id) }, h("span", { text: t.icon }), t.name))) : null;
    const grid = h("div", { class: "bd-grid" });
    root.append(Apps.header("Boards", "🧑‍🎨", "Whiteboards to think, plan and draw together", search, trashBtn, newBtn), tpls, grid);

    const prevCache = new Map();
    function preview(b, els) {
      if (!els.length) return `<div class="bd-prev-empty">Empty board</div>`;
      let sig = els.length; for (const e of els) { const str = e.id + (e.x | 0) + "," + (e.y | 0) + "," + (e.w | 0) + "," + (e.h | 0) + (e.color || "") + (e.z || 0) + (e.points || []).length + (e.from || "") + (e.to || ""); for (let i = 0; i < str.length; i++) sig = (sig * 31 + str.charCodeAt(i)) | 0; }
      const hit = prevCache.get(b.id);
      if (hit && hit.sig === sig) return hit.svg;
      const byId = new Map(els.map(e => [e.id, e]));
      const list = els.length > 400 ? [...els].sort((a, b2) => (b2.z || 0) - (a.z || 0)).slice(0, 400) : els;
      const svg = sceneSVG(list, k => byId.get(k), cssR, { full: false, pad: 30, fluid: true }).svg;
      prevCache.set(b.id, { sig, svg });
      return svg;
    }
    function draw() {
      const me = myKey();
      const els = {}; Data.list(EC).forEach(e => { (els[e.board] ||= []).push(e); });
      const all = Data.list(BC).filter(b => visible(b) && !!b.deleted === trash && (!q || String(b.name || "").toLowerCase().includes(q)))
        .sort((a, b) => (b.edited || b.at || 0) - (a.edited || a.at || 0));
      grid.replaceChildren();
      if (!trash && editable && !q) grid.append(h("button", { class: "bd-card bd-newcard", onclick: () => newBoard() }, h("span", { class: "bd-new-plus", text: "+" }), h("span", { text: "New board" })));
      if (!all.length && (trash || q || !editable)) grid.append(h("div", { class: "bd-none", text: trash ? "Trash is empty" : q ? "No boards match your search" : "No boards yet" }));
      all.forEach((b, i) => {
        const mine = els[b.id] || [], here = liveViewers(b), ed = b.edited || b.at;
        const menuBtn = h("button", { class: "icon-btn xs bd-card-menu", title: "More", html: icon("dots"), onclick: e => { e.stopPropagation(); cardMenu(e.currentTarget, b); } });
        grid.append(h("div", { class: "bd-card glass", style: { animationDelay: Math.min(i, 12) * 30 + "ms" }, role: "button", tabindex: 0,
          onclick: () => trash ? null : Apps.go("boards", b.id), onkeydown: e => { if (e.key === "Enter" && !trash) Apps.go("boards", b.id); } },
          h("div", { class: "bd-prev bd-bg-" + (b.bg || "dots"), html: preview(b, mine) }),
          here.length ? h("div", { class: "bd-card-live", title: here.map(k => Data.person(k).name).join(", ") + " on this board now" }, Apps.avatars(here, 20, 3)) : null,
          h("div", { class: "bd-card-b" },
            h("div", { class: "bd-card-t" }, h("span", { class: "bd-card-ic", text: b.icon || "🧑‍🎨" }), h("b", { text: b.name || "Untitled board" }), menuBtn),
            h("div", { class: "bd-card-m" },
              h("span", { text: (trash ? "Deleted " + UI.timeAgo(b.deletedAt || ed) : "Edited " + UI.timeAgo(ed || Date.now()) + (b.editedBy && b.editedBy !== me ? " by " + Data.person(b.editedBy).name.split(" ")[0] : "")) + " · " + mine.length + " item" + (mine.length === 1 ? "" : "s") }),
              (b.members || []).length ? Apps.avatars(b.members, 20, 4) : h("span", { class: "bd-every", text: "Everyone" })))));
      });
    }
    function cardMenu(anchor, b) {
      const ed = editable;
      if (b.deleted) return UI.menu(anchor, [
        { label: "Restore", icon: "restore", onClick: () => Data.update(BC, b.id, { deleted: false }) },
        { label: "Delete forever", icon: "trash", danger: true, onClick: async () => { if (await UI.confirm(`Delete “${b.name || "Untitled board"}” and everything on it? This can't be undone.`)) purgeBoard(b.id); } },
      ], { align: "end" });
      UI.menu(anchor, [
        { label: "Open", icon: "arrow", onClick: () => Apps.go("boards", b.id) },
        ed ? { label: "Rename and settings", iconHtml: ico(IC.users), onClick: () => editBoard(b) } : null,
        ed ? { label: "Duplicate", icon: "copy", onClick: () => duplicateBoard(b) } : null,
        ed ? { sep: true } : null,
        ed ? { label: "Move to trash", icon: "trash", danger: true, onClick: () => trashBoard(b) } : null,
      ], { align: "end" });
    }
    let t = 0; const soon = () => { clearTimeout(t); t = setTimeout(draw, 150); };
    const offs = [Data.on(BC, soon), Data.on(EC, soon)];
    const tick = setInterval(draw, 30000);
    draw();
    return () => { offs.forEach(f => f()); clearInterval(tick); clearTimeout(t); };
  }

  async function newBoard(tpl) {
    const v = await boardDialog(null, tpl);
    if (!v) return;
    const id = Data.uid(), now = Date.now();
    Data.add(BC, { name: v.name, icon: v.icon, bg: v.bg, members: v.members, edited: now, editedBy: myKey() }, id);
    if (v.tpl && v.tpl !== "blank") seedEls(id, template(v.tpl));
    notifyMembers(v.members, v.name, id);
    Apps.go("boards", id);
  }
  async function editBoard(b) {
    const v = await boardDialog(b);
    if (!v) return;
    const added = v.members.filter(k => !(b.members || []).includes(k));
    Data.update(BC, b.id, { name: v.name, icon: v.icon, bg: v.bg, members: v.members });
    notifyMembers(added, v.name, b.id);
  }
  function notifyMembers(keys, name, id) {
    const me = Data.me();
    (keys || []).filter(k => k !== me.key).forEach(k => Data.notify(k, `<b>${esc(me.name)}</b> added you to the board <b>${esc(name)}</b>`, "#/app/boards/" + id, ""));
  }
  function duplicateBoard(b) {
    const id = Data.uid();
    Data.add(BC, { name: (b.name || "Untitled board") + " (copy)", icon: b.icon || "🧑‍🎨", bg: b.bg || "dots", members: b.members || [], edited: Date.now(), editedBy: myKey() }, id);
    const els = Data.list(EC).filter(e => e.board === b.id), byId = new Map(els.map(e => [e.id, e]));
    seedEls(id, els.map(e => {
      const { id: oid, at, by, lockedBy, lockedAt, comments, votes, board, from, to, ...rest } = e;
      if (isLine(e)) rest.points = flat(ends(e, k => byId.get(k)));
      return { ...rest, ref: oid, fromRef: from || undefined, toRef: to || undefined };
    }));
    UI.toast("📋 Board duplicated");
  }
  function trashBoard(b) {
    Data.update(BC, b.id, { deleted: true, deletedAt: Date.now() });
    UI.toast("🗑️ Board moved to trash", { label: "Undo", run: () => Data.update(BC, b.id, { deleted: false }) });
  }
  function purgeBoard(id) {
    Data.list(EC).filter(e => e.board === id).forEach(e => Data.remove(EC, e.id));
    Data.remove(BC, id);
  }

  function boardDialog(b, tpl) {
    return new Promise(resolve => {
      const me = myKey(), isNew = !b; let done = false;
      const v = { name: b?.name || "", icon: b?.icon || "🧑‍🎨", bg: b?.bg || "dots", members: [...(b?.members || [])], tpl: tpl || "blank" };
      let acc = v.members.length ? "some" : "all";
      const name = h("input", { class: "menu-input", placeholder: "Board name", value: v.name, maxlength: 120 });
      const iconBtn = h("button", { type: "button", class: "bd-iconpick", title: "Choose an icon", text: v.icon, onclick: () => UI.emojiPicker(iconBtn, x => { if (x) { v.icon = x; iconBtn.textContent = x; } }) });
      const ppl = h("button", { type: "button", class: "menu-input f-person bd-ppl" });
      const paintPpl = () => {
        ppl.style.display = acc === "some" ? "" : "none";
        ppl.replaceChildren(v.members.length ? Apps.avatars(v.members, 20) : "", h("span", { text: v.members.length ? v.members.map(k => Data.person(k).name.split(" ")[0]).join(", ") : "Choose people…" }));
      };
      ppl.onclick = () => Apps.peoplePicker(ppl, v.members, ks => { v.members = ks; paintPpl(); });
      paintPpl();
      const tplGrid = isNew ? h("div", { class: "bd-tplgrid" }, ...TEMPLATES.map(t => h("button", { type: "button", class: "bd-tplopt" + (t.id === v.tpl ? " on" : ""), onclick: e => { v.tpl = t.id; tplGrid.querySelectorAll(".bd-tplopt").forEach(x => x.classList.toggle("on", x === e.currentTarget)); } },
        h("span", { class: "bd-tplopt-ic", text: t.icon }), h("b", { text: t.name }), h("small", { text: t.desc })))) : null;
      const ok = h("button", { class: "btn primary", type: "button", text: isNew ? "Create board" : "Save" });
      const body = h("div", { class: "bd-dlg" },
        h("div", { class: "bd-dlg-name" }, iconBtn, name),
        h("div", { class: "f-row" }, h("span", { text: "Background" }), seg([["dots", "Dots"], ["grid", "Grid"], ["plain", "Plain"]], v.bg, x => (v.bg = x))),
        h("div", { class: "f-row" }, h("span", { text: "Who can open it" }), seg([["all", "Everyone in the workspace"], ["some", "Chosen people"]], acc, x => { acc = x; paintPpl(); }), ppl),
        tplGrid ? h("div", { class: "f-row" }, h("span", { text: "Template" }), tplGrid) : null,
        h("div", { class: "f-actions" }, h("span"), h("span", { style: { display: "flex", gap: "8px" } }, h("button", { class: "btn", type: "button", text: "Cancel", onclick: () => m.close() }), ok)));
      const m = UI.modal(isNew ? "New board" : "Board settings", body, { onClose: () => { if (!done) resolve(null); } });
      m.el.style.width = "580px";
      name.addEventListener("keydown", e => { if (e.key === "Enter") ok.click(); });
      ok.onclick = () => {
        v.name = name.value.trim() || "Untitled board";
        if (acc === "all") v.members = []; else if (!v.members.includes(me)) v.members = [me, ...v.members];
        done = true; m.close(); resolve(v);
      };
      setTimeout(() => name.focus(), 60);
    });
  }

  /* ---------- clipboard shared by all boards while Lumen is open ---------- */
  let clip = null; // { items, text, n, t, sys }

  /* ---------- the canvas ---------- */
  function openBoard(root, id) {
    root.classList.add("bd-full");
    const editable = canEdit();
    const me = myKey();
    const wsKey = () => (window.Cloud?.ws?.id || "local") + ":" + id;
    let board = null, ready = false, alive = true, loadedOnce = false, fittedOnce = false;
    const E = new Map();        // id → element as stored
    const OV = new Map();       // id → local copy while I drag it (written to Data at most every 250 ms)
    const nodes = new Map();    // id → { n: element node, ck: content key }
    const pendingImg = new Set();
    let sel = new Set(), tool = "select", shapeKind = "rect", editing = null, editCtx = null, muting = false, present = null, voting = false;
    let found = new Set(), hits = [], hitI = 0;
    const V = { x: 0, y: 0, z: 1 };
    const cur = k => OV.get(k) || E.get(k);
    const hist = { undo: [], redo: [] };
    const seen = {};
    let prefs = {}; try { prefs = JSON.parse(localStorage.getItem("lumen-boards-prefs")) || {}; } catch {}
    const savePrefs = () => { try { localStorage.setItem("lumen-boards-prefs", JSON.stringify(prefs)); } catch {} };

    const world = h("div", { class: "bd-world" });
    const over = h("div", { class: "bd-over" });
    const stage = h("div", { class: "bd-stage bd-bg-dots", dataset: { tool: "select" } }, world, over);
    const wrap = h("div", { class: "bd-wrap" }, stage);
    const loading = h("div", { class: "bd-loading" }, h("div", { class: "bd-spin" }), "Opening board…");
    wrap.append(loading);
    root.append(wrap);
    let topEl, toolsEl, zoomEl, zoomLbl, mapEl, mapCv, ctxEl, presEl, presLbl, nameIn, iconBtn, presenceEl, shareBtn, searchIn, searchCount, undoBtn, redoBtn, voteBtn;

    /* ----- view (pan & zoom with a single transform) ----- */
    let viewT = 0, liveT = 0, uiRaf = 0, animRaf = 0, mapLast = 0, mapTO = 0, mapT = null;
    function applyView() {
      world.style.transform = `translate(${V.x}px, ${V.y}px) scale(${V.z})`;
      world.style.setProperty("--bd-inv", String(1 / V.z));
      world.classList.toggle("bd-far", V.z < .35);
      world.classList.toggle("bd-vfar", V.z < .14);
      let g = (board?.bg === "grid" ? 40 : 24) * V.z; while (g < 12) g *= 4;
      stage.style.backgroundSize = `${g}px ${g}px`;
      stage.style.backgroundPosition = `${V.x}px ${V.y}px`;
      if (zoomLbl) zoomLbl.textContent = Math.round(V.z * 100) + "%";
      world.classList.add("bd-live"); clearTimeout(liveT); liveT = setTimeout(() => world.classList.remove("bd-live"), 160);
      scheduleUi();
      clearTimeout(viewT); viewT = setTimeout(saveView, 500);
    }
    function saveView() { try { localStorage.setItem("lumen-board-view:" + wsKey(), JSON.stringify({ x: f1(V.x), y: f1(V.y), z: V.z })); } catch {} }
    function loadView() { try { const v = JSON.parse(localStorage.getItem("lumen-board-view:" + wsKey())); return v && isFinite(v.z) && v.z > 0 ? v : null; } catch { return null; } }
    const SW = () => stage.clientWidth || 800, SH = () => stage.clientHeight || 600;
    function zoomAt(sx, sy, nz) {
      nz = clamp(nz, .1, 4); const wx = (sx - V.x) / V.z, wy = (sy - V.y) / V.z;
      V.z = nz; V.x = sx - wx * nz; V.y = sy - wy * nz; applyView();
    }
    const zoomBy = k => { cancelAnimationFrame(animRaf); zoomAt(SW() / 2, SH() / 2, V.z * k); };
    const zoomTo = z => { const wx = (SW() / 2 - V.x) / V.z, wy = (SH() / 2 - V.y) / V.z; animateView({ z, x: SW() / 2 - wx * z, y: SH() / 2 - wy * z }); };
    function animateView(T, ms = 380) {
      cancelAnimationFrame(animRaf);
      const S = { ...V }, t0 = performance.now();
      const step = now => {
        if (!alive) return;
        const t = Math.min(1, (now - t0) / ms), k = 1 - Math.pow(1 - t, 3);
        V.x = S.x + (T.x - S.x) * k; V.y = S.y + (T.y - S.y) * k; V.z = S.z + (T.z - S.z) * k; applyView();
        if (t < 1) animRaf = requestAnimationFrame(step);
      };
      animRaf = requestAnimationFrame(step);
    }
    function fitRect(B, pad = 80, maxZ = 1.5) {
      const W = SW(), H = SH(), top = present ? 0 : 56;
      const z = clamp(Math.min((W - pad * 2) / Math.max(B.w, 1), (H - top - pad * 2) / Math.max(B.h, 1)), .1, maxZ);
      return { z, x: W / 2 - (B.x + B.w / 2) * z, y: top + (H - top) / 2 - (B.y + B.h / 2) * z };
    }
    function fitAll(anim) {
      const B = union([...E.values()].map(e => bbox(e, cur)));
      const T = B ? fitRect(B) : { z: 1, x: SW() / 2, y: SH() / 2 };
      anim ? animateView(T) : (Object.assign(V, T), applyView());
    }
    function fitSel() { const B = union([...sel].map(cur).filter(Boolean).map(e => bbox(e, cur))); if (B) animateView(fitRect(B, 120, 2)); }
    const viewRect = () => ({ x: -V.x / V.z, y: -V.y / V.z, w: SW() / V.z, h: SH() / V.z });
    const viewCenter = () => [(SW() / 2 - V.x) / V.z, (SH() / 2 - V.y) / V.z];

    /* ----- rendering: one keyed node per element, only changed nodes are touched ----- */
    const ck = e => [e.type, e.w, e.h, e.color, e.stroke, e.sw, e.fs, e.tc, e.bold, e.text, e.shape, e.file?.id, e.locked, e.dash, e.curve,
      lockedByOther(e) ? e.lockedBy : "", (e.votes || []).length, (e.votes || []).includes(me), (e.comments || []).length, e.vw, e.vh, (e.points || []).length, e.type === "sticky" && voting].join("|");
    const moved = (a, b) => a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h || (a.rot || 0) !== (b.rot || 0);
    function removeNode(k) { const r = nodes.get(k); if (r) { r.n.remove(); nodes.delete(k); } }
    function renderEl(k, anim) {
      const e = E.has(k) ? cur(k) : null;
      if (!e) return removeNode(k);
      let r = nodes.get(k), fresh = false;
      if (!r) { r = { n: h("div", { class: "bd-el", dataset: { id: k } }), ck: null }; nodes.set(k, r); world.append(r.n); fresh = loadedOnce; }
      const n = r.n;
      if (isLine(e)) { paintLine(n, e); n.classList.toggle("bd-found", found.has(k)); return; }
      if (anim) { n.classList.add("anim"); clearTimeout(n._at); n._at = setTimeout(() => n.classList.remove("anim"), 380); }
      place(n, e); // size first, so sticky text can be fitted
      const key = ck(e);
      if (key !== r.ck) { paint(n, e); r.ck = key; }
      if (fresh) { n.classList.add("bd-pop"); setTimeout(() => n.classList.remove("bd-pop"), 400); }
    }
    function place(n, e) {
      n.style.transform = `translate(${e.x}px, ${e.y}px)` + (e.rot ? ` rotate(${e.rot}deg)` : "");
      n.style.width = Math.max(1, e.w) + "px"; n.style.height = Math.max(1, e.h) + "px";
      n.style.zIndex = String(Math.round(clamp(e.z || 0, -1e6, 1e6)));
    }
    function txtDiv(e, color) {
      const d = h("div", { class: "bd-txt", text: e.text || "" });
      d.style.fontSize = (+e.fs || DEF[e.type]?.fs || 18) + "px";
      if (e.bold) d.style.fontWeight = "700";
      if (color) d.style.color = color;
      return d;
    }
    function shapeSVG(e) {
      const w = Math.max(1, e.w), hh = Math.max(1, e.h), sw = +(e.sw ?? 2) || 0, i = sw / 2;
      const st = `fill:${fillCss(e.color ?? "blue")};stroke:${sw ? inkCss(e.stroke || "blue") : "none"};stroke-width:${sw}`;
      const geo = e.shape === "ellipse" ? `<ellipse cx="${w / 2}" cy="${hh / 2}" rx="${Math.max(1, w / 2 - i)}" ry="${Math.max(1, hh / 2 - i)}" style="${st}"/>`
        : e.shape === "diamond" ? `<polygon points="${w / 2},${i} ${w - i},${hh / 2} ${w / 2},${hh - i} ${i},${hh / 2}" style="${st}" stroke-linejoin="round"/>`
        : `<rect x="${i}" y="${i}" width="${Math.max(1, w - sw)}" height="${Math.max(1, hh - sw)}" rx="10" style="${st}"/>`;
      return `<svg class="bd-svg bd-shape-svg" width="${w}" height="${hh}" viewBox="0 0 ${w} ${hh}">${geo}</svg>`;
    }
    function paint(n, e) {
      const t = e.type, sw = +(e.sw ?? DEF[t]?.sw ?? 2) || 0;
      const keep = ["anim", "bd-pop", "bd-editing", "bd-erasing", "bd-target"].filter(c => n.classList.contains(c));
      n.className = "bd-el bd-" + t + (t === "shape" ? " bd-s-" + (e.shape || "rect") : "") + (e.locked ? " bd-locked" : "") + (found.has(e.id) ? " bd-found" : "");
      keep.forEach(c => n.classList.add(c));
      n.replaceChildren();
      if (t === "sticky") { n.style.setProperty("--c", fillCss(e.color || "yellow")); n.append(txtDiv(e)); }
      else if (t === "text") n.append(txtDiv(e, inkCss(e.color || "ink")));
      else if (t === "shape") { n.innerHTML = shapeSVG(e); n.append(txtDiv(e, shapeTc(e, cssR))); }
      else if (t === "frame") { n.style.setProperty("--c", e.color && e.color !== "none" ? fillCss(e.color) : "transparent"); n.append(h("div", { class: "bd-ftitle", text: e.text || "Frame" })); }
      else if (t === "pen") {
        const P = (sw || 3) + 10, d = penD(e), w = Math.max(1, e.w) + P * 2, hh = Math.max(1, e.h) + P * 2;
        n.innerHTML = `<svg class="bd-svg bd-pen-svg" style="left:${-P}px;top:${-P}px" width="${w}" height="${hh}" viewBox="${-P} ${-P} ${w} ${hh}">` +
          `<path class="bd-hitp" d="${d}" style="stroke-width:${Math.max(14, sw + 10)}"/><path d="${d}" style="fill:none;stroke:${inkCss(e.color || "ink")}" stroke-width="${sw || 3}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      }
      else if (t === "image") {
        const f = e.file && Data.get("files", e.file.id);
        if (f?.data) { pendingImg.delete(e.id); n.append(h("img", { src: f.data, alt: e.file?.name || "", draggable: false })); }
        else { pendingImg.add(e.id); n.append(h("div", { class: "bd-imgph", text: "🖼️" })); }
      }
      if (t === "sticky" && e.text) fitSticky(n, e);
      // badges: votes, comments, someone editing, locked
      const box = h("div", { class: "bd-badges" }), v = (e.votes || []).length, c = (e.comments || []).length;
      if (t === "sticky" && (v || voting)) box.append(h("button", { class: "bd-badge bd-badge-btn" + ((e.votes || []).includes(me) ? " on" : ""), dataset: { act: "vote" }, title: (e.votes || []).includes(me) ? "Remove my vote" : "Vote", text: "👍 " + v }));
      if (c) box.append(h("button", { class: "bd-badge bd-badge-btn", dataset: { act: "cmt" }, title: "Comments", text: "💬 " + c }));
      if (box.children.length) n.append(box);
      if (lockedByOther(e)) { const p = Data.person(e.lockedBy); n.append(h("div", { class: "bd-lockav", title: p.name + " is editing" }, Apps.avatar(p, 24), h("span", { text: p.name.split(" ")[0] + " is editing" }))); }
      if (e.locked) n.append(h("div", { class: "bd-lockic", title: "Locked", html: ico(IC.lock) }));
    }
    function fitSticky(n, e) {
      const d = n.querySelector(".bd-txt"); if (!d) return;
      let fs = +e.fs || 20; d.style.fontSize = fs + "px";
      if (String(e.text || "").length * fs * fs * .62 < (e.w - 28) * (e.h - 28) * .75 && !String(e.text || "").includes("\n\n")) return;
      let guard = 40;
      while (fs > 8 && d.scrollHeight > d.clientHeight + 1 && guard--) { fs -= fs > 28 ? 3 : 1; d.style.fontSize = fs + "px"; }
    }
    function paintLine(n, e, extra) {
      const [a, b] = ends(e, cur), { d, tail } = linePath(e, a, b), sw = +e.sw || 2, st = inkCss(e.color || "ink");
      const P = 14 + sw * 3;
      let x0 = Math.min(a[0], b[0], tail[0]), y0 = Math.min(a[1], b[1], tail[1]), x1 = Math.max(a[0], b[0], tail[0]), y1 = Math.max(a[1], b[1], tail[1]);
      x0 -= P; y0 -= P; const w = x1 - x0 + P, hh = y1 - y0 + P;
      n.className = "bd-el bd-line" + (e.locked ? " bd-locked" : "") + (extra ? " " + extra : "");
      n.style.transform = `translate(${f1(x0)}px, ${f1(y0)}px)`; n.style.width = f1(w) + "px"; n.style.height = f1(hh) + "px";
      n.style.zIndex = extra ? "999999" : String(Math.round(clamp(e.z || 0, -1e6, 1e6)));
      const dash = e.dash ? ` stroke-dasharray="${sw * 3} ${sw * 2.5}"` : "";
      const head = e.type === "arrow" ? `<path d="${headPath(b, tail, 8 + sw * 2.5)}" style="fill:none;stroke:${st}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>` : "";
      n.innerHTML = `<svg class="bd-svg" width="${f1(w)}" height="${f1(hh)}" viewBox="${f1(x0)} ${f1(y0)} ${f1(w)} ${f1(hh)}"><path class="bd-hitp" d="${d}" style="stroke-width:${Math.max(16, sw + 12)}"/>` +
        `<path d="${d}" style="fill:none;stroke:${st}" stroke-width="${sw}" stroke-linecap="round"${dash}/>${head}</svg>`;
    }

    /* ----- live data ----- */
    function onEls(all) {
      const seenIds = new Set(), changed = [];
      for (const e of all) {
        if (e.board !== id || e.deleted) continue;
        seenIds.add(e.id);
        const prev = E.get(e.id);
        if (prev === e) continue;
        E.set(e.id, e); changed.push([e.id, prev]);
      }
      for (const k of [...E.keys()]) if (!seenIds.has(k)) { E.delete(k); OV.delete(k); removeNode(k); sel.delete(k); changed.push([k, null]); if (editing === k) { editCtx?.stop(); editCtx = null; editing = null; } }
      if (!changed.length) return;
      const ch = new Set(changed.map(c => c[0]));
      for (const [k, prev] of changed) {
        if (!E.has(k) || OV.has(k) || editing === k) continue;
        const e = E.get(k);
        renderEl(k, !muting && loadedOnce && prev && moved(prev, e) && !isLine(e));
      }
      E.forEach(l => { if (isLine(l) && !OV.has(l.id) && !ch.has(l.id) && (ch.has(l.from) || ch.has(l.to))) renderEl(l.id); });
      if (cmt && ch.has(cmt.k)) cmt.fill();
      loadedOnce = true;
      if (!fittedOnce && E.size) { fittedOnce = true; fitAll(false); }
      scheduleUi();
    }
    function onFiles() {
      if (!pendingImg.size) return;
      [...pendingImg].forEach(k => {
        const e = E.get(k); if (!e) return pendingImg.delete(k);
        const f = e.file && Data.get("files", e.file.id);
        if (f?.data) { pendingImg.delete(k); const r = nodes.get(k); if (r) r.ck = null; renderEl(k); }
      });
    }

    /* ----- writes, history (undo/redo of my own actions) ----- */
    const snap = k => { const e = Data.get(EC, k); if (!e) return null; const { id: _i, lockedBy, lockedAt, ...rest } = e; return JSON.parse(JSON.stringify(rest)); };
    const SKIP = new Set(["id", "at", "by", "comments", "votes", "lockedBy", "lockedAt", "board"]);
    function applySnaps(map) {
      muting = true;
      try {
        for (const [k, s] of map) {
          const c = Data.get(EC, k);
          if (!s) { if (c) Data.remove(EC, k); continue; }
          if (!c) { Data.add(EC, { ...s, board: id }, k); continue; }
          const patch = {};
          new Set([...Object.keys(s), ...Object.keys(c)]).forEach(f => {
            if (SKIP.has(f)) return;
            const a = s[f] === undefined ? null : s[f], b = c[f] === undefined ? null : c[f];
            if (JSON.stringify(a) !== JSON.stringify(b)) patch[f] = a;
          });
          if (Object.keys(patch).length) Data.update(EC, k, patch);
        }
      } finally { muting = false; }
    }
    function pushHist(before) {
      const after = new Map([...before.keys()].map(k => [k, snap(k)]));
      hist.undo.push({ before, after }); if (hist.undo.length > 100) hist.undo.shift();
      hist.redo.length = 0; paintUndo();
    }
    function paintUndo() { if (undoBtn) { undoBtn.disabled = !hist.undo.length; redoBtn.disabled = !hist.redo.length; } }
    function undo() {
      if (editing) finishEdit();
      const a = hist.undo.pop(); if (!a) return UI.toast("Nothing to undo");
      applySnaps(a.before); hist.redo.push(a);
      sel = new Set([...a.before.keys()].filter(k => E.has(k))); paintUndo(); touch(); scheduleUi();
    }
    function redo() {
      const a = hist.redo.pop(); if (!a) return;
      applySnaps(a.after); hist.undo.push(a);
      sel = new Set([...a.after.keys()].filter(k => E.has(k))); paintUndo(); touch(); scheduleUi();
    }
    function maxZ() { let m = 0; E.forEach(e => { if ((e.z || 0) > m) m = e.z || 0; }); return Math.round(m); }
    function minZ() { let m = 0; E.forEach(e => { if ((e.z || 0) < m) m = e.z || 0; }); return Math.round(m); }
    function create(objs, opts = {}) {
      if (!editable || !objs.length) return [];
      const before = new Map(), ids = [];
      let z = maxZ(), zf = minZ();
      muting = true;
      try {
        for (const o of objs) {
          const k = o.id || Data.uid(), rec = { ...o, board: id, rot: o.rot || 0 };
          delete rec.id;
          ["x", "y", "w", "h"].forEach(f => { if (rec[f] != null) rec[f] = f1(rec[f]); });
          if (rec.z == null) rec.z = rec.type === "frame" ? --zf : ++z;
          Data.add(EC, rec, k); before.set(k, null); ids.push(k);
        }
      } finally { muting = false; }
      pushHist(before); touch();
      if (opts.select !== false) sel = new Set(ids);
      scheduleUi();
      return ids;
    }
    function mutate(patches, opts = {}) {
      if (!editable || !patches.size) return;
      const before = new Map([...patches.keys()].filter(k => E.has(k)).map(k => [k, snap(k)]));
      muting = !opts.anim;
      try { patches.forEach((p, k) => { if (E.has(k)) Data.update(EC, k, p); }); } finally { muting = false; }
      opts.after?.();
      pushHist(before); touch(); scheduleUi();
    }
    function del(ids) {
      if (!editable) return;
      ids = ids.filter(k => { const e = E.get(k); return e && !e.locked && !lockedByOther(e); }); if (!ids.length) return;
      const set = new Set(ids), detach = new Map();
      E.forEach(l => {
        if (!isLine(l) || set.has(l.id) || !(set.has(l.from) || set.has(l.to))) return;
        detach.set(l.id, { from: set.has(l.from) ? null : l.from || null, to: set.has(l.to) ? null : l.to || null, points: flat(ends(l, cur)) });
      });
      const before = new Map([...ids, ...detach.keys()].map(k => [k, snap(k)]));
      muting = true;
      try { detach.forEach((p, k) => Data.update(EC, k, p)); ids.forEach(k => Data.remove(EC, k)); } finally { muting = false; }
      ids.forEach(k => sel.delete(k));
      pushHist(before); touch(); scheduleUi();
    }
    const GEO = ["x", "y", "w", "h", "rot", "points", "from", "to", "fs"];
    function flushOV(keys) {
      muting = true;
      try {
        keys.forEach(k => {
          const o = OV.get(k), e = E.get(k); if (!o || !e) return;
          const p = {};
          GEO.forEach(f => { const a = o[f] ?? null, b = e[f] ?? null; if (JSON.stringify(a) !== JSON.stringify(b)) p[f] = typeof a === "number" ? f1(a) : a; });
          if (Object.keys(p).length) Data.update(EC, k, p);
        });
      } finally { muting = false; }
    }
    function endOV(keys) { keys.forEach(k => OV.delete(k)); keys.forEach(k => { if (E.has(k)) { const r = nodes.get(k); if (r) r.ck = null; renderEl(k); } }); depsOf(keys).forEach(k => renderEl(k)); }
    function depsOf(keys) { const s = new Set(keys), out = []; E.forEach(l => { if (isLine(l) && !s.has(l.id) && (s.has(l.from) || s.has(l.to))) out.push(l.id); }); return out; }
    function refitTexts(keys) {
      muting = true;
      try {
        keys.forEach(k => {
          const e = E.get(k); if (!e || e.type !== "text") return;
          const t = nodes.get(k)?.n.querySelector(".bd-txt"); if (!t) return;
          const nh = Math.max(24, Math.ceil(t.offsetHeight));
          if (Math.abs(nh - e.h) > 1) Data.update(EC, k, { h: nh });
        });
      } finally { muting = false; }
    }
    let touchedAt = 0;
    function touch() { const now = Date.now(); if (now - touchedAt < 60000) return; touchedAt = now; Data.update(BC, id, { edited: now, editedBy: me }); }
    const strip = e => {
      const { id: oid, at, by, lockedBy, lockedAt, comments, votes, board: _b, ...rest } = e;
      const o = JSON.parse(JSON.stringify(rest)); o._old = oid;
      if (isLine(e)) o.points = flat(ends(e, cur));
      return o;
    };
    function pasteItems(items, dx, dy) {
      const map = {}; items.forEach(o => { map[o._old] = Data.uid(); });
      const objs = [...items].sort((a, b) => (a.z || 0) - (b.z || 0)).map(o => {
        const { _old, z, ...r } = o, n = { ...r, id: map[_old] };
        if (isLine(r)) { const p = pts(r).map(([x, y]) => [x + dx, y + dy]); return { ...n, from: (r.from && map[r.from]) || null, to: (r.to && map[r.to]) || null, points: flat(p.length >= 2 ? p : [[0, 0], [0, 0]]) }; }
        return { ...n, x: r.x + dx, y: r.y + dy };
      });
      return create(objs);
    }
    function copySel() {
      const items = [...sel].map(k => E.get(k)).filter(Boolean); if (!items.length) return false;
      clip = { items: items.map(strip), text: items.map(e => String(e.text || "").trim()).filter(Boolean).join("\n") || "Board items", n: 0, t: Date.now(), sys: false };
      return true;
    }
    function clipBox(items) { return union(items.map(o => isLine(o) ? union(pts(o).map(([x, y]) => ({ x, y, w: 0, h: 0 }))) : { x: o.x, y: o.y, w: o.w, h: o.h })); }
    function pasteClip(at) {
      if (!clip || !editable) return;
      const B = clipBox(clip.items); if (!B) return;
      let dx, dy;
      const vr = viewRect(), inView = B.x < vr.x + vr.w && B.x + B.w > vr.x && B.y < vr.y + vr.h && B.y + B.h > vr.y;
      if (at || !inView) { const c = at || viewCenter(); dx = c[0] - (B.x + B.w / 2); dy = c[1] - (B.y + B.h / 2); }
      else { clip.n++; dx = dy = 24 * clip.n; }
      pasteItems(clip.items, dx, dy);
    }
    function dupSel() { const items = [...sel].map(k => E.get(k)).filter(Boolean); if (items.length) pasteItems(items.map(strip), 24, 24); }
    function selectAll() { sel = new Set(E.keys()); scheduleUi(); }
    function zorder(front) {
      const items = [...sel].map(k => E.get(k)).filter(Boolean).sort((a, b) => (a.z || 0) - (b.z || 0)); if (!items.length) return;
      const P = new Map();
      if (front) { let z = maxZ(); items.forEach(e => P.set(e.id, { z: ++z })); }
      else { let z = minZ() - items.length; items.forEach(e => P.set(e.id, { z: z++ })); }
      mutate(P);
    }
    function toggleLock() {
      const items = [...sel].map(k => E.get(k)).filter(Boolean); if (!items.length) return;
      const all = items.every(e => e.locked); mutate(new Map(items.map(e => [e.id, { locked: !all }])));
      UI.toast(all ? "🔓 Unlocked" : "🔒 Locked: it can't be moved or edited until unlocked");
    }
    function setField(ids, patch) {
      const P = new Map(ids.map(k => [k, typeof patch === "function" ? patch(E.get(k)) : patch]));
      mutate(P, { after: () => refitTexts(ids) });
    }
    function nudge(dx, dy) {
      const P = new Map();
      sel.forEach(k => {
        const e = E.get(k); if (!e || e.locked) return;
        if (isLine(e)) { if (!e.from && !e.to) P.set(k, { points: flat(pts(e).map(([x, y]) => [x + dx, y + dy])) }); }
        else P.set(k, { x: f1(e.x + dx), y: f1(e.y + dy) });
      });
      mutate(P);
    }
    function align(mode) {
      const items = [...sel].map(k => E.get(k)).filter(e => e && !isLine(e) && !e.locked); if (items.length < 2) return;
      const B = union(items.map(e => ({ x: e.x, y: e.y, w: e.w, h: e.h }))), P = new Map();
      if (mode === "hdist" || mode === "vdist") {
        const ax = mode === "hdist" ? "x" : "y", dim = ax === "x" ? "w" : "h";
        const s = [...items].sort((a, b) => a[ax] - b[ax]), total = s.reduce((t, e) => t + e[dim], 0);
        const gap = ((ax === "x" ? B.w : B.h) - total) / (s.length - 1); let pos = B[ax];
        s.forEach(e => { P.set(e.id, { [ax]: f1(pos) }); pos += e[dim] + gap; });
      } else items.forEach(e => P.set(e.id, {
        left: { x: B.x }, center: { x: f1(B.x + B.w / 2 - e.w / 2) }, right: { x: f1(B.x + B.w - e.w) },
        top: { y: B.y }, middle: { y: f1(B.y + B.h / 2 - e.h / 2) }, bottom: { y: f1(B.y + B.h - e.h) },
      }[mode]));
      mutate(P, { anim: true });
    }
    function toggleVote(k) { const e = E.get(k); if (!e) return; Data.arr(EC, k, "votes", me, !(e.votes || []).includes(me)); }
    function contained(fr) {
      const out = [];
      E.forEach(e => {
        if (e.id === fr.id || e.locked || lockedByOther(e)) return;
        const b = bbox(e, cur);
        if (b.x >= fr.x - 1 && b.y >= fr.y - 1 && b.x + b.w <= fr.x + fr.w + 1 && b.y + b.h <= fr.y + fr.h + 1) out.push(e.id);
      });
      return out;
    }

    /* ----- selection overlay (screen space, so handles keep their size at any zoom) ----- */
    let hideSel = false, ctxHidden = false, ctxKey = "", targetK = null;
    function scheduleUi() {
      if (uiRaf) return;
      uiRaf = requestAnimationFrame(() => { uiRaf = 0; if (!alive || !ready) return; drawOverlay(); updateCtx(); drawMapSoon(); });
    }
    function handlesFor(e) {
      if (e.type === "text") return ["w", "e", "nw", "ne", "sw", "se"];
      if (e.type === "image" || e.type === "sticky") return ["nw", "ne", "sw", "se"];
      return ["n", "s", "w", "e", "nw", "ne", "sw", "se"];
    }
    function drawOverlay() {
      over.querySelectorAll(".bd-sel, .bd-h, .bd-selp").forEach(x => x.remove());
      if (!sel.size || present || hideSel) return;
      const items = [...sel].map(k => E.has(k) ? cur(k) : null).filter(Boolean); if (!items.length) return;
      const z = V.z, S = (x, y) => [V.x + x * z, V.y + y * z], canMod = editable && !editing;
      if (items.length === 1) {
        const e = items[0];
        if (isLine(e)) {
          const [a, b] = ends(e, cur);
          [a, b].forEach((p, i) => { const [sx, sy] = S(p[0], p[1]); over.append(h("div", { class: "bd-h bd-hp" + ((i ? e.to : e.from) ? " on" : "") + (canMod && !e.locked ? "" : " ro"), dataset: canMod && !e.locked ? { h: "p" + i } : {}, style: { left: sx + "px", top: sy + "px" } })); });
          return;
        }
        const [sx, sy] = S(e.x, e.y);
        const box = h("div", { class: "bd-sel" + (e.locked ? " locked" : ""), style: { left: sx + "px", top: sy + "px", width: e.w * z + "px", height: e.h * z + "px", transform: e.rot ? `rotate(${e.rot}deg)` : "" } });
        if (canMod && !e.locked && !lockedByOther(e)) {
          handlesFor(e).forEach(k => box.append(h("div", { class: "bd-h bd-h-" + k, dataset: { h: k } })));
          box.append(h("div", { class: "bd-h bd-rot", dataset: { h: "rot" }, title: "Rotate" }));
        }
        over.append(box);
        return;
      }
      items.slice(0, 80).forEach(e => { const b = bbox(e, cur), [sx, sy] = S(b.x, b.y); over.append(h("div", { class: "bd-selp", style: { left: sx + "px", top: sy + "px", width: b.w * z + "px", height: b.h * z + "px" } })); });
      const B = union(items.map(e => bbox(e, cur))), [sx, sy] = S(B.x, B.y);
      const box = h("div", { class: "bd-sel multi", style: { left: sx + "px", top: sy + "px", width: B.w * z + "px", height: B.h * z + "px" } });
      if (canMod && items.some(e => !e.locked)) ["nw", "ne", "sw", "se"].forEach(k => box.append(h("div", { class: "bd-h bd-h-" + k, dataset: { h: k } })));
      over.append(box);
    }
    function markTarget(k) {
      if (k === targetK) return;
      if (targetK) nodes.get(targetK)?.n.classList.remove("bd-target");
      targetK = k; if (k) nodes.get(k)?.n.classList.add("bd-target");
    }
    const clearTargets = () => markTarget(null);
    function targetAt(cx, cy, skip) {
      for (const n of document.elementsFromPoint(cx, cy)) {
        const el = n.closest?.(".bd-el"); if (!el || !world.contains(el) || el.classList.contains("bd-preview")) continue;
        const k = el.dataset.id; if (!k || k === skip) continue;
        const e = E.get(k); if (e && !isLine(e)) return k;
      }
      return null;
    }

    /* ----- pointer input: mouse, pen and touch (pinch / two-finger pan) ----- */
    let drag = null, pinch = null, lpT = 0, lastTap = null, spaceDown = false, stageR = stage.getBoundingClientRect(), lastPtr = "mouse";
    const ptrs = new Map();
    const toW = (cx, cy) => [(cx - stageR.left - V.x) / V.z, (cy - stageR.top - V.y) / V.z];
    const coalesced = ev => { const c = ev.getCoalescedEvents?.(); return c && c.length ? c : [ev]; };

    function onDown(ev) {
      if (!ready) return;
      lastPtr = ev.pointerType || "mouse";
      if (ev.target.closest(".bd-editing .bd-txt, .bd-editing .bd-ftitle")) return;
      if (ev.target.closest(".bd-badge-btn")) return;
      UI.closePops();
      if (editing) finishEdit();
      const ae = document.activeElement; if (ae && ae !== document.body && !stage.contains(ae) && ae.blur) ae.blur();
      stageR = stage.getBoundingClientRect();
      ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (ev.pointerType === "touch" && ptrs.size === 2) { cancelDrag(); startPinch(); return; }
      if (ptrs.size > 1 || drag) return;
      ev.preventDefault();
      try { stage.setPointerCapture(ev.pointerId); } catch {}
      cancelAnimationFrame(animRaf);
      const node = ev.target.closest(".bd-el"), hk = node && world.contains(node) ? node.dataset.id : null, hit = hk && E.has(hk) ? cur(hk) : null;
      const hd = ev.target.closest("[data-h]")?.dataset.h;
      const now = Date.now();
      const dbl = !!lastTap && now - lastTap.t < 400 && Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < 24 && lastTap.k === hk;
      lastTap = { t: now, x: ev.clientX, y: ev.clientY, k: hk };
      if (ev.pointerType === "touch" && !present) {
        const cx = ev.clientX, cy = ev.clientY;
        lpT = setTimeout(() => { lpT = 0; cancelDrag(); ptrs.clear(); if (navigator.vibrate) try { navigator.vibrate(12); } catch {} ctxMenu(cx, cy, hk); }, 520);
      }
      if (ev.button === 2) { if (hk && !sel.has(hk)) { sel = new Set([hk]); scheduleUi(); } return; }
      if (present || ev.button === 1 || spaceDown || tool === "hand") return startPan(ev);
      if (!editable) {
        if (hit) { if (dbl && (hit.comments || []).length) openComments(hk); sel = new Set([hk]); } else sel = new Set();
        scheduleUi(); return startPan(ev);
      }
      if (hd && sel.size) return startHandle(ev, hd);
      if (tool === "select") {
        if (hit) {
          if (dbl && textual(hit)) { clearTimeout(lpT); lpT = 0; return startEdit(hk); }
          if (ev.shiftKey) { if (sel.has(hk)) { sel.delete(hk); scheduleUi(); return; } sel.add(hk); }
          else if (!sel.has(hk)) sel = new Set([hk]);
          scheduleUi();
          return startMove(ev);
        }
        if (ev.pointerType === "touch") { if (sel.size) { sel = new Set(); scheduleUi(); } return startPan(ev); }
        return startMarquee(ev);
      }
      if (tool === "pen") return startPen(ev);
      if (tool === "eraser") return startErase(ev);
      if (tool === "line" || tool === "arrow") return startLine(ev, hit && !isLine(hit) ? hk : null);
      if (["sticky", "text", "shape", "frame"].includes(tool)) return startCreate(ev);
      startPan(ev);
    }
    function onMove(ev) {
      const p = ptrs.get(ev.pointerId); if (p) { p.x = ev.clientX; p.y = ev.clientY; }
      if (pinch) { if (ptrs.size >= 2) movePinch(); return; }
      if (!drag) return;
      if (lpT && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 8) { clearTimeout(lpT); lpT = 0; }
      drag.move(ev);
    }
    function onUp(ev) {
      clearTimeout(lpT); lpT = 0;
      ptrs.delete(ev.pointerId);
      if (pinch) { if (ptrs.size < 2) pinch = null; return; }
      if (drag) { const d = drag; drag = null; try { d.up(ev); } catch (e) { console.error(e); } scheduleUi(); }
    }
    function onCancel(ev) { ptrs.delete(ev.pointerId); if (pinch && ptrs.size < 2) pinch = null; cancelDrag(); }
    function cancelDrag() { clearTimeout(lpT); lpT = 0; if (drag) { const d = drag; drag = null; try { d.cancel?.(); } catch (e) { console.error(e); } } }
    function startPinch() {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), m: [(a.x + b.x) / 2, (a.y + b.y) / 2], v: { ...V } };
    }
    function movePinch() {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), m = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      const z = clamp(pinch.v.z * d / pinch.d, .1, 4);
      const wx = (pinch.m[0] - stageR.left - pinch.v.x) / pinch.v.z, wy = (pinch.m[1] - stageR.top - pinch.v.y) / pinch.v.z;
      V.z = z; V.x = m[0] - stageR.left - wx * z; V.y = m[1] - stageR.top - wy * z; applyView();
    }
    function onWheel(ev) {
      if (!ready) return;
      ev.preventDefault(); stageR = stage.getBoundingClientRect(); cancelAnimationFrame(animRaf);
      const m = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
      if (ev.ctrlKey || ev.metaKey) zoomAt(ev.clientX - stageR.left, ev.clientY - stageR.top, V.z * Math.exp(-ev.deltaY * m * .004));
      else if (ev.shiftKey && !ev.deltaX) { V.x -= ev.deltaY * m; applyView(); }
      else { V.x -= ev.deltaX * m; V.y -= ev.deltaY * m; applyView(); }
    }
    function startPan(ev) {
      const v0 = { ...V }, sx = ev.clientX, sy = ev.clientY;
      stage.classList.add("bd-grabbing");
      const stop = () => stage.classList.remove("bd-grabbing");
      drag = { sx, sy, move(e) { V.x = v0.x + e.clientX - sx; V.y = v0.y + e.clientY - sy; applyView(); }, up: stop, cancel: stop };
    }
    function startMove(ev) {
      const ids = [...sel].filter(k => { const e = E.get(k); return e && !e.locked && !lockedByOther(e); });
      const sx = ev.clientX, sy = ev.clientY;
      if (!ids.length) { drag = { sx, sy, move() {}, up() {} }; return; }
      const set = new Set(ids);
      ids.forEach(k => { const e = E.get(k); if (e.type === "frame") contained(e).forEach(c => set.add(c)); });
      const start = new Map(), base = new Map();
      set.forEach(k => { const e = E.get(k); start.set(k, e); if (isLine(e)) base.set(k, ends(e, cur)); });
      const keys = [...start.keys()], deps = depsOf(keys), before = new Map(keys.map(k => [k, snap(k)]));
      let movedYet = false, lastW = 0;
      const moveOf = (s, dx, dy) => {
        if (!isLine(s)) return { ...s, x: s.x + dx, y: s.y + dy };
        const [a, b] = base.get(s.id);
        return { ...s, from: s.from && set.has(s.from) ? s.from : null, to: s.to && set.has(s.to) ? s.to : null, points: flat([[a[0] + dx, a[1] + dy], [b[0] + dx, b[1] + dy]]) };
      };
      drag = { sx, sy,
        move(e) {
          if (!movedYet && Math.hypot(e.clientX - sx, e.clientY - sy) < 4) return;
          if (!movedYet) { movedYet = true; hideCtx(true); stage.classList.add("bd-moving"); }
          const dx = (e.clientX - sx) / V.z, dy = (e.clientY - sy) / V.z;
          start.forEach((s, k) => OV.set(k, moveOf(s, dx, dy)));
          keys.forEach(k => renderEl(k)); deps.forEach(k => renderEl(k));
          drawOverlay();
          const now = Date.now(); if (keys.length <= 4 && now - lastW > 250) { lastW = now; flushOV(keys); }
        },
        up() {
          stage.classList.remove("bd-moving"); hideCtx(false);
          if (!movedYet) return;
          flushOV(keys); endOV(keys); pushHist(before); touch(); scheduleUi();
        },
        cancel() { stage.classList.remove("bd-moving"); hideCtx(false); if (!movedYet) return; endOV(keys); applySnaps(before); scheduleUi(); },
      };
    }
    function startMarquee(ev) {
      const base = ev.shiftKey ? new Set(sel) : new Set();
      if (!ev.shiftKey && sel.size) { sel = new Set(); scheduleUi(); }
      const sx = ev.clientX, sy = ev.clientY, [wx0, wy0] = toW(sx, sy), box = h("div", { class: "bd-marq" });
      let shown = false;
      drag = { sx, sy,
        move(e) {
          if (!shown) { if (Math.hypot(e.clientX - sx, e.clientY - sy) < 4) return; shown = true; over.append(box); hideCtx(true); }
          const [wx1, wy1] = toW(e.clientX, e.clientY);
          const R = { x: Math.min(wx0, wx1), y: Math.min(wy0, wy1), w: Math.abs(wx1 - wx0), h: Math.abs(wy1 - wy0) };
          Object.assign(box.style, { left: V.x + R.x * V.z + "px", top: V.y + R.y * V.z + "px", width: R.w * V.z + "px", height: R.h * V.z + "px" });
          const s = new Set(base);
          E.forEach(el => {
            const b = bbox(el, cur);
            const inside = b.x >= R.x && b.y >= R.y && b.x + b.w <= R.x + R.w && b.y + b.h <= R.y + R.h;
            const inter = b.x <= R.x + R.w && b.x + b.w >= R.x && b.y <= R.y + R.h && b.y + b.h >= R.y;
            if (el.type === "frame" ? inside : inter) s.add(el.id);
          });
          sel = s; drawOverlay();
        },
        up() { box.remove(); hideCtx(false); },
        cancel() { box.remove(); hideCtx(false); },
      };
    }
    function startHandle(ev, hd) {
      const items = [...sel].map(k => E.get(k)).filter(e => e && !e.locked); if (!items.length) return startPan(ev);
      const keys = items.map(e => e.id), before = new Map(keys.map(k => [k, snap(k)])), sx = ev.clientX, sy = ev.clientY;
      let fn;
      if (hd === "p0" || hd === "p1") fn = endpointFn(items[0], hd === "p1");
      else if (hd === "rot") fn = rotateFn(items[0]);
      else if (items.length === 1) fn = resizeFn(items[0], hd);
      else fn = groupResizeFn(items, hd);
      const deps = depsOf(keys);
      let movedYet = false, lastW = 0;
      drag = { sx, sy,
        move(e) {
          if (!movedYet && Math.hypot(e.clientX - sx, e.clientY - sy) < 2) return;
          if (!movedYet) { movedYet = true; hideCtx(true); }
          const [wx, wy] = toW(e.clientX, e.clientY); fn(wx, wy, e);
          keys.forEach(k => renderEl(k)); deps.forEach(k => renderEl(k)); drawOverlay();
          const now = Date.now(); if (keys.length <= 4 && now - lastW > 250) { lastW = now; flushOV(keys); }
        },
        up() {
          hideCtx(false); clearTargets(); if (!movedYet) return;
          flushOV(keys); endOV(keys); refitTexts(keys); pushHist(before); touch(); scheduleUi();
        },
        cancel() { hideCtx(false); clearTargets(); if (!movedYet) return; endOV(keys); applySnaps(before); scheduleUi(); },
      };
    }
    function resizeFn(s, hd) {
      const hx = hd.includes("e") ? 1 : hd.includes("w") ? -1 : 0, hy = hd.includes("s") ? 1 : hd.includes("n") ? -1 : 0;
      const a = rad(s.rot), c = center(s), ax = -hx * s.w / 2, ay = -hy * s.h / 2, ratio = s.w / (s.h || 1);
      const keep = s.type === "image" || s.type === "text", min = s.type === "text" ? 40 : 16;
      return (wx, wy, ev) => {
        const [lx, ly] = rotP(wx - c[0], wy - c[1], -a);
        let nw = hx ? Math.max(min, (lx - ax) * hx) : s.w, nh = hy ? Math.max(min, (ly - ay) * hy) : s.h;
        if (hx && hy && keep !== !!ev.shiftKey) { if (nw / nh > ratio) nh = nw / ratio; else nw = nh * ratio; }
        const ncx = hx ? ax + hx * nw / 2 : 0, ncy = hy ? ay + hy * nh / 2 : 0, [rx, ry] = rotP(ncx, ncy, a);
        const o = { ...s, w: nw, h: nh, x: c[0] + rx - nw / 2, y: c[1] + ry - nh / 2 };
        if (s.type === "text" && hx && hy) o.fs = clamp(Math.round((+s.fs || 22) * nw / s.w), 8, 240);
        OV.set(s.id, o);
      };
    }
    function rotateFn(s) {
      const c = center(s);
      return (wx, wy, ev) => {
        let d = Math.atan2(wy - c[1], wx - c[0]) * 180 / Math.PI + 90;
        if (ev.shiftKey) d = Math.round(d / 15) * 15; else { const r = Math.round(d / 45) * 45; if (Math.abs(d - r) < 4) d = r; }
        d = ((d + 540) % 360) - 180;
        OV.set(s.id, { ...s, rot: f1(d) });
      };
    }
    function groupResizeFn(items, hd) {
      const B = union(items.map(e => bbox(e, cur))), hx = hd.includes("e") ? 1 : -1, hy = hd.includes("s") ? 1 : -1;
      const ax = hx > 0 ? B.x : B.x + B.w, ay = hy > 0 ? B.y : B.y + B.h, ids = new Set(items.map(i => i.id));
      const base = new Map(items.filter(isLine).map(l => [l.id, ends(l, cur)]));
      return (wx, wy, ev) => {
        let sx = Math.max(.05, ((wx - ax) * hx) / Math.max(B.w, 1)), sy = Math.max(.05, ((wy - ay) * hy) / Math.max(B.h, 1));
        if (!ev.shiftKey) sx = sy = Math.max(sx, sy);
        const X = x => ax + (x - ax) * sx, Y = y => ay + (y - ay) * sy;
        items.forEach(s => {
          if (isLine(s)) { const [a, b] = base.get(s.id); OV.set(s.id, { ...s, from: s.from && ids.has(s.from) ? s.from : null, to: s.to && ids.has(s.to) ? s.to : null, points: flat([[X(a[0]), Y(a[1])], [X(b[0]), Y(b[1])]]) }); return; }
          const o = { ...s, x: X(s.x), y: Y(s.y), w: Math.max(4, s.w * sx), h: Math.max(4, s.h * sy) };
          if (s.type === "text") o.fs = clamp(Math.round((+s.fs || 22) * Math.min(sx, sy)), 6, 300);
          OV.set(s.id, o);
        });
      };
    }
    function endpointFn(s, isEnd) {
      const base = ends(s, cur), other = isEnd ? s.from : s.to;
      return (wx, wy, ev) => {
        let tk = targetAt(ev.clientX, ev.clientY, s.id); if (tk && tk === other) tk = null;
        markTarget(tk);
        const p = [base[0], base[1]]; p[isEnd ? 1 : 0] = [wx, wy];
        const o = { ...s, points: flat(p) };
        if (isEnd) o.to = tk || null; else o.from = tk || null;
        OV.set(s.id, o);
      };
    }
    function startCreate(ev) {
      const sx = ev.clientX, sy = ev.clientY, [x0, y0] = toW(sx, sy), t = tool, kind = shapeKind;
      const ghost = h("div", { class: "bd-ghost bd-ghost-" + (t === "shape" ? kind : t) });
      let shown = false, R = null;
      drag = { sx, sy,
        move(e) {
          if (t === "sticky" || t === "text") return;
          if (!shown && Math.hypot(e.clientX - sx, e.clientY - sy) < 6) return;
          if (!shown) { shown = true; world.append(ghost); }
          const [x1, y1] = toW(e.clientX, e.clientY);
          let w = Math.abs(x1 - x0), hh = Math.abs(y1 - y0); if (e.shiftKey) w = hh = Math.max(w, hh);
          R = { x: x1 < x0 ? x0 - w : x0, y: y1 < y0 ? y0 - hh : y0, w, h: hh };
          Object.assign(ghost.style, { transform: `translate(${R.x}px, ${R.y}px)`, width: w + "px", height: hh + "px" });
        },
        up() {
          ghost.remove();
          const d = DEF[t], sz = t === "shape" ? { rect: [200, 120], ellipse: [160, 160], diamond: [180, 150] }[kind] : [d.w, d.h];
          const o = R && R.w > 10 && R.h > 10 ? { x: R.x, y: R.y, w: R.w, h: R.h } : { x: x0 - sz[0] / 2, y: y0 - sz[1] / 2, w: sz[0], h: sz[1] };
          const obj = { type: t, ...d, ...o };
          if (t === "sticky") obj.color = prefs.sticky || "yellow";
          if (t === "shape") { obj.shape = kind; obj.color = prefs.shapeFill || "blue"; obj.stroke = prefs.shapeFill && prefs.shapeFill !== "none" && prefs.shapeFill !== "white" ? prefs.shapeFill : "blue"; }
          if (t === "text") { obj.x = x0 - 4; obj.y = y0 - 18; obj.text = ""; }
          if (t === "frame") obj.text = "Frame " + ([...E.values()].filter(e => e.type === "frame").length + 1);
          const [k] = create([obj]);
          setTool("select");
          if (k && (t === "sticky" || t === "text")) startEdit(k, true);
        },
        cancel() { ghost.remove(); },
      };
    }
    function startLine(ev, fromK) {
      const sx = ev.clientX, sy = ev.clientY, [x0, y0] = toW(sx, sy), t = tool;
      const preview = h("div", { class: "bd-el bd-line bd-preview" });
      const style = { color: prefs.lineColor || "ink", sw: prefs.lineW || 2 };
      let shown = false, last = null;
      drag = { sx, sy,
        move(e) {
          if (!shown && Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return;
          if (!shown) { shown = true; world.append(preview); }
          const [x1, y1] = toW(e.clientX, e.clientY);
          let tk = targetAt(e.clientX, e.clientY, fromK); if (tk === fromK) tk = null;
          markTarget(tk);
          last = { x1, y1, tk };
          paintLine(preview, { type: t, ...style, from: fromK, to: tk, points: flat([[x0, y0], [x1, y1]]) }, "bd-preview");
        },
        up() {
          preview.remove(); clearTargets(); if (!last) return;
          const l = { type: t, ...style, from: fromK || null, to: last.tk || null, points: flat([[x0, y0], [last.x1, last.y1]]) };
          const [a, b] = ends(l, cur); Object.assign(l, { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) });
          create([l]); setTool("select");
        },
        cancel() { preview.remove(); clearTargets(); },
      };
    }
    function startPen(ev) {
      const [x0, y0] = toW(ev.clientX, ev.clientY), P = [[x0, y0]], color = prefs.pen || "ink", sw = prefs.penSize || 3;
      let last = [x0, y0];
      const NS = "http://www.w3.org/2000/svg", ghost = document.createElementNS(NS, "svg"), path = document.createElementNS(NS, "path");
      ghost.setAttribute("class", "bd-penghost"); ghost.setAttribute("width", "1"); ghost.setAttribute("height", "1");
      path.setAttribute("style", `fill:none;stroke:${inkCss(color)};stroke-width:${sw}px;stroke-linecap:round;stroke-linejoin:round`);
      ghost.append(path); world.append(ghost);
      const add = (cx, cy) => {
        const [wx, wy] = toW(cx, cy), nx = last[0] + (wx - last[0]) * .55, ny = last[1] + (wy - last[1]) * .55;
        if (Math.hypot(nx - last[0], ny - last[1]) < 1.2 / V.z) return;
        last = [nx, ny]; P.push(last);
      };
      const draw = () => path.setAttribute("d", smoothD(P));
      draw();
      drag = { sx: ev.clientX, sy: ev.clientY,
        move(e) { coalesced(e).forEach(c => add(c.clientX, c.clientY)); draw(); },
        up(e) { const p = toW(e.clientX, e.clientY); if (Math.hypot(p[0] - last[0], p[1] - last[1]) > .5) P.push(p); ghost.remove(); finishPen(P, color, sw); },
        cancel() { ghost.remove(); },
      };
    }
    function finishPen(P, color, sw) {
      let p = simplify(P, .6 / V.z);
      if (p.length > 1500) { const k = Math.ceil(p.length / 1500); p = p.filter((_, i) => i % k === 0 || i === p.length - 1); }
      const xs = p.map(q => q[0]), ys = p.map(q => q[1]), x = Math.min(...xs), y = Math.min(...ys);
      const w = Math.max(1, Math.max(...xs) - x), hh = Math.max(1, Math.max(...ys) - y);
      create([{ type: "pen", x, y, w, h: hh, vw: f1(w), vh: f1(hh), color, sw, points: flat(p.map(q => [q[0] - x, q[1] - y])) }], { select: false });
    }
    function startErase(ev) {
      const hitSet = new Set();
      const probe = (cx, cy) => {
        for (const n of document.elementsFromPoint(cx, cy)) {
          const el = n.closest?.(".bd-el"); if (!el || !world.contains(el)) continue;
          const k = el.dataset.id, e = E.get(k);
          if (e && !e.locked && e.type !== "frame" && !hitSet.has(k)) { hitSet.add(k); el.classList.add("bd-erasing"); }
          break;
        }
      };
      probe(ev.clientX, ev.clientY);
      drag = { sx: ev.clientX, sy: ev.clientY,
        move(e) { coalesced(e).forEach(c => probe(c.clientX, c.clientY)); },
        up() { if (hitSet.size) del([...hitSet]); },
        cancel() { hitSet.forEach(k => nodes.get(k)?.n.classList.remove("bd-erasing")); },
      };
    }

    /* ----- inline text editing (with a soft lock so two people don't type over each other) ----- */
    function setEditable(el) {
      try { el.contentEditable = "plaintext-only"; } catch { el.contentEditable = "true"; }
      if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
    }
    function startEdit(k, fresh) {
      const e = E.get(k); if (!e || !editable || !textual(e)) return;
      if (e.locked) return UI.toast("🔒 Unlock it first to edit");
      if (lockedByOther(e)) return UI.toast(`✏️ ${Data.person(e.lockedBy).name} is editing this right now`);
      if (editing) finishEdit();
      const r = nodes.get(k); if (!r) return;
      editing = k; sel = new Set([k]);
      const before = snap(k);
      muting = true; try { Data.update(EC, k, { lockedBy: me, lockedAt: Date.now() }); } finally { muting = false; }
      const n = r.n, t = e.type === "frame" ? n.querySelector(".bd-ftitle") : n.querySelector(".bd-txt");
      if (!t) { editing = null; return; }
      n.classList.add("bd-editing");
      if (e.type === "sticky") t.style.fontSize = t.style.fontSize; // keep the fitted size while typing
      setEditable(t); t.focus({ preventScroll: true });
      try { const rg = document.createRange(); rg.selectNodeContents(t); if (e.type !== "frame") rg.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(rg); } catch {}
      const text = () => t.innerText.replace(/\n$/, "");
      const liveP = () => {
        const p = { text: e.type === "frame" ? text().replace(/\s*\n\s*/g, " ").slice(0, 120) : text().slice(0, 5000) };
        if (e.type === "text") p.h = Math.max(24, Math.ceil(t.offsetHeight));
        return p;
      };
      let saveT = 0;
      const lockT = setInterval(() => { muting = true; try { Data.update(EC, k, { lockedAt: Date.now() }); } finally { muting = false; } }, 20000);
      const onInput = () => {
        const cur0 = E.get(k); if (!cur0) return;
        if (e.type === "sticky") fitSticky(n, { ...cur0, text: text() });
        if (e.type === "text") n.style.height = Math.max(24, t.offsetHeight) + "px";
        clearTimeout(saveT);
        saveT = setTimeout(() => { if (editing !== k) return; muting = true; try { Data.update(EC, k, liveP()); } finally { muting = false; } }, 1200);
        scheduleUi();
      };
      const onKey = ev => {
        ev.stopPropagation();
        if (ev.key === "Escape" || (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey || e.type === "frame"))) { ev.preventDefault(); finishEdit(); }
      };
      const onPaste = ev => { if (t.contentEditable === "true") { ev.preventDefault(); document.execCommand("insertText", false, ev.clipboardData?.getData("text/plain") || ""); } };
      const onBlur = () => setTimeout(() => { if (editing === k && document.activeElement !== t) finishEdit(); }, 0);
      t.addEventListener("input", onInput); t.addEventListener("keydown", onKey); t.addEventListener("blur", onBlur); t.addEventListener("paste", onPaste);
      editCtx = { k, t, n, before, fresh, text, liveP, stop() { clearTimeout(saveT); clearInterval(lockT); t.removeEventListener("input", onInput); t.removeEventListener("keydown", onKey); t.removeEventListener("blur", onBlur); t.removeEventListener("paste", onPaste); } };
      hideCtx(true); drawOverlay();
    }
    function finishEdit() {
      if (!editCtx) { editing = null; return; }
      const c = editCtx; editCtx = null; editing = null; c.stop();
      const txt = c.text();
      c.t.contentEditable = "false"; c.n.classList.remove("bd-editing");
      try { getSelection().removeAllRanges(); } catch {}
      hideCtx(false);
      const e = E.get(c.k); if (!e) { scheduleUi(); return; }
      const last = hist.undo[hist.undo.length - 1], wasCreate = c.fresh && last && last.after.has(c.k) && last.before.get(c.k) === null;
      if (c.fresh && e.type === "text" && !txt.trim()) {
        if (wasCreate) { hist.undo.pop(); paintUndo(); }
        muting = true; try { Data.remove(EC, c.k); } finally { muting = false; }
        sel.delete(c.k); scheduleUi(); return;
      }
      muting = true; try { Data.update(EC, c.k, { ...c.liveP(), lockedBy: null, lockedAt: null }); } finally { muting = false; }
      const r = nodes.get(c.k); if (r) r.ck = null; renderEl(c.k);
      if (wasCreate) last.after.set(c.k, snap(c.k));
      else if ((c.before?.text || "") !== txt) pushHist(new Map([[c.k, c.before]]));
      touch(); scheduleUi();
    }

    /* ----- comments pinned to elements ----- */
    let cmt = null;
    function openComments(k, anchor) {
      const e0 = E.get(k); if (!e0) return;
      const list = h("div", { class: "bd-cmts" });
      const inp = h("textarea", { class: "menu-input bd-cmt-in", rows: 2, placeholder: "Write a comment… (@name to mention)" });
      const fill = () => {
        const el = E.get(k);
        list.replaceChildren(...(el?.comments || []).map(c => {
          const p = Data.person(c.by);
          return h("div", { class: "bd-cmt" }, Apps.avatar(p, 26), h("div", { class: "bd-cmt-b" },
            h("div", { class: "bd-cmt-h" }, h("b", { text: p.name }), h("small", { text: UI.timeAgo(c.at || Date.now()) }),
              c.by === me ? h("button", { class: "icon-btn xs", title: "Delete comment", html: icon("x"), onclick: () => Data.arr(EC, k, "comments", c, false) }) : null),
            h("div", { class: "bd-cmt-t", text: c.text })));
        }));
        if (!list.children.length) list.append(h("div", { class: "menu-empty", text: "No comments yet. Start the conversation." }));
        list.scrollTop = 1e6;
      };
      const post = () => {
        const text = inp.value.trim(); if (!text || !E.get(k)) return;
        Data.arr(EC, k, "comments", { by: me, text: text.slice(0, 2000), at: Date.now() }, true);
        inp.value = "";
        const el = E.get(k), who = Data.me().name, link = "#/app/boards/" + id, name = board?.name || "a board";
        const tell = new Set(Apps.mentioned(text));
        if (el?.by && el.by !== me) tell.add(el.by);
        tell.forEach(p => { if (p !== me) Data.notify(p, `<b>${esc(who)}</b> commented on <b>${esc(name)}</b>`, link, text); });
      };
      inp.addEventListener("keydown", ev => { ev.stopPropagation(); if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); post(); } });
      const anchorEl = anchor && anchor.isConnected ? anchor : nodes.get(k)?.n;
      const api = UI.popover(anchorEl, h("div", { class: "bd-cmt-pop" }, h("div", { class: "menu-sec", text: "Comments" }), list,
        h("div", { class: "bd-cmt-row" }, inp, h("button", { class: "btn primary", text: "Send", onclick: post }))), { onClose: () => { if (cmt && cmt.api === api) cmt = null; } });
      cmt = { k, fill, api };
      fill(); setTimeout(() => inp.focus(), 40);
    }
    world.addEventListener("click", ev => {
      const b = ev.target.closest(".bd-badge-btn"); if (!b) return;
      ev.stopPropagation();
      const k = b.closest(".bd-el")?.dataset.id; if (!k) return;
      if (b.dataset.act === "vote") toggleVote(k); else openComments(k, b);
    });

    /* ----- context menu (right click, or long press on touch) ----- */
    function ctxMenu(cx, cy, k) {
      stageR = stage.getBoundingClientRect();
      const anchor = { left: cx, right: cx, top: cy, bottom: cy };
      const e = k ? E.get(k) : null;
      if (e && !sel.has(k)) { sel = new Set([k]); scheduleUi(); }
      let items;
      if (e) {
        const n = sel.size;
        items = [
          editable && n === 1 && textual(e) && !e.locked ? { label: "Edit text", icon: "text", kbd: "Enter", onClick: () => startEdit(k) } : null,
          n === 1 ? { label: "Comments", iconHtml: ico(IC.comment), onClick: () => openComments(k) } : null,
          n === 1 && e.type === "sticky" ? { label: (e.votes || []).includes(me) ? "Remove my vote" : "Vote", iconHtml: ico(IC.vote), onClick: () => toggleVote(k) } : null,
          editable ? { sep: true } : null,
          editable ? { label: "Duplicate", icon: "copy", kbd: "Ctrl+D", onClick: dupSel } : null,
          editable ? { label: "Copy", icon: "copy", kbd: "Ctrl+C", onClick: () => { copySel(); UI.toast("Copied. Paste with Ctrl+V"); } } : null,
          editable ? { label: "Bring to front", iconHtml: ico(IC.front), onClick: () => zorder(true) } : null,
          editable ? { label: "Send to back", iconHtml: ico(IC.back2), onClick: () => zorder(false) } : null,
          editable ? { label: e.locked ? "Unlock" : "Lock", icon: "lock", onClick: toggleLock } : null,
          { label: "Zoom to selection", icon: "expand", kbd: "Shift+2", onClick: fitSel },
          editable ? { sep: true } : null,
          editable ? { label: "Delete", icon: "trash", danger: true, kbd: "Del", onClick: () => del([...sel]) } : null,
        ];
      } else {
        const at = toW(cx, cy);
        items = [
          editable && clip ? { label: "Paste here", icon: "copy", kbd: "Ctrl+V", onClick: () => pasteClip(at) } : null,
          editable ? { label: "Add a sticky note here", iconHtml: ico(IC.sticky), onClick: () => { const [k2] = create([{ type: "sticky", ...DEF.sticky, color: prefs.sticky || "yellow", x: at[0] - 100, y: at[1] - 100 }]); if (k2) startEdit(k2, true); } } : null,
          editable ? { label: "Add an image here", iconHtml: ico(IC.image), onClick: () => pickImage(at) } : null,
          { sep: true },
          { label: "Select all", kbd: "Ctrl+A", iconHtml: ico(IC.select), onClick: selectAll },
          { label: "Zoom to fit", kbd: "Shift+1", iconHtml: ico(IC.fit), onClick: () => fitAll(true) },
        ];
      }
      UI.menu(anchor, items);
    }

    /* ----- images: upload, paste, drop ----- */
    const imgSize = src => new Promise(r => {
      if (!src) return r({ w: 320, h: 240 });
      const i = new Image(); i.onload = () => r({ w: i.naturalWidth || 320, h: i.naturalHeight || 240 }); i.onerror = () => r({ w: 320, h: 240 }); i.src = src;
    });
    async function pickImage(at) {
      if (!editable) return;
      const files = (await Apps.pickFiles(true)).filter(f => /^image\//.test(f.type));
      if (files.length) addImages(files, at);
      setTool("select");
    }
    async function addImages(files, at) {
      if (!editable) return;
      files = files.filter(f => /^image\//.test(f.type)); if (!files.length) return;
      const c = at || viewCenter(), atts = await Apps.attach(files), objs = [];
      if (!alive) return;
      let off = 0;
      for (const att of atts) {
        const f = Data.get("files", att.id), sz = await imgSize(f?.data), lim = 480 / Math.max(.5, Math.min(V.z, 2));
        let w = sz.w, hh = sz.h; if (w > lim) { hh = hh * lim / w; w = lim; } if (hh > lim) { w = w * lim / hh; hh = lim; }
        objs.push({ type: "image", file: att, x: c[0] - w / 2 + off, y: c[1] - hh / 2 + off, w, h: hh }); off += 24;
      }
      if (objs.length && alive) create(objs);
    }
    function pasteText(txt) {
      const lines = txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean), c = viewCenter();
      if (lines.length > 1 && lines.length <= 40 && lines.every(l => l.length < 300)) {
        const cols = Math.ceil(Math.sqrt(lines.length));
        create(lines.map((l, i) => ({ type: "sticky", ...DEF.sticky, color: prefs.sticky || "yellow", text: l, x: c[0] - cols * 110 + (i % cols) * 220, y: c[1] - 110 + Math.floor(i / cols) * 220 })));
      } else {
        const ids = create([{ type: "text", ...DEF.text, text: txt.slice(0, 5000), x: c[0] - 160, y: c[1] - 20, w: 320 }]);
        requestAnimationFrame(() => refitTexts(ids));
      }
    }
    const modalOpen = () => [...document.querySelectorAll("#layer .backdrop")].some(b => !b.classList.contains("closing"));
    const typingIn = t => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    function onPaste(ev) {
      if (!alive || !ready || typingIn(ev.target) || modalOpen() || present) return;
      const files = [...(ev.clipboardData?.files || [])].filter(f => /^image\//.test(f.type));
      if (files.length) { ev.preventDefault(); return addImages(files); }
      const txt = ev.clipboardData?.getData("text/plain") || "";
      if (clip && (!clip.sys || !txt || txt === clip.text)) { ev.preventDefault(); return pasteClip(); }
      if (txt.trim() && editable) { ev.preventDefault(); pasteText(txt); }
    }
    function onCopy(ev) {
      if (!alive || !ready || typingIn(ev.target) || !clip || Date.now() - clip.t > 1500) return;
      try { ev.clipboardData.setData("text/plain", clip.text); ev.preventDefault(); clip.sys = true; } catch {}
    }
    stage.addEventListener("dragover", ev => { if (editable && [...(ev.dataTransfer?.types || [])].includes("Files")) { ev.preventDefault(); ev.dataTransfer.dropEffect = "copy"; } });
    stage.addEventListener("drop", ev => {
      const files = [...(ev.dataTransfer?.files || [])].filter(f => /^image\//.test(f.type)); if (!files.length || !editable) return;
      ev.preventDefault(); stageR = stage.getBoundingClientRect(); addImages(files, toW(ev.clientX, ev.clientY));
    });

    /* ----- keyboard shortcuts ----- */
    function onKey(ev) {
      if (!alive || !ready || !root.isConnected) return;
      if (modalOpen() || typingIn(ev.target)) return;
      const mod = ev.ctrlKey || ev.metaKey, k = (ev.key || "").toLowerCase();
      if (present) {
        if (["arrowright", "arrowdown", "pagedown", " ", "enter"].includes(k)) { ev.preventDefault(); step(1); }
        else if (["arrowleft", "arrowup", "pageup", "backspace"].includes(k)) { ev.preventDefault(); step(-1); }
        else if (k === "escape") stopPresent();
        return;
      }
      if (k === " " && !mod) { ev.preventDefault(); if (!spaceDown) { spaceDown = true; stage.classList.add("bd-space"); } return; }
      if (mod && k === "z") { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
      if (mod && k === "y") { ev.preventDefault(); redo(); return; }
      if (mod && (k === "=" || k === "+")) { ev.preventDefault(); zoomBy(1.25); return; }
      if (mod && k === "-") { ev.preventDefault(); zoomBy(1 / 1.25); return; }
      if (mod && k === "0") { ev.preventDefault(); zoomTo(1); return; }
      if (mod && k === "f") { ev.preventDefault(); openSearch(); return; }
      if (ev.shiftKey && ev.code === "Digit1") { ev.preventDefault(); fitAll(true); return; }
      if (ev.shiftKey && ev.code === "Digit2") { ev.preventDefault(); fitSel(); return; }
      if (mod && k === "a") { ev.preventDefault(); selectAll(); return; }
      if (mod && k === "c") { copySel(); return; }
      if (mod && k === "x") { if (editable && copySel()) del([...sel]); return; }
      if (mod && k === "d") { ev.preventDefault(); if (editable) dupSel(); return; }
      if (mod || ev.altKey) return;
      if (k === "delete" || k === "backspace") { if (editable && sel.size) { ev.preventDefault(); del([...sel]); } return; }
      if (k === "escape") { if (tool !== "select") setTool("select"); else if (sel.size) { sel = new Set(); scheduleUi(); } return; }
      if (k === "enter" && sel.size === 1) { ev.preventDefault(); startEdit([...sel][0]); return; }
      if (k.startsWith("arrow") && sel.size && editable) {
        ev.preventDefault(); const s = ev.shiftKey ? 10 : 1;
        nudge(k === "arrowleft" ? -s : k === "arrowright" ? s : 0, k === "arrowup" ? -s : k === "arrowdown" ? s : 0); return;
      }
      const T = { v: "select", h: "hand", n: "sticky", t: "text", l: "line", a: "arrow", p: "pen", e: "eraser", f: "frame" };
      if (!editable && k !== "v" && k !== "h") return;
      if (T[k]) setTool(T[k]);
      else if (k === "r" || k === "o" || k === "d") { shapeKind = { r: "rect", o: "ellipse", d: "diamond" }[k]; setTool("shape"); }
      else if (k === "i") pickImage();
    }
    function onKeyUp(ev) { if (ev.key === " ") { spaceDown = false; stage.classList.remove("bd-space"); } }

    /* ----- tools ----- */
    const TOOLS = [
      ["select", "Select", "V"], ["hand", "Hand", "H"], ["sticky", "Sticky note", "N"], ["text", "Text", "T"], ["shape", "Shapes", "R, O, D"],
      ["line", "Line", "L"], ["arrow", "Arrow", "A"], ["pen", "Pen", "P"], ["eraser", "Eraser", "E"], ["image", "Image", "I"], ["frame", "Frame", "F"],
    ];
    function toolIcon(k) { return ico(k === "shape" ? IC[shapeKind] : IC[k]); }
    function setTool(k) {
      if (!editable && k !== "select" && k !== "hand") k = "select";
      if (editing) finishEdit();
      tool = k; stage.dataset.tool = k;
      if (k !== "select" && k !== "hand" && sel.size) { sel = new Set(); scheduleUi(); }
      paintTools();
    }
    function paintTools() {
      if (!toolsEl) return;
      toolsEl.querySelectorAll(".bd-tool").forEach(b => {
        const k = b.dataset.tool; b.classList.toggle("on", k === tool);
        if (k === "shape") b.innerHTML = toolIcon("shape");
        if (k === "sticky") b.style.setProperty("--dot", fillCss(prefs.sticky || "yellow"));
        if (k === "pen") b.style.setProperty("--dot", inkCss(prefs.pen || "ink"));
      });
    }
    function toolClick(k, btn) {
      if (k === "image") return pickImage();
      if (tool === k && ["sticky", "shape", "pen", "line", "arrow"].includes(k)) return toolOptions(k, btn);
      setTool(k);
      if (k === "shape" && innerWidth < 760) toolOptions(k, btn);
    }
    function swatches(list, kind, curC, onPick) {
      return h("div", { class: "bd-sws" }, ...list.map(c => h("button", { class: "bd-sw" + (c === curC ? " on" : "") + (c === "none" ? " none" : ""), title: c === "none" ? "None" : c, style: { "--c": kind === "p" ? fillCss(c) : inkCss(c) }, onclick: () => onPick(c) })));
    }
    function sizes(list, curV, onPick, label = v => v) {
      return h("div", { class: "bd-sizes" }, ...list.map(v => h("button", { class: "bd-size" + (v === curV ? " on" : ""), text: label(v), onclick: () => onPick(v) })));
    }
    function toolOptions(k, btn) {
      let body;
      const close = () => api?.close();
      if (k === "sticky") body = h("div", null, h("div", { class: "menu-sec", text: "Sticky note color" }), swatches(PASTEL.filter(c => c !== "none"), "p", prefs.sticky || "yellow", c => { prefs.sticky = c; savePrefs(); paintTools(); setTool("sticky"); close(); }));
      else if (k === "shape") body = h("div", null, h("div", { class: "menu-sec", text: "Shape" }),
        h("div", { class: "bd-sizes" }, ...[["rect", "Rectangle (R)"], ["ellipse", "Ellipse (O)"], ["diamond", "Diamond (D)"]].map(([s, l]) => h("button", { class: "bd-size bd-shapeopt" + (s === shapeKind ? " on" : ""), title: l, html: ico(IC[s]), onclick: () => { shapeKind = s; setTool("shape"); close(); } }))),
        h("div", { class: "menu-sec", text: "Fill" }), swatches(PASTEL, "p", prefs.shapeFill || "blue", c => { prefs.shapeFill = c; savePrefs(); setTool("shape"); close(); }));
      else if (k === "pen") body = h("div", null, h("div", { class: "menu-sec", text: "Pen color" }), swatches(INKS.filter(c => c !== "none"), "i", prefs.pen || "ink", c => { prefs.pen = c; savePrefs(); paintTools(); }),
        h("div", { class: "menu-sec", text: "Thickness" }), sizes([2, 3, 5, 8, 14], prefs.penSize || 3, v => { prefs.penSize = v; savePrefs(); close(); }, v => h("span", { class: "bd-dotsz", style: { width: v + 2 + "px", height: v + 2 + "px" } })));
      else body = h("div", null, h("div", { class: "menu-sec", text: "Line color" }), swatches(INKS.filter(c => c !== "none"), "i", prefs.lineColor || "ink", c => { prefs.lineColor = c; savePrefs(); }),
        h("div", { class: "menu-sec", text: "Thickness" }), sizes([1, 2, 4, 6], prefs.lineW || 2, v => { prefs.lineW = v; savePrefs(); close(); }, v => v + "px"));
      const api = UI.popover(btn, h("div", { class: "bd-opts" }, body), { align: "start" });
    }

    /* ----- contextual mini toolbar ----- */
    function hideCtx(v) { ctxHidden = v; if (v && ctxEl) ctxEl.classList.remove("on"); else scheduleUi(); }
    function updateCtx() {
      if (!ctxEl) return;
      const items = [...sel].map(k => E.get(k)).filter(Boolean);
      if (!items.length || ctxHidden || editing || present || drag) { ctxEl.classList.remove("on"); return; }
      const key = items.map(e => e.id + "~" + ck(e)).join(";");
      if (key !== ctxKey) { ctxKey = key; buildCtx(items); }
      if (!ctxEl.children.length) { ctxEl.classList.remove("on"); return; }
      const B = union(items.map(e => bbox(e, cur))), sx = V.x + B.x * V.z, sy = V.y + B.y * V.z, sw = B.w * V.z, sh = B.h * V.z;
      const W = wrap.clientWidth, H = wrap.clientHeight, cw = ctxEl.offsetWidth, chh = ctxEl.offsetHeight;
      const left = clamp(sx + sw / 2 - cw / 2, 8, Math.max(8, W - cw - 8));
      let top = sy - chh - 40;
      if (top < 62) top = sy + sh + 18;
      top = clamp(top, 62, Math.max(62, H - chh - (innerWidth < 760 ? 80 : 12)));
      ctxEl.style.transform = `translate(${f1(left)}px, ${f1(top)}px)`;
      ctxEl.classList.add("on");
    }
    function buildCtx(items) {
      const one = items.length === 1 ? items[0] : null, B = [];
      const btn = (html, title, fn, on) => h("button", { class: "bd-cb" + (on ? " on" : ""), title, "aria-label": title, html, onclick: ev => fn(ev.currentTarget) });
      const pop = (anchor, ...kids) => UI.popover(anchor, h("div", { class: "bd-opts" }, ...kids), { align: "start" });
      const ids = arr => arr.map(e => e.id);
      const allLocked = items.every(e => e.locked);
      if (one && lockedByOther(one)) B.push(h("span", { class: "bd-cb-note", text: "✏️ " + Data.person(one.lockedBy).name.split(" ")[0] + " is editing" }));
      if (editable && !allLocked) {
        const fills = items.filter(e => ["sticky", "shape", "frame"].includes(e.type)), inks = items.filter(e => ["text", "pen", "line", "arrow"].includes(e.type));
        if (fills.length) {
          const c0 = fills[0].color ?? DEF[fills[0].type].color, noneOk = fills.some(e => e.type !== "sticky");
          B.push(btn(`<span class="bd-swdot" style="--c:${fillCss(c0)}"></span>`, "Color", a => pop(a, h("div", { class: "menu-sec", text: "Color" }), swatches(noneOk ? PASTEL : PASTEL.filter(c => c !== "none"), "p", c0, c => { UI.closePops(); setField(ids(fills), { color: c }); }), customColor(c => setField(ids(fills), { color: c })))));
        }
        if (inks.length) {
          const c0 = inks[0].color || "ink";
          B.push(btn(`<span class="bd-swdot ring" style="--c:${inkCss(c0)}"></span>`, "Line and text color", a => pop(a, h("div", { class: "menu-sec", text: "Color" }), swatches(INKS.filter(c => c !== "none"), "i", c0, c => { UI.closePops(); setField(ids(inks), { color: c }); }), customColor(c => setField(ids(inks), { color: c })))));
        }
        const shapes = items.filter(e => e.type === "shape");
        if (shapes.length) {
          const s0 = shapes[0];
          B.push(btn(ico(IC[s0.shape || "rect"]), "Shape and border", a => pop(a,
            h("div", { class: "menu-sec", text: "Shape" }), h("div", { class: "bd-sizes" }, ...["rect", "ellipse", "diamond"].map(s => h("button", { class: "bd-size bd-shapeopt" + ((s0.shape || "rect") === s ? " on" : ""), html: ico(IC[s]), onclick: () => { UI.closePops(); setField(ids(shapes), { shape: s }); } }))),
            h("div", { class: "menu-sec", text: "Border" }), swatches(INKS, "i", s0.stroke || "blue", c => { UI.closePops(); setField(ids(shapes), { stroke: c, sw: c === "none" ? 0 : (s0.sw || 2) }); }),
            sizes([0, 1, 2, 4, 6], +(s0.sw ?? 2), v => { UI.closePops(); setField(ids(shapes), { sw: v }); }, v => v ? v + "px" : "None"))));
        }
        const texts = items.filter(e => ["sticky", "text", "shape"].includes(e.type));
        if (texts.length) {
          const t0 = texts[0], fs0 = +t0.fs || DEF[t0.type].fs;
          B.push(btn(`<span class="bd-aa">Aa</span>`, "Text", a => pop(a,
            h("div", { class: "menu-sec", text: "Font size" + (texts.some(e => e.type === "sticky") ? " (notes shrink long text to fit)" : "") }),
            sizes([12, 14, 16, 18, 20, 24, 32, 40, 48, 64, 96], fs0, v => { UI.closePops(); setField(ids(texts), { fs: v }); }),
            h("div", { class: "bd-row" }, h("button", { class: "bd-size" + (t0.bold ? " on" : ""), html: "<b>B</b> Bold", onclick: () => { UI.closePops(); setField(ids(texts), { bold: !t0.bold }); } })),
            shapes.length ? h("div", { class: "menu-sec", text: "Text color in shapes" }) : null,
            shapes.length ? swatches(INKS.filter(c => c !== "none"), "i", shapes[0].tc || "ink", c => { UI.closePops(); setField(ids(shapes), { tc: c }); }) : null)));
        }
        const lines = items.filter(isLine);
        if (lines.length) {
          const l0 = lines[0];
          B.push(btn(ico(l0.type === "arrow" ? IC.arrow : IC.line), "Line style", a => pop(a,
            h("div", { class: "menu-sec", text: "Thickness" }), sizes([1, 2, 4, 6, 10], +l0.sw || 2, v => { UI.closePops(); setField(ids(lines), { sw: v }); }, v => v + "px"),
            h("div", { class: "menu-sec", text: "Style" }),
            h("div", { class: "bd-sizes" },
              h("button", { class: "bd-size" + (l0.type === "arrow" ? " on" : ""), text: "Arrow", onclick: () => { UI.closePops(); setField(ids(lines), { type: l0.type === "arrow" ? "line" : "arrow" }); } }),
              h("button", { class: "bd-size" + (l0.dash ? " on" : ""), text: "Dashed", onclick: () => { UI.closePops(); setField(ids(lines), { dash: !l0.dash }); } }),
              h("button", { class: "bd-size" + (l0.curve ? " on" : ""), text: "Curved", onclick: () => { UI.closePops(); setField(ids(lines), { curve: !l0.curve }); } })))));
        }
        const pens = items.filter(e => e.type === "pen");
        if (pens.length) B.push(btn(`<span class="bd-dotsz" style="width:${Math.min(14, (+pens[0].sw || 3) + 2)}px;height:${Math.min(14, (+pens[0].sw || 3) + 2)}px"></span>`, "Thickness", a => pop(a,
          h("div", { class: "menu-sec", text: "Thickness" }), sizes([2, 3, 5, 8, 14], +pens[0].sw || 3, v => { UI.closePops(); setField(ids(pens), { sw: v }); }, v => h("span", { class: "bd-dotsz", style: { width: v + 2 + "px", height: v + 2 + "px" } })))));
        if (B.length) B.push(h("span", { class: "bd-cb-sep" }));
      }
      if (one) B.push(btn(ico(IC.comment) + ((one.comments || []).length ? `<small>${(one.comments || []).length}</small>` : ""), "Comments", a => openComments(one.id, a)));
      if (one?.type === "sticky") B.push(btn(ico(IC.vote) + ((one.votes || []).length ? `<small>${(one.votes || []).length}</small>` : ""), (one.votes || []).includes(me) ? "Remove my vote" : "Vote", () => toggleVote(one.id), (one.votes || []).includes(me)));
      if (editable) {
        if (!allLocked) B.push(btn(ico(IC.front), "Bring to front", () => zorder(true)), btn(ico(IC.back2), "Send to back", () => zorder(false)), btn(icon("copy"), "Duplicate (Ctrl+D)", dupSel));
        B.push(btn(ico(allLocked ? IC.lock : IC.unlock), allLocked ? "Unlock" : "Lock", toggleLock, allLocked));
        if (!allLocked) B.push(btn(icon("trash"), "Delete (Del)", () => del([...sel])));
        B.push(btn(icon("dots"), "More", a => moreSel(a, items)));
      }
      ctxEl.replaceChildren(...B);
    }
    function customColor(onPick) {
      const inp = h("input", { type: "color", class: "bd-custom", title: "Custom color", onchange: () => { UI.closePops(); onPick(inp.value); } });
      return h("label", { class: "bd-custom-row" }, inp, h("span", { text: "Custom color" }));
    }
    function moreSel(anchor, items) {
      const free = items.filter(e => !isLine(e) && !e.locked).length;
      UI.menu(anchor, [
        { label: "Copy", icon: "copy", kbd: "Ctrl+C", onClick: () => { copySel(); UI.toast("Copied. Paste with Ctrl+V"); } },
        clip ? { label: "Paste", icon: "copy", kbd: "Ctrl+V", onClick: () => pasteClip() } : null,
        { label: "Zoom to selection", icon: "expand", kbd: "Shift+2", onClick: fitSel },
        { label: "Export selection as PNG", icon: "download", onClick: () => exportPNG(true) },
        free >= 2 ? { section: "Align" } : null,
        free >= 2 ? { label: "Align left", onClick: () => align("left") } : null,
        free >= 2 ? { label: "Align centers", onClick: () => align("center") } : null,
        free >= 2 ? { label: "Align right", onClick: () => align("right") } : null,
        free >= 2 ? { label: "Align top", onClick: () => align("top") } : null,
        free >= 2 ? { label: "Align middles", onClick: () => align("middle") } : null,
        free >= 2 ? { label: "Align bottom", onClick: () => align("bottom") } : null,
        free >= 3 ? { label: "Distribute horizontally", onClick: () => align("hdist") } : null,
        free >= 3 ? { label: "Distribute vertically", onClick: () => align("vdist") } : null,
      ], { align: "start" });
    }

    /* ----- minimap ----- */
    let css0 = null;
    const resolve = (c, kind) => {
      css0 ||= getComputedStyle(root);
      if (kind === "paper") return css0.getPropertyValue("--bd-paper").trim() || "#fff";
      if (kind === "fline") return css0.getPropertyValue("--bd-fline").trim() || "#ccc";
      if (kind === "muted") return css0.getPropertyValue("--bd-muted").trim() || "#888";
      c = okC(c, kind === "p" ? "yellow" : "ink");
      if (c === "none") return "transparent";
      if (c[0] === "#") return c;
      return css0.getPropertyValue((kind === "p" ? "--bd-p-" : "--bd-") + c).trim() || "#888";
    };
    function drawMapSoon() {
      const now = performance.now();
      if (now - mapLast > 120) { mapLast = now; drawMap(); }
      else { clearTimeout(mapTO); mapTO = setTimeout(() => { mapLast = performance.now(); drawMap(); }, 140); }
    }
    function drawMap() {
      if (!mapEl || mapEl.classList.contains("off") || !mapEl.offsetParent) return;
      const W = mapEl.clientWidth, H = mapEl.clientHeight, dpr = devicePixelRatio || 1;
      if (!W || !H) return;
      if (mapCv.width !== Math.round(W * dpr) || mapCv.height !== Math.round(H * dpr)) { mapCv.width = Math.round(W * dpr); mapCv.height = Math.round(H * dpr); }
      const ctx = mapCv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const vr = viewRect(), list = [...E.values()].sort((a, b) => (a.z || 0) - (b.z || 0)).map(e => [e, bbox(e, cur)]);
      const B0 = union([vr, ...list.map(x => x[1])]), pad = Math.max(B0.w, B0.h) * .06;
      const B = { x: B0.x - pad, y: B0.y - pad, w: B0.w + pad * 2, h: B0.h + pad * 2 };
      const s = Math.min(W / B.w, H / B.h), ox = (W - B.w * s) / 2 - B.x * s, oy = (H - B.h * s) / 2 - B.y * s;
      mapT = { s, ox, oy };
      list.forEach(([e, b]) => {
        const x = ox + b.x * s, y = oy + b.y * s, w = Math.max(1.5, b.w * s), hh = Math.max(1.5, b.h * s);
        if (e.type === "frame") { ctx.strokeStyle = resolve(null, "muted"); ctx.lineWidth = 1; ctx.strokeRect(x, y, w, hh); return; }
        if (isLine(e) || e.type === "pen") {
          ctx.strokeStyle = resolve(e.color || "ink", "i"); ctx.lineWidth = 1; ctx.beginPath();
          if (isLine(e)) { const [a, c] = ends(e, cur); ctx.moveTo(ox + a[0] * s, oy + a[1] * s); ctx.lineTo(ox + c[0] * s, oy + c[1] * s); } else ctx.rect(x, y, w, hh);
          ctx.stroke(); return;
        }
        ctx.globalAlpha = e.type === "text" ? .45 : 1;
        ctx.fillStyle = e.type === "text" ? resolve(e.color || "ink", "i") : e.type === "image" ? resolve("gray", "i") : resolve(e.color ?? DEF[e.type]?.color, "p");
        ctx.fillRect(x, y, w, hh); ctx.globalAlpha = 1;
      });
      const accent = (css0 || getComputedStyle(root)).getPropertyValue("--accent").trim() || "#7c5cff";
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.fillStyle = accent; ctx.globalAlpha = .1;
      ctx.fillRect(ox + vr.x * s, oy + vr.y * s, vr.w * s, vr.h * s); ctx.globalAlpha = 1;
      ctx.strokeRect(ox + vr.x * s, oy + vr.y * s, vr.w * s, vr.h * s);
    }
    function mapDown(ev) {
      if (!mapT) return;
      ev.preventDefault(); ev.stopPropagation(); cancelAnimationFrame(animRaf);
      const r = mapCv.getBoundingClientRect(), T = { ...mapT };
      const go = e => { const wx = (e.clientX - r.left - T.ox) / T.s, wy = (e.clientY - r.top - T.oy) / T.s; V.x = SW() / 2 - wx * V.z; V.y = SH() / 2 - wy * V.z; applyView(); };
      go(ev);
      try { mapCv.setPointerCapture(ev.pointerId); } catch {}
      const mv = e => go(e), up = () => { mapCv.removeEventListener("pointermove", mv); mapCv.removeEventListener("pointerup", up); mapCv.removeEventListener("pointercancel", up); };
      mapCv.addEventListener("pointermove", mv); mapCv.addEventListener("pointerup", up); mapCv.addEventListener("pointercancel", up);
    }

    /* ----- search ----- */
    function openSearch() { topEl.classList.add("searching"); setTimeout(() => searchIn.focus(), 30); }
    function closeSearch() { searchIn.value = ""; runSearch(""); topEl.classList.remove("searching"); }
    function runSearch(q) {
      q = q.trim().toLowerCase();
      found.forEach(k => nodes.get(k)?.n.classList.remove("bd-found"));
      hits = q ? [...E.values()].filter(e => String(e.text || "").toLowerCase().includes(q)).sort((a, b) => a.y - b.y || a.x - b.x).map(e => e.id) : [];
      found = new Set(hits); found.forEach(k => nodes.get(k)?.n.classList.add("bd-found"));
      hitI = 0; searchCount.textContent = q ? (hits.length ? `1/${hits.length}` : "No results") : "";
      if (hits.length) focusHit();
    }
    function focusHit() {
      const e = E.get(hits[hitI]); if (!e) return;
      searchCount.textContent = `${hitI + 1}/${hits.length}`;
      const b = bbox(e, cur), z = clamp(Math.max(V.z, .8), .1, 2);
      animateView({ z, x: SW() / 2 - (b.x + b.w / 2) * z, y: SH() / 2 - (b.y + b.h / 2) * z });
      sel = new Set([e.id]); scheduleUi();
    }
    const stepHit = d => { if (!hits.length) return; hitI = (hitI + d + hits.length) % hits.length; focusHit(); };

    /* ----- export ----- */
    const exportItems = onlySel => onlySel && sel.size ? [...sel].map(k => E.get(k)).filter(Boolean) : [...E.values()];
    const fname = () => String(board?.name || "board").replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 60) || "board";
    function sceneFor(onlySel) {
      const list = exportItems(onlySel); if (!list.length) { UI.toast("Nothing to export yet"); return null; }
      css0 = getComputedStyle(root);
      return sceneSVG(list, cur, resolve, { bg: css0.getPropertyValue("--bd-canvas").trim() || "#ffffff" });
    }
    function exportSVG(onlySel) { const s = sceneFor(onlySel); if (s) download(new Blob([s.svg], { type: "image/svg+xml" }), fname() + ".svg"); }
    async function exportPNG(onlySel) {
      const s = sceneFor(onlySel); if (!s) return;
      try {
        const url = URL.createObjectURL(new Blob([s.svg], { type: "image/svg+xml;charset=utf-8" })), img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
        const scale = Math.min(2, 8000 / Math.max(s.w, s.h)), cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(s.w * scale)); cv.height = Math.max(1, Math.round(s.h * scale));
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        cv.toBlob(b => b ? download(b, fname() + ".png") : UI.toast("Couldn't make the image. Try SVG instead."), "image/png");
      } catch (e) { console.error(e); UI.toast("Couldn't make the image. Try SVG instead."); }
    }

    /* ----- present mode: step through frames ----- */
    let wasFull = false;
    function startPresent() {
      const frames = [...E.values()].filter(e => e.type === "frame").sort((a, b) => Math.abs(a.y - b.y) > 80 ? a.y - b.y : a.x - b.x);
      if (!frames.length) return UI.toast("Add a frame (F) around what you want to show. Each frame becomes a slide.");
      if (editing) finishEdit();
      present = { ids: frames.map(f => f.id), i: 0 };
      sel = new Set(); UI.closePops(); root.classList.add("bd-presenting");
      wasFull = false;
      try { root.requestFullscreen?.().then(() => { wasFull = true; }).catch(() => {}); } catch {}
      setTimeout(showSlide, 60);
    }
    function showSlide() {
      if (!present) return;
      const f = E.get(present.ids[present.i]);
      if (!f) { present.ids.splice(present.i, 1); if (!present.ids.length) return stopPresent(); present.i = Math.min(present.i, present.ids.length - 1); return showSlide(); }
      presLbl.textContent = `${present.i + 1} / ${present.ids.length} · ${f.text || "Frame"}`;
      animateView(fitRect(bbox(f, cur), 28, 4), 500);
      scheduleUi();
    }
    function step(d) { if (!present) return; present.i = clamp(present.i + d, 0, present.ids.length - 1); showSlide(); }
    function stopPresent(quiet) {
      if (!present) return;
      present = null; root.classList.remove("bd-presenting");
      if (document.fullscreenElement) try { document.exitFullscreen().catch(() => {}); } catch {}
      if (!quiet) setTimeout(() => fitAll(true), 80);
      scheduleUi();
    }
    function onFull() { if (present && wasFull && !document.fullscreenElement) stopPresent(); }

    /* ----- presence: who's on the board now (one write every 30 s, nobody's cursor) ----- */
    function ping() { if (!alive || !ready || document.hidden) return; const b = Data.get(BC, id); if (!b || b.deleted) return; Data.update(BC, id, { viewers: { [me]: Date.now() } }); }
    function drawPresence() {
      if (!presenceEl) return;
      const now = Date.now(), keys = Object.entries(seen).filter(([k, t]) => k !== me && now - (+t || 0) < 70000).map(([k]) => k);
      presenceEl.replaceChildren(...(keys.length ? [Apps.avatars(keys, 26, 4)] : []));
      presenceEl.title = keys.length ? "On this board now: " + keys.map(k => Data.person(k).name).join(", ") : "";
      presenceEl.classList.toggle("on", !!keys.length);
    }
    function tick() {
      drawPresence();
      E.forEach(e => { if (e.lockedBy && e.lockedBy !== me && nodes.get(e.id)?.ck !== ck(e) && !OV.has(e.id)) renderEl(e.id); });
    }
    function paintShare() {
      if (!shareBtn) return;
      const ms = board.members || [];
      shareBtn.replaceChildren(...(ms.length ? [Apps.avatars(ms, 22, 3)] : [h("span", { html: ico(IC.users) }), h("span", { class: "bd-hide-sm", text: "Everyone" })]));
      shareBtn.title = ms.length ? "Members: " + ms.map(k => Data.person(k).name).join(", ") : "Everyone in the workspace can open this board";
    }
    function setBg() { ["dots", "grid", "plain"].forEach(b => stage.classList.toggle("bd-bg-" + b, (board.bg || "dots") === b)); applyView(); }

    /* ----- header, toolbars ----- */
    function buildChrome() {
      const noFocus = el => { el.addEventListener("mousedown", e => { if (!e.target.closest("input, textarea")) e.preventDefault(); }); return el; };
      iconBtn = h("button", { class: "bd-tb-ic", title: editable ? "Change icon" : "", text: board.icon || "🧑‍🎨", onclick: () => { if (editable) UI.emojiPicker(iconBtn, x => { if (x) Data.update(BC, id, { icon: x }); }); } });
      nameIn = h("input", { class: "bd-tb-name", value: board.name || "", maxlength: 120, "aria-label": "Board name", readonly: !editable,
        onchange: () => { const v = nameIn.value.trim(); if (v && v !== board.name) Data.update(BC, id, { name: v }); else nameIn.value = board.name || ""; },
        onkeydown: e => { e.stopPropagation(); if (e.key === "Enter" || e.key === "Escape") nameIn.blur(); } });
      presenceEl = h("div", { class: "bd-presence" });
      searchIn = h("input", { class: "bd-search-in", placeholder: "Search on this board…", oninput: () => runSearch(searchIn.value),
        onkeydown: e => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); stepHit(e.shiftKey ? -1 : 1); } if (e.key === "Escape") closeSearch(); } });
      searchCount = h("span", { class: "bd-search-n" });
      const searchBox = h("div", { class: "bd-search" }, h("span", { class: "bd-search-ic", html: ico(IC.search) }), searchIn, searchCount,
        h("button", { class: "icon-btn xs", title: "Previous", html: ico(IC.up), onclick: () => stepHit(-1) }), h("button", { class: "icon-btn xs", title: "Next", html: ico(IC.down), onclick: () => stepHit(1) }),
        h("button", { class: "icon-btn xs", title: "Close search", html: ico(IC.x), onclick: closeSearch }));
      shareBtn = h("button", { class: "chip-btn bd-share", onclick: () => { if (editable) editBoard(board); else UI.toast("You can view this board but not change its settings"); } });
      voteBtn = h("button", { class: "icon-btn", title: "Voting: show vote buttons on every sticky note", html: ico(IC.vote), onclick: () => {
        voting = !voting; voteBtn.classList.toggle("bd-on", voting);
        E.forEach(e => { if (e.type === "sticky") renderEl(e.id); });
        if (voting) UI.toast("👍 Voting is on: tap 👍 on a note to vote. Counts are shared with everyone.");
      } });
      topEl = noFocus(h("div", { class: "bd-top glass-strong" },
        h("button", { class: "icon-btn", title: "All boards", html: ico(IC.back), onclick: () => Apps.go("boards") }),
        iconBtn, nameIn, presenceEl, h("span", { class: "grow" }), searchBox,
        h("button", { class: "icon-btn bd-search-btn", title: "Search (Ctrl+F)", html: ico(IC.search), onclick: openSearch }),
        voteBtn, shareBtn,
        h("button", { class: "icon-btn", title: "Present frames", html: ico(IC.play), onclick: startPresent }),
        h("button", { class: "icon-btn", title: "More", html: icon("dots"), onclick: e => boardMenu(e.currentTarget) })));

      toolsEl = noFocus(h("div", { class: "bd-tools glass-strong" }, ...TOOLS.filter(t => editable || t[0] === "select" || t[0] === "hand").map(([k, label, kb]) =>
        h("button", { class: "bd-tool" + (k === "sticky" || k === "pen" ? " dot" : ""), dataset: { tool: k }, title: `${label} (${kb})`, "aria-label": label, html: toolIcon(k), onclick: e => toolClick(k, e.currentTarget) }))));
      undoBtn = h("button", { class: "icon-btn", title: "Undo (Ctrl+Z)", html: ico(IC.undo), onclick: undo, disabled: true });
      redoBtn = h("button", { class: "icon-btn", title: "Redo (Ctrl+Shift+Z)", html: ico(IC.redo), onclick: redo, disabled: true });
      zoomLbl = h("button", { class: "bd-zlbl", title: "Zoom", text: "100%", onclick: e => UI.menu(e.currentTarget, [
        { label: "Zoom to fit", kbd: "Shift+1", onClick: () => fitAll(true) }, { label: "50%", onClick: () => zoomTo(.5) }, { label: "100%", kbd: "Ctrl+0", onClick: () => zoomTo(1) }, { label: "200%", onClick: () => zoomTo(2) },
      ]) });
      zoomEl = noFocus(h("div", { class: "bd-zoom glass-strong" }, editable ? undoBtn : null, editable ? redoBtn : null, editable ? h("span", { class: "bd-cb-sep" }) : null,
        h("button", { class: "icon-btn bd-zbtn", title: "Zoom out (Ctrl −)", html: ico(IC.minus), onclick: () => zoomBy(1 / 1.25) }), zoomLbl,
        h("button", { class: "icon-btn bd-zbtn", title: "Zoom in (Ctrl +)", html: ico(IC.plus), onclick: () => zoomBy(1.25) }),
        h("button", { class: "icon-btn", title: "Zoom to fit (Shift+1)", html: ico(IC.fit), onclick: () => fitAll(true) }),
        h("button", { class: "icon-btn bd-mapbtn", title: "Minimap", html: ico(IC.map), onclick: () => { prefs.map = mapEl.classList.toggle("off") ? false : true; savePrefs(); drawMap(); } })));
      mapCv = h("canvas", { class: "bd-mapcv" });
      mapCv.addEventListener("pointerdown", mapDown);
      mapEl = h("div", { class: "bd-map glass-strong" + (prefs.map === false || (prefs.map == null && innerWidth < 760) ? " off" : "") }, mapCv);
      ctxEl = noFocus(h("div", { class: "bd-ctx glass-strong" }));
      presLbl = h("span", { class: "bd-pres-l" });
      presEl = noFocus(h("div", { class: "bd-pres glass-strong" },
        h("button", { class: "icon-btn", title: "Previous (←)", html: ico(IC.prev), onclick: () => step(-1) }), presLbl,
        h("button", { class: "icon-btn", title: "Next (→)", html: ico(IC.next), onclick: () => step(1) }),
        h("button", { class: "btn", text: "Exit", onclick: () => stopPresent() })));
      wrap.append(topEl, toolsEl, zoomEl, mapEl, ctxEl, presEl);
      paintTools(); paintShare();
    }
    function boardMenu(anchor) {
      const bg = board.bg || "dots";
      UI.menu(anchor, [
        { section: "Export" },
        { label: "Export as PNG", icon: "download", onClick: () => exportPNG(false) },
        { label: "Export as SVG", icon: "download", onClick: () => exportSVG(false) },
        sel.size ? { label: "Export selection as PNG", icon: "download", onClick: () => exportPNG(true) } : null,
        editable ? { section: "Background" } : null,
        ...(editable ? [["dots", "Dots"], ["grid", "Grid"], ["plain", "Plain"]].map(([k, l]) => ({ label: (bg === k ? "✓ " : "") + l, onClick: () => Data.update(BC, id, { bg: k }) })) : []),
        { sep: true },
        { label: "Zoom to fit", iconHtml: ico(IC.fit), kbd: "Shift+1", onClick: () => fitAll(true) },
        { label: "Present frames", iconHtml: ico(IC.play), onClick: startPresent },
        { label: "Keyboard shortcuts", iconHtml: ico(IC.select), onClick: shortcuts },
        editable ? { sep: true } : null,
        editable ? { label: "Board settings", iconHtml: ico(IC.users), onClick: () => editBoard(board) } : null,
        editable ? { label: "Duplicate board", icon: "copy", onClick: () => duplicateBoard(board) } : null,
        editable ? { label: "Move to trash", icon: "trash", danger: true, onClick: async () => { if (await UI.confirm(`Move “${board.name || "Untitled board"}” to the trash? You can restore it from Boards → Trash.`, "Move to trash")) { trashBoard(board); Apps.go("boards"); } } } : null,
      ], { align: "end" });
    }
    function shortcuts() {
      const rows = [["V", "Select"], ["H or Space + drag", "Pan"], ["N", "Sticky note"], ["T", "Text"], ["R · O · D", "Rectangle · ellipse · diamond"], ["L · A", "Line · arrow (drag from a shape to connect)"],
        ["P · E", "Pen · eraser"], ["I", "Image (or paste / drop one)"], ["F", "Frame"], ["Double-click", "Edit text"], ["Ctrl+Z · Ctrl+Shift+Z", "Undo · redo"], ["Ctrl+C · Ctrl+V · Ctrl+D", "Copy · paste · duplicate"],
        ["Del", "Delete"], ["Arrows (Shift = 10px)", "Nudge"], ["Ctrl + wheel or pinch", "Zoom"], ["Shift+1 · Shift+2", "Zoom to fit · to selection"], ["Ctrl+F", "Search"]];
      const m = UI.modal("Keyboard shortcuts", h("div", { class: "bd-keys" }, ...rows.map(([k, l]) => h("div", { class: "bd-key" }, h("kbd", { text: k }), h("span", { text: l })))));
      m.el.style.width = "520px";
    }

    /* ----- start, live board doc, cleanup ----- */
    let pingT = 0, tickT = 0;
    function showMissing(msg) {
      ready = false; loading.remove();
      wrap.replaceChildren(h("div", { class: "bd-missing" }, Apps.empty("🧭", msg || "This board doesn't exist or was deleted.", h("button", { class: "btn primary", text: "All boards", onclick: () => Apps.go("boards") }))));
    }
    function init() {
      if (board.deleted) return showMissing("This board is in the trash. Restore it from Boards → Trash.");
      if (!visible(board)) return showMissing("You're not a member of this board. Ask its owner to add you.");
      ready = true; clearTimeout(notFoundT); loading.remove();
      buildChrome();
      Object.entries(board.viewers || {}).forEach(([k, t]) => { seen[k] = t; });
      setBg();
      const saved = loadView();
      if (saved) { Object.assign(V, saved); fittedOnce = true; }
      else Object.assign(V, { x: SW() / 2, y: SH() / 2, z: 1 });
      applyView();
      offs.push(Data.on(EC, onEls));
      offs.push(Data.on("files", onFiles));
      drawPresence(); ping();
      setTimeout(() => { loadedOnce = true; }, 1500);
      pingT = setInterval(ping, 30000); tickT = setInterval(tick, 10000);
      stage.addEventListener("pointerdown", onDown);
      stage.addEventListener("pointermove", onMove);
      stage.addEventListener("pointerup", onUp);
      stage.addEventListener("pointercancel", onCancel);
      stage.addEventListener("wheel", onWheel, { passive: false });
      stage.addEventListener("mousedown", ev => { if (ev.button === 1) ev.preventDefault(); }); // no auto-scroll on middle-button pan
      stage.addEventListener("gesturestart", ev => ev.preventDefault()); // Safari: pinch zooms the board, not the page
      stage.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        if (lastPtr === "touch" || ev.target.closest(".bd-editing")) return;
        ctxMenu(ev.clientX, ev.clientY, ev.target.closest(".bd-el")?.dataset.id || null);
      });
      document.addEventListener("keydown", onKey);
      document.addEventListener("keyup", onKeyUp);
      document.addEventListener("paste", onPaste);
      document.addEventListener("copy", onCopy);
      document.addEventListener("cut", onCopy);
      document.addEventListener("fullscreenchange", onFull);
      addEventListener("blur", onBlurWin);
      if (window.ResizeObserver) { ro = new ResizeObserver(() => { stageR = stage.getBoundingClientRect(); scheduleUi(); }); ro.observe(stage); }
      paintUndo();
    }
    let ro = null;
    function onBlurWin() { spaceDown = false; stage.classList.remove("bd-space"); }
    function onBoard() {
      if (board.deleted) { UI.toast("This board was moved to the trash"); setTimeout(() => Apps.go("boards"), 0); return; }
      if (!visible(board)) { UI.toast("You no longer have access to this board"); setTimeout(() => Apps.go("boards"), 0); return; }
      Object.entries(board.viewers || {}).forEach(([k, t]) => { seen[k] = t; });
      if (document.activeElement !== nameIn) nameIn.value = board.name || "";
      iconBtn.textContent = board.icon || "🧑‍🎨";
      setBg(); drawPresence(); paintShare();
    }

    const offs = [];
    const notFoundT = setTimeout(() => { if (!ready && alive && !board) showMissing(); }, 6000);
    offs.push(Data.on(BC, list => {
      const b = list.find(x => x.id === id);
      if (!b) { if (ready) { UI.toast("This board was deleted"); setTimeout(() => Apps.go("boards"), 0); } return; }
      board = b;
      if (!ready) { if (!wrap.querySelector(".bd-missing")) init(); }
      else onBoard();
    }));

    return () => {
      alive = false;
      try { finishEdit(); } catch {}
      cancelDrag();
      if (present) stopPresent(true);
      offs.forEach(f => f());
      clearInterval(pingT); clearInterval(tickT); clearTimeout(notFoundT); clearTimeout(mapTO); clearTimeout(viewT); clearTimeout(liveT);
      cancelAnimationFrame(uiRaf); cancelAnimationFrame(animRaf);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCopy);
      document.removeEventListener("fullscreenchange", onFull);
      removeEventListener("blur", onBlurWin);
      ro?.disconnect();
      if (ready) {
        saveView();
        const b = Data.get(BC, id);
        if (b && !b.deleted) Data.update(BC, id, { viewers: { [me]: 0 } });
      }
      UI.closePops();
    };
  }

  function render(root, arg) { return arg ? openBoard(root, arg) : renderList(root); }
  Apps.register("boards", { title: "Boards", icon: "🧑‍🎨", render });
})();
