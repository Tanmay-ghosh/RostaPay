// Business logic shared by the web API and the MCP endpoint.
import bcrypt from 'bcryptjs';
import { q, one, tx } from './db.js';
import { computePay, describeRule } from './lib/payEngine.js';
import { checkRoster } from './lib/rosterChecks.js';
import { suggestFixes } from './lib/rosterFixes.js';
import { weekStart as mondayOf, weekDates, todayIST, isDate, toMinutes } from './lib/time.js';
import { validateRuleShape } from './schemas.js';

export const currentWeek = () => mondayOf(todayIST());
export const normWeek = (w) => (w && isDate(w) ? mondayOf(w) : currentWeek());

export async function getBusiness(bid) {
  return one('SELECT id, name, timezone, mcp_key, max_days_per_week, max_hours_per_day, min_rest_hours FROM businesses WHERE id=$1', [bid]);
}

export async function getStaffFull(bid, { includeInactive = false } = {}) {
  const staff = await q(`SELECT id, name, phone, role, active, pin_hash IS NOT NULL AS has_pin FROM staff WHERE business_id=$1 ${includeInactive ? '' : 'AND active'} ORDER BY created_at, name`, [bid]);
  const ids = staff.map((s) => s.id);
  const avail = ids.length ? await q('SELECT staff_id, weekday, start_time, end_time FROM availability WHERE staff_id = ANY($1) ORDER BY weekday, start_time', [ids]) : [];
  const off = ids.length ? await q('SELECT id, staff_id, date, reason FROM unavailable_dates WHERE staff_id = ANY($1) ORDER BY date', [ids]) : [];
  return staff.map((s) => ({ ...s, availability: avail.filter((a) => a.staff_id === s.id), unavailable_dates: off.filter((o) => o.staff_id === s.id) }));
}

export async function getCoverage(bid) {
  return q('SELECT id, weekday, start_time, end_time, min_staff, role FROM coverage_requirements WHERE business_id=$1 ORDER BY (weekday+6)%7, start_time', [bid]);
}

export async function getRules(bid) {
  const rows = await q(`SELECT id, name, source_text, priority, kind, conditions, effect, enabled FROM pay_rules WHERE business_id=$1
    ORDER BY CASE kind WHEN 'rate' THEN 0 WHEN 'addon' THEN 1 WHEN 'override' THEN 2 ELSE 3 END, priority, created_at`, [bid]);
  return rows.map((r) => ({ ...r, summary: describeRule(r) }));
}

export async function getWeek(bid, week, { publishedOnly = false } = {}) {
  const start = normWeek(week);
  const dates = weekDates(start);
  const [biz, staff, coverage] = await Promise.all([getBusiness(bid), getStaffFull(bid), getCoverage(bid)]);
  const shifts = await q(
    `SELECT s.id, s.staff_id, s.date, s.start_time, s.end_time, s.role, s.status, s.notes, st.name AS staff_name
       FROM shifts s JOIN staff st ON st.id = s.staff_id
      WHERE s.business_id=$1 AND s.date = ANY($2) ${publishedOnly ? "AND s.status='published'" : ''}
      ORDER BY s.date, s.start_time`, [bid, dates]);
  const ctx = {
    weekStart: start,
    staff,
    shifts,
    availability: staff.flatMap((s) => s.availability),
    unavailable: staff.flatMap((s) => s.unavailable_dates),
    coverage,
    constraints: biz,
  };
  const violations = suggestFixes({ ...ctx, violations: checkRoster(ctx) });
  const logs = await q('SELECT id, shift_id, staff_id, date, actual_start, actual_end, break_minutes, status FROM time_logs WHERE business_id=$1 AND date = ANY($2)', [bid, dates]);
  const versions = (await one('SELECT count(*)::int AS n FROM roster_versions WHERE business_id=$1 AND week_start=$2', [bid, start])).n;
  return { week_start: start, dates, staff: staff.map(({ pin_hash, ...s }) => s), shifts, violations, logs, coverage, versions, draft_count: shifts.filter((s) => s.status === 'draft').length };
}

