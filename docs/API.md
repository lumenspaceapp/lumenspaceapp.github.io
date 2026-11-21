# Lumen API

The Lumen API lets other tools read and write your workspace: Zapier or Make, a Google Sheet script, your website's contact
form, a nightly report, or your own code. It is a small REST API with JSON in and JSON out, protected by API keys that the
workspace owner or an admin creates in **Settings → API & integrations**.

- **Part 1** is for the workspace owner: a one-time setup, then creating keys. No coding needed.
- **Part 2** is the reference for developers: authentication, endpoints, data, errors and limits.

---

# Part 1 · Setup (workspace owner)

The API runs on the same Cloudflare worker as Lumi AI (the `worker` folder). The worker needs a Google **service account**
so it can reach your Firestore database. You do this once; after that, everything happens in Lumen's Settings.

## Step 1: get a service account key from Firebase

1. Open the [Firebase console](https://console.firebase.google.com/) and choose the project **lumen-notes-cde2c**.
2. Click the gear icon → **Project settings** → **Service accounts**.
3. Click **Generate new private key**, then **Generate key**. A `.json` file downloads.

> **Keep this file private.** It gives full access to the database. Never commit it to GitHub, email it or paste it into
> chat. After step 2 you can delete it from your computer.
> If it ever leaks: Google Cloud console → IAM & Admin → Service accounts → the `firebase-adminsdk-…` account → Keys → delete
> that key, then repeat steps 1 and 2.

The `firebase-adminsdk-…` account Firebase creates already has the access the API needs. If you use a different service
account, give it the **Cloud Datastore User** role.

## Step 2: give the key to the worker

The key is stored as a Cloudflare **secret** named `FIREBASE_SERVICE_ACCOUNT`. You paste it yourself; it never goes into the
code. Pick one of these:

**Option A, Cloudflare dashboard (easiest):** dash.cloudflare.com → **Workers & Pages** → your worker (`lumi-ai`) →
**Settings** → **Variables and Secrets** → **Add** → type **Secret**, name `FIREBASE_SERVICE_ACCOUNT`, and paste the whole
contents of the JSON file as the value → **Deploy**.

**Option B, command line** (in the `worker` folder):

```powershell
# Windows PowerShell
Get-Content C:\path\to\your-key.json -Raw | npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
```

```bash
# macOS / Linux / Git Bash
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT < /path/to/your-key.json
```

(Running `npx wrangler secret put FIREBASE_SERVICE_ACCOUNT` on its own asks you to paste the value, but a multi-line file
may not paste correctly into that prompt, so feed it the file as shown.)

## Step 3: deploy the worker

```bash
cd worker
npm install        # first time only
npx wrangler deploy
```

Wrangler prints the worker's address, for example `https://lumi-ai.your-name.workers.dev`. Your existing secrets (such as
`ANTHROPIC_API_KEY` for Lumi AI) stay as they are.

Check it: open `https://lumi-ai.your-name.workers.dev/v1` in a browser. You should see
`{"name":"Lumen API","version":1,"configured":true,…}`. `configured: false` means the secret from step 2 is missing.

## Step 4: tell Lumen where the API is

In `js/firebase-config.js`, the line `window.LUMI_AI_URL = "…"` holds the worker address. If it already has your worker's
address, you're done: Lumen uses it for the API too. Otherwise set it, or add a separate line just for the API:

```js
window.LUMEN_API_URL = "https://lumi-ai.your-name.workers.dev";
```

## Step 5: Firestore rules for API keys

Keys are stored in `workspaces/{ws}/apikeys/{keyId}`. Only the owner and admins may read or write them (members can't even
see them). Lumen's `firestore.rules` already includes this block inside `match /workspaces/{ws}`:

```
match /apikeys/{keyId} {
  allow read, write: if isMember(ws) && wsAdminNow();
}
```

A stricter version that also checks what's written (recommended):

```
match /apikeys/{keyId} {
  allow read, delete: if isMember(ws) && wsAdminNow();
  allow create: if isMember(ws) && wsAdminNow()
    && request.resource.data.keys().hasOnly(['name', 'hash', 'last4', 'scopes', 'collections', 'created', 'by', 'revoked', 'lastUsed'])
    && request.resource.data.hash is string && request.resource.data.hash.matches(keyId + '[0-9a-f]{40}')
    && request.resource.data.by == myEmail() && request.resource.data.revoked == false
    && request.resource.data.name is string && request.resource.data.name.size() <= 60;
  allow update: if isMember(ws) && wsAdminNow()
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['revoked'])
    && request.resource.data.revoked == true;
}
```

