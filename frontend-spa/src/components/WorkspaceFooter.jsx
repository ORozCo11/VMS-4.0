import { Link } from 'react-router-dom';
import Icon from './Icon';

// Shared footer — used inside the authenticated app shell AND on the public
// login page, so both read as the same site rather than two disconnected UIs.
export default function WorkspaceFooter() {
  return (
    <footer className="workspace-footer">
      <div className="workspace-footer-brand">
        <div className="workspace-footer-wordmark">
          <Icon name="gear" size={36} className="workspace-footer-gear-icon" filled />
          <span className="vms-wordmark vms-wordmark-md workspace-footer-vms-text">vms</span>
        </div>
        <p className="workspace-footer-tagline">A Smarter Way to Manage Your Barangay's Fleet.</p>
        <div className="workspace-footer-social">
          <a href="#" aria-label="Facebook"><Icon name="facebook" size={15} filled /></a>
          <a href="#" aria-label="Instagram"><Icon name="instagram" size={15} filled /></a>
          <a href="#" aria-label="X"><Icon name="twitterX" size={15} filled /></a>
          <a href="#" aria-label="LinkedIn"><Icon name="linkedin" size={15} filled /></a>
        </div>
      </div>
      <div className="workspace-footer-actions">
        <div className="workspace-footer-buttons">
          <button type="button" className="workspace-footer-btn workspace-footer-btn-light">Visit Support Center</button>
          <button type="button" className="workspace-footer-btn workspace-footer-btn-dark">Contact Us</button>
        </div>
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
