import { Link } from 'react-router-dom';
import AuthHeader from '../components/AuthHeader';
import AuthFooter from '../components/AuthFooter';

export default function About() {
  return (
    <div className="auth-page-shell">
      <AuthHeader />

      <main className="auth-page auth-page-static">
        <section className="auth-card auth-static-card">
          <p className="eyebrow">Barangay VMS</p>
          <h1>About the System</h1>

          <p>
            The Barangay Vehicle Management System (VMS) is a fleet management
            platform built for a barangay's emergency response vehicles —
            ambulances, fire trucks, and rescue boats. It answers two
            questions at any moment: is a vehicle ready to respond right now,
            and what is being done to keep it that way.
          </p>

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

          <p className="auth-legal" style={{ marginTop: '1.5rem' }}>
            <Link to="/login">← Back to Sign In</Link>
          </p>
        </section>
      </main>

      <AuthFooter />
    </div>
  );
}