async function logsFor(bid, staffId, dates, statuses) {
  return q(`SELECT id, date, actual_start AS start, actual_end AS "end", break_minutes, status FROM time_logs
             WHERE business_id=$1 AND staff_id=$2 AND date = ANY($3) AND status = ANY($4) ORDER BY date, actual_start`,
  [bid, staffId, dates, statuses]);
}

export async function staffWeekPay(bid, staffRow, week, { includePending = false } = {}) {
  const start = normWeek(week);
  const dates = weekDates(start);
  const rules = await getRules(bid);
  const approved = await logsFor(bid, staffRow.id, dates, ['approved']);
  const result = computePay({ rules, staff: staffRow, logs: approved });
  const adjustments = await q('SELECT id, description, amount::float AS amount FROM manual_adjustments WHERE business_id=$1 AND staff_id=$2 AND week_start=$3', [bid, staffRow.id, start]);
  const adjTotal = adjustments.reduce((t, a) => t + a.amount, 0);
  let pending = null;
  if (includePending) {
    const p = await logsFor(bid, staffRow.id, dates, ['pending']);
    if (p.length) {
      const both = computePay({ rules, staff: staffRow, logs: [...approved, ...p] });
      pending = { count: p.length, estimated_extra: Math.round((both.total - result.total) * 100) / 100 };
    }
  }
  const paid = await one('SELECT total_amount::float AS total_amount, paid_at FROM payouts WHERE business_id=$1 AND staff_id=$2 AND week_start=$3', [bid, staffRow.id, start]);
  return { ...result, adjustments, total: Math.round((result.total + adjTotal) * 100) / 100, pending, paid: paid || null, week_start: start };
}

export async function getPayouts(bid, week) {
  const start = normWeek(week);
  const staff = await q('SELECT id, name, role, phone FROM staff WHERE business_id=$1 ORDER BY created_at, name', [bid]);
  const rows = [];
  for (const s of staff) {
    const pay = await staffWeekPay(bid, s, start, { includePending: true });
    if (pay.shifts.length || pay.adjustments.length || pay.pending || pay.paid) rows.push({ staff: s, ...pay });
  }
  const rules = await getRules(bid);
  return {
    week_start: start,
    rows,
    total: Math.round(rows.reduce((t, r) => t + r.total, 0) * 100) / 100,
    manual_rules: rules.filter((r) => r.kind === 'manual' && r.enabled),
  };
}

// ---------- writes used by both UI and Claude ----------

export async function findStaff(bid, ref) {
  const all = await q('SELECT id, name, phone, role FROM staff WHERE business_id=$1 AND active', [bid]);
  const key = String(ref || '').trim().toLowerCase();
  const digits = key.replace(/\D/g, '');
  return all.find((s) => s.id === ref) || (digits.length >= 10 && all.find((s) => s.phone.endsWith(digits.slice(-10)))) ||
    all.find((s) => s.name.toLowerCase() === key) || all.find((s) => s.name.toLowerCase().split(' ')[0] === key.split(' ')[0]);
}

export function cleanPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
}

export async function setAvailability(t, staffId, availability, unavailable) {
  if (availability) {
    await t.q('DELETE FROM availability WHERE staff_id=$1', [staffId]);
    for (const a of availability) {
      toMinutes(a.start_time); toMinutes(a.end_time);
      await t.q('INSERT INTO availability (staff_id, weekday, start_time, end_time) VALUES ($1,$2,$3,$4)', [staffId, a.weekday, a.start_time, a.end_time]);
    }
  }
  if (unavailable) {
    await t.q('DELETE FROM unavailable_dates WHERE staff_id=$1', [staffId]);
    for (const u of unavailable) {
      if (!isDate(u.date)) throw new Error(`Invalid date ${u.date}`);
      await t.q('INSERT INTO unavailable_dates (staff_id, date, reason) VALUES ($1,$2,$3)', [staffId, u.date, u.reason || null]);
    }
  }
}

