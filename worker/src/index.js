/* Lumi AI: a Cloudflare Worker that lets signed-in Lumen users chat with Claude.
   The Anthropic API key never leaves this worker (it's a Cloudflare secret).
   POST /chat  { messages: [{role, content}], state: "…" }  with  Authorization: Bearer <Firebase ID token>
   Responds with the answer as a plain-text stream. */
import Anthropic from "@anthropic-ai/sdk";
import { createRemoteJWKSet, jwtVerify } from "jose";
import KB from "./kb.js";

const MODEL = "claude-opus-5-5";
const MAX_TURNS = 12, MAX_CHARS = 2000;
const RATE = { max: 20, windowMs: 10 * 60 * 1000 }; // per user, per worker instance
const ACTIONS = ["invite", "switch", "newws", "signin", "avatar", "settings", "theme", "newpage", "templates", "trash", "search", "reload", "check",
  "tasks", "chat", "feed", "calendar", "crm", "company", "drive", "automation"];

// Stable instructions + the whole help guide: identical on every request, so it is cached.
const SYSTEM = `You are Lumi, the friendly in-app helper for Lumen, a glassy Notion-style workspace with pages, tasks, chat, feed, calendar, CRM, company/HR, drive and automation. People ask you when they are stuck.

How to answer:
- Be warm and brief: usually 2-6 short sentences or a few numbered steps. No long essays.
- Use the exact names of buttons and menus from the guide below, and give concrete steps.
- Base answers on the guide and on the user's current app state. If the guide doesn't cover something, say what you know honestly and suggest the closest feature; never invent buttons or features.
- Use the app state to personalise: e.g. if they are the only member, say that's why teammates can't see their posts.
- Formatting: plain text with **bold** for UI names and numbered or "- " lists. No headings, no tables, no code blocks.
- You can add up to 2 one-tap buttons by writing [[action:NAME]] on the last line, using only these names: ${ACTIONS.join(", ")}.
- Never ask for passwords, API keys or payment details. If someone reports data loss or a bug you can't solve, suggest "Check my setup" and reloading, and to tell the workspace owner.
- Questions unrelated to Lumen: answer briefly if it's simple and harmless, then steer back to how Lumen can help.

# Lumen help guide
${KB}`;

const jwks = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const hits = new Map(); // uid -> timestamps

function cors(env, origin) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return { "Access-Control-Allow-Origin": ok ? origin : allowed[0] || "", "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" };
}
const json = (status, body, headers) => new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

async function verifyUser(req, env) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`, audience: env.FIREBASE_PROJECT_ID });
    return payload.sub ? payload : null;
  } catch { return null; }
}
function rateLimited(uid) {
  const now = Date.now(), list = (hits.get(uid) || []).filter(t => now - t < RATE.windowMs);
  if (list.length >= RATE.max) { hits.set(uid, list); return true; }
  list.push(now); hits.set(uid, list); return false;
}
// Keep only well-formed, size-capped user/assistant text turns, starting with a user turn.
function cleanMessages(raw) {
  const msgs = (Array.isArray(raw) ? raw : []).slice(-MAX_TURNS)
    .filter(m => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  return msgs.length && msgs[msgs.length - 1].role === "user" ? msgs : null;
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "", headers = cors(env, origin);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const url = new URL(req.url);
    if (url.pathname === "/health") return json(200, { ok: true, model: MODEL }, headers);
    if (req.method !== "POST" || url.pathname !== "/chat") return json(404, { error: "not_found" }, headers);
    if (!headers["Access-Control-Allow-Origin"] || headers["Access-Control-Allow-Origin"] !== origin) return json(403, { error: "origin_not_allowed" }, headers);

    const user = await verifyUser(req, env);
    if (!user) return json(401, { error: "sign_in_required" }, headers);
    if (rateLimited(user.sub)) return json(429, { error: "slow_down", message: "You're asking very fast. Please wait a few minutes." }, headers);

    let body; try { body = await req.json(); } catch { return json(400, { error: "bad_json" }, headers); }
    const messages = cleanMessages(body.messages);
    if (!messages) return json(400, { error: "bad_messages" }, headers);
    // The user's current situation rides on the latest question (it changes every time, so it stays out of the cached system prompt).
    const state = String(body.state || "").slice(0, 1500);
    const last = messages[messages.length - 1];
    last.content = `<app_state>\n${state}\n</app_state>\n\n${last.content}`;

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter(), enc = new TextEncoder();

    (async () => {
      try {
        const stream = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 4000,                          // help answers are short; this also caps cost per question
          output_config: { effort: "low" },          // chat: low effort is fast and plenty for help answers
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",                      // if a request is declined, retry on a suitable model automatically
          system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
          messages,
        });
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") await writer.write(enc.encode(event.delta.text));
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") await writer.write(enc.encode("\n\nSorry, I can't help with that one. Try asking about how to do something in Lumen."));
      } catch (err) {
        let msg = "Sorry, I couldn't reach the AI just now. Try again in a moment.";
        if (err instanceof Anthropic.AuthenticationError) msg = "The AI isn't set up correctly (invalid API key). Please tell the site owner.";
        else if (err instanceof Anthropic.RateLimitError) msg = "The AI is busy right now. Please try again in a minute.";
        else if (err instanceof Anthropic.APIError) msg = `The AI had a problem (${err.status}). Please try again.`;
        console.error(err);
        await writer.write(enc.encode(`\n\n${msg}`));
      } finally { await writer.close(); }
    })();

    return new Response(readable, { headers: { ...headers, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  },
};
