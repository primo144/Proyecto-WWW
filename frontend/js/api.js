const SESSION_STORAGE_KEY = 'libros_impresos_session_v1';

export class ApiClientError extends Error {
  constructor(status, code, message, correlationId, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
    this.details = details;
  }
}

export function getStoredSession() {
  const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveSession(sessionData) {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionData));
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

let unauthorizedHandler = null;
export function onSessionExpired(callback) {
  unauthorizedHandler = callback;
}

function createCorrelationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `web-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function updateCorrelationFooter(correlationId) {
  const chip = document.querySelector('#correlation-status');
  if (chip) {
    chip.textContent = `CID: ${correlationId}`;
  }
}

async function tryRefreshAccessToken() {
  const session = getStoredSession();
  if (!session || !session.refreshToken) return false;

  const correlationId = createCorrelationId();
  try {
    const res = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId
      },
      body: JSON.stringify({ refreshToken: session.refreshToken })
    });
    if (!res.ok) return false;
    const data = await res.json();
    saveSession({
      ...session,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || session.refreshToken,
      user: data.user || session.user
    });
    return true;
  } catch {
    return false;
  }
}

export async function apiRequest(path, options = {}, allowRetry = true) {
  const session = getStoredSession();
  const correlationId = createCorrelationId();
  updateCorrelationFooter(correlationId);

  const headers = {
    Accept: 'application/json',
    'X-Correlation-ID': correlationId,
    ...(options.headers || {})
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (!options.anonymous && session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }

  let response;
  try {
    response = await fetch(path, {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
  } catch {
    throw new ApiClientError(
      0,
      'NETWORK_ERROR',
      'No fue posible conectar con el API Gateway. Verifique que los contenedores esten activos.',
      correlationId
    );
  }

  const respCorrelationId = response.headers.get('X-Correlation-ID') || correlationId;
  updateCorrelationFooter(respCorrelationId);

  if (response.status === 401 && !options.anonymous && allowRetry && session?.refreshToken) {
    const refreshed = await tryRefreshAccessToken();
    if (refreshed) {
      return apiRequest(path, options, false);
    }
    clearSession();
    if (unauthorizedHandler) unauthorizedHandler();
  }

  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }

  if (!response.ok) {
    const errObj = parsed?.error || {};
    throw new ApiClientError(
      response.status,
      errObj.code || `HTTP_${response.status}`,
      errObj.message || `Error ${response.status} al comunicarse con el servidor.`,
      errObj.correlationId || respCorrelationId,
      errObj.details || null
    );
  }

  return { data: parsed, correlationId: respCorrelationId };
}

export async function graphqlRequest(query, variables = {}) {
  const { data, correlationId } = await apiRequest('/api/v1/graphql', {
    method: 'POST',
    body: { query, variables }
  });

  if (Array.isArray(data?.errors) && data.errors.length > 0 && !data?.data) {
    const first = data.errors[0];
    throw new ApiClientError(
      400,
      first.extensions?.code || 'GRAPHQL_ERROR',
      first.message || 'Error al ejecutar consulta GraphQL',
      correlationId,
      data.errors
    );
  }

  return { data: data.data, errors: data.errors || [], correlationId };
}
