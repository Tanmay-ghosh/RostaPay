import { useEffect, useState } from 'react';
import { put } from '../../api.js';
import { useLoad, useToast } from '../../hooks.js';
import { Spinner, ErrorBox, AvailabilityEditor, UnavailableEditor } from '../../components.jsx';

export default function Availability() {
  const { data, error } = useLoad('/api/worker/availability');
  const toast = useToast();
  const [f, setF] = useState(null);
  useEffect(() => { if (data) setF({ availability: data.availability.map(({ weekday, start_time, end_time }) => ({ weekday, start_time, end_time })), unavailable_dates: data.unavailable_dates.map(({ date, reason }) => ({ date, reason })) }); }, [data]);
  if (error) return <ErrorBox error={error} />;
  if (!f) return <Spinner />;
  const save = async () => { try { await put('/api/worker/availability', f); toast('Saved — your manager will see this when making the roster'); } catch (e) { toast(e.message, true); } };
  return (
    <div>
      <h2>When can I work?</h2>
      <p className="small muted" style={{ marginTop: 0 }}>Your manager (and their Claude) use this to make the roster.</p>
      <div className="card"><h3>Every week</h3><AvailabilityEditor value={f.availability} onChange={(v) => setF({ ...f, availability: v })} /></div>
      <div className="card"><h3>Days off / leave</h3><UnavailableEditor value={f.unavailable_dates} onChange={(v) => setF({ ...f, unavailable_dates: v })} /></div>
      <button className="big" style={{ marginTop: '1rem' }} onClick={save}>Save</button>
    </div>
  );
}
