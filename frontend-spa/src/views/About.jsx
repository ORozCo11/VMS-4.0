import { useEffect, useRef, useState } from 'react';
import AuthHeader from '../components/AuthHeader';
import AuthFooter from '../components/AuthFooter';
import Icon from '../components/Icon';

const SLIDE_COUNT = 4;
const SLIDE_INTERVAL_MS = 6000;
const TRANSITION_MS = 800;

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8v4l3 3" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

const FEATURES = [
  { icon: <Icon name="vehicle" size={22} />, title: 'Fleet Management', desc: "Track every vehicle's availability, condition, and status in real time." },
  { icon: <Icon name="wrench" size={22} />, title: 'Maintenance Workflow', desc: 'From a reported issue, through inspection and repair, to a verified return to service.' },
  { icon: <Icon name="calendar" size={22} />, title: 'Scheduling', desc: 'Plan preventive maintenance ahead of time, including recurring service.' },
  { icon: <Icon name="pin" size={22} />, title: 'Vehicle Location', desc: 'See exactly where every vehicle is stationed on an interactive map.' },
  { icon: <Icon name="alert" size={22} />, title: 'Issue Reports', desc: 'Log and track problems from the moment they are reported to resolution.' },
  { icon: <UsersIcon />, title: 'Role-Based Access', desc: 'Admin, Custodian, and Maintenance Personnel each see only what they need.' },
  { icon: <ClockIcon />, title: 'Activity History', desc: 'A complete, automatic timeline of every action taken across the fleet.' },
  { icon: <Icon name="clipboard" size={22} />, title: 'Reports', desc: 'Printable summaries for oversight, audits, and planning ahead.' },
];

// The 5-phase Main Issue → Sub-Issue ticket workflow, condensed to one line
// each for the slide — see the README's "Maintenance Ticket Workflow"
// section for the full detail.
const WORKFLOW_STEPS = [
  { title: 'Create', desc: 'An Admin opens a ticket for the vehicle and assigns it to a Custodian.' },
  { title: 'Inspect', desc: 'The Custodian inspects the vehicle and records the concrete sub-issues found.' },
  { title: 'Repair', desc: 'Each sub-issue is dispatched to a mechanic, who logs the repair and parts used.' },
  { title: 'Verify', desc: 'The Custodian reviews the work and runs a functional test before signing off.' },
  { title: 'Close', desc: 'Once every sub-issue passes, the ticket closes with a full, timestamped record.' },
];

const SECURITY_FEATURES = [
  { icon: <Icon name="key" size={22} />, title: 'Token-Based Sessions', desc: 'Every login is authenticated with a Laravel Sanctum bearer token, not a lingering cookie.' },
  { icon: <Icon name="checkCircle" size={22} />, title: 'Ownership-Checked Actions', desc: "Every action checks your role and that you actually own the ticket or vehicle you're touching." },
  { icon: <Icon name="alert" size={22} />, title: 'Rate-Limited Login', desc: 'Repeated failed sign-in attempts are automatically throttled to blunt brute-force attempts.' },
  { icon: <Icon name="clipboard" size={22} />, title: 'Full Activity Trail', desc: 'Every action across the fleet is logged automatically, so nothing happens without a record.' },
];

