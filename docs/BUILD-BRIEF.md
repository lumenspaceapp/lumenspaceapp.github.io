# Brief for builders working on one Lumen app

Lumen (this folder) is a vanilla-JS team workspace in the style of Bitrix24, live at https://lumenspaceapp.github.io. No build step: classic `<script>` files loaded by `index.html`. Notion-style pages are switched off (`js/features.js`); the product is the apps in `js/apps/*.js`.

## Globals you can use (read the files for details)
- **UI** (`js/ui.js`): `h(tag, attrs, ...children)` element builder (attrs: `class`, `text`, `html`, `style` object, `dataset`, `onclick`…, falsy children are skipped), `esc`, `icon(name)`, `popover(anchor, el, {align})` returns `{close}`, `menu(anchor, items, {align})`, `modal(title, body, opts)` returns `{el, close}`, `confirm(msg, okLabel)` → Promise<bool>, `toast(msg, {label, run})`, `timeAgo(ts)`, `liveDraw(root, draw)` (wrap a redraw so it waits while someone is typing in a field inside `root`).
- **Data** (`js/data.js`): `list(col)`, `get(col, id)`, `on(col, fn)` → unsubscribe, `add(col, obj, id?)` → id (adds `at` timestamp and `by` = my key), `update(col, id, patch)` (merge), `arr(col, id, field, value, add=true)` (add/remove one array item safely when several people edit at once: likes, members, votes, readBy), `remove(col, id)`, `notify(toKey, htmlTitle, link, plainPreview)`, `me()` → `{key, name, email, avatar}`, `people()` → members with `{key, name, email, title, dept, online…}`, `person(key)`.
- **Apps** (`js/apps.js`): `register(name, {title, icon, render})`, `form(title, fields, values, opts)` (field types: text, textarea, select, date, time, number, person, **people**, color, checkbox), `panel(title, body, actions)` (Bitrix-style slider, returns `{el, close, onClose}`), `header`, `tabs`, `avatar(person, size)`, `avatars(keys, size, max)`, `personPicker(anchor, onPick, {allowNone})`, `peoplePicker(anchor, selectedKeys, onChange)`, `pickFiles(multiple)` → File[], `attach(files)` → `[{id, name, type, size}]` (stores files ≤700 KB), `fileChip(att, onRemove?)`, `openFile(att)`, `mentioned(text)` → person keys for `@firstname`, `mentionAssist(inputEl)` (suggests teammates after "@"), `today()`, `iso(date)`, `addDays(isoDate, n)`, `fmtDate(isoDate)`, `money(n)`, `badge(app, n)`, `go(app)`, `empty(icon, text, button)`, `onWorkspace` (Set of callbacks run when the workspace changes).
- **Notify** (`js/notify.js`): `Notify.alert({title, body, link, person, icon, tag})` shows a glass card + chime, or a system notification when Lumen is in the background. New `notifications` docs addressed to someone pop up for them automatically.
- **Routing**: `#/app/<name>/<arg>` calls the app's `render(root, arg)`. `render` must return a cleanup function (unsubscribe listeners, clear timers).

## Data rules
- Shared workspace → Firestore `workspaces/{ws}/{collection}/{id}`; private workspace → localStorage. Same API.
- **Only these collections exist** (Firestore security rules reject any other): `tasks, projects, chat, channels, feed, events, leads, deals, contacts, companies, people, absences, timelog, files, folders, rules, notifications`. Do **not** invent collections: add fields to existing docs, or docs with a distinguishing field (e.g. `kind: "template"`).
- Old docs don't have your new fields: always default them (`t.observers || []`).
- Keep docs small (1 MB limit). Files always go through `Apps.attach`.
- Person keys are lowercase emails in shared workspaces (`"me"` in a private one).
- Free plan budget is ~50k reads / 20k writes per day per workspace: no writes in tight loops, throttle anything frequent (typing indicators, read markers) to at most one write every few seconds.

