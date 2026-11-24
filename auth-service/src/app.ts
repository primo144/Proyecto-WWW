import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';
import { z } from 'zod';
import {
  AppError,
  UserRole,
  correlationIdMiddleware,
  createLogger,
  errorHandler,
  extractUserContext,
  requireInternalToken,
  requireRoles
} from '@libros/shared';
import { prisma } from './db';

const logger = createLogger('auth-service');

const loginSchema = z.object({
  codigoFuncionario: z.string().trim().min(3).max(32),
  password: z.string().min(6).max(128)
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20)
});

const verifySchema = z.object({
  token: z.string().min(20)
});

const createUserSchema = z.object({
  id: z.string().uuid().optional(),
  codigoFuncionario: z.string().trim().min(3).max(32),
  password: z.string().min(8).max(128),
  rol: z.enum(['FUNCIONARIO', 'CAJERO', 'ADMINISTRADOR'])
});

interface AccessTokenPayload {
  sub: string;
  codigoFuncionario: string;
  role: UserRole;
  sid: string;
  type: 'access';
}

interface RefreshTokenPayload {
  sub: string;
  sid: string;
  type: 'refresh';
}

function getJwtSecret(): string {
  return process.env.JWT_SECRET || 'DEV_ONLY_FALLBACK_JWT_SECRET_NOT_FOR_PROD';
}

function getRefreshSecret(): string {
  return process.env.JWT_REFRESH_SECRET || 'DEV_ONLY_FALLBACK_REFRESH_SECRET_NOT_FOR_PROD';
}

