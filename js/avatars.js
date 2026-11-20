/* Avatar presets in Lumen's glassy gradient style. A person's `avatar` is one of these ids,
   "letter" (always show the initial), or "" (use their Google photo if they have one, else the initial). */
(function () {
  const W = "#fff";
  const PRESETS = [
    { id: "spark", name: "Spark", from: "#8b6bff", to: "#f0569b", g: `<path d="M32 13c2.2 10.6 8.4 16.8 19 19-10.6 2.2-16.8 8.4-19 19-2.2-10.6-8.4-16.8-19-19 10.6-2.2 16.8-8.4 19-19z" fill="${W}"/>` },
    { id: "moon", name: "Moon", from: "#6366f1", to: "#22d3ee", g: `<path d="M38 15a18 18 0 1 0 11 30A16 16 0 0 1 38 15z" fill="${W}"/><circle cx="44" cy="22" r="2" fill="${W}"/><circle cx="48" cy="31" r="1.4" fill="${W}"/>` },
    { id: "sun", name: "Sun", from: "#fbbf24", to: "#f472b6", g: `<circle cx="32" cy="32" r="8.5" fill="${W}"/><path d="M32 13v5M32 46v5M13 32h5M46 32h5M18.6 18.6l3.5 3.5M41.9 41.9l3.5 3.5M18.6 45.4l3.5-3.5M41.9 22.1l3.5-3.5" stroke="${W}" stroke-width="3.6" stroke-linecap="round"/>` },
    { id: "leaf", name: "Leaf", from: "#34d399", to: "#06b6d4", g: `<path d="M47 17C27 17 18 28 18 40c0 3 .8 5 2 6.5 2.3-8.2 8.4-14.5 16.4-18.4C29.3 33 24.8 39.3 23 47c4 1.9 8 2.1 11.4 1.1C45.6 44.9 48.3 32.6 47 17z" fill="${W}"/>` },
    { id: "wave", name: "Wave", from: "#38bdf8", to: "#818cf8", g: `<g fill="none" stroke="${W}" stroke-width="4.2" stroke-linecap="round"><path d="M15 27c4.3-4.5 8.6-4.5 13 0s8.6 4.5 13 0 6.6-4 8-4"/><path d="M15 38c4.3-4.5 8.6-4.5 13 0s8.6 4.5 13 0 6.6-4 8-4"/></g>` },
    { id: "bolt", name: "Bolt", from: "#fb923c", to: "#ef4444", g: `<path d="M36 12 19 36h12l-4 16 18-25H33z" fill="${W}" stroke="${W}" stroke-width="1.5" stroke-linejoin="round"/>` },
    { id: "heart", name: "Heart", from: "#fb7185", to: "#c084fc", g: `<path d="M32 48S15 38 15 26.5A9 9 0 0 1 32 22a9 9 0 0 1 17 4.5C49 38 32 48 32 48z" fill="${W}"/>` },
    { id: "planet", name: "Planet", from: "#8b5cf6", to: "#3b82f6", g: `<circle cx="32" cy="32" r="10.5" fill="${W}"/><ellipse cx="32" cy="32" rx="21" ry="6.5" fill="none" stroke="${W}" stroke-width="3" transform="rotate(-22 32 32)"/>` },
    { id: "flower", name: "Flower", from: "#f472b6", to: "#a78bfa", g: `<g fill="${W}"><circle cx="32" cy="21.5" r="7"/><circle cx="42" cy="28.8" r="7"/><circle cx="38.2" cy="40.5" r="7"/><circle cx="25.8" cy="40.5" r="7"/><circle cx="22" cy="28.8" r="7"/></g><circle cx="32" cy="32" r="5" fill="#fde68a"/>` },
    { id: "cloud", name: "Cloud", from: "#60a5fa", to: "#2dd4bf", g: `<path d="M21.5 45h22a8.5 8.5 0 0 0 1.2-16.9A11.5 11.5 0 0 0 22.6 26 9.5 9.5 0 0 0 21.5 45z" fill="${W}"/>` },
    { id: "gem", name: "Gem", from: "#22d3ee", to: "#8b6bff", g: `<path d="M23 18h18l8 10.5L32 49 15 28.5z" fill="${W}"/><path d="M15 28.5h34M27 18l5 31 5-31" fill="none" stroke="#8b6bff" stroke-opacity=".28" stroke-width="1.6" stroke-linejoin="round"/>` },
    { id: "flame", name: "Flame", from: "#f59e0b", to: "#db2777", g: `<path d="M32 12c2.4 8.5 13 12.6 13 24.5a13 13 0 0 1-26 0c0-6.5 3.2-10 6.4-12.8 0 4.4 2 6.6 4.4 6.6-1.1-7.5.1-13 2.2-18.3z" fill="${W}"/>` },
    { id: "smile", name: "Smile", from: "#a3e635", to: "#10b981", g: `<circle cx="24.5" cy="27" r="3.4" fill="${W}"/><circle cx="39.5" cy="27" r="3.4" fill="${W}"/><path d="M22 37c4.6 7 15.4 7 20 0" fill="none" stroke="${W}" stroke-width="4" stroke-linecap="round"/>` },
    { id: "cat", name: "Cat", from: "#1e1b4b", to: "#db2777", g: `<path d="M17 47V20l10 8.5h10L47 20v27a6 6 0 0 1-6 6H23a6 6 0 0 1-6-6z" fill="${W}"/><circle cx="26.5" cy="38" r="2.6" fill="#3b2a6b"/><circle cx="37.5" cy="38" r="2.6" fill="#3b2a6b"/><path d="M30 44.5h4l-2 2z" fill="#f0569b"/>` },
  ];
  const byId = Object.fromEntries(PRESETS.map(p => [p.id, p]));
  let n = 0;
  function svg(id) {
    const p = byId[id]; if (!p) return "";
    const gid = "av" + id + (++n);
    return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.from}"/><stop offset="1" stop-color="${p.to}"/></linearGradient></defs>`
      + `<circle cx="32" cy="32" r="32" fill="url(#${gid})"/><ellipse cx="22" cy="15" rx="19" ry="10" fill="#fff" opacity=".22"/>${p.g}</svg>`;
  }
  window.Avatars = { PRESETS, svg, has: id => !!byId[id] };
})();
