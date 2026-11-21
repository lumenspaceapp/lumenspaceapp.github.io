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
  };
  window.Prefs = Prefs;
})();
