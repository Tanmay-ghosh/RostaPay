// Fix suggestions for roster problems — plain code, no AI.
// For every violation found by checkRoster, work out concrete changes that would fix it
// (extend a shift, add a shift for someone who is free, hand a shift to a colleague),
// and when nothing in the roster can fix it, say why and suggest changing the business rules instead.
import { toMinutes, fromMinutes, dayOfWeek, weekDates, DAY_NAMES, shiftDuration } from './time.js';

const FULL_DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const MIN_NEW_SHIFT = 240; // don't suggest shifts shorter than 4h unless the gap itself is that small and nothing fits

export function suggestFixes({ weekStart, staff, shifts, availability = [], unavailable = [], constraints = {}, violations }) {
  const dates = weekDates(weekStart);
  const nameOf = Object.fromEntries(staff.map((s) => [s.id, s.name]));
  const first = (id) => (nameOf[id] || 'Someone').split(' ')[0];
  const dl = (d) => `${DAY_NAMES[dayOfWeek(d)]} ${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;
  const maxH = constraints.max_hours_per_day != null ? Number(constraints.max_hours_per_day) * 60 : Infinity;
  const maxD = constraints.max_days_per_week != null ? Number(constraints.max_days_per_week) : Infinity;

  const span = (sh) => { const s = toMinutes(sh.start_time); return [s, s + shiftDuration(sh.start_time, sh.end_time)]; };
  const shiftsOf = (sid, exclude) => shifts.filter((x) => x.staff_id === sid && x.id !== exclude);

  // windows (minutes from the date's midnight) when a person can work on a date; null = no availability recorded (any time)
  function windows(sid, date) {
    if (unavailable.some((u) => u.staff_id === sid && u.date === date)) return [];
    const all = availability.filter((a) => a.staff_id === sid);
    if (!all.length) return null;
    return all.filter((a) => Number(a.weekday) === dayOfWeek(date)).map((a) => { const s = toMinutes(a.start_time); return [s, s + shiftDuration(a.start_time, a.end_time)]; });
  }
  const fits = (sid, date, s, e) => { const w = windows(sid, date); return w === null || w.some(([ws, we]) => s >= ws && e <= we); };
  function limitsOk(sid, date, s, e, excludeShift) {
    const mine = shiftsOf(sid, excludeShift);
    const sameDay = mine.filter((x) => x.date === date);
    if (sameDay.some((x) => { const [a, b] = span(x); return s < b && a < e; })) return false;
    if (sameDay.reduce((t, x) => t + shiftDuration(x.start_time, x.end_time), 0) + (e - s) > maxH) return false;
    const days = new Set(mine.map((x) => x.date)); days.add(date);
    return days.size <= maxD;
  }
  const roleOk = (sid, role) => !role || String(staff.find((x) => x.id === sid)?.role || '').toLowerCase() === String(role).toLowerCase();
  const t = (m) => fromMinutes(m);

  // Minutes a person may still work on a date (daily max minus what they already work that day, excluding one shift)
  const dayRoom = (sid, date, exclude) => maxH - shiftsOf(sid, exclude).filter((x) => x.date === date).reduce((t, x) => t + shiftDuration(x.start_time, x.end_time), 0);

  // Covers for PART of a coverage gap: extend a same-role shift into it, or add a shift for whoever is free for some of it.
  function partialFixes(v) {
    const { date, gap_start: gs, gap_end: ge } = v;
    const out = [];
    const MIN_PART = 60;
    const winsOf = (sid) => windows(sid, date) ?? [[0, 2880]];
    // extend an existing shift that ends inside / starts inside the gap
    for (const sh of shifts.filter((x) => x.date === date && roleOk(x.staff_id, v.role))) {
      const [s, e] = span(sh);
      const room = dayRoom(sh.staff_id, date, sh.id);
      const w = winsOf(sh.staff_id).find(([ws, we]) => ws <= s && e <= we);
      if (!w) continue;
      if (s <= gs && e >= gs && e < ge) { // ends at/inside the gap → push the end later
        const ne = Math.min(ge, w[1], s + room);
        if (ne - e >= MIN_PART && limitsOk(sh.staff_id, date, s, ne, sh.id)) out.push({ type: 'update_shift', shift_id: sh.id, staff_id: sh.staff_id, date, start_time: t(s), end_time: t(ne), covers: ne - e, cost_minutes: ne - e, label: `Extend ${first(sh.staff_id)}'s shift to ${t(s)}–${t(ne)} (+${(ne - e) / 60}h, covers part of the gap)` });
      } else if (e >= ge && s <= ge && s > gs) { // starts at/inside the gap → pull the start earlier
        const ns = Math.max(gs, w[0], e - room);
        if (s - ns >= MIN_PART && limitsOk(sh.staff_id, date, ns, e, sh.id)) out.push({ type: 'update_shift', shift_id: sh.id, staff_id: sh.staff_id, date, start_time: t(ns), end_time: t(e), covers: s - ns, cost_minutes: s - ns, label: `Start ${first(sh.staff_id)}'s shift earlier, ${t(ns)}–${t(e)} (+${(s - ns) / 60}h, covers part of the gap)` });
      }
    }
    // add a shift for someone of the right role who is free for part of the gap
    for (const p of staff) {
      if (!roleOk(p.id, v.role)) continue;
      const room = dayRoom(p.id, date);
      if (room < MIN_PART) continue;
      for (const [ws, we] of winsOf(p.id)) {
        let ns = Math.max(ws, gs), ne = Math.min(we, ge);
        if (ne - ns < MIN_PART) continue;
        if (ne - ns > room) ne = ns + room;
        // avoid colliding with the person's own shifts that day: trim to the first free stretch
        const own = shiftsOf(p.id).filter((x) => x.date === date).map(span).sort((a, b) => a[0] - b[0]);
        for (const [a, b] of own) { if (a < ne && ns < b) { if (a > ns) ne = a; else ns = b; } }
        if (ne - ns < MIN_PART || !limitsOk(p.id, date, ns, ne)) continue;
        out.push({ type: 'add_shift', staff_id: p.id, date, start_time: t(ns), end_time: t(ne), covers: ne - ns, cost_minutes: ne - ns, label: `Add ${first(p.id)} ${t(ns)}–${t(ne)} (covers part of the gap)` });
      }
    }
    return out;
  }

  function coverageFixes(v) {
    const fixes = [];
    const { date, gap_start: gs, gap_end: ge } = v;
    // 1) extend someone already working that day so their shift covers the gap
    for (const sh of shifts.filter((x) => x.date === date && roleOk(x.staff_id, v.role))) {
      const [s, e] = span(sh);
      if (s <= gs && e >= ge) continue; // already covering
      if (!(s <= ge && e >= gs)) continue; // only extend shifts that touch the gap
      const ns = Math.min(s, gs), ne = Math.max(e, ge);
      if (!fits(sh.staff_id, date, ns, ne) || !limitsOk(sh.staff_id, date, ns, ne, sh.id)) continue;
      fixes.push({ type: 'update_shift', shift_id: sh.id, staff_id: sh.staff_id, date, start_time: t(ns), end_time: t(ne), cost_minutes: ne - ns - (e - s),
        label: `Extend ${first(sh.staff_id)}'s shift to ${t(ns)}–${t(ne)} (+${(ne - ns - (e - s)) / 60}h)` });
    }
    // 2) add a shift for someone who is free and available
    for (const p of staff) {
      if (!roleOk(p.id, v.role) || shifts.some((x) => x.staff_id === p.id && x.date === date && (() => { const [a, b] = span(x); return a < ge && gs < b; })())) continue;
      if (!fits(p.id, date, gs, ge)) continue;
      let ns = gs, ne = ge;
      if (ne - ns < MIN_NEW_SHIFT) {
        if (fits(p.id, date, ns, ns + MIN_NEW_SHIFT) && ns + MIN_NEW_SHIFT <= v.req_end) ne = ns + MIN_NEW_SHIFT;
        else if (fits(p.id, date, ge - MIN_NEW_SHIFT, ge) && ge - MIN_NEW_SHIFT >= v.req_start) ns = ge - MIN_NEW_SHIFT;
      }
      if (!limitsOk(p.id, date, ns, ne)) continue;
      fixes.push({ type: 'add_shift', staff_id: p.id, date, start_time: t(ns), end_time: t(ne), cost_minutes: ne - ns, label: `Add ${first(p.id)} ${t(ns)}–${t(ne)}` });
    }
    fixes.sort((a, b) => a.cost_minutes - b.cost_minutes);
    let top = fixes.slice(0, 3);
    // 2b) nobody can cover the whole gap — offer the biggest partial covers (one person rarely spans a 15h day)
    let partial = false;
    if (!top.length) {
      top = partialFixes(v).sort((a, b) => b.covers - a.covers).slice(0, 3);
      partial = top.length > 0;
    }
    if (top.length) {
      const missing = v.need - v.have;
      const notes = [];
      if (partial) notes.push('No one person can cover the whole gap — apply one of these, then the rest of the gap is re-checked.');
      if (missing > 1) notes.push(`Needs ${missing} more people — apply one fix, the list updates.`);
      return { fixes: top, note: notes.join(' ') || null };
    }
    // 3) nobody can cover it inside the roster — explain and offer to change the requirement
    const days = FULL_DAYS[dayOfWeek(date)];
    const onShift = new Set(shifts.filter((x) => x.date === date && (() => { const [a, b] = span(x); return a < ge && gs < b; })()).map((x) => x.staff_id));
    const freeButCapped = staff.filter((p) => !onShift.has(p.id) && roleOk(p.id, v.role)).some((p) => { const w = windows(p.id, date); return w === null || w.some(([ws, we]) => ws < ge && gs < we); });
    const why = freeButCapped
      ? `The people available at ${t(gs)}–${t(ge)} are already at their daily or weekly limit.`
      : `${onShift.size ? 'Apart from who is already on shift, nobody' : 'Nobody'} is available ${t(gs)}–${t(ge)} on ${days}, so no roster can fill this.`;
    const out = [];
    if (ge >= v.req_end && gs > v.req_start) out.push({ type: 'coverage', coverage_id: v.coverage_id, end_time: t(gs), label: `Close at ${t(gs)} on ${days} (instead of ${t(v.req_end)})`, group: `Close at ${t(gs)} instead of ${t(v.req_end)}` });
    else if (gs <= v.req_start && ge < v.req_end) out.push({ type: 'coverage', coverage_id: v.coverage_id, start_time: t(ge), label: `On ${days}, start the ${v.need}-person minimum at ${t(ge)} instead of ${t(v.req_start)}`, group: `Start the ${v.need}-person minimum at ${t(ge)}` });
    else if (v.have > 0) out.push({ type: 'coverage', coverage_id: v.coverage_id, min_staff: v.have, label: `Lower the minimum on ${days} ${t(v.req_start)}–${t(v.req_end)} to ${v.have}`, group: `Lower minimum to ${v.have}` });
    return { fixes: out, infeasible: true, why, note: freeButCapped ? 'Or raise the max days/hours limit in Settings.' : 'Other options: ask someone to widen their availability, or hire for this slot.' };
  }

  function reassignFixes(sh, reason) {
    const [s, e] = span(sh);
    const out = [];
    // Only hand a shift to someone who can do that job: the role the shift is labelled with,
    // or else the original person's role.
    const needRole = sh.role || staff.find((x) => x.id === sh.staff_id)?.role || null;
    for (const p of staff) {
      if (p.id === sh.staff_id) continue;
      if (!roleOk(p.id, needRole)) continue;
      if (!fits(p.id, sh.date, s, e) || !limitsOk(p.id, sh.date, s, e)) continue;
      out.push({ type: 'update_shift', shift_id: sh.id, staff_id: p.id, date: sh.date, start_time: sh.start_time, end_time: sh.end_time, label: `Give this shift to ${first(p.id)}` });
    }
    // trim to the person's own availability if they are partly available
    const w = windows(sh.staff_id, sh.date);
    if (reason === 'role') {
      const ownRole = staff.find((x) => x.id === sh.staff_id)?.role;
      if (ownRole) out.push({ type: 'update_role', shift_id: sh.id, staff_id: sh.staff_id, role: ownRole, label: `Keep ${first(sh.staff_id)} on it as ${ownRole}` });
    }
    if (reason === 'availability' && w) {
      for (const [ws, we] of w) {
        const ns = Math.max(s, ws), ne = Math.min(e, we);
        if (ne - ns >= 120) out.push({ type: 'update_shift', shift_id: sh.id, staff_id: sh.staff_id, date: sh.date, start_time: t(ns), end_time: t(ne), label: `Shorten ${first(sh.staff_id)}'s shift to ${t(ns)}–${t(ne)}` });
      }
    }
    out.push({ type: 'delete_shift', shift_id: sh.id, label: `Remove this shift` });
    return out.slice(0, 4);
  }

  return violations.map((v) => {
    try {
      if (v.type === 'coverage') return { ...v, ...coverageFixes(v) };
      if (v.type === 'availability' || v.type === 'unavailable' || v.type === 'overlap' || v.type === 'rest' || v.type === 'role') {
        const sh = shifts.find((x) => x.id === v.shift_id);
        return sh ? { ...v, fixes: reassignFixes(sh, v.type) } : v;
      }
      if (v.type === 'max_days') {
        const mine = shifts.filter((x) => x.staff_id === v.staff_id);
        for (const sh of mine) {
          const f = reassignFixes(sh, 'max_days').filter((x) => x.type === 'update_shift' && x.staff_id !== v.staff_id);
          if (f.length) return { ...v, fixes: f.slice(0, 2).map((x) => ({ ...x, label: `${dl(sh.date)}: ${x.label.replace('this shift', `${first(v.staff_id)}'s shift`)}` })) };
        }
        return { ...v, fixes: [], why: 'Nobody else is free to take one of these days.' };
      }
      if (v.type === 'max_hours') {
        const day = shifts.filter((x) => x.staff_id === v.staff_id && x.date === v.date);
        const sh = day.sort((a, b) => shiftDuration(b.start_time, b.end_time) - shiftDuration(a.start_time, a.end_time))[0];
        if (!sh) return v;
        const over = day.reduce((tt, x) => tt + shiftDuration(x.start_time, x.end_time), 0) - maxH;
        const [s, e] = span(sh);
        const fixes = [{ type: 'update_shift', shift_id: sh.id, staff_id: sh.staff_id, date: sh.date, start_time: sh.start_time, end_time: t(e - over), label: `Shorten to ${sh.start_time}–${t(e - over)}` }, ...reassignFixes(sh, 'max_hours').filter((x) => x.type === 'update_shift')];
        return { ...v, fixes: fixes.slice(0, 3) };
      }
    } catch { /* suggestions are best-effort */ }
    return v;
  });
}
