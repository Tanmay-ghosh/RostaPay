import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { q, one, tx, migrate } from './db.js';
import { setSession, clearSession, readSession, requireOwner, requireWorker } from './auth.js';
import * as svc from './services.js';
import { computePay } from './lib/payEngine.js';
import { toMinutes, isDate, weekDates, todayIST, fmtHours, assertShiftTimes } from './lib/time.js';
import { validateRuleShape } from './schemas.js';
import { seedIfEmpty, resetDemo } from './seed.js';
import { handleMcp } from './mcp.js';

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// async error wrapper
const h = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  const msg = e?.issues ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : e.message || String(e);
  if (!e.issues && !e.expose) console.error(e);
  res.status(e.status || 400).json({ error: msg });
});
const err = (status, message) => Object.assign(new Error(message), { status, expose: true });

export function publicUrl(req) {
  return process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
}

app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---------------- MCP (Claude connects here) ----------------
app.post('/mcp/:key', h(handleMcp));
app.all('/mcp/:key', (req, res) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }));

// ---------------- Auth ----------------
app.get('/api/session', (req, res) => res.json(readSession(req) || null));

app.post('/api/auth/owner/signup', h(async (req, res) => {
  const { business_name, name, email, password } = req.body || {};
  if (!business_name || !email || !password || password.length < 8) throw err(400, 'Business name, email and a password of 8+ characters are required');
  const exists = await one('SELECT 1 FROM owners WHERE lower(email)=lower($1)', [email]);
  if (exists) throw err(400, 'An account with this email already exists');
  const out = await tx(async (t) => {
    const b = await t.one('INSERT INTO businesses (name, max_days_per_week, max_hours_per_day) VALUES ($1, 6, 10) RETURNING id', [business_name]);
    const o = await t.one('INSERT INTO owners (business_id, name, email, password_hash) VALUES ($1,$2,lower($3),$4) RETURNING id', [b.id, name || null, email, bcrypt.hashSync(password, 10)]);
    return { id: o.id, business_id: b.id };
  });
  setSession(res, { t: 'owner', id: out.id, business_id: out.business_id });
  res.json({ ok: true });
}));

app.post('/api/auth/owner/login', h(async (req, res) => {
  const { email, password } = req.body || {};
  const o = await one('SELECT id, business_id, password_hash FROM owners WHERE lower(email)=lower($1)', [email || '']);
  if (!o || !bcrypt.compareSync(password || '', o.password_hash)) throw err(401, 'Wrong email or password');
  setSession(res, { t: 'owner', id: o.id, business_id: o.business_id });
  res.json({ ok: true });
}));

app.post('/api/auth/worker/login', h(async (req, res) => {
  const phone = svc.cleanPhone(req.body?.phone);
  const pin = String(req.body?.pin || '');
  const rows = phone ? await q('SELECT s.id, s.business_id, s.pin_hash, b.name AS business_name FROM staff s JOIN businesses b ON b.id=s.business_id WHERE s.phone=$1 AND s.active AND s.pin_hash IS NOT NULL', [phone]) : [];
  let matches = rows.filter((r) => bcrypt.compareSync(pin, r.pin_hash));
  if (req.body?.business_id) matches = matches.filter((r) => r.business_id === req.body.business_id);
  if (!matches.length) throw err(401, 'Wrong phone number or PIN');
  // Same phone + PIN at more than one business (older accounts): let the worker pick instead of guessing.
  if (matches.length > 1) return res.json({ choose_business: matches.map((r) => ({ business_id: r.business_id, name: r.business_name })) });
  const s = matches[0];
  setSession(res, { t: 'worker', staff_id: s.id, business_id: s.business_id });
  res.json({ ok: true });
}));

