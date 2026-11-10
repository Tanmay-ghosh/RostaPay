import { describe, it, expect } from 'vitest';
import { computePay, describeRule } from '../server/lib/payEngine.js';
import { checkRoster } from '../server/lib/rosterChecks.js';

const rules = [
  { id: 'base', name: 'Base rate', kind: 'rate', priority: 1, conditions: {}, effect: { rate_per_hour: 200 } },
  { id: 'ot', name: 'Overtime', kind: 'rate', priority: 2, conditions: { daily_hours_over: 8 }, effect: { rate_per_hour: 300 } },
  { id: 'night', name: 'Night allowance', kind: 'addon', priority: 3, conditions: { time_window: { start: '22:00', end: '06:00' } }, effect: { flat_amount: 100 } },
  { id: 'diwali', name: 'Diwali double pay', kind: 'override', priority: 10, conditions: { dates: ['2026-11-08'] }, effect: { multiplier: 2 } },
];
const staff = { id: 's1', role: 'barista' };
const one = (date, start, end, extra = {}) => computePay({ rules, staff, logs: [{ id: 'l', date, start, end, break_minutes: 0, ...extra }] });

describe('pay engine', () => {
  it('10h normal Tuesday → 8×200 + 2×300', () => {
    const r = one('2026-11-10', '09:00', '19:00');
    expect(r.total).toBe(2200);
    expect(r.lines.map((l) => l.label)).toEqual(['8h × ₹200', '2h × ₹300']);
  });
  it('16:00–01:00 → 8×200 + 1×300 + ₹100 night', () => {
    expect(one('2026-11-10', '16:00', '01:00').total).toBe(2000);
  });
  it('Diwali 09–17 → 8×400', () => {
    expect(one('2026-11-08', '09:00', '17:00').total).toBe(3200);
  });
  it('break minutes reduce paid time', () => {
    expect(one('2026-11-10', '09:00', '17:30', { break_minutes: 30 }).total).toBe(1600);
  });
  it('overtime counts across two shifts on the same day', () => {
    const r = computePay({ rules, staff, logs: [
      { id: 'a', date: '2026-11-10', start: '08:00', end: '13:00' },
      { id: 'b', date: '2026-11-10', start: '15:00', end: '20:00' },
    ] });
    expect(r.total).toBe(8 * 200 + 2 * 300);
  });
  it('weekly overtime, multiplier addon, deduction, minimum hours, weekly cap, role filter, JSON logic', () => {
    const r2 = [
      { id: 'base', name: 'Base', kind: 'rate', priority: 1, conditions: {}, effect: { rate_per_hour: 100 } },
      { id: 'wk', name: 'Weekly OT', kind: 'addon', priority: 2, conditions: { weekly_hours_over: 10 }, effect: { multiplier: 1.5 } },
      { id: 'cook', name: 'Cook Sunday', kind: 'addon', priority: 2, conditions: { roles: ['cook'], days_of_week: [0] }, effect: { extra_per_hour: 20 } },
      { id: 'min', name: 'Min 4h', kind: 'addon', priority: 2, conditions: {}, effect: { minimum_paid_hours: 4 } },
      { id: 'late', name: 'Weekend bonus', kind: 'addon', priority: 2, conditions: { expression: { in: [{ var: 'day_of_week' }, [0, 6]] } }, effect: { flat_amount: 300, weekly_cap: 500 } },
      { id: 'man', name: 'Sales bonus', kind: 'manual', priority: 0, conditions: {}, effect: {}, source_text: '₹500 if sales > 1L' },
    ];
    const r = computePay({ rules: r2, staff: { id: 'x', role: 'cook' }, logs: [
      { id: '1', date: '2026-11-14', start: '10:00', end: '18:00' }, // Sat 8h → 800 + 300 flat
      { id: '2', date: '2026-11-15', start: '10:00', end: '16:00' }, // Sun 6h: 2h base, 4h base+50% (after 10h week); +20/h ×6 cook; flat capped at 200
      { id: '3', date: '2026-11-16', start: '10:00', end: '12:00' }, // Mon 2h → min 4h top-up of 2h at 100; weekly OT 2h
    ] });
    // Sat: 800 + 300 = 1100
    // Sun: 600 + 4h×50=200 + 6h×20=120 + flat 300 capped to 200 → 1120
    // Mon: 200 + 2h×50=100 + min top-up 2h×100=200 → 500
    expect(r.total).toBe(1100 + 1120 + 500);
    expect(r.manual_rules).toHaveLength(1);
  });
  it('override with fixed rate', () => {
    const r = computePay({ rules: [rules[0], { id: 'h', name: 'Holiday', kind: 'override', priority: 9, conditions: { dates: ['2026-01-26'] }, effect: { rate_per_hour: 500 } }], staff, logs: [{ id: 'z', date: '2026-01-26', start: '10:00', end: '12:00' }] });
    expect(r.total).toBe(1000);
  });
  it('describes rules', () => {
    expect(describeRule(rules[1])).toBe('₹300/hr for hours beyond 8h in a day');
  });
});

