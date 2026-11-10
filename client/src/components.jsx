import { useState } from 'react';
import { addDays, dayOfWeek, DAY_NAMES, fmtINR, fmtHours, todayIST, weekStart } from '../../server/lib/time.js';

export { addDays, dayOfWeek, DAY_NAMES, fmtINR, fmtHours, todayIST, weekStart };

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const niceDate = (d) => `${DAY_NAMES[dayOfWeek(d)]} ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
export const weekLabel = (start) => `${Number(start.slice(8))} ${MONTHS[Number(start.slice(5, 7)) - 1]} – ${niceDate(addDays(start, 6)).slice(4)}`;

export function Logo({ small }) {
  return (
    <span className="logo" style={small ? { fontSize: '1rem' } : undefined}>
      <span className="logo-mark">R</span>
      <span>Rosta<b>Pay</b></span>
    </span>
  );
}

export function Spinner() { return <div className="spinner">Loading…</div>; }

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="error">{error.message || String(error)}</div>;
}

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="row between"><h2>{title}</h2><button className="ghost" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

export function WeekNav({ week, onChange }) {
  const cur = weekStart(todayIST());
  return (
    <div className="row">
      <button className="secondary" onClick={() => onChange(addDays(week, -7))} aria-label="Previous week">←</button>
      <b style={{ minWidth: 150, textAlign: 'center' }}>{weekLabel(week)}</b>
      <button className="secondary" onClick={() => onChange(addDays(week, 7))} aria-label="Next week">→</button>
      {week !== cur && <button className="ghost" onClick={() => onChange(cur)}>This week</button>}
    </div>
  );
}

export function Breakdown({ lines = [], adjustments = [], total, compact }) {
  if (!lines.length && !adjustments.length) return <p className="muted small">No approved hours yet.</p>;
  return (
    <table className="breakdown">
      <tbody>
        {lines.map((l, i) => (
          <tr key={i}>
            <td><span className="rule">{l.rule_name}</span>{!compact && <br />}{compact ? ' · ' : ''}{l.label}</td>
            <td className="num">{fmtINR(l.amount)}</td>
          </tr>
        ))}
        {adjustments.map((a) => (
          <tr key={a.id}><td><span className="rule">Adjustment</span>{!compact && <br />}{compact ? ' · ' : ''}{a.description}</td><td className="num">{fmtINR(a.amount)}</td></tr>
        ))}
        {total != null && <tr className="total"><td>Total</td><td className="num">{fmtINR(total)}</td></tr>}
      </tbody>
    </table>
  );
}

// weekly availability editor: value = [{weekday,start_time,end_time}]
export function AvailabilityEditor({ value, onChange, self }) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const byDay = (d) => value.filter((a) => Number(a.weekday) === d);
  const setDay = (d, on) => {
    const rest = value.filter((a) => Number(a.weekday) !== d);
    onChange(on ? [...rest, { weekday: d, start_time: '08:00', end_time: '23:00' }] : rest);
  };
  const update = (d, k, v) => onChange(value.map((a) => (Number(a.weekday) === d ? { ...a, [k]: v } : a)));
  return (
    <div>
      {order.map((d) => {
        const w = byDay(d)[0];
        return (
          <div className="avail-row" key={d}>
            <b className="small">{DAY_NAMES[d]}</b>
            {w ? <input type="time" value={w.start_time} onChange={(e) => update(d, 'start_time', e.target.value)} /> : <span className="muted small">Not available</span>}
            {w ? <input type="time" value={w.end_time} onChange={(e) => update(d, 'end_time', e.target.value)} /> : <span />}
            <input type="checkbox" checked={!!w} onChange={(e) => setDay(d, e.target.checked)} title="Available this day" />
          </div>
        );
      })}
    </div>
  );
}

export function UnavailableEditor({ value, onChange }) {
  const [d, setD] = useState('');
  const [r, setR] = useState('');
  return (
    <div>
      {value.length === 0 && <p className="small muted">No days off marked.</p>}
      {value.map((u, i) => (
        <div className="row" key={i} style={{ marginBottom: 4 }}>
          <span className="pill grey">{niceDate(u.date)}</span>
          <span className="small muted grow">{u.reason}</span>
          <button className="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 6 }}>
        <input type="date" value={d} onChange={(e) => setD(e.target.value)} style={{ maxWidth: 170 }} />
        <input placeholder="Reason (optional)" value={r} onChange={(e) => setR(e.target.value)} className="grow" style={{ width: 'auto' }} />
        <button className="secondary" disabled={!d} onClick={() => { onChange([...value, { date: d, reason: r }]); setD(''); setR(''); }}>Add</button>
      </div>
    </div>
  );
}

// main role + "can also do" skills, lower-cased
export const skillsOf = (st) => [...new Set([st?.role, ...((st && Array.isArray(st.skills)) ? st.skills : [])].filter(Boolean).map((x) => String(x).trim().toLowerCase()))];

export function SkillsEditor({ value, onChange, mainRole }) {
  const [txt, setTxt] = useState('');
  const add = () => {
    const v = txt.trim().toLowerCase();
    if (v && !value.includes(v) && v !== String(mainRole || '').toLowerCase()) onChange([...value, v]);
    setTxt('');
  };
  return (
    <div>
      <div className="row" style={{ gap: '.35rem', marginBottom: value.length ? 6 : 0 }}>
        {value.map((s) => <span key={s} className="pill">{s} <button type="button" className="ghost" style={{ padding: 0, fontSize: '.75rem' }} onClick={() => onChange(value.filter((x) => x !== s))} aria-label={`Remove ${s}`}>✕</button></span>)}
      </div>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input value={txt} onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder="e.g. helper, cashier" />
        <button type="button" className="secondary" onClick={add} disabled={!txt.trim()}>Add</button>
      </div>
    </div>
  );
}
