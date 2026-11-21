/* Lumen public API (worker/src/api.js), routed from index.js for every path under /v1.
   Lets other tools read and write one workspace with an API key that an owner or admin creates in
   Settings -> API & integrations (js/api-keys.js). Full guide: docs/API.md.

     GET    /v1                  no key: { name, version, configured } (Settings uses it to check the worker is live)
     GET    /v1/me               the key and its workspace
     GET    /v1/{col}?limit=50&pageToken=…    list documents (ordered by id), { data, nextPageToken }
     GET    /v1/{col}/{id}       one document
     POST   /v1/{col}            create (optional "id" in the body); sets at = now, by = "api:<key name>"
     PATCH  /v1/{col}/{id}       merge into an existing document (objects merge, arrays and values replace)
     DELETE /v1/{col}/{id}       delete a document

   Auth: "Authorization: Bearer lmn_<workspaceId>_<40 letters/digits>". The key is SHA-256 hashed; the record lives at
   workspaces/<ws>/apikeys/<first 24 hex of the hash> as { name, hash, last4, scopes, collections, created, by, revoked, lastUsed }.
   The worker talks to Firestore's REST API with a Google service account (secret FIREBASE_SERVICE_ACCOUNT = the JSON key).
   A service account bypasses the security rules, so everything is enforced here: only the key's workspace, only the
   collections in ALLOWED (narrowed by the key's own list), read/write scopes, revocation, a per-key rate limit and body size. */

const VERSION = 1;
const ALLOWED = ["tasks", "projects", "leads", "deals", "contacts", "companies", "products", "quotes", "activities", "events",
  "feed", "inventory", "bookings", "absences", "timelog", "lists", "listitems", "kbspaces", "kbarticles", "formsubs"];
const READ_ONLY = new Set(["formsubs"]);
const RATE = { max: 120, windowMs: 60 * 1000 };   // per key, per worker instance
const MAX_BODY = 256 * 1024;                       // bytes (Firestore's own limit is 1 MB per document)
const MAX_DEPTH = 16;                              // nesting of objects/arrays in a body
const KEY_CACHE_MS = 30 * 1000;                    // a revoked key stops working within this long
const LAST_USED_MS = 60 * 1000;                    // write lastUsed at most once a minute per key
const KEY_RE = /^lmn_([A-Za-z0-9]{1,64})_([A-Za-z0-9]{40})$/;
const ID_RE = /^[A-Za-z0-9_\-.:@|+]{1,200}$/;
const TOKEN_URL = "https://oauth2.googleapis.com/token";
// datastore: Firestore REST; identitytoolkit: one-click sign-in links for invite emails (worker/src/invite.js)
const SCOPE = "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit";

const CORS = {
  "Access-Control-Allow-Origin": "*",               // keys are bearer tokens (no cookies), so any site or tool may call
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Expose-Headers": "Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining",
  "Access-Control-Max-Age": "86400",
};

export class ApiError extends Error {
  constructor(status, code, message, headers) { super(message); this.status = status; this.code = code; this.headers = headers || {}; }
}
const reply = (status, body, extra) => new Response(body === null ? null : JSON.stringify(body), {
  status, headers: { ...CORS, ...(extra || {}), ...(body === null ? {} : { "Content-Type": "application/json; charset=utf-8" }), "Cache-Control": "no-store" } });
const fail = (status, code, message, headers) => { throw new ApiError(status, code, message, headers); };

