/* GDrive: live Google Drive folders and files inside Lumen's Drive.
   Each viewer connects their own Google account; Lumen reads Google Drive with that account's access token.
   Nothing from Google is copied into Lumen, and tokens never leave this browser tab
   (memory + sessionStorage only: never Firestore, never localStorage).

   Connecting:
   - Preferred: Google Identity Services token client with window.GOOGLE_CLIENT_ID (js/firebase-config.js).
     After the first consent, "Reconnect" is one click and Google doesn't ask again (prompt: "").
   - Fallback when GOOGLE_CLIENT_ID is empty: Firebase reauthenticateWithPopup with the Drive scope added.
   Scopes: drive.readonly to view; "drive" is asked for only when someone uploads or creates a folder in Google Drive. */
(function () {
  const READ = "https://www.googleapis.com/auth/drive.readonly";
  const WRITE = "https://www.googleapis.com/auth/drive";
  const API = "https://www.googleapis.com/drive/v3/";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3/";
  const GIS = "https://accounts.google.com/gsi/client";
  const FB_V = "10.12.2"; // same Firebase version as js/cloud.js
  const FOLDER = "application/vnd.google-apps.folder", SHORTCUT = "application/vnd.google-apps.shortcut";
  const FIELDS = "id,name,mimeType,iconLink,thumbnailLink,hasThumbnail,modifiedTime,size,webViewLink,owners(displayName,emailAddress),shortcutDetails,resourceKey";
  const MAX_UPLOAD = 25 * 1024 * 1024;
  const LOGO = '<svg class="gd-logo" viewBox="0 0 87.3 78" aria-hidden="true"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>';

  /* ---------- state ---------- */
  let tok = null;          // { t, exp, scope: [..], via: "gis"|"firebase" }
  let acct = null;         // { email, name, photo } of the connected Google account
  let had = false;         // connected before in this tab (so expiry shows "Reconnect", not "Connect")
  let expTimer = 0;
  const subs = new Set();
  const metaCache = new Map(); // id -> { at, p }

  const clientId = () => String(window.GOOGLE_CLIENT_ID || "").trim();
  const fbUser = () => window.Cloud?.user || null;
  const lumenEmail = () => fbUser()?.email || window.Data?.me?.()?.email || "";
  const skey = () => "lumen-gdrive:" + (fbUser()?.uid || "local");
  const emit = () => subs.forEach(fn => { try { fn(status()); } catch (e) { console.error(e); } });
  const err = (code, msg, extra) => Object.assign(new Error(msg || code), { code }, extra || {});

  function save() {
    try {
      if (tok) sessionStorage.setItem(skey(), JSON.stringify({ tok, acct }));
      else sessionStorage.removeItem(skey());
    } catch {}
  }
  function load() {
    try {
      const j = JSON.parse(sessionStorage.getItem(skey()) || "null");
      if (j?.tok?.t && j.tok.exp > Date.now() + 30e3) { tok = j.tok; acct = j.acct || null; had = true; arm(); }
      else if (j?.tok) { had = true; acct = j.acct || null; }
    } catch {}
  }
  function arm() {
    clearTimeout(expTimer);
    if (!tok) return;
    expTimer = setTimeout(() => { emit(); }, Math.max(1000, tok.exp - Date.now() - 30e3));
  }
  function setToken(t, expiresIn, scope, via) {
    tok = { t, exp: Date.now() + Math.max(60, (+expiresIn || 3600) - 60) * 1000, scope: String(scope || READ).split(/\s+/).filter(Boolean), via };
    had = true; save(); arm();
  }
  function clear() { tok = null; clearTimeout(expTimer); save(); }

  // the signed-in Lumen user decides which saved token applies (the sessionStorage key includes the uid)
  let lastKey = null;
  function sync() {
    const k = skey(); if (k === lastKey) return false;
    lastKey = k; tok = null; acct = null; had = false; clearTimeout(expTimer); load();
    return true;
  }

  /* ---------- status ---------- */
  // "unavailable" (no way to connect here) | "off" (never connected) | "expired" | "on"
  function status() {
    sync();
    if (tok && tok.exp > Date.now() + 30e3) return "on";
    if (!clientId() && !(window.Cloud?.configured && fbUser())) return "unavailable";
    return had ? "expired" : "off";
  }
  const connected = () => status() === "on";
  const canWrite = () => connected() && tok.scope.includes(WRITE);

  /* ---------- Google Identity Services ---------- */
  let gisP = null;
  function gis() {
    if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2);
    return gisP ||= new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = GIS; s.async = true; s.defer = true;
      s.onload = () => window.google?.accounts?.oauth2 ? res(window.google.accounts.oauth2) : (gisP = null, rej(err("gis", "Google sign-in didn't load")));
      s.onerror = () => { gisP = null; s.remove(); rej(err(navigator.onLine === false ? "offline" : "gis", "Google sign-in didn't load")); };
      document.head.append(s);
    });
  }
  async function viaGis(scopes, select) {
    const oauth = await gis();
    return new Promise((res, rej) => {
      const client = oauth.initTokenClient({
        client_id: clientId(),
        scope: scopes.join(" "),
        include_granted_scopes: true,
        prompt: select ? "select_account" : "",
        hint: lumenEmail() || undefined,
        callback: r => {
          if (!r || r.error) return rej(err(r?.error === "access_denied" ? "denied" : "auth", r?.error_description || r?.error || "Google sign-in failed"));
          if (!oauth.hasGrantedAllScopes(r, ...scopes)) return rej(err("denied", "Drive access wasn't allowed"));
          setToken(r.access_token, r.expires_in, r.scope, "gis");
          res();
        },
        error_callback: e => rej(err(e?.type === "popup_failed_to_open" ? "popup" : e?.type === "popup_closed" ? "closed" : "auth", e?.message || e?.type)),
      });
      client.requestAccessToken();
    });
  }

  /* ---------- Firebase fallback (no GOOGLE_CLIENT_ID yet) ---------- */
  async function viaFirebase(scopes, select) {
    const user = fbUser();
    if (!window.Cloud?.configured || !user) throw err("unavailable", "Sign in to Lumen with Google first");
    const { getAuth, reauthenticateWithPopup, GoogleAuthProvider } = await import(`https://www.gstatic.com/firebasejs/${FB_V}/firebase-auth.js`);
    const auth = getAuth(); // the default app js/cloud.js already initialised
    const provider = new GoogleAuthProvider();
    scopes.forEach(s => provider.addScope(s));
    provider.setCustomParameters(select ? { prompt: "select_account" } : { login_hint: user.email || "" });
    let r;
    try { r = await reauthenticateWithPopup(auth.currentUser || user, provider); }
    catch (e) {
      const c = e?.code || "";
      if (c === "auth/user-mismatch") throw err("mismatch", "Pick the Google account you use for Lumen (" + (user.email || "") + ")");
      if (c === "auth/popup-blocked") throw err("popup", e.message);
      if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") throw err("closed", e.message);
      throw err("auth", e?.message || "Google sign-in failed");
    }
    const t = GoogleAuthProvider.credentialFromResult(r)?.accessToken;
    if (!t) throw err("auth", "Google didn't return Drive access");
    let exp = 3500, scope = scopes.join(" ");
    try { // how long the token lives and which scopes were really granted
      const info = await fetch("https://oauth2.googleapis.com/tokeninfo", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "access_token=" + encodeURIComponent(t) }).then(x => x.ok ? x.json() : null);
      if (info) { exp = +info.expires_in || exp; scope = info.scope || scope; }
    } catch {}
    if (!scope.split(/\s+/).some(s => s === READ || s === WRITE)) throw err("denied", "Drive access wasn't allowed");
    setToken(t, exp, scope, "firebase");
  }

  /* ---------- connect / disconnect ---------- */
  let connecting = null;
  // Must be called from a click (it opens Google's pop-up).
  function connect({ write = false, select = false } = {}) {
    if (connecting) return connecting;
    const scopes = write || tok?.scope?.includes(WRITE) ? [READ, WRITE] : [READ];
    connecting = (async () => {
      if (status() === "unavailable") throw err("unavailable", "Google Drive isn't set up on this site yet");
      const prevEmail = acct?.email;
      if (clientId()) await viaGis(scopes, select); else await viaFirebase(scopes, select);
      try { const a = await api("about", { params: { fields: "user(displayName,emailAddress,photoLink)" } }); acct = { email: a.user?.emailAddress || "", name: a.user?.displayName || "", photo: a.user?.photoLink || "" }; }
      catch (e) { if (e.code === "api-off") { save(); emit(); throw e; } }
      if (prevEmail && acct?.email !== prevEmail) metaCache.clear();
      save(); emit();
    })().finally(() => { connecting = null; });
    return connecting;
  }
  async function disconnect() {
    const t = tok?.t, via = tok?.via;
    clear(); acct = null; had = false; metaCache.clear();
    try { sessionStorage.removeItem(skey()); } catch {}
    emit();
    if (!t) return;
    try {
      if (via === "gis" && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t, () => {});
      else await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "token=" + encodeURIComponent(t) });
    } catch {}
  }
  // A valid access token, or throws { code: "off" | "expired" | "unavailable" | "scope" }.
  // With interactive: true (only inside a click) it reconnects when needed.
  async function token({ interactive = false, write = false } = {}) {
    if (connected() && (!write || canWrite())) return tok.t;
    if (!interactive) {
      if (connected() && write) throw err("scope", "Lumen needs permission to add files to Google Drive");
      const s = status();
      throw err(s === "on" ? "expired" : s, s === "unavailable" ? "Google Drive isn't set up on this site yet" : "Connect Google Drive first");
    }
    await connect({ write });
    return tok.t;
  }

  /* ---------- Drive API ---------- */
  function apiErr(status, j) {
    const e = j?.error || {}, reason = e.errors?.[0]?.reason || "", txt = JSON.stringify(j || {}), msg = e.message || "Google Drive error " + status;
    if (status === 401) { clear(); emit(); return err("expired", msg, { status }); }
    if (/accessNotConfigured|SERVICE_DISABLED|has not been used in project|is disabled/i.test(reason + " " + txt)) return err("api-off", msg, { status });
    if (status === 429 || /rateLimitExceeded|userRateLimitExceeded/.test(reason)) return err("rate", msg, { status });
    if (status === 403 && /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient.*scope/i.test(reason + " " + txt)) return err("scope", msg, { status });
    if (status === 404) return err("notfound", msg, { status });
    if (status === 403) return err("forbidden", msg, { status });
    return err("error", msg, { status });
  }
  async function api(path, { params, method = "GET", body, headers = {}, keys, raw, base = API } = {}) {
    const t = await token();
    const url = base + path + (params ? "?" + new URLSearchParams(params) : "");
    const hd = { Authorization: "Bearer " + t, ...headers };
    if (keys) hd["X-Goog-Drive-Resource-Keys"] = keys;
    let res;
    try { res = await fetch(url, { method, headers: hd, body }); }
    catch { throw err(navigator.onLine === false ? "offline" : "network", "Couldn't reach Google Drive"); }
    if (res.ok) return raw ? res : res.status === 204 ? null : res.json();
    let j = null; try { j = await res.json(); } catch {}
    throw apiErr(res.status, j);
  }
  const qs = s => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  // "id/key,id2/key2" for X-Goog-Drive-Resource-Keys (links shared before 2021 need them)
  const keysFor = (...items) => items.filter(x => x && x.id && x.resourceKey).map(x => x.id + "/" + x.resourceKey).join(",") || undefined;

  async function list(folderId, { q = "", keys } = {}) {
    const out = []; let pageToken = "", pages = 0;
    const query = `'${qs(folderId)}' in parents and trashed = false` + (q ? ` and name contains '${qs(q)}'` : "");
    do {
      const j = await api("files", { keys, params: { q: query, fields: `nextPageToken,files(${FIELDS})`, pageSize: 200, orderBy: "folder,name", supportsAllDrives: true, includeItemsFromAllDrives: true, ...(pageToken ? { pageToken } : {}) } });
      out.push(...(j.files || []));
      pageToken = j.nextPageToken || "";
    } while (pageToken && ++pages < 10);
    return out.map(norm);
  }
  async function meta(id, keys, fresh) {
    const c = metaCache.get(id);
    if (!fresh && c && Date.now() - c.at < 5 * 60e3) return c.p;
    const p = (async () => {
      try { return norm(await api("files/" + encodeURIComponent(id), { keys, params: { fields: FIELDS + ",driveId", supportsAllDrives: true } })); }
      catch (e) {
        if (e.code !== "notfound") throw e;
        try { const d = await api("drives/" + encodeURIComponent(id), { params: { fields: "id,name" } }); return norm({ id: d.id, name: d.name, mimeType: FOLDER, webViewLink: "https://drive.google.com/drive/folders/" + d.id }); }
        catch { throw e; }
      }
    })();
    metaCache.set(id, { at: Date.now(), p });
    p.catch(() => metaCache.delete(id));
    return p;
  }
  const media = (id, keys) => api("files/" + encodeURIComponent(id), { keys, raw: true, params: { alt: "media", supportsAllDrives: true } }).then(r => r.blob());
  const exportPdf = (id, keys) => api("files/" + encodeURIComponent(id) + "/export", { keys, raw: true, params: { mimeType: "application/pdf" } }).then(r => r.blob());
  async function mkdir(parentId, name, keys) {
    await token({ write: true });
    return norm(await api("files", { method: "POST", keys, params: { supportsAllDrives: true, fields: FIELDS }, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }) }));
  }
  // Upload one file (≤ 25 MB) into a Google Drive folder. Small files go in one multipart request; bigger ones use a resumable session.
  async function upload(parentId, file, { keys, onProgress } = {}) {
    if (file.size > MAX_UPLOAD) throw err("big", "Files up to 25 MB can be uploaded from Lumen");
    const t = await token({ write: true });
    const metaJson = JSON.stringify({ name: file.name, parents: [parentId] });
    const type = file.type || "application/octet-stream";
    const send = (method, url, headers, body) => new Promise((res, rej) => {
      const x = new XMLHttpRequest();
      x.open(method, url);
      Object.entries(headers).forEach(([k, v]) => v && x.setRequestHeader(k, v));
      if (x.upload && onProgress) x.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      x.onload = () => { let j = null; try { j = JSON.parse(x.responseText || "null"); } catch {} x.status >= 200 && x.status < 300 ? res(j) : rej(apiErr(x.status, j)); };
      x.onerror = () => rej(err(navigator.onLine === false ? "offline" : "network", "Upload failed"));
      x.send(body);
    });
    const auth = { Authorization: "Bearer " + t, "X-Goog-Drive-Resource-Keys": keys };
    if (file.size > 5 * 1024 * 1024) {
      let loc = "";
      try {
        const r = await fetch(UPLOAD + "files?uploadType=resumable&supportsAllDrives=true&fields=" + encodeURIComponent(FIELDS), {
          method: "POST", headers: { ...(keys ? { "X-Goog-Drive-Resource-Keys": keys } : {}), Authorization: "Bearer " + t, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": type }, body: metaJson });
        if (!r.ok) { let j = null; try { j = await r.json(); } catch {} throw apiErr(r.status, j); }
        loc = r.headers.get("Location") || "";
      } catch (e) { if (e.code) throw e; throw err("network", "Upload failed"); }
      if (loc) return norm(await send("PUT", loc, { "Content-Type": type }, file));
    }
    const b = "lumen" + Math.random().toString(36).slice(2);
    const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n--${b}\r\nContent-Type: ${type}\r\n\r\n`, file, `\r\n--${b}--`]);
    return norm(await send("POST", UPLOAD + "files?uploadType=multipart&supportsAllDrives=true&fields=" + encodeURIComponent(FIELDS), { ...auth, "Content-Type": "multipart/related; boundary=" + b }, body));
  }

  /* ---------- items ---------- */
  // Shortcuts behave like what they point to (tid / tmime).
  function norm(f) {
    if (!f) return f;
    const sc = f.mimeType === SHORTCUT && f.shortcutDetails;
    return { ...f, tid: sc ? sc.targetId : f.id, tmime: sc ? sc.targetMimeType || "" : f.mimeType, tkey: sc ? sc.targetResourceKey || "" : f.resourceKey || "", shortcut: !!sc };
  }
  const isFolder = f => (f.tmime || f.mimeType) === FOLDER;
  const GAPPS = { document: ["doc", "Google Docs"], spreadsheet: ["sheet", "Google Sheets"], presentation: ["slides", "Google Slides"], form: ["form", "Google Forms"], drawing: ["image", "Google Drawings"], site: ["link", "Google Sites"], map: ["link", "Google My Maps"], script: ["text", "Apps Script"], jam: ["image", "Jamboard"], folder: ["folder", "Folder"], shortcut: ["link", "Shortcut"] };
  // a rough kind for icons and filters: folder, doc, sheet, slides, form, image, video, audio, pdf, text, zip, other
  function kind(mime, name) {
    const m = String(mime || "");
    if (m.startsWith("application/vnd.google-apps.")) return (GAPPS[m.slice(28)] || ["other"])[0];
    if (m.startsWith("image/")) return "image";
    if (m.startsWith("video/")) return "video";
    if (m.startsWith("audio/")) return "audio";
    if (m === "application/pdf") return "pdf";
    if (/sheet|excel|csv/.test(m)) return "sheet";
    if (/presentation|powerpoint/.test(m)) return "slides";
    if (/word|opendocument\.text|rtf/.test(m)) return "doc";
    if (/zip|compressed|x-tar|rar|7z/.test(m)) return "zip";
    if (/^text\/|json|xml|javascript/.test(m)) return /markdown/.test(m) || /\.md$/i.test(name || "") ? "md" : "text";
    return "other";
  }
  const isGoogleApp = mime => String(mime || "").startsWith("application/vnd.google-apps.");
  function typeLabel(mime, name) {
    const m = String(mime || "");
    if (isGoogleApp(m)) return (GAPPS[m.slice(28)] || [, "Google file"])[1];
    const ext = ((String(name || "").match(/\.([a-z0-9]{1,6})$/i) || [])[1] || "").toUpperCase();
    const k = kind(m, name);
    const base = { image: "Image", video: "Video", audio: "Audio", pdf: "PDF", sheet: "Spreadsheet", slides: "Presentation", doc: "Document", zip: "Archive", text: "Text", md: "Markdown" }[k] || "File";
    return ext && k !== "pdf" ? base + " · " + ext : base;
  }
  // Google's short-lived thumbnail at a given size (=s220 → =s400)
  const thumb = (url, px) => url ? String(url).replace(/=s\d+(-[a-z0-9-]*)?$/i, "") + "=s" + px : "";
  // crisper file-type icon (…/16/type/… → …/64/type/…)
  const icon = (url, px = 64) => url ? String(url).replace(/\/(16|32)\/type\//, `/${px}/type/`) : "";
  function openUrl(f) {
    const id = f.tid || f.id, rk = f.tkey || f.resourceKey;
    if (f.webViewLink && !f.shortcut) return f.webViewLink;
    const m = f.tmime || f.mimeType, base = m === FOLDER ? "https://drive.google.com/drive/folders/" + id : "https://drive.google.com/file/d/" + id + "/view";
    return base + (rk ? (base.includes("?") ? "&" : "?") + "resourcekey=" + encodeURIComponent(rk) : "");
  }
  // URL for an <iframe> preview (works with the viewer's Google cookies)
  function embedUrl(f) {
    const id = encodeURIComponent(f.tid || f.id), m = f.tmime || f.mimeType || "", rk = f.tkey || f.resourceKey;
    const k = m.startsWith("application/vnd.google-apps.") ? m.slice(28) : "";
    const base = k === "document" ? `https://docs.google.com/document/d/${id}/preview`
      : k === "spreadsheet" ? `https://docs.google.com/spreadsheets/d/${id}/preview`
      : k === "presentation" ? `https://docs.google.com/presentation/d/${id}/preview`
      : k === "drawing" ? `https://docs.google.com/drawings/d/${id}/preview`
      : `https://drive.google.com/file/d/${id}/preview`;
    return base + (rk ? "?resourcekey=" + encodeURIComponent(rk) : "");
  }

  /* ---------- links ---------- */
  // { kind: "folder"|"file"|"any", id, resourceKey?, mimeType?, url } for Google Drive / Docs links, else null
  function parse(raw) {
    let u;
    try { u = new URL(/^https?:\/\//i.test(String(raw || "").trim()) ? String(raw).trim() : "https://" + String(raw || "").trim()); } catch { return null; }
    const host = u.hostname.toLowerCase(), path = u.pathname, rk = u.searchParams.get("resourcekey") || undefined, url = u.href;
    const ID = "([-\\w]{10,})";
    let m;
    if (host === "drive.google.com") {
      if ((m = path.match(new RegExp("/drive/(?:u/\\d+/)?(?:mobile/)?folders/" + ID)))) return { kind: "folder", id: m[1], resourceKey: rk, url };
      if ((m = path.match(new RegExp("/(?:a/[^/]+/)?file/(?:u/\\d+/)?d/" + ID)))) return { kind: "file", id: m[1], resourceKey: rk, url };
      if (/\/drive\/(?:u\/\d+\/)?(?:my-drive|home)\/?$/.test(path)) return { kind: "folder", id: "root", url };
      const qid = u.searchParams.get("id");
      if (qid && /^[-\w]{10,}$/.test(qid)) {
        if (/folderview|embeddedfolderview/.test(path)) return { kind: "folder", id: qid, resourceKey: rk, url };
        if (/\/(uc|thumbnail)$/.test(path)) return { kind: "file", id: qid, resourceKey: rk, url };
        if (/\/open$/.test(path)) return { kind: "any", id: qid, resourceKey: rk, url };
      }
      return null;
    }
    if (host === "docs.google.com") {
      if (/\/forms\/(?:u\/\d+\/)?d\/e\//.test(path)) return null; // a published form link, not a Drive file
      if ((m = path.match(new RegExp("/(document|spreadsheets|presentation|forms|drawings|file)/(?:u/\\d+/)?d/" + ID)))) {
        const mime = { document: "application/vnd.google-apps.document", spreadsheets: "application/vnd.google-apps.spreadsheet", presentation: "application/vnd.google-apps.presentation", forms: "application/vnd.google-apps.form", drawings: "application/vnd.google-apps.drawing" }[m[1]];
        return { kind: "file", id: m[2], resourceKey: rk, mimeType: mime, url };
      }
      return null;
    }
    return null;
  }

  // Friendly one-liners for errors
  function errText(e) {
    return {
      unavailable: "Google Drive isn't set up on this site yet.",
      off: "Connect Google Drive to see this.",
      expired: "Your Google Drive session ended. Reconnect to keep going.",
      "api-off": "The site owner needs to turn on the Google Drive API.",
      notfound: "Your Google account can't open this. Ask its owner to share it with you.",
      forbidden: "Your Google account can't open this. Ask its owner to share it with you.",
      scope: "Lumen needs your OK to add files to Google Drive.",
      offline: "You're offline. This refreshes when you're back online.",
      network: "Couldn't reach Google Drive. Check your connection.",
      rate: "Google Drive is busy. Trying again in a moment.",
      popup: "The Google pop-up was blocked. Allow pop-ups for this site and try again.",
      closed: "The Google window was closed before you finished.",
      denied: "Drive access wasn't allowed, so Lumen can't show your files.",
      mismatch: e?.message || "Pick the Google account you use for Lumen.",
      big: "Files up to 25 MB can be uploaded from Lumen. Upload bigger ones in Google Drive.",
      gis: "Google sign-in didn't load. Check your connection or ad blocker.",
    }[e?.code] || (e?.message ? "Google Drive: " + e.message : "Something went wrong with Google Drive.");
  }

  sync();
  setInterval(() => { if (sync()) emit(); }, 3000); // Lumen sign-in finishes after this file loads

  window.GDrive = {
    READ, WRITE, FOLDER, LOGO, MAX_UPLOAD,
    parse, status, connected, canWrite, available: () => status() !== "unavailable", account: () => (sync(), acct),
    expiresIn: () => connected() ? tok.exp - Date.now() : 0,
    // call inside a click: renews a token that's about to run out (GIS only), so live folders don't stop mid-work
    renewSoon() { if (connected() && !connecting && tok.via === "gis" && clientId() && tok.exp - Date.now() < 5 * 60e3) connect().catch(() => {}); },
    connect, disconnect, token, on: fn => { subs.add(fn); return () => subs.delete(fn); },
    list, meta, media, exportPdf, upload, mkdir, keysFor,
    norm, isFolder, isGoogleApp, kind, typeLabel, thumb, icon, openUrl, embedUrl, errText,
  };
})();
