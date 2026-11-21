# Branded invite emails

When someone is invited to a workspace, Lumen can send a designed email ("Piyush wants you on the team", workspace card,
personal note, a big **Join** button and what's inside) instead of Firebase's plain "Sign in to …" email.
Preview: [invite-email-preview.html](invite-email-preview.html). Template: `worker/src/invite-email.js`.

The **Join** button is a one-click sign-in link made by Firebase (same as before), so nothing changes for the person invited
except the look of the email. Replies go to the person who sent the invite.

Until this is set up, Lumen keeps sending Firebase's plain email automatically.

## Setup (once)

1. **Lumen worker** deployed with the `FIREBASE_SERVICE_ACCOUNT` secret (see [API.md](API.md), Part 1).
2. **An email service.** Easiest without your own domain: **Brevo** (free, 300 emails a day).
   - Create an account at brevo.com → **Senders, domains & dedicated IPs → Senders → Add a sender** with the address
     invites should come from, and confirm it from your inbox.
   - **SMTP & API → API keys → Generate a new API key**, then in the `worker` folder:
     `npx wrangler secret put BREVO_API_KEY` and paste it.
   - Once you own a domain (e.g. hubvio.app), verify the domain in Brevo too so emails don't land in spam.
   - Prefer Resend? Verify your domain there and use `npx wrangler secret put RESEND_API_KEY` instead.
3. **Sender details:** Cloudflare dashboard → Workers → `lumi-ai` → **Settings → Variables and secrets → Add**
   (type Text): `MAIL_FROM` = the verified sender address, `MAIL_FROM_NAME` = `Lumen` (or your brand),
   optionally `BRAND_NAME` and `SITE_URL`.
4. `npx wrangler deploy`, and make sure `window.LUMI_AI_URL` in `js/firebase-config.js` is the worker address.

Test: invite yourself (another address) from **Members & levels**. The email should arrive within a minute.

## Safety
- Only signed-in members of a workspace can trigger it, only from the Lumen site, and only for addresses the workspace has
  already invited (the database rules decide who may invite). It can't be used to email arbitrary people.
- Limits: 30 invites an hour per person, and one email per address every 2 minutes.
