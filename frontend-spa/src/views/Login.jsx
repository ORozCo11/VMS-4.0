import { useContext, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import vmsLogo from '../assets/vms-logo.png';
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
      name: 'Roel Degulacion',
      email: 'admin@barangay.gov',
      password: 'admin123',
    },
    Custodian: {
      name: 'Nicole',
      email: 'custodian@barangay.gov',
      password: 'custodian123',
    },
    'Maintenance Personnel': {
      name: 'Toto Bongo',
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
    const { email, password } = demoAccounts[role];
    setCredentials({ email, password });
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
          <img className="auth-logo-image" src={vmsLogo} alt="Vehicle Management" />
          <p className="eyebrow">Barangay VMS</p>
          <h1 id="login-title">Sign in</h1>
          <p className="auth-subtitle">
            Use your assigned account to access the fleet workspace.
          </p>
        </div>

        <div className="demo-account-grid" aria-label="Demo account shortcuts">
          <button className="demo-account-button admin" onClick={() => loadDemoAccount('Admin')} type="button">
            <span>Admin</span>
            <small>{demoAccounts.Admin.name}</small>
          </button>
          <button className="demo-account-button custodian" onClick={() => loadDemoAccount('Custodian')} type="button">
            <span>Custodian</span>
            <small>{demoAccounts.Custodian.name}</small>
          </button>
          <button className="demo-account-button maintenance" onClick={() => loadDemoAccount('Maintenance Personnel')} type="button">
            <span>Maintenance</span>
            <small>{demoAccounts['Maintenance Personnel'].name}</small>
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
            {submitting ? (
              <span className="btn-loading">
                <span className="btn-spinner" aria-hidden="true" />
                Signing in…
              </span>
            ) : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}

export default Login;