export async function upsertStaff(bid, list) {
  return tx(async (t) => {
    const out = [];
    for (const s of list) {
      const phone = cleanPhone(s.phone);
      if (!phone) throw new Error(`${s.name}: phone must have 10 digits`);
      if (s.pin != null && !/^\d{4}$/.test(String(s.pin))) throw new Error(`${s.name}: PIN must be 4 digits`);
      let row = await t.one('SELECT id, pin_hash FROM staff WHERE business_id=$1 AND phone=$2', [bid, phone]);
      let pin = s.pin != null ? String(s.pin) : null;
      if (!row) {
        if (!pin) pin = String(Math.floor(1000 + Math.random() * 9000));
        row = await t.one('INSERT INTO staff (business_id, name, phone, role, pin_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id', [bid, s.name, phone, s.role || null, bcrypt.hashSync(pin, 8)]);
        out.push({ name: s.name, phone, status: 'added', pin });
      } else {
        await t.q('UPDATE staff SET name=$2, role=COALESCE($3, role), active=true WHERE id=$1', [row.id, s.name, s.role || null]);
        if (pin) await t.q('UPDATE staff SET pin_hash=$2 WHERE id=$1', [row.id, bcrypt.hashSync(pin, 8)]);
        out.push({ name: s.name, phone, status: 'updated', ...(pin ? { pin } : {}) });
      }
      await setAvailability(t, row.id, s.availability, s.unavailable_dates);
    }
    return out;
  });
}