function parseDurationMs(expr: string, fallbackMs: number): number {
  const match = /^(\d+)([smhd])$/.exec(expr.trim());
  if (!match) return fallbackMs;
  const val = Number(match[1]);
  const unit = match[2];
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return val * mult;
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use(correlationIdMiddleware(logger));

  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', service: 'auth-service' });
    } catch {
      res.status(503).json({ status: 'degraded', service: 'auth-service' });
    }
  });

  app.use(requireInternalToken(() => process.env.INTERNAL_TOKEN_AUTH || ''));
  app.use(extractUserContext);

  // CU1: Login con codigo de funcionario y password
  app.post('/auth/login', async (req, res, next) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Credenciales con formato invalido', parsed.error.flatten());
      }

      const codigo = parsed.data.codigoFuncionario.toUpperCase();
      const user = await prisma.user.findUnique({ where: { codigoFuncionario: codigo } });
      if (!user || !user.activo) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Codigo de funcionario o contrasena incorrectos');
      }

      const validPassword = await bcrypt.compare(parsed.data.password, user.passwordHash);
      if (!validPassword) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Codigo de funcionario o contrasena incorrectos');
      }

      const sessionId = randomUUID();
      const refreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
      const accessExpiresIn = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
      const expiresAt = new Date(Date.now() + parseDurationMs(refreshExpiresIn, 7 * 86_400_000));

      const refreshPayload: RefreshTokenPayload = {
        sub: user.id,
        sid: sessionId,
        type: 'refresh'
      };
      const refreshToken = jwt.sign(refreshPayload, getRefreshSecret(), {
        expiresIn: refreshExpiresIn as SignOptions['expiresIn']
      });
      const refreshTokenHash = await bcrypt.hash(refreshToken, 8);

      await prisma.session.create({
        data: {
          id: sessionId,
          userId: user.id,
          refreshTokenHash,
          expiresAt,
          userAgent: req.header('user-agent')?.slice(0, 250) || 'web-client'
        }
      });

      const accessPayload: AccessTokenPayload = {
        sub: user.id,
        codigoFuncionario: user.codigoFuncionario,
        role: user.rol as UserRole,
        sid: sessionId,
        type: 'access'
      };
      const accessToken = jwt.sign(accessPayload, getJwtSecret(), {
        expiresIn: accessExpiresIn as SignOptions['expiresIn']
      });

      res.json({
        accessToken,
        refreshToken,
        expiresIn: accessExpiresIn,
        user: {
          id: user.id,
          codigoFuncionario: user.codigoFuncionario,
          role: user.rol
        }
      });
    } catch (err) {
      next(err);
    }
  });

  // Verificacion de JWT + sesion activa (usado por API Gateway en cada ruta protegida)
  app.post('/auth/verify', async (req, res, next) => {
    try {
      const parsed = verifySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(401, 'INVALID_TOKEN', 'Token no proporcionado o invalido');
      }

      let payload: AccessTokenPayload;
      try {
        payload = jwt.verify(parsed.data.token, getJwtSecret()) as AccessTokenPayload;
      } catch {
        throw new AppError(401, 'TOKEN_EXPIRED_OR_INVALID', 'Sesion invalida o expirada');
      }

      if (payload.type !== 'access' || !payload.sid || !payload.sub) {
        throw new AppError(401, 'INVALID_TOKEN_TYPE', 'Tipo de token invalido');
      }

      const session = await prisma.session.findUnique({
        where: { id: payload.sid },
        include: { user: true }
      });

      if (!session || session.revokedAt !== null || session.expiresAt < new Date() || !session.user.activo) {
        throw new AppError(401, 'SESSION_REVOKED', 'La sesion fue revocada o expiro');
      }

      res.json({
        valid: true,
        user: {
          userId: session.user.id,
          codigoFuncionario: session.user.codigoFuncionario,
          role: session.user.rol
        }
      });
    } catch (err) {
      next(err);
    }
  });

  // Renovacion de sesion
  app.post('/auth/refresh', async (req, res, next) => {
    try {
      const parsed = refreshSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Refresh token requerido');
      }

      let payload: RefreshTokenPayload;
      try {
        payload = jwt.verify(parsed.data.refreshToken, getRefreshSecret()) as RefreshTokenPayload;
      } catch {
        throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token invalido o expirado');
      }

      const session = await prisma.session.findUnique({
        where: { id: payload.sid },
        include: { user: true }
      });

      if (!session || session.revokedAt !== null || session.expiresAt < new Date() || !session.user.activo) {
        throw new AppError(401, 'SESSION_REVOKED', 'La sesion no es valida');
      }

      const matches = await bcrypt.compare(parsed.data.refreshToken, session.refreshTokenHash);
      if (!matches) {
        throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token no coincide con la sesion');
      }

      const accessExpiresIn = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
      const accessPayload: AccessTokenPayload = {
        sub: session.user.id,
        codigoFuncionario: session.user.codigoFuncionario,
        role: session.user.rol as UserRole,
        sid: session.id,
        type: 'access'
      };
      const accessToken = jwt.sign(accessPayload, getJwtSecret(), {
        expiresIn: accessExpiresIn as SignOptions['expiresIn']
      });

      res.json({
        accessToken,
        expiresIn: accessExpiresIn,
        user: {
          id: session.user.id,
          codigoFuncionario: session.user.codigoFuncionario,
          role: session.user.rol
        }
      });
    } catch (err) {
      next(err);
    }
  });

  // Cierre de sesion (revocacion real en PostgreSQL)
  app.post('/auth/logout', async (req, res, next) => {
    try {
      const authHeader = req.header('x-user-token') || '';
      if (authHeader) {
        try {
          const decoded = jwt.verify(authHeader, getJwtSecret()) as AccessTokenPayload;
          if (decoded.sid) {
            await prisma.session.updateMany({
              where: { id: decoded.sid, revokedAt: null },
              data: { revokedAt: new Date() }
            });
          }
        } catch {
          // Si ya expiro, igual respondemos cierre limpio
        }
      } else if (req.userContext?.userId) {
        await prisma.session.updateMany({
          where: { userId: req.userContext.userId, revokedAt: null },
          data: { revokedAt: new Date() }
        });
      }

      res.json({ ok: true, message: 'Sesion cerrada y revocada correctamente' });
    } catch (err) {
      next(err);
    }
  });

  // Registro administrativo de credenciales
  app.post('/auth/users', requireRoles('ADMINISTRADOR'), async (req, res, next) => {
    try {
      const parsed = createUserSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Datos invalidos para registrar usuario', parsed.error.flatten());
      }

      const codigo = parsed.data.codigoFuncionario.toUpperCase();
      const existing = await prisma.user.findUnique({ where: { codigoFuncionario: codigo } });
      if (existing) {
        throw new AppError(409, 'USER_ALREADY_EXISTS', `Ya existe una credencial para ${codigo}`);
      }

      const passwordHash = await bcrypt.hash(parsed.data.password, 10);
      const created = await prisma.user.create({
        data: {
          ...(parsed.data.id ? { id: parsed.data.id } : {}),
          codigoFuncionario: codigo,
          passwordHash,
          rol: parsed.data.rol,
          activo: true
        }
      });

      res.status(201).json({
        id: created.id,
        codigoFuncionario: created.codigoFuncionario,
        rol: created.rol,
        activo: created.activo
      });
    } catch (err) {
      next(err);
    }
  });

  app.use(errorHandler(logger));
  return app;
}
