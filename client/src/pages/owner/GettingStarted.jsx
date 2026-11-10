import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { get } from '../../api.js';
import { useToast } from '../../hooks.js';

// "Getting started" checklist: shows a new owner what RostaPay needs, in order.
// Each step ticks itself once the data exists (whether Claude or the owner added it).
export default function GettingStarted({ version }) {
  const { me } = useOutletContext();
  const toast = useToast();
  const key = `rp_setup_hidden_${me.business.id}`;
  const [s, setS] = useState(null);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } });
  const [open, setOpen] = useState(null);
  useEffect(() => { get('/api/owner/onboarding').then(setS).catch(() => {}); }, [version]);
  if (!s) return null;

  const steps = [
    {
      title: 'Connect your Claude',
      why: 'Claude does the thinking — reading your policy and drafting rosters. Connect it once.',
      done: s.claude,
      doneText: 'Claude has used RostaPay',
      action: <Link className="btn secondary" to="/owner/settings">Get your Claude link →</Link>,
    },
    {
      title: 'Add your staff',
      why: 'Name, phone, role and when each person can work. Their phone + PIN is their login.',
      done: s.staff > 0,
      doneText: `${s.staff} staff added`,
      prompt: 'Add my staff to RostaPay: Ravi 9876500001 barista, evenings only; Priya 9876500002 barista; Arjun 9876500003 cook, off on Wednesdays. Give each the PIN 1234.',
      link: ['/owner/staff', 'or add them by hand'],
    },
    {
      title: 'Say how many people you need',
      why: 'Coverage (e.g. 2 people from 8am to 11pm) and limits (e.g. max 6 days a week). Used to check every roster.',
      done: s.coverage > 0,
      doneText: `${s.coverage} coverage rule${s.coverage === 1 ? '' : 's'} set`,
      prompt: 'In RostaPay, I need at least 2 people on shift from 8am to 11pm every day, and 3 from 12pm to 3pm on weekends. Nobody works more than 6 days a week or 10 hours a day.',
      link: ['/owner/settings', 'or set it by hand'],
    },
    {
      title: 'Add your pay rules',
      why: 'How you pay — base rate, overtime, night or festival extras. RostaPay applies them exactly.',
      done: s.rules > 0,
      doneText: `${s.rules} pay rule${s.rules === 1 ? '' : 's'} active`,
      prompt: 'Set up my pay rules in RostaPay: ₹200 per hour; ₹300 per hour after 8 hours in a day; ₹100 extra for any shift that runs past 10pm; double pay on public holidays 26 Jan and 15 Aug 2027. Then test a 10-hour shift.',
      link: ['/owner/rules', 'or add them by hand'],
    },
    {
      title: 'Make and publish your first roster',
      why: 'Claude drafts the week; you check it here, fix anything flagged in red, then press “Publish week”.',
      done: s.published > 0,
      doneText: 'Roster published — your staff can see their shifts',
      pending: s.shifts > 0 && s.published === 0 ? 'Draft is ready below — review it and press “Publish week”.' : null,
      prompt: "Make next week's roster in RostaPay using my staff's availability and coverage needs.",
    },
  ];
  const doneCount = steps.filter((x) => x.done).length;
  if (hidden || doneCount === steps.length) return null;
  const firstOpen = steps.findIndex((x) => !x.done);
  const active = open ?? firstOpen;
  const copy = (t) => { try { navigator.clipboard.writeText(t); toast('Copied — paste it into Claude'); } catch { toast('Copy failed', true); } };

  return (
    <div className="card setup" style={{ marginBottom: '1rem', borderColor: '#9fd3cb' }}>
      <div className="row between">
        <div>
          <h2 style={{ margin: 0 }}>Getting started</h2>
          <p className="small muted" style={{ margin: '.2rem 0 0' }}>RostaPay needs 4 things once, then runs the same loop every week.</p>
        </div>
        <div className="row">
          <span className="pill">{doneCount} of {steps.length} done</span>
          <button className="ghost small" onClick={() => { try { localStorage.setItem(key, '1'); } catch { /* ignore */ } setHidden(true); }}>Hide</button>
        </div>
      </div>
      <div className="progress"><div style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
      <ol className="setup-steps">
        {steps.map((st, i) => (
          <li key={st.title} className={`${st.done ? 'done' : ''} ${active === i ? 'open' : ''}`}>
            <button className="setup-head" onClick={() => setOpen(active === i ? -1 : i)}>
              <span className="tick">{st.done ? '✓' : i + 1}</span>
              <span className="grow" style={{ textAlign: 'left' }}>{st.title}</span>
              <span className="tiny muted">{st.done ? st.doneText : active === i ? '' : 'To do'}</span>
            </button>
            {active === i && (
              <div className="setup-body">
                <p className="small" style={{ margin: '0 0 .5rem' }}>{st.why}</p>
                {st.pending && <div className="notice small" style={{ marginBottom: '.5rem' }}>{st.pending}</div>}
                {st.prompt && (
                  <>
                    <div className="tiny muted" style={{ marginBottom: 4 }}>Say this to Claude (edit to fit your business):</div>
                    <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                      <div className="code grow">“{st.prompt}”</div>
                      <button className="secondary" onClick={() => copy(st.prompt)}>Copy</button>
                    </div>
                  </>
                )}
                <div className="row" style={{ marginTop: '.5rem' }}>
                  {st.action}
                  {st.link && <Link className="small" to={st.link[0]}>{st.link[1]} →</Link>}
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="weekly small">
        <b>Then every week:</b>
        <span>① Claude drafts the roster</span><span>→</span>
        <span>② you publish it</span><span>→</span>
        <span>③ staff log real hours on their phones</span><span>→</span>
        <span>④ you approve on <Link to="/owner/hours">Hours</Link> and pay from <Link to="/owner/payouts">Payouts</Link></span>
      </div>
    </div>
  );
}
