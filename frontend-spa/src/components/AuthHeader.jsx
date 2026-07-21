import { Link } from 'react-router-dom';
import Icon from './Icon';

// Shared header for the public-facing pages (Login, About Us, Developers) —
// the sign-in-side counterpart to WorkspaceFooter, so those pages read as
// one connected site instead of disconnected standalone screens.
export default function AuthHeader() {
  return (
    <header className="auth-page-header">
      <div className="auth-page-header-inner">
        <Link to="/login" className="auth-page-header-brand">
          <Icon name="gear" size={46} className="auth-page-header-gear" filled />
          <div className="auth-page-header-brand-text">
            <span className="vms-wordmark auth-page-header-wordmark">vms</span>
            <span className="auth-page-header-subtext">vehicle management system</span>
          </div>
        </Link>
        <div className="auth-page-header-right">
          <nav className="auth-page-nav">
            <Link to="/login">Home</Link>
            <Link to="/about">About Us</Link>
            <Link to="/developers">Developers</Link>
          </nav>
          <Link to="/login" className="auth-page-header-login-btn">Login</Link>
        </div>
      </div>
    </header>
  );
}
