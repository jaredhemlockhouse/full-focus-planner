import { db, configured, setupScreen } from "./firebase.js";
import { ymd, parseYmd, addDays, weekStart, qOf, K, fmt, sameDay, weekLabel, qLabel, esc, DAYS, glanceDays } from "./common.js";
import { collection, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const S = { uid: null, key: null, cache: {}, board: {}, dirty: new Set(), timers: {}, tab: "today", date: new Date(), armed: null, pendingRender: false, unsubs: [] };
const $ = s => document.querySelector(s);
const main = $("#main");

/* ---------- helpers ---------- */
const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => Math.random().toString(36).slice(2, 10);
function setPath(o, path, v) { const p = path.split("."); let c = o; for (let i = 0; i < p.length - 1; i++) { const k = p[i]; if (c[k] == null) c[k] = /^\d+$/.test(p[i + 1]) ? [] : {}; c = c[k]; } c[p[p.length - 1]] = v; }
function getPath(o, path) { return path.split(".").reduce((c, k) => c == null ? c : c[k], o); }
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };
const hourLabel = h => h === 12 ? "12 PM" : h > 12 ? `${h - 12} PM` : `${h} AM`;

const RITUAL_NAMES = [["morning", "Morning", "Before work"], ["startup", "Workday Startup", "First 30 minutes at work"], ["shutdown", "Workday Shutdown", "Last 30 minutes at work"], ["evening", "Evening", "Before bed"]];
const DEFAULT_RITUALS = {
  morning: ["Up by 6:00", "Water + coffee", "Read or reflect, 15 min", "Move: walk or workout"],
  startup: ["Inbox and messages to zero", "Check today's calendar", "Confirm Daily Big 3", "Review guest and owner issues"],
  shutdown: ["Review tomorrow's calendar", "Set tomorrow's Big 3", "Log today's wins", "Close open loops"],
  evening: ["Screens down by 9:30", "Prep for tomorrow", "Read", "Lights out by 10:30"]
};
const SELFCARE = [["sleep", "Sleep"], ["eat", "Eat"], ["move", "Move"], ["connect", "Connect"], ["reflect", "Reflect"], ["rest", "Rest"], ["play", "Play"]];
const IW_ROWS = [["early", "Early AM"], ["am", "Morning"], ["pm", "Afternoon"], ["eve", "Evening"]];
const STAGES = ["", "front", "back", "off"]; const STAGE_LABEL = { "": "Set stage", front: "Front stage", back: "Back stage", off: "Off stage" };

const blank3 = () => [0, 1, 2].map(() => ({ t: "", done: false, priv: false }));
function defaultFor(k) {
  if (k.startsWith("d-")) return { big3: blank3(), tasks: [], sched: {}, notes: "", rit: {} };
  if (k.startsWith("w-")) return { big3: blank3(), wins: ["", "", ""], keep: "", improve: "", start: "", stop: "", care: {}, notes: "" };
  if (k.startsWith("q-")) return { goals: [], notes: "" };
  if (k === "settings") return { rituals: clone(DEFAULT_RITUALS), ideal: {} };
  return {};
}
const get = k => S.cache[k] || defaultFor(k);

