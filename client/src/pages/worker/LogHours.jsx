import { useState } from 'react';
import { post } from '../../api.js';
import { useLoad, useToast } from '../../hooks.js';
import { Spinner, ErrorBox, niceDate, fmtHours } from '../../components.jsx';
import { shiftDuration } from '../../../../server/lib/time.js';

export default function LogHours() {
  const { data, error, reload } = useLoad('/api/worker/logs');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const todo = data.filter((s) => !s.status || s.status === 'rejected');
  const done = data.filter((s) => s.status === 'pending' || s.status === 'approved');
  return (
    <div>
      <h2>Log my hours</h2>
      <p className="small muted" style={{ marginTop: 0 }}>Enter the time you actually started and finished. Your manager approves it, then it counts towards your pay.</p>
      {todo.length === 0 && <div className="ok">All caught up — no shifts waiting for hours.</div>}
      {todo.map((s) => <LogCard key={s.shift_id} s={s} onSaved={reload} />)}
      {done.length > 0 && <h3 style={{ marginTop: '1.4rem' }}>Submitted</h3>}
      {done.map((s) => (
        <div className="card" key={s.shift_id} style={{ padding: '.7rem .9rem' }}>
          <div className="row between">
            <div><b>{niceDate(s.date)}</b><div className="small muted">Worked {s.actual_start}–{s.actual_end}{s.break_minutes ? ` · ${s.break_minutes}m break` : ''} · {fmtHours(shiftDuration(s.actual_start, s.actual_end) - s.break_minutes)}</div></div>
            <span className={`pill ${s.status === 'approved' ? 'green' : 'amber'}`}>{s.status === 'approved' ? '✓ Approved' : 'Waiting for approval'}</span>
          </div>
          {s.status === 'pending' && <LogCard s={s} onSaved={reload} compact />}
        </div>
      ))}
    </div>
  );
}

function LogCard({ s, onSaved, compact }) {
  const toast = useToast();
  const [open, setOpen] = useState(!compact);
  const [f, setF] = useState({ actual_start: s.actual_start || s.start_time, actual_end: s.actual_end || s.end_time, break_minutes: s.break_minutes || 0 });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await post('/api/worker/logs', { shift_id: s.shift_id, ...f }); toast('Hours sent to your manager'); onSaved(); } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  if (!open) return <button className="ghost small" onClick={() => setOpen(true)}>Change</button>;
  const worked = shiftDuration(f.actual_start, f.actual_end) - (Number(f.break_minutes) || 0);
  const body = (
    <>
      <div className="grid3" style={{ gridTemplateColumns: '1fr 1fr 90px', marginTop: compact ? 8 : 0 }}>
        <div className="field"><label>Started</label><input type="time" value={f.actual_start} onChange={(e) => setF({ ...f, actual_start: e.target.value })} style={{ fontSize: '1.05rem' }} /></div>
        <div className="field"><label>Finished</label><input type="time" value={f.actual_end} onChange={(e) => setF({ ...f, actual_end: e.target.value })} style={{ fontSize: '1.05rem' }} /></div>
        <div className="field"><label>Break (min)</label><input type="number" min="0" value={f.break_minutes} onChange={(e) => setF({ ...f, break_minutes: e.target.value })} /></div>
      </div>
      <button className="big" onClick={submit} disabled={busy}>Submit {fmtHours(worked)}</button>
    </>
  );
  if (compact) return body;
  return (
    <div className="card">
      <div className="row between"><b>{niceDate(s.date)}</b><span className="small muted">Rostered {s.start_time}–{s.end_time}</span></div>
      {s.status === 'rejected' && <div className="error small" style={{ margin: '.5rem 0' }}>Manager rejected these hours{s.owner_note ? `: “${s.owner_note}”` : ''}. Please correct and resubmit.</div>}
      <div style={{ marginTop: 8 }}>{body}</div>
    </div>
  );
}
