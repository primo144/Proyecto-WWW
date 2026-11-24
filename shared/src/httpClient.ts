import { AppError } from './errors';
import { UserContext } from './types';

export interface InternalFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  internalToken: string;
  correlationId?: string;
  userContext?: UserContext;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
}

export async function internalFetch<T>(url: string, options: InternalFetchOptions): Promise<T> {
  const timeoutMs = options.timeoutMs ?? Number(process.env.UPSTREAM_TIMEOUT_MS || 4000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    'x-internal-service-token': options.internalToken,
    Accept: 'application/json',
    ...options.extraHeaders
  };

  if (options.correlationId) {
    headers['x-correlation-id'] = options.correlationId;
  }
  if (options.userContext) {
    headers['x-user-id'] = options.userContext.userId;
    headers['x-user-role'] = options.userContext.role;
    headers['x-user-code'] = options.userContext.codigoFuncionario;
    if (options.userContext.sucursalId) {
      headers['x-user-branch-id'] = options.userContext.sucursalId;
    }
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AppError(504, 'UPSTREAM_TIMEOUT', `Tiempo de espera agotado al consultar servicio interno`);
    }
    throw new AppError(503, 'UPSTREAM_UNAVAILABLE', `Servicio interno temporalmente no disponible`);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }

  if (!response.ok) {
    const errObj = (parsed as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new AppError(
      response.status,
      errObj?.code || 'UPSTREAM_ERROR',
      errObj?.message || `Error HTTP ${response.status} desde servicio interno`,
      errObj?.details
    );
  }

  return parsed as T;
}
