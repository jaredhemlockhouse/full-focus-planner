/* Shared helpers and the owner dashboard view (used by index.html and the planner's Owner view tab). */

export const pad = n => String(n).padStart(2, "0");
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
export const weekStart = d => addDays(d, -((d.getDay() + 6) % 7));
export const qOf = d => Math.floor(d.getMonth() / 3) + 1;
export const K = { day: d => "d-" + ymd(d), week: d => "w-" + ymd(weekStart(d)), q: d => `q-${d.getFullYear()}-Q${qOf(d)}` };
export const fmt = (d, o) => d.toLocaleDateString("en-US", o);
export const sameDay = (a, b) => ymd(a) === ymd(b);
export const weekLabel = d => {
  const s = weekStart(d), e = addDays(s, 6);
  return `${fmt(s, { month: "short", day: "numeric" })} – ${fmt(e, { month: s.getMonth() === e.getMonth() ? undefined : "short", day: "numeric" })}`;
};
export const qLabel = d => {
  const q = qOf(d), s = new Date(d.getFullYear(), (q - 1) * 3, 1), e = new Date(d.getFullYear(), q * 3, 0);
  return { name: `Q${q} ${d.getFullYear()}`, range: `${fmt(s, { month: "short", day: "numeric" })} – ${fmt(e, { month: "short", day: "numeric" })}`, start: s, end: e };
};
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function glanceDays(src, sel, act, highlight) {
  const s = weekStart(sel), now = new Date();
  return `<div class="glance">${[0, 1, 2, 3, 4, 5, 6].map(i => {
    const d = addDays(s, i), b = ((src(K.day(d)) || {}).big3 || []).filter(x => x.t && x.t.trim());
    const done = b.filter(x => x.done).length;
    const pips = [0, 1, 2].map(j => `<span class="pip ${j < done ? "ok" : j < b.length ? "set" : ""}"></span>`).join("");
    return `<button class="gday ${sameDay(d, now) ? "today" : ""} ${highlight && sameDay(d, sel) ? "sel" : ""}" data-act="${act}" data-d="${ymd(d)}">
      <span class="dn">${DAYS[i]}</span><span class="dd">${d.getDate()}</span><span class="pips">${pips}</span>
      <span class="c">${b.length ? `${done}/${b.length} done` : "—"}</span></button>`;
  }).join("")}</div>`;
}

export function viewDashboard(board, d, { ownerName = "Jared", preview = false } = {}) {
  const bk = k => board[k] || {};
  const day = bk(K.day(d)), wk = bk(K.week(d)), q = bk(K.q(d)), ql = qLabel(d);
  const items = (arr, empty) => (arr && arr.length)
    ? arr.map((x, i) => `<div class="item"><span class="n">${i + 1}</span><span class="t">${esc(x.t)}</span><span class="pill ${x.done ? "done" : ""}">${x.done ? "Done" : "Open"}</span></div>`).join("")
    : `<p class="muted">${empty}</p>`;
  const ups = [day.updated, wk.updated, q.updated].filter(Boolean).sort();
  const last = ups.length ? new Date(ups[ups.length - 1]) : null;
  return `${preview ? `<div class="note"><b>This is the owner view.</b> Owners open the site's main link and see only this page, with no sign-in: Daily Big 3, Weekly Big 3 and quarterly goal progress. It updates live as you plan. Tasks, schedule, notes, rituals and anything marked Private never leave your planner.</div>` : ""}
  <section class="sheet">
    <div class="pagehead">
      <div><div class="eyebrow">What ${esc(ownerName)} is focused on</div><h1>${fmt(d, { weekday: "long" })}, <em>${fmt(d, { month: "long", day: "numeric" })}</em></h1></div>
      <div class="nav">
        <button class="btn icon" data-act="dshift" data-n="-1" aria-label="Previous day">‹</button>
        <button class="btn" data-act="dtoday">Today</button>
        <button class="btn icon" data-act="dshift" data-n="1" aria-label="Next day">›</button>
        <input type="date" aria-label="Pick a day" data-act="djump" value="${ymd(d)}">
      </div>
    </div>
    <div class="dash">
      <div class="card"><h3>Big 3 for the day <span>${fmt(d, { month: "short", day: "numeric" })}</span></h3>${items(day.big3, "No Big 3 shared for this day.")}</div>
      <div class="card"><h3>Big 3 for the week <span>${weekLabel(d)}</span></h3>${items(wk.big3, "No weekly Big 3 shared for this week.")}</div>
      <div class="card wide"><h3>Week at a glance <span>Daily Big 3 completed</span></h3>${glanceDays(bk, d, "dashday", true)}</div>
      <div class="card wide"><h3>Quarterly goals <span>${ql.name} · ${ql.range}</span></h3>
        ${(q.goals && q.goals.length) ? q.goals.map(g => `<div class="gl"><div class="r"><b>${esc(g.title)}</b><span>${g.progress || 0}%</span></div><div class="bar"><i style="width:${Math.max(0, Math.min(100, g.progress || 0))}%"></i></div><small>${g.type === "habit" ? "Habit" : "Achievement"}${g.due ? ` · due ${fmt(parseYmd(g.due), { month: "short", day: "numeric" })}` : ""}</small></div>`).join("") : `<p class="muted">No quarterly goals shared for ${ql.name}.</p>`}
      </div>
    </div>
    <div class="updated">${last ? `Last updated ${last.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Nothing shared for this period yet."}</div>
  </section>`;
}

/* Handles the dashboard's date controls. Returns the new date, or null if the event wasn't a dashboard control. */
export function dashNav(e, current) {
  const b = e.target.closest("[data-act]"); if (!b) return null;
  const a = b.dataset.act;
  if (e.type === "change" && a === "djump" && b.value) return parseYmd(b.value);
  if (e.type !== "click" || b.tagName === "INPUT") return null;
  if (a === "dshift") return addDays(current, Number(b.dataset.n));
  if (a === "dtoday") return new Date();
  if (a === "dashday") return parseYmd(b.dataset.d);
  return null;
}
