/* Receives private-workspace data from the old address (gamerslife1183-bot.github.io/lumen-notes).
   Browsers keep storage per address, so the old page opens this one at #/migrate and posts its saved data here. */
(function () {
  const OLD = "https://gamerslife1183-bot.github.io";
  if (location.hash !== "#/migrate" || !window.opener) return;
  document.documentElement.classList.add("migrating");
  const done = (next) => { location.replace(location.pathname + (next || "#/p/home")); };
  addEventListener("message", e => {
    if (e.origin !== OLD || !e.data || e.data.type !== "lumen-data") return;
    const items = e.data.items || {};
    const hasHere = Object.keys(localStorage).some(k => k === "lumen-notes-v1");
    if (hasHere && !confirm("You already have pages at this new address. Replace them with the pages from the old address?")) {
      window.opener.postMessage({ type: "lumen-done", skipped: true }, OLD); return done(e.data.next);
    }
    for (const [k, v] of Object.entries(items)) if (k.startsWith("lumen-")) { try { localStorage.setItem(k, v); } catch (err) { console.warn(k, err); } }
    window.opener.postMessage({ type: "lumen-done" }, OLD);
    done(e.data.next);
  });
  window.opener.postMessage({ type: "lumen-ready" }, OLD);
})();
