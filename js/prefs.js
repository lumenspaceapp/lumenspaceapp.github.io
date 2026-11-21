/* Prefs: workspace settings (settings/workspace, admins edit) and personal preferences (people/<me>.prefs, each person edits).
   Every app reads settings through these helpers so defaults live in one place.

   Workspace (Prefs.ws()) — schema in docs/BUILD-BRIEF.md "Settings":
     tools   { [app]: { on: bool, features: { [feature]: bool } } }      apps / sub-features switched on or off
     brand   { logo, theme, accent, mode }                                default look for everyone
     comms   { feedBroadcast, feedDefaultAll, likeText, generalPost, announceJoins, linkPreviews, driveVersions }
     people  { nameFormat, phoneCountry, showBirthYear, invite, inviteDomains, announceNew }
     hours   { start, end, weekend: [0-6], weekStart: 0|1|6, holidays: [{ date, name }] }
     region  { timezone, dateFormat, time24, currency, language }
     security{ idleSignOut (minutes, 0 = off), emailLinks }
     ai      { tasks, feed, crm, chat, meetings, kb }
     gdpr    { company, dpo, email }
   Personal (Prefs.me()): { notify: { [type]: { card, sound, desktop } }, dnd: { on, from, to }, menu: { order: [apps], hidden: [apps] } } */
(function () {
  const DEFAULTS = {
    tools: {},
    brand: { logo: "", theme: "aurora", accent: "", mode: "" },
    comms: { feedBroadcast: "all", feedDefaultAll: true, likeText: "Like", generalPost: "all", announceJoins: true, linkPreviews: true, driveVersions: 5 },
    people: { nameFormat: "first_last", phoneCountry: "", showBirthYear: true, invite: "managers", inviteDomains: [], announceNew: { chat: true, feed: false } },
    hours: { start: "09:00", end: "18:00", weekend: [0, 6], weekStart: 1, holidays: [] },
    region: { timezone: "", dateFormat: "auto", time24: false, currency: "", language: "en" },
    security: { idleSignOut: 0, emailLinks: true },
    ai: { tasks: true, feed: true, crm: true, chat: true, meetings: true, kb: true },
    gdpr: { company: "", dpo: "", email: "" },
  };
  const NOTIFY_TYPES = ["chat", "mentions", "tasks", "feed", "calendar", "crm", "hr", "automation", "other"];
  const ME_DEFAULTS = { notify: Object.fromEntries(NOTIFY_TYPES.map(t => [t, { card: true, sound: true, desktop: true }])), dnd: { on: false, from: "22:00", to: "08:00" }, menu: { order: [], hidden: [] } };

  const isObj = v => v && typeof v === "object" && !Array.isArray(v);
  const merge = (d, v) => { if (!isObj(d)) return v === undefined ? d : v; const o = { ...d }; if (isObj(v)) for (const k in v) o[k] = merge(d[k], v[k]); return o; };
  const at = (o, path) => String(path).split(".").reduce((x, k) => (x == null ? x : x[k]), o);

  const Prefs = {
    DEFAULTS, NOTIFY_TYPES, ME_DEFAULTS,
    // workspace settings merged over the defaults
    ws() { return merge(DEFAULTS, (window.Data && Data.get("settings", "workspace")) || {}); },
    get(path, def) { const v = at(Prefs.ws(), path); return v === undefined ? def : v; },
    // admins: save a partial patch (nested objects merge)
    set(patch) { return Data.update("settings", "workspace", patch); },
    // is an app (or one of its features) switched on? (default: on)
    tool(app, feature) {
      const t = (Prefs.ws().tools || {})[app] || {};
      if (t.on === false) return false;
      return feature ? (t.features || {})[feature] !== false : true;
    },
    // my personal preferences (stored on my profile so they follow me between devices)
    me() { const k = window.Data ? Data.me().key : "me"; return merge(ME_DEFAULTS, ((window.Data && Data.get("people", k)) || {}).prefs || {}); },
    setMe(patch) { const k = Data.me().key; return Data.update("people", k, { prefs: merge(Prefs.me(), patch) }); },
    // live updates: run fn whenever workspace settings change
    on(fn) { return window.Data ? Data.on("settings", () => fn(Prefs.ws())) : () => {}; },

    /* ---------- helpers added for the Settings page ---------- */
    // admins: replace one section with its current values + patch (the private workspace merges only top-level keys, so always send whole sections)
    setIn(section, patch) { return Prefs.set({ [section]: { ...(Prefs.ws()[section] || {}), ...patch } }); },
    // wallpapers (css/base.css draws them from html[data-wall] + html[data-wall-kind]); kind: aurora (animated blobs), mesh (still gradient), flat, space
    WALLPAPERS: [
      ["aurora", "Aurora", "aurora"], ["sunset", "Sunset", "aurora"], ["ocean", "Ocean", "aurora"], ["forest", "Forest", "aurora"],
      ["northern", "Northern lights", "aurora"], ["candy", "Candy", "aurora"], ["lavender", "Lavender", "aurora"], ["mint", "Mint", "aurora"],
      ["ember", "Ember", "aurora"], ["dusk", "Dusk", "aurora"], ["berry", "Berry", "aurora"], ["sand", "Sand", "aurora"], ["sky", "Sky", "aurora"],
      ["mesh", "Pastel mesh", "mesh"], ["prism", "Prism mesh", "mesh"], ["peach", "Peach mesh", "mesh"],
      ["space", "Deep space", "space"], ["noise", "Soft noise", "flat"], ["mono", "Mono", "aurora"], ["plain", "Plain", "flat"],
    ].map(([id, name, kind]) => ({ id, name, kind })),
    wallKind(id) { return (Prefs.WALLPAPERS.find(w => w.id === id) || Prefs.WALLPAPERS[0]).kind; },
    // date / time settings as they apply to me: my device override (Store.local.settings.region) first, then the workspace
    region() {
      const w = Prefs.ws().region, mine = (window.Store && Store.local.settings.region) || {};
      const pick = k => mine[k] !== undefined && mine[k] !== "" && mine[k] !== null ? mine[k] : w[k];
      return { ...w, timezone: pick("timezone"), dateFormat: pick("dateFormat") || "auto", time24: !!pick("time24") };
    },
    // is "do not disturb" on right now? (my own schedule, device clock)
    inDnd(now = new Date()) {
      const d = Prefs.me().dnd || {}; if (!d.on) return false;
      const m = s => { const [a, b] = String(s || "0:0").split(":").map(Number); return (a || 0) * 60 + (b || 0); };
      const t = now.getHours() * 60 + now.getMinutes(), f = m(d.from), e = m(d.to);
      return f === e ? true : f < e ? t >= f && t < e : t >= f || t < e;
    },
    // may an alert of this type use this channel ("card" | "sound" | "desktop")?
    notifyOn(type, channel) { const n = Prefs.me().notify || {}; return ((n[type] || n.other || {})[channel]) !== false; },
  };
  window.Prefs = Prefs;
})();
