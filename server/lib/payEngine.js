// RostaPay pay rule engine — plain deterministic code, no AI.
//
// A rule = { id, name, kind, priority, conditions, effect, enabled }
//   kind: 'rate' | 'addon' | 'override' | 'manual'
//   conditions (all optional, ALL must match):
//     time_window {start,end}  days_of_week [0-6]  dates [YYYY-MM-DD]
//     daily_hours_over N  weekly_hours_over N  roles []  staff_ids []
//     min_shift_hours N  expression (JSON Logic)
//   effect:
//     rate:     { rate_per_hour }
//     addon:    { multiplier } | { extra_per_hour } | { flat_amount } | { deduction } | { minimum_paid_hours }, optional weekly_cap
//     override: { multiplier } | { rate_per_hour }
//     manual:   none (listed for the owner to handle by hand)
import jsonLogic from 'json-logic-js';
import { toMinutes, addDays, dayOfWeek, fmtHours, fmtINR } from './time.js';

const MINUTE_CONDITIONS = ['time_window', 'days_of_week', 'dates', 'daily_hours_over', 'weekly_hours_over'];

function parseJSON(v) {
  if (v == null) return {};
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return {}; } }
  return v;
}

export function normalizeRule(r) {
  return {
    ...r,
    priority: Number(r.priority) || 0,
    conditions: parseJSON(r.conditions),
    effect: parseJSON(r.effect),
    enabled: r.enabled !== false,
  };
}

function hasMinuteConditions(c) {
  return MINUTE_CONDITIONS.some((k) => c[k] != null && !(Array.isArray(c[k]) && c[k].length === 0));
}

function inWindow(minuteOfDay, win) {
  const s = toMinutes(win.start), e = toMinutes(win.end);
  if (s === e) return true;
  return s < e ? minuteOfDay >= s && minuteOfDay < e : minuteOfDay >= s || minuteOfDay < e;
}

function shiftLevelMatch(rule, ctx) {
  const c = rule.conditions;
  if (c.roles?.length && !c.roles.map((x) => String(x).toLowerCase()).includes(String(ctx.role || '').toLowerCase())) return false;
  if (c.staff_ids?.length && !c.staff_ids.map(String).includes(String(ctx.staff_id))) return false;
  if (c.min_shift_hours != null && ctx.hours < Number(c.min_shift_hours)) return false;
  if (c.expression != null) {
    try { if (!jsonLogic.apply(c.expression, ctx)) return false; } catch { return false; }
  }
  return true;
}

function minuteMatch(rule, m) {
  const c = rule.conditions;
  if (c.days_of_week?.length && !c.days_of_week.map(Number).includes(m.dow)) return false;
  if (c.dates?.length && !c.dates.includes(m.date)) return false;
  if (c.time_window && !inWindow(m.minuteOfDay, c.time_window)) return false;
  if (c.daily_hours_over != null && m.dailyWorked < Number(c.daily_hours_over) * 60) return false;
  if (c.weekly_hours_over != null && m.weeklyWorked < Number(c.weekly_hours_over) * 60) return false;
  return true;
}

function pickTop(rules) {
  let best = null;
  for (const r of rules) if (!best || r.priority > best.priority) best = r;
  return best;
}

function lineLabel(l) {
  switch (l.type) {
    case 'hours': return `${fmtHours(l.minutes)} × ${fmtINR(l.rate)}`;
    case 'extra': return `${fmtHours(l.minutes)} × +${fmtINR(l.rate)}`;
    case 'minimum': return `${fmtHours(l.minutes)} × ${fmtINR(l.rate)} (minimum hours top-up)`;
    case 'flat': return `+${fmtINR(l.amount)}${l.count > 1 ? ` (${l.count} shifts)` : ''}`;
    case 'deduction': return `${fmtINR(l.amount)}${l.count > 1 ? ` (${l.count} shifts)` : ''}`;
    case 'cap': return `${fmtINR(l.amount)} (weekly cap)`;
    case 'unpriced': return `${fmtHours(l.minutes)} with no rate rule`;
    default: return fmtINR(l.amount);
  }
}

function finishLines(map) {
  return [...map.values()].map((l) => {
    const amount = Math.round(l.amount * 100) / 100;
    return { ...l, amount, label: lineLabel({ ...l, amount }) };
  });
}

function addLine(map, rule, type, rate, minutes, amount) {
  const key = `${rule ? rule.id : 'none'}|${type}|${rate}`;
  const cur = map.get(key) || { rule_id: rule ? rule.id : null, rule_name: rule ? rule.name : 'No rate rule', type, rate, minutes: 0, amount: 0, count: 0 };
  cur.minutes += minutes;
  cur.amount += amount;
  cur.count += 1;
  map.set(key, cur);
}