/* ---------- Firestore typed values <-> plain JSON ---------- */
export function toValue(v, depth = 0) {
  if (depth > MAX_DEPTH) fail(400, "bad_request", "The body is nested too deeply.");
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    if (!Number.isFinite(v)) fail(400, "bad_request", "Numbers must be finite.");
    return Number.isSafeInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) {
    if (v.some(Array.isArray)) fail(400, "bad_request", "Lists inside lists aren't supported (Firestore rule). Wrap inner lists in objects.");
    return { arrayValue: v.length ? { values: v.map(x => toValue(x, depth + 1)) } : {} };
  }
  if (typeof v === "object") return { mapValue: { fields: toFields(v, depth + 1) } };
  fail(400, "bad_request", "Unsupported value type: " + typeof v);
}
export function toFields(obj, depth = 0) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) { checkField(k); out[k] = toValue(v, depth); }
  return out;
}
export function fromValue(v) {
  if (!v || typeof v !== "object") return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) { const n = Number(v.doubleValue); return Number.isFinite(n) ? n : null; }
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) { const t = Date.parse(v.timestampValue); return Number.isNaN(t) ? v.timestampValue : t; } // milliseconds, like Lumen's own "at"
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
  if ("mapValue" in v) return fromFields(v.mapValue.fields);
  if ("bytesValue" in v) return v.bytesValue;          // base64 string
  if ("referenceValue" in v) return v.referenceValue;  // full document path
  if ("geoPointValue" in v) return { latitude: v.geoPointValue.latitude || 0, longitude: v.geoPointValue.longitude || 0 };
  return null;
}
export function fromFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fromValue(v);
  return out;
}
export function fromDoc(doc) {
  const last = String(doc.name || "").split("/").pop();
  let id = last; try { id = decodeURIComponent(last); } catch { /* keep as is */ }
  return { id, ...fromFields(doc.fields) };
}
function checkField(k) {
  if (!k || new TextEncoder().encode(k).length > 1500 || /^__.*__$/.test(k)) fail(400, "bad_request", `Field name "${String(k).slice(0, 40)}" isn't allowed.`);
}
const plainObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
// Field paths for a merge, like Firestore's set(…, { merge: true }): non-empty objects merge, everything else replaces.
export function fieldPaths(obj, prefix = []) {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = [...prefix, k];
    if (plainObject(v) && Object.keys(v).length) out.push(...fieldPaths(v, p));
    else out.push(p.map(quotePath).join("."));
  }
  return out;
}
export const quotePath = s => (/^[A-Za-z_][A-Za-z_0-9]*$/.test(s) ? s : "`" + s.replace(/[\\`]/g, m => "\\" + m) + "`");

/* ---------- hashing ---------- */
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
export const sha256Hex = async text => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
export function sameHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------- Google service-account access token (RS256 JWT signed with WebCrypto, cached) ---------- */
let tokenCache = null, tokenPending = null, saCache = null;
function serviceAccount(env) {
  const raw = (env.FIREBASE_SERVICE_ACCOUNT || "").trim();
  if (!raw) fail(503, "not_configured", "The API isn't set up yet: the FIREBASE_SERVICE_ACCOUNT secret is missing on the worker.");
  if (saCache && saCache.raw === raw) return saCache.sa;
  let sa;
  try { sa = JSON.parse(raw.startsWith("{") ? raw : atob(raw)); } catch { sa = null; }
  if (!sa || !sa.client_email || !sa.private_key) fail(503, "not_configured", "The FIREBASE_SERVICE_ACCOUNT secret isn't a valid service-account JSON key.");
  saCache = { raw, sa };
  return sa;
}
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = s => b64url(new TextEncoder().encode(s));
function pemToDer(pem) {
  const body = String(pem).replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
export async function signJwt(sa, now = Math.floor(Date.now() / 1000)) {
  const header = { alg: "RS256", typ: "JWT", ...(sa.private_key_id ? { kid: sa.private_key_id } : {}) };
  const claims = { iss: sa.client_email, sub: sa.client_email, scope: SCOPE, aud: sa.token_uri || TOKEN_URL, iat: now, exp: now + 3600 };
  const input = b64urlText(JSON.stringify(header)) + "." + b64urlText(JSON.stringify(claims));
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  return input + "." + b64url(sig);
}
export async function accessToken(env) {
  const sa = serviceAccount(env);
  if (tokenCache && tokenCache.email === sa.client_email && tokenCache.exp - 120000 > Date.now()) return tokenCache.token;
  if (tokenPending) return tokenPending;
  tokenPending = (async () => {
    let assertion;
    try { assertion = await signJwt(sa); } catch (e) { console.error(e); fail(503, "not_configured", "Couldn't read the private key in FIREBASE_SERVICE_ACCOUNT."); }
    const res = await fetch(sa.token_uri || TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) { console.error("token", res.status, j); fail(503, "not_configured", "Google refused the service account (" + (j.error_description || j.error || res.status) + ")."); }
    tokenCache = { token: j.access_token, email: sa.client_email, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
    return tokenCache.token;
  })();
  try { return await tokenPending; } finally { tokenPending = null; }
}

/* ---------- Firestore REST ---------- */
const enc = s => encodeURIComponent(s);
function docsBase(env) {
  const project = env.FIREBASE_PROJECT_ID || serviceAccount(env).project_id;
  return `https://firestore.googleapis.com/v1/projects/${enc(project)}/databases/(default)/documents`;
}
export async function fsCall(env, method, path, { query, body } = {}) {
  const token = await accessToken(env);
  const url = docsBase(env) + "/" + path + (query && String(query) ? "?" + query : "");
  const res = await fetch(url, { method, headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (res.ok) return j;
  const status = j.error?.status || "", msg = j.error?.message || "";
  if (res.status === 404 || status === "NOT_FOUND") throw new ApiError(404, "not_found", "No such document.");
  if (status === "ALREADY_EXISTS" || res.status === 409) throw new ApiError(409, "conflict", "A document with that id already exists.");
  if (status === "FAILED_PRECONDITION") throw new ApiError(404, "not_found", "No such document.");
  if (status === "INVALID_ARGUMENT") throw new ApiError(400, "bad_request", msg || "Firestore rejected the request.");
  if (res.status === 401 || res.status === 403) { tokenCache = null; console.error("firestore auth", res.status, msg); throw new ApiError(503, "not_configured", "The service account can't access Firestore. Give it the \"Cloud Datastore User\" (or Firebase Admin) role."); }
  if (res.status === 429 || status === "RESOURCE_EXHAUSTED") throw new ApiError(429, "rate_limited", "Firestore quota reached. Try again later.", { "Retry-After": "60" });
  console.error("firestore", res.status, msg);
  throw new ApiError(502, "upstream_error", "Firestore had a problem (" + res.status + "). Try again.");
}
const docPath = (ws, col, id) => `workspaces/${enc(ws)}/${enc(col)}` + (id ? "/" + enc(id) : "");

/* ---------- keys, rate limit ---------- */
const keyCache = new Map();   // keyId -> { at, rec }
const lastUsedAt = new Map(); // keyId -> ms of our last lastUsed write
const hits = new Map();       // keyId -> { start, n }

async function authenticate(req, env, ctx) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("Authorization") || "");
  if (!m) fail(401, "unauthorized", "Send your API key as \"Authorization: Bearer lmn_…\".");
  const key = m[1], parts = KEY_RE.exec(key);
  if (!parts) fail(401, "unauthorized", "That doesn't look like a Lumen API key.");
  const ws = parts[1], hash = await sha256Hex(key), keyId = hash.slice(0, 24);
  const cacheKey = ws + "/" + keyId;
  let hit = keyCache.get(cacheKey), rec;
  if (hit && Date.now() - hit.at < KEY_CACHE_MS) rec = hit.rec;
  else {
    try { rec = fromDoc(await fsCall(env, "GET", docPath(ws, "apikeys", keyId))); }
    catch (e) { if (e.code === "not_found") rec = null; else throw e; }
    keyCache.set(cacheKey, { at: Date.now(), rec });
    if (keyCache.size > 500) keyCache.delete(keyCache.keys().next().value);
  }
  if (!rec || !sameHex(String(rec.hash || "").toLowerCase(), hash)) fail(401, "unauthorized", "Unknown API key. Check it was copied completely.");
  if (rec.revoked) fail(401, "key_revoked", "This API key was revoked. Ask a workspace admin for a new one.");

  // rate limit (fixed one-minute window)
  const now = Date.now();
  let w = hits.get(cacheKey);
  if (!w || now - w.start >= RATE.windowMs) { w = { start: now, n: 0 }; hits.set(cacheKey, w); }
  w.n++;
  const remaining = Math.max(0, RATE.max - w.n), limitHeaders = { "X-RateLimit-Limit": String(RATE.max), "X-RateLimit-Remaining": String(remaining) };
  if (w.n > RATE.max) fail(429, "rate_limited", `Too many requests: at most ${RATE.max} a minute per key.`, { ...limitHeaders, "Retry-After": String(Math.ceil((w.start + RATE.windowMs - now) / 1000)) });
  if (hits.size > 2000) for (const [k, v] of hits) if (now - v.start >= RATE.windowMs) hits.delete(k);

  // lastUsed, at most once a minute (in the background, never fails the request)
  const prev = Math.max(lastUsedAt.get(cacheKey) || 0, Number(rec.lastUsed) || 0);
  if (now - prev >= LAST_USED_MS) {
    lastUsedAt.set(cacheKey, now); rec.lastUsed = now;
    const write = fsCall(env, "PATCH", docPath(ws, "apikeys", keyId), {
      query: "updateMask.fieldPaths=lastUsed&currentDocument.exists=true", body: { fields: { lastUsed: toValue(now) } } }).catch(e => console.warn("lastUsed", e.message));
    if (ctx && ctx.waitUntil) ctx.waitUntil(write);
  }

  const scopes = Array.isArray(rec.scopes) && rec.scopes.length ? rec.scopes : ["read"];
  const limited = Array.isArray(rec.collections) ? rec.collections.filter(c => ALLOWED.includes(c)) : [];
  return { ws, keyId, rec, scopes, collections: limited.length ? limited : ALLOWED.slice(), limitHeaders };
}

async function readBody(req) {
  const len = Number(req.headers.get("Content-Length") || 0);
  if (len > MAX_BODY) fail(413, "payload_too_large", `The body is too big (max ${MAX_BODY / 1024} KB).`);
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY) fail(413, "payload_too_large", `The body is too big (max ${MAX_BODY / 1024} KB).`);
  let body;
  try { body = JSON.parse(text); } catch { fail(400, "bad_json", "The body must be JSON."); }
  if (!plainObject(body)) fail(400, "bad_json", "The body must be a JSON object.");
  return body;
}
function checkId(id, what = "id") {
  if (typeof id !== "string" || !ID_RE.test(id) || id === "." || id === ".." || /^__.*__$/.test(id)) fail(400, "bad_request", `That ${what} isn't valid (letters, digits and _ - . : @ | + only, up to 200 characters).`);
  return id;
}
const newId = () => { const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", r = crypto.getRandomValues(new Uint8Array(20)); return [...r].map(b => a[b % 62]).join(""); };

/* ---------- router ---------- */
export async function handleApi(req, env, ctx) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  let extra = {};
  try {
    const parts = url.pathname.replace(/^\/v1\/?/, "").split("/").filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return fail(400, "bad_request", "Bad path."); } });
    if (!parts.length) {
      if (req.method !== "GET") fail(405, "method_not_allowed", "Use GET.");
      return reply(200, { name: "Lumen API", version: VERSION, configured: !!(env.FIREBASE_SERVICE_ACCOUNT || "").trim(), docs: "https://github.com/lumenspaceapp/lumenspaceapp.github.io/blob/main/docs/API.md" });
    }
    if (parts.length > 2) fail(404, "not_found", "Unknown endpoint.");
    const auth = await authenticate(req, env, ctx);
    extra = auth.limitHeaders;
    const can = s => auth.scopes.includes(s);

    if (parts[0] === "me" && parts.length === 1) {
      if (req.method !== "GET") fail(405, "method_not_allowed", "Use GET.");
      let name = "";
      try { name = fromDoc(await fsCall(env, "GET", `workspaces/${enc(auth.ws)}`, { query: "mask.fieldPaths=name" })).name || ""; } catch (e) { if (e.code !== "not_found") throw e; }
      const r = auth.rec;
      return reply(200, {
        workspace: { id: auth.ws, name },
        key: { id: auth.keyId, name: r.name || "", last4: r.last4 || "", scopes: auth.scopes, collections: auth.collections, created: r.created || null, by: r.by || "", lastUsed: r.lastUsed || null },
        limits: { requestsPerMinute: RATE.max, maxBodyBytes: MAX_BODY, maxPageSize: 200 },
      }, extra);
    }

    const col = parts[0], id = parts[1] ? checkId(parts[1]) : null;
    if (!ALLOWED.includes(col)) fail(404, "unknown_collection", `"${col.slice(0, 40)}" isn't available through the API. Allowed: ${ALLOWED.join(", ")}.`);
    if (!auth.collections.includes(col)) fail(403, "forbidden", `This key can't use "${col}". It's limited to: ${auth.collections.join(", ")}.`);
    const write = req.method !== "GET";
    if (write && !can("write")) fail(403, "forbidden", "This key is read-only.");
    if (!write && !can("read")) fail(403, "forbidden", "This key can't read.");
    if (write && READ_ONLY.has(col)) fail(403, "forbidden", `"${col}" is read-only through the API.`);
    const by = "api:" + String(auth.rec.name || "key").slice(0, 60);

    if (req.method === "GET" && !id) {
      const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10) || 50));
      const q = new URLSearchParams({ pageSize: String(limit) });
      const pt = url.searchParams.get("pageToken");
      if (pt) { if (pt.length > 2000) fail(400, "bad_request", "Bad pageToken."); q.set("pageToken", pt); }
      const j = await fsCall(env, "GET", docPath(auth.ws, col), { query: q });
      return reply(200, { data: (j.documents || []).map(fromDoc), nextPageToken: j.nextPageToken || null }, extra);
    }
    if (req.method === "GET") return reply(200, fromDoc(await fsCall(env, "GET", docPath(auth.ws, col, id))), extra);

    if (req.method === "POST" && !id) {
      const body = await readBody(req);
      const docId = body.id !== undefined && body.id !== null && body.id !== "" ? checkId(String(body.id)) : newId();
      const { id: _drop, ...rest } = body;
      const data = { ...rest, at: Date.now(), by };
      const j = await fsCall(env, "POST", docPath(auth.ws, col), { query: new URLSearchParams({ documentId: docId }), body: { fields: toFields(data) } });
      return reply(201, fromDoc(j), { ...extra, Location: `/v1/${enc(col)}/${enc(docId)}` });
    }
    if (req.method === "PATCH" && id) {
      const body = await readBody(req);
      const { id: _i, at: _a, by: _b, ...patch } = body;   // id, at and by can't be changed
      if (!Object.keys(patch).length) fail(400, "bad_request", "Nothing to update.");
      const fields = toFields(patch);
      const q = new URLSearchParams();
      for (const p of fieldPaths(patch)) q.append("updateMask.fieldPaths", p);
      q.set("currentDocument.exists", "true");
      return reply(200, fromDoc(await fsCall(env, "PATCH", docPath(auth.ws, col, id), { query: q, body: { fields } })), extra);
    }
    if (req.method === "DELETE" && id) {
      await fsCall(env, "DELETE", docPath(auth.ws, col, id), { query: "currentDocument.exists=true" });
      return reply(200, { id, deleted: true }, extra);
    }
    fail(405, "method_not_allowed", id ? "Use GET, PATCH or DELETE on a document." : "Use GET or POST on a collection.");
  } catch (e) {
    if (e instanceof ApiError) return reply(e.status, { error: { code: e.code, message: e.message } }, { ...extra, ...e.headers });
    console.error(e);
    return reply(500, { error: { code: "internal", message: "Something went wrong in the API worker." } }, extra);
  }
}
