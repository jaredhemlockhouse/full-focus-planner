import { db, configured, setupScreen } from "./firebase.js";
import { ymd, parseYmd, addDays, weekStart, qOf, K, fmt, sameDay, weekLabel, qLabel, esc, DAYS, glanceDays } from "./common.js?v=4";
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

// Full Focus Planner task marks: ✓ completed, / action taken (waiting), ○ delegated, → deferred, ✕ deleted.
const STATUS = [["", "Open", ""], ["done", "Completed", "✓"], ["wait", "Action taken, waiting on someone", "/"], ["deleg", "Delegated", "○"], ["defer", "Deferred to another day", "→"], ["del", "Deleted (no longer needed)", "✕"]];
const stOf = it => (it && it.s) || (it && it.done ? "done" : "");
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
  if (k.startsWith("d-") || k.startsWith("w-")) {
    const big3 = (d.big3 || []).filter(x => x.t && x.t.trim() && !x.priv).map(x => {
      const o = { t: x.t.trim(), s: stOf(x), done: stOf(x) === "done" };
      if (o.s === "deleg" && x.who && x.who.trim()) o.who = x.who.trim();
      return o;
    });
    if (k.startsWith("w-")) return { big3 };
    const sched = Object.entries(d.sched || {}).filter(([h, t]) => t && String(t).trim()).map(([h, t]) => ({ h: Number(h), t: String(t).trim() })).sort((a, b) => a.h - b.h);
    const tasks = (d.tasks || []).filter(x => x.t && x.t.trim()).map(x => {
      const o = { t: x.t.trim(), s: stOf(x), done: stOf(x) === "done" };
      if (o.s === "deleg" && x.who && x.who.trim()) o.who = x.who.trim();
      return o;
    });
    return { big3, sched, tasks, notes: (d.notes || "").trim() };
  }
  if (k.startsWith("q-")) return { goals: (d.goals || []).filter(g => g.title && g.title.trim() && !g.priv).map(g => ({ title: g.title.trim(), type: g.type || "achievement", due: g.due || "", progress: Number(g.progress) || 0 })) };
  return null;
}
// Dashboard copy: Big 3s (with status), the day's schedule and goal progress. Never private items.
function boardWrite(k, data) {
  const p = project(k, data); if (!p) return null;
  const cur = S.board[k]; const curP = cur ? (({ updated, ...r }) => r)(cur) : null;
  const empty = p.goals ? !p.goals.length : (!p.big3.length && !(p.sched || []).length && !(p.tasks || []).length && !p.notes);
  if (empty && !cur) return null;
  if (JSON.stringify(curP) === JSON.stringify(p)) return null;
  const body = { ...p, updated: new Date().toISOString() };
  S.board[k] = body;
  return setDoc(doc(db, "board", k), body);
}
function flush(k) {
  S.dirty.delete(k);
  const data = clone(S.cache[k]);
  const writes = [setDoc(doc(db, "p", S.key, "planner", k), data)];
  const w = boardWrite(k, data); if (w) writes.push(w);
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
function txt(k, path, val, ph, cls = "txt") {
  return `<textarea class="${cls}" rows="1" placeholder="${esc(ph)}" data-doc="${k}" data-path="${path}">${esc(val)}</textarea>`;
}
function grow(el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
function growAll() { main.querySelectorAll("textarea.txt, textarea.gt").forEach(grow); }
window.addEventListener("resize", () => growAll());
function statusBtn(k, path, it, label) {
  const s = stOf(it), m = STATUS.find(x => x[0] === s) || STATUS[0];
  return `<button class="st st-${s || "open"}" data-act="stmenu" data-doc="${k}" data-path="${path}" title="${m[1]}" aria-label="${esc(label)}: ${m[1]}. Change status">${m[2]}</button>`;
}
function taskCell(k, path, it, ph) {
  return `<div class="cell">${txt(k, path + ".t", it.t, ph)}${stOf(it) === "deleg" ? txt(k, path + ".who", it.who, "Delegated to…", "txt who") : ""}${it.from ? `<span class="from">Deferred from ${fmt(parseYmd(it.from), { weekday: "short", month: "short", day: "numeric" })}</span>` : ""}</div>`;
}
function bigRow(k, path, item, i) {
  return `<div class="line big st-row-${stOf(item) || "open"}">
    <span class="num">${i + 1}</span>
    ${statusBtn(k, `${path}.${i}`, item, `Big 3 item ${i + 1}`)}
    ${taskCell(k, `${path}.${i}`, item, i === 0 ? "Most important outcome" : "Big 3 item " + (i + 1))}
    <button class="lock ${item.priv ? "on" : ""}" data-act="toggle" data-doc="${k}" data-path="${path}.${i}.priv" title="${item.priv ? "Hidden from owners. Click to share." : "Visible to owners. Click to hide."}">${item.priv ? "Private" : "Shared"}</button>
  </div>`;
}
function listRows(k, path, arr, { check = false, ph = "Add an item" } = {}) {
  const rows = arr.map((it, i) => {
    return `<div class="line ${check ? "st-row-" + (stOf(it) || "open") : ""}">
      ${check ? statusBtn(k, `${path}.${i}`, it, "Task") + taskCell(k, `${path}.${i}`, it, ph) : `<div class="cell">${txt(k, `${path}.${i}`, it, ph)}</div>`}
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
        <div><h2>Other Tasks <span class="tag">Owners see these</span></h2>${listRows(k, "tasks", day.tasks || [], { check: true, ph: "Task" })}</div>
        <div><h2>Daily Rituals</h2><div class="chips">
          ${RITUAL_NAMES.map(([id, n]) => `<label class="chip"><input class="chk" type="checkbox" data-doc="${k}" data-path="rit.${id}" ${day.rit && day.rit[id] ? "checked" : ""}>${n}</label>`).join("")}
        </div></div>
        <div><h2>Notes <span class="tag">Owners see these</span></h2><textarea rows="6" placeholder="Ideas, calls, follow-ups…" data-doc="${k}" data-path="notes">${esc(day.notes)}</textarea></div>
      </div>
      <div class="stack sched"><div><h2>Schedule</h2>
        ${hours.map(h => `<div class="line"><span class="time">${hourLabel(h)}</span><div class="cell">${txt(k, `sched.${h}`, (day.sched || {})[h], "")}</div></div>`).join("")}
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
      ${txt(k, `goals.${i}.title`, g.title, "Goal, written as a finished result", "gt")}
      <div class="meta">
        <select aria-label="Goal type" data-doc="${k}" data-path="goals.${i}.type"><option value="achievement" ${g.type !== "habit" ? "selected" : ""}>Achievement</option><option value="habit" ${g.type === "habit" ? "selected" : ""}>Habit</option></select>
        <span>Due</span><input type="date" aria-label="Due date" value="${esc(g.due)}" data-doc="${k}" data-path="goals.${i}.due">
        <button class="lock ${g.priv ? "on" : ""}" data-act="toggle" data-doc="${k}" data-path="goals.${i}.priv">${g.priv ? "Private" : "Shared"}</button>
      </div>
      <div class="prog"><input type="range" min="0" max="100" step="5" value="${g.progress || 0}" aria-label="Progress" data-doc="${k}" data-path="goals.${i}.progress" data-pctid="${k}-${i}"><span class="pct" data-pct="${k}-${i}">${g.progress || 0}%</span></div>
      <div class="mini">Key motivations</div>
      ${[0, 1, 2].map(j => `<div class="line"><span class="time" style="width:14px">${j + 1}</span><div class="cell">${txt(k, `goals.${i}.why.${j}`, (g.why || [])[j], "Why this matters")}</div></div>`).join("")}
      <div class="mini">Next step</div>
      <div class="line"><div class="cell">${txt(k, `goals.${i}.next`, g.next, "The very next action")}</div></div>
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
  growAll();
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
  if (el.tagName === "TEXTAREA" && (el.classList.contains("txt") || el.classList.contains("gt"))) grow(el);
});

/* ---------- task status menu ---------- */
const menu = document.createElement("div");
menu.className = "stmenu"; menu.hidden = true; menu.setAttribute("role", "menu");
document.body.appendChild(menu);
let menuFor = null;
function closeMenu() { menu.hidden = true; menuFor = null; }
function openMenu(btn) {
  menuFor = { k: btn.dataset.doc, path: btn.dataset.path, btn };
  const cur = stOf(getPath(get(menuFor.k), menuFor.path));
  menu.innerHTML = STATUS.map(([id, label, sym]) => `<button role="menuitemradio" aria-checked="${id === cur}" data-s="${id}"><span class="st st-${id || "open"}">${sym}</span><span>${label}${id === "defer" && menuFor.k.startsWith("d-") ? "<small>Also copies it to the next day's tasks</small>" : ""}</span></button>`).join("");
  menu.hidden = false;
  const r = btn.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = r.left + window.scrollX, top = r.bottom + window.scrollY + 6;
  left = Math.max(8 + window.scrollX, Math.min(left, window.scrollX + document.documentElement.clientWidth - mw - 8));
  if (r.bottom + mh + 12 > window.innerHeight && r.top > mh + 12) top = r.top + window.scrollY - mh - 6;
  menu.style.left = left + "px"; menu.style.top = top + "px";
  menu.querySelector('[aria-checked="true"]')?.focus();
}
function setTaskStatus(k, path, st) {
  let item = null;
  edit(k, d => { item = getPath(d, path); if (!item) return; item.s = st; item.done = st === "done"; });
  // Deferred daily items are rewritten on the next day, like the paper planner's arrow.
  if (st === "defer" && item && k.startsWith("d-") && item.t && item.t.trim()) {
    const day = k.slice(2), next = K.day(addDays(parseYmd(day), 1));
    let added = false;
    edit(next, d => { d.tasks = d.tasks || []; if (!d.tasks.some(x => x.t === item.t)) { d.tasks.push({ t: item.t, s: "", done: false, from: day }); added = true; } });
    if (added) setTimeout(() => setStatus("Copied to " + fmt(addDays(parseYmd(day), 1), { weekday: "long" }) + "'s tasks"), 700);
  }
  render();
}
menu.addEventListener("click", e => {
  const b = e.target.closest("[data-s]"); if (!b || !menuFor) return;
  const { k, path } = menuFor; closeMenu(); setTaskStatus(k, path, b.dataset.s);
});
document.addEventListener("click", e => { if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('[data-act="stmenu"]')) closeMenu(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !menu.hidden) { const b = menuFor && menuFor.btn; closeMenu(); b && b.focus(); } });
window.addEventListener("resize", () => { if (!menu.hidden) closeMenu(); });
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
    case "stmenu": if (menuFor && menuFor.btn === b) closeMenu(); else openMenu(b); return;
    case "toggle": edit(k, d => setPath(d, b.dataset.path, !getPath(d, b.dataset.path))); break;
    case "add": {
      edit(k, d => { let arr = getPath(d, b.dataset.path); if (!Array.isArray(arr)) { arr = []; setPath(d, b.dataset.path, arr); } arr.push(b.dataset.check === "1" ? { t: "", done: false } : ""); });
      render();
      const last = [...main.querySelectorAll(`textarea.txt[data-doc="${k}"][data-path^="${b.dataset.path}."]`)].pop(); last && last.focus();
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

function backfill() {
  const ws = Object.keys(S.cache).filter(k => /^[dwq]-/.test(k) && !S.dirty.has(k)).map(k => boardWrite(k, S.cache[k])).filter(Boolean);
  if (ws.length) Promise.all(ws).catch(() => { });
}
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
    if (!S.loaded) { S.loaded = true; setTimeout(backfill, 2500); setStatus(snap.metadata.fromCache ? "Offline · showing saved copy" : "Synced"); }
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
