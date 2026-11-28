import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PROTOTYPE_PORT || 8081);
const allowedEmployees = new Set(['EMP001', 'EMP002', 'EMP003', 'SEC001']);
const services = [
  { codigo: 'DESAYUNO', nombre: 'Desayuno', inicio: '08:00', fin: '10:00', valorClp: 3500, disponibleAhora: true },
  { codigo: 'ALMUERZO', nombre: 'Almuerzo', inicio: '11:30', fin: '14:30', valorClp: 6500, disponibleAhora: true },
  { codigo: 'ONCE', nombre: 'Once', inicio: '16:00', fin: '18:00', valorClp: 4500, disponibleAhora: false }
];
const issued = new Map();

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'], ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'], ['.svg', 'image/svg+xml']
]);

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_384) throw Object.assign(new Error('Cuerpo demasiado grande'), { status: 413 });
  }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error('JSON inválido'), { status: 400 }); }
}

const server = createServer((req, res) => {
  void handleRequest(req, res).catch((error) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const status = Number(error?.status) || 500;
    const code = status === 413 ? 'BODY_TOO_LARGE' : status === 400 ? 'INVALID_JSON' : 'INTERNAL_ERROR';
    const message = status < 500 ? error.message : 'Error interno de la API de demostración.';
    json(res, status, { error: { code, message } });
  });
});

async function handleRequest(req, res) {
  const correlationId = req.headers['x-correlation-id']?.toString() || `demo-${randomUUID()}`;
  res.setHeader('x-correlation-id', correlationId);
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/demo/')) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 240));
    if (url.pathname === '/api/demo/health' && req.method === 'GET') {
      return json(res, 200, { status: 'ok', mode: 'in-memory-demo', correlationId });
    }
    if (url.pathname === '/api/demo/session' && req.method === 'POST') {
      const body = await readJson(req);
      const codigo = String(body.codigoFuncionario || '').trim().toUpperCase();
      if (!allowedEmployees.has(codigo)) return json(res, 401, { error: { code: 'FUNCIONARIO_NO_RECONOCIDO', message: 'Usa una cuenta de demostración válida: EMP001, EMP002, EMP003 o SEC001.' }, correlationId });
      return json(res, 200, { user: { codigoFuncionario: codigo, rol: 'FUNCIONARIO', perfil: codigo === 'SEC001' ? 'SECRETARIA_GERENCIA' : 'OBRERO' }, correlationId });
    }
    if (url.pathname === '/api/demo/services' && req.method === 'GET') {
      const scenario = url.searchParams.get('scenario') || 'success';
      if (scenario === 'error') return json(res, 503, { error: { code: 'SERVICIO_TEMPORALMENTE_NO_DISPONIBLE', message: 'No pudimos consultar los servicios. Intenta nuevamente.' }, correlationId });
      return json(res, 200, { services: scenario === 'empty' ? [] : services, correlationId });
    }
    if (url.pathname === '/api/demo/vouchers' && req.method === 'POST') {
      const body = await readJson(req);
      const codigo = String(body.codigoFuncionario || '').trim().toUpperCase();
      const service = services.find((item) => item.codigo === body.servicioCodigo);
      if (!allowedEmployees.has(codigo)) return json(res, 401, { error: { code: 'FUNCIONARIO_NO_RECONOCIDO', message: 'Identifícate antes de emitir un vale.' }, correlationId });
      if (!service) return json(res, 422, { error: { code: 'SERVICIO_INVALIDO', message: 'El servicio seleccionado no existe.' }, correlationId });
      if ([...issued.values()].some((voucher) => voucher.codigoFuncionario === codigo && voucher.servicioCodigo === service.codigo)) {
        return json(res, 409, { error: { code: 'VALE_DUPLICADO', message: 'Ya emitiste un vale de este servicio en esta demostración.' }, correlationId });
      }
      const now = new Date();
      const voucher = {
        id: randomUUID(),
        numeroVale: `DEMO-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 6).toUpperCase()}`,
        codigoFuncionario: codigo,
        servicioCodigo: service.codigo,
        servicioNombre: service.nombre,
        valorClp: service.valorClp,
        horario: `${service.inicio}–${service.fin}`,
        emitidoEn: now.toISOString(),
        estado: 'IMPRESO',
        entorno: 'DEMO_VOLATIL'
      };
      issued.set(voucher.id, voucher);
      return json(res, 201, { voucher, correlationId });
    }
    return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Ruta de demostración no encontrada.' }, correlationId });
  }

  const requested = url.pathname === '/' ? '/prototipo-eval1.html' : decodeURIComponent(url.pathname);
  const file = resolve(root, `.${requested}`);
  if (!file.startsWith(root + sep) && file !== root) return json(res, 403, { error: 'Forbidden' });
  try {
    const contents = await readFile(file);
    res.writeHead(200, { 'content-type': mimeTypes.get(extname(file)) || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(contents);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
}

server.listen(port, '127.0.0.1', () => {
  console.log(`Prototipo Evaluación 1 en http://localhost:${port}/prototipo-eval1.html`);
  console.log('API simulada en memoria; sus registros se borran al detener este proceso.');
});

function stop() { server.close(() => process.exit(0)); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
