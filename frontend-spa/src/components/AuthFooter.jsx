import { Link } from 'react-router-dom';

// Footer for the public-facing pages (Login, About, Developers) — just the
// copyright/legal bar. Distinct from WorkspaceFooter, which stays as-is for
// the authenticated app.
export default function AuthFooter() {
  return (
    <footer className="auth-footer">
      <div className="auth-footer-bottom">
        <p className="auth-footer-copyright">
          © {new Date().getFullYear()} Barangay Vehicle Management System
        </p>
        <div className="auth-footer-legal">
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms of Service</Link>
        </div>
      </div>
    </footer>
  );
}