Publish the rules in the Firebase console (**Firestore Database → Rules → Publish**) or with `firebase deploy --only firestore:rules`.
The worker's service account isn't affected by these rules; it does its own checks (see Part 2).

## Step 6: create a key

1. In Lumen open **Settings → API & integrations** (you must be the owner or an admin, in a shared workspace).
2. Click **+ New key**, give it a name (for example "Zapier"), and choose:
   - **Read only** or **Read & write**.
   - **Everything allowed** or **Only some** collections (for example only Leads and Deals).
3. Click **Create key** and **copy the key right away**. It looks like `lmn_<workspace id>_<40 letters and digits>`.
   Lumen shows it only once and stores just a fingerprint (a SHA-256 hash), so nobody can show it to you again. If you
   lose it, delete it and create a new one.
4. Paste the key into the tool you're connecting.

The section also shows the API address, whether the worker is online, every key with when it was last used, and
copyable examples.

### Good habits

- **One key per tool.** Then you can switch one tool off without breaking the others.
- **Read only** unless the tool really needs to change things.
- **Revoke** a key you no longer use, or one that may have leaked. It stops working within a minute.
- Treat keys like passwords. Use them from servers and automation tools, **never in a public web page's code**, where
  anyone could copy them.

---

# Part 2 · Reference (developers)

## Base URL and authentication

```
https://<your-worker>.workers.dev/v1
```

Send the key in the `Authorization` header on every request:

```
Authorization: Bearer lmn_<workspaceId>_<secret>
```

A key belongs to exactly one workspace (its id is part of the key) and can only reach that workspace.

Request bodies are JSON (`Content-Type: application/json`). Responses are JSON. CORS is open (`*`), so browser code
works too, but keep keys out of public pages.

## Endpoints

| Method | Path | Scope | What it does |
|---|---|---|---|
| GET | `/v1` | none | Health check: `{ name, version, configured }` |
| GET | `/v1/me` | any key | The key and its workspace |
| GET | `/v1/{collection}?limit=50&pageToken=` | read | List documents |
| GET | `/v1/{collection}/{id}` | read | One document |
| POST | `/v1/{collection}` | write | Create a document |
| PATCH | `/v1/{collection}/{id}` | write | Update (merge into) a document |
| DELETE | `/v1/{collection}/{id}` | write | Delete a document |

### GET /v1/me

```bash
curl -H "Authorization: Bearer $LUMEN_KEY" https://<worker>/v1/me
```

```json
{
  "workspace": { "id": "AbC123…", "name": "Acme Ltd" },
  "key": { "id": "3f1c…", "name": "Zapier", "last4": "Qw3r", "scopes": ["read", "write"],
           "collections": ["tasks", "projects", "leads", "…"], "created": 1795282725186, "by": "owner@acme.com", "lastUsed": 1795282811000 },
  "limits": { "requestsPerMinute": 120, "maxBodyBytes": 262144, "maxPageSize": 200 }
}
```

`collections` is what this key may actually use.

### GET /v1/{collection}

```bash
curl -H "Authorization: Bearer $LUMEN_KEY" "https://<worker>/v1/deals?limit=100"
```

```json
{
  "data": [ { "id": "k9f2…", "title": "Website redesign", "amount": 4200, "stage": "proposal", "at": 1795200000000, "by": "anna@acme.com" } ],
  "nextPageToken": "AFTOeJw…"
}
```

- `limit`: 1–200, default 50.
- Documents come in id order. When `nextPageToken` isn't `null`, pass it as `?pageToken=…` to get the next page.
- Every document has its `id` plus its fields.

### GET /v1/{collection}/{id}

```bash
curl -H "Authorization: Bearer $LUMEN_KEY" https://<worker>/v1/tasks/k9f2abc
```

Returns the document, or `404 not_found`.

### POST /v1/{collection}

```bash
curl -X POST -H "Authorization: Bearer $LUMEN_KEY" -H "Content-Type: application/json" \
  -d '{"title":"Call Anna","status":"todo","assignee":"anna@acme.com","deadline":"2026-12-01"}' \
  https://<worker>/v1/tasks
```

Returns `201` with the new document (and a `Location` header).

