/* Lumi's knowledge base: what Lumen can do and how to fix common problems.
   k = keywords (weight 2 for the first few that define the topic), a = answer (HTML), act = action buttons, app = shown first on that app's screen */
(function () {
  const KB = [
    // ---------- sharing & teammates ----------
    { id: "not-seeing", t: "My teammate can't see my posts / tasks", k: ["see", "member", "post", "visible", "show", "task", "chat", "workspace", "same", "missing", "empty"],
      a: "Posts, chats, tasks and CRM records are only shared <b>inside one workspace</b>. If a teammate can't see them, you're probably in different workspaces.<br><br>1. Check the name at the top-left of the sidebar on both screens; it must be the same shared workspace (👥).<br>2. The owner of that workspace opens <b>Share</b> and adds the teammate's email.<br>3. The teammate opens the workspace menu (click the workspace name) and picks it.", act: ["check", "invite", "switch"] },
    { id: "invite", t: "Invite a teammate", k: ["invite", "member", "add", "share", "email", "join", "collaborate"],
      a: "Open <b>Share</b> (top right) in a shared workspace, type their email and press <b>Enter</b>. Lumen emails them a one-click sign-in link (and you can also copy the link). Only the workspace <b>owner</b> can invite.", act: ["invite"] },
    { id: "invite-email", t: "The invite email didn't arrive", k: ["email", "invite", "arrive", "receive", "spam", "mail", "link", "limit"],
      a: "• Ask them to check <b>Spam / Promotions</b>; it comes from <i>noreply@lumen-notes-cde2c.firebaseapp.com</i> titled “Sign in to Lumen Notes”.<br>• The free plan sends at most <b>5 invite emails per day</b>. After that, use <b>Share → Copy invite link</b> and send it on WhatsApp or chat.<br>• They must sign in with the <b>exact email you invited</b>.<br>• Use the ✉️ button next to their name in Share to resend.", act: ["invite"] },
    { id: "private-vs-shared", t: "Workspaces and signing in", k: ["private", "shared", "workspace", "difference", "local", "device", "switch", "account", "sign"],
      a: "Lumen always needs you to sign in (Google or an emailed sign-in link). Every workspace is online and synced: the people you invite see the same tasks, chat, CRM and files live, on any device. Switch between workspaces from the workspace menu (click its name, top left).", act: ["switch"] },
    { id: "create-ws", t: "Create a shared workspace", k: ["create", "new", "workspace", "shared", "team", "setup"],
      a: "Sign in, then open the workspace menu (click the workspace name) → <b>Create a new workspace…</b>. A short setup asks how you'll use it and sets it up for you. Then invite people from the workspace menu or <b>Settings → Manage access</b>.", act: ["newws"] },
    { id: "remove-member", t: "Remove someone from a workspace", k: ["remove", "member", "kick", "delete", "access", "revoke"],
      a: "Owner only: open <b>Share</b> and press ✕ next to their email. They lose access right away.", act: ["invite"] },
    { id: "owner", t: "Only the owner can invite", k: ["owner", "permission", "only", "admin", "can't", "invite"],
      a: "Inviting and removing people is limited to the workspace owner (👑 in the Share list). Everyone else can still edit everything inside it.", act: ["invite"] },

    // ---------- account ----------
    { id: "signin", t: "I can't sign in", k: ["sign", "signin", "login", "google", "popup", "account", "log"],
      a: "• Use a normal browser window (Chrome, Edge, Safari). Some in-app browsers block the Google pop-up.<br>• If a pop-up blocker appears, allow pop-ups for this site and try again.<br>• Make sure you're on <b>lumenspaceapp.github.io</b>.<br>• Invited by email? Open the link from that email and confirm the same address.", act: ["signin", "check"] },
    { id: "signout", t: "Sign out or switch account", k: ["signout", "logout", "switch", "account", "another"],
      a: "Click your name at the bottom of the sidebar → <b>Sign out</b>. Then sign in again with the other Google account.", act: [] },
    { id: "avatar", t: "Change my avatar or name", k: ["avatar", "profile", "picture", "photo", "name", "icon", "change"],
      a: "Open <b>Settings → Your profile → Change avatar</b> to pick from 14 avatars, your Google photo, or your initial. It shows on chat, tasks, comments and the team directory. Job title and department live in <b>Company & HR → Edit my profile</b>.", act: ["avatar", "settings"] },

    // ---------- pages & editor ----------
    { id: "new-page", pages: true, t: "Create a page", k: ["page", "new", "create", "document", "doc", "note"],
      a: "Click <b>+ New page</b> in the sidebar (or press <b>Ctrl Alt N</b>). Hover a page in the sidebar and press <b>+</b> to put a page inside it. A new page offers templates like To-do list, Meeting notes and Project board.", act: ["newpage", "templates"] },
    { id: "slash", pages: true, t: "Add blocks with /", k: ["block", "slash", "insert", "heading", "list", "todo", "toggle", "quote", "callout", "code", "divider"],
      a: "Type <b>/</b> in any line to insert a block: headings, to-dos, toggles, callouts, code, images, tables, boards and more. Markdown works too: <code>#</code> heading, <code>-</code> bullet, <code>1.</code> numbered, <code>[]</code> to-do, <code>&gt;</code> toggle, <code>```</code> code, <code>**bold**</code>.", act: [] },
    { id: "format", pages: true, t: "Bold, colours and links", k: ["bold", "italic", "color", "colour", "highlight", "link", "format", "text"],
      a: "Select text to open the formatting bar: <b>bold</b>, <i>italic</i>, underline, strike, inline code, link, text colour and highlight. Block colours are in the ⋮⋮ block menu → Color.", act: [] },
    { id: "drag", pages: true, t: "Move or reorder things", k: ["drag", "reorder", "move", "drop", "order", "arrange", "block", "mobile", "hold", "long", "card"],
      a: "<b>Computer:</b> drag the ⋮⋮ handle beside a block, a board card, or a page in the sidebar (drop onto another page to nest it).<br><b>Phone:</b> press and hold a card or page until it lifts, then drag. For blocks, tap the block then drag its ⋮⋮ handle.<br>Blocks can also move with <b>Ctrl Shift ↑/↓</b>.", act: [] },
    { id: "delete-page", pages: true, t: "Delete or restore a page", k: ["delete", "trash", "restore", "undo", "recover", "deleted", "lost", "page"],
      a: "Pages go to <b>Trash</b> first (bottom of the sidebar), where you can restore them or delete them forever. Deleted blocks show an <b>Undo</b> button for a few seconds.", act: ["trash"] },
    { id: "favorite", pages: true, t: "Favorites", k: ["favorite", "favourite", "star", "pin", "bookmark"],
      a: "Click the ⭐ in the top bar of a page (or the page's ··· menu in the sidebar) to add it to Favorites at the top of the sidebar.", act: [] },
    { id: "cover", pages: true, t: "Cover, icon and page style", k: ["cover", "icon", "emoji", "font", "width", "lock", "style"],
      a: "Hover the top of a page for <b>Add icon</b> / <b>Add cover</b>. The ··· menu (top right) has fonts, small text, full width, lock page, duplicate, export to Markdown and print.", act: [] },
    { id: "database", pages: true, t: "Tables, boards and galleries", k: ["database", "table", "board", "gallery", "property", "column", "kanban", "row"],
      a: "Type <b>/table</b>, <b>/board</b> or <b>/gallery</b>. Click a column header to rename it or change its type (select, date, number, checkbox, progress…), <b>+</b> adds a property, and <b>Open</b> on a row shows its details panel.", act: [] },
    { id: "images", pages: true, t: "Images and files", k: ["image", "picture", "upload", "file", "size", "big", "photo", "pdf"],
      a: "Use <b>/image</b> to upload or paste a link. In shared workspaces, uploads (and Drive files) are limited to about <b>700 KB</b> each on the free plan, so use a link for bigger files.", act: ["drive"] },
    { id: "search", pages: true, t: "Search everything", k: ["search", "find", "look", "where"],
      a: "Press <b>Ctrl K</b> (or click Search in the sidebar) to search page titles and content and run commands like “Toggle dark mode”.", act: ["search"] },
    { id: "export", pages: true, t: "Export, backup and import", k: ["export", "backup", "import", "download", "markdown", "save", "pdf"],
      a: "• One page: ··· → <b>Export as Markdown</b> or <b>Print / PDF</b>.<br>• Private workspace: <b>Settings → Backup → Export</b> (and Import on another device).<br>• Shared workspaces are saved online automatically.", act: ["settings"] },
    { id: "shortcuts", pages: true, t: "Keyboard shortcuts", k: ["shortcut", "keyboard", "keys", "hotkey"],
      a: "<b>Ctrl K</b> search · <b>Ctrl Alt N</b> new page · <b>Ctrl \\</b> sidebar · <b>Ctrl Shift L</b> theme · <b>/</b> blocks · <b>Tab</b> indent · <b>Ctrl D</b> duplicate block · <b>Ctrl Shift ↑↓</b> move block · <b>Ctrl /</b> open Lumi.", act: [] },

    // used while pages are switched off (Bitrix24-style workspace)
    { id: "search-apps", pages: false, t: "Search everything", k: ["search", "find", "look", "where"],
      a: "Press <b>Ctrl K</b> (or click <b>Search</b> in the sidebar) to find tasks, people, deals, leads, contacts, files and apps, and to run commands like “Toggle dark mode”.", act: ["search"] },
    { id: "shortcuts-apps", pages: false, t: "Keyboard shortcuts", k: ["shortcut", "keyboard", "keys", "hotkey"],
      a: "<b>Ctrl K</b> search · <b>Ctrl \</b> sidebar · <b>Ctrl Shift L</b> dark mode · <b>Ctrl /</b> open Lumi · in chat, <b>Enter</b> sends and <b>Shift Enter</b> adds a new line.", act: [] },
    { id: "drag-apps", pages: false, t: "Move or reorder things", k: ["drag", "reorder", "move", "drop", "order", "arrange", "mobile", "hold", "long", "card", "board", "kanban"],
      a: "<b>Computer:</b> drag a task card between columns on the Kanban board (and deals between stages in CRM).<br><b>Phone:</b> press and hold a card until it lifts, then drag it.", act: ["tasks"] },
    { id: "pages-off", pages: false, t: "Where did pages go?", k: ["page", "pages", "note", "notes", "document", "doc", "wiki", "template", "templates", "trash", "editor"],
      a: "Lumen is set up as a team workspace right now: <b>Tasks, Chat, Feed, Calendar, CRM, Company & HR, Drive and Automation</b>. Notion-style pages are switched off, but nothing was deleted. Ask the site owner if you need them back. For notes, try a task description, a Feed post or a file in <b>Drive</b>.", act: ["tasks", "drive"] },

    // ---------- apps ----------
    { id: "tasks", app: "tasks", t: "Tasks and projects", k: ["task", "gantt", "planner", "chart", "assign", "deadline", "project", "todo", "kanban", "timeline", "subtask", "checklist", "observer", "participant"],
      a: "Open <b>Tasks</b> and press <b>+ New task</b>. Pick the responsible person, <b>participants</b> (co-assignees), <b>observers</b>, a deadline, tags and a project. Views: <b>List, Kanban, Deadlines, Planner</b> (drag a card to plan it), <b>Calendar</b> and <b>Gantt</b> (drag bars to change dates). In a task you can add subtasks, a checklist, files, comments with @mentions, and link related tasks.", act: ["tasks"] },
    { id: "task-extras", app: "tasks", t: "Recurring tasks, reminders and templates", k: ["recurring", "repeat", "reminder", "remind", "template", "timer", "time", "track", "estimate", "approval", "approve", "review", "recycle", "bin", "efficiency"],
      a: "Inside a task: <b>Repeat</b> creates the next copy when you finish it, <b>Remind me</b> pings you at a time you choose, and the <b>Start</b> timer tracks time against an estimate. Tick <b>Check the result when it's done</b> to approve work before it closes (you get <b>Approve / Send back</b>). Use ⋯ → <b>Save as template</b>, then <b>From template</b> next to New task. Deleted tasks go to the <b>Recycle bin</b> tab. <b>Efficiency</b> is the share of your tasks finished on time in the last 30 days.", act: ["tasks"] },
    { id: "chat", app: "chat", t: "Chat and messages", k: ["chat", "message", "dm", "channel", "group", "reply", "pin", "forward", "file", "image", "seen", "typing", "search"],
      a: "In <b>Chat & Calls</b>: message a teammate from the People list, or press <b>New chat</b> for a private group with chosen members. Channels are open to everyone; broadcast channels only let admins post. Hover a message to <b>reply</b>, <b>forward</b>, <b>pin</b>, react, edit or delete it. Attach files, paste images, or drop files into the chat. You'll see <b>Seen</b> and <b>typing…</b>, and the search box finds messages in all your chats.", act: ["chat"] },
    { id: "call", app: "chat", t: "Video calls", k: ["video", "call", "meet", "meeting", "jitsi", "camera"],
      a: "Press <b>📹 Video call</b> in a chat (or on Home). It opens a free Jitsi Meet room in a new tab and posts a “Join call” button so others can jump in.", act: ["chat"] },
    { id: "feed", app: "feed", t: "Feed, announcements and polls", k: ["feed", "post", "announcement", "poll", "appreciation", "thanks", "event", "read", "audience", "mention", "like", "comment"],
      a: "In <b>Feed</b>, write a <b>Post</b>, <b>Announcement</b>, <b>Poll</b>, <b>Appreciation</b>, <b>Event</b> (adds it to the calendar and invites people) or <b>File</b> post. Use <b>To:</b> to pick everyone, certain people or departments. Announcements have an <b>I've read it</b> button and show who has read them. @mention people in posts and comments; like, reply and attach files. Filters find posts by text, author, date and type.", act: ["feed"] },
    { id: "calendar", app: "calendar", t: "Calendar and events", k: ["calendar", "event", "meeting", "invite", "invitation", "attendee", "accept", "decline", "repeat", "recurring", "room", "reminder", "schedule"],
      a: "In <b>Calendar</b> press <b>+ Event</b>, or click a time slot. Add attendees and they get an invitation to <b>Accept / Maybe / Decline</b> (pending ones are under <b>Invitations</b>). Events can repeat, remind you, book a meeting room (manage them under <b>Rooms</b>), include a video call link and files. <b>My calendar</b> events are private to you and your attendees. Views: month, week, day and agenda; drag your events to move or resize them.", act: ["calendar"] },
    { id: "crm", app: "crm", t: "CRM: leads, deals and pipelines", k: ["crm", "pipeline", "deal", "lead", "stage", "contact", "client", "customer", "sales", "kanban", "funnel"],
      a: "In <b>CRM</b>, add leads and deals and drag deals between stages (Kanban), or switch to <b>List</b>, <b>Activities</b> or <b>Calendar</b>. Use the <b>pipeline</b> switcher → <b>Configure pipelines</b> to add pipelines and edit stages. Convert a lead into a contact and deal from its panel. <b>Analytics</b> shows the funnel, won vs lost, revenue and a leaderboard.", act: ["crm"] },
    { id: "crm-activities", app: "crm", t: "CRM activities, history and recycle bin", k: ["activity", "activities", "call", "meeting", "follow", "followup", "history", "recycle", "restore", "duplicate", "merge"],
      a: "Open any deal, lead, contact or company and plan a <b>call, meeting, task or email</b> with a deadline; <b>My activities</b> lists everything you have to do. The timeline shows comments and every change (history). Deleted records go to the <b>Recycle bin</b> (⋯ menu). <b>Find duplicates</b> in ⋯ merges records with the same email, phone or name.", act: ["crm"] },
    { id: "crm-data", app: "crm", t: "Import, export and custom fields", k: ["import", "export", "csv", "excel", "custom", "field", "fields", "smart", "process", "upload"],
      a: "In each CRM list, the ⋯ menu has <b>Import CSV</b> (match your columns, preview, then import) and <b>Export CSV</b>. <b>Configure fields</b> adds your own fields to deals, leads, contacts or companies. <b>Smart processes</b> (header ⋯) let you track your own kind of item with its own stages.", act: ["crm"] },
    { id: "invoices", app: "crm", t: "Products, estimates and invoices", k: ["invoice", "invoices", "estimate", "quote", "quotation", "product", "catalog", "price", "pdf", "print", "bill", "paid"],
      a: "In <b>CRM → Products</b> build your catalog. Open a deal to add products, then <b>Create estimate</b> or <b>Create invoice</b> (or use the Estimates / Invoices tabs). Numbers are automatic; set your logo, address and bank details under <b>Company details</b>. <b>Print / Save as PDF</b> makes a ready-to-send document; mark invoices <b>paid</b>, and convert an accepted estimate into an invoice.", act: ["crm"] },
    { id: "webforms", app: "crm", t: "Web forms that create leads", k: ["form", "forms", "web", "website", "embed", "qr", "signup", "contact", "capture", "landing"],
      a: "In <b>CRM → Forms</b> press <b>+ New form</b>, choose the fields and who gets the leads, and publish. Share the link, a QR code or the embed code for your website. Every answer becomes a lead automatically and the responsible person is notified. Forms need a shared workspace.", act: ["crm"] },
    { id: "currency", app: "crm", t: "Change the currency", k: ["currency", "money", "rupee", "inr", "usd", "dollar", "euro"],
      a: "Open the <b>CRM</b> and use the currency menu (INR, USD, EUR, GBP, AED) next to <b>+ New deal</b>. All deal amounts and totals switch right away.", act: ["crm"] },
    { id: "booking", app: "booking", t: "Booking clients", k: ["booking", "book", "appointment", "schedule", "service", "resource", "room", "client", "slot", "reservation"],
      a: "In <b>Booking</b>, add <b>Resources</b> (people, rooms, equipment) and <b>Services</b> (length and price), then click a free slot in the schedule to book a client. Drag bookings to move them; mark them confirmed, late, done or no-show and paid. <b>Clients</b> shows visit history, and <b>Settings</b> sets opening hours. Linked people get a reminder 15 minutes before.", act: [] },
    { id: "inventory", app: "inventory", t: "Inventory and stock", k: ["inventory", "stock", "warehouse", "receipt", "receive", "transfer", "write", "writeoff", "sales", "order", "low"],
      a: "In <b>Inventory</b>, add a warehouse and products, then create a <b>Receipt</b> when goods arrive and press <b>Conduct</b> to add stock. <b>Sales orders</b>, <b>Transfers</b> and <b>Write-offs</b> reduce or move stock the same way. The Stock tab shows quantities per warehouse and warns about low stock; <b>Analytics</b> shows value and movements.", act: [] },
    { id: "leave", app: "company", t: "Request time off (leave)", k: ["leave", "vacation", "holiday", "time", "off", "sick", "absence", "request", "approve", "balance"],
      a: "In <b>Company & HR</b> press <b>🌴 Request time off</b>, pick the type and dates and send. Your manager (the head of your department) approves or declines it under <b>Requests</b>, and you get notified. <b>Requests</b> also shows your remaining days per type; approved time off appears on the absence chart and Home.", act: [] },
    { id: "hr-tools", app: "company", t: "Org chart, reports, shifts and meetings", k: ["report", "org", "chart", "structure", "department", "head", "shift", "schedule", "roster", "meeting", "briefing", "minutes", "birthday"],
      a: "<b>Structure</b> is the org chart: admins add departments, heads and people. <b>Reports</b>: write your weekly report and your manager scores it. <b>Schedules</b>: plan shifts per person and day. <b>Meetings</b>: agenda, live minutes and decisions that become tasks. <b>Worktime</b> shows hours, late arrivals and a monthly report.", act: [] },
    { id: "workgroups", app: "groups", t: "Workgroups and Scrum", k: ["workgroup", "scrum", "sprint", "group", "groups", "project", "space", "team", "backlog", "story", "points", "epic", "burndown", "join"],
      a: "In <b>Workgroups</b> press <b>+ Create</b>: each group gets its own feed, tasks, calendar, files, chat and members, and can be open, closed (join on request) or secret. Choose type <b>Scrum</b> for a backlog, sprints with story points, epics, a burndown chart and velocity.", act: [] },
    { id: "access", t: "Admins, guests and permissions", k: ["admin", "admins", "guest", "role", "roles", "permission", "permissions", "access", "restrict", "hide"],
      a: "The workspace owner and admins open <b>Access & roles</b> from the workspace menu (or <b>Settings → Manage access</b>). Set each person as <b>admin</b>, <b>member</b> or <b>guest</b>, and choose which apps each role can view or edit. Apps someone can't open are hidden for them.", act: [] },
    { id: "analytics", app: "analytics", t: "Analytics and dashboards", k: ["analytics", "dashboard", "report", "chart", "kpi", "statistics", "stats", "metrics", "bi"],
      a: "<b>Analytics</b> has ready dashboards for sales, tasks, team, booking, inventory and automation. Pick a period, person or pipeline at the top. <b>+ New dashboard</b> builds your own from 40+ metrics and chart types; each widget's ⋯ downloads CSV, and Print makes a clean report.", act: [] },
    { id: "boards", app: "boards", t: "Whiteboards", k: ["board", "boards", "whiteboard", "draw", "sticky", "brainstorm", "mindmap", "diagram", "retro", "canvas"],
      a: "In <b>Boards</b> press <b>+ New board</b> or pick a template (brainstorm, retrospective, kanban, mind map). Add sticky notes (N), text (T), shapes (R/O), arrows that connect things (A), drawings (P), images and frames. Everyone on the board sees changes live. Export as PNG/SVG or present frame by frame.", act: [] },
    { id: "sign", app: "sign", t: "e-Signature", k: ["sign", "signature", "esign", "contract", "pdf", "agreement", "signing", "signer"],
      a: "In <b>e-Signature</b> press <b>+ New document</b>: upload a PDF (up to 700 KB), choose teammates as signers (in order or any order), drag signature, initials, date and text fields onto the pages, then send. Signers draw or type their signature; when everyone has signed you get a signed PDF with a certificate page. Signers must be members of your workspace.", act: [] },
    { id: "marketing", app: "marketing", t: "Marketing campaigns", k: ["marketing", "campaign", "newsletter", "email", "sms", "segment", "audience", "mailchimp", "blast", "unsubscribe"],
      a: "In <b>Marketing</b>, build a <b>segment</b> from CRM contacts or leads, design an email in <b>My templates</b>, then create a <b>campaign</b>. Lumen can't send email itself: send through your mail app one by one, copy the addresses as BCC, or export a mail-merge CSV for Gmail or Mailchimp, then mark the campaign as sent.", act: [] },
    { id: "knowledge", app: "kb", t: "Knowledge base", k: ["knowledge", "wiki", "article", "articles", "handbook", "docs", "documentation", "policy", "space", "spaces"],
      a: "In <b>Knowledge base</b> create a <b>space</b> (for example Company handbook), then add articles and nest them. Type <b>/</b> in an article for headings, lists, tables, callouts, images and embeds. It saves automatically and keeps version history; star articles to find them under Favorites, and search everything at the top.", act: [] },
    { id: "ai", t: "AI helpers (✨)", k: ["ai", "copilot", "assistant", "write", "summarise", "summarize", "generate", "draft", "suggest"],
      a: "When AI is switched on, ✨ buttons appear: <b>Write description</b> and <b>Suggest checklist</b> in tasks, <b>Draft</b>/<b>Improve</b> in the Feed, <b>Draft email</b> in CRM, <b>Summarise</b> and <b>Suggest replies</b> in Chat, <b>Summarise meeting</b> in Company & HR, and <b>Summarise</b>/<b>Improve writing</b> in the Knowledge base. You can edit the result before inserting it.", act: [] },
    { id: "hr", app: "company", t: "Time off and team directory", k: ["absence", "vacation", "leave", "sick", "holiday", "directory", "employee", "department", "off"],
      a: "<b>Company & HR</b> has the employee directory, an org chart by department, and the <b>Absence chart</b>. Press <b>+ Time off</b> to add vacation, sick leave, remote or a trip. Absences show on Home and the Calendar.", act: ["company"] },
    { id: "clock", app: "company", t: "Clock in / track my hours", k: ["clock", "time", "hours", "work", "workday", "track", "attendance", "timer"],
      a: "Press <b>▶ Start day</b> on Home (or Company & HR → Time tracking). Pause for breaks and End when done. A timer appears in the top bar, and the weekly report shows everyone's hours.", act: ["company"] },
    { id: "drive", app: "drive", t: "Drive: files and sharing", k: ["drive", "file", "folder", "upload", "share", "document", "version", "storage", "recycle", "preview"],
      a: "<b>Drive</b> has <b>My Drive</b> (private), <b>Company drive</b> (everyone), <b>Shared with me</b> and <b>Groups</b>. Drag files in to upload (up to 700 KB each; add bigger files as links). Click a file to preview it; ⋯ lets you share, rename, move, star, upload a new version or delete (goes to the Recycle bin). The storage meter shows what uses space.", act: ["drive"] },
    { id: "automation", app: "automation", t: "Automation rules", k: ["automation", "rule", "rules", "trigger", "automatic", "auto", "workflow", "when"],
      a: "In <b>Automation → Rules</b> press <b>+ New rule</b> (or pick a quick start): choose <b>When</b> something happens (deal stage, new lead, task done, booking, invoice paid, time off requested…), optional <b>Only if</b> conditions (e.g. amount over 50,000), and <b>Then</b> what Lumen does (notify, create a task, assign, move the deal, post to chat, start an approval). Each rule has an on/off switch and a run log.", act: ["automation"] },
    { id: "approvals", app: "automation", t: "Approvals, requests and expense reports", k: ["approval", "expense", "purchase", "approve", "request", "reimburse", "process", "sign", "permission", "manager"],
      a: "Press <b>📝 Start a process</b> in <b>Automation</b>, pick a request type (Purchase request, Expense report, General approval or your own), fill it in and send. It goes to your manager (and admins if the template says so); you're notified at each step. Approvers find it under <b>Approvals → Waiting for me</b>. Admins edit templates under <b>Approvals → Templates</b>.", act: ["automation"] },
    { id: "rpa-lists", app: "automation", t: "Process boards and lists", k: ["rpa", "pipeline", "board", "stages", "list", "lists", "database", "register", "spreadsheet", "table", "track"],
      a: "<b>Automation → RPA</b> gives you boards where items move through stages with responsible people per stage (try the Hiring example). <b>Automation → Lists</b> are simple databases (equipment register, supplier list…) with your own columns, filters and CSV import/export.", act: ["automation"] },
    { id: "notifications", t: "Notifications", k: ["notification", "notifications", "bell", "alert", "notify", "unread", "sound", "popup", "reminder", "not getting messages"],
      a: "New chat messages, task assignments, mentions, comments and announcements pop up as a card with a soft chime, and the 🔔 bell (top right) keeps the list; “Mark all read” clears it. To get them while Lumen is in the background, click **Turn on** in the bell menu (or **Settings → Notifications**) and allow notifications. There you can also mute the sound, choose **All messages** or **DMs & @mentions** for chat, and **Send a test**. If it says Blocked, click the 🔒 icon next to the address and allow Notifications. Events remind you 10 minutes before, and you get a daily nudge for tasks due today.", act: ["settings"] },

    // ---------- look & device ----------
    { id: "theme", t: "Dark mode, colours and glass", k: ["dark", "light", "theme", "color", "accent", "glass", "blur", "transparent", "transparency"],
      a: "Open <b>Settings</b>: Appearance (light / dark / system), accent colour, <b>Glass blur</b> and <b>Glass transparency</b> (changes show live behind the window), and animations on/off. <b>Ctrl Shift L</b> toggles dark mode.", act: ["settings", "theme"] },
    { id: "slow", t: "It feels slow", k: ["slow", "lag", "laggy", "performance", "battery", "hot", "fps", "heavy"],
      a: "Glass effects and animations use the graphics card. In <b>Settings</b>, turn <b>Animations</b> off and lower <b>Glass blur</b>. Closing other heavy tabs helps too.", act: ["settings"] },
    { id: "mobile", t: "Use Lumen on my phone", k: ["mobile", "phone", "android", "iphone", "install", "app", "homescreen", "tablet"],
      a: "Open <b>lumenspaceapp.github.io</b> on your phone. To install it: Chrome → ⋮ → <b>Add to Home screen</b>; iPhone Safari → Share → <b>Add to Home Screen</b>. On a phone the sidebar opens with ☰, and you long-press to drag.", act: [] },
    { id: "update", t: "Changes or fixes aren't showing", k: ["update", "changes", "refresh", "old", "cache", "stale", "showing", "version", "fix", "latest"],
      a: "Do a hard refresh: <b>Ctrl Shift R</b> (Mac: Cmd Shift R). On a phone, close the tab and open it again. Lumen checks for the newest version every time it loads.", act: ["reload"] },
    { id: "offline", t: "Offline and syncing", k: ["offline", "sync", "synced", "internet", "connection", "save", "saved", "lost"],
      a: "Everything saves automatically: the top bar says <b>Saved</b> (private) or <b>Synced</b> (shared). Shared workspaces keep working offline and sync when you're back online. If it says “Sync failed”, check your connection, then run <b>Check my setup</b>.", act: ["check"] },
    { id: "address", t: "The old address", k: ["address", "url", "link", "old", "gamerslife", "moved", "domain"],
      a: "Lumen moved to <b>lumenspaceapp.github.io</b>. The old address forwards here. If you had private pages there, open the old address once and press <b>Move my pages & continue</b>.", act: [] },
    { id: "delete-ws", t: "Delete a shared workspace", k: ["delete", "workspace", "remove", "close", "shared"],
      a: "Owner only: open <b>Share → Delete shared workspace</b>. It permanently deletes all its pages and data for every member.", act: ["invite"] },
    { id: "reset", pages: true, t: "Start over / reset", k: ["reset", "start", "over", "clear", "wipe", "demo"],
      a: "<b>Settings → Reset</b> replaces your <i>private</i> workspace with the demo pages (export a backup first). Shared workspaces aren't affected.", act: ["settings"] },
  ];

  const SYN = { teammate: "member", friend: "member", colleague: "member", coworker: "member", team: "member", people: "member", user: "member", members: "member", friends: "member",
    visible: "see", appear: "see", appearing: "see", showing: "see", shows: "see", seen: "see", view: "see", cant: "can't", cannot: "can't",
    login: "signin", "log-in": "signin", logging: "signin", signin: "signin", signing: "signin", sign: "signin",
    remove: "delete", erase: "delete", deleting: "delete", deleted: "delete", bin: "trash",
    phone: "mobile", android: "mobile", iphone: "mobile", ios: "mobile", tablet: "mobile", ipad: "mobile",
    invitation: "invite", invited: "invite", invites: "invite", inviting: "invite",
    msg: "message", messages: "message", texting: "message", dms: "dm", posts: "post", tasks: "task", todos: "todo",
    pic: "picture", dp: "avatar", pfp: "avatar", photo: "picture", colour: "color", colors: "color", darkmode: "dark",
    meeting: "meet", calls: "call", leaves: "leave", holidays: "holiday", deals: "deal", leads: "lead", files: "file", uploads: "upload",
    notifications: "notification", notif: "notification", workspaces: "workspace", pages: "page", blocks: "block", lagging: "slow", lags: "slow" };
  const STOP = new Set("a an the i my me to is it in on of for and or how do does did can could why what where when which with this that be are am was not no you your we our there here get got please help want need".split(" "));
  const tokens = s => String(s).toLowerCase().replace(/[^a-z0-9'\s-]/g, " ").split(/\s+/).filter(Boolean).map(w => SYN[w] || w).filter(w => !STOP.has(w));
  // similar enough? (same word, a prefix of 4+ letters, or one typo)
  const lev = (a, b) => { const d = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) { let prev = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } }
    return d[b.length]; };
  // same word → 1, shared beginning (4+ letters) → .8, a typo (1 letter off, 2 for long words) → .8
  const near = (a, b) => {
    if (a === b) return 1;
    if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return .8;
    const L = Math.min(a.length, b.length); if (L < 4 || Math.abs(a.length - b.length) > 2) return 0;
    return lev(a, b) <= (L >= 8 ? 2 : 1) ? .8 : 0;
  };
  function search(q) {
    const words = tokens(q);
    if (!words.length) return [];
    return KB.map(e => {
      let s = 0;
      const seen = new Set();
      e.k.forEach((k, idx) => { const w = idx < 3 ? 2 : 1, kk = SYN[k] || k; if (seen.has(kk)) return; seen.add(kk); const best = Math.max(0, ...words.map(x => near(x, kk))); s += best * w; });
      tokens(e.t).forEach(t => { if (words.some(x => near(x, t) >= .8)) s += .6; });
      return { e, s };
    }).filter(x => x.s >= 1.5).sort((a, b) => b.s - a.s);
  }
  // topics marked pages:true only apply when pages are on, pages:false only when they're off
  const on = window.FEATURES?.pages !== false;
  for (let i = KB.length - 1; i >= 0; i--) if (KB[i].pages === !on) KB.splice(i, 1);
  window.HelpKB = { KB, search, byId: id => KB.find(e => e.id === id) };
})();

