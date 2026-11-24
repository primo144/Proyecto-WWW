import express from 'express';
import { z } from 'zod';
import {
  AppError,
  correlationIdMiddleware,
  createLogger,
  errorHandler,
  extractUserContext,
  requireAuthenticatedContext,
  requireInternalToken,
  requireRoles
} from '@libros/shared';
import { prisma } from './db';
import { EmailSandboxAdapter } from './emailAdapter';

const logger = createLogger('payments-service');
const emailAdapter = new EmailSandboxAdapter(logger);

const settleSchema = z.object({
  idempotencyKey: z.string().trim().min(4).max(120),
  valeId: z.string().uuid(),
  numeroVale: z.string().trim().min(4).max(40),
  cajeroId: z.string().uuid(),
  casinoCodigo: z.string().trim().min(2).max(32),
  valorValeClp: z.number().int().positive(),
  totalConsumoClp: z.number().int().positive(),
  metodoPagoDiferencia: z.enum(['NO_APLICA', 'EFECTIVO', 'TARJETA_DEBITO', 'TARJETA_CREDITO']).default('NO_APLICA')
});

const closeReconciliationSchema = z.object({
  casinoCodigo: z.string().trim().min(2).max(32),
  anio: z.number().int().min(2024).max(2100),
  mes: z.number().int().min(1).max(12)
});