app.post('/api/auth/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

// ---------------- Owner API ----------------
const owner = express.Router();
owner.use(requireOwner);
const B = (req) => req.session.business_id;

owner.get('/me', h(async (req, res) => {
  const biz = await svc.getBusiness(B(req));
  const o = await one('SELECT name, email FROM owners WHERE id=$1', [req.session.id]);
  const counts = await one(`SELECT
      (SELECT count(*)::int FROM time_logs WHERE business_id=$1 AND status='pending') AS pending_hours,
      (SELECT count(*)::int FROM swap_requests WHERE business_id=$1 AND status='pending_owner') AS pending_swaps`, [B(req)]);
  res.json({ business: { id: biz.id, name: biz.name }, owner: o, counts, is_demo: o.email === 'demo@rostapay.app' });
}));

owner.get('/onboarding', h(async (req, res) => {
  const r = await one(`SELECT
      (SELECT mcp_last_used_at FROM businesses WHERE id=$1) AS claude_at,
      (SELECT count(*)::int FROM staff WHERE business_id=$1 AND active) AS staff,
      (SELECT count(*)::int FROM coverage_requirements WHERE business_id=$1) AS coverage,
      (SELECT count(*)::int FROM pay_rules WHERE business_id=$1 AND enabled) AS rules,
      (SELECT count(*)::int FROM shifts WHERE business_id=$1) AS shifts,
      (SELECT count(*)::int FROM shifts WHERE business_id=$1 AND status='published') AS published`, [B(req)]);
  res.json({ claude: !!r.claude_at, staff: r.staff, coverage: r.coverage, rules: r.rules, shifts: r.shifts, published: r.published });
}));

owner.get('/roster', h(async (req, res) => res.json(await svc.getWeek(B(req), req.query.week))));

async function shiftBody(req) {
  const { staff_id, date, start_time, end_time, role, notes } = req.body || {};
  const st = await one('SELECT id, role FROM staff WHERE id=$1 AND business_id=$2', [staff_id, B(req)]);
  if (!st) throw err(400, 'Pick a staff member');
  if (!isDate(date)) throw err(400, 'Invalid date');
  try { assertShiftTimes(start_time, end_time); } catch (e) { throw err(400, e.message); }
  return [st.id, date, start_time, end_time, role || st.role, notes || null];
}

owner.post('/shifts', h(async (req, res) => {
  const v = await shiftBody(req);
  const row = await one("INSERT INTO shifts (business_id, staff_id, date, start_time, end_time, role, notes, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'draft') RETURNING id", [B(req), ...v]);
  res.json(row);
}));
owner.put('/shifts/:id', h(async (req, res) => {
  const v = await shiftBody(req);
  const row = await one("UPDATE shifts SET staff_id=$3, date=$4, start_time=$5, end_time=$6, role=$7, notes=$8, status='draft' WHERE id=$1 AND business_id=$2 RETURNING id", [req.params.id, B(req), ...v]);
  if (!row) throw err(404, 'Shift not found');
  res.json(row);
}));
owner.delete('/shifts/:id', h(async (req, res) => {
  await q('DELETE FROM shifts WHERE id=$1 AND business_id=$2', [req.params.id, B(req)]);
  res.json({ ok: true });
}));
owner.post('/roster/publish', h(async (req, res) => {
  const dates = weekDates(svc.normWeek(req.body?.week));
  const rows = await q("UPDATE shifts SET status='published' WHERE business_id=$1 AND date = ANY($2) AND status='draft' RETURNING id", [B(req), dates]);
  res.json({ published: rows.length });
}));

// Apply one suggested fix from the roster checks (shift edits go back to draft so the owner re-publishes)
owner.post('/roster/fix', h(async (req, res) => {
  const f = req.body?.fix || {};
  const own = async (table, id) => { const r = await one(`SELECT id FROM ${table} WHERE id=$1 AND business_id=$2`, [id, B(req)]); if (!r) throw err(404, 'Not found'); };
  if (f.type === 'update_shift') {
    await own('shifts', f.shift_id);
    const st = await one('SELECT id FROM staff WHERE id=$1 AND business_id=$2', [f.staff_id, B(req)]);
    if (!st) throw err(400, 'Unknown staff');
    try { assertShiftTimes(f.start_time, f.end_time); } catch (e) { throw err(400, e.message); }
    await q("UPDATE shifts SET staff_id=$2, start_time=$3, end_time=$4, status='draft' WHERE id=$1", [f.shift_id, st.id, f.start_time, f.end_time]);
  } else if (f.type === 'update_role') {
    await own('shifts', f.shift_id);
    const st = await one('SELECT role FROM staff WHERE id=$1 AND business_id=$2', [f.staff_id, B(req)]);
    if (!st) throw err(400, 'Unknown staff');
    await q("UPDATE shifts SET role=$2, status='draft' WHERE id=$1", [f.shift_id, st.role]);
  } else if (f.type === 'add_shift') {
    const st = await one('SELECT id, role FROM staff WHERE id=$1 AND business_id=$2', [f.staff_id, B(req)]);
    if (!st || !isDate(f.date)) throw err(400, 'Invalid fix');
    try { assertShiftTimes(f.start_time, f.end_time); } catch (e) { throw err(400, e.message); }
    await q("INSERT INTO shifts (business_id, staff_id, date, start_time, end_time, role, status) VALUES ($1,$2,$3,$4,$5,$6,'draft')", [B(req), st.id, f.date, f.start_time, f.end_time, st.role]);
  } else if (f.type === 'delete_shift') {
    await own('shifts', f.shift_id);
    await q('DELETE FROM shifts WHERE id=$1', [f.shift_id]);
  } else if (f.type === 'coverage') {
    await own('coverage_requirements', f.coverage_id);
    if (f.start_time) toMinutes(f.start_time);
    if (f.end_time) toMinutes(f.end_time);
    await q('UPDATE coverage_requirements SET start_time=COALESCE($2,start_time), end_time=COALESCE($3,end_time), min_staff=COALESCE($4,min_staff) WHERE id=$1',
      [f.coverage_id, f.start_time || null, f.end_time || null, f.min_staff ?? null]);
  } else throw err(400, 'Unknown fix');
  res.json({ ok: true });
}));

owner.get('/staff', h(async (req, res) => res.json(await svc.getStaffFull(B(req)))));
owner.post('/staff', h(async (req, res) => {
  const { name, phone, role, pin, availability, unavailable_dates } = req.body || {};
  if (!name) throw err(400, 'Name is required');
  if (!/^\d{4}$/.test(String(pin || ''))) throw err(400, 'Set a 4-digit PIN for their login');
  const exists = await one('SELECT 1 FROM staff WHERE business_id=$1 AND phone=$2', [B(req), svc.cleanPhone(phone)]);
  if (exists) throw err(400, 'Someone with this phone number already exists');
  res.json(await svc.upsertStaff(B(req), [{ name, phone, role, pin, availability, unavailable_dates }]));
}));
owner.put('/staff/:id', h(async (req, res) => {
  const { name, phone, role, pin, availability, unavailable_dates, active } = req.body || {};
  if (!name || !svc.cleanPhone(phone)) throw err(400, 'Name and a 10-digit phone are required');
  const p = svc.validMobile(phone);
  if (!p) throw err(400, 'Enter a valid Indian mobile number (starts with 6, 7, 8 or 9)');
  if (pin && !/^\d{4}$/.test(String(pin))) throw err(400, 'PIN must be 4 digits');
  await tx(async (t) => {
    if (pin && await svc.pinClashes(t, p, String(pin), B(req))) throw err(400, 'This phone number already uses that PIN at another RostaPay business — choose a different PIN');
    const row = await t.one('UPDATE staff SET name=$3, phone=$4, role=$5, active=COALESCE($6, active) WHERE id=$1 AND business_id=$2 RETURNING id', [req.params.id, B(req), name, p, role || null, active ?? null]);
    if (!row) throw err(404, 'Staff not found');
    if (pin) await t.q('UPDATE staff SET pin_hash=$2 WHERE id=$1', [row.id, bcrypt.hashSync(String(pin), 8)]);
    await svc.setAvailability(t, row.id, availability, unavailable_dates);
  });
  res.json({ ok: true });
}));
owner.delete('/staff/:id', h(async (req, res) => {
  await q('UPDATE staff SET active=false WHERE id=$1 AND business_id=$2', [req.params.id, B(req)]);
  res.json({ ok: true });
}));

owner.get('/rules', h(async (req, res) => res.json(await svc.getRules(B(req)))));
owner.post('/rules', h(async (req, res) => {
  const r = validateRuleShape(req.body);
  const row = await one('INSERT INTO pay_rules (business_id, name, source_text, priority, kind, conditions, effect, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
    [B(req), r.name, r.source_text || null, r.priority, r.kind, r.conditions, r.effect, r.enabled]);
  res.json(row);
}));
owner.put('/rules/:id', h(async (req, res) => {
  const r = validateRuleShape(req.body);
  const row = await one('UPDATE pay_rules SET name=$3, source_text=$4, priority=$5, kind=$6, conditions=$7, effect=$8, enabled=$9 WHERE id=$1 AND business_id=$2 RETURNING id',
    [req.params.id, B(req), r.name, r.source_text || null, r.priority, r.kind, r.conditions, r.effect, r.enabled]);
  if (!row) throw err(404, 'Rule not found');
  res.json(row);
}));
owner.patch('/rules/:id/enabled', h(async (req, res) => {
  await q('UPDATE pay_rules SET enabled=$3 WHERE id=$1 AND business_id=$2', [req.params.id, B(req), !!req.body?.enabled]);
  res.json({ ok: true });
}));
owner.delete('/rules/:id', h(async (req, res) => {
  await q('DELETE FROM pay_rules WHERE id=$1 AND business_id=$2', [req.params.id, B(req)]);
  res.json({ ok: true });
}));
owner.post('/rules/test', h(async (req, res) => {
  const { staff_id, role, date, start_time, end_time, break_minutes } = req.body || {};
  if (!isDate(date)) throw err(400, 'Pick a real date');
  try { assertShiftTimes(start_time, end_time, break_minutes); } catch (e) { throw err(400, e.message); }
  const st = staff_id ? await one('SELECT id, role FROM staff WHERE id=$1 AND business_id=$2', [staff_id, B(req)]) : null;
  if (staff_id && !st) throw err(400, 'Unknown staff member');
  const rules = await svc.getRules(B(req));
  res.json(computePay({ rules, staff: st || { id: 'test', role: role || '' }, logs: [{ id: 'test', date, start: start_time, end: end_time, break_minutes: Number(break_minutes) || 0 }] }));
}));

owner.get('/hours', h(async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const rows = await q(`SELECT l.*, st.name AS staff_name, st.role, s.start_time AS scheduled_start, s.end_time AS scheduled_end
      FROM time_logs l JOIN staff st ON st.id=l.staff_id LEFT JOIN shifts s ON s.id=l.shift_id
     WHERE l.business_id=$1 AND l.status=$2 ORDER BY l.date DESC, st.name LIMIT 200`, [B(req), status]);
  const rules = await svc.getRules(B(req));
  res.json(rows.map((l) => ({ ...l, estimate: computePay({ rules, staff: { id: l.staff_id, role: l.role }, logs: [{ id: l.id, date: l.date, start: l.actual_start, end: l.actual_end, break_minutes: l.break_minutes }] }).total })));
}));
owner.post('/hours/:id/approve', h(async (req, res) => {
  const { actual_start, actual_end, break_minutes } = req.body || {};
  const cur = await one('SELECT actual_start, actual_end, break_minutes FROM time_logs WHERE id=$1 AND business_id=$2', [req.params.id, B(req)]);
  if (!cur) throw err(404, 'Log not found');
  try { assertShiftTimes(actual_start || cur.actual_start, actual_end || cur.actual_end, break_minutes ?? cur.break_minutes); } catch (e) { throw err(400, e.message); }
  const row = await one(`UPDATE time_logs SET status='approved', approved_at=now(), owner_note=NULL,
      actual_start=COALESCE($3, actual_start), actual_end=COALESCE($4, actual_end), break_minutes=COALESCE($5, break_minutes)
      WHERE id=$1 AND business_id=$2 RETURNING id`, [req.params.id, B(req), actual_start || null, actual_end || null, break_minutes ?? null]);
  if (!row) throw err(404, 'Log not found');
  res.json({ ok: true });
}));
owner.post('/hours/approve-all', h(async (req, res) => {
  const rows = await q("UPDATE time_logs SET status='approved', approved_at=now() WHERE business_id=$1 AND status='pending' RETURNING id", [B(req)]);
  res.json({ approved: rows.length });
}));
owner.post('/hours/:id/reject', h(async (req, res) => {
  await q("UPDATE time_logs SET status='rejected', owner_note=$3 WHERE id=$1 AND business_id=$2", [req.params.id, B(req), req.body?.note || null]);
  res.json({ ok: true });
}));

