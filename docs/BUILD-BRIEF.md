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
- **js/access.js** (Access builder): `Apps.role(key?)` → "owner"|"admin"|"member"|"guest"; `Apps.isAdmin(key?)`; `Apps.can(area, level = "view")` → bool (level "view"|"edit"|"admin"; private workspace → always true); `Apps.onAccess` (Set of callbacks when roles/perms change). Everyone else: **guard with `Apps.can ? Apps.can(...) : true`**, and use `Apps.isAdmin?.()` for admin-only settings (configure lists/processes/workflows, approve anyone's leave, HR settings).
- **js/apps/company.js** (HR builder): `Apps.HR = { managerOf(key) → key|null /* head of the person's department, or of the parent department if they are the head */, departments(), headOf(deptName), isOut(key, isoDate) → bool /* approved absence */ }`.
- **js/apps/groups.js** (Groups builder): registers sidebar app `groups` ("Workgroups", 👥) and `Apps.Groups = { open(id, tab?), mine() → projects I can see, canSee(project) }`. Tasks/Feed integrations live in tasks.js/feed.js edits by the same builder.
- **js/apps/automation.js** (Automation builder): keeps the existing rules engine and app `automation`; adds tabs Lists, RPA, Approvals; sets `Apps.Workflows = { start(workflowId, values?), pending() → runs waiting for me }`. Approvals resolve "manager" with `Apps.HR?.managerOf(by)` (fallback: workspace admins).

## Files each phase 3 builder may edit
- HR: `js/apps/company.js`, `css/company.css`.
- Groups: `js/apps/groups.js`, `css/groups.css`, and **targeted edits** in `js/apps/tasks.js` (project = workgroup visibility, Scrum fields and views) and `js/apps/feed.js` (group posts) — no one else edits those two files in phase 3.
- Automation: `js/apps/automation.js`, `css/automation.css`.
- Access: `js/access.js`, `css/access.css`, and targeted edits in `js/apps.js` (sidebar: hide apps you can't view), `js/cloud.js` (roles UI in the workspace/share menu, saving roles/perms on the workspace doc) and `firestore.rules` (only the workspace-doc update rule: roles/perms changes by owner or admins). No one else edits those files in phase 3.
