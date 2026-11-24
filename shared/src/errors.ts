import { NextFunction, Request, Response } from 'express';
import { Logger } from 'pino';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function errorHandler(logger: Logger) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const correlationId = req.correlationId || 'unknown';

    if (err instanceof AppError) {
      logger.warn(
        {
          correlationId,
          code: err.code,
          statusCode: err.statusCode,
          path: req.originalUrl,
          method: req.method
        },
        err.message
      );
      res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
          correlationId
        }
      });
      return;
    }

    const message = err instanceof Error ? err.message : 'Error interno inesperado';
    logger.error(
      {
        correlationId,
        path: req.originalUrl,
        method: req.method,
        errorMessage: message
      },
      'Unhandled service error'
    );

    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Ocurrio un error interno al procesar la solicitud.',
        correlationId
      }
    });
  };
}
