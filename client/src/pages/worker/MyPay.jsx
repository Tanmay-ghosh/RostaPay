import { useState } from 'react';
import { useLoad } from '../../hooks.js';
import { WeekNav, Spinner, ErrorBox, Breakdown, fmtINR, fmtHours, niceDate, todayIST, weekStart, weekLabel } from '../../components.jsx';

export default function MyPay() {
  const [week, setWeek] = useState(weekStart(todayIST()));
  const { data, error } = useLoad(`/api/worker/pay?week=${week}`);
  const [open, setOpen] = useState(false);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  return (
    <div>
      <h2>My pay</h2>
      <WeekNav week={week} onChange={setWeek} />
      <div className="card" style={{ marginTop: '.8rem' }}>
        <div className="row between">
          <div>
            <div className="small muted">Approved pay for this week</div>
            <div className="big-total">{fmtINR(data.total)}</div>
            <div className="small muted">{fmtHours(data.worked_minutes)} approved</div>
          </div>
          {data.paid ? <span className="pill green">Paid {fmtINR(data.paid.total_amount)}</span> : <span className="pill grey">Not paid yet</span>}
        </div>
        {data.pending && <div className="notice small" style={{ marginTop: '.7rem' }}>{data.pending.count} shift{data.pending.count > 1 ? 's' : ''} waiting for approval — about <b>{fmtINR(data.pending.estimated_extra)}</b> more once approved.</div>}
        <h3 style={{ marginTop: '1rem' }}>How it's calculated</h3>
        <Breakdown lines={data.lines} adjustments={data.adjustments} total={data.total} />
        {data.shifts.length > 0 && <button className="ghost small" onClick={() => setOpen(!open)} style={{ marginTop: 6 }}>{open ? 'Hide' : 'Show'} each shift</button>}
        {open && data.shifts.map((s) => (
          <div key={s.log_id} style={{ marginTop: 8 }}>
            <div className="row between small"><b>{niceDate(s.date)} · {s.start}–{s.end}</b><b>{fmtINR(s.total)}</b></div>
            <div className="tiny muted">{s.lines.map((l) => `${l.rule_name}: ${l.label}`).join(' · ')}</div>
          </div>
        ))}
      </div>
      {data.history.length > 0 && (
        <div className="card">
          <h3>Payment history</h3>
          {data.history.map((h) => <div key={h.week_start} className="row between small" style={{ padding: '.3rem 0' }}><span>{weekLabel(h.week_start)}</span><b>{fmtINR(h.total_amount)}</b></div>)}
        </div>
      )}
    </div>
  );
}
