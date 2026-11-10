// Regression tests for the QA report of 10 Nov 2026 (defects D2–D10). D1, D6, D11 are covered by test/api.test.js.
import { describe, it, expect } from 'vitest';
import { computePay } from '../server/lib/payEngine.js';
import { checkRoster } from '../server/lib/rosterChecks.js';
import { suggestFixes } from '../server/lib/rosterFixes.js';
import { isDate, assertShiftTimes } from '../server/lib/time.js';

// Chai Point's rules
const rules = [
  { id: 'base', name: 'Base rate', kind: 'rate', priority: 1, conditions: {}, effect: { rate_per_hour: 200 } },
  { id: 'ot', name: 'Overtime', kind: 'rate', priority: 2, conditions: { daily_hours_over: 8 }, effect: { rate_per_hour: 300 } },
  { id: 'late', name: 'Late shift bonus', kind: 'addon', priority: 3, conditions: { time_window: { start: '22:00', end: '06:00' } }, effect: { flat_amount: 100 } },
  { id: 'hol', name: 'Public holiday double pay', kind: 'override', priority: 10, conditions: { dates: ['2027-01-26', '2027-08-15'] }, effect: { multiplier: 2 } },
];
const pay = (date, start, end, extra = {}, r = rules) => computePay({ rules: r, staff: { id: 's', role: 'cook' }, logs: [{ id: 'l', date, start, end, break_minutes: 0, ...extra }] });

// Chai Point's staff & availability (weekday 0=Sun)
const staff = [
  { id: 'ravi', name: 'Ravi Kumar', role: 'chai maker' },
  { id: 'priya', name: 'Priya Nair', role: 'cashier' },
  { id: 'arjun', name: 'Arjun Singh', role: 'cook' },
  { id: 'meena', name: 'Meena Das', role: 'chai maker' },
  { id: 'sahil', name: 'Sahil Verma', role: 'helper' },
];
const av = (id, days, s, e) => days.map((weekday) => ({ staff_id: id, weekday, start_time: s, end_time: e }));
const availability = [
  ...av('ravi', [1, 2, 3, 4, 5, 6], '07:00', '16:00'),
  ...av('priya', [0, 6], '07:00', '22:00'), ...av('priya', [1, 2, 4, 5], '12:00', '22:00'),
  ...av('arjun', [0, 2, 3, 4, 5, 6], '10:00', '22:00'),
  ...av('meena', [0, 1, 3, 4, 5, 6], '13:00', '22:00'),
  ...av('sahil', [0], '07:00', '14:00'), ...av('sahil', [1, 2, 3], '07:00', '22:00'), ...av('sahil', [5, 6], '17:00', '22:00'),
];
const constraints = { max_days_per_week: 6, max_hours_per_day: 10 };
const WEEK = '2027-03-01'; // Mon
const sh = (id, staff_id, date, start_time, end_time, role) => ({ id, staff_id, date, start_time, end_time, role: role ?? staff.find((s) => s.id === staff_id).role });
const run = (shifts, coverage = []) => {
  const ctx = { weekStart: WEEK, staff, shifts, availability, unavailable: [], coverage, constraints };
  return suggestFixes({ ...ctx, violations: checkRoster(ctx) });
};

describe('D2 — coverage advice when only partial covers exist', () => {
  it('Thu chai-maker gap 08–23 with Ravi and Meena free: offers partial covers, not "nobody is available"', () => {
    const v = run([sh('a', 'arjun', '2027-03-04', '12:00', '18:00')], [{ id: 'c', weekday: 4, start_time: '08:00', end_time: '23:00', min_staff: 1, role: 'chai maker' }]);
    const gap = v.find((x) => x.type === 'coverage' && x.role === 'chai maker');
    expect(gap.infeasible).toBeFalsy();
    const labels = gap.fixes.map((f) => f.label).join(' | ');
    expect(labels).toMatch(/Ravi 08:00–16:00/);
    expect(gap.fixes.every((f) => ['ravi', 'meena'].includes(f.staff_id))).toBe(true);
  });
  it('after applying Ravi 08–16, the remaining gap suggests Meena (extend/add), not "close early"', () => {
    const v = run([sh('r', 'ravi', '2027-03-04', '08:00', '16:00')], [{ id: 'c', weekday: 4, start_time: '08:00', end_time: '23:00', min_staff: 1, role: 'chai maker' }]);
    const gap = v.find((x) => x.type === 'coverage');
    expect(gap.message).toMatch(/16:00–23:00/);
    expect(gap.infeasible).toBeFalsy();
    expect(gap.fixes[0].staff_id).toBe('meena');
  });
  it('still reports a truly impossible slot (22:00–23:00, nobody available) as unfixable', () => {
    const v = run([sh('r', 'ravi', '2027-03-04', '08:00', '16:00'), sh('m', 'meena', '2027-03-04', '16:00', '22:00')], [{ id: 'c', weekday: 4, start_time: '08:00', end_time: '23:00', min_staff: 1, role: 'chai maker' }]);
    const gap = v.find((x) => x.type === 'coverage');
    expect(gap.message).toMatch(/22:00–23:00/);
    expect(gap.infeasible).toBe(true);
  });
});

