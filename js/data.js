/* Data: collections for the business apps (tasks, chat, CRM…).
   Shared workspace → Firestore  workspaces/{ws}/{collection}/{id}  (live for every member)
   Private workspace → browser storage. Same API either way. */
(function () {
  const LKEY = "lumen-apps-local";
  const COLS = ["tasks", "projects", "chat", "channels", "feed", "events", "leads", "deals", "contacts", "companies", "people", "absences", "timelog", "files", "folders", "rules", "notifications"];
  let local; try { local = JSON.parse(localStorage.getItem(LKEY)) || {}; } catch { local = {}; }
  const cache = {}, subs = {}, unsubs = {}, listeners = {};
  let saveT;
  const cloud = () => !!(window.Cloud?.ws && Cloud.fs);
  const saveLocal = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(LKEY, JSON.stringify(local)); } catch (e) { UI.toast("Storage full: " + e.message); } }, 200); };
  const emit = col => (listeners[col] || new Set()).forEach(fn => { try { fn(list(col)); } catch (e) { console.error(e); } });

  function ensure(col) {
    if (cache[col]) return;
    cache[col] = {};
    if (cloud()) {
      const { fb, ref } = Cloud.fs;
      let q = fb.collection(ref(), col);
      if (col === "chat" || col === "feed" || col === "notifications" || col === "timelog") q = fb.query(q, fb.orderBy("at", "desc"), fb.limit(400));
      unsubs[col] = fb.onSnapshot(q, snap => {
        snap.docChanges().forEach(ch => { if (ch.type === "removed") delete cache[col][ch.doc.id]; else cache[col][ch.doc.id] = { id: ch.doc.id, ...ch.doc.data() }; });
        emit(col);
      }, e => { console.warn(col, e); if (e.code === "permission-denied") UI.toast("No permission for " + col + ". Publish the latest firestore.rules."); });
    } else Object.assign(cache[col], local[col] || {});
  }
  function list(col) { ensure(col); return Object.values(cache[col]); }

  const Data = {
    COLS,
    list,
    get(col, id) { ensure(col); return cache[col][id]; },
    on(col, fn) { ensure(col); (listeners[col] ||= new Set()).add(fn); fn(list(col)); return () => listeners[col].delete(fn); },
    uid: () => Store.uid() + Store.uid().slice(0, 4),

    async add(col, obj, id) {
      ensure(col); id = id || Data.uid();
      const rec = { ...obj, at: obj.at || Date.now(), by: obj.by || Data.me().key };
      cache[col][id] = { id, ...rec }; emit(col);
      if (cloud()) { const { fb, ref } = Cloud.fs; await fb.setDoc(fb.doc(ref(), col, id), clean(rec)).catch(err); }
      else { (local[col] ||= {})[id] = { id, ...rec }; saveLocal(); }
      Data.hook("add", col, cache[col][id], null);
      return id;
    },
    async update(col, id, patch) {
      ensure(col); const before = cache[col][id] ? { ...cache[col][id] } : null;
      cache[col][id] = { ...(cache[col][id] || { id }), ...patch }; emit(col);
      if (cloud()) { const { fb, ref } = Cloud.fs; await fb.setDoc(fb.doc(ref(), col, id), clean(patch), { merge: true }).catch(err); }
      else { (local[col] ||= {})[id] = cache[col][id]; saveLocal(); }
      Data.hook("update", col, cache[col][id], before);
    },
    async remove(col, id) {
      ensure(col); const before = cache[col][id]; delete cache[col][id]; emit(col);
      if (cloud()) { const { fb, ref } = Cloud.fs; await fb.deleteDoc(fb.doc(ref(), col, id)).catch(err); }
      else { if (local[col]) delete local[col][id]; saveLocal(); }
      Data.hook("remove", col, null, before);
    },
    // called when the active workspace changes
    reset() {
      Object.values(unsubs).forEach(u => u()); for (const k in unsubs) delete unsubs[k];
      for (const k in cache) delete cache[k];
      Object.keys(listeners).forEach(col => { if (listeners[col].size) { ensure(col); emit(col); } });
    },
    hooks: new Set(),
    hook(kind, col, after, before) { Data.hooks.forEach(fn => { try { fn(kind, col, after, before); } catch (e) { console.error(e); } }); },

    /* ---------- people ---------- */
    me() {
      const u = window.Cloud?.user;
      if (cloud() && u) return { key: u.email.toLowerCase(), name: u.displayName || u.email.split("@")[0], email: u.email.toLowerCase(), photo: u.photoURL || "" };
      const s = Store.local.settings, prof = (local.people || {}).me || {};
      return { key: "me", name: prof.name || s.userName || "You", email: "", photo: "" };
    },
    people() {
      const me = Data.me();
      if (!cloud()) { const prof = Data.get("people", "me") || {}; return [{ ...prof, ...me, title: prof.title || "", dept: prof.dept || "", phone: prof.phone || "", about: prof.about || "", online: true }]; }
      const profiles = Object.fromEntries(list("people").map(p => [p.id, p]));
      const online = Object.fromEntries((Cloud.people || []).map(p => [String(p.email || "").toLowerCase(), p]));
      return (Cloud.ws.members || []).map(email => {
        const p = profiles[email] || {}, o = online[email] || {};
        return { key: email, email, name: p.name || o.name || email.split("@")[0], photo: p.photo || o.photo || "", title: p.title || "", dept: p.dept || "", phone: p.phone || "", about: p.about || "",
          online: !!o.at && Date.now() - (o.at.toMillis?.() || 0) < 70000 };
      });
    },
    person(key) { return Data.people().find(p => p.key === key) || { key, name: key === "me" ? "You" : String(key || "Someone").split("@")[0], photo: "" }; },
    // keep my profile card up to date for teammates
    syncMe() {
      if (!cloud()) return;
      const me = Data.me(), cur = Data.get("people", me.key);
      if (!cur || cur.name !== me.name || cur.photo !== me.photo) Data.update("people", me.key, { name: me.name, photo: me.photo, email: me.email });
    },
    notify(to, text, link) { if (!to || to === Data.me().key) return; Data.add("notifications", { to, text, link: link || "", read: false }); },
  };
  const clean = o => JSON.parse(JSON.stringify(o));
  const err = e => { console.error(e); UI.toast("Couldn't save: " + (e.code || e.message)); };
  window.Data = Data;
})();