owner.get('/payouts', h(async (req, res) => res.json(await svc.getPayouts(B(req), req.query.week))));
owner.post('/payouts/mark-paid', h(async (req, res) => {
  const week = svc.normWeek(req.body?.week);
  const st = await one('SELECT id, role FROM staff WHERE id=$1 AND business_id=$2', [req.body?.staff_id, B(req)]);
  if (!st) throw err(404, 'Staff not found');
  const pay = await svc.staffWeekPay(B(req), st, week);
  await q(`INSERT INTO payouts (business_id, staff_id, week_start, total_amount, breakdown, status, paid_at) VALUES ($1,$2,$3,$4,$5,'paid',now())
           ON CONFLICT (business_id, staff_id, week_start) DO UPDATE SET total_amount=EXCLUDED.total_amount, breakdown=EXCLUDED.breakdown, paid_at=now()`,
  [B(req), st.id, week, pay.total, JSON.stringify({ lines: pay.lines, adjustments: pay.adjustments })]);
  res.json({ ok: true });
}));
owner.post('/payouts/unmark-paid', h(async (req, res) => {
  await q('DELETE FROM payouts WHERE business_id=$1 AND staff_id=$2 AND week_start=$3', [B(req), req.body?.staff_id, svc.normWeek(req.body?.week)]);
  res.json({ ok: true });
}));
owner.post('/adjustments', h(async (req, res) => {
  const { staff_id, week, description, amount } = req.body || {};
  if (!description || !Number.isFinite(Number(amount))) throw err(400, 'Description and amount are required');
  const st = await one('SELECT id FROM staff WHERE id=$1 AND business_id=$2', [staff_id, B(req)]);
  if (!st) throw err(404, 'Staff not found');
  await q('INSERT INTO manual_adjustments (business_id, staff_id, week_start, description, amount) VALUES ($1,$2,$3,$4,$5)', [B(req), st.id, svc.normWeek(week), description, Number(amount)]);
  res.json({ ok: true });
}));
owner.delete('/adjustments/:id', h(async (req, res) => {
  await q('DELETE FROM manual_adjustments WHERE id=$1 AND business_id=$2', [req.params.id, B(req)]);
  res.json({ ok: true });
}));
owner.get('/payouts.csv', h(async (req, res) => {
  const p = await svc.getPayouts(B(req), req.query.week);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Staff', 'Role', 'Phone', 'Hours worked', 'Item', 'Amount (INR)', 'Week total (INR)', 'Status'].map(esc).join(',')];
  for (const r of p.rows) {
    const items = [...r.lines.map((l) => [`${l.rule_name}: ${l.label}`, l.amount]), ...r.adjustments.map((a) => [`Adjustment: ${a.description}`, a.amount])];
    if (!items.length) items.push(['—', 0]);
    items.forEach(([item, amt], i) => lines.push([r.staff.name, r.staff.role, r.staff.phone, i ? '' : fmtHours(r.worked_minutes), item, amt, i ? '' : r.total, i ? '' : r.paid ? 'Paid' : 'Unpaid'].map(esc).join(',')));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="rostapay-payouts-${p.week_start}.csv"`);
  res.send('﻿' + lines.join('\n'));
}));

owner.get('/swaps', h(async (req, res) => {
  res.json(await q(`SELECT sw.id, sw.status, sw.created_at, s.date, s.start_time, s.end_time, f.name AS from_name, t.name AS to_name
      FROM swap_requests sw JOIN shifts s ON s.id=sw.shift_id JOIN staff f ON f.id=sw.from_staff_id JOIN staff t ON t.id=sw.to_staff_id
     WHERE sw.business_id=$1 ORDER BY (sw.status='pending_owner') DESC, sw.created_at DESC LIMIT 100`, [B(req)]));
}));
owner.post('/swaps/:id/:action', h(async (req, res) => {
  if (!['approve', 'reject'].includes(req.params.action)) throw err(404, 'Unknown action');
  await tx(async (t) => {
    const sw = await t.one("SELECT * FROM swap_requests WHERE id=$1 AND business_id=$2 AND status='pending_owner'", [req.params.id, B(req)]);
    if (!sw) throw err(404, 'Swap not found or already handled');
    if (req.params.action === 'approve') {
      await t.q('UPDATE shifts SET staff_id=$2 WHERE id=$1', [sw.shift_id, sw.to_staff_id]);
      await t.q("UPDATE swap_requests SET status='approved' WHERE id=$1", [sw.id]);
    } else await t.q("UPDATE swap_requests SET status='rejected' WHERE id=$1", [sw.id]);
  });
  res.json({ ok: true });
}));

owner.get('/settings', h(async (req, res) => {
  const biz = await svc.getBusiness(B(req));
  res.json({ ...biz, coverage: await svc.getCoverage(B(req)), mcp_url: `${publicUrl(req)}/mcp/${biz.mcp_key}` });
}));
owner.put('/settings', h(async (req, res) => {
  const b = req.body || {};
  const num = (v) => (v === '' || v == null ? null : Number(v));
  await svc.saveSettings(B(req), { name: b.name, max_days_per_week: num(b.max_days_per_week), max_hours_per_day: num(b.max_hours_per_day), min_rest_hours: num(b.min_rest_hours), coverage: b.coverage });
  res.json({ ok: true });
}));
owner.post('/settings/regenerate-key', h(async (req, res) => {
  await q("UPDATE businesses SET mcp_key=replace(gen_random_uuid()::text,'-','') WHERE id=$1", [B(req)]);
  res.json({ ok: true });
}));
owner.post('/reset-demo', h(async (req, res) => {
  const o = await one('SELECT email FROM owners WHERE id=$1', [req.session.id]);
  if (o?.email !== 'demo@rostapay.app') throw err(403, 'Only the demo account can be reset');
  await resetDemo();
  const n = await one("SELECT id, business_id FROM owners WHERE email='demo@rostapay.app'");
  setSession(res, { t: 'owner', id: n.id, business_id: n.business_id });
  res.json({ ok: true });
}));
app.use('/api/owner', owner);

// ---------------- Worker API ----------------
const worker = express.Router();
worker.use(requireWorker);
const S = (req) => req.session.staff_id;

worker.get('/me', h(async (req, res) => {
  const me = await one('SELECT s.id, s.name, s.role, s.phone, b.name AS business_name FROM staff s JOIN businesses b ON b.id=s.business_id WHERE s.id=$1', [S(req)]);
  if (!me) throw err(401, 'Account not found');
  res.json(me);
}));
worker.get('/week', h(async (req, res) => {
  const w = await svc.getWeek(B(req), req.query.week, { publishedOnly: true });
  res.json({
    week_start: w.week_start, dates: w.dates,
    week_published: w.shifts.length > 0, // false = the owner hasn't published this week yet (don't show "Day off")
    my_shifts: w.shifts.filter((s) => s.staff_id === S(req)).map((s) => ({ ...s, log: w.logs.find((l) => l.shift_id === s.id) || null })),
    team_shifts: w.shifts.filter((s) => s.staff_id !== S(req)).map(({ id, staff_name, date, start_time, end_time, role }) => ({ id, staff_name, date, start_time, end_time, role })),
    colleagues: w.staff.filter((s) => s.id !== S(req)).map(({ id, name, role }) => ({ id, name, role })),
  });
}));
worker.get('/logs', h(async (req, res) => {
  const today = todayIST();
  res.json(await q(`SELECT s.id AS shift_id, s.date, s.start_time, s.end_time, l.id AS log_id, l.actual_start, l.actual_end, l.break_minutes, l.status, l.owner_note
      FROM shifts s LEFT JOIN time_logs l ON l.shift_id=s.id
     WHERE s.staff_id=$1 AND s.status='published' AND s.date <= $2 ORDER BY s.date DESC, s.start_time DESC LIMIT 40`, [S(req), today]));
}));
worker.post('/logs', h(async (req, res) => {
  const { shift_id, actual_start, actual_end, break_minutes } = req.body || {};
  try { assertShiftTimes(actual_start, actual_end, break_minutes); } catch (e) { throw err(400, e.message); }
  const sh = await one("SELECT id, date FROM shifts WHERE id=$1 AND staff_id=$2 AND status='published'", [shift_id, S(req)]);
  if (!sh) throw err(404, 'Shift not found');
  if (sh.date > todayIST()) throw err(400, "You can log hours once the shift has started");
  const ex = await one('SELECT id, status FROM time_logs WHERE shift_id=$1', [sh.id]);
  if (ex?.status === 'approved') throw err(400, 'These hours are already approved');
  if (ex) await q("UPDATE time_logs SET actual_start=$2, actual_end=$3, break_minutes=$4, status='pending', owner_note=NULL, submitted_at=now() WHERE id=$1", [ex.id, actual_start, actual_end, Number(break_minutes) || 0]);
  else await q('INSERT INTO time_logs (business_id, shift_id, staff_id, date, actual_start, actual_end, break_minutes) VALUES ($1,$2,$3,$4,$5,$6,$7)', [B(req), sh.id, S(req), sh.date, actual_start, actual_end, Number(break_minutes) || 0]);
  res.json({ ok: true });
}));
worker.get('/pay', h(async (req, res) => {
  const st = await one('SELECT id, role FROM staff WHERE id=$1', [S(req)]);
  const pay = await svc.staffWeekPay(B(req), st, req.query.week, { includePending: true });
  const history = await q('SELECT week_start, total_amount::float AS total_amount, paid_at FROM payouts WHERE staff_id=$1 ORDER BY week_start DESC LIMIT 12', [S(req)]);
  res.json({ ...pay, history });
}));
worker.get('/availability', h(async (req, res) => {
  const [me] = (await svc.getStaffFull(B(req))).filter((s) => s.id === S(req));
  res.json({ availability: me?.availability || [], unavailable_dates: me?.unavailable_dates || [] });
}));
worker.put('/availability', h(async (req, res) => {
  await tx((t) => svc.setAvailability(t, S(req), req.body?.availability, req.body?.unavailable_dates));
  res.json({ ok: true });
}));
worker.get('/swaps', h(async (req, res) => {
  res.json(await q(`SELECT sw.id, sw.status, s.date, s.start_time, s.end_time, f.name AS from_name, t.name AS to_name,
        (sw.from_staff_id=$1) AS mine
      FROM swap_requests sw JOIN shifts s ON s.id=sw.shift_id JOIN staff f ON f.id=sw.from_staff_id JOIN staff t ON t.id=sw.to_staff_id
     WHERE sw.from_staff_id=$1 OR sw.to_staff_id=$1 ORDER BY sw.created_at DESC LIMIT 50`, [S(req)]));
}));
worker.post('/swaps', h(async (req, res) => {
  const { shift_id, to_staff_id } = req.body || {};
  const sh = await one("SELECT id, date FROM shifts WHERE id=$1 AND staff_id=$2 AND status='published'", [shift_id, S(req)]);
  if (!sh) throw err(404, 'Pick one of your upcoming shifts');
  if (sh.date < todayIST()) throw err(400, 'That shift is in the past');
  const to = await one('SELECT id FROM staff WHERE id=$1 AND business_id=$2 AND active', [to_staff_id, B(req)]);
  if (!to || to.id === S(req)) throw err(400, 'Pick a colleague');
  const open = await one("SELECT 1 FROM swap_requests WHERE shift_id=$1 AND status IN ('pending_colleague','pending_owner')", [sh.id]);
  if (open) throw err(400, 'There is already an open swap request for this shift');
  await q('INSERT INTO swap_requests (business_id, shift_id, from_staff_id, to_staff_id) VALUES ($1,$2,$3,$4)', [B(req), sh.id, S(req), to.id]);
  res.json({ ok: true });
}));
worker.post('/swaps/:id/:action', h(async (req, res) => {
  const a = req.params.action;
  if (!['accept', 'decline', 'cancel'].includes(a)) throw err(404, 'Unknown action');
  const sql = a === 'cancel'
    ? "UPDATE swap_requests SET status='cancelled' WHERE id=$1 AND from_staff_id=$2 AND status IN ('pending_colleague','pending_owner') RETURNING id"
    : `UPDATE swap_requests SET status='${a === 'accept' ? 'pending_owner' : 'declined'}' WHERE id=$1 AND to_staff_id=$2 AND status='pending_colleague' RETURNING id`;
  const row = await one(sql, [req.params.id, S(req)]);
  if (!row) throw err(404, 'Request not found or already handled');
  res.json({ ok: true });
}));
app.use('/api/worker', worker);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ---------------- Frontend ----------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api|mcp).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT) || 3000;
await migrate();
if (await seedIfEmpty()) console.log('Seeded demo café');
app.listen(port, () => console.log(`RostaPay listening on :${port}`));
