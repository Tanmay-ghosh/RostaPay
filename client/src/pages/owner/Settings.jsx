import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { post, put } from '../../api.js';
import { useLoad, useToast } from '../../hooks.js';
import { Spinner, ErrorBox, DAY_NAMES } from '../../components.jsx';

export default function Settings() {
  const { data, error, reload } = useLoad('/api/owner/settings');
  const { me, refreshMe } = useOutletContext();
  const toast = useToast();
  const nav = useNavigate();
  const [f, setF] = useState(null);
  useEffect(() => { if (data) setF({ name: data.name, max_days_per_week: data.max_days_per_week ?? '', max_hours_per_day: data.max_hours_per_day ?? '', min_rest_hours: data.min_rest_hours ?? '', coverage: data.coverage.map(({ id, ...c }) => c) }); }, [data]);
  if (error) return <ErrorBox error={error} />;
  if (!data || !f) return <Spinner />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => { try { await put('/api/owner/settings', f); toast('Settings saved'); reload(); refreshMe(); } catch (e) { toast(e.message, true); } };
  const copy = (t) => { navigator.clipboard?.writeText(t); toast('Copied'); };
  const setCov = (i, k, v) => setF({ ...f, coverage: f.coverage.map((c, j) => (j === i ? { ...c, [k]: v } : c)) });

  return (
    <div>
      <div className="page-head"><div><h1>Settings</h1></div></div>

      <div className="card" style={{ borderColor: '#9fd3cb' }}>
        <h2>🔌 Connect your Claude</h2>
        <ol className="small" style={{ lineHeight: 1.7 }}>
          <li>In Claude, open <b>Settings → Connectors</b> and click <b>Add custom connector</b>.</li>
          <li>Name it <b>RostaPay</b> and paste this URL:</li>
        </ol>
        <div className="row"><div className="code grow">{data.mcp_url}</div><button className="secondary" onClick={() => copy(data.mcp_url)}>Copy</button></div>
        <ol className="small" start={3} style={{ lineHeight: 1.7 }}>
          <li>Click <b>Add</b>. Keep this link private.</li>
          <li>Turn on RostaPay in a new chat and send:</li>
        </ol>
        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}><div className="code grow" style={{ borderColor: '#9fd3cb', background: '#f2faf8' }}>“Check that you’re connected to RostaPay: show my business overview and tell me what’s already set up and what’s still missing.”</div><button onClick={() => copy('Check that you’re connected to RostaPay: show my business overview and tell me what’s already set up and what’s still missing.')}>Copy</button></div>
        <div className="row" style={{ margin: '.6rem 0' }}>
          {data.mcp_last_used_at
            ? <span className="pill green">✓ Connected · last used {new Date(data.mcp_last_used_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            : <span className="pill grey">Not connected</span>}
          <button className="ghost small" onClick={() => { reload(); toast('Refreshed'); }}>↻ Refresh</button>
        </div>
        <p className="small" style={{ margin: '.8rem 0 .4rem' }}><b>Then try:</b></p>
        <div className="stack">
          {[
            'Here is my café pay policy: ₹200/hr, ₹300/hr after 8 hours a day, ₹100 extra for shifts past 10pm, double pay on Diwali. Set it up in RostaPay and test a 10-hour shift.',
            'Add my staff to RostaPay: Ravi 9000000011 barista (evenings only), Priya 9000000012 barista, Arjun 9000000013 cook (off Wednesdays).',
            "Make next week's roster in RostaPay. Weekdays need 2 people from 8am to 11pm, weekends 3. Nobody works more than 6 days.",
            'How much did I spend on staff last week in RostaPay, and who did the most overtime?',
          ].map((t) => <div key={t} className="row" style={{ alignItems: 'flex-start' }}><div className="code grow">“{t}”</div><button className="ghost" onClick={() => copy(t)}>Copy</button></div>)}
        </div>
        <div className="row" style={{ marginTop: '.8rem' }}>
          <button className="ghost" onClick={async () => { if (confirm('Create a new link? The old one stops working and you must update it in Claude.')) { await post('/api/owner/settings/regenerate-key'); reload(); toast('New link created'); } }}>Regenerate link</button>
        </div>
      </div>

      <div className="card">
        <h2>Business & roster rules</h2>
        <div className="grid2">
          <div className="field"><label>Business name</label><input value={f.name} onChange={set('name')} /></div>
          <div className="grid3">
            <div className="field"><label>Max days / week</label><input type="number" value={f.max_days_per_week} onChange={set('max_days_per_week')} /></div>
            <div className="field"><label>Max hours / day</label><input type="number" value={f.max_hours_per_day} onChange={set('max_hours_per_day')} /></div>
            <div className="field"><label>Min rest (h)</label><input type="number" value={f.min_rest_hours} onChange={set('min_rest_hours')} /></div>
          </div>
        </div>
        <h3>Staff needed on shift</h3>
        {f.coverage.length === 0 && <p className="small muted">None</p>}
        {f.coverage.map((c, i) => (
          <div className="row" key={i} style={{ marginBottom: 6, flexWrap: 'nowrap' }}>
            <select value={c.weekday} onChange={(e) => setCov(i, 'weekday', Number(e.target.value))} style={{ width: 90 }}>{[1, 2, 3, 4, 5, 6, 0].map((d) => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}</select>
            <input type="time" value={c.start_time} onChange={(e) => setCov(i, 'start_time', e.target.value)} style={{ width: 140 }} />
            <input type="time" value={c.end_time} onChange={(e) => setCov(i, 'end_time', e.target.value)} style={{ width: 140 }} />
            <input type="number" min="1" value={c.min_staff} onChange={(e) => setCov(i, 'min_staff', Number(e.target.value))} style={{ width: 70 }} title="Minimum staff" />
            <input value={c.role || ''} onChange={(e) => setCov(i, 'role', e.target.value)} placeholder="any role" style={{ width: 140 }} />
            <button className="ghost" onClick={() => setF({ ...f, coverage: f.coverage.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 8 }}>
          <button className="secondary" onClick={() => setF({ ...f, coverage: [...f.coverage, { weekday: 1, start_time: '09:00', end_time: '21:00', min_staff: 2, role: '' }] })}>+ Add coverage row</button>
          <div className="grow" />
          <button onClick={save}>Save settings</button>
        </div>
      </div>

      {me.is_demo && (
        <div className="card">
          <h3>Demo data</h3>
          <p className="small muted">Restore Brew & Bites Café to its original data.</p>
          <button className="danger" onClick={async () => { if (confirm('Reset all demo data?')) { await post('/api/owner/reset-demo'); toast('Demo reset'); nav('/owner/roster'); refreshMe(); } }}>Reset demo data</button>
        </div>
      )}
    </div>
  );
}
