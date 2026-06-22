import { useState, useEffect } from 'react';
import api from '../api/axios';
import { AuthContext } from './AuthContextObject';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token') || null);
  const [loading, setLoading] = useState(true);

  const logout = async () => {
    try {
      await api.post('/logout'); 
    } catch {
      // Proceed even if backend token state is already invalid
    }
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
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