/* ---------- saving (Firestore queues writes offline and syncs later) ---------- */
function setStatus(t, err) { const el = $("#status"); el.textContent = t; el.classList.toggle("err", !!err); }
function edit(k, fn) {
  if (!S.cache[k]) S.cache[k] = clone(defaultFor(k));
  fn(S.cache[k]);
  S.dirty.add(k);
  clearTimeout(S.timers[k]);
  S.timers[k] = setTimeout(() => flush(k), 600);
  setStatus("Saving…");
}
function project(k, d) {
  if (k.startsWith("d-") || k.startsWith("w-")) return { big3: (d.big3 || []).filter(x => x.t && x.t.trim() && !x.priv).map(x => ({ t: x.t.trim(), done: !!x.done })) };
  if (k.startsWith("q-")) return { goals: (d.goals || []).filter(g => g.title && g.title.trim() && !g.priv).map(g => ({ title: g.title.trim(), type: g.type || "achievement", due: g.due || "", progress: Number(g.progress) || 0 })) };
  return null;
}
function flush(k) {
  S.dirty.delete(k);
  const data = clone(S.cache[k]);
  const writes = [setDoc(doc(db, "p", S.key, "planner", k), data)];
  // Owner-facing copy: only Big 3s and goal progress, never private items.
  const p = project(k, data);
  if (p) {
    const cur = S.board[k]; const curP = cur ? (({ updated, ...r }) => r)(cur) : null;
    const empty = (p.big3 && !p.big3.length) || (p.goals && !p.goals.length);
    if (!(empty && !cur) && JSON.stringify(curP) !== JSON.stringify(p)) {
      const body = { ...p, updated: new Date().toISOString() };
      S.board[k] = body;
      writes.push(setDoc(doc(db, "board", k), body));
    }
  }
  if (!navigator.onLine) setStatus("Saved on this device · syncs when online");
  Promise.all(writes).then(() => {
    if (!S.dirty.size) setStatus("Saved " + new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
  }).catch(e => {
    setStatus(e && e.code === "permission-denied" ? "The database blocked saving. Check the Firestore rules." : "Couldn't save. Your edits are still on screen; try again.", true);
  });
}
window.addEventListener("online", () => setStatus("Back online · syncing"));
window.addEventListener("offline", () => setStatus("Offline · edits save on this device"));

/* ---------- views ---------- */
function bigRow(k, path, item, i) {
  return `<div class="line big ${item.done ? "done" : ""}">
    <span class="num">${i + 1}</span>
    <input class="chk" type="checkbox" aria-label="Mark Big 3 item ${i + 1} done" data-doc="${k}" data-path="${path}.${i}.done" data-rr ${item.done ? "checked" : ""}>
    <input type="text" placeholder="${i === 0 ? "Most important outcome" : "Big 3 item " + (i + 1)}" value="${esc(item.t)}" data-doc="${k}" data-path="${path}.${i}.t">
    <button class="lock ${item.priv ? "on" : ""}" data-act="toggle" data-doc="${k}" data-path="${path}.${i}.priv" title="${item.priv ? "Hidden from owners. Click to share." : "Visible to owners. Click to hide."}">${item.priv ? "Private" : "Shared"}</button>
  </div>`;
}
function listRows(k, path, arr, { check = false, ph = "Add an item" } = {}) {
  const rows = arr.map((it, i) => {
    const t = check ? it.t : it, done = check && it.done;
    return `<div class="line ${done ? "done" : ""}">
      ${check ? `<input class="chk" type="checkbox" aria-label="Done" data-doc="${k}" data-path="${path}.${i}.done" data-rr ${done ? "checked" : ""}>` : ""}
      <input type="text" placeholder="${esc(ph)}" value="${esc(t)}" data-doc="${k}" data-path="${path}.${i}${check ? ".t" : ""}">
      <button class="x" aria-label="Remove" data-act="del" data-doc="${k}" data-path="${path}" data-i="${i}">×</button>
    </div>`;
  }).join("");
  return rows + `<button class="add" data-act="add" data-doc="${k}" data-path="${path}" data-check="${check ? 1 : 0}">+ Add</button>`;
}
function dayNav() {
  return `<div class="nav">
    <button class="btn icon" data-act="shift" data-n="-1" aria-label="Previous day">‹</button>
    <button class="btn" data-act="today">Today</button>
    <button class="btn icon" data-act="shift" data-n="1" aria-label="Next day">›</button>
    <input type="date" aria-label="Jump to date" data-act="jump" value="${ymd(S.date)}">
  </div>`;
}

function viewToday() {
  const d = S.date, k = K.day(d), day = get(k), wk = get(K.week(d));
  const w3 = (wk.big3 || []).filter(x => x.t && x.t.trim());
  const hours = []; for (let h = 6; h <= 21; h++) hours.push(h);
  return `<section class="sheet">
    <div class="pagehead">
      <div><div class="eyebrow">Daily Page${sameDay(d, new Date()) ? " · Today" : ""}</div>
      <h1>${fmt(d, { weekday: "long" })}, <em>${fmt(d, { month: "long", day: "numeric" })}</em></h1></div>
      ${dayNav()}
    </div>
    <div class="weekstrip"><b>Weekly Big 3</b>${w3.length ? w3.map(x => `<span class="wi ${x.done ? "d" : ""}"><span class="dot"></span>${esc(x.t)}</span>`).join("") : `<span class="muted">Not set yet. Plan it in your <button class="add" style="padding:0" data-tab="week">Weekly Preview</button>.</span>`}</div>
    <div class="cols">
      <div class="stack">
        <div><h2>Daily Big 3 <span class="tag">Owners see these</span></h2>
          <p class="hint">The three outcomes that would make today a win. Mark one Private to keep it off the owners' page.</p>
          ${(day.big3 || blank3()).map((it, i) => bigRow(k, "big3", it, i)).join("")}</div>
        <div><h2>Other Tasks</h2>${listRows(k, "tasks", day.tasks || [], { check: true, ph: "Task" })}</div>
        <div><h2>Daily Rituals</h2><div class="chips">
          ${RITUAL_NAMES.map(([id, n]) => `<label class="chip"><input class="chk" type="checkbox" data-doc="${k}" data-path="rit.${id}" ${day.rit && day.rit[id] ? "checked" : ""}>${n}</label>`).join("")}
        </div></div>
        <div><h2>Notes</h2><textarea rows="6" placeholder="Ideas, calls, follow-ups…" data-doc="${k}" data-path="notes">${esc(day.notes)}</textarea></div>
      </div>
      <div class="stack sched"><div><h2>Schedule</h2>
        ${hours.map(h => `<div class="line"><span class="time">${hourLabel(h)}</span><input type="text" aria-label="${hourLabel(h)}" value="${esc((day.sched || {})[h])}" data-doc="${k}" data-path="sched.${h}"></div>`).join("")}
      </div></div>
    </div>
  </section>`;
}

function viewWeek() {
  const d = S.date, k = K.week(d), w = get(k), qk = K.q(d), q = get(qk);
  return `<section class="sheet">
    <div class="pagehead">
      <div><div class="eyebrow">Weekly Preview</div><h1>Week of <em>${weekLabel(d)}</em></h1></div>
      <div class="nav">
        <button class="btn icon" data-act="shift" data-n="-7" aria-label="Previous week">‹</button>
        <button class="btn" data-act="today">This week</button>
        <button class="btn icon" data-act="shift" data-n="7" aria-label="Next week">›</button>
      </div>
    </div>
    <div class="cols">
      <div class="stack">
        <div><h2><span class="step">1</span> List your wins</h2><p class="hint">What went well last week, big or small.</p>${listRows(k, "wins", w.wins || [], { ph: "A win" })}</div>
        <div><h2><span class="step">2</span> Lessons learned</h2><div class="kiss">
          ${[["keep", "Keep"], ["improve", "Improve"], ["start", "Start"], ["stop", "Stop"]].map(([id, n]) => `<label>${n}<textarea data-doc="${k}" data-path="${id}" placeholder="What should I ${n.toLowerCase()}?">${esc(w[id])}</textarea></label>`).join("")}
        </div></div>
        <div><h2><span class="step">3</span> Review your goals <span class="tag">${qLabel(d).name}</span></h2>
          ${(q.goals || []).length ? q.goals.map((g, i) => `<div class="gl"><div class="r"><b>${esc(g.title || "Untitled goal")}</b><span data-pct="${qk}-${i}">${g.progress || 0}%</span></div>
            <div class="prog"><input type="range" min="0" max="100" step="5" value="${g.progress || 0}" aria-label="Progress for ${esc(g.title)}" data-doc="${qk}" data-path="goals.${i}.progress" data-pctid="${qk}-${i}"></div>
            ${g.next ? `<small>Next step: ${esc(g.next)}</small>` : ""}</div>`).join("") : `<p class="muted">No goals for this quarter yet. <button class="add" style="padding:0" data-tab="quarter">Set quarterly goals</button></p>`}
        </div>
      </div>
      <div class="stack">
        <div><h2><span class="step">4</span> Weekly Big 3 <span class="tag">Owners see these</span></h2>
          ${(w.big3 || blank3()).map((it, i) => bigRow(k, "big3", it, i)).join("")}</div>
        <div><h2><span class="step">5</span> Plan self-care</h2><div class="chips">
          ${SELFCARE.map(([id, n]) => `<label class="chip"><input class="chk" type="checkbox" data-doc="${k}" data-path="care.${id}" ${w.care && w.care[id] ? "checked" : ""}>${n}</label>`).join("")}
        </div></div>
        <div><h2>Week at a glance</h2><p class="hint">Daily Big 3 progress. Tap a day to open it.</p>${glanceDays(get, d, "openday", false)}</div>
        <div><h2>Notes</h2><textarea data-doc="${k}" data-path="notes" placeholder="Calendar review, open loops, waiting on…">${esc(w.notes)}</textarea></div>
      </div>
    </div>
  </section>`;
}

function viewQuarter() {
  const d = S.date, k = K.q(d), q = get(k), ql = qLabel(d), goals = q.goals || [];
  return `<section class="sheet">
    <div class="pagehead">
      <div><div class="eyebrow">Quarterly Goals · ${goals.length} of 7</div><h1>Q${qOf(d)} <em>${d.getFullYear()}</em></h1><div class="sub">${ql.range}</div></div>
      <div class="nav">
        <button class="btn icon" data-act="shiftq" data-n="-1" aria-label="Previous quarter">‹</button>
        <button class="btn" data-act="today">This quarter</button>
        <button class="btn icon" data-act="shiftq" data-n="1" aria-label="Next quarter">›</button>
      </div>
    </div>
    <p class="hint" style="margin:0 0 16px">Up to seven SMARTER goals. Each has key motivations and one next step. Goal names and progress are shared with owners unless marked Private.</p>
    ${goals.length ? `<div class="goals">${goals.map((g, i) => `<div class="goal">
      <input class="gt" type="text" placeholder="Goal, written as a finished result" value="${esc(g.title)}" data-doc="${k}" data-path="goals.${i}.title">
      <div class="meta">
        <select aria-label="Goal type" data-doc="${k}" data-path="goals.${i}.type"><option value="achievement" ${g.type !== "habit" ? "selected" : ""}>Achievement</option><option value="habit" ${g.type === "habit" ? "selected" : ""}>Habit</option></select>
        <span>Due</span><input type="date" aria-label="Due date" value="${esc(g.due)}" data-doc="${k}" data-path="goals.${i}.due">
        <button class="lock ${g.priv ? "on" : ""}" data-act="toggle" data-doc="${k}" data-path="goals.${i}.priv">${g.priv ? "Private" : "Shared"}</button>
      </div>
      <div class="prog"><input type="range" min="0" max="100" step="5" value="${g.progress || 0}" aria-label="Progress" data-doc="${k}" data-path="goals.${i}.progress" data-pctid="${k}-${i}"><span class="pct" data-pct="${k}-${i}">${g.progress || 0}%</span></div>
      <div class="mini">Key motivations</div>
      ${[0, 1, 2].map(j => `<div class="line"><span class="time" style="width:14px">${j + 1}</span><input type="text" placeholder="Why this matters" value="${esc((g.why || [])[j])}" data-doc="${k}" data-path="goals.${i}.why.${j}"></div>`).join("")}
      <div class="mini">Next step</div>
      <div class="line"><input type="text" placeholder="The very next action" value="${esc(g.next)}" data-doc="${k}" data-path="goals.${i}.next"></div>
      <div class="foot"><button class="btn ghost ${S.armed === g.id ? "danger" : ""}" data-act="delgoal" data-doc="${k}" data-id="${g.id}">${S.armed === g.id ? "Click again to remove" : "Remove goal"}</button></div>
    </div>`).join("")}</div>` : `<div class="empty">No goals for ${ql.name} yet. Add your first one to start tracking progress.</div>`}
    <div style="margin-top:16px"><button class="btn primary" data-act="addgoal" data-doc="${k}" ${goals.length >= 7 ? "disabled" : ""}>${goals.length >= 7 ? "Seven goals is the limit" : "+ Add goal"}</button></div>
    <div style="margin-top:24px"><h2>Quarter notes</h2><textarea data-doc="${k}" data-path="notes" placeholder="Themes, constraints, what to protect this quarter…">${esc(q.notes)}</textarea></div>
  </section>`;
}

function viewRituals() {
  const k = "settings", s = get(k), r = s.rituals || DEFAULT_RITUALS, iw = s.ideal || {};
  return `<section class="sheet">
    <div class="pagehead"><div><div class="eyebrow">Rituals & Ideal Week</div><h1>How a good week <em>runs</em></h1></div></div>
    <h2>Daily rituals</h2><p class="hint">Edit each list to match your routine. You check these off on each Daily Page.</p>
    <div class="rituals">${RITUAL_NAMES.map(([id, n, when]) => `<div class="ritual"><h3>${n}</h3><div class="when">${when}</div>${listRows(k, "rituals." + id, r[id] || [], { ph: "Step" })}</div>`).join("")}</div>
    <h2 style="margin-top:30px">Ideal Week</h2>
    <p class="hint">Block the week you would design if you were in control. Tap the label in a cell to set its stage.</p>
    <div class="legend"><span><i style="background:var(--front)"></i>Front stage: key work only you can do</span><span><i style="background:var(--back)"></i>Back stage: prep and admin</span><span><i style="background:var(--off)"></i>Off stage: rest and family</span></div>
    <div class="scroll"><table class="iw"><thead><tr><th></th>${DAYS.map(x => `<th>${x}</th>`).join("")}</tr></thead><tbody>
      ${IW_ROWS.map(([rid, rn]) => `<tr><th class="row">${rn}</th>${DAYS.map((dn, di) => { const c = iw[`${di}-${rid}`] || {}; return `<td class="${c.s || ""}"><textarea aria-label="${dn} ${rn}" data-doc="${k}" data-path="ideal.${di}-${rid}.t">${esc(c.t)}</textarea><button class="stage" data-act="stage" data-cell="${di}-${rid}">${STAGE_LABEL[c.s || ""]}</button></td>`; }).join("")}</tr>`).join("")}
    </tbody></table></div>
  </section>`;
}

function render() {
  S.pendingRender = false;
  if (!S.uid) return;
  $("#tabs").querySelectorAll("button").forEach(b => b.setAttribute("aria-current", String(b.dataset.tab === S.tab)));
  main.innerHTML = ({ today: viewToday, week: viewWeek, quarter: viewQuarter, rituals: viewRituals }[S.tab] || viewToday)();
}
function isEditing() { const a = document.activeElement; return a && main.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== "checkbox"; }
function softRender() { if (isEditing()) S.pendingRender = true; else render(); }
main.addEventListener("focusout", () => setTimeout(() => { if (S.pendingRender && !isEditing()) render(); }, 0));

/* ---------- events ---------- */
function setTab(t) { S.tab = t; store.set("ffp-tab", t); render(); window.scrollTo(0, 0); }
document.addEventListener("click", e => { const t = e.target.closest("[data-tab]"); if (t && S.uid) { e.preventDefault(); setTab(t.dataset.tab); } });

main.addEventListener("input", e => {
  const el = e.target; if (!el.dataset.doc) return;
  if (el.type === "checkbox" || el.tagName === "SELECT" || el.type === "date") return;
  const v = el.type === "range" ? Number(el.value) : el.value;
  edit(el.dataset.doc, d => setPath(d, el.dataset.path, v));
  if (el.dataset.pctid) document.querySelectorAll(`[data-pct="${el.dataset.pctid}"]`).forEach(n => n.textContent = v + "%");
});
main.addEventListener("change", e => {
  const el = e.target;
  if (el.dataset.act === "jump" && el.value) { S.date = parseYmd(el.value); render(); return; }
  if (!el.dataset.doc) return;
  if (!(el.type === "checkbox" || el.tagName === "SELECT" || el.type === "date")) return;
  const v = el.type === "checkbox" ? el.checked : el.value;
  edit(el.dataset.doc, d => setPath(d, el.dataset.path, v));
  if (el.dataset.rr !== undefined) el.closest(".line")?.classList.toggle("done", v);
});
main.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b || b.tagName === "INPUT" || !S.uid) return;
  const a = b.dataset.act, k = b.dataset.doc;
  if (a !== "delgoal") S.armed = null;
  switch (a) {
    case "shift": S.date = addDays(S.date, Number(b.dataset.n)); break;
    case "shiftq": S.date = new Date(S.date.getFullYear(), S.date.getMonth() + 3 * Number(b.dataset.n), 1); break;
    case "today": S.date = new Date(); break;
    case "openday": S.date = parseYmd(b.dataset.d); S.tab = "today"; break;
    case "toggle": edit(k, d => setPath(d, b.dataset.path, !getPath(d, b.dataset.path))); break;
    case "add": {
      edit(k, d => { let arr = getPath(d, b.dataset.path); if (!Array.isArray(arr)) { arr = []; setPath(d, b.dataset.path, arr); } arr.push(b.dataset.check === "1" ? { t: "", done: false } : ""); });
      render();
      const last = [...main.querySelectorAll(`input[type=text][data-doc="${k}"][data-path^="${b.dataset.path}."]`)].pop(); last && last.focus();
      return;
    }
    case "del": edit(k, d => getPath(d, b.dataset.path).splice(Number(b.dataset.i), 1)); break;
    case "addgoal": {
      edit(k, d => { d.goals = d.goals || []; if (d.goals.length < 7) d.goals.push({ id: uid(), title: "", type: "achievement", due: ymd(qLabel(S.date).end), progress: 0, why: ["", "", ""], next: "", priv: false }); });
      render(); const gts = main.querySelectorAll(".gt"); gts.length && gts[gts.length - 1].focus(); return;
    }
    case "delgoal": if (S.armed !== b.dataset.id) { S.armed = b.dataset.id; } else { S.armed = null; edit(k, d => { d.goals = (d.goals || []).filter(g => g.id !== b.dataset.id); }); } break;
    case "stage": edit("settings", d => { d.ideal = d.ideal || {}; const c = d.ideal[b.dataset.cell] || (d.ideal[b.dataset.cell] = { t: "" }); c.s = STAGES[(STAGES.indexOf(c.s || "") + 1) % STAGES.length]; }); break;
    default: return;
  }
  render();
});
// Coming back to the app the next morning should land on the new day.
let lastSeen = ymd(new Date());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { [...S.dirty].forEach(k => { clearTimeout(S.timers[k]); flush(k); }); return; }
  const now = ymd(new Date());
  if (now !== lastSeen) { if (ymd(S.date) === lastSeen) S.date = new Date(); lastSeen = now; softRender(); }
});