describe('roster checks', () => {
  it('flags coverage, availability, unavailable, overlap, max days', () => {
    const staff = [{ id: 'a', name: 'Ravi', role: 'barista' }, { id: 'b', name: 'Priya', role: 'barista' }];
    const shifts = [
      { id: '1', staff_id: 'a', date: '2026-11-09', start_time: '08:00', end_time: '16:00' },
      { id: '2', staff_id: 'a', date: '2026-11-09', start_time: '15:00', end_time: '20:00' },
      { id: '3', staff_id: 'b', date: '2026-11-10', start_time: '08:00', end_time: '16:00' },
    ];
    const v = checkRoster({
      weekStart: '2026-11-09', staff, shifts,
      availability: [{ staff_id: 'a', weekday: 1, start_time: '12:00', end_time: '23:00' }],
      unavailable: [{ staff_id: 'b', date: '2026-11-10', reason: 'exam' }],
      coverage: [{ weekday: 1, start_time: '08:00', end_time: '12:00', min_staff: 2 }],
      constraints: { max_days_per_week: 6 },
    });
    const types = v.map((x) => x.type).sort();
    expect(types).toEqual(['availability', 'coverage', 'overlap', 'unavailable']);
  });
});

describe('roles', () => {
  const rr = [
    { id: 'b', name: 'Base', kind: 'rate', priority: 1, conditions: {}, effect: { rate_per_hour: 200 } },
    { id: 'c', name: 'Cook bonus', kind: 'addon', priority: 2, conditions: { roles: ['cook'] }, effect: { extra_per_hour: 30 } },
  ];
  it('pays for the job done on the shift, not the main role', () => {
    const cashierCovering = computePay({ rules: rr, staff: { id: 'p', role: 'cashier' }, logs: [{ id: '1', date: '2026-11-10', start: '10:00', end: '14:00', role: 'cook' }] });
    expect(cashierCovering.total).toBe(4 * 230);
    const cookOnTill = computePay({ rules: rr, staff: { id: 'a', role: 'cook' }, logs: [{ id: '2', date: '2026-11-10', start: '10:00', end: '14:00', role: 'cashier' }] });
    expect(cookOnTill.total).toBe(4 * 200);
  });
  it('flags a job outside the person\'s skills', () => {
    const v = checkRoster({ weekStart: '2026-11-09', staff: [{ id: 'p', name: 'Priya', role: 'cashier', skills: ['barista'] }],
      shifts: [{ id: 's', staff_id: 'p', date: '2026-11-10', start_time: '10:00', end_time: '14:00', role: 'cook' }, { id: 't', staff_id: 'p', date: '2026-11-11', start_time: '10:00', end_time: '14:00', role: 'Barista' }] });
    expect(v.map((x) => x.type)).toEqual(['skill']);
  });
});
