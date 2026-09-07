import { Link } from 'react-router-dom';
import vmsLogo from '../assets/vms-logo.png';

// Footer for the authenticated app shell (Workspace, Super Admin). Public
// pages (Login, About, Support, etc.) use the separate, lighter AuthFooter
// instead. Support/contact now lives as the Help Center icon in the topbar,
// next to notifications, rather than as buttons down here.
export default function WorkspaceFooter() {
  return (
    <footer className="workspace-footer">
      <div className="workspace-footer-brand">
        <div className="workspace-footer-wordmark">
          <img src={vmsLogo} alt="VMS" className="workspace-footer-logo" />
        </div>
        <p className="workspace-footer-tagline">A Smarter Way to Manage Your Barangay's Fleet.</p>
      </div>
      <div className="workspace-footer-actions">
        <p className="workspace-footer-copyright">
          © {new Date().getFullYear()} Barangay Vehicle Management System. All rights reserved.
        </p>
        <div className="workspace-footer-links">
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms of Service</Link>
        </div>
      </div>
    </footer>
  );
}
