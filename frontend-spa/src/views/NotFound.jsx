import { Link } from 'react-router-dom';
import notFoundIllustration from '../assets/404-not-found.svg';

export default function NotFound() {
  return (
    <main className="auth-page">
      <section className="auth-card" style={{ textAlign: 'center' }}>
        <img
          src={notFoundIllustration}
          alt=""
          style={{ width: '100%', maxWidth: 320, margin: '0 auto 20px' }}
        />
        <p className="eyebrow">VMS</p>
        <h1>Page not found</h1>
        <p className="auth-subtitle">
          The page you&apos;re looking for doesn&apos;t exist or may have been moved.
        </p>
        <Link className="primary-link" to="/login" style={{ display: 'inline-block', marginTop: 16 }}>
          Return to sign in
        </Link>
      </section>
    </main>
  );
}
