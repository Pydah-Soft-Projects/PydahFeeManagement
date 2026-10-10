/**
 * Valid React Router paths in this app.
 * Used to ensure we never navigate to file paths or invalid URLs.
 */
export const APP_ROUTES = [
  '/dashboard',
  '/fee-config',
  '/bulk-fee-upload',
  '/payment-config',
  '/reminders',
  '/academic-calendar',
  '/students',
  '/fee-collection',
  '/reports',
  '/due-reports',
  '/concessions',
  '/overall-concessions',
  '/transport-config',
  '/hostel-config',
  '/permissions',
  '/user-management',
  '/settings',
  '/user-profile',
  '/ai-assistant',
  '/proceedings',
  '/transaction-dates',
];

const ROUTE_SET = new Set(APP_ROUTES);

export const isValidAppRoute = (path) => ROUTE_SET.has(path);

/**
 * Persist login response in localStorage.
 */
export const persistAuthSession = (user, { isSSO = false } = {}) => {
  if (!user?.token) return false;
  localStorage.setItem('user', JSON.stringify(user));
  localStorage.setItem('token', user.token);
  if (user.sessionId) {
    localStorage.setItem('sessionId', user.sessionId);
  }
  if (isSSO) {
    localStorage.setItem('isSSO', 'true');
  } else {
    localStorage.removeItem('isSSO');
  }
  return true;
};

export const getStoredUser = () => {
  try {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const isAuthenticated = () => {
  return Boolean(localStorage.getItem('token') && getStoredUser());
};

import { clearFeeCollectionCache } from './feeCollectionCache';

export const clearAuthSession = () => {
  localStorage.removeItem('user');
  localStorage.removeItem('token');
  localStorage.removeItem('isSSO');
  localStorage.removeItem('sessionId');
  sessionStorage.clear();
  clearFeeCollectionCache();
};

/**
 * Where to send the user immediately after login.
 * Always use a real app route — never a source file path.
 */
export const getPostLoginRoute = (user) => {
  if (!user) return '/login';

  // Cashiers work primarily in fee collection
  if (user.role === 'cashier') {
    return '/fee-collection';
  }

  // Default landing page for every other authenticated role
  return '/dashboard';
};
