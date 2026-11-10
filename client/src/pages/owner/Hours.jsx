import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { post } from '../../api.js';
import { useLoad, useToast } from '../../hooks.js';
import { Spinner, ErrorBox, niceDate, fmtINR, fmtHours } from '../../components.jsx';
import { shiftDuration } from '../../../../server/lib/time.js';

export default function Hours() {
  const [status, setStatus] = useState('pending');
  const { data, error, reload } = useLoad(`/api/owner/hours?status=${status}`);
  const { refreshMe } = useOutletContext();
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  const done = (msg) => { toast(msg); setEditing(null); reload(); refreshMe(); };
  const approve = async (l, body = {}) => { try { await post(`/api/owner/hours/${l.id}/approve`, body); done(`Approved ${l.staff_name}'s hours`); } catch (e) { toast(e.message, true); } };
  const reject = async (l) => { const note = prompt(`Why are you rejecting ${l.staff_name}'s hours? (they'll see this)`); if (note == null) return; await post(`/api/owner/hours/${l.id}/reject`, { note }); done('Rejected — they can correct and resubmit'); };
  const approveAll = async () => { if (!confirm(`Approve all ${data.length} pending logs as submitted?`)) return; const r = await post('/api/owner/hours/approve-all'); done(`Approved ${r.approved} logs`); };

  return (
    <div>
      <div className="page-head">
        <div><h1>Hours</h1></div>
        {status === 'pending' && data?.length > 0 && <button onClick={approveAll}>Approve all ({data.length})</button>}
      </div>
      <div className="tabs" style={{ maxWidth: 420 }}>
        {['pending', 'approved', 'rejected'].map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}
      </div>
      <ErrorBox error={error} />
      {!data ? <Spinner /> : data.length === 0 ? <div className="card"><p className="muted" style={{ margin: 0 }}>{status === 'pending' ? 'Nothing to approve. 🎉' : 'Nothing here yet.'}</p></div> : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Staff</th><th>Shift</th><th>Rostered</th><th>Actually worked</th><th className="num">Hours</th><th className="num">Pay</th><th></th></tr></thead>
            <tbody>
              {data.map((l) => {
                const diff = l.scheduled_start && (l.actual_start !== l.scheduled_start || l.actual_end !== l.scheduled_end);
                const worked = shiftDuration(l.actual_start, l.actual_end) - l.break_minutes;
                const isEd = editing?.id === l.id;
                return (
                  <tr key={l.id}>
                    <td><b>{l.staff_name}</b><div className="tiny muted">{l.role}</div></td>
                    <td>{niceDate(l.date)}</td>
                    <td className="muted">{l.scheduled_start ? `${l.scheduled_start}–${l.scheduled_end}` : '—'}</td>
                    <td>
                      {isEd ? (
                        <div className="row" style={{ flexWrap: 'nowrap' }}>
                          <input type="time" value={editing.actual_start} onChange={(e) => setEditing({ ...editing, actual_start: e.target.value })} style={{ width: 110 }} />
                          <input type="time" value={editing.actual_end} onChange={(e) => setEditing({ ...editing, actual_end: e.target.value })} style={{ width: 110 }} />
                          <input type="number" min="0" value={editing.break_minutes} onChange={(e) => setEditing({ ...editing, break_minutes: Number(e.target.value) })} style={{ width: 70 }} title="Break minutes" />
                        </div>
                      ) : (
                        <>{l.actual_start}–{l.actual_end}{l.break_minutes ? <span className="muted small"> · {l.break_minutes}m break</span> : null} {diff && <span className="pill amber">changed</span>}</>
                      )}
                      {l.owner_note && <div className="tiny" style={{ color: 'var(--red)' }}>Note: {l.owner_note}</div>}
                    </td>
                    <td className="num">{fmtHours(worked)}</td>
                    <td className="num">{fmtINR(l.estimate)}</td>
                    <td className="num">
                      {status !== 'approved' && (isEd ? (
                        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="secondary" onClick={() => setEditing(null)}>Cancel</button><button onClick={() => approve(l, editing)}>Save & approve</button></div>
                      ) : (
                        <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          <button className="ghost" onClick={() => setEditing({ id: l.id, actual_start: l.actual_start, actual_end: l.actual_end, break_minutes: l.break_minutes })}>Edit</button>
                          {status === 'pending' && <button className="ghost" style={{ color: 'var(--red)' }} onClick={() => reject(l)}>Reject</button>}
                          <button onClick={() => approve(l)}>Approve</button>
                        </div>
                      ))}
                      {status === 'approved' && <span className="pill green">✓ approved</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
