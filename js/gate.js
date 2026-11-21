/* Sign-in gate: Lumen can only be used signed in (Google or an emailed sign-in link).
   Shown from the first paint until Firebase says who you are; cloud.js drives it:
   Gate.show("loading" | "signin" | "sent", email?) and Gate.hide(). */
(function () {
  const { h } = UI;
  const required = () => !!window.FIREBASE_CONFIG?.apiKey; // without Firebase (local development) there is nothing to sign in to
  let el = null, state = "";

  function card(...kids) {
    return h("div", { class: "gate-card glass-strong" },
      h("div", { class: "gate-logo" }, h("img", { src: "assets/logo.svg", alt: "Lumen" })), ...kids);
  }
  // "Made by PublishKaro" with their logo, at the bottom of every gate card
  const credit = () => h("a", { class: "pk-credit gate-credit", href: "https://publishkaro.com", target: "_blank", rel: "noopener", title: "Visit PublishKaro" },
    h("img", { src: "assets/publishkaro.svg", alt: "", width: 16, height: 16 }), h("span", {}, "Made by ", h("b", { text: "PublishKaro" })));
  function render(st, email) {
    state = st;
    if (!el) { el = h("div", { class: "gate", role: "dialog", "aria-modal": "true", "aria-label": "Sign in to Lumen" }); document.body.append(el); document.body.classList.add("gated"); }
    if (st === "loading") return el.replaceChildren(card(h("div", { class: "gate-spin" }), h("p", { class: "gate-sub", text: "Opening Lumen…" }), credit()));
    if (st === "sent") return el.replaceChildren(card(
      h("h1", { text: "Check your inbox ✉️" }),
      h("p", { class: "gate-sub" }, "We sent a sign-in link to ", h("b", { text: email || "your email" }), ". Open it on this device to continue."),
      h("p", { class: "gate-fine", text: "Can't find it? Look in spam or promotions. The link works once and expires after a while." }),
      h("button", { class: "btn gate-wide", text: "Use a different email", onclick: () => render("signin") }), credit()));

    const google = h("button", { class: "btn primary gate-wide gate-google", onclick: async () => {
      google.disabled = true; google.lastChild.textContent = " Signing in…";
      const ok = await window.Cloud?.signIn?.();
      if (!ok) { google.disabled = false; google.lastChild.textContent = " Continue with Google"; }
    } }, h("span", { class: "gate-g", html: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.9 1.5l2.6-2.5C16.9 3.3 14.7 2.3 12 2.3 6.6 2.3 2.3 6.6 2.3 12s4.3 9.7 9.7 9.7c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z"/></svg>' }), " Continue with Google");
    const inp = h("input", { class: "menu-input gate-input", type: "email", placeholder: "you@company.com", autocomplete: "email", value: localStorage.getItem("lumen-invite-email") || "" });
    const msg = h("div", { class: "gate-msg" });
    const send = h("button", { class: "btn gate-wide", text: "Email me a sign-in link", onclick: async () => {
      const v = inp.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { msg.textContent = "Enter a valid email address."; inp.focus(); return; }
      send.disabled = true; send.textContent = "Sending…"; msg.textContent = "";
      try { await window.Cloud.emailSignIn(v); render("sent", v); }
      catch (e) { send.disabled = false; send.textContent = "Email me a sign-in link"; msg.textContent = "Couldn't send the link: " + (e.code || e.message); }
    } });
    inp.addEventListener("keydown", e => { if (e.key === "Enter") send.click(); });
    // the last workspace opened on this device switched email-link sign-in off (Settings → Security; cached by js/apps/settings.js)
    const links = localStorage.getItem("lumen-email-links") !== "0";
    el.replaceChildren(card(
      h("h1", { text: "Welcome to Lumen" }),
      h("p", { class: "gate-sub", text: "Your team's tasks, chat, calendar, CRM and files in one place. Sign in to continue." }),
      google,
      links ? h("div", { class: "gate-or" }, h("span", { text: "or" })) : null,
      links ? inp : null, links ? send : null, msg,
      h("p", { class: "gate-fine", text: "Invited by a teammate? Sign in with the email address the invite was sent to." }),
      credit()));
  }

  window.Gate = {
    required,
    get state() { return state; },
    show(st = "signin", email) { if (required()) render(st, email); },
    hide() { if (!el) return; el.classList.add("out"); document.body.classList.remove("gated"); const g = el; el = null; state = ""; setTimeout(() => g.remove(), 380); },
  };
  // cover the app from the very first paint; cloud.js switches to the buttons (or hides it) once sign-in state is known
  if (required()) render("loading");
})();
