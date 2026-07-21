import { Link } from 'react-router-dom';
import Icon from './Icon';

// Footer for the public-facing pages (Login, About Us, Developers) — no
// logo (the header already carries the brand), a large tagline + social
// icons on the left, real site links on the right, and a copyright/legal
// bar along the bottom. Distinct from WorkspaceFooter, which stays as-is
// for the authenticated app.
export default function AuthFooter() {
  return (
    <footer className="auth-footer">
      <div className="auth-footer-main">
        <div className="auth-footer-brand">
          <h2 className="auth-footer-tagline">A Smarter Way to Manage Your Barangay's Fleet.</h2>
          <div className="auth-footer-social">
            <a href="#" aria-label="LinkedIn"><Icon name="linkedin" size={15} filled /></a>
            <a href="#" aria-label="Facebook"><Icon name="facebook" size={15} filled /></a>
            <a href="#" aria-label="Instagram"><Icon name="instagram" size={15} filled /></a>
            <a href="#" aria-label="X"><Icon name="twitterX" size={15} filled /></a>
          </div>
        </div>
        <div className="auth-footer-links">
          <div className="auth-footer-col">
            <Link to="/login">Home</Link>
            <Link to="/about">About Us</Link>
          </div>
          <div className="auth-footer-col">
            <Link to="/developers">Developers</Link>
          </div>
        </div>
      </div>
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
