import { useState } from 'react';
import { post, put, del } from '../../api.js';
import { useLoad, useToast } from '../../hooks.js';
import { Modal, Spinner, ErrorBox, AvailabilityEditor, UnavailableEditor, SkillsEditor, DAY_NAMES, niceDate, todayIST } from '../../components.jsx';

export default function Staff() {
  const { data, error, reload } = useLoad('/api/owner/staff');
  const [edit, setEdit] = useState(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const today = todayIST();
  return (
    <div>
      <div className="page-head">
        <div><h1>Staff</h1></div>
        <button onClick={() => setEdit({ name: '', phone: '', role: '', skills: [], pin: '', availability: [], unavailable_dates: [] })}>+ Add staff</button>
      </div>
      {data.length === 0 && <div className="notice">No staff yet. Add them here, or ask Claude: “Add my staff to RostaPay: …”.</div>}
      <div className="grid3">
        {data.map((s) => {
          const upcomingOff = s.unavailable_dates.filter((u) => u.date >= today);
          return (
            <div className="card" key={s.id} style={{ margin: 0 }}>
              <div className="row between"><h3 style={{ margin: 0 }}>{s.name}</h3><span className="pill">{s.role || 'staff'}</span></div>
              {(s.skills || []).length > 0 && <div className="small" style={{ marginTop: 2 }}><b>Can also do:</b> {s.skills.join(', ')}</div>}
              <div className="small muted">📱 {s.phone} {s.has_pin ? '' : '· no PIN set'}</div>
              <div className="small" style={{ marginTop: 8 }}>
                <b>Available:</b>{' '}
                {s.availability.length === 0 ? <span className="muted">any time</span> :
                  [1, 2, 3, 4, 5, 6, 0].map((d) => { const a = s.availability.find((x) => Number(x.weekday) === d); return a ? `${DAY_NAMES[d]} ${a.start_time}–${a.end_time}` : null; }).filter(Boolean).join(' · ')}
              </div>
              {upcomingOff.length > 0 && <div className="small" style={{ marginTop: 6 }}><b>Days off:</b> {upcomingOff.map((u) => `${niceDate(u.date)}${u.reason ? ` (${u.reason})` : ''}`).join(', ')}</div>}
              <div className="row" style={{ marginTop: 10 }}><button className="secondary" onClick={() => setEdit({ ...s, pin: '' })}>Edit</button></div>
            </div>
          );
        })}
      </div>
      {edit && <StaffModal init={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function StaffModal({ init, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ name: init.name, phone: init.phone, role: init.role || '', skills: init.skills || [], pin: '', availability: init.availability.map(({ weekday, start_time, end_time }) => ({ weekday, start_time, end_time })), unavailable_dates: init.unavailable_dates.map(({ date, reason }) => ({ date, reason })) });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try {
      const body = { ...f, pin: f.pin || undefined };
      if (init.id) await put(`/api/owner/staff/${init.id}`, body); else await post('/api/owner/staff', body);
      toast(init.id ? 'Saved' : `${f.name} added`);
      onSaved();
    } catch (e) { setError(e); }
  };
  const remove = async () => {
    if (!confirm(`Remove ${init.name}?`)) return;
    await del(`/api/owner/staff/${init.id}`); toast('Removed'); onSaved();
  };
  return (
    <Modal title={init.id ? `Edit ${init.name}` : 'Add staff'} onClose={onClose} wide>
      <div className="grid2">
        <div>
          <div className="field"><label>Name</label><input value={f.name} onChange={set('name')} /></div>
          <div className="field"><label>Phone (login)</label><input inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="10-digit mobile" /></div>
          <div className="field"><label>Main role</label><input value={f.role} onChange={set('role')} placeholder="barista, cook, cashier…" /></div>
          <div className="field"><label>Can also do</label><SkillsEditor value={f.skills} mainRole={f.role} onChange={(v) => setF({ ...f, skills: v })} /></div>
          <div className="field"><label>{init.id ? 'Set a new PIN (optional)' : '4-digit PIN for their login'}</label><input inputMode="numeric" maxLength={4} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} placeholder="e.g. 4821" /></div>
          <label>Days off / leave</label>
          <UnavailableEditor value={f.unavailable_dates} onChange={(v) => setF({ ...f, unavailable_dates: v })} />
        </div>
        <div>
          <label>Weekly availability</label>
          <AvailabilityEditor value={f.availability} onChange={(v) => setF({ ...f, availability: v })} />
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="row between" style={{ marginTop: '.8rem' }}>
        {init.id ? <button className="danger" onClick={remove}>Remove</button> : <span />}
        <div className="row"><button className="secondary" onClick={onClose}>Cancel</button><button onClick={save}>Save</button></div>
      </div>
    </Modal>
  );
}
