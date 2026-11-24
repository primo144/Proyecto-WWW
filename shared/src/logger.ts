import pino, { Logger } from 'pino';

export function createLogger(serviceName: string): Logger {
  return pino({
    name: serviceName,
    level: process.env.LOG_LEVEL || 'info',
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-internal-service-token"]',
        'headers.authorization',
        'headers["x-internal-service-token"]',
        '*.password',
        '*.passwordHash',
        '*.token',
        '*.accessToken',
        '*.refreshToken',
        '*.secret',
        '*.emailApiKey'
      ],
      censor: '***REDACTED***'
    },
    formatters: {
      level(label) {
        return { level: label };
      }
    },
    timestamp: pino.stdTimeFunctions.isoTime
  });
}