## Shared schemas (stick to these so apps work together)
- **events** (Calendar, Feed event posts, Tasks calendar overlays): `title, date (YYYY-MM-DD), end (YYYY-MM-DD, optional, multi-day), allDay (bool), start ("HH:MM"), finish ("HH:MM"), where, desc, color, owner (key), attendees: {key: "pending"|"yes"|"no"|"maybe"}, calendar: "company"|"personal", repeat: null | {freq: "day"|"week"|"month"|"year", until?: "YYYY-MM-DD"}, remind: minutes before (number) or null, room: roomId, video: url, files: [att]`. Meeting rooms are docs in `events` with `kind: "room"` and `{name, capacity}`; skip `kind` docs everywhere else. An event with no attendees is visible to everyone; a `personal` event only to its owner and attendees.
- **channels** (Chat): `name, desc, kind: "channel"|"group"|"broadcast", private (bool), members: [keys], admins: [keys], pinned: [messageIds]`. Visible to me if `!private || members.includes(me)`. Existing channel docs have none of these fields (treat as public channels). DMs have no channel doc: their id is `"dm:" + [a, b].sort().join("|")`.
- **tasks**: existing fields `title, desc, status ("todo"|"doing"|"done"), priority, assignee, by, deadline, project, checklist, comments, completedAt`. Phase 1 adds (Tasks builder owns this): `participants: [keys], observers: [keys], tags: [], parentId, related: [ids], files: [att], start (YYYY-MM-DD), estimate (minutes), timeSpent (seconds), tracking: {by, since} | null, repeat: null | {freq, until}, remindAt (ms), needsApproval (bool), status "review", deleted (bool), kind: "template"`. Templates and deleted tasks must not appear in normal task lists anywhere.
- **feed**: existing `kind ("post"|"announce"|"poll"|"thanks"), text, likes, comments, pinned, poll, to`. Phase 1 adds (Feed builder owns this): `audience: {all: true} | {people: [keys], depts: [names]}`, `files: [att]`, `readBy: [keys]` (announcements), `event: eventId` (kind "event"), `edited`.

## Rules for builders
- Edit **only your own files**: `js/apps/<app>.js` and `css/<app>.css` (already linked in `index.html`). Do not edit `js/apps.js`, `js/data.js`, `js/notify.js`, `js/ui.js`, `index.html`, other apps, `firestore.rules` or `css/apps.css` (override styles in your own CSS file instead). If you need a helper, write it inside your file.
- Edit with the Edit tool or Python. Never PowerShell `Set-Content`/`Get-Content` (they corrupt emoji). Keep UTF-8.
- Check syntax: `node -e "new Function(require('fs').readFileSync('js/apps/<app>.js','utf8'))"`.
- Don't run git, don't start servers, don't use a browser: the lead tests everything in the browser afterwards.
- Look and feel: glassmorphism. CSS variables `--accent, --accent-soft, --line, --muted, --faint, --glass, --glass-strong, --hover, --shadow, --shadow-lg, --c-red, --c-green, --c-orange`; classes `.btn, .btn.primary, .btn.danger, .icon-btn, .icon-btn.xs, .chip-btn, .seg` (segmented control, children buttons with `.on`), `.switch` (`.on`), `.menu-input, .mi, .menu-sec, .glass, .glass-strong, .app-head, .app-tabs, .app-empty, .file-list`. Must look right in light and dark themes (`html[data-theme=dark]`) and on phones (≤760px wide): study `css/apps.css` and `css/mobile.css`. Native HTML5 drag & drop also works on touch screens (polyfill in `js/touch-dnd.js`).
- Text in the UI: short, plain and friendly, sentence case.
- Escape every user-provided string you put into `html` with `UI.esc`.
- Finish with a short report: what users can now do, new fields you store, anything left undone, and anything the lead must wire up in shared files.

---

# Phase 2 additions (CRM, sales documents, web forms, Booking, Inventory)

## New collections (now allowed, together with all the ones above)
`products, quotes, activities, history, items, settings, bookings, inventory, forms, formsubs`. Still never invent others.
Note: the Firebase rules for these are published by the lead later; until then they work in private (local) workspaces, which is where you test logic.

## Shared schemas
- **settings** (single config docs, read with `Data.get("settings", id) || {}`, write with `Data.update("settings", id, patch)`):
  - `crm`: `{ pipelines: [{ id, name, stages: [{ id, name, color, sem: "process"|"won"|"lost" }] }], fields: { deals|leads|contacts|companies: [{ key, label, type: "text"|"number"|"date"|"select"|"checkbox"|"url", options? }] }, smart: [{ id, name, icon, stages: [{ id, name, color, sem }], fields: [...] }] }`. If missing, the default pipeline is the current STAGES list in crm.js with id `"default"` (existing deals without `pipeline` belong to it). **Owner: CRM builder.**
  - `company`: `{ name, address, taxId, email, phone, website, logo: att, bank, invoiceNotes, estimatePrefix: "EST-", invoicePrefix: "INV-", nextEstimate: 1, nextInvoice: 1, currency }` — your business details printed on estimates and invoices. **Owner: Sales builder.**
  - `booking`: `{ hours: { mon: ["09:00","18:00"], … }, slot: 30, currency }`. **Owner: Booking builder.**
