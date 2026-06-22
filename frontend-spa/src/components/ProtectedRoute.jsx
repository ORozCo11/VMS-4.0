import { useContext } from 'react';
import { Navigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContextObject';

export const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, token, loading } = useContext(AuthContext);

  // Pause rendering while checking for an existing browser session token
  if (loading) return <div className="loading">Verifying security credentials...</div>;

  // If not logged in, redirect them immediately back to the main login portal
  if (!token) {
    return <Navigate to="/login" replace />;
  }

  // If logged in but lacks the required role, bounce them to an unauthorized alert view
  if (allowedRoles && !allowedRoles.includes(user?.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  // Render the page workspace if security validations pass successfully
  return children;
};
