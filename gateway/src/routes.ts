import { RouteDefinition } from './policies';

/**
 * Lista blanca explicita de rutas publicadas por el API Gateway.
 * Cualquier ruta interna no declarada aqui (/internal/*, /transactions/settle, etc.) queda inaccesible desde el exterior.
 */
export const GATEWAY_ROUTES: RouteDefinition[] = [
  // Catalogo publico anonimo (S01, S02)
  {
    id: 'S01',
    method: 'GET',
    externalPath: '/api/v1/public/products',
    targetService: 'inventory',
    internalPath: '/products',
    authentication: 'ANONYMOUS',
    authorization: { type: 'PUBLIC' },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S02',
    method: 'GET',
    externalPath: '/api/v1/public/branches',
    targetService: 'clients',
    internalPath: '/branches',
    authentication: 'ANONYMOUS',
    authorization: { type: 'PUBLIC' },
    rateLimit: 'STANDARD'
  },

  // Autenticacion y sesiones (S03 - S06)
  {
    id: 'S03',
    method: 'POST',
    externalPath: '/api/v1/auth/login',
    targetService: 'auth',
    internalPath: '/auth/login',
    authentication: 'ANONYMOUS',
    authorization: { type: 'PUBLIC' },
    rateLimit: 'AUTH'
  },
  {
    id: 'S04',
    method: 'POST',
    externalPath: '/api/v1/auth/refresh',
    targetService: 'auth',
    internalPath: '/auth/refresh',
    authentication: 'ANONYMOUS',
    authorization: { type: 'PUBLIC' },
    rateLimit: 'AUTH'
  },
  {
    id: 'S05',
    method: 'POST',
    externalPath: '/api/v1/auth/logout',
    targetService: 'auth',
    internalPath: '/auth/logout',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ANY_AUTHENTICATED' },
    rateLimit: 'AUTH',
    forwardRawTokenForLogout: true
  },
  {
    id: 'S06',
    method: 'POST',
    externalPath: '/api/v1/auth/users',
    targetService: 'auth',
    internalPath: '/auth/users',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ROLES', allowed: ['ADMINISTRADOR'] },
    rateLimit: 'STANDARD'
  },

  // Clients (S07 - S14)
  {
    id: 'S07',
    method: 'GET',
    externalPath: '/api/v1/clients/branches',
    targetService: 'clients',
    internalPath: '/branches',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ANY_AUTHENTICATED' },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S08',
    method: 'GET',
    externalPath: '/api/v1/clients/profiles',
    targetService: 'clients',
    internalPath: '/profiles',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ANY_AUTHENTICATED' },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S09',
    method: 'POST',
    externalPath: '/api/v1/clients/profiles',
    targetService: 'clients',
    internalPath: '/profiles',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ROLES', allowed: ['ADMINISTRADOR'] },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S10',
    method: 'PUT',
    externalPath: '/api/v1/clients/profiles/:id',
    targetService: 'clients',
    internalPath: '/profiles/:id',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ROLES', allowed: ['ADMINISTRADOR'] },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S11',
    method: 'GET',
    externalPath: '/api/v1/clients/employees/me',
    targetService: 'clients',
    internalPath: '/employees/me',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ANY_AUTHENTICATED' },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S12',
    method: 'GET',
    externalPath: '/api/v1/clients/employees',
    targetService: 'clients',
    internalPath: '/employees',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ROLES', allowed: ['ADMINISTRADOR'] },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S13',
    method: 'GET',
    externalPath: '/api/v1/clients/employees/:id',
    targetService: 'clients',
    internalPath: '/employees/:id',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ANY_AUTHENTICATED' },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S14',
    method: 'POST',
    externalPath: '/api/v1/clients/employees',
    targetService: 'clients',
    internalPath: '/employees',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ROLES', allowed: ['ADMINISTRADOR'] },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S15',
    method: 'PUT',
    externalPath: '/api/v1/clients/employees/:id/shift',
    targetService: 'clients',
    internalPath: '/employees/:id/shift',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ROLES', allowed: ['ADMINISTRADOR'] },
    rateLimit: 'STANDARD'
  },

  // Inventory (S16 - S23)
  {
    id: 'S16',
    method: 'GET',
    externalPath: '/api/v1/inventory/services',
    targetService: 'inventory',
    internalPath: '/services',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ANY_AUTHENTICATED' },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S17',
    method: 'POST',
    externalPath: '/api/v1/inventory/services',
    targetService: 'inventory',
    internalPath: '/services',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ROLES', allowed: ['ADMINISTRADOR'] },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S18',
    method: 'PUT',
    externalPath: '/api/v1/inventory/services/:id',
    targetService: 'inventory',
    internalPath: '/services/:id',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ROLES', allowed: ['ADMINISTRADOR'] },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S19',
    method: 'GET',
    externalPath: '/api/v1/inventory/valuations',
    targetService: 'inventory',
    internalPath: '/valuations',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ANY_AUTHENTICATED' },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S20',
    method: 'PUT',
    externalPath: '/api/v1/inventory/valuations',
    targetService: 'inventory',
    internalPath: '/valuations',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ROLES', allowed: ['ADMINISTRADOR'] },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S21',
    method: 'GET',
    externalPath: '/api/v1/inventory/products',
    targetService: 'inventory',
    internalPath: '/products',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ANY_AUTHENTICATED' },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S22',
    method: 'POST',
    externalPath: '/api/v1/inventory/products',
    targetService: 'inventory',
    internalPath: '/products',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ROLES', allowed: ['ADMINISTRADOR'] },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S23',
    method: 'PUT',
    externalPath: '/api/v1/inventory/products/:id',
    targetService: 'inventory',
    internalPath: '/products/:id',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ROLES', allowed: ['ADMINISTRADOR'] },
    rateLimit: 'STANDARD'
  },

  // Orders / Vales y Canjes (S24 - S33)
  {
    id: 'S24',
    method: 'GET',
    externalPath: '/api/v1/orders/vouchers/my',
    targetService: 'orders',
    internalPath: '/vouchers/my',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ANY_AUTHENTICATED' },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S25',
    method: 'GET',
    externalPath: '/api/v1/orders/vouchers',
    targetService: 'orders',
    internalPath: '/vouchers',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ROLES', allowed: ['ADMINISTRADOR', 'CAJERO'] },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S26',
    method: 'GET',
    externalPath: '/api/v1/orders/vouchers/by-number/:numeroVale',
    targetService: 'orders',
    internalPath: '/vouchers/by-number/:numeroVale',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ANY_AUTHENTICATED' },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S27',
    method: 'GET',
    externalPath: '/api/v1/orders/vouchers/:id',
    targetService: 'orders',
    internalPath: '/vouchers/:id',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ANY_AUTHENTICATED' },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S28',
    method: 'POST',
    externalPath: '/api/v1/orders/vouchers/issue',
    targetService: 'orders',
    internalPath: '/vouchers/issue',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ANY_AUTHENTICATED' },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S29',
    method: 'POST',
    externalPath: '/api/v1/orders/vouchers/additional',
    targetService: 'orders',
    internalPath: '/vouchers/additional',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ROLES', allowed: ['ADMINISTRADOR'] },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S30',
    method: 'POST',
    externalPath: '/api/v1/orders/vouchers/:id/print',
    targetService: 'orders',
    internalPath: '/vouchers/:id/print',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ANY_AUTHENTICATED' },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S31',
    method: 'POST',
    externalPath: '/api/v1/orders/vouchers/:id/cancel',
    targetService: 'orders',
    internalPath: '/vouchers/:id/cancel',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ROLES', allowed: ['ADMINISTRADOR'] },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S32',
    method: 'POST',
    externalPath: '/api/v1/orders/vouchers/:numeroVale/redeem',
    targetService: 'orders',
    internalPath: '/vouchers/:numeroVale/redeem',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ROLES', allowed: ['CAJERO'] },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S33',
    method: 'GET',
    externalPath: '/api/v1/orders/reports/audit',
    targetService: 'orders',
    internalPath: '/reports/audit',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ROLES', allowed: ['ADMINISTRADOR'] },
    rateLimit: 'STANDARD'
  },

  // Payments / Liquidacion, Rendicion y Avisos (S34 - S38)
  {
    id: 'S34',
    method: 'GET',
    externalPath: '/api/v1/payments/transactions',
    targetService: 'payments',
    internalPath: '/transactions',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ROLES', allowed: ['ADMINISTRADOR', 'CAJERO'] },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S35',
    method: 'GET',
    externalPath: '/api/v1/payments/reconciliation',
    targetService: 'payments',
    internalPath: '/reconciliation',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ROLES', allowed: ['ADMINISTRADOR'] },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S36',
    method: 'POST',
    externalPath: '/api/v1/payments/reconciliation/close',
    targetService: 'payments',
    internalPath: '/reconciliation/close',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ROLES', allowed: ['ADMINISTRADOR'] },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S37',
    method: 'POST',
    externalPath: '/api/v1/payments/notifications/weekly/run',
    targetService: 'payments',
    internalPath: '/notifications/weekly/run',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ROLES', allowed: ['ADMINISTRADOR'] },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S38',
    method: 'GET',
    externalPath: '/api/v1/payments/notifications/weekly',
    targetService: 'payments',
    internalPath: '/notifications/weekly',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ANY_AUTHENTICATED' },
    rateLimit: 'STANDARD'
  },

  // GraphQL Gateway Privado (S39)
  {
    id: 'S39',
    method: 'POST',
    externalPath: '/api/v1/graphql',
    targetService: 'graphql',
    internalPath: '/graphql',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ANY_AUTHENTICATED' },
    rateLimit: 'STANDARD'
  },
  {
    id: 'S39_ALIAS',
    method: 'POST',
    externalPath: '/graphql',
    targetService: 'graphql',
    internalPath: '/graphql',
    authentication: 'JWT_BEARER',
    authorization: { type: 'ANY_AUTHENTICATED' },
    rateLimit: 'STANDARD'
  }
];
