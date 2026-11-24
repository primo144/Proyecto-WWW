import { apiRequest, clearSession, getStoredSession, saveSession } from './api.js';

export function getCurrentSession() {
  return getStoredSession();
}

export async function loginWithCredentials(codigoFuncionario, password) {
  const { data, correlationId } = await apiRequest(
    '/api/v1/auth/login',
    {
      method: 'POST',
      anonymous: true,
      body: { codigoFuncionario, password }
    },
    false
  );

  saveSession({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    user: data.user
  });

  return { user: data.user, correlationId };
}

export async function logoutSession() {
  const session = getStoredSession();
  if (session?.accessToken) {
    try {
      await apiRequest('/api/v1/auth/logout', { method: 'POST', body: {} }, false);
    } catch {
      // Si el token ya expiro, igual limpiamos el estado local
    }
  }
  clearSession();
}
