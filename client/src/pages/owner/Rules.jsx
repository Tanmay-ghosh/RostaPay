import { useEffect, useState } from 'react';
import { post, put, del, patch } from '../../api.js';
import { useLoad, useToast } from '../../hooks.js';
import { Modal, Spinner, ErrorBox, Breakdown, DAY_NAMES, todayIST, fmtHours } from '../../components.jsx';

const KIND_INFO = {
  rate: ['Hourly rate', 'Sets the rate for matching hours. Highest priority wins.'],
  addon: ['Add-on', 'Adds on top: extra per hour, multiplier, a flat amount per shift, a deduction or a minimum-hours top-up.'],
  override: ['Override', 'Replaces everything lower-priority for matching hours (e.g. festival double pay).'],
  manual: ['Manual', "Can't be calculated from hours (e.g. sales bonus). Listed on Payouts so you apply it by hand."],
};

export default function Rules() {
  const { data, error, reload } = useLoad('/api/owner/rules');
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const toggle = async (r) => { await patch(`/api/owner/rules/${r.id}/enabled`, { enabled: !r.enabled }); toast(r.enabled ? `"${r.name}" turned off` : `"${r.name}" turned on`); reload(); };
  return (
    <div>
      <div className="page-head">
        <div><h1>Pay rules</h1><p className="muted small">Your pay policy as exact rules. Claude writes them from your words; RostaPay applies them the same way every week.</p></div>
        <div className="row"><button className="secondary" onClick={() => reload()} title="Load rules Claude just changed">↻ Refresh</button>
        <button onClick={() => setEdit({ name: '', source_text: '', kind: 'rate', priority: 1, conditions: {}, effect: { rate_per_hour: 200 }, enabled: true })}>+ Add rule</button></div>
      </div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div>
          {data.length === 0 && <div className="notice">No rules yet. Paste your pay policy into Claude and say “set this up in RostaPay”.</div>}
          {data.map((r) => (
            <div className="card" key={r.id} style={{ opacity: r.enabled ? 1 : 0.55 }}>
              <div className="row between">
                <div className="row"><h3 style={{ margin: 0 }}>{r.name}</h3><span className={`pill ${r.kind === 'override' ? 'amber' : r.kind === 'manual' ? 'grey' : ''}`}>{KIND_INFO[r.kind][0]}</span><span className="tiny muted">priority {r.priority}</span></div>
                <label className="row small" style={{ margin: 0, color: 'var(--ink)' }}><input type="checkbox" checked={r.enabled} onChange={() => toggle(r)} /> on</label>
              </div>
              <p style={{ margin: '.5rem 0 .3rem', fontWeight: 600 }}>{r.summary}</p>
              {r.source_text && <p className="small muted" style={{ margin: 0 }}>“{r.source_text}”</p>}
              <div className="row" style={{ marginTop: 8 }}>
                <button className="secondary" onClick={() => setEdit(r)}>Edit</button>
                <button className="ghost" onClick={async () => { if (confirm(`Delete "${r.name}"?`)) { await del(`/api/owner/rules/${r.id}`); reload(); } }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
        <Tester version={data.map((r) => r.id + r.enabled).join()} />
      </div>
      {edit && <RuleModal init={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function Tester({ version }) {
  const { data: staff, reload: reloadStaff } = useLoad('/api/owner/staff');
  const [tick, setTick] = useState(0);
  const [f, setF] = useState({ staff_id: '', date: todayIST(), start_time: '14:00', end_time: '00:30', break_minutes: 0 });
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { if (staff?.length && !f.staff_id) setF((x) => ({ ...x, staff_id: staff[0].id })); }, [staff]);
  useEffect(() => {
    if (!f.date || !f.start_time || !f.end_time) return;
    const t = setTimeout(() => post('/api/owner/rules/test', f).then((r) => { setRes(r); setError(null); }).catch(setError), 250);
    return () => clearTimeout(t);
  }, [f, version, tick]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="card" style={{ position: 'sticky', top: 16, margin: 0 }}>
      <div className="row between"><h3 style={{ margin: 0 }}>🧪 Rule tester</h3><button className="ghost small" onClick={() => { reloadStaff(); setTick((x) => x + 1); }} title="Recalculate with the latest rules">↻ Refresh</button></div>
      <p className="small muted" style={{ marginTop: 0 }}>Try any shift and see exactly how it would be paid.</p>
      <div className="grid2">
        <div className="field"><label>Staff</label><select value={f.staff_id} onChange={set('staff_id')}>{(staff || []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}</select></div>
        <div className="field"><label>Date</label><input type="date" value={f.date} onChange={set('date')} /></div>
        <div className="field"><label>Start</label><input type="time" value={f.start_time} onChange={set('start_time')} /></div>
        <div className="field"><label>End</label><input type="time" value={f.end_time} onChange={set('end_time')} /></div>
        <div className="field"><label>Unpaid break (min)</label><input type="number" min="0" value={f.break_minutes} onChange={set('break_minutes')} /></div>
      </div>
      <ErrorBox error={error} />
      {res && <>
        <div className="small muted" style={{ marginBottom: 6 }}>{DAY_NAMES[new Date(f.date + 'T00:00:00Z').getUTCDay()]} · {fmtHours(res.worked_minutes)} worked</div>
        <Breakdown lines={res.lines} total={res.total} />
        {res.warnings.map((w, i) => <div key={i} className="notice small" style={{ marginTop: 6 }}>{w}</div>)}
        {res.manual_rules.length > 0 && <p className="tiny muted">Not included (manual): {res.manual_rules.map((m) => m.name).join(', ')}</p>}
      </>}
    </div>
  );
}

const csv = (a) => (a || []).join(', ');
const parseList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
const numOrUndef = (v) => (v === '' || v == null ? undefined : Number(v));

function RuleModal({ init, onClose, onSaved }) {
  const toast = useToast();
  const c0 = init.conditions || {};
  const e0 = init.effect || {};
  const effectKey0 = ['multiplier', 'extra_per_hour', 'flat_amount', 'deduction', 'minimum_paid_hours', 'rate_per_hour'].find((k) => e0[k] != null) || 'rate_per_hour';
  const [f, setF] = useState({
    name: init.name, source_text: init.source_text || '', kind: init.kind, priority: init.priority, enabled: init.enabled,
    tw_start: c0.time_window?.start || '', tw_end: c0.time_window?.end || '',
    days: c0.days_of_week || [], dates: csv(c0.dates), daily: c0.daily_hours_over ?? '', weekly: c0.weekly_hours_over ?? '',
    roles: csv(c0.roles), min_shift: c0.min_shift_hours ?? '', expression: c0.expression ? JSON.stringify(c0.expression) : '',
    effectKey: effectKey0, effectValue: e0[effectKey0] ?? '', cap: e0.weekly_cap ?? '', staff_ids: c0.staff_ids,
  });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const effectOptions = f.kind === 'rate' ? [['rate_per_hour', '₹ per hour']]
    : f.kind === 'override' ? [['multiplier', '× base rate'], ['rate_per_hour', '₹ per hour (fixed)']]
    : f.kind === 'addon' ? [['extra_per_hour', '+₹ per hour'], ['multiplier', '× base rate (adds the difference)'], ['flat_amount', '+₹ once per shift'], ['deduction', '−₹ once per shift'], ['minimum_paid_hours', 'Minimum paid hours per shift']]
    : [];
  const effectKey = effectOptions.some(([k]) => k === f.effectKey) ? f.effectKey : effectOptions[0]?.[0];

  const save = async () => {
    try {
      let expression;
      if (f.expression.trim()) { try { expression = JSON.parse(f.expression); } catch { throw new Error('Custom formula must be valid JSON Logic'); } }
      const conditions = {
        ...(f.tw_start && f.tw_end ? { time_window: { start: f.tw_start, end: f.tw_end } } : {}),
        ...(f.days.length ? { days_of_week: f.days } : {}),
        ...(parseList(f.dates).length ? { dates: parseList(f.dates) } : {}),
        ...(f.daily !== '' ? { daily_hours_over: Number(f.daily) } : {}),
        ...(f.weekly !== '' ? { weekly_hours_over: Number(f.weekly) } : {}),
        ...(parseList(f.roles).length ? { roles: parseList(f.roles) } : {}),
        ...(f.staff_ids?.length ? { staff_ids: f.staff_ids } : {}),
        ...(f.min_shift !== '' ? { min_shift_hours: Number(f.min_shift) } : {}),
        ...(expression ? { expression } : {}),
      };
      const effect = f.kind === 'manual' ? {} : { [effectKey]: numOrUndef(f.effectValue), ...(f.kind === 'addon' && f.cap !== '' ? { weekly_cap: Number(f.cap) } : {}) };
      const body = { name: f.name, source_text: f.source_text, kind: f.kind, priority: Number(f.priority) || 0, enabled: f.enabled, conditions, effect };
      if (init.id) await put(`/api/owner/rules/${init.id}`, body); else await post('/api/owner/rules', body);
      toast('Rule saved — check it in the tester');
      onSaved();
    } catch (e) { setError(e); }
  };
  const toggleDay = (d) => setF({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort() });

  return (
    <Modal title={init.id ? `Edit “${init.name}”` : 'New pay rule'} onClose={onClose} wide>
      <div className="grid2">
        <div className="field"><label>Name (shown on payslips)</label><input value={f.name} onChange={set('name')} placeholder="Overtime" /></div>
        <div className="grid2">
          <div className="field"><label>Type</label><select value={f.kind} onChange={set('kind')}>{Object.entries(KIND_INFO).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field"><label>Priority</label><input type="number" value={f.priority} onChange={set('priority')} /></div>
        </div>
      </div>
      <p className="tiny muted" style={{ marginTop: -6 }}>{KIND_INFO[f.kind][1]}</p>
      <div className="field"><label>In your words</label><textarea style={{ minHeight: 50 }} value={f.source_text} onChange={set('source_text')} placeholder="After 8 hours in a day, pay ₹300 per hour." /></div>

      {f.kind !== 'manual' && <>
        <h3 style={{ marginTop: '.6rem' }}>What it pays</h3>
        <div className="grid2">
          <div className="field"><label>Effect</label><select value={effectKey} onChange={(e) => setF({ ...f, effectKey: e.target.value })}>{effectOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field"><label>Value</label><input type="number" step="any" value={f.effectValue} onChange={set('effectValue')} /></div>
          {f.kind === 'addon' && <div className="field"><label>Weekly cap ₹ (optional)</label><input type="number" value={f.cap} onChange={set('cap')} /></div>}
        </div>

        <h3 style={{ marginTop: '.6rem' }}>When it applies <span className="tiny muted">(leave blank = always)</span></h3>
        <div className="grid2">
          <div className="field"><label>Clock window (e.g. night 22:00–06:00)</label><div className="row"><input type="time" value={f.tw_start} onChange={set('tw_start')} style={{ width: 'auto', flex: 1 }} /><span>–</span><input type="time" value={f.tw_end} onChange={set('tw_end')} style={{ width: 'auto', flex: 1 }} /></div></div>
          <div className="field"><label>Days of week</label><div className="row">{[1, 2, 3, 4, 5, 6, 0].map((d) => <button key={d} type="button" className={f.days.includes(d) ? '' : 'secondary'} style={{ padding: '.3rem .5rem' }} onClick={() => toggleDay(d)}>{DAY_NAMES[d]}</button>)}</div></div>
          <div className="field"><label>Hours beyond N in a day</label><input type="number" step="any" value={f.daily} onChange={set('daily')} placeholder="e.g. 8" /></div>
          <div className="field"><label>Hours beyond N in a week</label><input type="number" step="any" value={f.weekly} onChange={set('weekly')} placeholder="e.g. 48" /></div>
          <div className="field"><label>Specific dates (comma-separated)</label><input value={f.dates} onChange={set('dates')} placeholder="e.g. 2026-11-08, 2027-01-26" /></div>
          <div className="field"><label>Only these roles (comma-separated)</label><input value={f.roles} onChange={set('roles')} placeholder="e.g. cook" /></div>
          <div className="field"><label>Only shifts at least N hours</label><input type="number" step="any" value={f.min_shift} onChange={set('min_shift')} /></div>
          <div className="field"><label>Custom formula (JSON Logic, advanced)</label><input value={f.expression} onChange={set('expression')} placeholder='{">=":[{"var":"shift_start_hour"},20]}' /></div>
        </div>
      </>}
      <label className="row small" style={{ color: 'var(--ink)' }}><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Rule is on</label>
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: '.8rem' }}><button className="secondary" onClick={onClose}>Cancel</button><button onClick={save}>Save rule</button></div>
    </Modal>
  );
}
