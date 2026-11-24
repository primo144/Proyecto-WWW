export type UserRole = 'FUNCIONARIO' | 'CAJERO' | 'ADMINISTRADOR';

export type VoucherStatus = 'EMITIDO' | 'IMPRESO' | 'CANJEADO' | 'ANULADO';

export type VoucherType = 'NORMAL_TURNO' | 'ADICIONAL_REUNION' | 'VISITA_NO_PERSONALIZADO';

export type ShiftNumber = 1 | 2 | 3;

export interface UserContext {
  userId: string;
  codigoFuncionario: string;
  role: UserRole;
  sucursalId?: string;
}

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
      userContext?: UserContext;
    }
  }
}
