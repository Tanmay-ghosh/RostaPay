// Demo data: Brew & Bites Café, Koramangala. Runs once, when the database has no businesses.
import bcrypt from 'bcryptjs';
import { one, q, tx } from './db.js';
import { addDays, todayIST, weekStart, weekDates } from './lib/time.js';

const STAFF = [
  { key: 'R', name: 'Ravi', phone: '9000000001', role: 'barista', skills: ['cashier'] },
  { key: 'P', name: 'Priya', phone: '9000000002', role: 'barista', skills: ['cashier'] },
  { key: 'A', name: 'Arjun', phone: '9000000003', role: 'cook', skills: ['helper'] },
  { key: 'M', name: 'Meena', phone: '9000000004', role: 'cashier', skills: ['barista'] },
  { key: 'S', name: 'Salim', phone: '9000000005', role: 'cook', skills: ['helper'] },
];

// Mon..Sun → list of [staffKey, start, end]
const PATTERN = [
  [['P', '08:00', '16:00'], ['A', '08:00', '16:00'], ['R', '15:00', '23:00'], ['M', '15:00', '23:00']],
  [['P', '08:00', '16:00'], ['S', '08:00', '16:00'], ['R', '15:00', '23:00'], ['A', '15:00', '23:00']],
  [['M', '08:00', '16:00'], ['S', '08:00', '16:00'], ['R', '15:00', '23:00'], ['P', '15:00', '23:00']],
  [['A', '08:00', '16:00'], ['M', '08:00', '16:00'], ['S', '15:00', '23:00'], ['P', '15:00', '23:00']],
  [['A', '08:00', '16:00'], ['M', '08:00', '16:00'], ['R', '13:00', '23:00'], ['S', '15:00', '23:00']],
  [['P', '08:00', '16:00'], ['M', '08:00', '16:00'], ['A', '11:00', '21:00'], ['R', '15:00', '23:00'], ['S', '15:00', '23:00']],
  [['P', '08:00', '16:00'], ['M', '08:00', '16:00'], ['A', '11:00', '21:00'], ['R', '15:00', '23:00'], ['S', '15:00', '23:00']],
];

// small real-life variations for logged hours: key "weekOffset|dayIndex|staffKey" → [start, end, break]
const VARIATIONS = {
  '-1|4|R': ['13:00', '23:45', 0], // Ravi stayed late on Friday → overtime
  '-1|0|M': ['15:10', '23:00', 0],
  '-1|2|S': ['08:00', '16:00', 30],
  '0|0|R': ['15:00', '23:30', 0],
};

