// Small, dependency-free date/time helpers. Dates are "YYYY-MM-DD" strings, times are "HH:MM".

export function toMinutes(hhmm) {
  if (typeof hhmm !== 'string' || !/^\d{1,2}:\d{2}$/.test(hhmm)) throw new Error(`Invalid time "${hhmm}" (use HH:MM)`);
  const [h, m] = hhmm.split(':').map(Number);
  if (h > 24 || m > 59 || (h === 24 && m !== 0)) throw new Error(`Invalid time "${hhmm}"`);
  return h * 60 + m;
}

export function fromMinutes(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// A real calendar date: rejects impossible days such as 2026-02-30 (which Date.parse silently rolls over).
export function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function assertDate(s) {
  if (!isDate(s)) throw new Error(`Invalid date "${s}" (use a real YYYY-MM-DD date)`);
  return s;
}

// Validates a shift's start/end (and optional break). Start = end is rejected: it would silently become a 24h shift.
// Use 00:00–24:00 if a full-day shift is really meant.
export function assertShiftTimes(start, end, breakMinutes = 0) {
  const s = toMinutes(start), e = toMinutes(end);
  if (s === e) throw new Error(`Start and end time are both ${start} — a shift needs a length (use 00:00–24:00 for a full day)`);
  const dur = e > s ? e - s : e + 1440 - s;
  const br = Number(breakMinutes) || 0;
  if (br < 0) throw new Error('Break minutes cannot be negative');
  if (br >= dur) throw new Error(`Break of ${br} min is as long as or longer than the ${dur} min shift`);
  return dur;
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 0 = Sunday ... 6 = Saturday
export function dayOfWeek(dateStr) {
  return new Date(dateStr + 'T00:00:00Z').getUTCDay();
}

// Monday of the week containing dateStr
export function weekStart(dateStr) {
  const dow = dayOfWeek(dateStr);
  return addDays(dateStr, dow === 0 ? -6 : 1 - dow);
}

export function weekDates(start) {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

// Today's date in India (the app's default timezone)
export function todayIST() {
  return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
}

// Duration in minutes of a shift; an end at or before the start means it ends the next day.
export function shiftDuration(start, end) {
  const s = toMinutes(start), e = toMinutes(end);
  return e > s ? e - s : e + 1440 - s;
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function fmtHours(minutes) {
  const h = minutes / 60;
  return (Number.isInteger(h) ? String(h) : h.toFixed(2).replace(/0$/, '')) + 'h';
}

export function fmtINR(amount) {
  const n = Math.round(amount * 100) / 100;
  const neg = n < 0;
  const s = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
  return (neg ? '−₹' : '₹') + s;
}
