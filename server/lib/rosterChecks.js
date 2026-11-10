// Roster checks — plain code that verifies a roster (whoever drafted it, Claude or the owner).
import { toMinutes, fromMinutes, dayOfWeek, weekDates, DAY_NAMES, shiftDuration } from './time.js';

/**
 * weekStart: Monday "YYYY-MM-DD"
 * staff: [{id,name,role}]
 * shifts: [{id,staff_id,date,start_time,end_time,role}]
 * availability: [{staff_id,weekday,start_time,end_time}]
 * unavailable: [{staff_id,date,reason}]
 * coverage: [{weekday,start_time,end_time,min_staff,role}]
 * constraints: {max_days_per_week,max_hours_per_day,min_rest_hours}
 */
export function checkRoster({ weekStart, staff, shifts, availability = [], unavailable = [], coverage = [], constraints = {} }) {
  const dates = weekDates(weekStart);
  const nameOf = Object.fromEntries(staff.map((s) => [s.id, s.name]));
  const v = [];
  const abs = (sh) => {
    const idx = dates.indexOf(sh.date);
    const s = idx * 1440 + toMinutes(sh.start_time);
    return { s, e: s + shiftDuration(sh.start_time, sh.end_time) };
  };
  const inWeek = shifts.filter((sh) => dates.includes(sh.date));
  const roleOf = Object.fromEntries(staff.map((s) => [s.id, s.role]));
  const norm = (r) => String(r || '').trim().toLowerCase();
  // The role a shift actually fills: the person's own role. A shift labelled with a different role does not count
  // toward that role's coverage (it is flagged below); people with no role recorded fall back to the shift's label.
  const filledRole = (sh) => norm(roleOf[sh.staff_id] || sh.role);
  const label = (d) => `${DAY_NAMES[dayOfWeek(d)]} ${d.slice(8)}/${d.slice(5, 7)}`;

  // 1. Coverage
  dates.forEach((date, idx) => {
    for (const req of coverage.filter((c) => Number(c.weekday) === dayOfWeek(date))) {
      const rs = toMinutes(req.start_time);
      const len = shiftDuration(req.start_time, req.end_time);
      let gapStart = null, gapMin = Infinity;
      const flush = (endMin) => {
        if (gapStart == null) return;
        v.push({ type: 'coverage', date, coverage_id: req.id, weekday: Number(req.weekday), gap_start: gapStart, gap_end: endMin, have: gapMin, need: Number(req.min_staff), role: req.role || null, req_start: rs, req_end: rs + len, message: `${label(date)} ${fromMinutes(gapStart)}–${fromMinutes(endMin)}: only ${gapMin} on shift${req.role ? ` (${req.role})` : ''}, needs ${req.min_staff}` });
        gapStart = null; gapMin = Infinity;
      };
      for (let t = 0; t < len; t += 15) {
        const slot = idx * 1440 + rs + t;
        const count = inWeek.filter((sh) => {
          if (req.role && filledRole(sh) !== norm(req.role)) return false;
          const a = abs(sh);
          return a.s <= slot && slot < a.e;
        }).length;
        if (count < Number(req.min_staff)) {
          if (gapStart == null) gapStart = rs + t;
          gapMin = Math.min(gapMin, count);
        } else flush(rs + t);
      }
      flush(rs + len);
    }
  });

  // 2. Availability and unavailable dates
  for (const sh of inWeek) {
    const who = nameOf[sh.staff_id] || 'Someone';
    const off = unavailable.find((u) => u.staff_id === sh.staff_id && u.date === sh.date);
    if (off) v.push({ type: 'unavailable', staff_id: sh.staff_id, shift_id: sh.id, date: sh.date, message: `${who} is unavailable on ${label(sh.date)}${off.reason ? ` (${off.reason})` : ''} but is rostered` });
    const windows = availability.filter((a) => a.staff_id === sh.staff_id);
    if (windows.length === 0) continue; // no availability recorded = available any time
    const dow = dayOfWeek(sh.date);
    const ss = toMinutes(sh.start_time), sd = shiftDuration(sh.start_time, sh.end_time);
    const fits = windows.filter((w) => Number(w.weekday) === dow).some((w) => {
      const ws = toMinutes(w.start_time), wd = shiftDuration(w.start_time, w.end_time);
      return ss >= ws && ss + sd <= ws + wd;
    });
    if (!fits) v.push({ type: 'availability', staff_id: sh.staff_id, shift_id: sh.id, date: sh.date, message: `${who}'s ${label(sh.date)} shift ${sh.start_time}–${sh.end_time} is outside their availability` });
  }

  // 2b. Role: a shift labelled with a role the person doesn't hold
  for (const sh of inWeek) {
    const own = norm(roleOf[sh.staff_id]);
    if (sh.role && own && norm(sh.role) !== own) {
      const who = nameOf[sh.staff_id] || 'Someone';
      v.push({ type: 'role', staff_id: sh.staff_id, shift_id: sh.id, date: sh.date, role: sh.role, message: `${who} is a ${roleOf[sh.staff_id]} but is rostered as ${sh.role} on ${label(sh.date)} — this shift does not count toward ${sh.role} coverage` });
    }
  }

  // 3. Per-person limits
  for (const person of staff) {
    const mine = inWeek.filter((sh) => sh.staff_id === person.id).sort((a, b) => abs(a).s - abs(b).s);
    if (!mine.length) continue;
    const days = new Set(mine.map((sh) => sh.date));
    if (constraints.max_days_per_week != null && days.size > Number(constraints.max_days_per_week)) {
      v.push({ type: 'max_days', staff_id: person.id, message: `${person.name} is rostered ${days.size} days (max ${constraints.max_days_per_week})` });
    }
    if (constraints.max_hours_per_day != null) {
      for (const d of days) {
        // Count clock time actually covered (overlapping shifts are flagged separately, not double-counted)
        const spans = mine.filter((sh) => sh.date === d).map(abs).sort((a, b) => a.s - b.s);
        let mins = 0, curS = null, curE = null;
        for (const { s: a, e: b } of spans) {
          if (curE == null || a > curE) { if (curE != null) mins += curE - curS; curS = a; curE = b; } else curE = Math.max(curE, b);
        }
        if (curE != null) mins += curE - curS;
        if (mins > Number(constraints.max_hours_per_day) * 60) v.push({ type: 'max_hours', staff_id: person.id, date: d, message: `${person.name} has ${mins / 60}h on ${label(d)} (max ${constraints.max_hours_per_day}h)` });
      }
    }
    for (let i = 1; i < mine.length; i++) {
      const a = abs(mine[i - 1]), b = abs(mine[i]);
      if (b.s < a.e) v.push({ type: 'overlap', staff_id: person.id, shift_id: mine[i].id, date: mine[i].date, message: `${person.name} has overlapping shifts on ${label(mine[i].date)}` });
      else if (constraints.min_rest_hours != null && b.s - a.e < Number(constraints.min_rest_hours) * 60) {
        v.push({ type: 'rest', staff_id: person.id, shift_id: mine[i].id, date: mine[i].date, message: `${person.name} gets only ${((b.s - a.e) / 60).toFixed(1)}h rest before ${label(mine[i].date)} (min ${constraints.min_rest_hours}h)` });
      }
    }
  }
  return v;
}
