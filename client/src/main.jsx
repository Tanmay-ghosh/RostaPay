import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import './styles.css';
import { get, post } from './api.js';
import { ToastContext } from './hooks.js';
import { Logo, Spinner } from './components.jsx';
import Landing from './pages/Landing.jsx';
import { OwnerAuth, WorkerLogin } from './pages/Auth.jsx';
import Roster from './pages/owner/Roster.jsx';
import Staff from './pages/owner/Staff.jsx';
import Rules from './pages/owner/Rules.jsx';
import Hours from './pages/owner/Hours.jsx';
import Payouts from './pages/owner/Payouts.jsx';
import OwnerSwaps from './pages/owner/Swaps.jsx';
import Settings from './pages/owner/Settings.jsx';
import MyWeek from './pages/worker/MyWeek.jsx';
import LogHours from './pages/worker/LogHours.jsx';
import MyPay from './pages/worker/MyPay.jsx';
import Availability from './pages/worker/Availability.jsx';
import WorkerSwaps from './pages/worker/Swaps.jsx';

function OwnerLayout() {
  const [me, setMe] = useState(null);
  const nav = useNavigate();
  const load = useCallback(() => get('/api/owner/me').then(setMe).catch(() => nav('/owner/login')), [nav]);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  if (!me) return <Spinner />;
  const badge = (n) => (n ? <span className="pill amber">{n}</span> : null);
  return (
    <div className="owner-shell">
      <aside className="sidebar">
        <Logo />
        <div className="biz">{me.business.name}</div>
        <nav>
          <NavLink to="/owner/roster">Roster</NavLink>
          <NavLink to="/owner/hours">Hours {badge(me.counts.pending_hours)}</NavLink>
          <NavLink to="/owner/payouts">Payouts</NavLink>
          <NavLink to="/owner/rules">Pay rules</NavLink>
          <NavLink to="/owner/staff">Staff</NavLink>
          <NavLink to="/owner/swaps">Swaps {badge(me.counts.pending_swaps)}</NavLink>
          <NavLink to="/owner/settings">Settings</NavLink>
        </nav>
        <div className="grow" />
        <div className="sidebar-foot small">
          <div className="muted" style={{ marginBottom: 6 }}>{me.owner.email}</div>
          <button className="secondary" onClick={async () => { await post('/api/auth/logout'); nav('/'); }}>Log out</button>
        </div>
      </aside>
      <main className="main"><Outlet context={{ me, refreshMe: load }} /></main>
    </div>
  );
}

function WorkerLayout() {
  const [me, setMe] = useState(null);
  const nav = useNavigate();
  useEffect(() => { get('/api/worker/me').then(setMe).catch(() => nav('/staff/login')); }, [nav]);
  if (!me) return <Spinner />;
  return (
    <div className="worker">
      <div className="worker-top">
        <div><Logo small /><div className="tiny muted" style={{ marginTop: 2 }}>{me.business_name}</div></div>
        <div className="row"><span className="small">Hi, <b>{me.name}</b></span>
          <button className="ghost small" onClick={async () => { await post('/api/auth/logout'); nav('/staff/login'); }}>Log out</button></div>
      </div>
      <Outlet context={{ me }} />
      <nav className="bottom-nav"><div className="in">
        <NavLink to="/staff/week"><span className="ic">📅</span>My week</NavLink>
        <NavLink to="/staff/hours"><span className="ic">⏱️</span>Log hours</NavLink>
        <NavLink to="/staff/pay"><span className="ic">₹</span>My pay</NavLink>
        <NavLink to="/staff/availability"><span className="ic">🙋</span>Availability</NavLink>
        <NavLink to="/staff/swaps"><span className="ic">🔁</span>Swaps</NavLink>
      </div></nav>
    </div>
  );
}

function App() {
  const [toast, setToast] = useState(null);
  const show = useCallback((msg, err) => { setToast({ msg, err }); setTimeout(() => setToast(null), 3200); }, []);
  return (
    <ToastContext.Provider value={show}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/owner/login" element={<OwnerAuth />} />
          <Route path="/owner" element={<OwnerLayout />}>
            <Route index element={<Navigate to="roster" replace />} />
            <Route path="roster" element={<Roster />} />
            <Route path="staff" element={<Staff />} />
            <Route path="rules" element={<Rules />} />
            <Route path="hours" element={<Hours />} />
            <Route path="payouts" element={<Payouts />} />
            <Route path="swaps" element={<OwnerSwaps />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="/staff/login" element={<WorkerLogin />} />
          <Route path="/staff" element={<WorkerLayout />}>
            <Route index element={<Navigate to="week" replace />} />
            <Route path="week" element={<MyWeek />} />
            <Route path="hours" element={<LogHours />} />
            <Route path="pay" element={<MyPay />} />
            <Route path="availability" element={<Availability />} />
            <Route path="swaps" element={<WorkerSwaps />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </ToastContext.Provider>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
