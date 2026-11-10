import { useState } from 'react';
import { niceDate, dayOfWeek } from '../../components.jsx';
import { toMinutes, shiftDuration } from '../../../../server/lib/time.js';

// Day-by-time roster: one row per day, hours across, a bar per shift labelled with the person.
// A thin strip under each day shows staffing against the coverage rules (green = enough, red = short).
const COLORS = [
  ['#e0f2ef', '#0f766e'], ['#fdf0d5', '#92400e'], ['#e8eefc', '#3346a3'], ['#fbe7ef', '#a3245b'],
  ['#ece9fb', '#5b3fb5'], ['#e6f4e2', '#2f6b1f'], ['#fde9e1', '#b24314'], ['#e4f1f8', '#1c6488'],
];
const LANE_H = 34;

export default function RosterTimeline({ data, today, badShift, onEdit, onAdd, onMove }) {
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const colorOf = Object.fromEntries(data.staff.map((s, i) => [s.id, COLORS[i % COLORS.length]]));
  const first = (name) => (name || '').split(' ')[0];

  // visible hour range: cover all shifts and coverage rules, default 07:00–23:00
  let lo = 7 * 60, hi = 23 * 60;
  for (const s of data.shifts) { const a = toMinutes(s.start_time); lo = Math.min(lo, a); hi = Math.max(hi, a + shiftDuration(s.start_time, s.end_time)); }
  for (const c of data.coverage || []) { const a = toMinutes(c.start_time); lo = Math.min(lo, a); hi = Math.max(hi, a + shiftDuration(c.start_time, c.end_time)); }
  lo = Math.floor(lo / 60) * 60; hi = Math.ceil(hi / 60) * 60;
  const span = hi - lo;
  const pct = (m) => `${((m - lo) / span) * 100}%`;
  const hours = []; for (let m = lo; m <= hi; m += 60) hours.push(m);
  const hourLabel = (m) => { const h = Math.floor(m / 60) % 24; return h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`; };

  return (
    <div className="tl-wrap">
      <div className="tl">
        <div className="tl-head">
          <div className="tl-daycol" />
          <div className="tl-axis">
            {hours.map((m) => <span key={m} style={{ left: pct(m) }}>{hourLabel(m)}</span>)}
          </div>
        </div>
        {data.dates.map((date) => {
          const shifts = data.shifts.filter((s) => s.date === date).sort((a, b) => a.start_time.localeCompare(b.start_time));
          // stack overlapping shifts into lanes
          const lanes = [];
          const placed = shifts.map((s) => {
            const a = toMinutes(s.start_time), b = a + shiftDuration(s.start_time, s.end_time);
            let lane = lanes.findIndex((end) => end <= a);
            if (lane === -1) { lane = lanes.length; lanes.push(b); } else lanes[lane] = b;
            return { s, a, b, lane };
          });
          const height = Math.max(1, lanes.length) * LANE_H + 8;
          const cov = coverageStrip(date, data, lo, hi);
          return (
            <div key={date} className={`tl-row ${date === today ? 'today' : ''} ${over === date ? 'drop' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(date); }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); const sh = data.shifts.find((x) => x.id === dragId); if (sh && sh.date !== date) onMove(sh, date); }}>
              <div className="tl-daycol">
                <b>{niceDate(date).slice(0, 3)}</b> <span className="muted">{niceDate(date).slice(4)}</span>
                <div className="tiny muted">{shifts.length} shift{shifts.length === 1 ? '' : 's'}</div>
              </div>
              <div className="tl-track" style={{ height }}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  const m = lo + Math.floor(((e.clientX - r.left) / r.width) * span / 60) * 60;
                  onAdd(date, `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:00`);
                }}>
                {hours.map((m) => <div key={m} className="tl-grid" style={{ left: pct(m) }} />)}
                {placed.map(({ s, a, b, lane }) => {
                  const [bg, fg] = colorOf[s.staff_id] || COLORS[0];
                  const log = data.logs.find((l) => l.shift_id === s.id);
                  const bad = badShift.has(s.id);
                  return (
                    <div key={s.id} draggable onDragStart={(e) => { e.stopPropagation(); setDragId(s.id); }}
                      className={`tl-bar ${s.status === 'draft' ? 'draft' : ''} ${bad ? 'bad' : ''}`}
                      style={{ left: pct(a), width: `calc(${((b - a) / span) * 100}% - 3px)`, top: 4 + lane * LANE_H, background: bg, color: fg, borderColor: bad ? undefined : fg + '55' }}
                      onClick={(e) => { e.stopPropagation(); onEdit(s); }}
                      title={`${s.staff_name} · ${s.role ? s.role + ' · ' : ''}${s.start_time}–${s.end_time}${s.status === 'draft' ? ' · draft' : ''}${log ? ` · hours ${log.status}` : ''}`}>
                      <b>{first(s.staff_name)}</b>
                      <span>{s.start_time}–{s.end_time}</span>
                      {s.role && <span className="tl-role">{s.role}</span>}
                      {log && <span className="tl-tag">{log.status === 'approved' ? '✓' : log.status === 'pending' ? '⏱' : '✕'}</span>}
                    </div>
                  );
                })}
              </div>
              {cov.length > 0 && (
                <div className="tl-cov">
                  {cov.map((c, i) => (
                    <div key={i} className={c.ok ? 'cov-ok' : 'cov-short'} style={{ left: pct(c.a), width: `${((c.b - c.a) / span) * 100}%` }}
                      title={`${fmt(c.a)}–${fmt(c.b)}: ${c.have} on shift, need ${c.need}`} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="tl-legend tiny muted">
        {data.staff.map((s) => { const [bg, fg] = colorOf[s.id]; return <span key={s.id}><i style={{ background: bg, borderColor: fg }} />{first(s.name)}</span>; })}
        <span><i className="dash" />draft</span>
        <span><i className="cov cov-ok" />enough staff</span>
        <span><i className="cov cov-short" />short-staffed</span>
      </div>
    </div>
  );
}

const fmt = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// 15-minute slots merged into runs: who is on vs. how many the coverage rules ask for
function coverageStrip(date, data, lo, hi) {
  const reqs = (data.coverage || []).filter((c) => Number(c.weekday) === dayOfWeek(date));
  if (!reqs.length) return [];
  const shifts = data.shifts.filter((s) => s.date === date).map((s) => { const a = toMinutes(s.start_time); return [a, a + shiftDuration(s.start_time, s.end_time)]; });
  const runs = [];
  for (let t = lo; t < hi; t += 15) {
    const need = Math.max(0, ...reqs.map((c) => { const a = toMinutes(c.start_time), b = a + shiftDuration(c.start_time, c.end_time); return t >= a && t < b ? Number(c.min_staff) : 0; }));
    if (!need) continue;
    const have = shifts.filter(([a, b]) => t >= a && t < b).length;
    const ok = have >= need;
    const last = runs[runs.length - 1];
    if (last && last.b === t && last.ok === ok && last.need === need && last.have === have) last.b = t + 15;
    else runs.push({ a: t, b: t + 15, ok, need, have });
  }
  return runs;
}
