import { useState } from 'react';
import { post } from '../../api.js';
import { useLoad, useToast } from '../../hooks.js';
import { Spinner, ErrorBox, niceDate, todayIST, weekStart, addDays } from '../../components.jsx';

const LABEL = { pending_colleague: ['Waiting for colleague', 'grey'], pending_owner: ['Waiting for manager', 'amber'], approved: ['Approved', 'green'], rejected: ['Manager said no', 'red'], declined: ['Declined', 'grey'], cancelled: ['Cancelled', 'grey'] };

export default function Swaps() {
  const thisWeek = weekStart(todayIST());
  const w1 = useLoad(`/api/worker/week?week=${thisWeek}`);
  const w2 = useLoad(`/api/worker/week?week=${addDays(thisWeek, 7)}`);
  const swaps = useLoad('/api/worker/swaps');
  const toast = useToast();
  const [f, setF] = useState({ shift_id: '', to_staff_id: '' });
  const err = w1.error || w2.error || swaps.error;
  if (err) return <ErrorBox error={err} />;
  if (!w1.data || !w2.data || !swaps.data) return <Spinner />;
  const today = todayIST();
  const upcoming = [...w1.data.my_shifts, ...w2.data.my_shifts].filter((s) => s.date >= today);
  const colleagues = w1.data.colleagues;
  const request = async () => {
    try { await post('/api/worker/swaps', f); toast('Request sent'); setF({ shift_id: '', to_staff_id: '' }); swaps.reload(); } catch (e) { toast(e.message, true); }
  };
  const act = async (s, a) => { try { await post(`/api/worker/swaps/${s.id}/${a}`); toast(a === 'accept' ? 'Accepted' : 'Done'); swaps.reload(); } catch (e) { toast(e.message, true); } };
  const incoming = swaps.data.filter((s) => !s.mine && s.status === 'pending_colleague');
  return (
    <div>
      <h2>Swap a shift</h2>
      {incoming.map((s) => (
        <div className="card" key={s.id} style={{ borderColor: 'var(--amber)' }}>
          <b>{s.from_name}</b> asks you to take <b>{niceDate(s.date)} {s.start_time}–{s.end_time}</b>
          <div className="row" style={{ marginTop: 8 }}><button onClick={() => act(s, 'accept')}>Accept</button><button className="secondary" onClick={() => act(s, 'decline')}>Decline</button></div>
        </div>
      ))}
      <div className="card">
        <h3>Ask a colleague</h3>
        <div className="field"><label>My shift</label><select value={f.shift_id} onChange={(e) => setF({ ...f, shift_id: e.target.value })}><option value="">Choose…</option>{upcoming.map((s) => <option key={s.id} value={s.id}>{niceDate(s.date)} · {s.start_time}–{s.end_time}</option>)}</select></div>
        <div className="field"><label>Who should take it</label><select value={f.to_staff_id} onChange={(e) => setF({ ...f, to_staff_id: e.target.value })}><option value="">Choose…</option>{colleagues.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.role})</option>)}</select></div>
        <button className="big" disabled={!f.shift_id || !f.to_staff_id} onClick={request}>Send request</button>
      </div>
      {swaps.data.length > 0 && <h3 style={{ marginTop: '1.2rem' }}>My requests</h3>}
      {swaps.data.filter((s) => s.mine || s.status !== 'pending_colleague').map((s) => (
        <div className="card" key={s.id} style={{ padding: '.7rem .9rem' }}>
          <div className="row between">
            <div className="small"><b>{niceDate(s.date)} {s.start_time}–{s.end_time}</b><br />{s.from_name} → {s.to_name}</div>
            <div className="row"><span className={`pill ${LABEL[s.status]?.[1]}`}>{LABEL[s.status]?.[0]}</span>{s.mine && ['pending_colleague', 'pending_owner'].includes(s.status) && <button className="ghost small" onClick={() => act(s, 'cancel')}>Cancel</button>}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
