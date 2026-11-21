/* The invite email a new teammate receives (sent by worker/src/invite.js).
   Email-safe HTML: tables, inline styles, no SVG or web fonts, and a plain-text part. Gradients fall back to a solid colour (Outlook). */

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LEVELS = { admin: "Level 1 · Admin", manager: "Level 2 · Manager", member: "Level 3 · Member", guest: "Level 4 · Guest" };
const firstName = n => String(n || "").trim().split(/\s+/)[0] || "";
const initial = s => (String(s || "?").trim().match(/[\p{L}\p{N}]/u) || ["?"])[0].toUpperCase();

/**
 * @param {object} o
 * @param {string} o.inviter      inviter's display name
 * @param {string} o.inviterEmail inviter's email (reply-to)
 * @param {string} o.email        invitee email
 * @param {string} o.wsName       workspace name
 * @param {number} o.members      member count (including the invitee)
 * @param {string} o.level        admin | manager | member | guest
 * @param {string} o.link         one-click sign-in link
 * @param {string} o.site         site address (for the logo image and footer)
 * @param {string} [o.brand]      product name (default "Lumen")
 * @param {string} [o.note]       personal note from the inviter
 */
export function renderInvite(o) {
  const brand = o.brand || "Lumen", site = String(o.site || "").replace(/\/+$/, "");
  const inviter = o.inviter || o.inviterEmail || "A teammate", ws = o.wsName || "your team's workspace";
  const level = LEVELS[o.level] || LEVELS.member, others = Math.max(0, (o.members || 1) - 1);
  const subject = `${firstName(inviter) || inviter} invited you to join ${ws} on ${brand}`;
  const pre = `Join ${ws} in one click. ${others ? `${others} teammate${others === 1 ? " is" : "s are"} already there.` : ""}`;
  const note = String(o.note || "").trim().slice(0, 500);
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  const feature = (ic, t, d) => `
            <td valign="top" width="33%" style="padding:0 6px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5ff;border-radius:14px;">
                <tr><td style="padding:16px 14px;font-family:${font};">
                  <div style="font-size:22px;line-height:1;">${ic}</div>
                  <div style="font-size:14px;font-weight:700;color:#1e1b3a;margin-top:10px;">${t}</div>
                  <div style="font-size:12.5px;line-height:1.45;color:#6b6890;margin-top:4px;">${d}</div>
                </td></tr>
              </table>
            </td>`;

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
<style>
  @media (max-width:620px){ .wrap{width:100%!important} .px{padding-left:22px!important;padding-right:22px!important} .feat td{display:block!important;width:100%!important;padding:0 0 10px!important} .h1{font-size:26px!important} }
  a{color:#7c5cff}
</style>
</head>
<body style="margin:0;padding:0;background:#f1edff;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(pre)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f1edff" style="background:#f1edff;background-image:linear-gradient(160deg,#efe9ff 0%,#fde7f3 55%,#e3f1ff 100%);">
  <tr><td align="center" style="padding:36px 12px;">
    <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">

      <!-- brand -->
      <tr><td align="center" style="padding:0 0 18px;font-family:${font};">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td><img src="${esc(site)}/assets/icon-192.png" width="36" height="36" alt="" style="display:block;border:0;border-radius:10px;"></td>
          <td style="padding-left:10px;font-size:20px;font-weight:800;color:#1e1b3a;letter-spacing:-.3px;">${esc(brand)}</td>
        </tr></table>
      </td></tr>

      <!-- card -->
      <tr><td style="background:#ffffff;border-radius:24px;box-shadow:0 18px 50px -20px rgba(60,40,140,.35);overflow:hidden;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">

          <!-- hero -->
          <tr><td bgcolor="#7c5cff" style="background:#7c5cff;background-image:linear-gradient(135deg,#7c5cff 0%,#b04cf0 55%,#ec4899 100%);border-radius:24px 24px 0 0;padding:38px 40px 34px;font-family:${font};" class="px">
            <div style="font-size:13px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,.8);">You're invited 🎉</div>
            <div class="h1" style="font-size:30px;line-height:1.2;font-weight:800;color:#ffffff;margin-top:10px;letter-spacing:-.4px;">${esc(inviter)} wants you on the team</div>
            <div style="font-size:15px;line-height:1.55;color:rgba(255,255,255,.88);margin-top:10px;">Join <b style="color:#fff;">${esc(ws)}</b> on ${esc(brand)}: tasks, chat, calendar, CRM and files in one place.</div>
          </td></tr>

          <!-- workspace card -->
          <tr><td class="px" style="padding:28px 40px 6px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ece8fb;border-radius:18px;">
              <tr>
                <td width="64" style="padding:18px 0 18px 18px;" valign="middle">
                  <table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="52" height="52" align="center" valign="middle" bgcolor="#7c5cff"
                    style="width:52px;height:52px;border-radius:14px;background:#7c5cff;background-image:linear-gradient(135deg,#8b6dff,#ec4899);font-family:${font};font-size:24px;font-weight:800;color:#ffffff;">${esc(initial(ws))}</td></tr></table>
                </td>
                <td style="padding:18px 18px 18px 14px;font-family:${font};" valign="middle">
                  <div style="font-size:17px;font-weight:700;color:#1e1b3a;">${esc(ws)}</div>
                  <div style="font-size:13px;color:#6b6890;margin-top:3px;">${others ? `${others} teammate${others === 1 ? "" : "s"} already here` : "You'll be one of the first here"} · You'll join as <b style="color:#4c3bb5;">${esc(level)}</b></div>
                </td>
              </tr>
            </table>
          </td></tr>
${note ? `
          <!-- personal note -->
          <tr><td class="px" style="padding:14px 40px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td width="40" valign="top" style="padding-top:2px;">
                <table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="32" height="32" align="center" valign="middle" bgcolor="#f59e0b" style="width:32px;height:32px;border-radius:16px;background:#f59e0b;font-family:${font};font-size:14px;font-weight:800;color:#fff;">${esc(initial(inviter))}</td></tr></table>
              </td>
              <td style="background:#faf8ff;border-radius:4px 16px 16px 16px;padding:12px 16px;font-family:${font};font-size:14.5px;line-height:1.55;color:#3a3660;">
                ${esc(note).replace(/\n/g, "<br>")}
                <div style="font-size:12px;color:#8f8bb0;margin-top:6px;">— ${esc(firstName(inviter) || inviter)}</div>
              </td>
            </tr></table>
          </td></tr>` : ""}

          <!-- button -->
          <tr><td align="center" class="px" style="padding:28px 40px 8px;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td align="center" bgcolor="#7c5cff" style="border-radius:14px;background:#7c5cff;background-image:linear-gradient(135deg,#7c5cff,#c04ce6);box-shadow:0 10px 24px -10px rgba(124,92,255,.8);">
                <a href="${esc(o.link)}" target="_blank" style="display:inline-block;padding:16px 34px;font-family:${font};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:14px;">Join ${esc(ws)} &rarr;</a>
              </td>
            </tr></table>
            <div style="font-family:${font};font-size:12.5px;color:#8f8bb0;margin-top:12px;">One click signs you in as <b style="color:#5b5785;">${esc(o.email)}</b>. No password needed.</div>
          </td></tr>

          <!-- what's inside -->
          <tr><td class="px" style="padding:26px 34px 6px;">
            <div style="font-family:${font};font-size:13px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#8f8bb0;padding:0 6px 10px;">What's waiting for you</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="feat"><tr>
${feature("✅", "Tasks", "Plan work, set deadlines and see who's doing what.")}
${feature("💬", "Chat &amp; calls", "Message the team and jump on a video call.")}
${feature("📅", "Calendar &amp; CRM", "Meetings, clients and deals, all shared.")}
            </tr></table>
          </td></tr>

          <!-- fallback link + safety -->
          <tr><td class="px" style="padding:22px 40px 30px;font-family:${font};">
            <div style="border-top:1px solid #f0edfa;padding-top:18px;font-size:12.5px;line-height:1.6;color:#8f8bb0;">
              Button not working? Copy this link into your browser:<br>
              <a href="${esc(o.link)}" target="_blank" style="color:#7c5cff;word-break:break-all;">${esc(o.link)}</a><br><br>
              The link works once and expires after a while. If it has expired, open <a href="${esc(site)}" style="color:#7c5cff;">${esc(site.replace(/^https?:\/\//, ""))}</a> and sign in with this email address.
              Not expecting this? You can safely ignore this email.
            </div>
          </td></tr>
        </table>
      </td></tr>

      <!-- footer -->
      <tr><td align="center" style="padding:22px 20px 0;font-family:${font};font-size:12px;line-height:1.6;color:#8b86ad;">
        Sent by ${esc(brand)} on behalf of ${esc(inviter)}${o.inviterEmail ? ` (${esc(o.inviterEmail)})` : ""}. Reply to this email to reach them.
      </td></tr>
      <tr><td align="center" style="padding:12px 20px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td width="16" height="16" align="center" valign="middle" bgcolor="#4338CA" style="width:16px;height:16px;border-radius:4px;background:#4338CA;font-family:${font};font-size:10px;font-weight:800;color:#fff;line-height:16px;">P</td>
          <td style="padding-left:6px;font-family:${font};font-size:12px;color:#8b86ad;">Made by <a href="https://publishkaro.com" style="color:#4338CA;font-weight:700;text-decoration:none;">PublishKaro</a></td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    `${inviter} invited you to join ${ws} on ${brand}.`,
    "",
    note ? `"${note}"\n— ${firstName(inviter) || inviter}\n` : null,
    `You'll join as ${level}${others ? `, with ${others} teammate${others === 1 ? "" : "s"} already there` : ""}.`,
    "",
    `Join in one click (signs you in as ${o.email}):`,
    o.link,
    "",
    `The link works once and expires after a while. If it has expired, open ${site} and sign in with this email address.`,
    "Not expecting this? You can safely ignore this email.",
    "",
    `Sent by ${brand} on behalf of ${inviter}${o.inviterEmail ? ` (${o.inviterEmail})` : ""}. Made by PublishKaro.`,
  ].filter(x => x !== null).join("\n");

  return { subject, html, text };
}
