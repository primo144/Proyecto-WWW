import express from 'express';
import { z } from 'zod';
import {
  AppError,
  correlationIdMiddleware,
  createLogger,
  errorHandler,
  extractUserContext,
  getParam,
  requireAuthenticatedContext,
  requireInternalToken,
  requireRoles
} from '@libros/shared';
import { prisma } from './db';

const logger = createLogger('clients-service');

const profileCreateSchema = z.object({
  codigo: z.string().trim().min(2).max(40).regex(/^[A-Z0-9_]+$/),
  nombre: z.string().trim().min(2).max(80),
  descripcion: z.string().trim().min(4).max(255),
  permiteMultiVale: z.boolean().default(false),
  maxValesPorHorario: z.number().int().min(1).max(50).default(1)
});

const profileUpdateSchema = z.object({
  nombre: z.string().trim().min(2).max(80).optional(),
  descripcion: z.string().trim().min(4).max(255).optional(),
  permiteMultiVale: z.boolean().optional(),
  maxValesPorHorario: z.number().int().min(1).max(50).optional(),
  activo: z.boolean().optional()
});

const createEmployeeSchema = z.object({
  id: z.string().uuid().optional(),
  codigoFuncionario: z.string().trim().min(3).max(32),
  rut: z.string().trim().min(7).max(20),
  nombreCompleto: z.string().trim().min(3).max(150),
  email: z.string().email().max(150),
  rol: z.enum(['FUNCIONARIO', 'CAJERO', 'ADMINISTRADOR']).default('FUNCIONARIO'),
  perfilCodigo: z.string().trim().min(2).max(40),
  sucursalCodigo: z.string().trim().min(2).max(32),
  numeroTurno: z.number().int().min(1).max(3).default(1)
});

const assignShiftSchema = z.object({
  anio: z.number().int().min(2024).max(2100).optional(),
  mes: z.number().int().min(1).max(12).optional(),
  numeroTurno: z.number().int().min(1).max(3),
  sucursalCodigo: z.string().trim().min(2).max(32).optional()
});

function getCurrentYearMonth(): { anio: number; mes: number } {
  const tz = process.env.APP_TIMEZONE || 'America/Santiago';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(new Date());
  return {
    anio: Number(parts.find((p) => p.type === 'year')?.value),
    mes: Number(parts.find((p) => p.type === 'month')?.value)
  };
}

function getShiftScheduleLabel(turno: number): string {
  if (turno === 1) return '08:00 - 16:00 (Desayuno + Almuerzo)';
  if (turno === 2) return '16:00 - 24:00 (Once + Cena 1)';
  return '00:00 - 08:00 (Cena 2 + Desayuno)';
}