- **products** (catalog, shared by CRM, Sales, Inventory and Booking): `{ name, sku, kind: "product"|"service", price, unit ("pcs", "hour", "kg"…), tax (percent), category, desc, image: att, active (bool), track (bool: count stock), minStock (number), vendor (companies id) }`. **Owner: Sales builder** (catalog UI). Others read it and may create products through `Apps.Sales.editProduct()`.
- **quotes** (estimates and invoices): `{ kind: "estimate"|"invoice", number ("INV-0007"), title, deal, contact, company (CRM ids), items: [{ product?, name, qty, unit, price, discount (percent), tax (percent) }], currency, status (estimate: "draft"|"sent"|"accepted"|"declined"; invoice: "draft"|"sent"|"paid"|"overdue"|"cancelled"), issue (YYYY-MM-DD), due (YYYY-MM-DD), notes, terms, paidAt, fromEstimate (id), deleted }`. Totals are always computed from items. **Owner: Sales builder.**
- **deals** gain `pipeline` (id), `products: [{ product?, name, qty, price, discount, tax }]` (deal amount = products total when there are products), custom field values under `custom: { key: value }`, `deleted`. Leads/contacts/companies gain `custom`, `deleted`; companies gain `type: "client"|"vendor"|"partner"`. **Owner: CRM builder.**
- **activities** (CRM to-dos with deadlines): `{ type: "call"|"meeting"|"task"|"email"|"note", subject, desc, due (ms timestamp, optional), done (bool), doneAt, owner (key), entity: { col: "deals"|"leads"|"contacts"|"companies"|"items", id } }`. Existing records keep their old inline `activities` array (read it, keep showing it). **Owner: CRM builder.**
- **history** (audit log, newest 400 load): `{ col, id, action: "created"|"updated"|"deleted"|"restored"|"stage", fields: { key: [old, new] } , title }`. Written by the CRM builder via `Data.hooks` for CRM collections only; at most one doc per save.
- **items** (smart-process records): `{ type (settings.crm.smart id), title, stage, owner, amount?, custom: {}, deleted }`. **Owner: CRM builder.**
- **forms** (web forms): `{ name, title, desc, fields: [{ key, label, type: "text"|"email"|"tel"|"textarea"|"select"|"checkbox", required, options? }], published (bool), thanks (text), target: "lead"|"deal", owner (key), button }`. **formsubs**: `{ form, values: { key: value }, at, page }` written by the public form page without sign-in. **Owner: Forms builder.**
- **bookings**: `kind: "resource"` `{ name, type: "person"|"room"|"equipment", person?, color, active }`; `kind: "service"` `{ name, duration (minutes), price, product?, color, resources: [ids] }`; `kind: "booking"` `{ resource, service, date (YYYY-MM-DD), start ("HH:MM"), finish ("HH:MM"), client: { name, phone, email, contact (CRM id)? }, status: "unconfirmed"|"confirmed"|"late"|"noshow"|"done"|"cancelled", price, paid (bool), note, deal? }`. **Owner: Booking builder.**
- **inventory**: `kind: "warehouse"` `{ name, address, default (bool) }`; `kind: "doc"` `{ type: "receipt"|"sale"|"transfer"|"writeoff", number, date, warehouse, to (warehouse, transfers), vendor (companies id, receipts), deal (sales), items: [{ product, qty, price }], status: "draft"|"done"|"cancelled", note, reason (write-offs) }`. Stock per product per warehouse = sum of done docs (receipt +, sale −, writeoff −, transfer − from / + to). **Owner: Inventory builder.** Expose `window.InventoryAPI = { stock(productId, warehouseId?) }`.

## Interfaces between phase 2 files (implement exactly these names)
- **js/apps/sales.js** (Sales builder) registers no sidebar app. It sets `Apps.Sales = { render(root, tab) /* tab: "products"|"estimates"|"invoices" */, editProduct(product?) → Promise<id|null>, productPicker(anchor, onPick(product)), openQuote(id), newQuote({ kind, deal?, contact?, company?, items? }) → Promise<id|null>, dealProducts(container, deal) /* renders an editable products table inside the CRM deal panel and saves deal.products + amount */, totals(items) → { subtotal, discount, tax, total }, settings() /* opens company details editor */ }`.
- **js/apps/forms.js** (Forms builder) registers no sidebar app. It sets `Apps.Forms = { render(root) }` and owns `form.html` + `js/form-public.js` (the public page). It also turns new `formsubs` into leads (or deals) automatically: on every member's device it listens to `formsubs`, and for each submission creates the lead with source "Web form", the form's owner as responsible, notifies them, then deletes the submission — guard against two devices doing it at once (claim it first with a `Data.update(formsubs, id, {claimed: me, claimedAt})` and only proceed if after a moment the claim is still yours).
- **js/apps/crm.js** (CRM builder) adds tabs that call those: "Products", "Estimates", "Invoices" → `Apps.Sales.render(root, tab)`, "Forms" → `Apps.Forms.render(root)`; in the deal panel shows `Apps.Sales.dealProducts(el, deal)` and buttons "Create estimate" / "Create invoice" → `Apps.Sales.newQuote({ kind, deal: id, contact, company, items: deal.products })`. Always guard with `if (Apps.Sales)` so the CRM still works if a file fails to load. CRM sets `Apps.CRM = { openRecord(col, id) (keep existing), pipelines(), stagesFor(pipelineId) }`.
- **js/apps/booking.js** and **js/apps/inventory.js** register sidebar apps `booking` ("Booking", 🗓️) and `inventory` ("Inventory", 📦). Booking may create a CRM contact from a client (`Data.add("contacts", …)`); Inventory "sale" docs may link to a deal and use `Apps.Sales.productPicker`.

