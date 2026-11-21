# Bitrix24 → Lumen feature parity

Checked against the live Bitrix24 portal (all left-menu sections, their tabs and sub-menus) on 21 Nov 2026.
✅ Lumen has it · 🟡 partly · ⬜ missing · 🚫 not possible on a free static site (needs paid servers or outside services)

## 1. Messenger & communication
| Bitrix24 | Lumen |
|---|---|
| Direct messages, general chat, reactions, unread counts | ✅ |
| Video calls / online meetings | ✅ (Jitsi) |
| Group chats (private, chosen members) | ✅ |
| Replies, forward, pin message, edit, delete | ✅ |
| Send files and images in chat (attach, paste, drop) | ✅ |
| Read receipts, "typing…", search in chats | ✅ |
| Channels and broadcast channels (only admins post) | ✅ |
| Task chats (a chat inside every task) | ⬜ |
| CoPilot AI in chat (summarise, suggest replies) | ✅ (switches on when the AI worker is deployed) |
| Open Channels (WhatsApp, Telegram, site chat for customers), Telephony, Contact center | 🚫 |
| Webmail (connect a mailbox) | 🚫 (needs a mail server) |

## 2. Feed
| Bitrix24 | Lumen |
|---|---|
| Message, Poll, Appreciation, Announcement, likes, comments | ✅ |
| Event post (creates a calendar event with invitations) | ✅ |
| File post | ✅ |
| Choose recipients (everyone / departments / people) | ✅ |
| "Important" posts with "I've read it" receipts | ✅ |
| @mentions in posts and comments, feed filter by type/author/date | ✅ |

## 3. Tasks & projects
| Bitrix24 | Lumen |
|---|---|
| My / assigned-by-me / all tasks, deadline board, kanban, list, priority, checklists, comments, projects | ✅ |
| Planner, Calendar and Gantt views | ✅ |
| Roles: participants (co-assignees), observers; "All roles" filter | ✅ |
| Subtasks, parent task, related tasks | ✅ |
| Tags, reminders, files on tasks | ✅ |
| Recurring tasks, task templates | ✅ |
| Time planning (start/finish), time tracking per task, estimates | ✅ |
| Task needs approval by the creator | ✅ |
| Flows (intake queues that auto-assign) | ⬜ |
| Scrum (backlog, sprints, story points, epics, burndown, velocity) | ✅ |
| Efficiency %, recycle bin | ✅ (task reports: phase 4) |
| Link tasks to CRM items | ⬜ |
| Workgroups / project spaces with their own feed, tasks, calendar, drive, chat, members, privacy | ✅ |
| Collabs (projects with external guests) | ⬜ |

## 4. Calendar & booking
| Bitrix24 | Lumen |
|---|---|
| Month / week / agenda, events, task deadlines and absences overlaid | ✅ |
| Day view and week time grid | ✅ |
| Invite attendees, accept / maybe / decline, busy check | ✅ |
| Recurring events, custom reminders, company / personal calendars | ✅ |
| Meeting rooms with double-booking warning | ✅ |
| Google / Outlook calendar sync | 🚫 for now |
| Booking: resources, services, day/week schedule, customers, confirmations, late/no-show | ✅ |

## 5. CRM & sales
| Bitrix24 | Lumen |
|---|---|
| Leads (with conversion), deals pipeline, contacts, companies, activity timeline, reports | ✅ |
| Several pipelines, deal views: kanban / list / activities / calendar | ✅ |
| Activities with deadlines (call, meeting, to-do) and "My activities" | ✅ |
| Product catalog, products on deals | ✅ |
| Estimates (quotes) and invoices, printable PDF | ✅ |
| Vendors | ✅ (signing parties: with e-signature, phase 4) |
| History / audit log, recycle bin, duplicates and merge | ✅ |
| Import / export (CSV), custom fields | ✅ |
| CRM forms (public form, QR code, embed; answers become leads) | ✅ |
| Smart processes (your own CRM item types with stages) | ✅ |
| Sales funnel & manager analytics | ✅ |
| Inventory: warehouses, stock receipts, sales orders, transfers, write-offs, stock analytics | ✅ |
| Sales channels, speech analytics, sales scripts | 🚫 / ⬜ |
| Sites & online stores, payments & delivery | 🚫 |
| Marketing: campaigns (email/SMS), segments, templates, blacklist, recipients | ✅ (sending through your mail app or mail-merge export; 🚫 sending from Lumen itself, ads) |
| e-Signature (and e-Signature for HR) | ✅ (workspace members as signers; external signers later) |

## 6. Company & HR
| Bitrix24 | Lumen |
|---|---|
| Employee directory, structure, absence chart, worktime (clock in/out) | ✅ |
| Company structure as an org chart with department heads | ✅ |
| Work reports (daily / weekly report to your manager, with approval) | ✅ |
| Work schedules (shifts) | ✅ |
| Meetings and briefings (agenda, attendees, minutes, follow-up tasks) | ✅ |
| Leave requests with approval and leave balances | ✅ |
| Birthdays & anniversaries | ✅ |
| Knowledge base (spaces with nested articles, versions, search) | ✅ |
| Login history | 🚫 |

## 7. Drive, documents & boards
| Bitrix24 | Lumen |
|---|---|
| Shared folders, files, links | ✅ (files up to ~700 KB) |
| My drive vs company drive, sharing rights, versions, recycle bin, preview, grid view | ✅ |
| Online documents, spreadsheets, presentations | ⬜ (documents possible by reusing Lumen pages) |
| Boards (whiteboards) | ✅ |
| Big files | 🚫 on the free Firebase plan |

## 8. Automation & analytics
| Bitrix24 | Lumen |
|---|---|
| Automation rules and triggers (conditions, many triggers and actions, run log) | ✅ |
| RPA processes (custom pipelines with stages, forms and assigned steps) | ✅ |
| Lists (custom databases) | ✅ (smart scripts: later) |
| Approval workflows (leave, expenses, purchases) | ✅ |
| BI Builder: dashboards for CRM, tasks, team, booking, inventory, automation; custom dashboards | ✅ |
| CoPilot AI (task descriptions, checklists, drafts, summaries) | ✅ (switches on when the AI worker is deployed) |

## 9. Platform
| Bitrix24 | Lumen |
|---|---|
| Notifications, search, themes, invite users, mobile | ✅ |
| Access permissions (owner / admin / member / guest, per-app view and edit rights) | ✅ (enforced in the app, not yet by the database) |
| Market, developer resources, MCP connections, subscription | 🚫 |

## Build plan
1. ✅ **Daily work** (shipped 21 Nov 2026): Tasks (calendar / Gantt / planner views, participants & observers, subtasks, tags, reminders, recurring, templates, time tracking, approval, files), Calendar (day view, invitations with accept/decline, recurring events, reminders), Messenger (group chats, replies, pins, files, search, read receipts, task chats), Feed (event & file posts, recipients, read receipts, @mentions).
2. ✅ **Sales** (shipped 21 Nov 2026): several pipelines, products & catalog, estimates & invoices with PDF, activities, import/export, custom fields, CRM web forms, Booking, Inventory.
3. ✅ **Company** (shipped 21 Nov 2026): work reports, schedules, meetings & briefings, leave approvals, org chart, project spaces (workgroups + Scrum), Lists & RPA processes, access permissions.
4. ✅ **Extras** (built 22 Nov 2026): analytics dashboards, whiteboards, e-signature, marketing segments, knowledge base, AI helpers.

Limits to keep in mind: on Firebase's free plan a workspace gets about 50,000 reads and 20,000 writes a day and 1 GB of storage, which is plenty for a small team but not for big files or large customer lists.
