import { Request, Response, NextFunction } from 'express';
import { AppError } from '@libros/shared';
import { RouteDefinition } from './policies';
import { SecretProvider } from './secretProvider';

function buildTargetPath(template: string, params: Record<string, string | string[]>): string {
  let result = template;
  for (const [key, value] of Object.entries(params)) {
    const strVal = Array.isArray(value) ? (value[0] || '') : value;
    result = result.replace(`:${key}`, encodeURIComponent(strVal));
  }
  return result;
}

export function forwardToTarget(route: RouteDefinition, secretProvider: SecretProvider) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const target = secretProvider.getTarget(route.targetService);
    const timeoutMs = Number(process.env.UPSTREAM_TIMEOUT_MS || 4000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const internalToken = secretProvider.getInternalToken(route.targetService);
      const resolvedPath = buildTargetPath(route.internalPath, req.params);
      const queryIndex = req.originalUrl.indexOf('?');
      const querySuffix = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';
      const upstreamUrl = `${target.baseUrl}${resolvedPath}${querySuffix}`;

      const headers: Record<string, string> = {
        'x-internal-service-token': internalToken,
        'x-correlation-id': req.correlationId || '',
        Accept: 'application/json'
      };

      if (req.userContext) {
        headers['x-user-id'] = req.userContext.userId;
        headers['x-user-role'] = req.userContext.role;
        headers['x-user-code'] = req.userContext.codigoFuncionario;
        if (req.userContext.sucursalId) {
          headers['x-user-branch-id'] = req.userContext.sucursalId;
        }
      }

      if (route.forwardRawTokenForLogout && typeof res.locals.rawBearerToken === 'string') {
        headers['x-user-token'] = res.locals.rawBearerToken;
      }

      const hasBody = route.method === 'POST' || route.method === 'PUT';
      if (hasBody) {
        headers['Content-Type'] = 'application/json';
      }

      const upstreamRes = await fetch(upstreamUrl, {
        method: route.method,
        headers,
        body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
        signal: controller.signal
      });

      const contentType = upstreamRes.headers.get('content-type') || 'application/json';
      const bodyText = await upstreamRes.text();

      res.status(upstreamRes.status);
      res.setHeader('Content-Type', contentType);
      res.send(bodyText);
    } catch (err: unknown) {
      if (err instanceof AppError) {
        next(err);
        return;
      }
      if (err instanceof Error && err.name === 'AbortError') {
        next(new AppError(504, 'GATEWAY_TIMEOUT', `El servicio ${route.targetService} excedio el tiempo limite de respuesta`));
        return;
      }
      next(new AppError(503, 'SERVICE_UNAVAILABLE', `El servicio ${route.targetService} no se encuentra disponible temporalmente`));
    } finally {
      clearTimeout(timer);
    }
  };
}