function start() {
  S.uid = "planner";
  $("#tabs").hidden = false;
  setStatus("Loading…");
  render();
  S.unsubs.push(onSnapshot(collection(db, "board"), snap => {
    snap.docChanges().forEach(ch => { if (ch.type === "removed") delete S.board[ch.doc.id]; else S.board[ch.doc.id] = ch.doc.data(); });
  }, () => { }));
  S.unsubs.push(onSnapshot(collection(db, "p", S.key, "planner"), snap => {
    let touched = false;
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;
      if (S.dirty.has(id) || ch.doc.metadata.hasPendingWrites) return;
      if (ch.type === "removed") delete S.cache[id]; else S.cache[id] = clone(ch.doc.data());
      touched = true;
    });
    if (!S.loaded) { S.loaded = true; setStatus(snap.metadata.fromCache ? "Offline · showing saved copy" : "Synced"); }
    if (touched) softRender();
  }, e => {
    setStatus(e && e.code === "permission-denied" ? "The database blocked this. Check the Firestore rules." : "Lost connection. Reload to resync.", true);
  }));
}

S.tab = store.get("ffp-tab") || "today";
if (!["today", "week", "quarter", "rituals"].includes(S.tab)) S.tab = "today";

function boot() {
  S.key = "main";
  S.unsubs.forEach(u => u()); S.unsubs = []; S.cache = {}; S.board = {}; S.loaded = false;
  start();
}

if (!configured) { main.innerHTML = setupScreen(); }
else boot();
