import { UserRole } from '@libros/shared';
import { ServiceTargetId } from './secretProvider';

export type AuthenticationPolicy = 'ANONYMOUS' | 'JWT_BEARER';

export type AuthorizationPolicy =
  | { type: 'PUBLIC' }
  | { type: 'ANY_AUTHENTICATED' }
  | { type: 'ROLES'; allowed: UserRole[] };

export type RateLimitTier = 'AUTH' | 'STANDARD';

export interface RouteDefinition {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  externalPath: string;
  targetService: ServiceTargetId;
  internalPath: string;
  authentication: AuthenticationPolicy;
  authorization: AuthorizationPolicy;
  rateLimit: RateLimitTier;
  forwardRawTokenForLogout?: boolean;
}
