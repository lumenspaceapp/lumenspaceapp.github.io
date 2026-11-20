/* Onboarding wizard: asks how you'll use Lumen, then builds a tailored workspace (like Notion's setup) */
(function () {
  const { h, esc } = UI;
  const ACCENTS = ["#7c5cff", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#64748b"];
  const ICONS = ["✨", "🚀", "🌱", "🧠", "📚", "🎯", "🏡", "⚡", "🎨", "💼", "🎓", "🔥"];
  const Onboarding = { active: false };

  /* opts: { accountStep, user, onGoogle(): Promise<"continue"|"done"|false>, build(answers): Promise } */
  function show(opts) {
    return new Promise(resolve => {
      const a = { name: (opts.user?.displayName || "").trim(), use: "personal", picks: [], wsName: "", icon: "✨",
        accent: Store.local.settings.accent || ACCENTS[0], theme: document.documentElement.dataset.theme || "light" };
      const stage = h("div", { class: "ob-stage" });
      const dots = h("div", { class: "ob-dots" });
      const card = h("div", { class: "ob-card glass-strong" },
        h("button", { class: "icon-btn ob-x", title: "Skip setup", html: UI.icon("x"), onclick: () => finish(null) }), dots, stage);
      const wrap = h("div", { class: "ob" }, h("div", { class: "ob-glow" }), card);
      document.getElementById("layer").append(wrap);
      const steps = [...(opts.accountStep ? [welcome] : []), useStep, picksStep, styleStep];
      let at = -1, done = false;

      function finish(val) {
        if (done) return; done = true;
        if (!val) App.applySettings?.(); // undo the live theme/accent preview when skipped
        wrap.classList.add("out"); setTimeout(() => wrap.remove(), 450); resolve(val);
      }
      function go(i, back) {
        at = i;
        dots.innerHTML = ""; steps.forEach((_, j) => dots.append(h("span", { class: j === at ? "on" : j < at ? "past" : "" })));
        const old = stage.firstElementChild;
        const next = h("div", { class: "ob-step" + (back ? " back" : "") }, steps[i]());
        if (old) { old.classList.add(back ? "leave-back" : "leave"); setTimeout(() => old.remove(), 320); }
        stage.append(next);
        setTimeout(() => next.querySelector("input,button.ob-primary")?.focus(), 380);
      }
      const nav = (nextLabel, onNext, canBack = true) => h("div", { class: "ob-nav" },
        canBack && at > 0 ? h("button", { class: "btn", text: "Back", onclick: () => go(at - 1, true) }) : h("span"),
        h("button", { class: "btn primary ob-primary", text: nextLabel, onclick: onNext }));

      /* step: welcome / account */
      function welcome() {
        const g = h("button", { class: "btn primary ob-primary ob-google", html: `<svg viewBox="0 0 48 48" width="18" height="18"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg> Continue with Google` });
        g.onclick = async () => {
          g.disabled = true; g.lastChild.textContent = " Signing in…";
          const r = await opts.onGoogle();
          if (r === "done") return finish(null);
          if (r) { a.name = a.name || Cloud.user?.displayName || ""; opts.accountStep = false; go(at + 1); }
          else { g.disabled = false; g.lastChild.textContent = " Continue with Google"; }
        };
        return [h("div", { class: "ob-logo" }, "L"),
          h("h1", { text: "Welcome to Lumen" }),
          h("p", { class: "ob-sub", text: "A calm, glassy home for your notes, tasks and docs. Let's set up a workspace that fits you." }),
          h("div", { class: "ob-col" }, g, h("button", { class: "btn ob-ghost", text: "Use without an account", onclick: () => go(at + 1) })),
          h("p", { class: "ob-fine", text: "Signing in lets you sync across devices and invite friends. Without an account, pages stay in this browser." })];
      }

      /* step: how will you use it */
      function useStep() {
        const name = h("input", { class: "ob-input", placeholder: "Your name", value: a.name });
        name.addEventListener("input", () => (a.name = name.value));
        const cards = h("div", { class: "ob-uses" }, ...Object.entries(Templates.USES).map(([k, u]) =>
          h("button", { class: "ob-use" + (a.use === k ? " on" : ""), onclick: e => {
            if (a.use !== k) a.picks = [];
            a.use = k; cards.querySelectorAll(".ob-use").forEach(b => b.classList.toggle("on", b === e.currentTarget));
          } }, h("span", { class: "ob-use-ic", text: u.icon }), h("b", { text: u.label }), h("span", { text: u.desc }))));
        return [h("h2", { text: "How do you want to use Lumen?" }),
          h("p", { class: "ob-sub", text: "This helps us suggest the right pages. You can change everything later." }),
          cards, h("label", { class: "ob-label", text: "What should we call you?" }), name,
          nav("Continue", () => { if (!a.picks.length) a.picks = [...Templates.USES[a.use].defaults]; go(at + 1); })];
      }

      /* step: what for */
      function picksStep() {
        const u = Templates.USES[a.use];
        const grid = h("div", { class: "ob-picks" }, ...u.picks.map((k, i) => {
          const c = Templates.CATALOG[k];
          const b = h("button", { class: "ob-pick" + (a.picks.includes(k) ? " on" : ""), style: { animationDelay: i * 40 + "ms" }, onclick: () => {
            a.picks = a.picks.includes(k) ? a.picks.filter(x => x !== k) : [...a.picks, k];
            b.classList.toggle("on", a.picks.includes(k)); count.textContent = label();
          } }, h("span", { class: "ob-pick-ic", text: c.icon }), h("span", { text: c.label }), h("span", { class: "ob-check", text: "✓" }));
          return b;
        }));
        const label = () => a.picks.length ? `${a.picks.length} page${a.picks.length > 1 ? "s" : ""} will be created` : "Pick at least one";
        const count = h("div", { class: "ob-count", text: label() });
        return [h("h2", { text: "What will you use it for?" }), h("p", { class: "ob-sub", text: "Pick as many as you like. Each one becomes a ready-to-use page." }),
          grid, count, nav("Continue", () => { if (!a.picks.length) return count.classList.add("shake"), setTimeout(() => count.classList.remove("shake"), 500); go(at + 1); })];
      }

      /* step: make it yours + live preview */
      function styleStep() {
        const first = (a.name || "").trim().split(" ")[0];
        if (!a.wsName) a.wsName = a.use === "team" ? "Team Workspace" : a.use === "school" ? "School" : first ? `${first}'s Workspace` : "My Workspace";
        const prevName = h("b", { text: a.wsName }), prevLogo = h("span", { class: "ob-prev-logo", text: a.icon });
        const ws = h("input", { class: "ob-input", value: a.wsName });
        ws.addEventListener("input", () => { a.wsName = ws.value; prevName.textContent = ws.value || "Untitled"; });
        const icons = h("div", { class: "ob-icons" }, ...ICONS.map(ic => h("button", { class: a.icon === ic ? "on" : "", text: ic, onclick: e => {
          a.icon = ic; prevLogo.textContent = ic; icons.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); } })));
        const accents = h("div", { class: "accents" }, ...ACCENTS.map(c => h("button", { class: a.accent === c ? "on" : "", style: { background: c, color: c }, onclick: e => {
          a.accent = c; document.documentElement.style.setProperty("--accent", c); accents.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); } })));
        const theme = h("div", { class: "seg" }, ...[["light", "☀️ Light"], ["dark", "🌙 Dark"]].map(([v, l]) => h("button", { class: a.theme === v ? "on" : "", text: l, onclick: e => {
          a.theme = v; document.documentElement.dataset.theme = v; theme.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget)); } })));
        const preview = h("div", { class: "ob-prev glass" },
          h("div", { class: "ob-prev-head" }, prevLogo, prevName),
          h("div", { class: "ob-prev-row on" }, "👋 Getting Started"),
          ...a.picks.map((k, i) => h("div", { class: "ob-prev-row", style: { animationDelay: 80 + i * 60 + "ms" } }, `${Templates.CATALOG[k].icon} ${Templates.CATALOG[k].label}`)));
        const build = h("button", { class: "btn primary ob-primary", text: "Set up my workspace ✨" });
        build.onclick = () => buildStep();
        return [h("h2", { text: "Make it yours" }),
          h("div", { class: "ob-split" },
            h("div", null,
              h("label", { class: "ob-label", text: "Workspace name" }), ws,
              h("label", { class: "ob-label", text: "Icon" }), icons,
              h("label", { class: "ob-label", text: "Accent colour" }), accents,
              h("label", { class: "ob-label", text: "Theme" }), theme),
            preview),
          h("div", { class: "ob-nav" }, h("button", { class: "btn", text: "Back", onclick: () => go(at - 1, true) }), build)];
      }

      /* final: animated build */
      async function buildStep() {
        dots.style.visibility = "hidden"; card.querySelector(".ob-x").style.display = "none";
        const items = ["Creating your workspace", "Adding Getting Started", ...a.picks.map(k => "Setting up " + Templates.CATALOG[k].label), "Applying your style"];
        const list = h("div", { class: "ob-build" }, ...items.map(t => h("div", { class: "ob-bi" }, h("span", { class: "ob-spin" }), h("span", { text: t }))));
        const old = stage.firstElementChild; old?.classList.add("leave"); setTimeout(() => old?.remove(), 320);
        stage.append(h("div", { class: "ob-step" }, h("h2", { text: "Building your workspace…" }), list));
        const work = Promise.resolve().then(() => opts.build({ ...a, wsName: (a.wsName || "My Workspace").trim() })).catch(e => { console.error(e); UI.toast("Setup failed: " + e.message); });
        const rows = [...list.children];
        for (const r of rows) { r.classList.add("doing"); await new Promise(z => setTimeout(z, 380)); r.classList.add("done"); }
        await work;
        stage.lastElementChild.replaceChildren(h("div", { class: "ob-done" }, h("div", { class: "ob-burst", text: a.icon }), h("h2", { text: "You're all set!" }),
          h("p", { class: "ob-sub", text: `“${a.wsName}” is ready with ${a.picks.length + 1} pages.` })));
        confetti(card);
        setTimeout(() => finish(a), 1500);
      }

      requestAnimationFrame(() => go(0));
    });
  }

  function confetti(host) {
    const colors = ["#7c5cff", "#ec4899", "#f59e0b", "#10b981", "#3b82f6"];
    for (let i = 0; i < 40; i++) {
      const p = h("i", { class: "ob-conf", style: { left: 50 + (Math.random() - .5) * 20 + "%", background: colors[i % colors.length], animationDelay: Math.random() * 120 + "ms" } });
      p.style.setProperty("--dx", (Math.random() - .5) * 520 + "px");
      p.style.setProperty("--dy", -(120 + Math.random() * 260) + "px");
      p.style.setProperty("--r", Math.random() * 720 + "deg");
      host.append(p); setTimeout(() => p.remove(), 1600);
    }
  }

  // apply the chosen look to this device's settings
  function applyLook(a) {
    const s = Store.local.settings;
    s.accent = a.accent; s.theme = a.theme; if (!Store.isCloud) { s.wsName = a.wsName; s.wsIcon = a.icon; }
    Store.save(true);
  }

  /* First visit on this browser: offer an account, then build (cloud if signed in, else local) */
  Onboarding.firstRun = async () => {
    for (let i = 0; i < 30 && !window.Cloud; i++) await new Promise(r => setTimeout(r, 100));
    const cloudOk = !!window.Cloud?.configured;
    Onboarding.active = true;
    try {
      const res = await show({
        accountStep: cloudOk && !Cloud.user, user: window.Cloud?.user,
        onGoogle: async () => {
          if (!(await Cloud.signIn())) return false;
          for (let i = 0; i < 80 && Cloud.listedFor !== Cloud.user?.uid; i++) await new Promise(r => setTimeout(r, 100));
          await Cloud.listed;
          if (Cloud.workspaces.length) { Onboarding.active = false; Cloud.open(Cloud.workspaces[0].id); return "done"; } // returning user
          localStorage.setItem("lumen-onboarded-" + Cloud.user.uid, "1");
          return "continue";
        },
        build: async a => {
          applyLook(a);
          const st = Templates.build(a);
          if (window.Cloud?.user) await Cloud.createFrom(a.wsName, st, a.icon);
          else { Store.local.settings.wsName = a.wsName; Store.local.settings.wsIcon = a.icon; Store.importAll(JSON.stringify(st)); App.onWorkspaceChange(st.root[0]); }
        },
      });
      if (!res) Store.save(true); // skipped: keep the demo workspace
    } finally { Onboarding.active = false; }
  };

  /* Signed in for the first time with no workspaces: build them a cloud workspace */
  Onboarding.newAccount = async user => {
    if (Onboarding.active) return;
    Onboarding.active = true;
    localStorage.setItem("lumen-onboarded-" + user.uid, "1");
    try {
      await show({ accountStep: false, user, build: async a => { applyLook(a); await Cloud.createFrom(a.wsName, Templates.build(a), a.icon); } });
    } finally { Onboarding.active = false; }
  };

  /* Manually: "Create a new workspace…" */
  Onboarding.newWorkspace = () => Onboarding.newAccount(Cloud.user).catch(console.error);

  window.Onboarding = Onboarding;
})();