function formatEmployee(emp: {
  id: string;
  codigoFuncionario: string;
  rut: string;
  nombreCompleto: string;
  email: string;
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
  turnos?: Array<{
    anio: number;
    mes: number;
    numeroTurno: number;
    sucursalAsignada: { codigo: string; nombre: string };
  }>;
}, includeSensitive = true) {
  const turnoActual = emp.turnos && emp.turnos.length > 0 ? emp.turnos[0] : null;
  return {
    id: emp.id,
    codigoFuncionario: emp.codigoFuncionario,
    ...(includeSensitive ? { rut: emp.rut, email: emp.email } : {}),
    nombreCompleto: emp.nombreCompleto,
    rol: emp.rol,
    activo: emp.activo,
    perfil: {
      id: emp.perfil.id,
      codigo: emp.perfil.codigo,
      nombre: emp.perfil.nombre,
      permiteMultiVale: emp.perfil.permiteMultiVale,
      maxValesPorHorario: emp.perfil.maxValesPorHorario
    },
    sucursalBase: {
      id: emp.sucursalBase.id,
      codigo: emp.sucursalBase.codigo,
      nombre: emp.sucursalBase.nombre
    },
    turnoActual: turnoActual
      ? {
          anio: turnoActual.anio,
          mes: turnoActual.mes,
          numeroTurno: turnoActual.numeroTurno,
          horarioLabel: getShiftScheduleLabel(turnoActual.numeroTurno),
          sucursalAsignadaCodigo: turnoActual.sucursalAsignada.codigo,
          sucursalAsignadaNombre: turnoActual.sucursalAsignada.nombre
        }
      : null
  };
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use(correlationIdMiddleware(logger));

  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', service: 'clients' });
    } catch {
      res.status(503).json({ status: 'degraded', service: 'clients' });
    }
  });

  app.use(requireInternalToken(() => process.env.INTERNAL_TOKEN_CLIENTS || ''));
  app.use(extractUserContext);

  // Sucursales y casinos disponibles
  app.get('/branches', async (_req, res, next) => {
    try {
      const branches = await prisma.sucursal.findMany({
        where: { activa: true },
        include: { casinos: { where: { activo: true }, orderBy: { nombre: 'asc' } } },
        orderBy: { codigo: 'asc' }
      });
      res.json({ branches });
    } catch (err) {
      next(err);
    }
  });

  // Perfiles de comensales (CU4, CU8)
  app.get('/profiles', requireAuthenticatedContext, async (_req, res, next) => {
    try {
      const profiles = await prisma.perfilComensal.findMany({
        orderBy: { codigo: 'asc' }
      });
      res.json({ profiles });
    } catch (err) {
      next(err);
    }
  });

  app.post('/profiles', requireRoles('ADMINISTRADOR'), async (req, res, next) => {
    try {
      const parsed = profileCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Datos invalidos para perfil de comensal', parsed.error.flatten());
      }

      const existing = await prisma.perfilComensal.findUnique({ where: { codigo: parsed.data.codigo } });
      if (existing) {
        throw new AppError(409, 'PROFILE_ALREADY_EXISTS', `El perfil ${parsed.data.codigo} ya existe`);
      }

      const created = await prisma.perfilComensal.create({
        data: {
          codigo: parsed.data.codigo,
          nombre: parsed.data.nombre,
          descripcion: parsed.data.descripcion,
          permiteMultiVale: parsed.data.permiteMultiVale,
          maxValesPorHorario: parsed.data.permiteMultiVale ? parsed.data.maxValesPorHorario : 1,
          activo: true
        }
      });
      res.status(201).json({ profile: created });
    } catch (err) {
      next(err);
    }
  });

  app.put('/profiles/:id', requireRoles('ADMINISTRADOR'), async (req, res, next) => {
    try {
      const parsed = profileUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Datos invalidos al actualizar perfil', parsed.error.flatten());
      }

      const existing = await prisma.perfilComensal.findUnique({ where: { id: getParam(req, 'id') } });
      if (!existing) {
        throw new AppError(404, 'PROFILE_NOT_FOUND', 'Perfil de comensal no encontrado');
      }

      const permiteMulti = parsed.data.permiteMultiVale ?? existing.permiteMultiVale;
      const updated = await prisma.perfilComensal.update({
        where: { id: getParam(req, 'id') },
        data: {
          nombre: parsed.data.nombre,
          descripcion: parsed.data.descripcion,
          permiteMultiVale: permiteMulti,
          maxValesPorHorario: permiteMulti ? (parsed.data.maxValesPorHorario ?? existing.maxValesPorHorario) : 1,
          activo: parsed.data.activo
        }
      });
      res.json({ profile: updated });
    } catch (err) {
      next(err);
    }
  });

  // Ficha propia del funcionario autenticado + turno mensual vigente
  app.get('/employees/me', requireAuthenticatedContext, async (req, res, next) => {
    try {
      const { anio, mes } = getCurrentYearMonth();
      const userId = req.userContext!.userId;
      const emp = await prisma.funcionario.findFirst({
        where: {
          OR: [{ id: userId }, { codigoFuncionario: req.userContext!.codigoFuncionario }]
        },
        include: {
          perfil: true,
          sucursalBase: true,
          turnos: {
            where: { anio, mes },
            include: { sucursalAsignada: true }
          }
        }
      });

      if (!emp) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Funcionario no registrado en clients');
      }

      res.json({ employee: formatEmployee(emp, true) });
    } catch (err) {
      next(err);
    }
  });

  // Consulta por codigo (Admin o propio funcionario)
  app.get('/employees/by-code/:codigo', requireAuthenticatedContext, async (req, res, next) => {
    try {
      const codigo = getParam(req, 'codigo').toUpperCase();
      const ctx = req.userContext!;
      if (ctx.role !== 'ADMINISTRADOR' && ctx.codigoFuncionario.toUpperCase() !== codigo) {
        throw new AppError(403, 'FORBIDDEN', 'No tiene permisos para consultar la ficha de otro funcionario');
      }

      const { anio, mes } = getCurrentYearMonth();
      const emp = await prisma.funcionario.findUnique({
        where: { codigoFuncionario: codigo },
        include: {
          perfil: true,
          sucursalBase: true,
          turnos: { where: { anio, mes }, include: { sucursalAsignada: true } }
        }
      });
      if (!emp) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', `Funcionario ${codigo} no encontrado`);
      }

      res.json({ employee: formatEmployee(emp, true) });
    } catch (err) {
      next(err);
    }
  });

  // Listado / batching de funcionarios (Admin o batching por IDs en GraphQL)
  app.get('/employees', requireAuthenticatedContext, async (req, res, next) => {
    try {
      const ctx = req.userContext!;
      const idsParam = typeof req.query.ids === 'string' ? req.query.ids.trim() : '';

      if (ctx.role !== 'ADMINISTRADOR') {
        if (!idsParam || ctx.role === 'FUNCIONARIO') {
          throw new AppError(403, 'FORBIDDEN', 'Solo administradores pueden listar funcionarios');
        }
      }

      const { anio, mes } = getCurrentYearMonth();
      const ids = idsParam
        ? idsParam
            .split(',')
            .map((s) => s.trim())
            .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
        : undefined;

      const employees = await prisma.funcionario.findMany({
        where: ids && ids.length > 0 ? { id: { in: ids } } : undefined,
        include: {
          perfil: true,
          sucursalBase: true,
          turnos: { where: { anio, mes }, include: { sucursalAsignada: true } }
        },
        orderBy: { codigoFuncionario: 'asc' }
      });

      const includeSensitive = ctx.role === 'ADMINISTRADOR';
      res.json({
        employees: employees.map((e) => formatEmployee(e, includeSensitive))
      });
    } catch (err) {
      next(err);
    }
  });

  // Consulta por ID con control anti-IDOR
  app.get('/employees/:id', requireAuthenticatedContext, async (req, res, next) => {
    try {
      const ctx = req.userContext!;
      if (ctx.role !== 'ADMINISTRADOR' && ctx.userId !== getParam(req, 'id')) {
        throw new AppError(403, 'FORBIDDEN', 'No esta autorizado a consultar datos de otro funcionario');
      }

      const { anio, mes } = getCurrentYearMonth();
      const emp = await prisma.funcionario.findUnique({
        where: { id: getParam(req, 'id') },
        include: {
          perfil: true,
          sucursalBase: true,
          turnos: { where: { anio, mes }, include: { sucursalAsignada: true } }
        }
      });

      if (!emp) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Funcionario no encontrado');
      }

      res.json({ employee: formatEmployee(emp, true) });
    } catch (err) {
      next(err);
    }
  });

  // Crear funcionario (Admin)
  app.post('/employees', requireRoles('ADMINISTRADOR'), async (req, res, next) => {
    try {
      const parsed = createEmployeeSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Datos invalidos para crear funcionario', parsed.error.flatten());
      }

      const perfil = await prisma.perfilComensal.findUnique({ where: { codigo: parsed.data.perfilCodigo } });
      if (!perfil) {
        throw new AppError(404, 'PROFILE_NOT_FOUND', `Perfil ${parsed.data.perfilCodigo} no existe`);
      }

      const sucursal = await prisma.sucursal.findUnique({ where: { codigo: parsed.data.sucursalCodigo } });
      if (!sucursal) {
        throw new AppError(404, 'BRANCH_NOT_FOUND', `Sucursal ${parsed.data.sucursalCodigo} no existe`);
      }

      const { anio, mes } = getCurrentYearMonth();
      const codigo = parsed.data.codigoFuncionario.toUpperCase();

      const created = await prisma.$transaction(async (tx) => {
        const emp = await tx.funcionario.create({
          data: {
            ...(parsed.data.id ? { id: parsed.data.id } : {}),
            codigoFuncionario: codigo,
            rut: parsed.data.rut,
            nombreCompleto: parsed.data.nombreCompleto,
            email: parsed.data.email,
            rol: parsed.data.rol,
            perfilId: perfil.id,
            sucursalBaseId: sucursal.id,
            activo: true
          }
        });
        await tx.turnoMensual.create({
          data: {
            funcionarioId: emp.id,
            anio,
            mes,
            numeroTurno: parsed.data.numeroTurno,
            sucursalAsignadaId: sucursal.id
          }
        });
        return tx.funcionario.findUniqueOrThrow({
          where: { id: emp.id },
          include: {
            perfil: true,
            sucursalBase: true,
            turnos: { where: { anio, mes }, include: { sucursalAsignada: true } }
          }
        });
      });

      res.status(201).json({ employee: formatEmployee(created, true) });
    } catch (err) {
      next(err);
    }
  });

  // Asignar / cambiar turno mensual del funcionario (Admin)
  app.put('/employees/:id/shift', requireRoles('ADMINISTRADOR'), async (req, res, next) => {
    try {
      const parsed = assignShiftSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Datos invalidos para asignar turno mensual', parsed.error.flatten());
      }

      const emp = await prisma.funcionario.findUnique({ where: { id: getParam(req, 'id') } });
      if (!emp) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Funcionario no encontrado');
      }

      let sucursalId = emp.sucursalBaseId;
      if (parsed.data.sucursalCodigo) {
        const suc = await prisma.sucursal.findUnique({ where: { codigo: parsed.data.sucursalCodigo } });
        if (!suc) {
          throw new AppError(404, 'BRANCH_NOT_FOUND', `Sucursal ${parsed.data.sucursalCodigo} no encontrada`);
        }
        sucursalId = suc.id;
      }

      const current = getCurrentYearMonth();
      const anio = parsed.data.anio ?? current.anio;
      const mes = parsed.data.mes ?? current.mes;

      const shift = await prisma.turnoMensual.upsert({
        where: {
          funcionarioId_anio_mes: {
            funcionarioId: emp.id,
            anio,
            mes
          }
        },
        update: {
          numeroTurno: parsed.data.numeroTurno,
          sucursalAsignadaId: sucursalId
        },
        create: {
          funcionarioId: emp.id,
          anio,
          mes,
          numeroTurno: parsed.data.numeroTurno,
          sucursalAsignadaId: sucursalId
        },
        include: { sucursalAsignada: true }
      });

      res.json({
        shift: {
          id: shift.id,
          funcionarioId: shift.funcionarioId,
          anio: shift.anio,
          mes: shift.mes,
          numeroTurno: shift.numeroTurno,
          horarioLabel: getShiftScheduleLabel(shift.numeroTurno),
          sucursalAsignadaCodigo: shift.sucursalAsignada.codigo
        }
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/employees/:id/current-shift', requireAuthenticatedContext, async (req, res, next) => {
    try {
      const ctx = req.userContext!;
      if (ctx.role !== 'ADMINISTRADOR' && ctx.userId !== getParam(req, 'id')) {
        throw new AppError(403, 'FORBIDDEN', 'No esta autorizado a consultar el turno de otro funcionario');
      }

      const { anio, mes } = getCurrentYearMonth();
      const shift = await prisma.turnoMensual.findUnique({
        where: {
          funcionarioId_anio_mes: {
            funcionarioId: getParam(req, 'id'),
            anio,
            mes
          }
        },
        include: { sucursalAsignada: true }
      });

      if (!shift) {
        throw new AppError(404, 'SHIFT_NOT_ASSIGNED', `El funcionario no tiene turno asignado para ${mes}/${anio}`);
      }

      res.json({
        shift: {
          id: shift.id,
          funcionarioId: shift.funcionarioId,
          anio: shift.anio,
          mes: shift.mes,
          numeroTurno: shift.numeroTurno,
          horarioLabel: getShiftScheduleLabel(shift.numeroTurno),
          sucursalAsignadaCodigo: shift.sucursalAsignada.codigo
        }
      });
    } catch (err) {
      next(err);
    }
  });

  app.use(errorHandler(logger));
  return app;
}
