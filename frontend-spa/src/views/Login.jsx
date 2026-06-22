import { useContext, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import api from '../api/axios';
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
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const demoAccounts = {
    Admin: {
      email: 'admin@barangay.gov',
      password: 'admin123',
    },
    Custodian: {
      email: 'custodian@barangay.gov',
      password: 'custodian123',
    },
    'Maintenance Personnel': {
      email: 'maintenance@barangay.gov',
      password: 'maintenance123',
    },
  };

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

  const loadDemoAccount = (role) => {
    setError('');
    setCredentials(demoAccounts[role]);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const response = await api.post('/login', credentials);
      const { user: authenticatedUser, access_token: accessToken } = response.data;

      login(authenticatedUser, accessToken);
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
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-logo-header">
          <div className="auth-logo-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="logo-svg">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              <polyline points="12 8 12 12 15 14"></polyline>
            </svg>
          </div>
          <p className="eyebrow">Barangay VMS</p>
          <h1 id="login-title">Sign in</h1>
          <p className="auth-subtitle">
            Use your assigned account to access the fleet workspace.
          </p>
        </div>

        <div className="demo-account-grid" aria-label="Demo account shortcuts">
          <button className="demo-account-button admin" onClick={() => loadDemoAccount('Admin')} type="button">
            Admin
          </button>
          <button className="demo-account-button custodian" onClick={() => loadDemoAccount('Custodian')} type="button">
            Custodian
          </button>
          <button className="demo-account-button maintenance" onClick={() => loadDemoAccount('Maintenance Personnel')} type="button">
            Maintenance
          </button>
        </div>

        <form className="smart-form" autoComplete="off" onSubmit={handleSubmit}>
          <label>
            <span>Email Address</span>
            <input
              autoComplete="off"
              name="email"
              onChange={handleChange}
              placeholder="name@barangay.gov"
              required
              type="email"
              value={credentials.email}
            />
          </label>

          <label>
            <span>Password</span>
            <input
              autoComplete="off"
              name="password"
              onChange={handleChange}
              placeholder="••••••••"
              required
              type="password"
              value={credentials.password}
            />
          </label>

          {error ? <p className="notice error">{error}</p> : null}

          <button className="primary-button" disabled={submitting} type="submit">
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}

export default Login;