/**
 * Compute pay for one staff member for a set of worked shifts (usually one week, Mon–Sun).
 * logs: [{ id, date, start, end, break_minutes }]  start/end "HH:MM", end <= start means next day.
 * staff: { id, role }
 */
export function computePay({ rules: rawRules, staff, logs }) {
  const rules = rawRules.map(normalizeRule).filter((r) => r.enabled);
  const sorted = [...logs].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const dailyTotals = {}; // date -> minutes worked so far
  let weekly = 0;
  const capUsed = {}; // rule id -> amount used this week
  const weekLines = new Map();
  const shifts = [];
  const warnings = [];

  for (const log of sorted) {
    const s = toMinutes(log.start);
    let dur = toMinutes(log.end) - s;
    if (dur <= 0) dur += 1440;
    const worked = Math.max(0, dur - (Number(log.break_minutes) || 0));
    const dailyBefore = dailyTotals[log.date] || 0;
    const ctx = {
      hours: worked / 60,
      day_of_week: dayOfWeek(log.date),
      date: log.date,
      role: staff.role,
      staff_id: staff.id,
      shift_start_hour: Math.floor(s / 60),
      weekly_hours_so_far: weekly / 60,
      month_day: Number(log.date.slice(8, 10)),
    };
    const eligible = rules.filter((r) => r.kind !== 'manual' && shiftLevelMatch(r, ctx));
    const rateRules = eligible.filter((r) => r.kind === 'rate');
    const overrides = eligible.filter((r) => r.kind === 'override');
    const addons = eligible.filter((r) => r.kind === 'addon');
    const perMinuteAddons = addons.filter((r) => r.effect.multiplier != null || r.effect.extra_per_hour != null);
    const matchedAny = new Set();
    for (const r of addons) if (!hasMinuteConditions(r.conditions)) matchedAny.add(r.id);

    // per-minute accumulation: key -> {rule,type,rate,minutes}
    const acc = new Map();
    const bump = (rule, type, rate) => {
      const key = `${rule ? rule.id : 'none'}|${type}|${rate}`;
      const cur = acc.get(key) || { rule, type, rate, minutes: 0 };
      cur.minutes += 1;
      acc.set(key, cur);
    };
    let firstBase = null;

    for (let i = 0; i < worked; i++) {
      const abs = s + i;
      const date = addDays(log.date, Math.floor(abs / 1440));
      const m = { date, dow: dayOfWeek(date), minuteOfDay: abs % 1440, dailyWorked: dailyBefore + i, weeklyWorked: weekly + i };
      const rateRule = pickTop(rateRules.filter((r) => minuteMatch(r, m)));
      const base = rateRule ? Number(rateRule.effect.rate_per_hour) || 0 : 0;
      if (firstBase == null) firstBase = { rule: rateRule, base };
      const override = pickTop(overrides.filter((r) => minuteMatch(r, m)));
      let floor = -Infinity;
      if (override) {
        const rate = override.effect.rate_per_hour != null ? Number(override.effect.rate_per_hour) : base * Number(override.effect.multiplier ?? 1);
        bump(override, 'hours', rate);
        floor = override.priority;
      } else if (rateRule) {
        bump(rateRule, 'hours', base);
      } else {
        bump(null, 'unpriced', 0);
      }
      for (const a of addons) if (hasMinuteConditions(a.conditions) && minuteMatch(a, m)) matchedAny.add(a.id);
      for (const a of perMinuteAddons) {
        if (a.priority <= floor) continue;
        if (!minuteMatch(a, m)) continue;
        const extra = a.effect.multiplier != null ? base * (Number(a.effect.multiplier) - 1) : Number(a.effect.extra_per_hour);
        if (extra) bump(a, 'extra', extra);
      }
    }

    const shiftLines = new Map();
    const pushCapped = (rule, type, rate, minutes, amount) => {
      const cap = rule?.effect?.weekly_cap;
      if (cap != null && amount > 0) {
        const used = capUsed[rule.id] || 0;
        const allowed = Math.max(0, Math.min(amount, Number(cap) - used));
        capUsed[rule.id] = used + allowed;
        if (allowed < amount) {
          addLine(shiftLines, rule, type, rate, minutes, amount);
          addLine(shiftLines, rule, 'cap', 0, 0, allowed - amount);
          return;
        }
      }
      addLine(shiftLines, rule, type, rate, minutes, amount);
    };

    for (const a of acc.values()) {
      if (a.type === 'unpriced') { addLine(shiftLines, null, 'unpriced', 0, a.minutes, 0); continue; }
      pushCapped(a.rule, a.type, a.rate, a.minutes, (a.rate * a.minutes) / 60);
    }
    for (const a of addons) {
      if (!matchedAny.has(a.id)) continue;
      const e = a.effect;
      if (e.flat_amount != null) pushCapped(a, 'flat', 0, 0, Number(e.flat_amount));
      if (e.deduction != null) addLine(shiftLines, a, 'deduction', 0, 0, -Math.abs(Number(e.deduction)));
      if (e.minimum_paid_hours != null && worked < Number(e.minimum_paid_hours) * 60) {
        const base = firstBase?.base ?? Number(pickTop(rateRules)?.effect.rate_per_hour ?? 0);
        const missing = Number(e.minimum_paid_hours) * 60 - worked;
        pushCapped(a, 'minimum', base, missing, (base * missing) / 60);
      }
    }
    if ([...acc.values()].some((a) => a.type === 'unpriced')) warnings.push(`${log.date}: some hours matched no rate rule and are unpaid`);

    const lines = finishLines(shiftLines);
    const total = Math.round(lines.reduce((t, l) => t + l.amount, 0) * 100) / 100;
    shifts.push({ log_id: log.id, date: log.date, start: log.start, end: log.end, break_minutes: Number(log.break_minutes) || 0, worked_minutes: worked, lines, total });
    for (const l of shiftLines.values()) {
      const key = `${l.rule_id ?? 'none'}|${l.type}|${l.rate}`;
      const cur = weekLines.get(key) || { ...l, minutes: 0, amount: 0, count: 0 };
      cur.minutes += l.minutes; cur.amount += l.amount; cur.count += l.count;
      weekLines.set(key, cur);
    }
    dailyTotals[log.date] = dailyBefore + worked;
    weekly += worked;
  }

  const lines = finishLines(weekLines);
  const total = Math.round(lines.reduce((t, l) => t + l.amount, 0) * 100) / 100;
  const manual_rules = rules.filter((r) => r.kind === 'manual').map((r) => ({ id: r.id, name: r.name, source_text: r.source_text }));
  return { shifts, lines, total, worked_minutes: weekly, warnings, manual_rules };
}

