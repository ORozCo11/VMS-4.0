import { useContext, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import Icon from '../components/Icon';
import Aurora from '../components/Aurora';
import AuthHeader from '../components/AuthHeader';
import AuthFooter from '../components/AuthFooter';
import { AuthContext } from '../context/AuthContextObject';

const roleRoutes = {
  Admin: '/admin',
  Custodian: '/custodian',
  'Maintenance Personnel': '/maintenance',
};

function Login() {
  const navigate = useNavigate();
  const { login, token, user } = useContext(AuthContext);
  const [credentials, setCredentials] = useState({
    email: '',
    password: '',
  });
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  if (token && user) {
    return <Navigate to={roleRoutes[user.role] ?? '/unauthorized'} replace />;
  }

  const handleChange = (event) => {
    const { name, value } = event.target;
    setCredentials((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const response = await api.post('/login', credentials);
      const { user: authenticatedUser, access_token: accessToken } = response.data;

      login(authenticatedUser, accessToken, rememberMe);
      navigate(roleRoutes[authenticatedUser.role] ?? '/unauthorized', { replace: true });
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
    <div className="auth-page-shell">
      <AuthHeader />

      <main className="auth-page">
      <Aurora colorStops={['#0b1220', '#1e3a5f', '#0f172a']} amplitude={0.6} blend={0.55} />
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-logo-header">
          <h1 id="login-title" className="auth-login-heading">Login</h1>
        </div>

        <form className="auth-form" autoComplete="off" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span className="sr-only">Email Address</span>
            <div className="auth-input-wrapper auth-input-plain">
              <input
                autoComplete="off"
                name="email"
                onChange={handleChange}
                placeholder="Email address"
                required
                type="email"
                value={credentials.email}
              />
            </div>
          </label>

          <label className="auth-field">
            <span className="sr-only">Password</span>
            <div className="auth-input-wrapper auth-input-plain">
              <input
                autoComplete="off"
                name="password"
                onChange={handleChange}
                placeholder="Password"
                required
                type={showPassword ? 'text' : 'password'}
                value={credentials.password}
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                <Icon name={showPassword ? 'eyeOff' : 'eye'} size={18} />
              </button>
            </div>
          </label>

          <label className="auth-remember">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            Remember Me
          </label>

          {error ? <p className="notice error">{error}</p> : null}

          <button className="primary-button auth-submit-btn" disabled={submitting} type="submit">
            {submitting ? (
              <span className="btn-loading">
                <span className="btn-spinner" aria-hidden="true" />
                Signing in…
              </span>
            ) : 'Sign in'}
          </button>
        </form>

        <p className="auth-legal">
          <Link to="/privacy">Privacy</Link>
          {' · '}
          <Link to="/terms">Terms</Link>
        </p>
      </section>
      </main>

      <AuthFooter />
    </div>
  );
}

export default Login;
