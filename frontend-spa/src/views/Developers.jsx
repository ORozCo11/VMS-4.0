import { Link } from 'react-router-dom';
import AuthHeader from '../components/AuthHeader';
import AuthFooter from '../components/AuthFooter';

// TODO: replace the placeholder team info below with your actual capstone
// group's names, roles, and (optionally) contact/GitHub links.
const TEAM = [
  { name: 'Team Member Name', role: 'Project Lead / Full-Stack Developer' },
  { name: 'Team Member Name', role: 'Backend Developer' },
  { name: 'Team Member Name', role: 'Frontend Developer' },
  { name: 'Team Member Name', role: 'UI/UX Designer' },
];

export default function Developers() {
  return (
    <div className="auth-page-shell">
      <AuthHeader />

      <main className="auth-page auth-page-static">
        <section className="auth-card auth-static-card">
          <p className="eyebrow">Barangay VMS</p>
          <h1>Developers</h1>
          <p>
            This system was built as a capstone project. Meet the team behind it.
          </p>

          <div className="dev-team-grid">
            {TEAM.map((member, i) => (
              <div className="dev-team-card" key={i}>
                <div className="dev-team-avatar">{member.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}</div>
                <p className="dev-team-name">{member.name}</p>
                <p className="dev-team-role">{member.role}</p>
              </div>
            ))}
          </div>

          <p className="auth-legal" style={{ marginTop: '1.5rem' }}>
            <Link to="/login">← Back to Sign In</Link>
          </p>
        </section>
      </main>

      <AuthFooter />
    </div>
  );
}