const runWeeklyNotificationsSchema = z.object({
  fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fechaFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

function getDefaultWeekBounds(): { fechaInicio: string; fechaFin: string } {
  const tz = process.env.APP_TIMEZONE || 'America/Santiago';
  const nowStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const baseDate = new Date(`${nowStr}T12:00:00Z`);
  const day = baseDate.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(baseDate.getTime() + diffToMonday * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return {
    fechaInicio: monday.toISOString().slice(0, 10),
    fechaFin: sunday.toISOString().slice(0, 10)
  };
}

interface StoredProcNoticeRow {
  aviso_id: string;
  funcionario_id: string;
  codigo_funcionario: string;
  email_destino: string;
  vales_disponibles: number;
  vales_usados: number;
  vales_no_usados: number;
  estado_envio: string;
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use(correlationIdMiddleware(logger));

  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', service: 'payments' });
    } catch {
      res.status(503).json({ status: 'degraded', service: 'payments' });
    }
  });

  app.use(requireInternalToken(() => process.env.INTERNAL_TOKEN_PAYMENTS || ''));
  app.use(extractUserContext);

  // Liquidacion autoritativa e idempotente de canje (invocada por orders)
  app.post('/transactions/settle', async (req, res, next) => {
    try {
      const parsed = settleSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Datos invalidos para liquidar transaccion', parsed.error.flatten());
      }

      const data = parsed.data;
      const existing = await prisma.transaccionCanje.findFirst({
        where: {
          OR: [{ idempotencyKey: data.idempotencyKey }, { valeId: data.valeId }]
        }
      });

      if (existing) {
        res.status(200).json({ transaction: existing, idempotentReplay: true });
        return;
      }

      const montoCubiertoValeClp = Math.min(data.valorValeClp, data.totalConsumoClp);
      const saldoAFavorClp = Math.max(0, data.valorValeClp - data.totalConsumoClp);
      const diferenciaPagadaClp = Math.max(0, data.totalConsumoClp - data.valorValeClp);

      if (diferenciaPagadaClp > 0 && data.metodoPagoDiferencia === 'NO_APLICA') {
        throw new AppError(
          400,
          'PAYMENT_METHOD_REQUIRED',
          `El consumo (${data.totalConsumoClp} CLP) excede el valor del vale (${data.valorValeClp} CLP). Debe seleccionar un metodo de pago para la diferencia (${diferenciaPagadaClp} CLP).`
        );
      }

      const effectiveMethod = diferenciaPagadaClp === 0 ? 'NO_APLICA' : data.metodoPagoDiferencia;

      const created = await prisma.transaccionCanje.create({
        data: {
          idempotencyKey: data.idempotencyKey,
          valeId: data.valeId,
          numeroVale: data.numeroVale,
          cajeroId: data.cajeroId,
          casinoCodigo: data.casinoCodigo,
          valorValeClp: data.valorValeClp,
          totalConsumoClp: data.totalConsumoClp,
          montoCubiertoValeClp,
          saldoAFavorClp,
          diferenciaPagadaClp,
          metodoPagoDiferencia: effectiveMethod,
          estado: 'LIQUIDADO'
        }
      });

      res.status(201).json({ transaction: created, idempotentReplay: false });
    } catch (err) {
      next(err);
    }
  });

  // Consulta de transacciones (Admin todos, Cajero solo los propios)
  app.get('/transactions', requireRoles('ADMINISTRADOR', 'CAJERO'), async (req, res, next) => {
    try {
      const ctx = req.userContext!;
      const casinoCodigo = typeof req.query.casinoCodigo === 'string' ? req.query.casinoCodigo.trim() : undefined;
      const valeId = typeof req.query.valeId === 'string' ? req.query.valeId.trim() : undefined;

      const transactions = await prisma.transaccionCanje.findMany({
        where: {
          ...(ctx.role === 'CAJERO' ? { cajeroId: ctx.userId } : {}),
          ...(casinoCodigo ? { casinoCodigo } : {}),
          ...(valeId ? { valeId } : {})
        },
        orderBy: { createdAt: 'desc' },
        take: 200
      });

      res.json({ transactions });
    } catch (err) {
      next(err);
    }
  });

  // Rendicion consolidada para empresa externa de casinos (Admin)
  app.get('/reconciliation', requireRoles('ADMINISTRADOR'), async (_req, res, next) => {
    try {
      const allTx = await prisma.transaccionCanje.findMany({
        where: { estado: 'LIQUIDADO' }
      });

      const byCasino = new Map<
        string,
        {
          casinoCodigo: string;
          totalValesCanjeados: number;
          totalValorValesClp: number;
          totalConsumoClp: number;
          totalCubiertoValeClp: number;
          totalDiferenciasClp: number;
          totalSaldosNoUsadosClp: number;
        }
      >();

      for (const tx of allTx) {
        const current = byCasino.get(tx.casinoCodigo) ?? {
          casinoCodigo: tx.casinoCodigo,
          totalValesCanjeados: 0,
          totalValorValesClp: 0,
          totalConsumoClp: 0,
          totalCubiertoValeClp: 0,
          totalDiferenciasClp: 0,
          totalSaldosNoUsadosClp: 0
        };
        current.totalValesCanjeados += 1;
        current.totalValorValesClp += tx.valorValeClp;
        current.totalConsumoClp += tx.totalConsumoClp;
        current.totalCubiertoValeClp += tx.montoCubiertoValeClp;
        current.totalDiferenciasClp += tx.diferenciaPagadaClp;
        current.totalSaldosNoUsadosClp += tx.saldoAFavorClp;
        byCasino.set(tx.casinoCodigo, current);
      }

      const closures = await prisma.rendicionCasino.findMany({
        orderBy: [{ anio: 'desc' }, { mes: 'desc' }, { casinoCodigo: 'asc' }]
      });

      res.json({
        summaryByCasino: Array.from(byCasino.values()),
        closures
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/reconciliation/close', requireRoles('ADMINISTRADOR'), async (req, res, next) => {
    try {
      const parsed = closeReconciliationSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Datos invalidos para cerrar rendicion', parsed.error.flatten());
      }

      const { casinoCodigo, anio, mes } = parsed.data;
      const startDate = new Date(Date.UTC(anio, mes - 1, 1, 0, 0, 0));
      const endDate = new Date(Date.UTC(anio, mes, 1, 0, 0, 0));

      const txList = await prisma.transaccionCanje.findMany({
        where: {
          casinoCodigo,
          estado: 'LIQUIDADO',
          createdAt: { gte: startDate, lt: endDate }
        }
      });

      const totals = txList.reduce(
        (acc, tx) => ({
          totalValesCanjeados: acc.totalValesCanjeados + 1,
          totalValorValesClp: acc.totalValorValesClp + tx.valorValeClp,
          totalConsumoClp: acc.totalConsumoClp + tx.totalConsumoClp,
          totalDiferenciasClp: acc.totalDiferenciasClp + tx.diferenciaPagadaClp,
          totalSaldosNoUsadosClp: acc.totalSaldosNoUsadosClp + tx.saldoAFavorClp
        }),
        {
          totalValesCanjeados: 0,
          totalValorValesClp: 0,
          totalConsumoClp: 0,
          totalDiferenciasClp: 0,
          totalSaldosNoUsadosClp: 0
        }
      );

      const closure = await prisma.rendicionCasino.upsert({
        where: {
          casinoCodigo_anio_mes: { casinoCodigo, anio, mes }
        },
        update: {
          ...totals,
          estado: 'CERRADA',
          generadaPorId: req.userContext!.userId,
          generadaEn: new Date()
        },
        create: {
          casinoCodigo,
          anio,
          mes,
          ...totals,
          estado: 'CERRADA',
          generadaPorId: req.userContext!.userId
        }
      });

      res.status(201).json({ closure });
    } catch (err) {
      next(err);
    }
  });

  // CU9 / RF14 / RNF4: Ejecutar procedimiento almacenado y enviar avisos semanales (sandbox)
  app.post('/notifications/weekly/run', requireRoles('ADMINISTRADOR'), async (req, res, next) => {
    try {
      const parsed = runWeeklyNotificationsSchema.safeParse(req.body || {});
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Rango de fechas invalido', parsed.error.flatten());
      }

      const defaults = getDefaultWeekBounds();
      const fechaInicio = parsed.data.fechaInicio ?? defaults.fechaInicio;
      const fechaFin = parsed.data.fechaFin ?? defaults.fechaFin;

      const spRows = await prisma.$queryRaw<StoredProcNoticeRow[]>`
        SELECT * FROM payments.sp_generar_avisos_semanales(${fechaInicio}::date, ${fechaFin}::date)
      `;

      let dispatchedCount = 0;
      for (const row of spRows) {
        if (row.estado_envio === 'PENDIENTE') {
          const result = await emailAdapter.sendWeeklySummary(
            {
              avisoId: row.aviso_id,
              codigoFuncionario: row.codigo_funcionario,
              emailDestino: row.email_destino,
              semanaInicio: fechaInicio,
              semanaFin: fechaFin,
              valesDisponibles: row.vales_disponibles,
              valesUsados: row.vales_usados,
              valesNoUsados: row.vales_no_usados
            },
            req.correlationId
          );

          await prisma.avisoSemanalCorreo.update({
            where: { id: row.aviso_id },
            data: {
              estadoEnvio: result.accepted ? 'ENVIADO_SANDBOX' : 'ERROR',
              proveedorRespuesta: result.summary,
              enviadoEn: new Date()
            }
          });
          dispatchedCount += 1;
        }
      }

      const notifications = await prisma.avisoSemanalCorreo.findMany({
        where: {
          semanaInicio: new Date(`${fechaInicio}T00:00:00.000Z`),
          semanaFin: new Date(`${fechaFin}T00:00:00.000Z`)
        },
        orderBy: { codigoFuncionario: 'asc' }
      });

      res.json({
        semanaInicio: fechaInicio,
        semanaFin: fechaFin,
        providerMode: process.env.EMAIL_PROVIDER_MODE || 'sandbox',
        totalProcesados: spRows.length,
        dispatchedCount,
        notifications
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/notifications/weekly', requireAuthenticatedContext, async (req, res, next) => {
    try {
      const ctx = req.userContext!;
      const notifications = await prisma.avisoSemanalCorreo.findMany({
        where: ctx.role === 'ADMINISTRADOR' ? undefined : { funcionarioId: ctx.userId },
        orderBy: [{ semanaInicio: 'desc' }, { codigoFuncionario: 'asc' }],
        take: 100
      });
      res.json({ notifications });
    } catch (err) {
      next(err);
    }
  });

  app.use(errorHandler(logger));
  return app;
}