describe('D3 — role override', () => {
  const cov = [{ id: 'c', weekday: 3, start_time: '10:00', end_time: '14:00', min_staff: 1, role: 'cook' }];
  it('a helper rostered as cook is flagged and does not count toward cook coverage', () => {
    const v = run([sh('s', 'sahil', '2027-03-03', '10:00', '14:00', 'cook')], cov);
    expect(v.some((x) => x.type === 'role' && /Sahil Verma is a helper but is rostered as cook/.test(x.message))).toBe(true);
    expect(v.some((x) => x.type === 'coverage' && x.role === 'cook')).toBe(true);
  });
  it('the role fix offers a real cook or keeping Sahil as helper', () => {
    const v = run([sh('s', 'sahil', '2027-03-03', '10:00', '14:00', 'cook')], cov);
    const labels = v.find((x) => x.type === 'role').fixes.map((f) => f.label);
    expect(labels).toContain('Give this shift to Arjun');
    expect(labels).toContain('Keep Sahil on it as helper');
    expect(labels.join()).not.toMatch(/Ravi|Priya|Meena/);
  });
  it('a correctly-labelled shift is not flagged', () => {
    const v = run([sh('a', 'arjun', '2027-03-03', '10:00', '14:00')], cov);
    expect(v).toEqual([]);
  });
});

describe('D4 / D9 — shift time validation', () => {
  it('rejects start = end instead of silently paying 24h', () => {
    expect(() => assertShiftTimes('10:00', '10:00')).toThrow(/needs a length/);
  });
  it('still allows overnight and a deliberate full day', () => {
    expect(assertShiftTimes('20:00', '02:00')).toBe(360);
    expect(assertShiftTimes('00:00', '24:00')).toBe(1440);
  });
  it('rejects a break as long as or longer than the shift', () => {
    expect(() => assertShiftTimes('09:00', '10:00', 120)).toThrow(/Break of 120 min/);
    expect(() => assertShiftTimes('09:00', '10:00', 60)).toThrow();
    expect(assertShiftTimes('09:00', '19:00', 60)).toBe(600);
  });
});

describe('D5 — holiday override suppresses lower-priority add-ons', () => {
  it('26 Jan 2027 14:00–23:00 → ₹3,800 (no late bonus on top of double pay)', () => {
    const r = pay('2027-01-26', '14:00', '23:00');
    expect(r.total).toBe(3800);
    expect(r.lines.some((l) => l.rule_name === 'Late shift bonus')).toBe(false);
  });
  it('a normal late shift still gets the bonus', () => {
    expect(pay('2026-11-18', '13:00', '23:00').total).toBe(2300);
  });
  it('overnight into the holiday: the late minutes before midnight still earn the bonus', () => {
    expect(pay('2027-01-25', '20:00', '02:00').total).toBe(4 * 200 + 2 * 400 + 100);
  });
  it('an owner who wants the bonus on holidays too can give it a higher priority', () => {
    const r2 = rules.map((r) => (r.id === 'late' ? { ...r, priority: 11 } : r));
    expect(pay('2027-01-26', '14:00', '23:00', {}, r2).total).toBe(3900);
  });
});

describe('D7 — suggested fixes respect roles', () => {
  it('cashier shift on Priya\'s day off is only offered to cashiers (none) or removed', () => {
    const v = run([sh('p', 'priya', '2027-03-03', '12:00', '16:00')]);
    const labels = v.find((x) => x.type === 'availability').fixes.map((f) => f.label);
    expect(labels.join()).not.toMatch(/Arjun|Ravi|Sahil|Meena/);
    expect(labels).toContain('Remove this shift');
  });
  it('chai-maker shift on Ravi\'s Sunday is not offered to a helper', () => {
    const v = run([sh('r', 'ravi', '2027-03-07', '13:00', '17:00')]);
    const labels = v.find((x) => x.type === 'availability').fixes.map((f) => f.label);
    expect(labels).not.toContain('Give this shift to Sahil');
    expect(labels).toContain('Give this shift to Meena');
  });
});

describe('D8 — impossible dates', () => {
  it('rejects 2026-02-30 and 2026-13-01, accepts 2028-02-29', () => {
    expect(isDate('2026-02-30')).toBe(false);
    expect(isDate('2026-13-01')).toBe(false);
    expect(isDate('2028-02-29')).toBe(true);
    expect(isDate('2027-03-01')).toBe(true);
  });
});

describe('D10 — overlapping shifts are not double-counted', () => {
  it('Arjun 10–15 and 14–20 = 10h of clock time: overlap flagged, no false "11h" violation', () => {
    const v = run([sh('a1', 'arjun', '2027-03-02', '10:00', '15:00'), sh('a2', 'arjun', '2027-03-02', '14:00', '20:00')]);
    expect(v.some((x) => x.type === 'overlap')).toBe(true);
    expect(v.some((x) => x.type === 'max_hours')).toBe(false);
  });
  it('genuinely over the limit is still flagged', () => {
    const v = run([sh('a1', 'arjun', '2027-03-02', '10:00', '15:00'), sh('a2', 'arjun', '2027-03-02', '15:30', '21:30')]);
    expect(v.find((x) => x.type === 'max_hours').message).toMatch(/11h/);
  });
});