export default function About() {
  // Index into the track, which holds SLIDE_COUNT real slides plus one clone
  // of the first slide appended at the end (position SLIDE_COUNT). Auto-play
  // always increments forward; on landing on the clone, we snap back to the
  // real first slide with the transition briefly disabled so the loop reads
  // as continuous rightward motion instead of a jump backward.
  const [index, setIndex] = useState(0);
  const [animate, setAnimate] = useState(true);
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setInterval(() => setIndex((current) => current + 1), SLIDE_INTERVAL_MS);
    return () => clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (index !== SLIDE_COUNT) return;
    const id = setTimeout(() => {
      setAnimate(false);
      setIndex(0);
    }, TRANSITION_MS);
    return () => clearTimeout(id);
  }, [index]);

  useEffect(() => {
    if (animate) return;
    // Re-enable the transition on the next paint, after the transition-less
    // snap to index 0 has already taken visual effect.
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setAnimate(true)));
    return () => cancelAnimationFrame(id);
  }, [animate]);

  const goToSlide = (i) => {
    clearInterval(timerRef.current);
    setIndex(i);
    timerRef.current = setInterval(() => setIndex((current) => current + 1), SLIDE_INTERVAL_MS);
  };

  const activeDot = index % SLIDE_COUNT;

  return (
    <div className="auth-page-shell">
      <AuthHeader />

      <div className="about-slider">
        <div
          className="about-slider-track"
          style={{
            transform: `translateX(-${index * (100 / (SLIDE_COUNT + 1))}%)`,
            transition: animate ? undefined : 'none',
          }}
        >
          <div className="about-slide">
            <main className="auth-hero">
              <div className="auth-hero-inner">
                <p className="auth-hero-eyebrow">Barangay VMS</p>
                <h1 className="auth-hero-title">About the System</h1>
                <p className="auth-hero-subtitle">
                  The Barangay Vehicle Management System (VMS) is a fleet management
                  platform built for a barangay's emergency response vehicles —
                  ambulances, fire trucks, and rescue boats. It answers two
                  questions at any moment: is a vehicle ready to respond right now,
                  and what is being done to keep it that way.
                </p>

                <div className="about-hero-body">
                  <h3>What it covers</h3>
                  <ul>
                    <li>Vehicle availability and physical condition, tracked independently</li>
                    <li>A structured maintenance workflow — from a reported issue, through inspection and repair, to a verified return to service</li>
                    <li>Preventive maintenance scheduling, including recurring service</li>
                    <li>Fleet-wide readiness and reliability signals for planning ahead</li>
                  </ul>

                  <h3>Who it's for</h3>
                  <p>
                    Three roles share the workflow: an <strong>Admin</strong> who
                    oversees the fleet, a <strong>Custodian</strong> who inspects
                    vehicles and verifies repairs, and <strong>Maintenance
                    Personnel</strong> who carry out the work — each accountable for
                    their part of the process.
                  </p>
                </div>
              </div>
            </main>
          </div>

          <div className="about-slide">
            <section className="about-features">
              <div className="about-features-inner">
                <h2 className="about-features-title">A Better Way to Run Your Barangay's Fleet</h2>
                <div className="about-features-grid">
                  {FEATURES.map((f) => (
                    <div className="about-feature-card" key={f.title}>
                      <span className="about-feature-icon">{f.icon}</span>
                      <p className="about-feature-name">{f.title}</p>
                      <p className="about-feature-desc">{f.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <div className="about-slide">
            <main className="auth-hero">
              <div className="auth-hero-inner">
                <p className="auth-hero-eyebrow">Barangay VMS</p>
                <h1 className="auth-hero-title">The Maintenance Ticket Workflow</h1>
                <p className="auth-hero-subtitle">
                  Every reported issue moves through five accountable phases —
                  from the moment it's flagged to a verified return to service.
                </p>

                <div className="about-workflow-steps">
                  {WORKFLOW_STEPS.map((step, i) => (
                    <div className="about-workflow-step" key={step.title}>
                      <span className="about-workflow-step-number">{i + 1}</span>
                      <div>
                        <p className="about-workflow-step-title">{step.title}</p>
                        <p className="about-workflow-step-desc">{step.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </main>
          </div>

          <div className="about-slide">
            <section className="about-features">
              <div className="about-features-inner">
                <h2 className="about-features-title">Built to Be Secure and Accountable</h2>
                <div className="about-features-grid">
                  {SECURITY_FEATURES.map((f) => (
                    <div className="about-feature-card" key={f.title}>
                      <span className="about-feature-icon">{f.icon}</span>
                      <p className="about-feature-name">{f.title}</p>
                      <p className="about-feature-desc">{f.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          {/* Clone of slide 1 — lets the loop keep sliding right instead of
             jumping backward when it wraps from the last slide to the first. */}
          <div className="about-slide" aria-hidden="true">
            <main className="auth-hero">
              <div className="auth-hero-inner">
                <p className="auth-hero-eyebrow">Barangay VMS</p>
                <h1 className="auth-hero-title">About the System</h1>
                <p className="auth-hero-subtitle">
                  The Barangay Vehicle Management System (VMS) is a fleet management
                  platform built for a barangay's emergency response vehicles —
                  ambulances, fire trucks, and rescue boats. It answers two
                  questions at any moment: is a vehicle ready to respond right now,
                  and what is being done to keep it that way.
                </p>
              </div>
            </main>
          </div>
        </div>
      </div>

      <div className="about-slider-dots">
        {Array.from({ length: SLIDE_COUNT }).map((_, i) => (
          <button
            key={i}
            type="button"
            className={`about-slider-dot${i === activeDot ? ' is-active' : ''}`}
            onClick={() => goToSlide(i)}
            aria-label={`Go to slide ${i + 1}`}
          />
        ))}
      </div>

      <AuthFooter />
    </div>
  );
}