## Files each phase 2 builder may edit
- CRM: `js/apps/crm.js`, `css/crm.css` (move or override CRM styles from css/apps.css into crm.css by overriding — don't edit css/apps.css).
- Sales: `js/apps/sales.js`, `css/sales.css`.
- Forms: `js/apps/forms.js`, `css/forms.css`, `form.html`, `js/form-public.js`.
- Booking: `js/apps/booking.js`, `css/booking.css`.
- Inventory: `js/apps/inventory.js`, `css/inventory.css`.
All other phase 1 rules still apply (no git, no browser, no other files, syntax check with node, short report).

---

# Phase 3 additions (Company & HR, workgroups & Scrum, Lists / RPA / approvals, access roles)

## New collections (allowed now, plus all earlier ones)
`reports, shifts, meetings, lists, listitems, processes, procitems, workflows, wfruns`. The lead publishes the Firebase rules later; test in a private (local) workspace.

## Shared schemas
- **settings "org"** (HR builder owns): `{ departments: [{ id, name, parent (id|null), head (person key|null) }] }`. People keep `dept` as the department **name** (existing data). If missing, departments are derived from people's `dept` values.
- **absences** (existing: `who, type, from, to, note`) gain `status: "pending"|"approved"|"declined"` (missing = approved, old data), `approver`, `decidedAt`, `reason`. Only approved absences count in the absence chart / "who's out" (js/home.js and calendar overlays read absences: missing status = approved, so they keep working; the HR builder must make sure pending/declined ones are clearly marked and the lead will filter them in shared files).
- **reports** (work reports): `{ who, period: "day"|"week"|"month", from, to, text, tasksDone: [taskIds], status: "sent"|"approved"|"returned", approver, comment, score: 1..5 }`.
- **shifts** (work schedules): `kind: "template"` `{ name, start: "HH:MM", finish: "HH:MM", color, days: [0-6] }`; `kind: "shift"` `{ who, date, start, finish, template?, note }`.
- **meetings** (meetings & briefings): `{ title, date, start, finish, where, video, chair (key), attendees: [keys], agenda: [{ id, text, done }], minutes (text), decisions: [{ text, task? }], status: "planned"|"held"|"cancelled", event? (events id) }`.
- **projects** (existing, used by Tasks as task groups: `name, color, desc?`) become **workgroups** (Groups builder owns): add `members: [keys], owner, moderators: [keys], privacy: "open"|"closed"|"secret", desc, avatar (emoji), type: "project"|"group"|"scrum", start, finish, chat (channels id), folder (folders id), archived`. Missing members = everyone (old projects stay visible). Tasks keep using `task.project`. Scrum adds to tasks: `sprint` (sprint id), `points` (story points), `epic`; sprints are stored on the project doc: `sprints: [{ id, name, start, finish, goal, status: "planned"|"active"|"done" }]`, `epics: [{ id, name, color }]`, backlog = project tasks without a sprint.
- **feed** posts may carry `group` (projects id): such posts are visible only to group members and show in that group's feed (Groups builder edits feed.js for this). **events** may carry `project`.
- **lists** (custom databases, Bitrix "Lists"): `{ name, icon, desc, fields: [{ key, label, type: "text"|"number"|"date"|"select"|"person"|"checkbox"|"file"|"url", options?, required }], access: "all"|"admins" }`; **listitems**: `{ list, values: { key: value }, deleted }`.
- **processes** (RPA): `{ name, icon, stages: [{ id, name, color, people: [keys], fields: [keys] }], fields: [...same as lists], done: stageId }`; **procitems**: `{ process, title, stage, values, history: [{ stage, by, at }], assignees }`.
- **workflows** (approval templates): `{ name, icon, desc, fields: [...], steps: [{ id, type: "approve"|"notify"|"task", who: "manager"|"head"|"person"|"admins", person?, label }], active }`; **wfruns**: `{ workflow, values, by, status: "running"|"approved"|"declined"|"cancelled", step (index), decisions: [{ step, who, decision: "approved"|"declined", comment, at }] }`.
- **workspace doc** (`workspaces/{ws}`, read via `window.Cloud.ws`): Access builder adds `roles: { [email]: "admin"|"member"|"guest" }` (owner is `ws.ownerEmail` and is always admin; missing = member) and `perms: { [area]: { view: [roles], edit: [roles] } }` where area is an app name (crm, inventory, company, booking, automation, …).

## Interfaces between phase 3 files (implement exactly these names)
- **Access levels (added later)**: `roles` values are "admin" (Level 1) | "manager" (Level 2) | "member" (Level 3, default) | "guest" (Level 4); owner = `ownerEmail`. `Apps.level(key?)` → 0 owner … 4 guest, `Apps.isManager(key?)`, and `Apps.canManage(key, action, ctx?)` with action "editProfile"|"remove"|"setLevel"|"moderate"|"reassign"|"invite" (ctx `{ group }` or `{ channel }` for "moderate") is the one place that decides who may manage whom. People docs may carry `alias` (display name, wins over the account name), `joined`, `mgrNote`. Chat messages removed by a moderator carry `deletedBy`.
- **js/access.js** (Access builder): `Apps.role(key?)` → "owner"|"admin"|"manager"|"member"|"guest"; `Apps.isAdmin(key?)`; `Apps.can(area, level = "view")` → bool (level "view"|"edit"|"admin"; private workspace → always true); `Apps.onAccess` (Set of callbacks when roles/perms change). Everyone else: **guard with `Apps.can ? Apps.can(...) : true`**, and use `Apps.isAdmin?.()` for admin-only settings (configure lists/processes/workflows, approve anyone's leave, HR settings).
- **js/apps/company.js** (HR builder): `Apps.HR = { managerOf(key) → key|null /* head of the person's department, or of the parent department if they are the head */, departments(), headOf(deptName), isOut(key, isoDate) → bool /* approved absence */ }`.
- **js/apps/groups.js** (Groups builder): registers sidebar app `groups` ("Workgroups", 👥) and `Apps.Groups = { open(id, tab?), mine() → projects I can see, canSee(project) }`. Tasks/Feed integrations live in tasks.js/feed.js edits by the same builder.
- **js/apps/automation.js** (Automation builder): keeps the existing rules engine and app `automation`; adds tabs Lists, RPA, Approvals; sets `Apps.Workflows = { start(workflowId, values?), pending() → runs waiting for me }`. Approvals resolve "manager" with `Apps.HR?.managerOf(by)` (fallback: workspace admins).

## Files each phase 3 builder may edit
- HR: `js/apps/company.js`, `css/company.css`.
- Groups: `js/apps/groups.js`, `css/groups.css`, and **targeted edits** in `js/apps/tasks.js` (project = workgroup visibility, Scrum fields and views) and `js/apps/feed.js` (group posts) — no one else edits those two files in phase 3.
- Automation: `js/apps/automation.js`, `css/automation.css`.
- Access: `js/access.js`, `css/access.css`, and targeted edits in `js/apps.js` (sidebar: hide apps you can't view), `js/cloud.js` (roles UI in the workspace/share menu, saving roles/perms on the workspace doc) and `firestore.rules` (only the workspace-doc update rule: roles/perms changes by owner or admins). No one else edits those files in phase 3.

---

# Phase 4 additions (Analytics, Boards, e-Signature, Marketing, Knowledge base, Drive, AI)

## New collections (allowed now, plus all earlier ones)
`dashboards, boards, boardels, signdocs, campaigns, segments, kbspaces, kbarticles`. The lead publishes the Firebase rules later; test in a private (local) workspace.

## Shared schemas
- **dashboards**: `{ name, icon, widgets: [{ id, type, title, source, metric, groupBy, period, size: "s"|"m"|"l", options }], shared (bool), owner }`.
- **boards** (whiteboards): `{ name, icon, members?: [keys] (missing = everyone), bg: "dots"|"grid"|"plain", viewport? }`; **boardels** (one doc per element so people can edit at once): `{ board, type: "sticky"|"text"|"shape"|"line"|"arrow"|"pen"|"image"|"frame", x, y, w, h, rot, z, color, text, points: [x0,y0,x1,y1,…] flat (pen/line; Firestore rejects nested arrays), shape: "rect"|"ellipse"|"diamond", from/to (element ids for connectors), file (att for images), lockedBy?, deleted }`.
- **signdocs**: `{ title, file: att (the original PDF, ≤700 KB via Apps.attach), signers: [{ key, name, order, status: "waiting"|"signed"|"declined", signedAt, sig: att (PNG of the signature), ip?: "" }], fields: [{ id, signer (key), page, x, y, w, h (fractions 0..1 of the page), type: "signature"|"initials"|"date"|"text", value? }], status: "draft"|"sent"|"completed"|"declined"|"cancelled", order: "any"|"sequence", signed: att (final stamped PDF), audit: [{ at, by, action }], kind: "general"|"hr" }`.
- **segments**: `{ name, source: "contacts"|"leads"|"companies", rules: [{ field, op, value }], count?, updatedAt }`; **campaigns**: `{ name, channel: "email"|"sms", segment, subject, body (supports {name}, {company}, {first} placeholders), status: "draft"|"scheduled"|"sent", scheduledAt, sentAt, stats: { sent, opened?, clicked? } (manual), blacklist handled via settings "marketing": { blacklist: [emails/phones], from, signature } }`.
- **kbspaces**: `{ name, icon, desc, access: "all"|"members", members: [keys], color, archived }`; **kbarticles**: `{ space, parent (article id|null), title, icon, body (sanitized HTML), tags, order, versions: [{ at, by, title, body }] (keep the last 10), favorites: [keys], status: "published"|"draft", deleted }`.
- **files** (Drive builder): may gain `versions: [{ id (files doc of the old version), at, by, size }]`, `owner`, `scope: "company"|"personal"` (missing = company), `deleted`, `comments: [{ id, by, text, at }]`; **folders** may gain `scope`, `owner`, `shared: [keys]`, `deleted`. Attachments use folder "__attachments" and must stay hidden in Drive.

## Interfaces between phase 4 files
- **js/ai.js** (AI builder) loads before all apps and sets `Apps.AI = { available() → bool (true when window.LUMI_AI_URL is set and someone is signed in), ask(prompt, { context, system, onToken }) → Promise<string> (streams tokens through onToken), button(label, getPrompt, onResult) → a small "✨ label" button element that is hidden when !available() }`. Any app may use `Apps.AI?.available()` to show AI actions; do nothing when it's missing.
- Each new app registers itself: `analytics` ("Analytics", 📊), `boards` ("Boards", 🧑‍🎨), `sign` ("e-Signature", ✍️), `marketing` ("Marketing", 📣), `kb` ("Knowledge base", 📚). Respect access with `Apps.can?.(name, "edit") ?? true` for creating/editing and `Apps.isAdmin?.()` for admin settings.
- External libraries: only from `https://cdnjs.cloudflare.com` or `https://cdn.jsdelivr.net/npm/` with an exact version, loaded lazily (inject a `<script>` only when the feature is used), e.g. pdf.js and pdf-lib for e-Signature.

## Files each phase 4 builder may edit
- Analytics: `js/apps/analytics.js`, `css/analytics.css`.
- Boards: `js/apps/boards.js`, `css/boards.css`.
- e-Signature: `js/apps/sign.js`, `css/sign.css`.
- Marketing: `js/apps/marketing.js`, `css/marketing.css`.
- Knowledge base: `js/apps/kb.js`, `css/kb.css`.
- Drive: `js/apps/drive.js`, `css/drive.css`.
- AI: `js/ai.js`, `css/ai.css`, `worker/src/index.js` (add an assist endpoint) and **small targeted hooks** (an AI button or two, guarded by `Apps.AI?.available()`) in `js/apps/tasks.js`, `js/apps/feed.js`, `js/apps/crm.js`, `js/apps/chat.js`, `js/apps/company.js` — no one else edits those files in phase 4.

---

# Settings (Bitrix24 parity)
`js/prefs.js` (loaded right after js/apps.js) is the single source for settings — read it first. Workspace settings live in `settings/workspace` (admins edit; schema and defaults in prefs.js), personal preferences in `people/<me>.prefs`. Helpers: `Prefs.ws()`, `Prefs.get("hours.weekStart")`, `Prefs.set(patch)`, `Prefs.tool(app, feature?)` (default on), `Prefs.me()`, `Prefs.setMe(patch)`, `Prefs.on(fn)`. Company details (requisites, bank) stay in `settings/company` (also used by invoices).
Feature keys for `Prefs.tool(app, feature)`:
- tasks: projects, scrum, efficiency, templates, gantt, timetracking
- crm: products, estimates, invoices, forms, smart, analytics
- company: structure, absence, worktime, schedules, reports, meetings
- automation: rules, approvals, rpa, lists
- chat: calls; feed: polls, appreciation; drive: versions; calendar: rooms
Apps whose `tools[app].on === false` disappear from the sidebar and show "This tool is switched off" (owner/admins see a link to Settings → Tools).


---

# Enterprise features (sign-in history, Microsoft sign-in, backups, branches, public API)

Goal: match the Bitrix24 Enterprise plan where software can: login history, Active Directory (Microsoft Entra ID) sign-in,
30-day backups, branch accounts with centralized management, and an API. Read the "Globals" and "Rules for builders"
sections above first; they still apply (vanilla JS, `UI.h`, glass look, no new libraries, no build step, friendly copy).

## Where each feature lives (one owner per file: edit ONLY your files)
| Feature | Files (owner) |
|---|---|
| Sign-in history + Microsoft sign-in | js/login-log.js, css/enterprise.css, js/gate.js, js/cloud.js (lead) |
| Backups | js/backups.js, css/backups.css (backups builder) |
| Branches | js/branches.js, css/branches.css (branches builder) |
| Public API | js/api-keys.js, css/api-keys.css, worker/src/api.js, worker/src/index.js (routing only), docs/API.md (API builder) |
| Firestore rules, help-kb, settings.js, index.html | lead only (script and CSS tags are already in index.html) |

## Settings hook (already wired by the lead)
Settings has sections `signins`, `backups`, `branches` and `api` (workspace group, only in shared workspaces). Each calls
`window.<Name>.draw(ctx, kit)` and shows what it returns (an array of elements, usually `kit.card(...)`s):
`window.LoginLog`, `window.Backups`, `window.Branches`, `window.ApiKeys`.
`kit = Apps.SettingsKit = { card(title, desc, ...kids), row(title, desc, control), sw(on, fn, label), seg(opts, val, fn), sel(opts, val, fn),
txt(val, fn, attrs), lockable(...kids) (disabled fieldset for non-admins), lockNote(), admin() (may change workspace settings),
shared(), saved(msg) (green "Saved" pill), wsSave(section, patch), markWrite() }`.
`ctx.redraw()` redraws your section. Settings redraws live when `settings` or `people` change; call `kit.markWrite()` before your own
writes so a redraw doesn't fight the user. Admin-only actions: check `Apps.isAdmin()` (owner or Level 1 admin) and say why when not allowed.
Look at js/apps/settings.js for examples (security(), ai(), company()) and css/settings.css for the classes (.st-card, .st-row, .st-empty ...).
Your draw() is synchronous: start async loads, return placeholders, then fill them in (or call ctx.redraw()) when data arrives; cache results
in module variables so redraws don't refetch every time.

## Data contract (the lead publishes rules that enforce exactly this)
- Workspace doc `workspaces/{ws}`: new fields
  - `branches: [wsId]` on a head office, `parent: wsId` on a branch, `branchLabel: string` (optional, e.g. "Mumbai office").
  - Only the owner or an admin may change `branches`, `parent`, `branchLabel`. Admin writes must include `roleEdit: ""` when you are an
    admin and not the owner (same pattern as `adminWrite()` in js/cloud.js).
- `settings/backup` (admin-only writes, everyone in the workspace can read):
  `{ auto: bool, keepDays: number (default 30), lastAt: ms, lastBy: email, lastFile: { id, name, size }, folderId: string, folderBy: email }`.
- `apikeys/{keyId}` (only owner and admins can read or write; the Worker reads it with a service account):
  `{ name, hash (hex SHA-256 of the whole key), last4, scopes: ["read"] | ["read","write"], collections: [] (empty = every allowed one),
  created: ms, by: email, revoked: bool, lastUsed: ms }`. keyId = first 24 hex chars of the hash.
  Key format shown ONCE to the admin: `lmn_<wsId>_<40 random [A-Za-z0-9] chars>` (crypto.getRandomValues). Never store the plain key.
- `logins/{id}` (lead): `{ email, at, kind: "signin" | "open", provider, browser, os, device, tz, lang }`; members create their own,
  owner/admins read all, members read their own.
- Reading another workspace (branches) is allowed only if you are a member of it. Use `Cloud.fs.fb` (Firestore + Auth exports) and
  `Cloud.fs.db` directly for one-off reads (getDoc, getDocs, getCountFromServer, writeBatch) instead of `Data`, which only knows the open
  workspace. `Cloud.fs.ref()` is the open workspace's doc ref. `Cloud.workspaces` lists the workspaces I belong to (live).

## Backups builder
- Export now: read every collection in `Data.COLS` plus `pages` and the workspace doc's safe fields (name, icon, root, branchLabel)
  with one-off `getDocs` (not `Data.list`, which caps some collections at 400). Skip `notifications`, `presence`, `logins`, `apikeys`.
  File: `lumen-backup-<workspace-slug>-<YYYY-MM-DD-HHmm>.json` with `{ lumenBackup: 1, ws: { id, name }, at, by, counts, data: { col: { id: doc } }, pages: { id: data } }`.
  Firestore Timestamps -> `{ __ts: ms }` (and back on restore).
- Restore (admins only): from a local file or a Drive backup. Show a preview (workspace name, date, counts per collection), let them tick
  collections, then write with `writeBatch` in chunks of 400 (merge, same ids; never delete existing docs). Progress bar. Confirm first.
  Warn if the backup came from a different workspace (allowed, e.g. copying into a branch).
- Automatic backups to Google Drive (admins switch on; "30-day backup period"): use `window.GDrive` (js/gdrive.js: connect with write scope,
  upload, list, delete...; read it). Folder "Lumen backups - <workspace name>" in the connecting admin's Drive (save its id in settings/backup).
  When an admin with a live Drive connection opens Lumen and `lastAt` is over 24 h ago, run a backup quietly in the background (no prompts:
  if Drive needs reconnecting, show a small one-time notice in the section instead), then delete backups older than `keepDays`.
  Section shows: status (last backup, by whom, size, next due), switch, keep-for (7 / 14 / 30 / 90 days), "Back up now", the list of Drive
  backups (date, size, Restore, Open in Drive) and Export / Restore from file. Non-admins see status only.
- Help text must be honest: backups live in the admin's own Google Drive; a browser with Lumen open is needed for automatic ones.

## Branches builder ("unlimited branch accounts" + "centralized management")
- Settings -> Branches in a head office: list of linked branches (name, label, member count, admins, open tasks count, deals count via
  `getCountFromServer`, last activity if cheap), each with Open (switch: `Cloud.open(id)`), Invite people (email + level, written to that
  workspace like js/cloud.js `invite()` does), Unlink.
- "Create branch": new workspace (same shape as `create()` in js/cloud.js: name, owner = me, ownerEmail, members [me], root [], icon,
  createdAt, plus `parent`), copy chosen settings from the head (settings/workspace sections: brand, tools, security, hours, region, people,
  comms, ai) and optionally add chosen head members with their levels. Then add it to the head's `branches`.
- "Link an existing workspace": pick from `Cloud.workspaces` where I'm owner or admin (roles[myEmail] === "admin" or owner === my uid),
  not already linked, not the head itself, not already some other head's branch. Write `parent` on it and add it to the head's `branches`.
- Centralized actions across selected branches: "Push settings" (choose sections, copy from head to each branch's settings/workspace),
  "Announce" (post a feed item `{ kind: "announce", text, likes: [], comments: [], audience: { all: true }, readBy: [], at, by }` in each),
  "Add a person to branches" (email + level).
- Totals strip at the top: branches, people across all, open tasks, open deals.
- In a branch (has `parent`): show "This is a branch of <head name>" with Open head office, and (owner/admin) Leave branch group.
- Only owner/admins can change things; others see a read-only summary. Handle permission errors (you may not be a member of a linked
  branch): show that row as "No access" instead of failing.

## API builder
- Settings -> API & integrations (owner/admins): create key (name, read or read+write, optional collection limits) -> show the key ONCE in a
  copy box with a warning; list keys (name, last4, scopes, created, by, last used, Revoke). Revoke sets `revoked: true` (plus Delete).
  Show the API base URL `window.LUMEN_API_URL || window.LUMI_AI_URL` (+ "/v1"); if empty, show the setup steps (deploy the worker, set the
  FIREBASE_SERVICE_ACCOUNT secret) and still allow creating keys (they work once the worker is live). Include copyable curl examples.
- Worker (worker/src/api.js, routed from worker/src/index.js for paths starting `/v1/`; keep /chat and /assist working):
  - Auth: `Authorization: Bearer lmn_<ws>_<secret>`. SHA-256 the whole key, read `workspaces/<ws>/apikeys/<first 24 hex>`, compare full hash
    (constant time), reject revoked. Update `lastUsed` at most once a minute.
  - Firestore REST with a Google service-account access token: secret `FIREBASE_SERVICE_ACCOUNT` (the JSON key), sign the RS256 JWT with
    WebCrypto (`crypto.subtle.importKey("pkcs8", ...)`), exchange at https://oauth2.googleapis.com/token, cache the token until it expires.
    The service account bypasses rules, so the worker itself must enforce: only that workspace, only allowed collections, scopes.
  - Endpoints: `GET /v1/me`, `GET /v1/{col}?limit=50&pageToken=`, `GET /v1/{col}/{id}`, `POST /v1/{col}` (creates; sets at, by:"api:<key name>"),
    `PATCH /v1/{col}/{id}` (merge), `DELETE /v1/{col}/{id}`. JSON in, plain JSON out (convert Firestore typed values both ways).
  - Allowed collections: tasks, projects, leads, deals, contacts, companies, products, quotes, activities, events, feed, inventory, bookings,
    absences, timelog, lists, listitems, kbspaces, kbarticles, formsubs (read only). Never settings, people, apikeys, logins, presence, pages,
    notifications. A key's `collections` limits further.
  - Rate limit per key (e.g. 120 requests/min per instance), body size limit, clear JSON errors `{ error: { code, message } }`, CORS allowed.
  - wrangler.toml: document the new secret in comments only. Keep `npx wrangler deploy` working; check syntax with `node --check`.
  - docs/API.md: setup (Firebase console -> Project settings -> Service accounts -> Generate new private key; `npx wrangler secret put
    FIREBASE_SERVICE_ACCOUNT` and paste the JSON; deploy), auth, endpoints, examples, limits. The user pastes secrets themselves.

## Checks before you finish
- `node -e "new Function(require('fs').readFileSync('js/<file>.js','utf8'))"` on every classic script you touched; `node --check` for worker files.
- Test in the local preview if you can (server "lumen-desktop" on http://localhost:5174, wait ~9 s then run `Gate.hide()` in the console for
  local mode; shared-workspace-only features can be checked for rendering and errors only). Other builders work in parallel on other files.
- Don't commit or push; the lead does. Report: files changed, what works, what you could not test, any rules the lead must add.