- Lumen sets `at` (now, in milliseconds) and `by` (`"api:<key name>"`). Values you send for these are ignored.
- Optional `"id"` in the body chooses the document id (letters, digits and `_ - . : @ | +`, up to 200 characters). If a
  document with that id exists you get `409 conflict`, which makes retries safe. Without `id`, a random 20-character id is
  created.

### PATCH /v1/{collection}/{id}

```bash
curl -X PATCH -H "Authorization: Bearer $LUMEN_KEY" -H "Content-Type: application/json" \
  -d '{"stage":"won","custom":{"po":"PO-1182"}}' \
  https://<worker>/v1/deals/k9f2abc
```

Returns the whole updated document. The document must exist (`404` otherwise).

- Only the fields you send change. **Objects merge** (above, other `custom` fields stay); **lists and other values replace**
  the old value. To clear a field, send `null`.
- `id`, `at` and `by` can't be changed.
- Lumen apps usually "move to trash" instead of deleting: send `{"deleted": true}` to do the same.

### DELETE /v1/{collection}/{id}

```bash
curl -X DELETE -H "Authorization: Bearer $LUMEN_KEY" https://<worker>/v1/tasks/k9f2abc
```

Returns `{ "id": "k9f2abc", "deleted": true }`. Permanent: prefer `PATCH {"deleted": true}` if people may want it back.

## Collections

Only these collections are available. Settings, people, sign-in history, API keys, pages, chat and notifications are never
reachable. A key limited to some collections can use only those.

| Collection | What it holds | Useful fields |
|---|---|---|
| `tasks` | Tasks | `title, desc, status ("todo"\|"doing"\|"review"\|"done"), priority, assignee, participants[], observers[], deadline (YYYY-MM-DD), project, tags[], checklist, deleted` |
| `projects` | Projects and workgroups | `name, color, desc, members[], owner, type ("project"\|"group"\|"scrum"), archived` |
| `leads` | CRM leads | `name, companyName, email, phone, source, status ("new"\|"contacted"\|"qualified"\|"junk"\|"converted"), owner, value, notes, custom{}` |
| `deals` | CRM deals | `title, amount, pipeline, stage, contact, company, owner, close (YYYY-MM-DD), notes, products[], custom{}` |
| `contacts` | CRM contacts | `name, position, company, email, phone, owner, notes, custom{}` |
| `companies` | CRM companies | `name, type ("client"\|"vendor"\|"partner"), industry, website, phone, email, owner, notes, custom{}` |
| `products` | Product catalog | `name, sku, kind ("product"\|"service"), price, unit, tax, category, active` |
| `quotes` | Estimates and invoices | `kind ("estimate"\|"invoice"), number, title, deal, contact, company, items[], status, issue, due` |
| `activities` | CRM to-dos | `type, subject, desc, due (ms), done, owner, entity {col, id}` |
| `events` | Calendar events | `title, date, end, allDay, start ("HH:MM"), finish, where, desc, owner, attendees {}, calendar` |
| `feed` | Feed posts | `kind ("post"\|"announce"\|"poll"\|"thanks"), text, likes[], comments[], audience` |
| `inventory` | Warehouses and stock documents | `kind ("warehouse"\|"doc"), …` |
| `bookings` | Booking resources, services and bookings | `kind ("resource"\|"service"\|"booking"), …` |
| `absences` | Leave and absences | `who, type, from, to, note, status` |
| `timelog` | Time tracking | |
| `lists` / `listitems` | Custom lists and their rows | `listitems: list, values {}, deleted` |
| `kbspaces` / `kbarticles` | Knowledge base | `kbarticles: space, parent, title, body (HTML), tags, status` |
| `formsubs` | Web form entries waiting to become leads (**read only**) | `form, values {}, at, page` |

Notes on the data:

- **People** are identified by their lowercase email (`assignee`, `owner`, `by`, …).
- **Dates** are `"YYYY-MM-DD"` strings, **times of day** `"HH:MM"`, **timestamps** (`at`, `due`, `lastUsed`) are milliseconds
  since 1970. A few older fields are stored as Firestore timestamps; the API returns those as milliseconds too.
- **Links between records** are ids (`deal.contact` is a `contacts` id).
- Some collections mix kinds of documents with a `kind` field (task templates have `kind: "template"`, meeting rooms are
  `events` with `kind: "room"`). Skip the kinds you don't need.
- Documents with `deleted: true` are in Lumen's trash.
- Older documents may not have newer fields; treat missing fields as empty.
- Firestore doesn't allow a list directly inside a list (`[[1,2]]`); use a list of objects instead.
- Changes made through the API show up in Lumen immediately, but don't send Lumen notifications or run Lumen automations.

