import DataLoader from 'dataloader';
import { UserContext, internalFetch } from '@libros/shared';

export interface EmployeeRecord {
  id: string;
  codigoFuncionario: string;
  rut?: string;
  nombreCompleto: string;
  email?: string;
  rol: string;
  activo: boolean;
  perfil: {
    id: string;
    codigo: string;
    nombre: string;
    permiteMultiVale: boolean;
    maxValesPorHorario: number;
  };
  sucursalBase: {
    id: string;
    codigo: string;
    nombre: string;
  };
  turnoActual: {
    anio: number;
    mes: number;
    numeroTurno: number;
    horarioLabel: string;
    sucursalAsignadaCodigo: string;
    sucursalAsignadaNombre: string;
  } | null;
}

export interface Loaders {
  employeeLoader: DataLoader<string, EmployeeRecord | null>;
}

export function createLoaders(correlationId: string, userContext?: UserContext): Loaders {
  const clientsUrl = process.env.CLIENTS_SERVICE_URL || 'http://clients:4002';
  const clientsToken = process.env.INTERNAL_TOKEN_CLIENTS || '';

  const employeeLoader = new DataLoader<string, EmployeeRecord | null>(async (ids) => {
    if (!userContext) {
      return ids.map(() => null);
    }

    // Si es funcionario normal, solo puede cargar su propio registro sin filtrar batching global
    if (userContext.role === 'FUNCIONARIO') {
      const { employee } = await internalFetch<{ employee: EmployeeRecord }>(`${clientsUrl}/employees/me`, {
        internalToken: clientsToken,
        correlationId,
        userContext
      });
      return ids.map((id) => (id === employee.id ? employee : null));
    }

    const uniqueIds = Array.from(new Set(ids));
    const { employees } = await internalFetch<{ employees: EmployeeRecord[] }>(
      `${clientsUrl}/employees?ids=${encodeURIComponent(uniqueIds.join(','))}`,
      {
        internalToken: clientsToken,
        correlationId,
        userContext
      }
    );
    const byId = new Map(employees.map((e) => [e.id, e]));
    return ids.map((id) => byId.get(id) ?? null);
  });

  return { employeeLoader };
}
