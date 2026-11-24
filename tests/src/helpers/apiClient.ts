import { randomUUID } from 'node:crypto';

export const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8080';
export const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || 'Libros2026!';

export interface ApiCallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  token?: string;
  body?: unknown;
  extraHeaders?: Record<string, string>;
  correlationId?: string;
}

export interface ApiCallResult<T = any> {
  status: number;
  data: T;
  durationMs: number;
  correlationId: string;
}

export async function apiCall<T = any>(path: string, options: ApiCallOptions = {}): Promise<ApiCallResult<T>> {
  const correlationId = options.correlationId || `tst-${randomUUID()}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Correlation-ID': correlationId,
    ...(options.extraHeaders || {})
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const startedAt = performance.now();
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const durationMs = Math.round(performance.now() - startedAt);

  const text = await res.text();
  let parsed: any = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }

  return {
    status: res.status,
    data: parsed as T,
    durationMs,
    correlationId: res.headers.get('x-correlation-id') || correlationId
  };
}

export async function graphqlCall<T = any>(
  query: string,
  token?: string,
  variables: Record<string, unknown> = {}
): Promise<ApiCallResult<{ data?: T; errors?: Array<{ message: string; extensions?: Record<string, unknown> }> }>> {
  return apiCall('/api/v1/graphql', {
    method: 'POST',
    token,
    body: { query, variables }
  });
}

export async function loginAs(codigoFuncionario: string, password = TEST_PASSWORD) {
  const res = await apiCall<{
    accessToken: string;
    refreshToken: string;
    user: { id: string; codigoFuncionario: string; role: string };
  }>('/api/v1/auth/login', {
    method: 'POST',
    body: { codigoFuncionario, password }
  });
  if (res.status !== 200 || !res.data?.accessToken) {
    throw new Error(`Login fallido para ${codigoFuncionario}: HTTP ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res;
}

export function getActiveShiftContext(): {
  activeShiftNumber: 1 | 2 | 3;
  activeEmployeeCode: string;
  inactiveEmployeeCode: string;
  expectedServiceCodes: string[];
} {
  const tz = process.env.APP_TIMEZONE || 'America/Santiago';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hour: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  let hour = Number(parts.find((p) => p.type === 'hour')?.value || '10');
  if (hour === 24) hour = 0;

  if (hour >= 8 && hour < 16) {
    return {
      activeShiftNumber: 1,
      activeEmployeeCode: 'EMP001',
      inactiveEmployeeCode: 'EMP002',
      expectedServiceCodes: ['DESAYUNO', 'ALMUERZO']
    };
  }
  if (hour >= 16 && hour < 24) {
    return {
      activeShiftNumber: 2,
      activeEmployeeCode: 'EMP002',
      inactiveEmployeeCode: 'EMP001',
      expectedServiceCodes: ['ONCE', 'CENA1']
    };
  }
  return {
    activeShiftNumber: 3,
    activeEmployeeCode: 'EMP003',
    inactiveEmployeeCode: 'EMP001',
    expectedServiceCodes: ['CENA2', 'DESAYUNO']
  };
}
