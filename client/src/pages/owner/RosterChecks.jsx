import { useState } from 'react';
import { Link } from 'react-router-dom';
import { post } from '../../api.js';
import { useToast } from '../../hooks.js';
import { weekLabel } from '../../components.jsx';

// Roster problems with one-click fixes. All suggestions are computed by RostaPay's own code
// (who is free, who is under their limits); problems no roster can solve are explained separately.
// "Mon 09/11 22:00–23:00: only 0…" → "22:00–23:00"
const gapRange = (v) => (v.message.split(' ')[2] || '').replace(/:$/, '');

export default function RosterChecks({ data, week, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const vs = data.violations;

  const apply = async (fixes, msg) => {
    setBusy(true);
    try {
      for (const fix of fixes) await post('/api/owner/roster/fix', { fix });
      toast(msg || 'Fix applied');
      onChanged();
    } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };

  if (!vs.length) {
    return (
      <div className="card" style={{ marginTop: '1rem' }}>
        <div className="row between"><h3 style={{ margin: 0 }}>Checks</h3><span className="pill green">All good</span></div>
      </div>
    );
  }

  const fixable = vs.filter((v) => !v.infeasible);
  const infeasible = vs.filter((v) => v.infeasible);
  // group "can't be fixed by any roster" problems that share the same rule change (e.g. close at 22:00 every day)
  const groups = {};
  for (const v of infeasible) {
    const f = (v.fixes || [])[0];
    const key = f?.group || v.message;
    (groups[key] ||= { why: v.why, note: v.note, items: [], fixes: [] });
    groups[key].items.push(v);
    if (f) groups[key].fixes.push(f);
  }
  const claudePrompt = `In RostaPay, the roster for the week of ${weekLabel(week)} has these problems:\n${vs.map((v) => `- ${v.message}`).join('\n')}\nFix what you can by changing shifts. For anything no roster can fix, explain why and tell me my options.`;

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div className="row between">
        <h3 style={{ margin: 0 }}>Checks</h3>
        <span className="pill red">{vs.length} issue{vs.length > 1 ? 's' : ''}</span>
      </div>

      {fixable.length > 0 && (
        <div className="fix-section">
          <div className="fix-title">Suggested fixes</div>
          {fixable.map((v, i) => (
            <div className="fix-item" key={i}>
              <div className="small"><b>{v.message}</b></div>
              {v.why && <div className="tiny muted">{v.why}</div>}
              <div className="row" style={{ marginTop: 6 }}>
                {(v.fixes || []).map((f, j) => (
                  <button key={j} className={j === 0 && f.type !== 'delete_shift' ? '' : 'secondary'} style={{ padding: '.35rem .7rem', fontSize: '.85rem' }} disabled={busy} onClick={() => apply([f])}>{f.label}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {Object.entries(groups).length > 0 && (
        <div className="fix-section">
          <div className="fix-title">Needs a rule or team change</div>
          {Object.entries(groups).map(([key, g]) => (
            <div className="fix-item infeasible" key={key}>
              <div className="small"><b>{g.items.length > 1 ? `${gapRange(g.items[0])} short-staffed on ${g.items.length} days` : g.items[0].message}</b></div>
              {g.items.length > 1 && <div className="tiny muted">{g.items.map((v) => v.message.split(' ').slice(0, 2).join(' ')).join(' · ')}</div>}
              <div className="tiny muted" style={{ marginTop: 2 }}>{g.items.length > 1 ? g.why.replace(/ on \w+days\./, ' on these days.') : g.why}</div>
              <div className="row" style={{ marginTop: 6 }}>
                {g.fixes.length > 0 && (
                  <button className="amber" style={{ padding: '.35rem .7rem', fontSize: '.85rem' }} disabled={busy}
                    onClick={() => apply(g.fixes, 'Coverage updated')}>
                    {g.fixes.length > 1 ? `${key} — apply to all ${g.fixes.length} days` : g.fixes[0].label}
                  </button>
                )}
                <Link className="small" to="/owner/staff">Staff availability →</Link>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="row between" style={{ marginTop: '.8rem', alignItems: 'flex-start' }}>
        <div className="grow" />
        <button className="secondary" style={{ padding: '.35rem .7rem', fontSize: '.85rem' }} onClick={() => { try { navigator.clipboard.writeText(claudePrompt); toast('Copied'); } catch { toast('Copy failed', true); } }}>Copy prompt for Claude</button>
      </div>
    </div>
  );
}