export async function saveRules(bid, rules, mode = 'replace') {
  const parsed = rules.map(validateRuleShape);
  return tx(async (t) => {
    if (mode === 'replace') await t.q('DELETE FROM pay_rules WHERE business_id=$1', [bid]);
    for (const r of parsed) {
      await t.q('INSERT INTO pay_rules (business_id, name, source_text, priority, kind, conditions, effect, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [bid, r.name, r.source_text || null, r.priority, r.kind, r.conditions, r.effect, r.enabled]);
    }
    return parsed.length;
  });
}

// Save a copy of a week's roster before it gets replaced, so nothing is ever lost.
export async function snapshotWeek(t, bid, week, label) {
  const dates = weekDates(normWeek(week));
  const rows = await t.q(`SELECT s.staff_id, st.name AS staff_name, s.date, s.start_time, s.end_time, s.role, s.status, s.notes
      FROM shifts s JOIN staff st ON st.id = s.staff_id WHERE s.business_id=$1 AND s.date = ANY($2) ORDER BY s.date, s.start_time`, [bid, dates]);
  if (!rows.length) return null;
  const last = await t.one('SELECT id, shifts FROM roster_versions WHERE business_id=$1 AND week_start=$2 ORDER BY created_at DESC LIMIT 1', [bid, normWeek(week)]);
  const sig = (arr) => arr.map((r) => [r.staff_id, r.date, r.start_time, r.end_time, r.role, r.status, r.notes].join('|')).join('\n');
  if (last && sig(last.shifts) === sig(rows)) return last; // same as the latest saved copy: don't duplicate
  return t.one('INSERT INTO roster_versions (business_id, week_start, label, shifts) VALUES ($1,$2,$3,$4) RETURNING id', [bid, normWeek(week), label, JSON.stringify(rows)]);
}

export async function listVersions(bid, week) {
  const rows = await q(`SELECT id, label, created_at, shifts FROM roster_versions WHERE business_id=$1 AND week_start=$2 ORDER BY created_at DESC LIMIT 30`, [bid, normWeek(week)]);
  return rows.map((r) => ({ id: r.id, label: r.label, created_at: r.created_at, shift_count: r.shifts.length,
    published: r.shifts.filter((s) => s.status === 'published').length, people: [...new Set(r.shifts.map((s) => s.staff_name))].length, shifts: r.shifts }));
}

export async function restoreVersion(bid, versionId) {
  const v = await one('SELECT * FROM roster_versions WHERE id=$1 AND business_id=$2', [versionId, bid]);
  if (!v) throw new Error('Version not found');
  const dates = weekDates(v.week_start);
  await tx(async (t) => {
    await snapshotWeek(t, bid, v.week_start, 'Before restoring an older version');
    await t.q('DELETE FROM shifts WHERE business_id=$1 AND date = ANY($2) AND id NOT IN (SELECT shift_id FROM time_logs WHERE shift_id IS NOT NULL)', [bid, dates]);
    const kept = await t.q('SELECT staff_id, date, start_time FROM shifts WHERE business_id=$1 AND date = ANY($2)', [bid, dates]);
    const active = new Set((await t.q('SELECT id FROM staff WHERE business_id=$1 AND active', [bid])).map((r) => r.id));
    for (const s of v.shifts) {
      if (!active.has(s.staff_id) || kept.some((k) => k.staff_id === s.staff_id && k.date === s.date && k.start_time === s.start_time)) continue;
      await t.q("INSERT INTO shifts (business_id, staff_id, date, start_time, end_time, role, notes, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'draft')",
        [bid, s.staff_id, s.date, s.start_time, s.end_time, s.role, s.notes]);
    }
  });
  return v.week_start;
}

export async function saveRoster(bid, week, shifts, replace = true) {
  const start = normWeek(week);
  const dates = weekDates(start);
  const errors = [];
  const resolved = [];
  for (const s of shifts) {
    const st = await findStaff(bid, s.staff);
    if (!st) { errors.push(`Unknown staff "${s.staff}"`); continue; }
    if (!dates.includes(s.date)) { errors.push(`${s.date} is outside the week starting ${start}`); continue; }
    try { toMinutes(s.start_time); toMinutes(s.end_time); } catch (e) { errors.push(e.message); continue; }
    resolved.push({ ...s, staff_id: st.id, role: s.role || st.role });
  }
  if (errors.length) throw new Error(errors.join('; '));
  await tx(async (t) => {
    if (replace) await snapshotWeek(t, bid, start, 'Before Claude made a new roster');
    if (replace) await t.q("DELETE FROM shifts WHERE business_id=$1 AND date = ANY($2) AND id NOT IN (SELECT shift_id FROM time_logs WHERE shift_id IS NOT NULL)", [bid, dates]);
    for (const s of resolved) {
      await t.q('INSERT INTO shifts (business_id, staff_id, date, start_time, end_time, role, notes, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [bid, s.staff_id, s.date, s.start_time, s.end_time, s.role, s.notes || null, 'draft']);
    }
  });
  return getWeek(bid, start);
}

export async function saveSettings(bid, s) {
  return tx(async (t) => {
    await t.q(`UPDATE businesses SET name=COALESCE($2,name),
      max_days_per_week=CASE WHEN $3::boolean THEN $4::int ELSE max_days_per_week END,
      max_hours_per_day=CASE WHEN $5::boolean THEN $6::numeric ELSE max_hours_per_day END,
      min_rest_hours=CASE WHEN $7::boolean THEN $8::numeric ELSE min_rest_hours END WHERE id=$1`,
    [bid, s.name || null, 'max_days_per_week' in s, s.max_days_per_week ?? null, 'max_hours_per_day' in s, s.max_hours_per_day ?? null, 'min_rest_hours' in s, s.min_rest_hours ?? null]);
    if (Array.isArray(s.coverage)) {
      await t.q('DELETE FROM coverage_requirements WHERE business_id=$1', [bid]);
      for (const c of s.coverage) {
        toMinutes(c.start_time); toMinutes(c.end_time);
        await t.q('INSERT INTO coverage_requirements (business_id, weekday, start_time, end_time, min_staff, role) VALUES ($1,$2,$3,$4,$5,$6)',
          [bid, c.weekday, c.start_time, c.end_time, c.min_staff, c.role || null]);
      }
    }
  });
}
