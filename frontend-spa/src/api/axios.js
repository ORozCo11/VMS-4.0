import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000/api', // Points to your local Laravel 13 server
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
});

// Automatically intercept every request and append the secure Sanctum token string if it exists
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

export default api;