import { NextFunction, Request, Response } from 'express';
import { AppError, UserContext, internalFetch } from '@libros/shared';
import { AuthorizationPolicy } from '../policies';
import { SecretProvider } from '../secretProvider';

export function authenticateBearer(secretProvider: SecretProvider) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.header('authorization') || '';
      if (!authHeader.startsWith('Bearer ')) {
        throw new AppError(401, 'UNAUTHENTICATED', 'Token Bearer requerido');
      }

      const token = authHeader.slice(7).trim();
      if (!token) {
        throw new AppError(401, 'UNAUTHENTICATED', 'Token Bearer vacio');
      }

      const authTarget = secretProvider.getTarget('auth');
      const authToken = secretProvider.getInternalToken('auth');

      const result = await internalFetch<{ valid: boolean; user: UserContext }>(
        `${authTarget.baseUrl}/auth/verify`,
        {
          method: 'POST',
          body: { token },
          internalToken: authToken,
          correlationId: req.correlationId
        }
      );

      if (!result.valid || !result.user) {
        throw new AppError(401, 'INVALID_SESSION', 'Sesion invalida o revocada');
      }

      req.userContext = result.user;
      res.locals.rawBearerToken = token;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function authorizeRoute(policy: AuthorizationPolicy) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (policy.type === 'PUBLIC') {
      next();
      return;
    }

    if (!req.userContext) {
      next(new AppError(401, 'UNAUTHENTICATED', 'Contexto de usuario no verificado'));
      return;
    }

    if (policy.type === 'ANY_AUTHENTICATED') {
      next();
      return;
    }

    if (!policy.allowed.includes(req.userContext.role)) {
      next(new AppError(403, 'FORBIDDEN', 'Su rol no tiene autorizacion para acceder a este recurso'));
      return;
    }

    next();
  };
}
