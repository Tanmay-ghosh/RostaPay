import { Fragment, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { post, del } from '../../api.js';
import { useLoad, useToast } from '../../hooks.js';
import { WeekNav, Spinner, ErrorBox, Breakdown, Modal, fmtINR, fmtHours, niceDate, todayIST, weekStart } from '../../components.jsx';

export default function Payouts() {
  const [sp, setSp] = useSearchParams();
  const week = weekStart(sp.get('week') || todayIST());
  const { data, error, reload } = useLoad(`/api/owner/payouts?week=${week}`);
  const toast = useToast();
  const [open, setOpen] = useState(null);
  const [adj, setAdj] = useState(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const hours = data.rows.reduce((t, r) => t + r.worked_minutes, 0);
  const pendingCount = data.rows.reduce((t, r) => t + (r.pending?.count || 0), 0);
  const unpaid = data.rows.filter((r) => !r.paid && r.total > 0);
  const markPaid = async (r) => { await post('/api/owner/payouts/mark-paid', { staff_id: r.staff.id, week }); toast(`${r.staff.name} marked as paid ${fmtINR(r.total)}`); reload(); };
  const unmark = async (r) => { await post('/api/owner/payouts/unmark-paid', { staff_id: r.staff.id, week }); reload(); };

  return (
    <div>
      <div className="page-head">
        <div><h1>Payouts</h1><p className="muted small">Calculated from approved hours using your pay rules. Click a person to see every line.</p></div>
        <div className="row">
          <WeekNav week={week} onChange={(w) => setSp({ week: w })} />
          <a className="btn secondary" href={`/api/owner/payouts.csv?week=${week}`}>Export CSV</a>
        </div>
      </div>
      <div className="kpis">
        <div className="kpi"><div className="l">Total payroll this week</div><div className="v">{fmtINR(data.total)}</div></div>
        <div className="kpi"><div className="l">Approved hours</div><div className="v">{fmtHours(hours)}</div></div>
        <div className="kpi"><div className="l">Still to pay</div><div className="v">{fmtINR(unpaid.reduce((t, r) => t + r.total, 0))}</div></div>
        <div className="kpi"><div className="l">Hours awaiting approval</div><div className="v">{pendingCount}</div>{pendingCount > 0 && <Link className="small" to="/owner/hours">Review →</Link>}</div>
      </div>
      {data.manual_rules.length > 0 && (
        <div className="notice" style={{ marginBottom: '1rem' }}>
          <b>Manual rules to check this week:</b> {data.manual_rules.map((m) => `${m.name} — “${m.source_text}”`).join(' · ')}<br />
          <span className="small">Add these as adjustments for the people who qualify.</span>
        </div>
      )}
      {data.rows.length === 0 ? <div className="card"><p className="muted" style={{ margin: 0 }}>No approved hours this week yet.</p></div> : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Staff</th><th className="num">Hours</th><th>Highlights</th><th className="num">Total</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <Fragment key={r.staff.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(open === r.staff.id ? null : r.staff.id)}>
                    <td><b>{open === r.staff.id ? '▾' : '▸'} {r.staff.name}</b><div className="tiny muted">{r.staff.role}</div></td>
                    <td className="num">{fmtHours(r.worked_minutes)}</td>
                    <td className="small">{highlights(r.lines) || '—'}
                      {r.pending && <div className="tiny" style={{ color: '#92400e' }}>+{r.pending.count} log(s) pending ≈ {fmtINR(r.pending.estimated_extra)}</div>}</td>
                    <td className="num"><b>{fmtINR(r.total)}</b></td>
                    <td>{r.paid ? <span className="pill green">Paid {fmtINR(r.paid.total_amount)}</span> : <span className="pill grey">Unpaid</span>}
                      {r.paid && Math.abs(r.paid.total_amount - r.total) > 0.01 && <div className="tiny" style={{ color: 'var(--red)' }}>Changed since paid</div>}</td>
                    <td className="num" onClick={(e) => e.stopPropagation()}>
                      {r.paid ? <button className="ghost" onClick={() => unmark(r)}>Undo</button> : <button onClick={() => markPaid(r)} disabled={r.total <= 0}>Mark paid</button>}
                    </td>
                  </tr>
                  {open === r.staff.id && (
                    <tr key={r.staff.id + 'x'}><td colSpan={6} style={{ background: '#fbfaf7' }}>
                      <div className="grid2">
                        <div>
                          <h3>Week breakdown</h3>
                          <Breakdown lines={r.lines} adjustments={r.adjustments} total={r.total} />
                          <div className="row" style={{ marginTop: 8 }}>
                            <button className="secondary" onClick={() => setAdj({ staff: r.staff })}>+ Adjustment</button>
                            {r.adjustments.map((a) => <button key={a.id} className="ghost tiny" onClick={async () => { await del(`/api/owner/adjustments/${a.id}`); reload(); }}>Remove “{a.description}”</button>)}
                          </div>
                        </div>
                        <div>
                          <h3>By shift</h3>
                          {r.shifts.map((s) => (
                            <div key={s.log_id} style={{ marginBottom: 8 }}>
                              <div className="row between small"><b>{niceDate(s.date)} · {s.start}–{s.end}{s.break_minutes ? ` (−${s.break_minutes}m)` : ''}</b><b>{fmtINR(s.total)}</b></div>
                              <div className="tiny muted">{s.lines.map((l) => `${l.rule_name}: ${l.label}`).join(' · ')}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adj && <AdjustmentModal staff={adj.staff} week={week} onClose={() => setAdj(null)} onSaved={() => { setAdj(null); reload(); toast('Adjustment added'); }} />}
    </div>
  );
}

// every rule that paid something except the main hourly rate
function highlights(lines) {
  const main = [...lines].filter((l) => l.type === 'hours').sort((a, b) => b.minutes - a.minutes)[0];
  return [...new Set(lines.filter((l) => l !== main).map((l) => l.rule_name))].join(', ');
}

function AdjustmentModal({ staff, week, onClose, onSaved }) {
  const [f, setF] = useState({ description: '', amount: '' });
  const [error, setError] = useState(null);
  const save = async () => { try { await post('/api/owner/adjustments', { staff_id: staff.id, week, ...f }); onSaved(); } catch (e) { setError(e); } };
  return (
    <Modal title={`Adjustment for ${staff.name}`} onClose={onClose}>
      <div className="field"><label>What for</label><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Monthly sales bonus" /></div>
      <div className="field"><label>Amount ₹ (negative to deduct)</label><input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="secondary" onClick={onClose}>Cancel</button><button onClick={save}>Add</button></div>
    </Modal>
  );
}
