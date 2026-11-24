import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import {
  AppError,
  correlationIdMiddleware,
  createLogger,
  errorHandler,
  extractUserContext,
  getParam,
  internalFetch,
  requireAuthenticatedContext,
  requireInternalToken,
  requireRoles
} from '@libros/shared';
import { Prisma } from '../generated/prisma';
import { prisma } from './db';

const logger = createLogger('orders-service');

const issueVoucherSchema = z
  .object({
    servicioCodigo: z.string().trim().min(2).max(40).optional(),
    sucursalEmisionCodigo: z.string().trim().min(2).max(32).default('CENTRAL'),
    nombreBeneficiarioVisita: z.string().trim().min(2).max(150).optional()
  })
  .strict();

const additionalVoucherSchema = z
  .object({
    tipoVale: z.enum(['ADICIONAL_REUNION', 'VISITA_NO_PERSONALIZADO']),
    funcionarioCodigo: z.string().trim().min(3).max(32).optional(),
    nombreBeneficiarioVisita: z.string().trim().min(2).max(150).optional(),
    servicioCodigo: z.string().trim().min(2).max(40),
    sucursalEmisionCodigo: z.string().trim().min(2).max(32).default('CENTRAL'),
    motivoAdicional: z.string().trim().min(4).max(255),
    imprimirInmediato: z.boolean().optional()
  })
  .strict();

const redeemVoucherSchema = z
  .object({
    casinoCodigo: z.string().trim().min(2).max(32),
    items: z
      .array(
        z
          .object({
            productoId: z.string().uuid(),
            cantidad: z.number().int().positive().max(100)
          })
          .strict()
      )
      .min(1),
    metodoPagoDiferencia: z.enum(['NO_APLICA', 'EFECTIVO', 'TARJETA_DEBITO', 'TARJETA_CREDITO']).default('NO_APLICA')
  })
  .strict();

interface EmployeeDTO {
  id: string;
  codigoFuncionario: string;
  nombreCompleto: string;
  activo: boolean;
  perfil: {
    codigo: string;
    nombre: string;
    permiteMultiVale: boolean;
    maxValesPorHorario: number;
  };
  turnoActual: {
    anio: number;
    mes: number;
    numeroTurno: number;
    horarioLabel: string;
    sucursalAsignadaCodigo: string;
  } | null;
}

