import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { post } from '../api.js';
import { Logo, ErrorBox } from '../components.jsx';

export function OwnerAuth() {
  const nav = useNavigate();
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ email: '', password: '', business_name: '', name: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await post(mode === 'login' ? '/api/auth/owner/login' : '/api/auth/owner/signup', f);
      nav(mode === 'login' ? '/owner/roster' : '/owner/settings');
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <div className="auth">
      <div className="card">
        <Link to="/"><Logo /></Link>
        <h2 style={{ marginTop: '1rem' }}>Owner {mode === 'login' ? 'login' : 'sign up'}</h2>
        <div className="tabs">
          <button className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')} type="button">Log in</button>
          <button className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')} type="button">New business</button>
        </div>
        <form onSubmit={submit}>
          {mode === 'signup' && <>
            <div className="field"><label>Business name</label><input required value={f.business_name} onChange={set('business_name')} placeholder="Chai Point, Indiranagar" /></div>
            <div className="field"><label>Your name</label><input value={f.name} onChange={set('name')} /></div>
          </>}
          <div className="field"><label>Email</label><input type="email" required value={f.email} onChange={set('email')} autoComplete="email" /></div>
          <div className="field"><label>Password</label><input type="password" required minLength={mode === 'signup' ? 8 : 1} value={f.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></div>
          <ErrorBox error={error} />
          <button className="big" style={{ marginTop: '.8rem' }} disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create business'}</button>
        </form>
        {mode === 'login' && (
          <div className="demo-hint">
            <b>Demo login</b> (Brew & Bites Café)<br />
            Email <code>demo@rostapay.app</code> · Password <code>RostaPay@2026</code>
            <div style={{ marginTop: 6 }}><button className="secondary" type="button" onClick={() => setF({ ...f, email: 'demo@rostapay.app', password: 'RostaPay@2026' })}>Fill demo login</button></div>
          </div>
        )}
        <p className="small muted" style={{ marginTop: '1rem' }}>Work here? <Link to="/staff/login">Staff login →</Link></p>
      </div>
    </div>
  );
}

export function WorkerLogin() {
  const nav = useNavigate();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await post('/api/auth/worker/login', { phone, pin }); nav('/staff/week'); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <div className="auth">
      <div className="card">
        <Link to="/"><Logo /></Link>
        <h2 style={{ marginTop: '1rem' }}>Staff login</h2>
        <p className="small muted">Use the phone number your manager added and your 4-digit PIN.</p>
        <form onSubmit={submit}>
          <div className="field"><label>Phone number</label><input inputMode="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98xxxxxxxx" style={{ fontSize: '1.1rem' }} /></div>
          <div className="field"><label>PIN</label><input inputMode="numeric" type="password" maxLength={4} required value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" style={{ fontSize: '1.4rem', letterSpacing: '.5em' }} /></div>
          <ErrorBox error={error} />
          <button className="big" style={{ marginTop: '.8rem' }} disabled={busy}>{busy ? 'Please wait…' : 'Log in'}</button>
        </form>
        <div className="demo-hint">
          <b>Demo staff login</b> (Ravi, barista)<br />Phone <code>9000000001</code> · PIN <code>1234</code>
          <div className="tiny" style={{ marginTop: 4 }}>Other demo staff: 9000000002 – 9000000005, same PIN.</div>
          <div style={{ marginTop: 6 }}><button className="secondary" type="button" onClick={() => { setPhone('9000000001'); setPin('1234'); }}>Fill demo login</button></div>
        </div>
        <p className="small muted" style={{ marginTop: '1rem' }}>Business owner? <Link to="/owner/login">Owner login →</Link></p>
      </div>
    </div>
  );
}
