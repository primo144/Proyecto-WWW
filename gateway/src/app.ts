import cors from 'cors';
import express, { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { AppError, correlationIdMiddleware, createLogger, errorHandler } from '@libros/shared';
import { authenticateBearer, authorizeRoute } from './middleware/authenticate';
import { sanitizeIncomingHeaders } from './middleware/sanitizeHeaders';
import { forwardToTarget } from './proxy';
import { GATEWAY_ROUTES } from './routes';
import { SecretProvider } from './secretProvider';

const logger = createLogger('api-gateway');

export function createApp() {
  const app = express();
  const secretProvider = new SecretProvider();

  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID'],
      exposedHeaders: ['X-Correlation-ID']
    })
  );
  app.use(express.json({ limit: '128kb' }));
  app.use(correlationIdMiddleware(logger));
  app.use(sanitizeIncomingHeaders);

  const authLimiter = rateLimit({
    windowMs: 60_000,
    max: Number(process.env.RATE_LIMIT_AUTH_MAX || 120),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Demasiados intentos de autenticacion. Intente nuevamente en un minuto.',
          correlationId: req.correlationId
        }
      });
    }
  });

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    max: Number(process.env.RATE_LIMIT_API_MAX || 2000),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Limite de solicitudes por minuto excedido.',
          correlationId: req.correlationId
        }
      });
    }
  });

  // Healthcheck agregado (sin exponer secretos ni tokens)
  app.get('/health', async (_req, res) => {
    const targets = secretProvider.listTargets();
    const checks = await Promise.all(
      targets.map(async (t) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1500);
        try {
          const r = await fetch(`${t.baseUrl}/health`, { signal: controller.signal });
          clearTimeout(timer);
          return { service: t.id, status: r.ok ? 'ok' : 'degraded' };
        } catch {
          clearTimeout(timer);
          return { service: t.id, status: 'unavailable' };
        }
      })
    );

    const anyDown = checks.some((c) => c.status !== 'ok');
    res.status(200).json({
      status: anyDown ? 'degraded' : 'ok',
      service: 'api-gateway',
      upstreams: checks
    });
  });

  const requireJwt = authenticateBearer(secretProvider);

  for (const route of GATEWAY_ROUTES) {
    const middlewares: RequestHandler[] = [];
    middlewares.push(route.rateLimit === 'AUTH' ? authLimiter : apiLimiter);
    if (route.authentication === 'JWT_BEARER') {
      middlewares.push(requireJwt);
    }
    middlewares.push(authorizeRoute(route.authorization));
    middlewares.push(forwardToTarget(route, secretProvider));

    if (route.method === 'GET') app.get(route.externalPath, ...middlewares);
    else if (route.method === 'POST') app.post(route.externalPath, ...middlewares);
    else if (route.method === 'PUT') app.put(route.externalPath, ...middlewares);
    else if (route.method === 'DELETE') app.delete(route.externalPath, ...middlewares);
  }

  app.use((req, _res, next) => {
    next(new AppError(404, 'ROUTE_NOT_FOUND', `Ruta no permitida o inexistente en API Gateway: ${req.method} ${req.path}`));
  });

  app.use(errorHandler(logger));
  return app;
}
