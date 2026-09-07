import { useContext, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import Icon from '../components/Icon';
import { AuthContext } from '../context/AuthContextObject';
import loginFleetImage from '../assets/login-fleet.png';
import vmsLogo from '../assets/login-vms-logo.png';

const roleRoutes = {
  Admin: '/admin',
  Custodian: '/custodian',
  'Maintenance Personnel': '/maintenance',
  'Super Admin': '/superadmin',
};

function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, token, user } = useContext(AuthContext);
  const [credentials, setCredentials] = useState({ email: '', password: '' });
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  if (token && user) {
    return <Navigate to={roleRoutes[user.role] ?? '/unauthorized'} replace />;
  }

  const handleChange = (event) => {
    const { name, value } = event.target;
    setCredentials((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setError('');

    if (!credentials.email || !credentials.password) {
      setError('Email and password are required.');
      return;
    }

    setSubmitting(true);

    try {
      const response = await api.post('/login', credentials);
      const { user: authenticatedUser, access_token: accessToken } = response.data;

      login(authenticatedUser, accessToken, rememberMe);
      const destination = location.state?.from
        ? `${location.state.from.pathname}${location.state.from.search ?? ''}`
        : (roleRoutes[authenticatedUser.role] ?? '/unauthorized');
      navigate(destination, { replace: true });
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ??
          'Unable to sign in. Please check your connection and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="vms-login-page">
      <div
        className="vms-login-backdrop"
        style={{ backgroundImage: `url(${loginFleetImage})` }}
        aria-hidden="true"
      />

      <section className="vms-login-card" aria-labelledby="login-title">
        <div
          className="vms-login-hero"
          style={{ backgroundImage: `url(${loginFleetImage})` }}
        >
          <div className="vms-login-hero-shade" aria-hidden="true" />
          <div className="vms-login-brand">
            <img src={vmsLogo} alt="Vehicle Management System" />
          </div>

          <div className="vms-login-message">
            <p className="vms-login-kicker">Barangay fleet operations</p>
            <h2>One fleet.<br />A safer tomorrow.</h2>
            <p>
              Keep every response vehicle ready, accountable, and moving when
              your community needs it most.
            </p>
            <strong>Track. Maintain. Respond.</strong>
          </div>

          <nav className="vms-login-hero-links" aria-label="Legal links">
            <Link to="/terms">Terms of Service</Link>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/support">Contact Us</Link>
          </nav>
        </div>

        <div className="vms-login-panel">
          <span className="vms-login-accent-line" aria-hidden="true" />
          <div className="vms-login-panel-content">
            <p className="vms-login-eyebrow">Secure fleet access</p>
            <h1 id="login-title">Welcome back</h1>
            <p className="vms-login-intro">
              Sign in to manage your barangay's vehicles and operations.
            </p>

            <form className="vms-login-form" onSubmit={handleSubmit} noValidate>
              <label className="vms-login-field" htmlFor="login-email">
                <span>Email address</span>
                <input
                  autoComplete="email"
                  id="login-email"
                  name="email"
                  onChange={handleChange}
                  placeholder="you@example.com"
                  required
                  type="email"
                  value={credentials.email}
                />
              </label>

              <label className="vms-login-field" htmlFor="login-password">
                <span>Password</span>
                <div className="vms-login-password">
                  <input
                    autoComplete="current-password"
                    id="login-password"
                    name="password"
                    onChange={handleChange}
                    placeholder="Enter your password"
                    required
                    type={showPassword ? 'text' : 'password'}
                    value={credentials.password}
                  />
                  <button
                    type="button"
                    className="vms-login-password-toggle"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <Icon name={showPassword ? 'eyeOff' : 'eye'} size={19} />
                  </button>
                </div>
              </label>

              <label className="vms-login-remember">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                />
                <span>Remember me</span>
              </label>

              {error ? <p className="vms-login-error" role="alert">{error}</p> : null}

              <button className="vms-login-submit" disabled={submitting} type="submit">
                {submitting ? (
                  <span className="btn-loading">
                    <span className="btn-spinner" aria-hidden="true" />
                    Signing in…
                  </span>
                ) : 'Sign in'}
              </button>
            </form>

            <p className="vms-login-register">
              Need an account? <Link to="/register">Register here</Link>
            </p>
            <nav className="vms-login-mobile-links" aria-label="Legal links">
              <Link to="/terms">Terms</Link>
              <Link to="/privacy">Privacy</Link>
              <Link to="/support">Support</Link>
            </nav>
          </div>
        </div>
      </section>
    </main>
  );
}

export default Login;
