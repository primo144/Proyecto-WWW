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

const logger = createLogger('inventory-service');

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

const createServiceSchema = z.object({
  codigo: z.string().trim().min(2).max(40).regex(/^[A-Z0-9_]+$/),
  nombre: z.string().trim().min(2).max(100),
  descripcion: z.string().trim().min(4).max(255),
  esBase: z.boolean().default(false),
  horarios: z
    .array(
      z.object({
        numeroTurno: z.number().int().min(1).max(3),
        horaInicio: z.string().regex(timeRegex),
        horaFin: z.string().regex(timeRegex)
      })
    )
    .default([]),
  valorizaciones: z
    .array(
      z.object({
        perfilCodigo: z.string().trim().min(2).max(40),
        valorClp: z.number().int().positive()
      })
    )
    .default([])
});

const updateServiceSchema = z.object({
  nombre: z.string().trim().min(2).max(100).optional(),
  descripcion: z.string().trim().min(4).max(255).optional(),
  activo: z.boolean().optional()
});

const upsertValuationSchema = z.object({
  servicioId: z.string().uuid(),
  perfilCodigo: z.string().trim().min(2).max(40),
  valorClp: z.number().int().positive(),
  vigente: z.boolean().default(true)
});

const createProductSchema = z.object({
  codigo: z.string().trim().min(2).max(40),
  nombre: z.string().trim().min(2).max(120),
  categoria: z.string().trim().min(2).max(60),
  precioClp: z.number().int().positive(),
  disponible: z.boolean().default(true)
});

const updateProductSchema = z.object({
  nombre: z.string().trim().min(2).max(120).optional(),
  categoria: z.string().trim().min(2).max(60).optional(),
  precioClp: z.number().int().positive().optional(),
  disponible: z.boolean().optional()
});