## Errors

Errors use an HTTP status and a JSON body:

```json
{ "error": { "code": "forbidden", "message": "This key is read-only." } }
```

| Status | code | Meaning |
|---|---|---|
| 400 | `bad_request`, `bad_json` | The body or a parameter isn't valid |
| 401 | `unauthorized` | Missing, malformed or unknown key |
| 401 | `key_revoked` | The key was revoked |
| 403 | `forbidden` | The key lacks the scope or the collection, or the collection is read-only |
| 404 | `not_found`, `unknown_collection` | No such document, endpoint or collection |
| 405 | `method_not_allowed` | Wrong HTTP method for that path |
| 409 | `conflict` | POST with an `id` that already exists |
| 413 | `payload_too_large` | Body over 256 KB |
| 429 | `rate_limited` | Too many requests; wait `Retry-After` seconds |
| 502 | `upstream_error` | Firestore had a problem; try again |
| 503 | `not_configured` | The worker's service account is missing or wrong (see Part 1, steps 1–2) |

## Limits

- **120 requests a minute per key** (per worker location). Responses carry `X-RateLimit-Limit` and
  `X-RateLimit-Remaining`; a `429` carries `Retry-After`.
- **256 KB** per request body; Firestore itself caps a document at 1 MB.
- **200** documents per page.
- Every request reads from your Firebase project, so it counts toward the Firebase plan's daily quota (the free plan
  allows about 50,000 reads and 20,000 writes a day for the whole project). A revoked key may keep working for up to
  30 seconds, because key checks are briefly cached.

## How it's secured

- The plain key is shown once in Lumen. Firestore stores only its SHA-256 hash, `last4` and settings at
  `workspaces/{ws}/apikeys/{first 24 hex characters of the hash}`. Members can't read that collection; only the owner and
  admins can.
- On each request the worker hashes the key, looks up that record, compares the full hash in constant time, and rejects
  revoked keys. It then allows only the key's own workspace, only the collections listed above (narrowed by the key's
  list), only the key's scopes, with a per-key rate limit and a body size limit.
- The worker reaches Firestore with the service account from `FIREBASE_SERVICE_ACCOUNT` (a signed RS256 token exchanged
  for a short-lived Google access token, cached until it expires). The service account skips Firestore rules, so all
  of the checks above happen in the worker (`worker/src/api.js`).
- The worker updates `lastUsed` on the key at most once a minute.

## Example: JavaScript (Node 18+ or a server)

```js
const BASE = "https://<worker>/v1", KEY = process.env.LUMEN_KEY;
const api = async (method, path, body) => {
  const res = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (!res.ok) throw new Error(`${json.error.code}: ${json.error.message}`);
  return json;
};

// every open deal, page by page
let token = null, deals = [];
do {
  const page = await api("GET", "/deals?limit=200" + (token ? "&pageToken=" + encodeURIComponent(token) : ""));
  deals.push(...page.data.filter(d => !d.deleted)); token = page.nextPageToken;
} while (token);

// a lead from your website
await api("POST", "/leads", { name: "Ravi Shah", email: "ravi@example.com", source: "Website", status: "new", owner: "sales@acme.com", activities: [] });
```

## Example: Python

```python
import os, requests
BASE, KEY = "https://<worker>/v1", os.environ["LUMEN_KEY"]
H = {"Authorization": f"Bearer {KEY}"}

tasks = requests.get(f"{BASE}/tasks", headers=H, params={"limit": 50}).json()["data"]
requests.patch(f"{BASE}/tasks/{tasks[0]['id']}", headers=H, json={"status": "done"}).raise_for_status()
```

## Example: Zapier or Make

Use a **Webhooks** / **HTTP** step:

- URL: `https://<worker>/v1/leads`, method **POST**
- Headers: `Authorization: Bearer lmn_…` and `Content-Type: application/json`
- Body (JSON): `{"name": "{{name}}", "email": "{{email}}", "source": "Zapier", "status": "new"}`

## Windows note

The `curl` examples use single quotes around JSON, which works in Git Bash, WSL, macOS and Linux. In PowerShell, use
`Invoke-RestMethod` instead:

```powershell
$h = @{ Authorization = "Bearer $env:LUMEN_KEY" }
Invoke-RestMethod -Method Post -Uri "https://<worker>/v1/tasks" -Headers $h -ContentType "application/json" -Body '{"title":"Call Anna","status":"todo"}'
```
