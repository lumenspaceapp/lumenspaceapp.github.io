/* CRM (Bitrix24-style): deals pipeline, leads with conversion, contacts, companies, activity timeline, reports */
(function () {
  const { h, esc } = UI;
  const STAGES = [["new", "New", "gray"], ["qualified", "Qualified", "blue"], ["proposal", "Proposal", "purple"], ["negotiation", "Negotiation", "orange"], ["won", "Won", "green"], ["lost", "Lost", "red"]];
  const LEAD_ST = [["new", "New", "blue"], ["contacted", "Contacted", "purple"], ["qualified", "Qualified", "green"], ["junk", "Junk", "gray"], ["converted", "Converted", "green"]];
  const SOURCES = ["Website", "Referral", "Social media", "Ads", "Cold call", "Event", "Other"];
  const ACT = { call: "📞 Call", meeting: "🤝 Meeting", email: "✉️ Email", note: "📝 Note" };
  const tag = (list, k) => { const s = list.find(x => x[0] === k) || list[0]; return h("span", { class: "tag", dataset: { tc: s[2] }, text: s[1] }); };
  const name = (col, id) => Data.get(col, id)?.name || Data.get(col, id)?.title || "";

  const FIELDS = {
    deals: () => [{ key: "title", label: "Deal name", required: true }, { key: "amount", label: "Amount", type: "number", half: true }, { key: "stage", label: "Stage", type: "select", options: STAGES.map(s => [s[0], s[1]]), half: true },
      { key: "contact", label: "Contact", type: "select", options: [["", "—"], ...Data.list("contacts").map(c => [c.id, c.name])], half: true }, { key: "company", label: "Company", type: "select", options: [["", "—"], ...Data.list("companies").map(c => [c.id, c.name])], half: true },
      { key: "owner", label: "Responsible", type: "person", half: true }, { key: "close", label: "Expected close", type: "date", half: true }, { key: "notes", label: "Notes", type: "textarea", rows: 2 }],
    leads: () => [{ key: "name", label: "Lead name", required: true, placeholder: "Person or opportunity" }, { key: "companyName", label: "Company", half: true }, { key: "source", label: "Source", type: "select", options: SOURCES, half: true },
      { key: "email", label: "Email", type: "email", half: true }, { key: "phone", label: "Phone", type: "tel", half: true }, { key: "status", label: "Status", type: "select", options: LEAD_ST.slice(0, 4).map(s => [s[0], s[1]]), half: true },
      { key: "owner", label: "Responsible", type: "person", half: true }, { key: "value", label: "Potential value", type: "number" }, { key: "notes", label: "Notes", type: "textarea", rows: 2 }],
    contacts: () => [{ key: "name", label: "Full name", required: true }, { key: "position", label: "Position", half: true }, { key: "company", label: "Company", type: "select", options: [["", "—"], ...Data.list("companies").map(c => [c.id, c.name])], half: true },
      { key: "email", label: "Email", type: "email", half: true }, { key: "phone", label: "Phone", type: "tel", half: true }, { key: "owner", label: "Responsible", type: "person" }, { key: "notes", label: "Notes", type: "textarea", rows: 2 }],
    companies: () => [{ key: "name", label: "Company name", required: true }, { key: "industry", label: "Industry", half: true }, { key: "size", label: "Employees", type: "select", options: ["1-10", "11-50", "51-200", "201-1000", "1000+"], half: true },
      { key: "website", label: "Website", half: true }, { key: "phone", label: "Phone", type: "tel", half: true }, { key: "notes", label: "Notes", type: "textarea", rows: 2 }],
  };
  const LABEL = { deals: "deal", leads: "lead", contacts: "contact", companies: "company" };

  async function edit(col, rec = {}, preset = {}) {
    const isNew = !rec.id;
    const v = await Apps.form((isNew ? "New " : "Edit ") + LABEL[col], FIELDS[col](), { owner: Data.me().key, stage: "new", status: "new", ...preset, ...rec },
      isNew ? { ok: "Create" } : { onDelete: () => Data.remove(col, rec.id) });
    if (!v) return null;
    const { id, ...data } = v;
    if (isNew) { const nid = await Data.add(col, { ...data, activities: [] }); if (data.owner) Data.notify(data.owner, `💼 <b>${esc(Data.me().name)}</b> made you responsible for ${LABEL[col]} “${esc(data.title || data.name)}”`, "#/app/crm"); return nid; }
    Data.update(col, rec.id, data); return rec.id;
  }

  /* ---------- record slider with activity timeline ---------- */
  function openRecord(col, id) {
    const body = h("div", { class: "crm-rec" });
    const p = Apps.panel(LABEL[col][0].toUpperCase() + LABEL[col].slice(1), body, [h("button", { class: "btn", text: "Edit", onclick: () => edit(col, Data.get(col, id)) })]);
    const off = Data.on(col, UI.liveDraw(body, draw)); p.onClose = off;
    function draw() {
      const r = Data.get(col, id); if (!r) return p.close();
      const info = [];
      const add = (k, v) => v && info.push(h("span", { text: k }), typeof v === "string" ? h("span", { text: v }) : v);
      if (col === "deals") { add("Amount", Apps.money(r.amount)); add("Stage", tag(STAGES, r.stage)); add("Contact", name("contacts", r.contact)); add("Company", name("companies", r.company)); add("Close date", Apps.fmtDate(r.close)); }
      if (col === "leads") { add("Status", tag(LEAD_ST, r.status)); add("Company", r.companyName); add("Source", r.source); add("Email", r.email); add("Phone", r.phone); add("Value", r.value ? Apps.money(r.value) : ""); }
      if (col === "contacts") { add("Position", r.position); add("Company", name("companies", r.company)); add("Email", r.email); add("Phone", r.phone); }
      if (col === "companies") { add("Industry", r.industry); add("Employees", r.size); add("Website", r.website); add("Phone", r.phone); }
      add("Responsible", h("span", { class: "who" }, Apps.avatar(Data.person(r.owner), 20), Data.person(r.owner).name));
      const related = [];
      if (col === "companies") { Data.list("contacts").filter(c => c.company === id).forEach(c => related.push(h("button", { class: "rel", onclick: () => openRecord("contacts", c.id) }, "👤 " + c.name))); Data.list("deals").filter(d => d.company === id).forEach(d => related.push(h("button", { class: "rel", onclick: () => openRecord("deals", d.id) }, "💼 " + d.title + " · " + Apps.money(d.amount)))); }
      if (col === "contacts") Data.list("deals").filter(d => d.contact === id).forEach(d => related.push(h("button", { class: "rel", onclick: () => openRecord("deals", d.id) }, "💼 " + d.title + " · " + Apps.money(d.amount))));
      const kind = h("select", { class: "chip-in" }, ...Object.entries(ACT).map(([k, l]) => h("option", { value: k }, l)));
      const note = h("textarea", { class: "menu-input f-ta", rows: 2, placeholder: "What happened? (Enter to log)" });
      const log = () => { if (!note.value.trim()) return; Data.update(col, id, { activities: [{ kind: kind.value, text: note.value.trim(), by: Data.me().key, at: Date.now() }, ...(r.activities || [])] }); note.value = ""; note.blur(); setTimeout(draw, 50); };
      note.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); log(); } };
      body.replaceChildren(
        h("div", { class: "peek-title", text: r.title || r.name }),
        col === "deals" ? h("div", { class: "stage-bar" }, ...STAGES.map(([k, l, c]) => h("button", { class: "sb-step" + (r.stage === k ? " on" : "") + (STAGES.findIndex(s => s[0] === r.stage) > STAGES.findIndex(s => s[0] === k) && k !== "lost" ? " past" : ""), dataset: { tc: c }, text: l, onclick: () => setStage(r, k) }))) : null,
        col === "leads" && r.status !== "converted" ? h("button", { class: "btn primary", style: { marginBottom: "12px" }, text: "🔁 Convert to contact + deal", onclick: () => convert(r) }) : null,
        h("div", { class: "td-grid" }, ...info),
        r.notes ? h("div", { class: "crm-notes", text: r.notes }) : null,
        related.length ? h("div", { class: "td-sec", text: "Related" }) : null, ...related,
        h("div", { class: "td-sec", text: "Activity" }),
        h("div", { class: "act-new" }, kind, h("button", { class: "btn", text: "+ Task", title: "Create a follow-up task", onclick: () => Apps.Tasks.newTask({ title: "Follow up: " + (r.title || r.name), desc: `CRM ${LABEL[col]}: ${r.title || r.name}`, deadline: Apps.addDays(Apps.today(), 2) }) })),
        note,
        h("div", { class: "timeline" }, ...(r.activities || []).map(a => h("div", { class: "tl-item" }, h("span", { class: "tl-ic", text: ACT[a.kind]?.slice(0, 2) || "•" }),
          h("div", null, h("div", { class: "cmt-h" }, h("b", { text: ACT[a.kind]?.slice(3) || "Note" }), h("small", { text: Data.person(a.by).name + " · " + UI.timeAgo(a.at) })), h("div", { class: "cmt-t", text: a.text })))),
          h("div", { class: "tl-item" }, h("span", { class: "tl-ic", text: "✨" }), h("div", null, h("div", { class: "cmt-h" }, h("b", { text: "Created" }), h("small", { text: Data.person(r.by).name + " · " + UI.timeAgo(r.at) }))))));
    }
    draw();
  }
  function setStage(d, k) {
    if (d.stage === k) return;
    Data.update("deals", d.id, { stage: k, closedAt: ["won", "lost"].includes(k) ? Date.now() : null, activities: [{ kind: "note", text: `Stage changed to ${STAGES.find(s => s[0] === k)[1]}`, by: Data.me().key, at: Date.now() }, ...(d.activities || [])] });
    if (k === "won") UI.toast(`🏆 Deal won: ${d.title} (${Apps.money(d.amount)})`);
  }
  async function convert(lead) {
    let company = "";
    if (lead.companyName) company = Data.list("companies").find(c => c.name.toLowerCase() === lead.companyName.toLowerCase())?.id || await Data.add("companies", { name: lead.companyName, activities: [] });
    const contact = await Data.add("contacts", { name: lead.name, email: lead.email || "", phone: lead.phone || "", company, owner: lead.owner, activities: [] });
    const deal = await Data.add("deals", { title: (lead.companyName || lead.name) + " deal", amount: lead.value || 0, stage: "qualified", contact, company, owner: lead.owner, activities: [{ kind: "note", text: "Converted from lead (" + (lead.source || "unknown source") + ")", by: Data.me().key, at: Date.now() }] });
    Data.update("leads", lead.id, { status: "converted", deal });
    UI.toast("✅ Lead converted"); openRecord("deals", deal);
  }

  /* ---------- main view ---------- */
  function render(root, arg) {
    let tab = arg || localStorage.getItem("lumen-crm-tab") || "deals", q = "";
    const summary = h("div", { class: "crm-summary" }), body = h("div", { class: "app-body" });
    const search = h("input", { class: "app-search", placeholder: "Search…", oninput: e => { q = e.target.value.toLowerCase(); draw(); } });
    const addBtn = h("button", { class: "btn primary", onclick: () => tab !== "reports" && edit(tab).then(id => id && openRecord(tab, id)) });
    const cur = h("select", { class: "app-select", title: "Currency", onchange: e => { localStorage.setItem("lumen-currency", e.target.value); draw(); } }, ...["INR", "USD", "EUR", "GBP", "AED"].map(c => h("option", { value: c, selected: Apps.currency() === c }, c)));
    root.append(Apps.header("CRM", "💼", "Leads, deals, contacts and companies", cur, addBtn), summary,
      Apps.tabs([["deals", "Deals"], ["leads", "Leads"], ["contacts", "Contacts"], ["companies", "Companies"], ["reports", "Reports"]], tab, k => { tab = k; localStorage.setItem("lumen-crm-tab", k); draw(); }),
      h("div", { class: "app-toolbar" }, search), body);

    function drawSummary() {
      const deals = Data.list("deals"), open = deals.filter(d => !["won", "lost"].includes(d.stage)), month = new Date(); month.setDate(1);
      const won = deals.filter(d => d.stage === "won" && (d.closedAt || d.at) >= month.getTime());
      const leads = Data.list("leads"), conv = leads.length ? Math.round(leads.filter(l => l.status === "converted").length / leads.length * 100) : 0;
      summary.replaceChildren(...[["Open pipeline", Apps.money(open.reduce((a, d) => a + (+d.amount || 0), 0)), `${open.length} deals`], ["Won this month", Apps.money(won.reduce((a, d) => a + (+d.amount || 0), 0)), `${won.length} deals`],
        ["New leads", leads.filter(l => l.status === "new").length, `${leads.length} total`], ["Lead conversion", conv + "%", "converted"]].map(([l, v, s], i) =>
        h("div", { class: "kpi glass", style: { animationDelay: i * 60 + "ms" } }, h("span", { text: l }), h("b", { text: v }), h("small", { text: s }))));
    }
    const match = r => !q || JSON.stringify(r).toLowerCase().includes(q);
    function table(col, cols) {
      const rows = Data.list(col).filter(match).sort((a, b) => b.at - a.at);
      if (!rows.length) return Apps.empty(col === "leads" ? "🧲" : col === "contacts" ? "👤" : "🏢", q ? "No matches." : `No ${col} yet.`, h("button", { class: "btn primary", text: "+ New " + LABEL[col], onclick: () => edit(col) }));
      return h("div", { class: "tlist crm-table" }, h("div", { class: "trow head", style: { gridTemplateColumns: cols.map(c => c[2] || "1fr").join(" ") } }, ...cols.map(c => h("span", { text: c[0] }))),
        ...rows.map(r => h("div", { class: "trow", style: { gridTemplateColumns: cols.map(c => c[2] || "1fr").join(" ") }, onclick: () => openRecord(col, r.id) }, ...cols.map(c => { const v = c[1](r); return v instanceof Node ? v : h("span", { text: v ?? "" }); }))));
    }
    function dealsBoard() {
      const deals = Data.list("deals").filter(match);
      return h("div", { class: "board crm-board" }, ...STAGES.map(([k, l, c]) => {
        const items = deals.filter(d => (d.stage || "new") === k), sum = items.reduce((a, d) => a + (+d.amount || 0), 0);
        const col = h("div", { class: "b-col" }, h("div", { class: "b-col-h" }, h("span", { class: "tag", dataset: { tc: c }, text: l }), h("span", { class: "n", text: items.length }), h("span", { class: "grow" }), h("small", { class: "sum", text: Apps.money(sum) })),
          h("div", { class: "b-cards" }, ...items.map(d => {
            const card = h("div", { class: "b-card", draggable: true, onclick: () => openRecord("deals", d.id) },
              h("div", { class: "bc-t", text: d.title }), h("div", { class: "deal-amt", text: Apps.money(d.amount) }),
              h("div", { class: "bc-p" }, name("companies", d.company) ? h("span", { text: "🏢 " + name("companies", d.company) }) : null, d.close ? h("span", { class: "dl " + (d.close < Apps.today() && !["won", "lost"].includes(d.stage) ? "overdue" : ""), text: "⏱ " + Apps.fmtDate(d.close) }) : null, h("span", { class: "grow" }), Apps.avatar(Data.person(d.owner), 22)));
            card.addEventListener("dragstart", e => { e.dataTransfer.setData("text/deal", d.id); card.classList.add("dragging"); });
            card.addEventListener("dragend", () => card.classList.remove("dragging"));
            return card;
          })), h("button", { class: "b-add", text: "+ Deal", onclick: () => edit("deals", {}, { stage: k }) }));
        col.addEventListener("dragover", e => { e.preventDefault(); col.classList.add("drop"); });
        col.addEventListener("dragleave", e => { if (!col.contains(e.relatedTarget)) col.classList.remove("drop"); });
        col.addEventListener("drop", e => { e.preventDefault(); col.classList.remove("drop"); const d = Data.get("deals", e.dataTransfer.getData("text/deal")); if (d) setStage(d, k); });
        return col;
      }));
    }
    function reports() {
      const deals = Data.list("deals"), leads = Data.list("leads");
      const bars = (title, rows) => { const max = Math.max(1, ...rows.map(r => r[1])); return h("div", { class: "report glass" }, h("h3", { text: title }), ...rows.map(([l, v, c, lab]) => h("div", { class: "bar-row" }, h("span", { text: l }), h("div", { class: "bar" }, h("span", { style: { width: v / max * 100 + "%", background: `var(--c-${c || "blue"})` } })), h("b", { text: lab ?? v })))); };
      const byStage = STAGES.map(([k, l, c]) => { const v = deals.filter(d => d.stage === k).reduce((a, d) => a + (+d.amount || 0), 0); return [l, v, c, Apps.money(v)]; });
      const bySource = SOURCES.map(s => [s, leads.filter(l => l.source === s).length, "purple"]).filter(r => r[1]);
      const byOwner = Data.people().map(p => { const v = deals.filter(d => d.owner === p.key && d.stage === "won").reduce((a, d) => a + (+d.amount || 0), 0); return [p.name, v, "green", Apps.money(v)]; });
      return h("div", { class: "reports" }, bars("Pipeline value by stage", byStage), bars("Leads by source", bySource.length ? bySource : [["No leads yet", 0, "gray"]]), bars("Won revenue by person", byOwner));
    }
    function draw() {
      drawSummary();
      addBtn.textContent = tab === "reports" ? "" : "+ New " + LABEL[tab]; addBtn.style.display = tab === "reports" ? "none" : "";
      search.style.display = tab === "reports" ? "none" : "";
      const who = r => h("span", { class: "who" }, Apps.avatar(Data.person(r.owner), 20), Data.person(r.owner).name);
      body.replaceChildren(
        tab === "deals" ? dealsBoard()
        : tab === "leads" ? table("leads", [["Lead", r => r.name, "1.4fr"], ["Company", r => r.companyName], ["Source", r => r.source], ["Status", r => tag(LEAD_ST, r.status), ".9fr"], ["Value", r => r.value ? Apps.money(r.value) : "", ".8fr"], ["Responsible", who]])
        : tab === "contacts" ? table("contacts", [["Name", r => r.name, "1.3fr"], ["Company", r => name("companies", r.company)], ["Email", r => r.email, "1.3fr"], ["Phone", r => r.phone], ["Responsible", who]])
        : tab === "companies" ? table("companies", [["Company", r => r.name, "1.3fr"], ["Industry", r => r.industry], ["Employees", r => r.size, ".7fr"], ["Contacts", r => String(Data.list("contacts").filter(c => c.company === r.id).length), ".6fr"], ["Open deals", r => Apps.money(Data.list("deals").filter(d => d.company === r.id && !["won", "lost"].includes(d.stage)).reduce((a, d) => a + (+d.amount || 0), 0))]])
        : reports());
    }
    const offs = ["deals", "leads", "contacts", "companies", "people"].map(c => Data.on(c, draw));
    return () => offs.forEach(f => f());
  }

  Apps.register("crm", { title: "CRM", icon: "💼", render });
  Apps.CRM = { STAGES, openRecord };
})();
