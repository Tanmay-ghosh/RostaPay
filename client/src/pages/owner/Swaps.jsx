import { useOutletContext } from 'react-router-dom';
import { post } from '../../api.js';
import { useLoad, useToast } from '../../hooks.js';
import { Spinner, ErrorBox, niceDate } from '../../components.jsx';

const STATUS = { pending_colleague: ['Waiting for colleague', 'grey'], pending_owner: ['Needs your OK', 'amber'], approved: ['Approved', 'green'], rejected: ['Rejected', 'red'], declined: ['Colleague declined', 'grey'], cancelled: ['Cancelled', 'grey'] };

export default function Swaps() {
  const { data, error, reload } = useLoad('/api/owner/swaps');
  const { refreshMe } = useOutletContext();
  const toast = useToast();
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const act = async (s, a) => { try { await post(`/api/owner/swaps/${s.id}/${a}`); toast(a === 'approve' ? `Shift moved to ${s.to_name}` : 'Swap rejected'); reload(); refreshMe(); } catch (e) { toast(e.message, true); } };
  return (
    <div>
      <div className="page-head"><div><h1>Shift swaps</h1><p className="muted small">Staff ask a colleague to take a shift. Once the colleague accepts, you give the final OK and the roster updates for everyone.</p></div></div>
      {data.length === 0 ? <div className="card"><p className="muted" style={{ margin: 0 }}>No swap requests yet.</p></div> : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Shift</th><th>From → To</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id}>
                  <td><b>{niceDate(s.date)}</b> <span className="muted">{s.start_time}–{s.end_time}</span></td>
                  <td>{s.from_name} → <b>{s.to_name}</b></td>
                  <td><span className={`pill ${STATUS[s.status]?.[1]}`}>{STATUS[s.status]?.[0] || s.status}</span></td>
                  <td className="num">{s.status === 'pending_owner' && <div className="row" style={{ justifyContent: 'flex-end' }}><button className="ghost" style={{ color: 'var(--red)' }} onClick={() => act(s, 'reject')}>Reject</button><button onClick={() => act(s, 'approve')}>Approve swap</button></div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
