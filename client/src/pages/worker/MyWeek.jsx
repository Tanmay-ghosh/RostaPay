import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLoad } from '../../hooks.js';
import { WeekNav, Spinner, ErrorBox, DAY_NAMES, MONTHS, dayOfWeek, todayIST, weekStart, fmtHours } from '../../components.jsx';
import { shiftDuration } from '../../../../server/lib/time.js';

export default function MyWeek() {
  const [week, setWeek] = useState(weekStart(todayIST()));
  const { data, error } = useLoad(`/api/worker/week?week=${week}`);
  const today = todayIST();
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const total = data.my_shifts.reduce((t, s) => t + shiftDuration(s.start_time, s.end_time), 0);
  return (
    <div>
      <div className="row between" style={{ marginBottom: '.8rem' }}><h2 style={{ margin: 0 }}>My shifts</h2><span className="pill">{data.my_shifts.length} shifts · {fmtHours(total)}</span></div>
      <WeekNav week={week} onChange={setWeek} />
      <div style={{ marginTop: '.8rem' }}>
        {data.dates.map((d) => {
          const mine = data.my_shifts.filter((s) => s.date === d);
          const team = data.team_shifts.filter((s) => s.date === d);
          return (
            <div key={d} className={`card shift-card ${d < today ? 'past' : ''}`} style={{ padding: '.7rem .8rem', ...(d === today ? { borderColor: 'var(--teal)' } : {}) }}>
              <div className="date"><span>{DAY_NAMES[dayOfWeek(d)]}</span><b>{Number(d.slice(8))}</b><span>{MONTHS[Number(d.slice(5, 7)) - 1]}</span></div>
              <div className="grow">
                {mine.length === 0 ? <div className="muted">{data.week_published === false ? 'Not published yet' : 'Day off'}</div> : mine.map((s) => (
                  <div key={s.id}>
                    <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>{s.start_time} – {s.end_time}</div>
                    <div className="small muted">{s.role} · {fmtHours(shiftDuration(s.start_time, s.end_time))}
                      {s.log ? <> · <span className={`pill ${s.log.status === 'approved' ? 'green' : s.log.status === 'rejected' ? 'red' : 'amber'}`}>hours {s.log.status}</span></> : d <= today ? <> · <Link to="/staff/hours">log hours</Link></> : null}
                    </div>
                  </div>
                ))}
                {team.length > 0 && <div className="tiny muted" style={{ marginTop: 4 }}>With: {team.map((t) => `${t.staff_name} ${t.start_time}–${t.end_time}`).join(' · ')}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {data.week_published === false
        ? <p className="small muted">Your manager hasn't published this week's roster yet — check back later.</p>
        : data.my_shifts.length === 0 && <p className="small muted">You have no shifts this week.</p>}
    </div>
  );
}