// Readable one-line summary of a rule, for the UI and for Claude.
export function describeRule(raw) {
  const r = normalizeRule(raw);
  const c = r.conditions, e = r.effect;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const when = [];
  if (c.time_window) when.push(`between ${c.time_window.start}–${c.time_window.end}`);
  if (c.days_of_week?.length) when.push(`on ${c.days_of_week.map((d) => days[d]).join(', ')}`);
  if (c.dates?.length) when.push(`on ${c.dates.join(', ')}`);
  if (c.daily_hours_over != null) when.push(`for hours beyond ${c.daily_hours_over}h in a day`);
  if (c.weekly_hours_over != null) when.push(`for hours beyond ${c.weekly_hours_over}h in a week`);
  if (c.roles?.length) when.push(`for ${c.roles.join('/')}`);
  if (c.staff_ids?.length) when.push(`for ${c.staff_ids.length} specific staff`);
  if (c.min_shift_hours != null) when.push(`on shifts of ${c.min_shift_hours}h+`);
  if (c.expression != null) when.push(`when custom formula is true`);
  let what = '';
  if (r.kind === 'manual') what = 'Handled manually by the owner';
  else if (e.rate_per_hour != null) what = `${fmtINR(Number(e.rate_per_hour))}/hr`;
  else if (e.multiplier != null) what = r.kind === 'override' ? `${e.multiplier}× base rate (replaces other rules)` : `${e.multiplier}× base rate`;
  else if (e.extra_per_hour != null) what = `+${fmtINR(Number(e.extra_per_hour))}/hr extra`;
  else if (e.flat_amount != null) what = `+${fmtINR(Number(e.flat_amount))} per shift`;
  else if (e.deduction != null) what = `−${fmtINR(Math.abs(Number(e.deduction)))} per shift`;
  else if (e.minimum_paid_hours != null) what = `pay at least ${e.minimum_paid_hours}h per shift`;
  if (r.kind === 'override' && e.rate_per_hour != null) what += ' (replaces other rules)';
  if (e.weekly_cap != null) what += `, capped at ${fmtINR(Number(e.weekly_cap))}/week`;
  return `${what}${when.length ? ' ' + when.join(', ') : r.kind === 'rate' ? ' for all hours' : ''}`;
}
