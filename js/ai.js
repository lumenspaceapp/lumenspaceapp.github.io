/* AI helpers (CoPilot-style), powered by the Lumi AI worker (worker/src/index.js → POST /assist).

   Apps.AI = {
     available(place?) → true when window.LUMI_AI_URL is set and someone is signed in (Cloud.user), and the place
                   ("tasks" | "feed" | "crm" | "chat" | "meetings" | "kb") isn't switched off in Settings → AI (Prefs "ai.<place>").
                   Apps show AI actions only when this is true: `if (Apps.AI?.available()) …`.
     TASKS       → the jobs the worker accepts (the prompt for each is built on the server, never here):
                   "task_description"  input: task title              context: current description
                   "task_checklist"    input: task title              context: description / items already there
                   "post_draft"        input: a short idea for a feed post
                   "post_improve"      input: a post to polish
                   "email_draft"       input: what the email is about context: client name, company, stage, recent activity
                   "summarize_chat"    input: transcript, "Name: text" per line, oldest first
                   "summarize_meeting" input: agenda + minutes + decisions context: title and date
                   "reply_suggestions" input: the last message         context: recent conversation   → 3 lines
                   "rewrite"           input: any text, with tone "friendly" | "formal" | "shorter" | "longer" | "fix"
     ask(task, input, { context, tone, onToken, signal, quiet }) → Promise<string>
                   Streams the answer: onToken(chunk, textSoFar) for every piece; resolves with the whole text.
                   Rejects on errors with a friendly toast already shown (err.shown; `quiet: true` skips the toast),
                   when the privacy note is cancelled (err.cancelled) or when `signal` aborts (err.name === "AbortError").
     button(label, run, { place }) → small "✨ label" glass button; hidden when !available(); shows a spinner while run(btn) runs.
     compose({ place, title, task, input, context, tone, onInsert, insertLabel, pick, emptyHint }) → Promise (first answer done)
                   AI panel: streams the answer, tone picker for "rewrite", Regenerate, Copy, Insert (calls onInsert(text);
                   the answer can be edited first) and Cancel. With pick(line), every answer line becomes a button instead.
     lines(text) → the answer split into clean lines (bullets, numbers, checkboxes removed), e.g. for checklists.
     consent()   → Promise<bool>; the one-time privacy note (remembered per device in localStorage).
   } */
