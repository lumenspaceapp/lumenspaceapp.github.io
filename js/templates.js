/* Workspace generator: turns onboarding answers into a ready-made set of pages and databases */
(function () {
  const B = (type, text = "", extra = {}) => Store.block(type, text, extra);
  const uid = () => Store.uid();
  const TAGC = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
  const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const cover = i => Store.COVERS[i % Store.COVERS.length];

  function page(title, icon, blocks, i = 0) {
    const t = Date.now();
    return { id: uid(), title, icon, cover: cover(i), parentId: null, children: [], blocks, favorite: false, deleted: false,
      createdAt: t, updatedAt: t, fullWidth: false, smallText: false, font: "default", locked: false, fresh: false };
  }
  // spec: [name, type, options?]   rows: [{ PropName: value }]  (select/multi values are option names)
  function db(title, view, spec, rows, groupBy) {
    const props = spec.map(([name, type, opts]) => ({ id: uid(), name, type,
      options: (opts || []).map((o, i) => Array.isArray(o) ? { id: uid(), name: o[0], color: o[1] } : { id: uid(), name: o, color: TAGC[(i * 2 + 4) % TAGC.length] }) }));
    const by = Object.fromEntries(props.map(p => [p.name, p]));
    const rowObjs = rows.map(vals => {
      const values = {};
      for (const [k, v] of Object.entries(vals)) {
        const p = by[k]; if (!p || v == null) continue;
        if (p.type === "select") values[p.id] = p.options.find(o => o.name === v)?.id;
        else if (p.type === "multi") values[p.id] = v.map(n => p.options.find(o => o.name === n)?.id).filter(Boolean);
        else values[p.id] = v;
      }
      return { id: uid(), notes: "", values };
    });
    const g = (groupBy && by[groupBy]) || props.find(p => p.type === "select");
    return B("database", "", { db: { title, view, groupBy: g?.id, props, rows: rowObjs } });
  }
  const STATUS = [["Not started", "gray"], ["In progress", "blue"], ["Done", "green"]];
  const PRIORITY = [["High", "red"], ["Medium", "yellow"], ["Low", "gray"]];

  /* ---------- the catalogue: every pickable use case ---------- */
  const CATALOG = {
    // personal
    notes: { label: "Notes & ideas", icon: "📝", for: ["personal", "school"], make: i => page("Quick Notes", "📝", [
      B("callout", "Capture anything here, then move it somewhere better later.", { icon: "💡", bg: "yellow" }),
      B("h2", "Inbox"), B("bullet", "An idea worth remembering"), B("bullet", ""),
      B("h2", "Ideas"), B("toggle", "Side project ideas", { body: "Write them down before they disappear." }), B("toggle", "Things to learn", { body: "" }), B("p")], i) },
    tasks: { label: "To-dos", icon: "✅", for: ["personal"], make: i => page("To-dos", "✅", [
      B("h2", "Today"), B("todo", "Plan the day"), B("todo", "Most important task"), B("todo", "Inbox zero"),
      B("h2", "This week"), B("todo", "Groceries"), B("todo", "Call family"), B("h2", "Someday"), B("todo", "Learn something new"), B("p")], i) },
    habits: { label: "Habit tracker", icon: "🔁", for: ["personal"], make: i => page("Habit Tracker", "🔁", [
      B("quote", "We are what we repeatedly do."),
      db("This week", "table", [["Habit", "title"], ["Mon", "checkbox"], ["Tue", "checkbox"], ["Wed", "checkbox"], ["Thu", "checkbox"], ["Fri", "checkbox"], ["Sat", "checkbox"], ["Sun", "checkbox"]],
        [{ Habit: "💧 Drink 2L water", Mon: true }, { Habit: "🏃 Exercise 30 min" }, { Habit: "📖 Read 20 pages", Mon: true, Tue: true }, { Habit: "🧘 Meditate" }]), B("p")], i) },
    journal: { label: "Journal", icon: "📓", for: ["personal"], make: i => page("Journal", "📓", [
      B("callout", new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }), { icon: "🗓️" }),
      B("h3", "Grateful for"), B("bullet", ""), B("h3", "What would make today great?"), B("todo", ""),
      B("h3", "Reflections"), B("p", ""), B("toggle", "Prompts if you're stuck", { body: "What did I learn today? What drained me? What gave me energy?" })], i) },
    reading: { label: "Reading list", icon: "📚", for: ["personal", "school"], make: i => page("Reading List", "📚", [
      db("Books", "gallery", [["Title", "title"], ["Author", "text"], ["Status", "select", [["To read", "gray"], ["Reading", "blue"], ["Finished", "green"]]], ["Rating", "select", ["⭐", "⭐⭐", "⭐⭐⭐", "⭐⭐⭐⭐", "⭐⭐⭐⭐⭐"]], ["Link", "url"]],
        [{ Title: "Atomic Habits", Author: "James Clear", Status: "Reading" }, { Title: "Deep Work", Author: "Cal Newport", Status: "To read" }, { Title: "The Pragmatic Programmer", Author: "Hunt & Thomas", Status: "Finished", Rating: "⭐⭐⭐⭐⭐" }]), B("p")], i) },
    goals: { label: "Goals", icon: "🎯", for: ["personal"], make: i => page("Goals", "🎯", [
      db("Goals", "table", [["Goal", "title"], ["Area", "select", [["Health", "green"], ["Career", "blue"], ["Learning", "purple"], ["Money", "yellow"]]], ["Progress", "progress"], ["Target", "date"]],
        [{ Goal: "Run a 10K", Area: "Health", Progress: 30, Target: day(90) }, { Goal: "Learn a new skill", Area: "Learning", Progress: 10, Target: day(120) }, { Goal: "Build an emergency fund", Area: "Money", Progress: 45, Target: day(180) }]), B("p")], i) },
    travel: { label: "Travel plans", icon: "✈️", for: ["personal"], make: i => page("Travel Plans", "✈️", [
      B("h2", "Next trip"), B("callout", "Destination · Dates · Budget", { icon: "🧭" }),
      db("Itinerary", "table", [["Plan", "title"], ["Day", "date"], ["Type", "select", [["Flight", "blue"], ["Stay", "purple"], ["Activity", "green"], ["Food", "orange"]]], ["Booked", "checkbox"]],
        [{ Plan: "Flight out", Day: day(30), Type: "Flight" }, { Plan: "Check in", Day: day(30), Type: "Stay" }, { Plan: "Old town walking tour", Day: day(31), Type: "Activity" }]),
      B("h2", "Packing list"), B("todo", "Passport"), B("todo", "Chargers"), B("todo", "Toiletries"), B("p")], i) },
    budget: { label: "Budget", icon: "💰", for: ["personal"], make: i => page("Budget", "💰", [
      db("Expenses", "table", [["Item", "title"], ["Category", "select", [["Rent", "purple"], ["Food", "orange"], ["Transport", "blue"], ["Fun", "pink"], ["Bills", "gray"]]], ["Amount", "number"], ["Date", "date"], ["Paid", "checkbox"]],
        [{ Item: "Rent", Category: "Rent", Amount: "15000", Date: day(1), Paid: false }, { Item: "Groceries", Category: "Food", Amount: "3200", Date: day(-2), Paid: true }, { Item: "Metro card", Category: "Transport", Amount: "800", Date: day(-5), Paid: true }]), B("p")], i) },
    // team
    projects: { label: "Projects & tasks", icon: "📋", for: ["team"], make: i => page("Projects", "📋", [
      db("Tasks", "board", [["Task", "title"], ["Status", "select", STATUS], ["Priority", "select", PRIORITY], ["Owner", "text"], ["Due", "date"]],
        [{ Task: "Kick-off meeting", Status: "Done", Priority: "Medium", Due: day(-3) }, { Task: "Write project brief", Status: "In progress", Priority: "High", Due: day(2) }, { Task: "Design first draft", Status: "Not started", Priority: "Medium", Due: day(7) }, { Task: "Share with stakeholders", Status: "Not started", Priority: "Low", Due: day(10) }]), B("p")], i) },
    meetings: { label: "Meeting notes", icon: "🗓️", for: ["team"], make: i => page("Meeting Notes", "🗓️", [
      db("Meetings", "table", [["Meeting", "title"], ["Date", "date"], ["Type", "select", [["Standup", "blue"], ["1:1", "purple"], ["Planning", "green"], ["Retro", "orange"]]], ["Attendees", "text"]],
        [{ Meeting: "Weekly planning", Date: day(0), Type: "Planning" }, { Meeting: "Daily standup", Date: day(1), Type: "Standup" }]),
      B("h2", "Template"), B("callout", "Copy this for each meeting: Goal · Agenda · Decisions · Action items", { icon: "📌" }),
      B("h3", "Agenda"), B("numbered", ""), B("h3", "Decisions"), B("bullet", ""), B("h3", "Action items"), B("todo", ""), B("p")], i) },
    wiki: { label: "Team wiki", icon: "📖", for: ["team"], make: i => page("Team Wiki", "📖", [
      B("callout", "The single source of truth for how we work. Keep it short and up to date.", { icon: "🏛️", bg: "blue" }),
      B("h2", "Start here"), B("bullet", "Who we are and what we're building"), B("bullet", "How we communicate"), B("bullet", "Tools & access"),
      B("h2", "How we work"), B("toggle", "Working hours & time off", { body: "" }), B("toggle", "Code review / approval process", { body: "" }), B("toggle", "Where to ask for help", { body: "" }), B("p")], i) },
    roadmap: { label: "Roadmap", icon: "🗺️", for: ["team"], make: i => page("Roadmap", "🗺️", [
      db("Roadmap", "board", [["Initiative", "title"], ["Quarter", "select", [["Now", "green"], ["Next", "blue"], ["Later", "gray"]]], ["Status", "select", STATUS], ["Owner", "text"]],
        [{ Initiative: "Launch v1", Quarter: "Now", Status: "In progress" }, { Initiative: "Mobile layout", Quarter: "Next", Status: "Not started" }, { Initiative: "Integrations", Quarter: "Later", Status: "Not started" }], "Quarter"), B("p")], i) },
    bugs: { label: "Bug tracker", icon: "🐞", for: ["team"], make: i => page("Bug Tracker", "🐞", [
      db("Bugs", "table", [["Bug", "title"], ["Severity", "select", [["Critical", "red"], ["Major", "orange"], ["Minor", "gray"]]], ["Status", "select", [["Open", "red"], ["Fixing", "blue"], ["Fixed", "green"]]], ["Assignee", "text"], ["Reported", "date"]],
        [{ Bug: "Login button unresponsive on mobile", Severity: "Major", Status: "Open", Reported: day(-1) }, { Bug: "Typo on pricing page", Severity: "Minor", Status: "Fixed", Reported: day(-4) }]), B("p")], i) },
    content: { label: "Content calendar", icon: "📅", for: ["team"], make: i => page("Content Calendar", "📅", [
      db("Content", "board", [["Post", "title"], ["Stage", "select", [["Idea", "gray"], ["Writing", "yellow"], ["Review", "purple"], ["Published", "green"]]], ["Channel", "multi", [["Blog", "blue"], ["Instagram", "pink"], ["YouTube", "red"], ["LinkedIn", "purple"]]], ["Publish", "date"]],
        [{ Post: "Launch announcement", Stage: "Writing", Channel: ["Blog", "LinkedIn"], Publish: day(5) }, { Post: "Behind the scenes reel", Stage: "Idea", Channel: ["Instagram"] }, { Post: "Tutorial video", Stage: "Review", Channel: ["YouTube"], Publish: day(9) }], "Stage"), B("p")], i) },
    // school
    classes: { label: "Class notes", icon: "🎓", for: ["school"], make: i => page("Class Notes", "🎓", [
      db("Lectures", "table", [["Lecture", "title"], ["Subject", "select", ["Math", "Physics", "History", "Computer Science"]], ["Date", "date"], ["Reviewed", "checkbox"]],
        [{ Lecture: "Intro & syllabus", Subject: "Math", Date: day(-2), Reviewed: true }, { Lecture: "Newton's laws", Subject: "Physics", Date: day(-1) }]),
      B("h2", "Note-taking tips"), B("bullet", "Write questions in the margin, answer them when you review"), B("bullet", "Summarise each lecture in 3 lines"), B("p")], i) },
    assignments: { label: "Assignments", icon: "🧾", for: ["school"], make: i => page("Assignments", "🧾", [
      db("Assignments", "board", [["Assignment", "title"], ["Status", "select", STATUS], ["Subject", "select", ["Math", "Physics", "History", "Computer Science"]], ["Due", "date"], ["Grade", "text"]],
        [{ Assignment: "Problem set 1", Status: "In progress", Subject: "Math", Due: day(3) }, { Assignment: "Lab report", Status: "Not started", Subject: "Physics", Due: day(6) }, { Assignment: "Essay outline", Status: "Done", Subject: "History", Due: day(-1), Grade: "A" }]), B("p")], i) },
    study: { label: "Study planner", icon: "⏰", for: ["school"], make: i => page("Study Planner", "⏰", [
      db("Exams", "table", [["Exam", "title"], ["Date", "date"], ["Prepared", "progress"]], [{ Exam: "Midterm: Math", Date: day(14), Prepared: 25 }, { Exam: "Quiz: Physics", Date: day(5), Prepared: 60 }]),
      B("h2", "This week"), B("h3", "Monday"), B("todo", "Review lecture notes"), B("h3", "Wednesday"), B("todo", "Practice problems"), B("h3", "Friday"), B("todo", "Mock test"), B("p")], i) },
    research: { label: "Research", icon: "🔬", for: ["school", "team"], make: i => page("Research", "🔬", [
      B("h2", "Question"), B("quote", "What are we trying to find out?"),
      db("Sources", "table", [["Source", "title"], ["Type", "select", [["Paper", "blue"], ["Book", "purple"], ["Article", "green"], ["Video", "red"]]], ["Link", "url"], ["Key takeaway", "text"]], [{ Source: "Example paper", Type: "Paper" }]),
      B("h2", "Findings"), B("bullet", ""), B("p")], i) },
  };
  const USES = {
    personal: { label: "For myself", icon: "🧑", desc: "Notes, to-dos, journaling and life planning.", picks: ["notes", "tasks", "habits", "journal", "goals", "reading", "travel", "budget"], defaults: ["notes", "tasks", "goals"] },
    team: { label: "With my team", icon: "👥", desc: "Projects, docs and meetings in one shared place.", picks: ["projects", "meetings", "wiki", "roadmap", "bugs", "content", "research"], defaults: ["projects", "meetings", "wiki"] },
    school: { label: "For school", icon: "🎓", desc: "Classes, assignments and exam prep.", picks: ["classes", "assignments", "study", "notes", "reading", "research"], defaults: ["classes", "assignments", "study"] },
  };

  /* ---------- build ---------- */
  function build(a) {
    const pages = {}, root = [];
    const made = a.picks.map((k, i) => CATALOG[k].make(i + 1));
    const first = (a.name || "").split(" ")[0];
    const tips = [B("todo", "Type <code>/</code> anywhere to add a block"), B("todo", "Press <code>Ctrl K</code> to search everything"), B("todo", "Drag the ⋮⋮ handle to reorder blocks")];
    if (a.use === "team") tips.unshift(B("todo", "Invite your teammates from <b>Share</b> (top right)"));
    const home = page("Getting Started", "👋", [
      B("callout", `Welcome${first ? ", " + UI.esc(first) : ""}! This workspace was set up ${USES[a.use].label.toLowerCase()}. Everything here is yours to change.`, { icon: a.icon || "✨", bg: "purple" }),
      B("h2", "Your pages"), ...made.map(p => B("page", "", { pageId: p.id })),
      B("h2", "Quick start"), ...tips,
      B("toggle", "Handy shortcuts", { body: "Ctrl K search · Ctrl Alt N new page · Ctrl \\ sidebar · Ctrl Shift L theme · Tab indent · Ctrl D duplicate" }), B("p")], 0);
    home.favorite = true;
    [home, ...made].forEach(p => { pages[p.id] = p; root.push(p.id); });
    return { pages, root, recent: [home.id], settings: Store.local.settings };
  }

  window.Templates = { CATALOG, USES, build };
})();
