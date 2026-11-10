import { Fragment, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { post, put, del } from '../../api.js';
import { useLoad, useToast } from '../../hooks.js';
import { WeekNav, Modal, Spinner, ErrorBox, niceDate, DAY_NAMES, dayOfWeek, todayIST, weekStart, fmtHours } from '../../components.jsx';
import { shiftDuration } from '../../../../server/lib/time.js';
import GettingStarted from './GettingStarted.jsx';

export default function Roster() {
  const [sp, setSp] = useSearchParams();
  const week = weekStart(sp.get('week') || todayIST());
  const { data, error, reload } = useLoad(`/api/owner/roster?week=${week}`);
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const today = todayIST();
  const badShift = new Set(data.violations.filter((v) => v.shift_id).map((v) => v.shift_id));
  const hours = (sid) => data.shifts.filter((s) => s.staff_id === sid).reduce((t, s) => t + shiftDuration(s.start_time, s.end_time), 0);
  const isOff = (st, d) => st.unavailable_dates.some((u) => u.date === d) || (st.availability.length > 0 && !st.availability.some((a) => Number(a.weekday) === dayOfWeek(d)));

  const move = async (shift, staff_id, date) => {
    if (shift.staff_id === staff_id && shift.date === date) return;
    try {
      await put(`/api/owner/shifts/${shift.id}`, { staff_id, date, start_time: shift.start_time, end_time: shift.end_time, role: null, notes: shift.notes });
      toast(`Moved to ${data.staff.find((s) => s.id === staff_id)?.name}, ${niceDate(date)}`);
      reload();
    } catch (e) { toast(e.message, true); }
  };
  const publish = async () => {
    try { const r = await post('/api/owner/roster/publish', { week }); toast(`Published ${r.published} shifts — your team can see them now`); reload(); } catch (e) { toast(e.message, true); }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Roster</h1>
          <p className="muted small">Drafts from Claude appear in <span className="pill amber">amber</span>. Drag a shift to move it, click a cell to add one.</p>
        </div>
        <div className="row">
          <WeekNav week={week} onChange={(w) => setSp({ week: w })} />
          <button className="amber" onClick={publish} disabled={!data.draft_count}>Publish week{data.draft_count ? ` (${data.draft_count})` : ''}</button>
        </div>
      </div>

      <GettingStarted version={data.shifts.length + '|' + data.draft_count + '|' + data.staff.length} />

      {data.staff.length === 0 && (
        <div className="notice" style={{ marginBottom: '1rem' }}>No staff yet. Ask Claude to add your team, or add them on the <Link to="/owner/staff">Staff</Link> page.</div>
      )}

      <div className="roster-wrap">
        <div className="roster">
          <div className="hcell">Staff</div>
          {data.dates.map((d) => <div key={d} className={`hcell ${d === today ? 'today' : ''}`}>{niceDate(d)}</div>)}
          {data.staff.map((st) => <Fragment key={st.id}>{renderRow(st)}</Fragment>)}
        </div>
      </div>

      <div className="grid2" style={{ marginTop: '1rem' }}>
        <div className="card">
          <div className="row between"><h3>Checks</h3>{data.violations.length ? <span className="pill red">{data.violations.length} issue{data.violations.length > 1 ? 's' : ''}</span> : <span className="pill green">All good</span>}</div>
          {data.violations.length === 0 ? <p className="small muted">Coverage, availability, days off, max days/hours, overlaps and rest are all within your rules.</p> : (
            <ul className="violations small">{data.violations.map((v, i) => <li key={i}>{v.message}</li>)}</ul>
          )}
        </div>
        <div className="card">
          <h3>Let Claude draft it</h3>
          <p className="small muted">In Claude, try:</p>
          <div className="code">“Make next week's roster for my café using RostaPay. Keep everyone under 6 days and give Ravi evenings only.”</div>
          <p className="tiny muted" style={{ marginTop: 8 }}>Not connected yet? See <Link to="/owner/settings">Settings → Connect Claude</Link>.</p>
        </div>
      </div>

      {edit && <ShiftModal init={edit} staff={data.staff} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );

  function renderRow(st) {
    return (
      <>
        <div className="name"><b>{st.name}</b><span className="tiny muted">{st.role} · {fmtHours(hours(st.id))}</span></div>
        {data.dates.map((d) => {
          const shifts = data.shifts.filter((s) => s.staff_id === st.id && s.date === d);
          const key = `${st.id}|${d}`;
          return (
            <div key={d} className={`cell ${isOff(st, d) ? 'off' : ''} ${over === key ? 'drop' : ''}`}
              onClick={() => setEdit({ staff_id: st.id, date: d, start_time: '09:00', end_time: '17:00' })}
              onDragOver={(e) => { e.preventDefault(); setOver(key); }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); const sh = data.shifts.find((s) => s.id === dragId); if (sh) move(sh, st.id, d); }}>
              {shifts.map((s) => {
                const log = data.logs.find((l) => l.shift_id === s.id);
                return (
                  <div key={s.id} draggable className={`chip ${s.status === 'draft' ? 'draft' : ''} ${badShift.has(s.id) ? 'bad' : ''}`}
                    onDragStart={() => setDragId(s.id)} onClick={(e) => { e.stopPropagation(); setEdit(s); }}
                    title={badShift.has(s.id) ? data.violations.filter((v) => v.shift_id === s.id).map((v) => v.message).join('\n') : ''}>
                    {s.start_time}–{s.end_time}
                    <span className="sub">{s.status === 'draft' ? 'draft' : log ? (log.status === 'approved' ? '✓ hours approved' : log.status === 'pending' ? 'hours to approve' : 'hours rejected') : s.role}</span>
                  </div>
                );
              })}
              {shifts.length === 0 && <span className="add-hint">+ add</span>}
            </div>
          );
        })}
      </>
    );
  }
}