(function () {
  const { h } = UI;
  const TASKS = ["task_description", "task_checklist", "post_draft", "post_improve", "email_draft", "summarize_chat", "summarize_meeting", "reply_suggestions", "rewrite"];
  const TONES = [["friendly", "Friendly"], ["formal", "Formal"], ["shorter", "Shorter"], ["longer", "Longer"], ["fix", "Fix spelling"]];
  const MAX = 6000, TAIL = new Set(["summarize_chat"]); // same caps as the worker; chats keep their newest part
  const CONSENT_KEY = "lumen-ai-consent";
  const NOTE = "AI requests send the text you choose to Anthropic's Claude through Lumen's server. Don't include passwords or sensitive personal data.";

  // place: "tasks" | "feed" | "crm" | "chat" | "meetings" | "kb" — false when switched off in Settings → AI
  const placeOn = place => !place || !window.Prefs || Prefs.get("ai." + place) !== false;
  const available = place => !!window.LUMI_AI_URL && !!window.Cloud?.user && placeOn(place);
  const base = () => String(window.LUMI_AI_URL || "").replace(/\/+$/, "");
  const clip = (v, tail) => { const s = String(v ?? "").trim(); return s.length <= MAX ? s : tail ? s.slice(-MAX) : s.slice(0, MAX); };

  /* ---------- one-time privacy note ---------- */
  let okHere = false; // also remembered for this page, in case localStorage is blocked
  const agreed = () => { if (okHere) return true; try { return localStorage.getItem(CONSENT_KEY) === "1"; } catch { return false; } };
  let asking = null;
  function consent() {
    if (agreed()) return Promise.resolve(true);
    if (asking) return asking;
    return (asking = new Promise(res => {
      let ok = false;
      const m = UI.modal("✨ Before you use AI", h("div", { class: "ai-consent" },
        h("p", { text: NOTE }),
        h("div", { class: "ai-foot" }, h("span", { class: "grow" }),
          h("button", { type: "button", class: "btn", text: "Cancel", onclick: () => m.close() }),
          h("button", { type: "button", class: "btn primary", text: "OK", onclick: () => { ok = okHere = true; try { localStorage.setItem(CONSENT_KEY, "1"); } catch {} m.close(); } }))),
        { className: "ai-modal ai-consent-m", onClose: () => { asking = null; res(ok); } });
    }));
  }

  /* ---------- streaming request ---------- */
  function fail(msg, opts, cause) {
    const e = new Error(msg); e.shown = !opts.quiet;
    if (cause) console.warn("Lumen AI:", cause);
    if (!opts.quiet) UI.toast(msg);
    return e;
  }
  const isAbort = e => e?.name === "AbortError";
  async function ask(task, input, opts = {}) {
    if (!TASKS.includes(task)) throw fail("This AI action isn't available.", opts, "unknown task " + task);
    if (!available()) throw fail(window.LUMI_AI_URL ? "Sign in to use AI." : "AI isn't set up on this site yet.", opts);
    if (!(await consent())) { const e = new Error("cancelled"); e.cancelled = true; throw e; }
    if (!navigator.onLine) throw fail("You're offline. Try again when you're connected.", opts);
    const text = clip(input, TAIL.has(task));
    if (!text) throw fail("Write a few words first, then try again.", opts);
    let res;
    try {
      const token = await Cloud.user.getIdToken();
      res = await fetch(base() + "/assist", {
        method: "POST", signal: opts.signal,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ task, input: text, context: clip(opts.context, true), ...(opts.tone ? { tone: opts.tone } : {}) }) });
    } catch (e) {
      if (isAbort(e)) throw e;
      throw fail("Couldn't reach the AI. Check your connection and try again.", opts, e);
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = res.status === 401 ? "Please sign in again to use AI."
        : res.status === 429 ? err.message || "You're asking very fast. Please wait a few minutes."
        : res.status === 403 ? "AI isn't allowed from this address yet. Please tell the site owner."
        : res.status === 400 ? "The AI couldn't use that text. Try something shorter or different."
        : res.status === 404 ? "AI helpers aren't switched on yet. Please tell the site owner."
        : "The AI is unavailable right now. Please try again later.";
      throw fail(msg, opts, err.error || res.status);
    }
    // the worker writes "\u0000message" when something goes wrong after the answer started
    const reader = res.body.getReader(), dec = new TextDecoder();
    let raw = "", shown = 0;
    const visible = () => { const i = raw.indexOf("\u0000"); return i < 0 ? raw : raw.slice(0, i); };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += dec.decode(value, { stream: true });
        const v = visible();
        if (v.length > shown) { const chunk = v.slice(shown); shown = v.length; opts.onToken?.(chunk, v); }
      }
      raw += dec.decode();
    } catch (e) {
      if (isAbort(e)) throw e;
      throw fail("The AI stopped unexpectedly. Please try again.", opts, e);
    }
    const i = raw.indexOf("\u0000");
    if (i >= 0) { const e = fail(raw.slice(i + 1).trim() || "The AI had a problem. Please try again.", opts); e.partial = raw.slice(0, i).trim(); throw e; }
    return raw.trim();
  }

  /* ---------- "✨ label" button ---------- */
  function button(label, run, opts = {}) {
    const b = h("button", { type: "button", class: "ai-btn" + (opts.className ? " " + opts.className : ""), title: opts.title || label, hidden: !available(opts.place) },
      h("span", { class: "ai-ic", text: "✨" }), h("span", { class: "ai-l", text: label }));
    b.addEventListener("click", async e => {
      e.preventDefault();
      if (b.classList.contains("busy")) return;
      b.classList.add("busy"); b.setAttribute("aria-busy", "true");
      try { await run(b); }
      catch (err) { if (!err?.shown && !err?.cancelled && !isAbort(err)) { console.warn("Lumen AI:", err); UI.toast("Something went wrong with AI. Please try again."); } }
      finally { b.classList.remove("busy"); b.removeAttribute("aria-busy"); }
    });
    return b;
  }

  /* answer → clean lines ("- item", "1. item", "[ ] item" → "item") */
  const lines = text => String(text || "").split(/\r?\n/)
    .map(l => l.replace(/^\s*(?:[-*•–]|\d+[.)]|\[[ xX]?\])\s*/, "").replace(/^["“](.*)["”]$/, "$1").trim())
    .filter(Boolean).map(l => l.slice(0, 300));

  /* ---------- AI panel ---------- */
  async function compose(o = {}) {
    const input = String(o.input ?? "").trim();
    if (!input) return UI.toast(o.emptyHint || "Write a few words first, then try again.");
    if (!placeOn(o.place)) return UI.toast("AI is switched off here in Settings → AI.");
    if (!available()) return UI.toast(window.LUMI_AI_URL ? "Sign in to use AI." : "AI isn't set up on this site yet.");
    if (!(await consent())) return;
    const rewrite = o.task === "rewrite";
    let tone = o.tone || (rewrite ? "friendly" : ""), ctrl = null, result = "", closed = false;
    const out = h("div", { class: "ai-out", "aria-live": "polite" });
    const status = h("div", { class: "ai-status" });
    const tones = rewrite ? h("div", { class: "seg ai-tones" }, ...TONES.map(([k, l]) => h("button", { type: "button", class: k === tone ? "on" : "", dataset: { k }, text: l, onclick: () => {
      tone = k; tones.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.k === k)); run();
    } }))) : null;
    const editable = () => (out.getAttribute("contenteditable") || "false") !== "false";
    const current = () => (editable() ? out.innerText : result).trim();
    const regen = h("button", { type: "button", class: "btn", text: "↻ Regenerate", onclick: () => run() });
    const copy = h("button", { type: "button", class: "btn", text: "Copy", onclick: () => {
      const v = current(); if (!v) return;
      (navigator.clipboard?.writeText(v) || Promise.reject()).then(() => UI.toast("📋 Copied"), () => UI.toast("Couldn't copy. Select the text and copy it instead."));
    } });
    const insert = o.onInsert && !o.pick ? h("button", { type: "button", class: "btn primary", text: o.insertLabel || "Insert", onclick: () => {
      const v = current(); if (!v) return; m.close(); o.onInsert(v);
    } }) : null;
    const cancel = h("button", { type: "button", class: "btn", text: insert || o.pick ? "Cancel" : "Close", onclick: () => m.close() });
    const m = UI.modal("✨ " + (o.title || "AI helper"), h("div", { class: "ai-panel" + (o.pick ? " picking" : "") }, tones, out, status,
      h("div", { class: "ai-foot" }, h("small", { class: "ai-note", text: "AI can make mistakes. Check it before you use it." }), h("span", { class: "grow" }), cancel, regen, copy, insert)),
      { className: "ai-modal", onClose: () => { closed = true; ctrl?.abort(); } });
    const setBusy = on => { [regen, copy, insert].forEach(b => b && (b.disabled = on)); out.classList.toggle("streaming", on); };
    const setEditable = on => { if (!on) return out.setAttribute("contenteditable", "false"); try { out.contentEditable = "plaintext-only"; } catch { out.contentEditable = "true"; } };

    async function run() {
      ctrl?.abort();
      const my = ctrl = new AbortController();
      result = ""; setEditable(false); out.classList.remove("err"); out.replaceChildren(); status.textContent = "Writing…"; setBusy(true);
      try {
        result = await ask(o.task, input, { context: o.context, tone: tone || undefined, signal: my.signal, quiet: true,
          onToken: (_, all) => { if (my !== ctrl) return; out.textContent = all; out.scrollTop = out.scrollHeight; } });
        if (my !== ctrl || closed) return;
        if (!result) { status.textContent = "No answer this time. Try Regenerate."; return; }
        status.textContent = o.pick ? "Pick one to use it." : insert ? "You can edit the text before you use it." : "";
        if (o.pick) out.replaceChildren(...lines(result).map(l => h("button", { type: "button", class: "ai-pick", text: l, onclick: () => { m.close(); o.pick(l); } })));
        else { out.textContent = result; setEditable(true); }
      } catch (e) {
        if (my !== ctrl || closed || isAbort(e)) return;
        if (e.cancelled) return m.close();
        out.classList.add("err"); status.textContent = e.message || "Something went wrong. Please try again.";
        if (e.partial) out.textContent = result = e.partial;
      } finally { if (my === ctrl) setBusy(false); }
    }
    return run();
  }

  Apps.AI = { available, TASKS, TONES, ask, button, compose, lines, consent };
})();