export async function seedIfEmpty() {
  const existing = await one("SELECT 1 FROM owners WHERE email='demo@rostapay.app'");
  if (existing) return false;
  const today = todayIST();
  const thisWeek = weekStart(today);
  const lastWeek = addDays(thisWeek, -7);

  await tx(async (t) => {
    const biz = await t.one(`INSERT INTO businesses (name, max_days_per_week, max_hours_per_day, min_rest_hours)
      VALUES ('Brew & Bites Café, Koramangala', 6, 10, 10) RETURNING id`);
    const bid = biz.id;
    await t.q('INSERT INTO owners (business_id, name, email, password_hash) VALUES ($1,$2,$3,$4)',
      [bid, 'Café Owner', 'demo@rostapay.app', bcrypt.hashSync('RostaPay@2026', 10)]);

    const pin = bcrypt.hashSync('1234', 8);
    const ids = {};
    for (const s of STAFF) {
      const row = await t.one('INSERT INTO staff (business_id, name, phone, role, skills, pin_hash) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [bid, s.name, s.phone, s.role, JSON.stringify(s.skills), pin]);
      ids[s.key] = row.id;
      for (let wd = 0; wd < 7; wd++) {
        if (s.key === 'S' && wd === 1) continue; // Salim can't work Mondays
        const [a, b] = s.key === 'R' ? ['12:00', '23:59'] : ['08:00', '23:59'];
        await t.q('INSERT INTO availability (staff_id, weekday, start_time, end_time) VALUES ($1,$2,$3,$4)', [row.id, wd, a, b]);
      }
    }
    // Meena has an exam on Thursday this week (but the roster has her on — a flagged violation)
    await t.q('INSERT INTO unavailable_dates (staff_id, date, reason) VALUES ($1,$2,$3)', [ids.M, addDays(thisWeek, 3), 'College exam']);

    for (const wd of [1, 2, 3, 4, 5]) await t.q('INSERT INTO coverage_requirements (business_id, weekday, start_time, end_time, min_staff) VALUES ($1,$2,$3,$4,$5)', [bid, wd, '08:00', '23:00', 2]);
    for (const wd of [6, 0]) {
      await t.q('INSERT INTO coverage_requirements (business_id, weekday, start_time, end_time, min_staff) VALUES ($1,$2,$3,$4,$5)', [bid, wd, '08:00', '23:00', 2]);
      await t.q('INSERT INTO coverage_requirements (business_id, weekday, start_time, end_time, min_staff) VALUES ($1,$2,$3,$4,$5)', [bid, wd, '11:00', '21:00', 3]);
    }

    const rules = [
      ['Base rate', '₹200 per hour for everyone.', 1, 'rate', {}, { rate_per_hour: 200 }],
      ['Overtime', 'After 8 hours in a day, pay ₹300 per hour.', 2, 'rate', { daily_hours_over: 8 }, { rate_per_hour: 300 }],
      ['Night allowance', '₹100 extra for any shift that runs past 10pm.', 3, 'addon', { time_window: { start: '22:00', end: '06:00' } }, { flat_amount: 100 }],
      ['Sunday kitchen bonus', 'Cooks get ₹30 extra per hour on Sundays.', 3, 'addon', { roles: ['cook'], days_of_week: [0] }, { extra_per_hour: 30 }],
      ['Diwali double pay', 'Double pay on Diwali (8 Nov 2026).', 10, 'override', { dates: ['2026-11-08'] }, { multiplier: 2 }],
      ['Monthly sales bonus', '₹500 bonus to everyone if the café crosses ₹1 lakh in sales in a month.', 0, 'manual', {}, {}],
    ];
    for (const [name, src, pr, kind, c, e] of rules) {
      await t.q('INSERT INTO pay_rules (business_id, name, source_text, priority, kind, conditions, effect) VALUES ($1,$2,$3,$4,$5,$6,$7)', [bid, name, src, pr, kind, c, e]);
    }

    for (const [offset, start] of [[-1, lastWeek], [0, thisWeek]]) {
      const dates = weekDates(start);
      for (let d = 0; d < 7; d++) {
        for (const [k, s, e] of PATTERN[d]) {
          const sh = await t.one("INSERT INTO shifts (business_id, staff_id, date, start_time, end_time, role, status) VALUES ($1,$2,$3,$4,$5,$6,'published') RETURNING id",
            [bid, ids[k], dates[d], s, e, STAFF.find((x) => x.key === k).role]);
          if (dates[d] >= today) continue; // only past shifts have logged hours
          const [as, ae, br] = VARIATIONS[`${offset}|${d}|${k}`] || [s, e, 0];
          const status = offset < 0 ? 'approved' : 'pending';
          await t.q('INSERT INTO time_logs (business_id, shift_id, staff_id, date, actual_start, actual_end, break_minutes, status, approved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [bid, sh.id, ids[k], dates[d], as, ae, br, status, status === 'approved' ? new Date() : null]);
        }
      }
    }
    // An open swap request: Priya wants to give her Wednesday evening shift to Arjun (his day off), who has accepted.
    const wedP = await t.one("SELECT id FROM shifts WHERE business_id=$1 AND staff_id=$2 AND date=$3", [bid, ids.P, addDays(thisWeek, 2)]);
    await t.q("INSERT INTO swap_requests (business_id, shift_id, from_staff_id, to_staff_id, status) VALUES ($1,$2,$3,$4,'pending_owner')", [bid, wedP.id, ids.P, ids.A]);
  });
  return true;
}

// Wipes the demo café and recreates it (used by the "Reset demo data" button).
export async function resetDemo() {
  await q("DELETE FROM businesses WHERE id IN (SELECT business_id FROM owners WHERE email='demo@rostapay.app')");
  return seedIfEmpty();
}
