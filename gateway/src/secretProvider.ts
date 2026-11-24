import { AppError } from '@libros/shared';

export type ServiceTargetId = 'auth' | 'clients' | 'inventory' | 'orders' | 'payments' | 'graphql';

export interface ServiceTarget {
  id: ServiceTargetId;
  baseUrl: string;
  secretRef: string;
}

/**
 * SecretProvider resuelve en tiempo de ejecucion las credenciales simbolicas de cada tramo interno.
 * Ningun secreto se expone al navegador ni se registra en logs.
 */
export class SecretProvider {
  private readonly targets: Record<ServiceTargetId, ServiceTarget>;

  constructor() {
    this.targets = {
      auth: {
        id: 'auth',
        baseUrl: process.env.AUTH_SERVICE_URL || 'http://auth-service:4001',
        secretRef: 'INTERNAL_TOKEN_AUTH'
      },
      clients: {
        id: 'clients',
        baseUrl: process.env.CLIENTS_SERVICE_URL || 'http://clients:4002',
        secretRef: 'INTERNAL_TOKEN_CLIENTS'
      },
      inventory: {
        id: 'inventory',
        baseUrl: process.env.INVENTORY_SERVICE_URL || 'http://inventory:4003',
        secretRef: 'INTERNAL_TOKEN_INVENTORY'
      },
      orders: {
        id: 'orders',
        baseUrl: process.env.ORDERS_SERVICE_URL || 'http://orders:4004',
        secretRef: 'INTERNAL_TOKEN_ORDERS'
      },
      payments: {
        id: 'payments',
        baseUrl: process.env.PAYMENTS_SERVICE_URL || 'http://payments:4005',
        secretRef: 'INTERNAL_TOKEN_PAYMENTS'
      },
      graphql: {
        id: 'graphql',
        baseUrl: process.env.GRAPHQL_GATEWAY_URL || 'http://graphql-gateway:4006',
        secretRef: 'INTERNAL_TOKEN_GRAPHQL'
      }
    };
  }

  public getTarget(id: ServiceTargetId): ServiceTarget {
    return this.targets[id];
  }

  public getInternalToken(id: ServiceTargetId): string {
    const target = this.targets[id];
    const value = process.env[target.secretRef];
    if (!value) {
      throw new AppError(500, 'SECRET_NOT_AVAILABLE', `Referencia de secreto ${target.secretRef} no configurada en el entorno`);
    }
    return value;
  }

  public listTargets(): ServiceTarget[] {
    return Object.values(this.targets);
  }
}