function ShiftModal({ init, staff, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ staff_id: init.staff_id, date: init.date, start_time: init.start_time, end_time: init.end_time, role: init.role || '', notes: init.notes || '' });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try {
      if (init.id) await put(`/api/owner/shifts/${init.id}`, f); else await post('/api/owner/shifts', f);
      toast(init.id ? 'Shift updated (saved as draft — publish when ready)' : 'Shift added as draft');
      onSaved();
    } catch (e) { setError(e); }
  };
  const remove = async () => {
    if (!confirm('Delete this shift?')) return;
    try { await del(`/api/owner/shifts/${init.id}`); toast('Shift deleted'); onSaved(); } catch (e) { setError(e); }
  };
  return (
    <Modal title={init.id ? 'Edit shift' : 'Add shift'} onClose={onClose}>
      <div className="grid2">
        <div className="field"><label>Staff</label><select value={f.staff_id} onChange={set('staff_id')}>{staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}</select></div>
        <div className="field"><label>Date</label><input type="date" value={f.date} onChange={set('date')} /></div>
        <div className="field"><label>Start</label><input type="time" value={f.start_time} onChange={set('start_time')} /></div>
        <div className="field"><label>End <span className="tiny">(earlier than start = next day)</span></label><input type="time" value={f.end_time} onChange={set('end_time')} /></div>
        <div className="field"><label>Role for this shift</label><input value={f.role} onChange={set('role')} placeholder="Default: their role" /></div>
        <div className="field"><label>Notes</label><input value={f.notes} onChange={set('notes')} /></div>
      </div>
      <p className="tiny muted">{DAY_NAMES[dayOfWeek(f.date)]} · {fmtHours(shiftDuration(f.start_time || '00:00', f.end_time || '00:00'))}</p>
      <ErrorBox error={error} />
      <div className="row between" style={{ marginTop: '.8rem' }}>
        {init.id ? <button className="danger" onClick={remove}>Delete</button> : <span />}
        <div className="row"><button className="secondary" onClick={onClose}>Cancel</button><button onClick={save}>Save</button></div>
      </div>
    </Modal>
  );
}
