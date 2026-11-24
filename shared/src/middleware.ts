import { randomUUID, timingSafeEqual } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { Logger } from 'pino';
import { AppError } from './errors';
import { UserRole } from './types';

function safeStringCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function correlationIdMiddleware(logger?: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.header('x-correlation-id');
    const correlationId = incoming && incoming.trim().length > 0 ? incoming.trim() : randomUUID();
    req.correlationId = correlationId;
    res.setHeader('X-Correlation-ID', correlationId);

    if (logger) {
      const start = Date.now();
      res.on('finish', () => {
        if (req.path === '/health') return;
        logger.info(
          {
            correlationId,
            method: req.method,
            path: req.originalUrl,
            statusCode: res.statusCode,
            durationMs: Date.now() - start,
            userId: req.userContext?.userId,
            userRole: req.userContext?.role
          },
          'HTTP request completed'
        );
      });
    }

    next();
  };
}

export function requireInternalToken(expectedTokenProvider: () => string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const expected = expectedTokenProvider();
    if (!expected) {
      next(new AppError(500, 'MISCONFIGURED_INTERNAL_SECRET', 'Token interno del servicio no configurado'));
      return;
    }

    const provided = req.header('x-internal-service-token') || '';
    if (!provided || !safeStringCompare(provided, expected)) {
      next(new AppError(401, 'UNAUTHORIZED_INTERNAL_CALL', 'Acceso directo no autorizado al servicio interno'));
      return;
    }

    next();
  };
}

export function extractUserContext(req: Request, _res: Response, next: NextFunction): void {
  const userId = req.header('x-user-id');
  const role = req.header('x-user-role') as UserRole | undefined;
  const codigoFuncionario = req.header('x-user-code') || '';
  const sucursalId = req.header('x-user-branch-id');

  if (userId && role && (role === 'FUNCIONARIO' || role === 'CAJERO' || role === 'ADMINISTRADOR')) {
    req.userContext = {
      userId,
      role,
      codigoFuncionario,
      sucursalId: sucursalId || undefined
    };
  }

  next();
}

export function requireAuthenticatedContext(req: Request, _res: Response, next: NextFunction): void {
  if (!req.userContext) {
    next(new AppError(401, 'UNAUTHENTICATED', 'Se requiere contexto de usuario autenticado'));
    return;
  }
  next();
}

export function getParam(req: Request, name: string): string {
  const val = req.params[name];
  if (Array.isArray(val)) return val[0] || '';
  return val || '';
}

export function requireRoles(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.userContext) {
      next(new AppError(401, 'UNAUTHENTICATED', 'Se requiere contexto de usuario autenticado'));
      return;
    }
    if (!allowedRoles.includes(req.userContext.role)) {
      next(new AppError(403, 'FORBIDDEN', 'El rol actual no tiene permisos para ejecutar esta operacion'));
      return;
    }
    next();
  };
}
