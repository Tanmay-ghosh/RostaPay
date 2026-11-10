import { Link } from 'react-router-dom';
import { Logo } from '../components.jsx';

const RULES = [
  ['₹300/hr after 8 hours', 'Overtime'],
  ['+₹100 for shifts past 10pm', 'Night allowance'],
  ['2× pay on Diwali', 'Festival pay'],
  ['Cooks +₹30/hr on Sundays', 'Role bonus'],
  ['At least 4 hours paid', 'Minimum shift'],
  ['−₹50 for a late start', 'Deduction'],
  ['Overtime capped at ₹500/week', 'Weekly cap'],
  ['₹500 if sales cross ₹1 lakh', 'Flagged for you'],
];

function Browser({ src, alt }) {
  return (
    <div className="mock-browser">
      <div className="mock-bar"><i /><i /><i /><span>rostapay.onrender.com</span></div>
      <img src={src} alt={alt} />
    </div>
  );
}

function Phone({ src, alt, className = '' }) {
  return <div className={`mock-phone ${className}`}><img src={src} alt={alt} /></div>;
}

function ClaudeChat() {
  return (
    <div className="mock-chat">
      <div className="chat-head"><span className="chat-dot" /> Claude <span className="chip-tool">RostaPay connected</span></div>
      <div className="chat-msg me">₹200/hr, ₹300 after 8 hours, ₹100 extra if a shift runs past 10pm, double pay on Diwali. Ravi can't do mornings. Make next week's roster.</div>
      <div className="chat-tools">
        <span>⚙ set_pay_rules · 4 rules</span>
        <span>⚙ test_pay · 10h shift = ₹2,200</span>
        <span>⚙ create_roster · 28 shifts</span>
      </div>
      <div className="chat-msg claude">Done. Your 4 pay rules are live — a 10-hour shift pays <b>₹2,200</b>. Next week's roster is saved as a draft with Ravi on evenings only. One thing to check: <b>Meena has an exam on Thursday</b>. Review and publish it in RostaPay.</div>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="landing">
      <header className="l-nav">
        <Logo />
        <nav className="row">
          <a href="#how" className="l-link">How it works</a>
          <a href="#staff" className="l-link">For staff</a>
          <Link className="btn secondary" to="/staff/login">Staff<span className="hide-sm"> login</span></Link>
          <Link className="btn" to="/owner/login">Owner<span className="hide-sm"> login</span></Link>
        </nav>
      </header>

      {/* ---------- hero ---------- */}
      <section className="l-hero">
        <div className="l-hero-copy">
          <span className="pill amber">For cafés, salons & clinics with part-time staff</span>
          <h1>Rosters and payroll,<br /><em>done by your Claude.</em></h1>
          <p className="lead">Tell Claude your pay rules and who's free. RostaPay builds the week, flags every gap, and pays each person to the rupee — with a breakdown they can check on their phone.</p>
          <div className="cta">
            <Link className="btn big" style={{ width: 'auto' }} to="/owner/login?demo=1">Open the demo café →</Link>
            <Link className="btn big secondary" style={{ width: 'auto' }} to="/staff/login?demo=1">See the staff app</Link>
          </div>
          <p className="tiny muted" style={{ marginTop: '.8rem' }}>No sign-up needed — the demo login fills itself.</p>
        </div>
        <div className="l-hero-visual">
          <Browser src="/shots/roster.jpg" alt="RostaPay weekly roster, shifts shown by day and time" />
          <Phone src="/shots/phone-pay.jpg" alt="A staff member's weekly pay breakdown on their phone" className="hero-phone" />
          <div className="float-card fc-1"><b>✓ Roster drafted by Claude</b><span>28 shifts · 1 issue flagged</span></div>
          <div className="float-card fc-2"><b>Ravi · Friday</b><span>8h × ₹200 + 2.75h × ₹300 + ₹100 = <b>₹2,525</b></span></div>
        </div>
      </section>

      {/* ---------- before / after ---------- */}
      <section className="l-strip">
        {[
          ['Roster as a WhatsApp screenshot', 'One live roster your whole team sees'],
          ['“I worked 10 hours, not 8”', 'Hours logged by staff, approved by you'],
          ['Payroll in a notebook', 'Every rupee explained, line by line'],
        ].map(([before, after]) => (
          <div key={before} className="ba">
            <span className="before">{before}</span>
            <span className="arrow">→</span>
            <span className="after">{after}</span>
          </div>
        ))}
      </section>

      {/* ---------- how it works ---------- */}
      <section id="how" className="l-section">
        <div className="l-head"><span className="kicker">How it works</span><h2>Say it once. RostaPay runs it every week.</h2></div>

        <div className="feature">
          <div className="f-copy">
            <span className="step">1</span>
            <h3>Tell Claude how you work</h3>
            <p>Paste your pay policy or just describe it. Claude turns it into exact rules, adds your staff and their availability, and drafts the week — straight into RostaPay.</p>
            <ul className="ticks"><li>Works with your own Claude</li><li>Change anything later in plain words</li></ul>
          </div>
          <div className="f-visual"><ClaudeChat /></div>
        </div>

        <div className="feature reverse">
          <div className="f-copy">
            <span className="step">2</span>
            <h3>Catch problems before your staff do</h3>
            <p>Every roster is checked against coverage, availability, days off and hour limits. Fixes are one click — and when no roster can work, RostaPay tells you exactly why.</p>
            <ul className="ticks"><li>See gaps on a day-by-time view</li><li>Every version saved — restore any time</li></ul>
          </div>
          <div className="f-visual"><Browser src="/shots/checks.jpg" alt="Roster checks with one-click fixes" /></div>
        </div>

        <div className="feature">
          <div className="f-copy">
            <span className="step">3</span>
            <h3>Hours in. Pay out. No arguments.</h3>
            <p>Staff log the hours they actually worked; you approve with a tap. Overtime, night allowance and festival pay are calculated exactly — and everyone can see how.</p>
            <ul className="ticks"><li>Approve, edit or reject hours</li><li>Mark paid, export to CSV</li></ul>
          </div>
          <div className="f-visual stack-visual">
            <Browser src="/shots/hours.jpg" alt="Owner approving hours staff have logged" />
          </div>
        </div>
      </section>

      {/* ---------- rules ---------- */}
      <section className="l-section l-rules">
        <div className="l-head"><span className="kicker">Pay rules</span><h2>Whatever your pay policy is, RostaPay can run it.</h2>
          <p className="muted">Claude writes the rules from your words. RostaPay applies them the same way every single week — and a built-in tester shows exactly how any shift will be paid.</p></div>
        <div className="rule-chips">
          {RULES.map(([r, k]) => <div key={r} className="rule-chip"><b>{r}</b><span>{k}</span></div>)}
        </div>
        <Browser src="/shots/rules.jpg" alt="Pay rules with a live rule tester" />
      </section>

      {/* ---------- staff ---------- */}
      <section id="staff" className="l-section">
        <div className="feature">
          <div className="f-copy">
            <span className="kicker">For your staff</span>
            <h3 style={{ fontSize: '1.7rem' }}>Your team gets an app too. No download.</h3>
            <p>Staff log in with their phone number and a 4-digit PIN. They see their shifts, log hours, mark days off, swap shifts with a colleague — and see their pay, worked out line by line.</p>
            <ul className="ticks"><li>Fewer “when am I working?” calls</li><li>Fewer pay disputes</li></ul>
            <Link className="btn secondary" to="/staff/login?demo=1" style={{ marginTop: '.6rem' }}>Try the staff app →</Link>
          </div>
          <div className="f-visual phones">
            <Phone src="/shots/phone-week.jpg" alt="Staff app: my shifts this week" />
            <Phone src="/shots/phone-pay.jpg" alt="Staff app: my pay with breakdown" className="phone-2" />
          </div>
        </div>
      </section>

      {/* ---------- no AI inside ---------- */}
      <section className="l-section">
        <div className="trust">
          <div><h3>Your Claude thinks.</h3><p>Reading your policy, drafting rosters, answering “who did the most overtime?” — that's Claude, on your own plan.</p></div>
          <div><h3>RostaPay calculates.</h3><p>No AI inside. Plain, tested code does the maths, the same way every time, and keeps the records.</p></div>
          <div><h3>Everyone sees it.</h3><p>Live for owners and staff on any phone or laptop — not stuck in a chat window.</p></div>
        </div>
      </section>

      <section className="l-final">
        <h2>See it run a real week.</h2>
        <p>Brew &amp; Bites Café has 5 staff, 6 pay rules and a Diwali week already paid out. Have a look around.</p>
        <div className="cta" style={{ justifyContent: 'center' }}>
          <Link className="btn big amber" style={{ width: 'auto' }} to="/owner/login?demo=1">Open the demo café →</Link>
          <Link className="btn big secondary" style={{ width: 'auto' }} to="/owner/login">Start your own business</Link>
        </div>
      </section>

      <footer className="l-foot"><Logo small /><span className="tiny muted">Rosters and pay for small businesses · Powered by your Claude</span></footer>
    </div>
  );
}