const quoteProductsSchema = z.object({
  items: z
    .array(
      z.object({
        productoId: z.string().uuid(),
        cantidad: z.number().int().positive().max(100)
      })
    )
    .min(1)
});

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use(correlationIdMiddleware(logger));

  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', service: 'inventory' });
    } catch {
      res.status(503).json({ status: 'degraded', service: 'inventory' });
    }
  });

  app.use(requireInternalToken(() => process.env.INTERNAL_TOKEN_INVENTORY || ''));
  app.use(extractUserContext);

  // Catalogo publico seguro de productos del casino (S01)
  app.get('/products', async (req, res, next) => {
    try {
      const availableRaw = req.query.available;
      let availableFilter: boolean | undefined;
      if (availableRaw !== undefined) {
        if (availableRaw === 'true') availableFilter = true;
        else if (availableRaw === 'false') availableFilter = false;
        else {
          throw new AppError(400, 'INVALID_FILTER', 'El parametro available debe ser true o false');
        }
      }

      const products = await prisma.productoCasino.findMany({
        where: availableFilter !== undefined ? { disponible: availableFilter } : undefined,
        select: {
          id: true,
          codigo: true,
          nombre: true,
          categoria: true,
          precioClp: true,
          disponible: true
        },
        orderBy: [{ categoria: 'asc' }, { nombre: 'asc' }]
      });

      res.json({ products });
    } catch (err) {
      next(err);
    }
  });

  app.post('/products', requireRoles('ADMINISTRADOR'), async (req, res, next) => {
    try {
      const parsed = createProductSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Datos invalidos para producto de casino', parsed.error.flatten());
      }

      const codigo = parsed.data.codigo.toUpperCase();
      const existing = await prisma.productoCasino.findUnique({ where: { codigo } });
      if (existing) {
        throw new AppError(409, 'PRODUCT_ALREADY_EXISTS', `El producto ${codigo} ya existe`);
      }

      const product = await prisma.productoCasino.create({
        data: {
          codigo,
          nombre: parsed.data.nombre,
          categoria: parsed.data.categoria,
          precioClp: parsed.data.precioClp,
          disponible: parsed.data.disponible
        }
      });

      res.status(201).json({ product });
    } catch (err) {
      next(err);
    }
  });

  app.put('/products/:id', requireRoles('ADMINISTRADOR'), async (req, res, next) => {
    try {
      const parsed = updateProductSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Datos invalidos para actualizar producto', parsed.error.flatten());
      }

      const existing = await prisma.productoCasino.findUnique({ where: { id: getParam(req, 'id') } });
      if (!existing) {
        throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
      }

      const product = await prisma.productoCasino.update({
        where: { id: getParam(req, 'id') },
        data: parsed.data
      });

      res.json({ product });
    } catch (err) {
      next(err);
    }
  });

  // Cotizacion autoritativa interna de productos (usada por orders al registrar canje CU5)
  app.post('/internal/products/quote', async (req, res, next) => {
    try {
      const parsed = quoteProductsSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Items de cotizacion invalidos', parsed.error.flatten());
      }

      const ids = Array.from(new Set(parsed.data.items.map((i) => i.productoId)));
      const dbProducts = await prisma.productoCasino.findMany({
        where: { id: { in: ids } }
      });

      const productMap = new Map(dbProducts.map((p) => [p.id, p]));
      const quotedItems: Array<{
        productoId: string;
        productoCodigo: string;
        productoNombre: string;
        cantidad: number;
        precioUnitarioClp: number;
        subtotalClp: number;
      }> = [];

      let totalConsumoClp = 0;

      for (const reqItem of parsed.data.items) {
        const prod = productMap.get(reqItem.productoId);
        if (!prod) {
          throw new AppError(404, 'PRODUCT_NOT_FOUND', `Producto ${reqItem.productoId} no existe`);
        }
        if (!prod.disponible) {
          throw new AppError(409, 'PRODUCT_UNAVAILABLE', `Producto ${prod.nombre} no esta disponible`);
        }
        const subtotalClp = prod.precioClp * reqItem.cantidad;
        totalConsumoClp += subtotalClp;
        quotedItems.push({
          productoId: prod.id,
          productoCodigo: prod.codigo,
          productoNombre: prod.nombre,
          cantidad: reqItem.cantidad,
          precioUnitarioClp: prod.precioClp,
          subtotalClp
        });
      }

      res.json({
        items: quotedItems,
        totalConsumoClp
      });
    } catch (err) {
      next(err);
    }
  });

  // Servicios de alimentacion extensibles + horarios + valorizaciones
  app.get('/services', requireAuthenticatedContext, async (req, res, next) => {
    try {
      const activoRaw = req.query.activo;
      const turnoRaw = req.query.turno;
      const perfilCodigoRaw = typeof req.query.perfilCodigo === 'string' ? req.query.perfilCodigo.trim() : undefined;

      let activoFilter: boolean | undefined;
      if (activoRaw !== undefined) {
        if (activoRaw === 'true') activoFilter = true;
        else if (activoRaw === 'false') activoFilter = false;
        else throw new AppError(400, 'INVALID_FILTER', 'Parametro activo debe ser true o false');
      }

      let turnoFilter: number | undefined;
      if (turnoRaw !== undefined) {
        const num = Number(turnoRaw);
        if (![1, 2, 3].includes(num)) {
          throw new AppError(400, 'INVALID_FILTER', 'Parametro turno debe ser 1, 2 o 3');
        }
        turnoFilter = num;
      }

      const services = await prisma.servicioAlimentacion.findMany({
        where: {
          ...(activoFilter !== undefined ? { activo: activoFilter } : {}),
          ...(turnoFilter !== undefined ? { horarios: { some: { numeroTurno: turnoFilter } } } : {})
        },
        include: {
          horarios: {
            ...(turnoFilter !== undefined ? { where: { numeroTurno: turnoFilter } } : {}),
            orderBy: { numeroTurno: 'asc' }
          },
          valorizaciones: {
            where: {
              vigente: true,
              ...(perfilCodigoRaw ? { perfilCodigo: perfilCodigoRaw } : {})
            },
            orderBy: { perfilCodigo: 'asc' }
          }
        },
        orderBy: [{ esBase: 'desc' }, { codigo: 'asc' }]
      });

      res.json({ services });
    } catch (err) {
      next(err);
    }
  });

  // CU3 / RF9: Crear nuevo servicio de alimentacion extensible
  app.post('/services', requireRoles('ADMINISTRADOR'), async (req, res, next) => {
    try {
      const parsed = createServiceSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Datos invalidos para servicio de alimentacion', parsed.error.flatten());
      }

      const existing = await prisma.servicioAlimentacion.findUnique({ where: { codigo: parsed.data.codigo } });
      if (existing) {
        throw new AppError(409, 'SERVICE_ALREADY_EXISTS', `El servicio ${parsed.data.codigo} ya existe`);
      }

      const created = await prisma.servicioAlimentacion.create({
        data: {
          codigo: parsed.data.codigo,
          nombre: parsed.data.nombre,
          descripcion: parsed.data.descripcion,
          esBase: parsed.data.esBase,
          activo: true,
          horarios: {
            create: parsed.data.horarios.map((h) => ({
              numeroTurno: h.numeroTurno,
              horaInicio: h.horaInicio,
              horaFin: h.horaFin
            }))
          },
          valorizaciones: {
            create: parsed.data.valorizaciones.map((v) => ({
              perfilCodigo: v.perfilCodigo,
              valorClp: v.valorClp,
              vigente: true
            }))
          }
        },
        include: {
          horarios: true,
          valorizaciones: true
        }
      });

      res.status(201).json({ service: created });
    } catch (err) {
      next(err);
    }
  });

  app.put('/services/:id', requireRoles('ADMINISTRADOR'), async (req, res, next) => {
    try {
      const parsed = updateServiceSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Datos invalidos al actualizar servicio', parsed.error.flatten());
      }

      const existing = await prisma.servicioAlimentacion.findUnique({ where: { id: getParam(req, 'id') } });
      if (!existing) {
        throw new AppError(404, 'SERVICE_NOT_FOUND', 'Servicio de alimentacion no encontrado');
      }

      const updated = await prisma.servicioAlimentacion.update({
        where: { id: getParam(req, 'id') },
        data: parsed.data,
        include: { horarios: true, valorizaciones: true }
      });

      res.json({ service: updated });
    } catch (err) {
      next(err);
    }
  });

  // CU4 / RF3: Valorizaciones por servicio y perfil
  app.get('/valuations', requireAuthenticatedContext, async (_req, res, next) => {
    try {
      const valuations = await prisma.valorizacionPerfil.findMany({
        include: { servicio: { select: { codigo: true, nombre: true } } },
        orderBy: [{ perfilCodigo: 'asc' }, { servicioId: 'asc' }]
      });
      res.json({ valuations });
    } catch (err) {
      next(err);
    }
  });

  app.put('/valuations', requireRoles('ADMINISTRADOR'), async (req, res, next) => {
    try {
      const parsed = upsertValuationSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Datos invalidos para valorizacion', parsed.error.flatten());
      }

      const servicio = await prisma.servicioAlimentacion.findUnique({ where: { id: parsed.data.servicioId } });
      if (!servicio) {
        throw new AppError(404, 'SERVICE_NOT_FOUND', 'Servicio no encontrado');
      }

      const valuation = await prisma.valorizacionPerfil.upsert({
        where: {
          servicioId_perfilCodigo: {
            servicioId: parsed.data.servicioId,
            perfilCodigo: parsed.data.perfilCodigo
          }
        },
        update: {
          valorClp: parsed.data.valorClp,
          vigente: parsed.data.vigente
        },
        create: {
          servicioId: parsed.data.servicioId,
          perfilCodigo: parsed.data.perfilCodigo,
          valorClp: parsed.data.valorClp,
          vigente: parsed.data.vigente
        }
      });

      res.json({ valuation });
    } catch (err) {
      next(err);
    }
  });

  app.use(errorHandler(logger));
  return app;
}
