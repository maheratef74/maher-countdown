"use strict";
/* =====================  CONFIG (edit here)  =====================
 * serviceStartDate drives progress/percentage only (service began 01/06/2026).
 * Cycle logic: a cycle is (serviceDays + leaveDays) = 21 days, starting on the return date.
 *   Day 1..13  = service      (06/11 → 18/11)
 *   Day 14     = departure    (19/11, first leave day — Thursday)
 *   Day 14..21 = 8 leave days (19/11 → 26/11)
 *   Day 22     = return = day 1 of next cycle (27/11)
 * 21 is a multiple of 7, so the weekday never drifts: departures are always Thursday
 * when the first one is. Nothing is generated after dischargeDate (last cycle may be partial).
 * Dates are handled as whole UTC "day numbers" so timezone/DST can never shift a day. */
const CONFIG = {
  serviceStartDate: "2026-06-01",   // progress bar / percentage start
  returnToServiceDate: "2026-11-06", // current leave ends here — cycle anchor
  dischargeDate: "2027-06-01",
  serviceDays: 13,
  leaveDays: 8,
  preferredLeaveWeekday: 4,      // 0=Sun … 4=Thu
  enforcePreferredDeparture: true // only warns in console if the rule is not met (never shifts dates)
};

/* ---------- Date helpers ---------- */
const DAY = 864e5, $ = id => document.getElementById(id);
const toIdx = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d) / DAY; };
const toDate = i => new Date(i * DAY);
const todayIdx = () => { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY; };
const p2 = n => String(n).padStart(2, "0");
const fmt = i => { const d = toDate(i); return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };
const WD = ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
const MO = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const wd = i => toDate(i).getUTCDay();
const longFmt = i => { const d = toDate(i); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const store = { get: (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } },
                set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

const P = toIdx(CONFIG.serviceStartDate), A = toIdx(CONFIG.returnToServiceDate), D = toIdx(CONFIG.dischargeDate);
const SD = CONFIG.serviceDays, LD = CONFIG.leaveDays, L = SD + LD;

/* ---------- Core logic ---------- */
function generateCycles() {
  const out = [];
  for (let i = 0, s = A; s <= D; i++, s = A + L * i) {
    const ls = s + SD, le = s + L - 1, ret = s + L;
    out.push({
      n: i + 1, serviceStart: s, serviceEnd: Math.min(s + SD - 1, D),
      leaveStart: ls <= D ? ls : null, leaveEnd: ls <= D ? Math.min(le, D) : null,
      returnDate: ret <= D ? ret : null, partial: le > D
    });
  }
  return out;
}
const cycles = generateCycles();
// Sanity check: warn (never silently shift) if the departure day is not the preferred weekday.
if (CONFIG.enforcePreferredDeparture && wd(A + SD) !== CONFIG.preferredLeaveWeekday)
  console.warn("[Dashboard] Departure day is not", WD[CONFIG.preferredLeaveWeekday], "→", longFmt(A + SD), "(13+8 cycle kept as-is)");

/** What is happening on a given day? */
function dayInfo(i) {
  if (i < A || i > D) return { type: "out" };
  const off = i - A, c = Math.floor(off / L), r = off % L, cyc = c + 1;
  if (i === D) return { type: "discharge", cycle: cyc };
  if (r < SD) return { type: "service", cycle: cyc, n: r + 1 };
  return { type: r === SD ? "depart" : "leave", cycle: cyc, n: r - SD + 1 };
}
const countDays = (from, type) => { let n = 0; for (let i = from; i <= D; i++) { const t = dayInfo(i).type; if (t === type || (type === "leave" && t === "depart")) n++; } return n; };

function getCurrentStatus(t) {
  if (t >= D) return { type: "finished" };
  if (t < A) return { type: "leave", pre: true, left: A - t, ret: A };
  const inf = dayInfo(t), c = cycles[inf.cycle - 1];
  if (inf.type === "service")
    return { type: "service", passed: inf.n, left: c.leaveStart - t, next: c.leaveStart, cycle: inf.cycle };
  const ret = c.returnDate;
  return { type: "leave", left: (ret ?? D) - t, ret: ret ?? D, toDischarge: ret == null, cycle: inf.cycle };
}
const getNextLeave = t => cycles.find(c => c.leaveStart !== null && c.leaveStart >= t);
function calculateRemainingLeaves(t) {
  const total = cycles.filter(c => c.leaveStart !== null).length;
  const done = cycles.filter(c => c.leaveEnd !== null && c.leaveEnd < t).length;
  return { total, done, remaining: total - done };
}
function calculateDischargeCountdown() {
  const target = new Date(...CONFIG.dischargeDate.split("-").map((v, i) => i === 1 ? v - 1 : +v)); // local midnight
  const ms = target - Date.now();
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  return { d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 };
}

/* ---------- Render ---------- */
function updateCountdown() {
  const c = calculateDischargeCountdown();
  $("countdown").hidden = !c; $("done").hidden = !!c;
  if (!c) return;
  $("cdD").textContent = c.d; $("cdH").textContent = p2(c.h); $("cdM").textContent = p2(c.m); $("cdS").textContent = p2(c.s);
}
const box = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;

function renderProgress(t) {
  const total = D - P, done = Math.min(Math.max(t - P, 0), total), left = Math.max(D - t, 0);
  const pct = Math.round(done / total * 100);
  $("barFill").style.width = pct + "%";
  $("progressInfo").innerHTML = box(pct + "%", "نسبة الإنجاز") + box(left + " يوم", "متبقي على نهاية الخدمة") +
    box(Math.floor(left / 7) + " أسبوع", "أسابيع متبقية") + box("≈ " + (left / 30.44).toFixed(1) + " شهر", "أشهر تقريبًا");
}
function renderStatus(t) {
  const s = getCurrentStatus(t); let h;
  if (s.type === "finished") h = `<div class="big">تمت المهمة 🇪🇬</div>`;
  else if (s.type === "service") h = `<h3>الحالة الحالية</h3><div class="big">في الوحدة 🪖</div><p>أنت حاليًا في الوحدة — اليوم ${s.passed} من ${SD} (الدورة ${s.cycle})</p>
    <p>متبقي <b>${s.left}</b> أيام على الإجازة القادمة (${longFmt(s.next)})</p>`;
  else h = `<h3>الحالة الحالية</h3><div class="big">إجازة 🏠</div><p>أنت حاليًا في الإجازة — متبقي <b>${s.left}</b> أيام على ${s.toDischarge ? "إنهاء الخدمة" : "العودة"}</p>
    <p>${s.toDischarge ? "تاريخ الإنهاء" : "تاريخ العودة للوحدة"}: ${longFmt(s.ret)}</p>`;
  $("status").innerHTML = h;
}
function renderNext(t) {
  const c = getNextLeave(t);
  if (!c) { $("next").innerHTML = `<h3>الإجازة القادمة</h3><p>لا توجد إجازات قادمة</p>`; return; }
  const thu = wd(c.leaveStart) === CONFIG.preferredLeaveWeekday, len = c.leaveEnd - c.leaveStart + 1;
  $("next").innerHTML = `<h3>الإجازة القادمة</h3>
    <div class="big">${fmt(c.leaveStart)} <span class="${thu ? "thu" : ""}">${WD[wd(c.leaveStart)]}${thu ? " ⭐" : ""}</span></div>
    <p>باقي <b>${c.leaveStart - t}</b> يوم — مدة الإجازة: ${len} أيام</p>
    <p>${c.returnDate ? "العودة المتوقعة: " + fmt(c.returnDate) : "تنتهي الخدمة أثناء الإجازة: " + fmt(D)}</p>`;
}
function renderRemaining(t) {
  const r = calculateRemainingLeaves(t);
  $("remaining").innerHTML = `<h3>الإجازات المتبقية</h3><div class="bigNum">${r.remaining} إجازات</div>
    <div class="grid3">${box(r.done, "إجازات انتهت")}${box(r.remaining, "إجازات متبقية")}${box(r.total, "إجمالي الإجازات")}</div>`;
}
function renderUpcoming(t) {
  const nl = getNextLeave(t), ev = [];
  const after = nl && cycles.find(c => c.leaveStart !== null && c.leaveStart > nl.leaveStart);
  const lastLeave = [...cycles].reverse().find(c => c.leaveStart !== null);
  const nr = cycles.find(c => c.returnDate !== null && c.returnDate >= t);
  if (nl) ev.push(["الإجازة القادمة", nl.leaveStart]);
  if (nr) ev.push(["العودة القادمة", nr.returnDate]);
  if (after) ev.push(["الإجازة التي بعدها", after.leaveStart]);
  if (lastLeave && lastLeave.leaveStart >= t) ev.push(["آخر إجازة قبل إنهاء الخدمة", lastLeave.leaveStart]);
  ev.push(["تاريخ إنهاء الخدمة", D]);
  ev.sort((a, b) => a[1] - b[1]);
  $("upcoming").innerHTML = ev.map(([l, d]) => `<li><span>${l}<br><small>${longFmt(d)}</small></span><b>${Math.max(d - t, 0)} يوم</b></li>`).join("");
}
function renderStats(t) {
  const r = calculateRemainingLeaves(t), from = Math.max(t, A), s = getCurrentStatus(t);
  $("stats").innerHTML = box(Math.max(D - t, 0), "الأيام المتبقية لنهاية الخدمة") + box(countDays(from, "service"), "أيام الخدمة المتبقية بالوحدة") +
    box(countDays(from, "leave"), "أيام الإجازات المتبقية") + box(r.remaining, "الإجازات المتبقية") + box(r.done, "الإجازات التي انتهت") +
    box(s.cycle ?? (t < A ? "—" : cycles.length), "الدورة الحالية") + box(cycles.length, "إجمالي الدورات");
}
function renderTimeline(t) {
  const cur = getCurrentStatus(t).cycle;
  $("timeline").innerHTML = cycles.map(c => {
    const cls = cur === c.n ? "cur" : (c.leaveEnd ?? c.serviceEnd) < t ? "past" : "";
    return `<li class="${cls}"><h4>الدورة ${p2(c.n)}${c.partial ? " (جزئية)" : ""}</h4><div class="det">
      <p>🪖 فترة الخدمة<br>من ${fmt(c.serviceStart)} إلى ${fmt(c.serviceEnd)}</p>
      ${c.leaveStart !== null ? `<p>🏠 فترة الإجازة<br>من ${fmt(c.leaveStart)} (${WD[wd(c.leaveStart)]}) إلى ${fmt(c.leaveEnd)}</p>` : ""}
      <p>${c.returnDate ? "↩ العودة: " + fmt(c.returnDate) : "🎖️ إنهاء الخدمة: " + fmt(D)}</p></div></li>`;
  }).join("");
  $("timeline").classList.toggle("collapsed", !store.get("tlOpen", true));
}

/* Calendar (week starts Saturday) */
const first = toDate(A), last = toDate(D);
const minM = first.getUTCFullYear() * 12 + first.getUTCMonth(), maxM = last.getUTCFullYear() * 12 + last.getUTCMonth();
let calM = Math.min(Math.max(store.get("calMonth", minM), minM), maxM), selDay = null;
const ICON = { service: "🪖", leave: "🏠", depart: "⭐", discharge: "🎖️" };
function renderCalendar() {
  const y = Math.floor(calM / 12), m = calM % 12, t = todayIdx();
  const start = Date.UTC(y, m, 1) / DAY, days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  $("calTitle").textContent = `${MO[m]} ${y}`;
  let h = ["سبت","أحد","اثنين","ثلاثاء","أربعاء","خميس","جمعة"].map(x => `<div class="h">${x}</div>`).join("");
  h += "<div></div>".repeat((wd(start) + 1) % 7);
  for (let d = 0; d < days; d++) {
    const i = start + d, inf = dayInfo(i);
    h += `<div class="d ${inf.type} ${i === t ? "today" : ""} ${i === selDay ? "sel" : ""}" data-i="${i}">${d + 1}</div>`;
  }
  $("calendar").innerHTML = h;
  $("prevM").disabled = calM <= minM; $("nextM").disabled = calM >= maxM;
}
function showDetail(i) {
  selDay = i; const inf = dayInfo(i); let t;
  if (inf.type === "service") t = `يوم خدمة — اليوم ${inf.n} من ${SD}`;
  else if (inf.type === "depart") t = `نزول إجازة — الدورة رقم ${inf.cycle}`;
  else if (inf.type === "leave") t = `يوم إجازة — اليوم ${inf.n} من ${LD} (الدورة ${inf.cycle})`;
  else if (inf.type === "discharge") t = "🎖️ يوم إنهاء الخدمة";
  else t = i < A ? "قبل العودة للوحدة" : "بعد انتهاء الخدمة";
  $("detail").innerHTML = `<b>${longFmt(i)}</b><br>${ICON[inf.type] || ""} ${t}`;
  renderCalendar();
}

/* Motivation */
const QUOTES = ["كل يوم بيعدّي.. بيقربك خطوة من النهاية.", "الصبر مفتاح الفرج.", "رجولة وانضباط.. وبكرة تفتخر بنفسك.", "قربنا.. كمّل وانت قدها 💪", "الوطن أمانة، والنهاية قربت."];
let qi = 0;
const rotateQuote = () => { $("quote").textContent = QUOTES[qi++ % QUOTES.length]; };

/* ---------- Init ---------- */
function renderAll() {
  const t = todayIdx();
  renderProgress(t); renderStatus(t); renderNext(t); renderRemaining(t);
  renderUpcoming(t); renderStats(t); renderTimeline(t); renderCalendar();
}
$("startLabel").textContent = fmt(P).replace(/\//g, " / ");
$("dischargeLabel").textContent = fmt(D).replace(/\//g, " / ");
$("calendar").addEventListener("click", e => { const d = e.target.closest(".d"); if (d) showDetail(+d.dataset.i); });
const nav = k => { calM = Math.min(Math.max(calM + k, minM), maxM); store.set("calMonth", calM); renderCalendar(); };
$("prevM").onclick = () => nav(-1); $("nextM").onclick = () => nav(1);
$("btnToggle").onclick = () => { store.set("tlOpen", !store.get("tlOpen", true)); renderTimeline(todayIdx()); };
$("btnToday").onclick = () => {
  const t = todayIdx(), d = toDate(Math.min(Math.max(t, A), D));
  calM = d.getUTCFullYear() * 12 + d.getUTCMonth(); showDetail(Math.min(Math.max(t, A), D));
  (document.querySelector(".timeline .cur") || $("status")).scrollIntoView({ behavior: "smooth", block: "center" });
};
$("btnShare").onclick = async () => {
  const text = `فاضلي ${Math.max(D - todayIdx(), 0)} يوم على نهاية الخدمة 💪`;
  try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); alert("تم نسخ الرسالة ✔"); } } catch {}
};
// Photo fallback: hide a broken image so the military avatar shows instead
const img = document.querySelector(".photo img");
img.addEventListener("error", () => img.remove());

renderAll(); updateCountdown(); rotateQuote();
setInterval(updateCountdown, 1000);
setInterval(renderAll, 60000);
setInterval(rotateQuote, 9000);
