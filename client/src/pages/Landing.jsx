import { Link } from 'react-router-dom';
import { Logo } from '../components.jsx';

export default function Landing() {
  return (
    <div className="landing">
      <header>
        <Logo />
        <div className="row">
          <Link className="btn secondary" to="/staff/login">Staff login</Link>
          <Link className="btn" to="/owner/login">Owner login</Link>
        </div>
      </header>
      <section className="hero">
        <div>
          <span className="pill amber">For cafés, salons & clinics with part-time staff</span>
          <h1 style={{ marginTop: '.8rem' }}>Describe your pay rules and roster to Claude.<br /><em>RostaPay runs them exactly, every week.</em></h1>
          <p className="lead">Every small business pays differently: overtime after 8 hours, night allowances, festival double pay. Tell your own Claude how you work. RostaPay turns it into a weekly roster, collects the hours your staff actually worked, and calculates everyone's pay line by line — no spreadsheets, no arguments.</p>
          <div className="cta">
            <Link className="btn big" style={{ width: 'auto' }} to="/owner/login">I run a business →</Link>
            <Link className="btn big secondary" style={{ width: 'auto' }} to="/staff/login">I work at one</Link>
          </div>
          <p className="small muted" style={{ marginTop: '1rem' }}>No AI inside RostaPay. Your Claude does the thinking; RostaPay does the exact maths, keeps the records and stays live for your whole team.</p>
        </div>
        <div className="demo-card">
          <div className="bubble"><b>You → Claude</b><br />“₹200/hr, ₹300/hr after 8 hours, ₹100 extra if a shift runs past 10pm, double pay on Diwali. Ravi can't do mornings. Make next week's roster.”</div>
          <div className="bubble app"><b>RostaPay</b><br />Roster saved as draft · 1 issue flagged: <i>Meena has an exam on Thursday</i>.</div>
          <div className="bubble app"><b>Ravi's pay, Friday</b><br />8h × ₹200 = ₹1,600<br />2.75h × ₹300 = ₹825 <span className="muted">(overtime)</span><br />+₹100 <span className="muted">(night allowance)</span><br /><b>₹2,525</b></div>
        </div>
      </section>
      <section className="steps">
        <div className="card"><h3>1 · Tell Claude</h3><p className="small">Connect RostaPay to your Claude once. Paste your pay policy or just describe it, add your staff and when they're free.</p></div>
        <div className="card"><h3>2 · Check & publish</h3><p className="small">Claude's roster lands here as a draft. RostaPay flags gaps and clashes; drag shifts to fix, then publish to your team.</p></div>
        <div className="card"><h3>3 · Hours in, pay out</h3><p className="small">Staff log real hours on their phones, you approve with one tap, and everyone sees exactly how their pay was calculated.</p></div>
      </section>
    </div>
  );
}
