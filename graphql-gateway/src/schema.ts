import type { Request } from 'express';
import { GraphQLError } from 'graphql';
import { createSchema } from 'graphql-yoga';
import { AppError, UserContext, internalFetch } from '@libros/shared';
import { EmployeeRecord, Loaders } from './loaders';

export interface GraphQLContext {
  req: Request;
  correlationId: string;
  user?: UserContext;
  loaders: Loaders;
}

interface BranchDTO {
  id: string;
  codigo: string;
  nombre: string;
}

interface ServiceDTO {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string;
  esBase: boolean;
  activo: boolean;
  horarios: Array<{ numeroTurno: number; horaInicio: string; horaFin: string }>;
  valorizaciones: Array<{ perfilCodigo: string; valorClp: number; vigente: boolean }>;
}

interface ValeDTO {
  id: string;
  numeroVale: string;
  funcionarioId: string | null;
  codigoFuncionario: string | null;
  nombreBeneficiario: string;
  perfilCodigo: string;
  servicioCodigo: string;
  servicioNombre: string;
  tipoVale: string;
  numeroTurno: number;
  fechaVigencia: string;
  horaInicioPermitida: string;
  horaFinPermitida: string;
  valorClp: number;
  sucursalEmisionCodigo: string;
  estado: string;
  motivoAdicional: string | null;
  emitidoEn: string;
  impresoEn: string | null;
  canjeadoEn: string | null;
  canje?: {
    id: string;
    casinoCodigo: string;
    cajeroCodigo: string;
    totalConsumoClp: number;
    valorValeClp: number;
    saldoAFavorClp: number;
    diferenciaPagadaClp: number;
    canjeadoEn: string;
    items: Array<{
      productoCodigo: string;
      productoNombre: string;
      cantidad: number;
      precioUnitarioClp: number;
      subtotalClp: number;
    }>;
  } | null;
}

interface AvisoDTO {
  id: string;
  semanaInicio: string;
  semanaFin: string;
  valesDisponibles: number;
  valesUsados: number;
  valesNoUsados: number;
  estadoEnvio: string;
}

interface AuditReportDTO {
  summary: {
    totalRegistros: number;
    disponiblesSinImprimir: number;
    impresosNoUsados: number;
    canjeadosUsados: number;
    anulados: number;
    montoEmitidoValidoClp: number;
    montoCanjeadoClp: number;
  };
  byService: Array<{
    servicioCodigo: string;
    servicioNombre: string;
    emitidosSinImprimir: number;
    impresosNoUsados: number;
    canjeados: number;
    anulados: number;
    totalValidos: number;
    montoTotalClp: number;
  }>;
}

interface ReconciliationDTO {
  summaryByCasino: Array<{
    casinoCodigo: string;
    totalValesCanjeados: number;
    totalValorValesClp: number;
    totalConsumoClp: number;
    totalCubiertoValeClp: number;
    totalDiferenciasClp: number;
    totalSaldosNoUsadosClp: number;
  }>;
}

interface ProductDTO {
  id: string;
  codigo: string;
  nombre: string;
  categoria: string;
  precioClp: number;
  disponible: boolean;
}

function getSantiagoClock(): { dateStr: string; hhmm: string; minutes: number } {
  const tz = process.env.APP_TIMEZONE || 'America/Santiago';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  let hour = Number(parts.find((p) => p.type === 'hour')?.value || '0');
  if (hour === 24) hour = 0;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || '0');
  return {
    dateStr: `${year}-${month}-${day}`,
    hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    minutes: hour * 60 + minute
  };
}