interface BranchDTO {
  codigo: string;
  nombre: string;
  casinos: Array<{ codigo: string; nombre: string; tipo: string }>;
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

interface QuoteDTO {
  items: Array<{
    productoId: string;
    productoCodigo: string;
    productoNombre: string;
    cantidad: number;
    precioUnitarioClp: number;
    subtotalClp: number;
  }>;
  totalConsumoClp: number;
}

interface PaymentTxDTO {
  id: string;
  idempotencyKey: string;
  valeId: string;
  numeroVale: string;
  valorValeClp: number;
  totalConsumoClp: number;
  montoCubiertoValeClp: number;
  saldoAFavorClp: number;
  diferenciaPagadaClp: number;
  metodoPagoDiferencia: string;
  estado: string;
  createdAt: string;
}

function getSantiagoNow(): { dateStr: string; hhmm: string; minutes: number } {
  const tz = process.env.APP_TIMEZONE || 'America/Santiago';
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now);

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

function isWithinWindow(nowMinutes: number, horaInicio: string, horaFin: string): boolean {
  const start = toMinutes(horaInicio);
  const end = toMinutes(horaFin);
  if (start <= end) {
    return nowMinutes >= start && nowMinutes < end;
  }
  return nowMinutes >= start || nowMinutes < end;
}

function generateVoucherNumber(dateStr: string): string {
  const compactDate = dateStr.replace(/-/g, '');
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  return `VAL-${compactDate}-${suffix}`;
}

function getClientUrl(): string {
  return process.env.CLIENTS_SERVICE_URL || 'http://clients:4002';
}
function getInventoryUrl(): string {
  return process.env.INVENTORY_SERVICE_URL || 'http://inventory:4003';
}
function getPaymentsUrl(): string {
  return process.env.PAYMENTS_SERVICE_URL || 'http://payments:4005';
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use(correlationIdMiddleware(logger));

  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', service: 'orders' });
    } catch {
      res.status(503).json({ status: 'degraded', service: 'orders' });
    }
  });

  app.use(requireInternalToken(() => process.env.INTERNAL_TOKEN_ORDERS || ''));
  app.use(extractUserContext);

  // Vales del usuario autenticado
  app.get('/vouchers/my', requireAuthenticatedContext, async (req, res, next) => {
    try {
      const estado = typeof req.query.estado === 'string' ? req.query.estado.trim() : undefined;
      const vouchers = await prisma.vale.findMany({
        where: {
          funcionarioId: req.userContext!.userId,
          ...(estado ? { estado } : {})
        },
        include: { canje: { include: { items: true } } },
        orderBy: { emitidoEn: 'desc' },
        take: 100
      });
      res.json({ vouchers });
    } catch (err) {
      next(err);
    }
  });

  // Listado general (Admin / Cajero)
  app.get('/vouchers', requireRoles('ADMINISTRADOR', 'CAJERO'), async (req, res, next) => {
    try {
      const estado = typeof req.query.estado === 'string' ? req.query.estado.trim() : undefined;
      const servicioCodigo = typeof req.query.servicioCodigo === 'string' ? req.query.servicioCodigo.trim() : undefined;
      const sucursal = typeof req.query.sucursal === 'string' ? req.query.sucursal.trim() : undefined;
      const funcionarioId = typeof req.query.funcionarioId === 'string' ? req.query.funcionarioId.trim() : undefined;

      const vouchers = await prisma.vale.findMany({
        where: {
          ...(estado ? { estado } : {}),
          ...(servicioCodigo ? { servicioCodigo } : {}),
          ...(sucursal ? { sucursalEmisionCodigo: sucursal } : {}),
          ...(funcionarioId ? { funcionarioId } : {})
        },
        include: { canje: { include: { items: true } } },
        orderBy: { emitidoEn: 'desc' },
        take: 200
      });

      res.json({ vouchers });
    } catch (err) {
      next(err);
    }
  });

  // Buscar vale por numero (Cajero / Admin / dueno Funcionario)
  app.get('/vouchers/by-number/:numeroVale', requireAuthenticatedContext, async (req, res, next) => {
    try {
      const numeroVale = getParam(req, 'numeroVale').trim().toUpperCase();
      const vale = await prisma.vale.findUnique({
        where: { numeroVale },
        include: { canje: { include: { items: true } } }
      });
      if (!vale) {
        throw new AppError(404, 'VOUCHER_NOT_FOUND', `Vale ${numeroVale} no encontrado`);
      }

      const ctx = req.userContext!;
      if (ctx.role === 'FUNCIONARIO' && vale.funcionarioId !== ctx.userId) {
        throw new AppError(403, 'FORBIDDEN', 'No tiene permiso para consultar un vale ajeno');
      }

      res.json({ voucher: vale });
    } catch (err) {
      next(err);
    }
  });

  // CU6 / RF4: Informe de auditoria de vales emitidos, usados y no usados
  app.get('/reports/audit', requireRoles('ADMINISTRADOR'), async (req, res, next) => {
    try {
      const fechaDesde = typeof req.query.fechaDesde === 'string' ? req.query.fechaDesde : undefined;
      const fechaHasta = typeof req.query.fechaHasta === 'string' ? req.query.fechaHasta : undefined;

      const dateFilter: Prisma.ValeWhereInput = {};
      if (fechaDesde || fechaHasta) {
        dateFilter.fechaVigencia = {
          ...(fechaDesde ? { gte: new Date(`${fechaDesde}T00:00:00.000Z`) } : {}),
          ...(fechaHasta ? { lte: new Date(`${fechaHasta}T23:59:59.999Z`) } : {})
        };
      }

      const vales = await prisma.vale.findMany({
        where: dateFilter,
        orderBy: { emitidoEn: 'desc' }
      });

      const summary = {
        totalRegistros: vales.length,
        disponiblesSinImprimir: 0,
        impresosNoUsados: 0,
        canjeadosUsados: 0,
        anulados: 0,
        montoEmitidoValidoClp: 0,
        montoCanjeadoClp: 0
      };

      const byServiceMap = new Map<
        string,
        {
          servicioCodigo: string;
          servicioNombre: string;
          emitidosSinImprimir: number;
          impresosNoUsados: number;
          canjeados: number;
          anulados: number;
          totalValidos: number;
          montoTotalClp: number;
        }
      >();

      const byEmployeeMap = new Map<
        string,
        {
          codigoFuncionario: string;
          nombreBeneficiario: string;
          disponibles: number;
          impresosNoUsados: number;
          canjeados: number;
        }
      >();

      for (const v of vales) {
        if (v.estado === 'EMITIDO') summary.disponiblesSinImprimir += 1;
        else if (v.estado === 'IMPRESO') summary.impresosNoUsados += 1;
        else if (v.estado === 'CANJEADO') {
          summary.canjeadosUsados += 1;
          summary.montoCanjeadoClp += v.valorClp;
        } else if (v.estado === 'ANULADO') summary.anulados += 1;

        if (v.estado !== 'ANULADO') {
          summary.montoEmitidoValidoClp += v.valorClp;
        }

        const svc = byServiceMap.get(v.servicioCodigo) ?? {
          servicioCodigo: v.servicioCodigo,
          servicioNombre: v.servicioNombre,
          emitidosSinImprimir: 0,
          impresosNoUsados: 0,
          canjeados: 0,
          anulados: 0,
          totalValidos: 0,
          montoTotalClp: 0
        };
        if (v.estado === 'EMITIDO') svc.emitidosSinImprimir += 1;
        else if (v.estado === 'IMPRESO') svc.impresosNoUsados += 1;
        else if (v.estado === 'CANJEADO') svc.canjeados += 1;
        else if (v.estado === 'ANULADO') svc.anulados += 1;
        if (v.estado !== 'ANULADO') {
          svc.totalValidos += 1;
          svc.montoTotalClp += v.valorClp;
        }
        byServiceMap.set(v.servicioCodigo, svc);

        const empKey = v.codigoFuncionario || 'VISITA_NO_PERSONALIZADO';
        const emp = byEmployeeMap.get(empKey) ?? {
          codigoFuncionario: empKey,
          nombreBeneficiario: v.nombreBeneficiario,
          disponibles: 0,
          impresosNoUsados: 0,
          canjeados: 0
        };
        if (v.estado === 'EMITIDO') emp.disponibles += 1;
        else if (v.estado === 'IMPRESO') emp.impresosNoUsados += 1;
        else if (v.estado === 'CANJEADO') emp.canjeados += 1;
        byEmployeeMap.set(empKey, emp);
      }

      res.json({
        summary,
        byService: Array.from(byServiceMap.values()),
        byEmployee: Array.from(byEmployeeMap.values())
      });
    } catch (err) {
      next(err);
    }
  });

  // Consulta por ID con validacion estricta de propiedad
  app.get('/vouchers/:id', requireAuthenticatedContext, async (req, res, next) => {
    try {
      const vale = await prisma.vale.findUnique({
        where: { id: getParam(req, 'id') },
        include: { canje: { include: { items: true } } }
      });
      if (!vale) {
        throw new AppError(404, 'VOUCHER_NOT_FOUND', 'Vale no encontrado');
      }

      const ctx = req.userContext!;
      if (ctx.role === 'FUNCIONARIO' && vale.funcionarioId !== ctx.userId) {
        throw new AppError(403, 'FORBIDDEN', 'No tiene autorizacion para ver un vale de otro funcionario');
      }

      res.json({ voucher: vale });
    } catch (err) {
      next(err);
    }
  });

  // CU2: Emision e impresion instantanea de vale en totem (<2s)
  app.post('/vouchers/issue', requireAuthenticatedContext, async (req, res, next) => {
    const startedAt = Date.now();
    try {
      const parsed = issueVoucherSchema.safeParse(req.body || {});
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Datos invalidos para emitir vale', parsed.error.flatten());
      }

      const ctx = req.userContext!;
      const { employee } = await internalFetch<{ employee: EmployeeDTO }>(
        `${getClientUrl()}/employees/me`,
        {
          internalToken: process.env.INTERNAL_TOKEN_CLIENTS || '',
          correlationId: req.correlationId,
          userContext: ctx
        }
      );

      if (!employee.activo) {
        throw new AppError(403, 'EMPLOYEE_INACTIVE', 'El funcionario se encuentra inactivo');
      }
      if (!employee.turnoActual) {
        throw new AppError(422, 'SHIFT_NOT_ASSIGNED', 'El funcionario no tiene turno mensual asignado para el mes actual');
      }

      const { branches } = await internalFetch<{ branches: BranchDTO[] }>(
        `${getClientUrl()}/branches`,
        {
          internalToken: process.env.INTERNAL_TOKEN_CLIENTS || '',
          correlationId: req.correlationId,
          userContext: ctx
        }
      );

      const branchExists = branches.some((b) => b.codigo === parsed.data.sucursalEmisionCodigo);
      if (!branchExists) {
        throw new AppError(404, 'BRANCH_NOT_FOUND', `Sucursal ${parsed.data.sucursalEmisionCodigo} no existe o esta inactiva`);
      }

      const turno = employee.turnoActual.numeroTurno;
      const { services } = await internalFetch<{ services: ServiceDTO[] }>(
        `${getInventoryUrl()}/services?activo=true&turno=${turno}&perfilCodigo=${encodeURIComponent(employee.perfil.codigo)}`,
        {
          internalToken: process.env.INTERNAL_TOKEN_INVENTORY || '',
          correlationId: req.correlationId,
          userContext: ctx
        }
      );

      const now = getSantiagoNow();
      const activeServicesNow = services.filter((svc) =>
        svc.horarios.some((h) => h.numeroTurno === turno && isWithinWindow(now.minutes, h.horaInicio, h.horaFin))
      );

      if (activeServicesNow.length === 0) {
        throw new AppError(
          422,
          'FUERA_DE_HORARIO',
          `Fuera de horario para emitir vale. Su turno asignado es Turno ${turno} (${employee.turnoActual.horarioLabel}) y la hora actual es ${now.hhmm}.`
        );
      }

      let selectedService: ServiceDTO;
      if (parsed.data.servicioCodigo) {
        const match = activeServicesNow.find((s) => s.codigo === parsed.data.servicioCodigo);
        if (!match) {
          throw new AppError(
            422,
            'SERVICIO_NO_DISPONIBLE_EN_HORARIO',
            `El servicio ${parsed.data.servicioCodigo} no esta habilitado a las ${now.hhmm} para el Turno ${turno}.`,
            { availableServices: activeServicesNow.map((s) => ({ codigo: s.codigo, nombre: s.nombre })) }
          );
        }
        selectedService = match;
      } else if (activeServicesNow.length > 1) {
        throw new AppError(
          409,
          'MULTIPLE_SERVICES_IN_WINDOW',
          'Existen dos servicios habilitados en este horario. Seleccione el servicio deseado.',
          { availableServices: activeServicesNow.map((s) => ({ codigo: s.codigo, nombre: s.nombre })) }
        );
      } else {
        selectedService = activeServicesNow[0];
      }

      const scheduleWindow = selectedService.horarios.find((h) => h.numeroTurno === turno)!;
      const valuation = selectedService.valorizaciones.find((v) => v.perfilCodigo === employee.perfil.codigo && v.vigente);
      if (!valuation) {
        throw new AppError(
          422,
          'VALUATION_NOT_CONFIGURED',
          `No existe valorizacion vigente para el servicio ${selectedService.codigo} y perfil ${employee.perfil.codigo}`
        );
      }

      const fechaVigencia = new Date(`${now.dateStr}T00:00:00.000Z`);
      let claveUnicidad: string;

      if (!employee.perfil.permiteMultiVale) {
        claveUnicidad = `${employee.id}:${now.dateStr}:${selectedService.codigo}`;
        const existing = await prisma.vale.findUnique({ where: { claveUnicidad } });
        if (existing && existing.estado !== 'ANULADO') {
          throw new AppError(
            409,
            'VALE_DUPLICADO',
            `Ya fue impreso su vale de ${selectedService.nombre} para hoy (${existing.numeroVale}). No es posible emitir otro vale en el mismo horario.`
          );
        }
      } else {
        const countToday = await prisma.vale.count({
          where: {
            funcionarioId: employee.id,
            fechaVigencia,
            servicioCodigo: selectedService.codigo,
            tipoVale: 'NORMAL_TURNO',
            estado: { not: 'ANULADO' }
          }
        });
        if (countToday >= employee.perfil.maxValesPorHorario) {
          throw new AppError(
            409,
            'LIMITE_MULTI_VALE_EXCEDIDO',
            `Alcanzo el maximo permitido (${employee.perfil.maxValesPorHorario}) de vales multi-vale para ${selectedService.nombre} hoy.`
          );
        }
        claveUnicidad = `${employee.id}:${now.dateStr}:${selectedService.codigo}:MULTI:${randomUUID().slice(0, 8)}`;
      }

      const beneficiario =
        employee.perfil.permiteMultiVale && parsed.data.nombreBeneficiarioVisita
          ? `${parsed.data.nombreBeneficiarioVisita} (Via ${employee.codigoFuncionario})`
          : employee.nombreCompleto;

      // Si existia un vale ANULADO previo con la misma claveUnicidad, liberamos clave modificandola en caso necesario
      const previousAnulado = await prisma.vale.findUnique({ where: { claveUnicidad } });
      if (previousAnulado && previousAnulado.estado === 'ANULADO') {
        claveUnicidad = `${claveUnicidad}:REEM:${randomUUID().slice(0, 6)}`;
      }

      try {
        const voucher = await prisma.vale.create({
          data: {
            numeroVale: generateVoucherNumber(now.dateStr),
            claveUnicidad,
            funcionarioId: employee.id,
            codigoFuncionario: employee.codigoFuncionario,
            nombreBeneficiario: beneficiario,
            perfilCodigo: employee.perfil.codigo,
            servicioId: selectedService.id,
            servicioCodigo: selectedService.codigo,
            servicioNombre: selectedService.nombre,
            tipoVale: 'NORMAL_TURNO',
            numeroTurno: turno,
            fechaVigencia,
            horaInicioPermitida: scheduleWindow.horaInicio,
            horaFinPermitida: scheduleWindow.horaFin,
            valorClp: valuation.valorClp,
            sucursalEmisionCodigo: parsed.data.sucursalEmisionCodigo,
            estado: 'IMPRESO',
            emitidoPorId: ctx.userId,
            impresoEn: new Date()
          }
        });

        res.status(201).json({
          voucher,
          elapsedMs: Date.now() - startedAt
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new AppError(
            409,
            'VALE_DUPLICADO',
            `Ya existe un vale emitido para ${selectedService.nombre} en el horario actual.`
          );
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  // CU7 / RF5: Generacion de vales adicionales (reuniones) o no personalizados (visitas)
  app.post('/vouchers/additional', requireRoles('ADMINISTRADOR'), async (req, res, next) => {
    try {
      const parsed = additionalVoucherSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Datos invalidos para vale adicional o visita', parsed.error.flatten());
      }

      const data = parsed.data;
      let funcionarioId: string | null = null;
      let codigoFuncionario: string | null = null;
      let nombreBeneficiario: string;
      let perfilCodigo = 'VISITA';
      let numeroTurno = 1;

      if (data.tipoVale === 'ADICIONAL_REUNION') {
        if (!data.funcionarioCodigo) {
          throw new AppError(400, 'EMPLOYEE_CODE_REQUIRED', 'Debe indicar codigoFuncionario para vales adicionales de reunion');
        }
        const { employee } = await internalFetch<{ employee: EmployeeDTO }>(
          `${getClientUrl()}/employees/by-code/${encodeURIComponent(data.funcionarioCodigo.toUpperCase())}`,
          {
            internalToken: process.env.INTERNAL_TOKEN_CLIENTS || '',
            correlationId: req.correlationId,
            userContext: req.userContext
          }
        );
        funcionarioId = employee.id;
        codigoFuncionario = employee.codigoFuncionario;
        nombreBeneficiario = employee.nombreCompleto;
        perfilCodigo = employee.perfil.codigo;
        numeroTurno = employee.turnoActual?.numeroTurno ?? 1;
      } else {
        nombreBeneficiario = data.nombreBeneficiarioVisita || 'Visita / Empleado Nuevo';
      }

      const { services } = await internalFetch<{ services: ServiceDTO[] }>(
        `${getInventoryUrl()}/services?activo=true&perfilCodigo=${encodeURIComponent(perfilCodigo)}`,
        {
          internalToken: process.env.INTERNAL_TOKEN_INVENTORY || '',
          correlationId: req.correlationId,
          userContext: req.userContext
        }
      );

      const service = services.find((s) => s.codigo === data.servicioCodigo);
      if (!service) {
        throw new AppError(404, 'SERVICE_NOT_FOUND', `Servicio ${data.servicioCodigo} no encontrado o inactivo`);
      }

      const valuation = service.valorizaciones.find((v) => v.perfilCodigo === perfilCodigo && v.vigente);
      if (!valuation) {
        throw new AppError(422, 'VALUATION_NOT_CONFIGURED', `Falta valorizacion para ${service.codigo} y perfil ${perfilCodigo}`);
      }

      const now = getSantiagoNow();
      const imprimir = data.imprimirInmediato ?? data.tipoVale === 'VISITA_NO_PERSONALIZADO';
      const voucher = await prisma.vale.create({
        data: {
          numeroVale: generateVoucherNumber(now.dateStr),
          claveUnicidad: `ADIC:${data.tipoVale}:${randomUUID()}`,
          funcionarioId,
          codigoFuncionario,
          nombreBeneficiario,
          perfilCodigo,
          servicioId: service.id,
          servicioCodigo: service.codigo,
          servicioNombre: service.nombre,
          tipoVale: data.tipoVale,
          numeroTurno,
          fechaVigencia: new Date(`${now.dateStr}T00:00:00.000Z`),
          horaInicioPermitida: '00:00',
          horaFinPermitida: '24:00',
          valorClp: valuation.valorClp,
          sucursalEmisionCodigo: data.sucursalEmisionCodigo,
          estado: imprimir ? 'IMPRESO' : 'EMITIDO',
          motivoAdicional: data.motivoAdicional,
          emitidoPorId: req.userContext!.userId,
          impresoEn: imprimir ? new Date() : null
        }
      });

      res.status(201).json({ voucher });
    } catch (err) {
      next(err);
    }
  });

  // Impresion en totem de un vale adicional pre-emitido (EMITIDO -> IMPRESO)
  app.post('/vouchers/:id/print', requireAuthenticatedContext, async (req, res, next) => {
    try {
      const startedAt = Date.now();
      const vale = await prisma.vale.findUnique({ where: { id: getParam(req, 'id') } });
      if (!vale) {
        throw new AppError(404, 'VOUCHER_NOT_FOUND', 'Vale no encontrado');
      }

      const ctx = req.userContext!;
      if (ctx.role !== 'ADMINISTRADOR' && vale.funcionarioId !== ctx.userId) {
        throw new AppError(403, 'FORBIDDEN', 'No tiene permiso para imprimir un vale ajeno');
      }

      if (vale.estado !== 'EMITIDO') {
        throw new AppError(409, 'INVALID_STATE_TRANSITION', `El vale ${vale.numeroVale} ya se encuentra en estado ${vale.estado}`);
      }

      const updated = await prisma.vale.update({
        where: { id: vale.id },
        data: {
          estado: 'IMPRESO',
          impresoEn: new Date()
        }
      });

      res.json({ voucher: updated, elapsedMs: Date.now() - startedAt });
    } catch (err) {
      next(err);
    }
  });

  // Anulacion controlada (preserva trazabilidad historica sin borrar)
  app.post('/vouchers/:id/cancel', requireRoles('ADMINISTRADOR'), async (req, res, next) => {
    try {
      const vale = await prisma.vale.findUnique({ where: { id: getParam(req, 'id') } });
      if (!vale) {
        throw new AppError(404, 'VOUCHER_NOT_FOUND', 'Vale no encontrado');
      }
      if (vale.estado === 'CANJEADO') {
        throw new AppError(409, 'VOUCHER_ALREADY_REDEEMED', 'No es posible anular un vale que ya fue canjeado en casino');
      }
      if (vale.estado === 'ANULADO') {
        throw new AppError(409, 'VOUCHER_ALREADY_CANCELED', 'El vale ya se encuentra anulado');
      }

      const updated = await prisma.vale.update({
        where: { id: vale.id },
        data: {
          estado: 'ANULADO',
          anuladoEn: new Date()
        }
      });
      res.json({ voucher: updated });
    } catch (err) {
      next(err);
    }
  });

  // CU5 / RF12: Registro de venta/canje de vale en casino por Cajero
  app.post('/vouchers/:numeroVale/redeem', requireRoles('CAJERO'), async (req, res, next) => {
    try {
      const parsed = redeemVoucherSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(
          400,
          'VALIDACION_ESTRICTA',
          'Solicitud de canje invalida o contiene campos calculados no permitidos desde el cliente',
          parsed.error.flatten()
        );
      }

      const numeroVale = getParam(req, 'numeroVale').trim().toUpperCase();
      const vale = await prisma.vale.findUnique({ where: { numeroVale } });
      if (!vale) {
        throw new AppError(404, 'VOUCHER_NOT_FOUND', `Vale ${numeroVale} no encontrado`);
      }

      if (vale.estado === 'CANJEADO') {
        throw new AppError(409, 'VALE_YA_CANJEADO', `El vale ${numeroVale} ya fue canjeado anteriormente`);
      }
      if (vale.estado === 'ANULADO') {
        throw new AppError(409, 'VALE_ANULADO', `El vale ${numeroVale} fue anulado`);
      }
      if (vale.estado === 'EMITIDO' && vale.tipoVale !== 'VISITA_NO_PERSONALIZADO') {
        throw new AppError(409, 'VALE_NO_IMPRESO', `El vale ${numeroVale} debe ser impreso en totem antes de canjearse`);
      }

      // Validar que el casino exista y este activo
      const { branches } = await internalFetch<{ branches: BranchDTO[] }>(
        `${getClientUrl()}/branches`,
        {
          internalToken: process.env.INTERNAL_TOKEN_CLIENTS || '',
          correlationId: req.correlationId,
          userContext: req.userContext
        }
      );
      const validCasino = branches.some((b) => b.casinos.some((c) => c.codigo === parsed.data.casinoCodigo));
      if (!validCasino) {
        throw new AppError(404, 'CASINO_NOT_FOUND', `Casino ${parsed.data.casinoCodigo} no existe o esta inactivo`);
      }

      // 1. Cotizacion autoritativa en inventory (ignora precios del navegador)
      const quote = await internalFetch<QuoteDTO>(`${getInventoryUrl()}/internal/products/quote`, {
        method: 'POST',
        body: { items: parsed.data.items },
        internalToken: process.env.INTERNAL_TOKEN_INVENTORY || '',
        correlationId: req.correlationId,
        userContext: req.userContext
      });

      // 2. Liquidacion idempotente en payments
      const { transaction } = await internalFetch<{ transaction: PaymentTxDTO; idempotentReplay: boolean }>(
        `${getPaymentsUrl()}/transactions/settle`,
        {
          method: 'POST',
          body: {
            idempotencyKey: `VALE-${vale.id}`,
            valeId: vale.id,
            numeroVale: vale.numeroVale,
            cajeroId: req.userContext!.userId,
            casinoCodigo: parsed.data.casinoCodigo,
            valorValeClp: vale.valorClp,
            totalConsumoClp: quote.totalConsumoClp,
            metodoPagoDiferencia: parsed.data.metodoPagoDiferencia
          },
          internalToken: process.env.INTERNAL_TOKEN_PAYMENTS || '',
          correlationId: req.correlationId,
          userContext: req.userContext
        }
      );

      // 3. Persistir canje y actualizar estado de vale atomicamente
      const result = await prisma.$transaction(async (tx) => {
        const updatedCount = await tx.vale.updateMany({
          where: { id: vale.id, estado: vale.estado },
          data: {
            estado: 'CANJEADO',
            canjeadoEn: new Date()
          }
        });
        if (updatedCount.count === 0) {
          throw new AppError(409, 'VALE_YA_CANJEADO', `El vale ${numeroVale} fue canjeado concurrentemente`);
        }

        const redemption = await tx.canje.create({
          data: {
            valeId: vale.id,
            numeroVale: vale.numeroVale,
            cajeroId: req.userContext!.userId,
            cajeroCodigo: req.userContext!.codigoFuncionario,
            casinoCodigo: parsed.data.casinoCodigo,
            totalConsumoClp: quote.totalConsumoClp,
            valorValeClp: vale.valorClp,
            saldoAFavorClp: transaction.saldoAFavorClp,
            diferenciaPagadaClp: transaction.diferenciaPagadaClp,
            transaccionPagoId: transaction.id,
            items: {
              create: quote.items.map((item) => ({
                productoId: item.productoId,
                productoCodigo: item.productoCodigo,
                productoNombre: item.productoNombre,
                cantidad: item.cantidad,
                precioUnitarioClp: item.precioUnitarioClp,
                subtotalClp: item.subtotalClp
              }))
            }
          },
          include: { items: true }
        });

        const updatedVoucher = await tx.vale.findUniqueOrThrow({ where: { id: vale.id } });
        return { updatedVoucher, redemption };
      });

      res.status(201).json({
        voucher: result.updatedVoucher,
        redemption: result.redemption,
        paymentTransaction: transaction
      });
    } catch (err) {
      next(err);
    }
  });

  app.use(errorHandler(logger));
  return app;
}
