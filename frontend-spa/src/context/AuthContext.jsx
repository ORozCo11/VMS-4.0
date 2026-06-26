import { useState, useEffect } from 'react';
import api from '../api/axios';
import { AuthContext } from './AuthContextObject';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token') || null);
  const [loading, setLoading] = useState(true);

  const logout = () => {
    // Clear local state immediately so the UI reacts right away,
    // then invalidate the server-side token in the background.
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    api.post('/logout').catch(() => {});
  };

  useEffect(() => {
    const checkUserSession = async () => {
      if (token) {
        try {
          const response = await api.get('/user'); 
          setUser(response.data);
        } catch {
          logout(); 
        }
      }
      setLoading(false);
    };
    checkUserSession();
  }, [token]);

  const login = (userData, userToken) => {
    localStorage.setItem('token', userToken);
    setToken(userToken);
    setUser(userData);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