function toMinutes(hhmm: string): number {
  if (hhmm === '24:00') return 1440;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function isWithinWindow(nowMinutes: number, start: string, end: string): boolean {
  const s = toMinutes(start);
  const e = toMinutes(end);
  return s <= e ? nowMinutes >= s && nowMinutes < e : nowMinutes >= s || nowMinutes < e;
}

function requireAuth(ctx: GraphQLContext): UserContext {
  if (!ctx.user) {
    throw new GraphQLError('Autenticacion requerida para ejecutar esta consulta GraphQL', {
      extensions: { code: 'UNAUTHENTICATED' }
    });
  }
  return ctx.user;
}

function getSubsystemTimeoutMs(): number {
  return Number(process.env.GRAPHQL_SUBSYSTEM_TIMEOUT_MS || 1500);
}

function toPartialError(subsystem: string, err: unknown): { subsystem: string; code: string; message: string } {
  if (err instanceof AppError) {
    return { subsystem, code: err.code, message: err.message };
  }
  return { subsystem, code: 'SUBSYSTEM_UNAVAILABLE', message: `Subsistemas ${subsystem} temporalmente no disponible` };
}

const typeDefs = /* GraphQL */ `
  type Sucursal {
    id: ID!
    codigo: String!
    nombre: String!
  }

  type PerfilComensal {
    id: ID!
    codigo: String!
    nombre: String!
    permiteMultiVale: Boolean!
    maxValesPorHorario: Int!
  }

  type TurnoActual {
    anio: Int!
    mes: Int!
    numeroTurno: Int!
    horarioLabel: String!
    sucursalAsignadaCodigo: String!
    sucursalAsignadaNombre: String!
  }

  type Funcionario {
    id: ID!
    codigoFuncionario: String!
    nombreCompleto: String!
    rol: String!
    activo: Boolean!
    rut: String
    email: String
    perfil: PerfilComensal!
    sucursalBase: Sucursal!
    turnoActual: TurnoActual
  }

  type HorarioServicio {
    numeroTurno: Int!
    horaInicio: String!
    horaFin: String!
  }

  type ServicioDisponible {
    id: ID!
    codigo: String!
    nombre: String!
    descripcion: String!
    esBase: Boolean!
    valorClp: Int
    habilitadoAhora: Boolean!
    horarios: [HorarioServicio!]!
  }

  type CanjeItem {
    productoCodigo: String!
    productoNombre: String!
    cantidad: Int!
    precioUnitarioClp: Int!
    subtotalClp: Int!
  }

  type CanjeDetalle {
    id: ID!
    casinoCodigo: String!
    cajeroCodigo: String!
    totalConsumoClp: Int!
    valorValeClp: Int!
    saldoAFavorClp: Int!
    diferenciaPagadaClp: Int!
    canjeadoEn: String!
    items: [CanjeItem!]!
  }

  type Vale {
    id: ID!
    numeroVale: String!
    codigoFuncionario: String
    nombreBeneficiario: String!
    perfilCodigo: String!
    servicioCodigo: String!
    servicioNombre: String!
    tipoVale: String!
    numeroTurno: Int!
    fechaVigencia: String!
    horaInicioPermitida: String!
    horaFinPermitida: String!
    valorClp: Int!
    sucursalEmisionCodigo: String!
    estado: String!
    motivoAdicional: String
    emitidoEn: String!
    impresoEn: String
    canjeadoEn: String
    canje: CanjeDetalle
    titular: Funcionario
  }

  type AvisoSemanal {
    id: ID!
    semanaInicio: String!
    semanaFin: String!
    valesDisponibles: Int!
    valesUsados: Int!
    valesNoUsados: Int!
    estadoEnvio: String!
  }

  type PartialError {
    subsystem: String!
    code: String!
    message: String!
  }

  type ResumenComensal {
    fechaConsultada: String!
    horaServidor: String!
    funcionario: Funcionario!
    sucursales: [Sucursal!]!
    serviciosDelTurno: [ServicioDisponible!]!
    valesDisponiblesParaImprimir: [Vale!]!
    valesRecientes: [Vale!]!
    avisosSemanales: [AvisoSemanal!]!
    partialErrors: [PartialError!]!
  }

  type AuditoriaResumen {
    totalRegistros: Int!
    disponiblesSinImprimir: Int!
    impresosNoUsados: Int!
    canjeadosUsados: Int!
    anulados: Int!
    montoEmitidoValidoClp: Int!
    montoCanjeadoClp: Int!
  }

  type AuditoriaPorServicio {
    servicioCodigo: String!
    servicioNombre: String!
    emitidosSinImprimir: Int!
    impresosNoUsados: Int!
    canjeados: Int!
    anulados: Int!
    totalValidos: Int!
    montoTotalClp: Int!
  }

  type RendicionCasinoResumen {
    casinoCodigo: String!
    totalValesCanjeados: Int!
    totalValorValesClp: Int!
    totalConsumoClp: Int!
    totalCubiertoValeClp: Int!
    totalDiferenciasClp: Int!
    totalSaldosNoUsadosClp: Int!
  }

  type PanelAuditoria {
    resumen: AuditoriaResumen!
    porServicio: [AuditoriaPorServicio!]!
    rendicionCasinos: [RendicionCasinoResumen!]!
    sucursales: [Sucursal!]!
    partialErrors: [PartialError!]!
  }

  type ProductoCasino {
    id: ID!
    codigo: String!
    nombre: String!
    categoria: String!
    precioClp: Int!
    disponible: Boolean!
  }

  type Query {
    miResumenComensal(fecha: String): ResumenComensal!
    detalleVale(numeroVale: String!): Vale
    panelAuditoria(fechaDesde: String, fechaHasta: String): PanelAuditoria!
    catalogoCasino(soloDisponibles: Boolean): [ProductoCasino!]!
  }
`;

export const schema = createSchema<GraphQLContext>({
  typeDefs,
  resolvers: {
    Funcionario: {
      rut(parent: EmployeeRecord, _args: unknown, ctx: GraphQLContext) {
        const user = requireAuth(ctx);
        if (user.role !== 'ADMINISTRADOR' && user.userId !== parent.id) {
          throw new GraphQLError('No autorizado para leer RUT de otro funcionario', {
            extensions: { code: 'FORBIDDEN' }
          });
        }
        return parent.rut ?? null;
      },
      email(parent: EmployeeRecord, _args: unknown, ctx: GraphQLContext) {
        const user = requireAuth(ctx);
        if (user.role !== 'ADMINISTRADOR' && user.userId !== parent.id) {
          throw new GraphQLError('No autorizado para leer correo de otro funcionario', {
            extensions: { code: 'FORBIDDEN' }
          });
        }
        return parent.email ?? null;
      }
    },
    Vale: {
      titular(parent: ValeDTO, _args: unknown, ctx: GraphQLContext) {
        if (!parent.funcionarioId) return null;
        return ctx.loaders.employeeLoader.load(parent.funcionarioId);
      }
    },
    Query: {
      async miResumenComensal(_parent, args: { fecha?: string }, ctx) {
        const user = requireAuth(ctx);
        const clientsUrl = process.env.CLIENTS_SERVICE_URL || 'http://clients:4002';
        const inventoryUrl = process.env.INVENTORY_SERVICE_URL || 'http://inventory:4003';
        const ordersUrl = process.env.ORDERS_SERVICE_URL || 'http://orders:4004';
        const paymentsUrl = process.env.PAYMENTS_SERVICE_URL || 'http://payments:4005';

        const clock = getSantiagoClock();
        const partialErrors: Array<{ subsystem: string; code: string; message: string }> = [];

        const timeoutMs = getSubsystemTimeoutMs();

        // 1. Ficha del funcionario y sucursales (obligatorio desde clients)
        const [{ employee }, branchesRes] = await Promise.all([
          internalFetch<{ employee: EmployeeRecord }>(`${clientsUrl}/employees/me`, {
            internalToken: process.env.INTERNAL_TOKEN_CLIENTS || '',
            correlationId: ctx.correlationId,
            userContext: user,
            timeoutMs
          }),
          internalFetch<{ branches: BranchDTO[] }>(`${clientsUrl}/branches`, {
            internalToken: process.env.INTERNAL_TOKEN_CLIENTS || '',
            correlationId: ctx.correlationId,
            userContext: user,
            timeoutMs
          })
        ]);

        const turno = employee.turnoActual?.numeroTurno ?? 1;

        // 2. Servicios valorizados (inventory), vales propios (orders) y avisos (payments) en paralelo con degradacion controlada
        const [servicesResult, vouchersResult, noticesResult] = await Promise.allSettled([
          internalFetch<{ services: ServiceDTO[] }>(
            `${inventoryUrl}/services?activo=true&turno=${turno}&perfilCodigo=${encodeURIComponent(employee.perfil.codigo)}`,
            {
              internalToken: process.env.INTERNAL_TOKEN_INVENTORY || '',
              correlationId: ctx.correlationId,
              userContext: user,
              timeoutMs
            }
          ),
          internalFetch<{ vouchers: ValeDTO[] }>(`${ordersUrl}/vouchers/my`, {
            internalToken: process.env.INTERNAL_TOKEN_ORDERS || '',
            correlationId: ctx.correlationId,
            userContext: user,
            timeoutMs
          }),
          internalFetch<{ notifications: AvisoDTO[] }>(`${paymentsUrl}/notifications/weekly`, {
            internalToken: process.env.INTERNAL_TOKEN_PAYMENTS || '',
            correlationId: ctx.correlationId,
            userContext: user,
            timeoutMs
          })
        ]);

        let serviciosDelTurno: Array<{
          id: string;
          codigo: string;
          nombre: string;
          descripcion: string;
          esBase: boolean;
          valorClp: number | null;
          habilitadoAhora: boolean;
          horarios: Array<{ numeroTurno: number; horaInicio: string; horaFin: string }>;
        }> = [];

        if (servicesResult.status === 'fulfilled') {
          serviciosDelTurno = servicesResult.value.services.map((svc) => {
            const val = svc.valorizaciones.find((v) => v.perfilCodigo === employee.perfil.codigo && v.vigente);
            const habilitadoAhora = svc.horarios.some(
              (h) => h.numeroTurno === turno && isWithinWindow(clock.minutes, h.horaInicio, h.horaFin)
            );
            return {
              id: svc.id,
              codigo: svc.codigo,
              nombre: svc.nombre,
              descripcion: svc.descripcion,
              esBase: svc.esBase,
              valorClp: val?.valorClp ?? null,
              habilitadoAhora,
              horarios: svc.horarios
            };
          });
        } else {
          partialErrors.push(toPartialError('inventory', servicesResult.reason));
        }

        let valesRecientes: ValeDTO[] = [];
        if (vouchersResult.status === 'fulfilled') {
          valesRecientes = vouchersResult.value.vouchers;
        } else {
          partialErrors.push(toPartialError('orders', vouchersResult.reason));
        }

        let avisosSemanales: AvisoDTO[] = [];
        if (noticesResult.status === 'fulfilled') {
          avisosSemanales = noticesResult.value.notifications;
        } else {
          partialErrors.push(toPartialError('payments', noticesResult.reason));
        }

        const valesDisponiblesParaImprimir = valesRecientes.filter((v) => v.estado === 'EMITIDO');

        return {
          fechaConsultada: args.fecha || clock.dateStr,
          horaServidor: clock.hhmm,
          funcionario: employee,
          sucursales: branchesRes.branches,
          serviciosDelTurno,
          valesDisponiblesParaImprimir,
          valesRecientes,
          avisosSemanales,
          partialErrors
        };
      },

      async detalleVale(_parent, args: { numeroVale: string }, ctx) {
        const user = requireAuth(ctx);
        const ordersUrl = process.env.ORDERS_SERVICE_URL || 'http://orders:4004';
        try {
          const { voucher } = await internalFetch<{ voucher: ValeDTO }>(
            `${ordersUrl}/vouchers/by-number/${encodeURIComponent(args.numeroVale.trim().toUpperCase())}`,
            {
              internalToken: process.env.INTERNAL_TOKEN_ORDERS || '',
              correlationId: ctx.correlationId,
              userContext: user
            }
          );
          return voucher;
        } catch (err) {
          if (err instanceof AppError && err.statusCode === 404) {
            return null;
          }
          if (err instanceof AppError && err.statusCode === 403) {
            throw new GraphQLError(err.message, { extensions: { code: 'FORBIDDEN' } });
          }
          throw err;
        }
      },

      async panelAuditoria(_parent, args: { fechaDesde?: string; fechaHasta?: string }, ctx) {
        const user = requireAuth(ctx);
        if (user.role !== 'ADMINISTRADOR') {
          throw new GraphQLError('Solo administradores pueden consultar el panel de auditoria', {
            extensions: { code: 'FORBIDDEN' }
          });
        }

        const clientsUrl = process.env.CLIENTS_SERVICE_URL || 'http://clients:4002';
        const ordersUrl = process.env.ORDERS_SERVICE_URL || 'http://orders:4004';
        const paymentsUrl = process.env.PAYMENTS_SERVICE_URL || 'http://payments:4005';

        const qs = new URLSearchParams();
        if (args.fechaDesde) qs.set('fechaDesde', args.fechaDesde);
        if (args.fechaHasta) qs.set('fechaHasta', args.fechaHasta);
        const querySuffix = qs.toString() ? `?${qs.toString()}` : '';

        const partialErrors: Array<{ subsystem: string; code: string; message: string }> = [];
        const timeoutMs = getSubsystemTimeoutMs();

        const [audit, branchesRes, reconResult] = await Promise.all([
          internalFetch<AuditReportDTO>(`${ordersUrl}/reports/audit${querySuffix}`, {
            internalToken: process.env.INTERNAL_TOKEN_ORDERS || '',
            correlationId: ctx.correlationId,
            userContext: user,
            timeoutMs
          }),
          internalFetch<{ branches: BranchDTO[] }>(`${clientsUrl}/branches`, {
            internalToken: process.env.INTERNAL_TOKEN_CLIENTS || '',
            correlationId: ctx.correlationId,
            userContext: user,
            timeoutMs
          }),
          internalFetch<ReconciliationDTO>(`${paymentsUrl}/reconciliation`, {
            internalToken: process.env.INTERNAL_TOKEN_PAYMENTS || '',
            correlationId: ctx.correlationId,
            userContext: user,
            timeoutMs
          }).catch((err) => {
            partialErrors.push(toPartialError('payments', err));
            return { summaryByCasino: [] } as ReconciliationDTO;
          })
        ]);

        return {
          resumen: audit.summary,
          porServicio: audit.byService,
          rendicionCasinos: reconResult.summaryByCasino,
          sucursales: branchesRes.branches,
          partialErrors
        };
      },

      async catalogoCasino(_parent, args: { soloDisponibles?: boolean }, ctx) {
        requireAuth(ctx);
        const inventoryUrl = process.env.INVENTORY_SERVICE_URL || 'http://inventory:4003';
        const query = args.soloDisponibles !== undefined ? `?available=${args.soloDisponibles}` : '';
        const { products } = await internalFetch<{ products: ProductDTO[] }>(`${inventoryUrl}/products${query}`, {
          internalToken: process.env.INTERNAL_TOKEN_INVENTORY || '',
          correlationId: ctx.correlationId,
          userContext: ctx.user
        });
        return products;
      }
    }
  }
});
