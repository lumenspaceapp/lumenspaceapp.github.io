/* Activity feed (Bitrix24 "Feed"): posts, announcements, polls, appreciation, likes, comments */
(function () {
  const { h, esc } = UI;
  const linkify = s => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, "<br>");

  function render(root) {
    let kind = "post", filter = "all";
    const text = h("textarea", { class: "feed-input", rows: 2, placeholder: "Share something with your team…" });
    const pollBox = h("div", { class: "poll-edit", style: { display: "none" } });
    const opts = [h("input", { class: "menu-input", placeholder: "Option 1" }), h("input", { class: "menu-input", placeholder: "Option 2" })];
    pollBox.append(...opts, h("button", { class: "btn", text: "+ Option", onclick: () => { const i = h("input", { class: "menu-input", placeholder: "Option " + (opts.length + 1) }); opts.push(i); pollBox.insertBefore(i, pollBox.lastChild); } }));
    let thanksTo = null;
    const thanksBtn = h("button", { class: "chip-btn", style: { display: "none" }, text: "Choose a teammate…", onclick: () => Apps.personPicker(thanksBtn, p => { thanksTo = p?.key || null; thanksBtn.textContent = p ? "🏅 " + p.name : "Choose a teammate…"; }) });
    const kinds = h("div", { class: "seg" }, ...[["post", "✍️ Post"], ["announce", "📣 Announcement"], ["poll", "📊 Poll"], ["thanks", "🏅 Appreciation"]].map(([k, l]) => h("button", { class: kind === k ? "on" : "", text: l, onclick: e => {
      kind = k; kinds.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.currentTarget));
      pollBox.style.display = k === "poll" ? "" : "none"; thanksBtn.style.display = k === "thanks" ? "" : "none";
      text.placeholder = k === "poll" ? "Ask a question…" : k === "announce" ? "Important news for everyone…" : k === "thanks" ? "Say thanks for something great…" : "Share something with your team…";
    } })));
    const composer = h("div", { class: "feed-compose glass" }, h("div", { class: "fc-top" }, Apps.avatar(Data.me(), 36), text), pollBox,
      h("div", { class: "fc-bar" }, kinds, thanksBtn, h("span", { class: "grow" }), h("button", { class: "btn primary", text: "Publish", onclick: publish })));
    const list = h("div", { class: "feed-list" });
    root.append(Apps.header("Activity Feed", "📰", "News and updates from your workspace"),
      composer, Apps.tabs([["all", "All"], ["announce", "Announcements"], ["poll", "Polls"], ["thanks", "Appreciation"], ["mine", "My posts"]], filter, k => { filter = k; draw(); }), list);

    async function publish() {
      const t = text.value.trim(); const me = Data.me();
      if (kind === "poll") {
        const options = opts.map(o => o.value.trim()).filter(Boolean);
        if (!t || options.length < 2) return UI.toast("A poll needs a question and at least 2 options");
        await Data.add("feed", { kind, text: t, poll: options.map(o => ({ t: o, votes: [] })), likes: [], comments: [] });
        opts.forEach(o => (o.value = ""));
      } else if (kind === "thanks") {
        if (!thanksTo) return UI.toast("Choose who you're thanking");
        await Data.add("feed", { kind, text: t || "Thank you!", to: thanksTo, likes: [], comments: [] });
        Data.notify(thanksTo, `🏅 <b>${esc(me.name)}</b> thanked you on the feed`, "#/app/feed");
      } else {
        if (!t) return text.focus();
        await Data.add("feed", { kind, text: t, likes: [], comments: [], pinned: kind === "announce" });
        if (kind === "announce") Data.people().forEach(p => Data.notify(p.key, `📣 <b>${esc(me.name)}</b> posted an announcement`, "#/app/feed"));
      }
      text.value = ""; UI.toast("Published");
    }
    function draw() {
      const me = Data.me().key;
      const posts = Data.list("feed").filter(p => filter === "all" || (filter === "mine" ? p.by === me : p.kind === filter))
        .sort((a, b) => (b.pinned && b.kind === "announce") - (a.pinned && a.kind === "announce") || b.at - a.at);
      if (!posts.length) return list.replaceChildren(Apps.empty("📰", "Nothing here yet. Write the first post!"));
      list.replaceChildren(...posts.map((p, i) => post(p, i)));
    }
    function post(p, i) {
      const me = Data.me().key, author = Data.person(p.by), liked = (p.likes || []).includes(me);
      const body = [];
      if (p.kind === "announce") body.push(h("div", { class: "fp-badge announce", text: "📣 Announcement" }));
      if (p.kind === "thanks") body.push(h("div", { class: "thanks-card" }, h("span", { class: "medal", text: "🏅" }), Apps.avatar(Data.person(p.to), 40), h("div", null, h("b", { text: Data.person(p.to).name }), h("div", { text: "was appreciated by " + author.name }))));
      body.push(h("div", { class: "fp-text", html: linkify(p.text) }));
      if (p.kind === "poll") {
        const total = p.poll.reduce((a, o) => a + o.votes.length, 0), voted = p.poll.some(o => o.votes.includes(me));
        body.push(h("div", { class: "poll" }, ...p.poll.map((o, idx) => {
          const pct = total ? Math.round(o.votes.length / total * 100) : 0, mine = o.votes.includes(me);
          return h("button", { class: "poll-opt" + (mine ? " on" : ""), onclick: () => Data.update("feed", p.id, { poll: p.poll.map((x, j) => ({ ...x, votes: j === idx ? (mine ? x.votes.filter(k => k !== me) : [...x.votes.filter(k => k !== me), me]) : x.votes.filter(k => k !== me) })) }) },
            h("span", { class: "po-bar", style: { width: (voted ? pct : 0) + "%" } }), h("span", { class: "po-t", text: (mine ? "✓ " : "") + o.t }), voted ? h("span", { class: "po-p", text: pct + "%" }) : null);
        }), h("small", { text: `${total} vote${total === 1 ? "" : "s"}` })));
      }
      const cin = h("input", { class: "menu-input", placeholder: "Write a comment…" });
      cin.onkeydown = e => { if (e.key === "Enter" && cin.value.trim()) { Data.update("feed", p.id, { comments: [...(p.comments || []), { by: me, text: cin.value.trim(), at: Date.now() }] }); if (p.by !== me) Data.notify(p.by, `<b>${esc(Data.me().name)}</b> commented on your post`, "#/app/feed"); cin.value = ""; cin.blur(); draw(); } };
      return h("article", { class: "feed-post glass" + (p.kind === "announce" ? " announce" : ""), style: { animationDelay: Math.min(i * 40, 300) + "ms" } },
        h("div", { class: "fp-head" }, Apps.avatar(author, 38), h("div", { class: "grow" }, h("b", { text: author.name }), h("div", { class: "app-sub", text: UI.timeAgo(p.at) + (p.kind === "poll" ? " · Poll" : "") })),
          p.by === me ? h("button", { class: "icon-btn xs", html: UI.icon("dots"), onclick: e => UI.menu(e.currentTarget, [
            p.kind === "announce" ? { label: p.pinned ? "Unpin" : "Pin to top", icon: "star", onClick: () => Data.update("feed", p.id, { pinned: !p.pinned }) } : null,
            { label: "Delete post", icon: "trash", danger: true, onClick: async () => { if (await UI.confirm("Delete this post?")) Data.remove("feed", p.id); } }], { align: "end" }) }) : null),
        ...body,
        h("div", { class: "fp-bar" },
          h("button", { class: "like" + (liked ? " on" : ""), onclick: () => Data.update("feed", p.id, { likes: liked ? p.likes.filter(k => k !== me) : [...(p.likes || []), me] }) }, (liked ? "❤️" : "🤍") + " " + ((p.likes || []).length || "Like")),
          h("span", { class: "app-sub", text: `💬 ${(p.comments || []).length}` })),
        (p.comments || []).length ? h("div", { class: "comments" }, ...p.comments.map(c => h("div", { class: "cmt" }, Apps.avatar(Data.person(c.by), 26), h("div", null, h("div", { class: "cmt-h" }, h("b", { text: Data.person(c.by).name }), h("small", { text: UI.timeAgo(c.at) })), h("div", { class: "cmt-t", text: c.text }))))) : null,
        cin);
    }
    const offs = [Data.on("feed", () => { if (!list.contains(document.activeElement)) draw(); }), Data.on("people", draw)];
    return () => offs.forEach(f => f());
  }

  Apps.register("feed", { title: "Feed", icon: "📰", render });
})();
