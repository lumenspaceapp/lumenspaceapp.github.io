/* POST /invite  { ws, email, note? }   Authorization: Bearer <Firebase ID token of the inviter>
   Sends the branded invite email (worker/src/invite-email.js) with a one-click sign-in link.
   The app first adds the person to the workspace's members (the Firestore rules decide who may invite), then calls this.
   Safety: the inviter must be a member of the workspace, and the invitee must already be in its members list, so this can
   only email people a workspace really invited (never an open mail relay). Rate-limited per inviter and per invitee.

   Needs on the worker:
   - secret FIREBASE_SERVICE_ACCOUNT (same as the API, docs/API.md): reads the workspace and creates the sign-in link
   - an email provider: secret BREVO_API_KEY (Brevo, free 300 emails/day) or RESEND_API_KEY (Resend)
   - vars MAIL_FROM (a sender address verified at that provider), optional MAIL_FROM_NAME, SITE_URL, BRAND_NAME
   Without them it answers 503 { error: "mail_not_configured" } and the app falls back to Firebase's plain sign-in email. */
import { accessToken, fsCall, fromDoc, ApiError } from "./api.js";
import { renderInvite } from "./invite-email.js";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const perInviter = new Map(); // uid -> timestamps (30 per hour)
const perInvitee = new Map(); // ws|email -> last sent ms (one per 2 minutes)

function limited(map, key, max, windowMs) {
  const now = Date.now(), list = (map.get(key) || []).filter(t => now - t < windowMs);
  if (list.length >= max) { map.set(key, list); return true; }
  list.push(now); map.set(key, list); return false;
}

async function signInLink(env, email, continueUrl) {
  const token = await accessToken(env);
  const project = env.FIREBASE_PROJECT_ID;
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(project)}/accounts:sendOobCode`, {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ requestType: "EMAIL_SIGNIN", email, continueUrl, canHandleCodeInApp: true, returnOobLink: true }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.oobLink) { console.error("oob", res.status, j.error?.message); throw new ApiError(502, "link_failed", "Couldn't create the sign-in link (" + (j.error?.message || res.status) + ")."); }
  return j.oobLink;
}

async function sendMail(env, { to, subject, html, text, replyTo, replyName }) {
  const from = env.MAIL_FROM, fromName = env.MAIL_FROM_NAME || env.BRAND_NAME || "Lumen";
  if (env.BREVO_API_KEY) {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST", headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ sender: { email: from, name: fromName }, to: [{ email: to }], subject, htmlContent: html, textContent: text,
        ...(replyTo ? { replyTo: { email: replyTo, name: replyName || replyTo } } : {}), tags: ["invite"] }),
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); console.error("brevo", res.status, j); throw new ApiError(502, "send_failed", "The email service refused the message (" + (j.message || res.status) + ")."); }
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `${fromName} <${from}>`, to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!res.ok) { const j = await res.json().catch(() => ({})); console.error("resend", res.status, j); throw new ApiError(502, "send_failed", "The email service refused the message (" + (j.message || res.status) + ")."); }
}

export async function handleInvite(req, env, user, json) {
  if (!env.MAIL_FROM || !(env.BREVO_API_KEY || env.RESEND_API_KEY) || !env.FIREBASE_SERVICE_ACCOUNT) return json(503, { error: "mail_not_configured" });
  let body; try { body = await req.json(); } catch { return json(400, { error: "bad_json" }); }
  const ws = String(body?.ws || ""), email = String(body?.email || "").trim().toLowerCase();
  const note = String(body?.note || "").slice(0, 500);
  const inviterEmail = String(user.email || "").toLowerCase();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(ws) || !EMAIL_RE.test(email) || email.length > 254) return json(400, { error: "bad_request" });
  if (!inviterEmail) return json(403, { error: "not_allowed" });
  if (limited(perInviter, user.sub, 30, 3600000)) return json(429, { error: "slow_down", message: "That's a lot of invites. Please wait a while." });
  if (limited(perInvitee, ws + "|" + email, 1, 120000)) return json(429, { error: "slow_down", message: "An invite was just sent to this address. Wait a couple of minutes before resending." });

  try {
    const doc = fromDoc(await fsCall(env, "GET", `workspaces/${encodeURIComponent(ws)}`));
    const members = (doc.members || []).map(m => String(m).toLowerCase());
    if (!members.includes(inviterEmail)) return json(403, { error: "not_allowed" });
    if (!members.includes(email)) return json(403, { error: "not_invited", message: "Add the person to the workspace first." });
    const site = (env.SITE_URL || "https://lumenspaceapp.github.io").replace(/\/+$/, "");
    const link = await signInLink(env, email, `${site}/?ws=${encodeURIComponent(ws)}`);
    const inviter = String(user.name || "").trim() || inviterEmail.split("@")[0];
    const mail = renderInvite({ inviter, inviterEmail, email, wsName: doc.name, members: members.length, level: (doc.roles || {})[email] || "member",
      link, site, brand: env.BRAND_NAME || "Lumen", note });
    await sendMail(env, { to: email, ...mail, replyTo: inviterEmail, replyName: inviter });
    return json(200, { ok: true });
  } catch (e) {
    if (e instanceof ApiError) return json(e.status === 404 ? 404 : e.status, { error: e.code, message: e.message });
    console.error(e);
    return json(500, { error: "server_error" });
  }
}
