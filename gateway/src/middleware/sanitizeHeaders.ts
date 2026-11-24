import { NextFunction, Request, Response } from 'express';

const SPOOFABLE_INTERNAL_HEADERS = [
  'x-user-id',
  'x-user-role',
  'x-user-code',
  'x-user-branch-id',
  'x-user-token',
  'x-internal-service-token'
];

/**
 * Elimina incondicionalmente cualquier cabecera interna enviada por el cliente externo
 * para evitar falsificacion de identidad o rol.
 */
export function sanitizeIncomingHeaders(req: Request, _res: Response, next: NextFunction): void {
  for (const header of SPOOFABLE_INTERNAL_HEADERS) {
    delete req.headers[header];
  }
  req.userContext = undefined;
  next();
}
