import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baseUrl = process.env.GATEWAY_URL || 'http://localhost:8080';
const password = process.env.TEST_USER_PASSWORD || 'Libros2026!';
const runId = `RUN_UNIT2_${new Date().toISOString().replace(/[:.]/g, '-')}`;
const evidenceDir = path.join(root, 'docs', 'evidencias', 'entrega-2', runId);
const observations = [];

async function call(route, { method = 'GET', token, body } = {}) {
  const correlationId = crypto.randomUUID();
  const started = performance.now();
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      Accept: 'application/json',
      'X-Correlation-ID': correlationId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { malformedJson: true }; }
  return {
    status: response.status,
    data,
    correlationId: response.headers.get('X-Correlation-ID') || correlationId,
    durationMs: Math.round(performance.now() - started)
  };
}

function observe(id, title, result, details = {}) {
  observations.push({ id, title, result: 'PASSED', httpStatus: result.status, correlationId: result.correlationId, durationMs: result.durationMs, ...details });
}

function status(result, expected, label) {
  assert.equal(result.status, expected, `${label}: expected HTTP ${expected}, observed ${result.status}: ${JSON.stringify(result.data)}`);
}

async function signIn(code, pass = password) {
  const result = await call('/api/v1/auth/login', { method: 'POST', body: { codigoFuncionario: code, password: pass } });
  status(result, 200, `login ${code}`);
  assert.ok(result.data.accessToken && result.data.refreshToken, `login ${code} must return access and refresh tokens`);
  return { token: result.data.accessToken, refreshToken: result.data.refreshToken, user: result.data.user, result };
}

async function main() {
  const health = await call('/health');
  status(health, 200, 'gateway health');
  observe('P00', 'Gateway health', health, { service: health.data.service });

  const catalog = await call('/api/v1/public/products?available=true');
  status(catalog, 200, 'public product catalog');
  assert.ok(catalog.data.products.length > 0, 'Oracle catalog should contain products');
  observe('P01', 'Anonymous catalog query backed by Oracle', catalog, { rows: catalog.data.products.length });

  const anonymous = await call('/api/v1/orders/vouchers/my');
  status(anonymous, 401, 'anonymous protected request');
  observe('P02', 'Anonymous access is rejected', anonymous);

  const employee = await signIn('EMP001');
  observe('P03', 'PBKDF2 login and persistent session', employee.result, { account: employee.user.codigoFuncionario, role: employee.user.role });
  const own = await call('/api/v1/clients/employees/me', { token: employee.token });
  status(own, 200, 'own employee profile');
  assert.equal(own.data.employee.codigoFuncionario, 'EMP001');
  observe('P04', 'Authorized employee reads own profile', own);

  const idor = await call('/api/v1/clients/employees/30000000-0000-4000-8000-000000000003', { token: employee.token });
  status(idor, 403, 'cross-employee IDOR');
  observe('P05', 'Cross-employee IDOR is rejected', idor);
  const rbac = await call('/api/v1/orders/reports/audit', { token: employee.token });
  status(rbac, 403, 'employee audit RBAC');
  observe('P06', 'Non-admin audit access is rejected', rbac);

  const query = `query MiResumenComensal {
    miResumenComensal {
      funcionario { codigoFuncionario rut email perfil { codigo permiteMultiVale } turnoActual { numeroTurno } }
      serviciosDelTurno { codigo valorClp habilitadoAhora }
      sucursales { codigo nombre }
      partialErrors { subsystem code }
    }
  }`;
  const aggregate = await call('/api/v1/graphql', { method: 'POST', token: employee.token, body: { query } });
  status(aggregate, 200, 'GraphQL employee summary');
  const summary = aggregate.data?.data?.miResumenComensal;
  assert.equal(summary?.funcionario?.codigoFuncionario, 'EMP001');
  assert.deepEqual(summary?.partialErrors, []);
  assert.ok(summary.serviciosDelTurno.length > 0 && summary.sucursales.length >= 2);
  observe('P07', 'GraphQL summary aggregates clients, inventory, orders and payments', aggregate, { serviceRows: summary.serviciosDelTurno.length, branches: summary.sucursales.length, partialErrors: 0 });

  const tooDeep = await call('/api/v1/graphql', { method: 'POST', token: employee.token, body: { query: 'query { a { b { c { d { e } } } } }' } });
  status(tooDeep, 400, 'GraphQL depth limit');
  assert.match(JSON.stringify(tooDeep.data), /GRAPHQL_DEPTH_LIMIT_EXCEEDED/);
  observe('P08', 'GraphQL depth limit rejects a depth-five query', tooDeep);

  const aliases = Array.from({ length: 41 }, (_, i) => `field${i}: catalogoCasino { codigo }`).join('\n');
  const tooComplex = await call('/api/v1/graphql', { method: 'POST', token: employee.token, body: { query: `query { ${aliases} }` } });
  status(tooComplex, 400, 'GraphQL complexity/alias limit');
  assert.match(JSON.stringify(tooComplex.data), /GRAPHQL_COMPLEXITY_LIMIT_EXCEEDED/);
  observe('P09', 'GraphQL alias and complexity limits reject abuse', tooComplex);

  const testSuffix = Date.now().toString(36).toUpperCase();
  const admin = await signIn('ADM001');
  const newProfile = await call('/api/v1/clients/profiles', {
    method: 'POST', token: admin.token,
    body: { codigo: `TEST_PROFILE_${testSuffix}`, nombre: 'Perfil de Prueba', descripcion: 'Perfil temporal para pruebas', permiteMultiVale: true, maxValesPorHorario: 2 }
  });
  status(newProfile, 201, 'profile creation');
  observe('P10', 'Clients service creates a profile', newProfile, { profileCode: newProfile.data.profile.codigo });

  const newEmployeeCode = `TEST${testSuffix.slice(-6)}`;
  const employeeCreation = await call('/api/v1/clients/employees', {
    method: 'POST', token: admin.token,
    body: {
      codigoFuncionario: newEmployeeCode, rut: `9${testSuffix.slice(-7)}-1`, nombreCompleto: 'Funcionario Prueba Oracle',
      email: `test_${testSuffix.toLowerCase()}@example.test`, role: 'FUNCIONARIO', perfilCodigo: newProfile.data.profile.codigo,
      sucursalCodigo: 'CENTRAL', numeroTurno: 1, password: 'Temporal2026!'
    }
  });
  status(employeeCreation, 201, 'employee and auth user creation');
  const newLogin = await signIn(newEmployeeCode, 'Temporal2026!');
  assert.equal(newLogin.user.codigoFuncionario, newEmployeeCode);
  observe('P11', 'Clients and Auth services create a linked employee login', employeeCreation, { account: newEmployeeCode });

  const product = await call('/api/v1/inventory/products', {
    method: 'POST', token: admin.token,
    body: { codigo: `TEST_${testSuffix}`, nombre: 'Producto temporal de prueba', categoria: 'Pruebas', precioClp: 3200, disponible: true }
  });
  status(product, 201, 'product creation');
  const productUpdate = await call(`/api/v1/inventory/products/${product.data.product.id}`, { method: 'PUT', token: admin.token, body: { disponible: false } });
  status(productUpdate, 200, 'product availability update');
  const publicProduct = await call('/api/v1/public/products?available=false');
  status(publicProduct, 200, 'unavailable public catalog');
  assert.ok(publicProduct.data.products.some((row) => row.codigo === `TEST_${testSuffix}`));
  observe('P12', 'Inventory creates and updates authoritative product availability', productUpdate, { productCode: product.data.product.codigo });

  const service = await call('/api/v1/inventory/services', {
    method: 'POST', token: admin.token,
    body: {
      codigo: `TEST_SERVICE_${testSuffix}`, nombre: 'Servicio Prueba', descripcion: 'Servicio temporal integración', esBase: false,
      horarios: [{ numeroTurno: 1, horaInicio: '09:00', horaFin: '10:00' }],
      valorizaciones: [{ perfilCodigo: newProfile.data.profile.codigo, valorClp: 5600 }]
    }
  });
  status(service, 201, 'extensible service creation');
  observe('P13', 'Inventory creates an extensible service, schedule and valuation', service, { serviceCode: service.data.service.codigo });

  const shiftUpdate = await call(`/api/v1/clients/employees/${employeeCreation.data.employee.id}/shift`, {
    method: 'PUT', token: admin.token, body: { numeroTurno: 2, sucursalCodigo: 'NORTE' }
  });
  status(shiftUpdate, 200, 'monthly shift update');
  observe('P14', 'Clients updates monthly shift and branch assignment', shiftUpdate, { shift: 2, branch: 'NORTE' });

  const activeShiftEmployee = await signIn('EMP002');
  const issue = await call('/api/v1/orders/vouchers/issue', {
    method: 'POST', token: activeShiftEmployee.token,
    body: { servicioCodigo: 'CENA1', sucursalEmisionCodigo: 'CENTRAL' }
  });
  status(issue, 201, 'normal voucher issuance during the controlled test clock');
  assert.equal(issue.data.voucher.estado, 'IMPRESO');
  assert.ok(issue.durationMs < 2_000, `voucher issue took ${issue.durationMs} ms`);
  const duplicateIssue = await call('/api/v1/orders/vouchers/issue', {
    method: 'POST', token: activeShiftEmployee.token,
    body: { servicioCodigo: 'CENA1', sucursalEmisionCodigo: 'CENTRAL' }
  });
  status(duplicateIssue, 409, 'duplicate normal voucher');
  observe('P15', 'Normal voucher issue is persisted below RF2 and duplicate is rejected', issue, { voucherNumber: issue.data.voucher.numeroVale, duplicateStatus: duplicateIssue.status });

  const cashier = await signIn('CAJ001');
  const menu = await call('/api/v1/inventory/products?available=true', { token: cashier.token });
  status(menu, 200, 'cashier product list');
  const redeem = await call(`/api/v1/orders/vouchers/${issue.data.voucher.numeroVale}/redeem`, {
    method: 'POST', token: cashier.token,
    body: { casinoCodigo: 'CASINO_CENTRAL_COMEDOR', items: [{ productoId: menu.data.products[0].id, cantidad: 2 }], metodoPagoDiferencia: 'EFECTIVO' }
  });
  status(redeem, 201, 'voucher redemption across orders, inventory and payments');
  assert.equal(redeem.data.voucher.estado, 'CANJEADO');
  assert.equal(redeem.data.paymentTransaction.estado, 'LIQUIDADO');
  const paymentRead = await call(`/api/v1/payments/transactions?valeId=${encodeURIComponent(issue.data.voucher.id)}`, { token: cashier.token });
  status(paymentRead, 200, 'persisted payment transaction');
  assert.equal(paymentRead.data.transactions.length, 1);
  const duplicateRedeem = await call(`/api/v1/orders/vouchers/${issue.data.voucher.numeroVale}/redeem`, {
    method: 'POST', token: cashier.token,
    body: { casinoCodigo: 'CASINO_CENTRAL_COMEDOR', items: [{ productoId: menu.data.products[0].id, cantidad: 2 }], metodoPagoDiferencia: 'EFECTIVO' }
  });
  status(duplicateRedeem, 409, 'duplicate redemption');
  observe('P16', 'Voucher canje persists a payment computed from inventory and rejects replay', redeem, { voucherNumber: issue.data.voucher.numeroVale, paymentId: paymentRead.data.transactions[0].id, duplicateStatus: duplicateRedeem.status });

  const tampered = await call(`/api/v1/orders/vouchers/${issue.data.voucher.numeroVale}/redeem`, {
    method: 'POST', token: cashier.token,
    body: { casinoCodigo: 'CASINO_CENTRAL_COMEDOR', items: [{ productoId: menu.data.products[0].id, cantidad: 1 }], metodoPagoDiferencia: 'EFECTIVO', precioUnitarioClp: 1 }
  });
  status(tampered, 400, 'client supplied price is rejected');
  observe('P17', 'Request validation rejects prices supplied by a browser', tampered);

  const weekly = await call('/api/v1/payments/notifications/weekly/run', { method: 'POST', token: admin.token, body: {} });
  status(weekly, 200, 'weekly PL/SQL report and sandbox delivery');
  assert.ok(weekly.data.totalProcesados > 0 && weekly.data.dispatchedCount > 0);
  observe('P18', 'Oracle stored procedure generates and dispatches sandbox notices', weekly, { totalProcessed: weekly.data.totalProcesados, sandboxDelivered: weekly.data.dispatchedCount });

  const audit = await call('/api/v1/orders/reports/audit', { token: admin.token });
  status(audit, 200, 'admin audit summary');
  assert.ok(audit.data.summary.canjeadosUsados > 0);
  const panel = await call('/api/v1/graphql', { method: 'POST', token: admin.token, body: { query: 'query { panelAuditoria { resumen { canjeadosUsados } porServicio { servicioCodigo } rendicionCasinos { casinoCodigo } partialErrors { subsystem code } } }' } });
  status(panel, 200, 'GraphQL admin panel');
  assert.deepEqual(panel.data.data.panelAuditoria.partialErrors, []);
  observe('P19', 'GraphQL admin audit composes orders and payments', panel, { redeemed: panel.data.data.panelAuditoria.resumen.canjeadosUsados });

  const expired = await call('/api/v1/auth/logout', { method: 'POST', token: newLogin.token, body: {} });
  status(expired, 200, 'session revocation');
  const revoked = await call('/api/v1/clients/employees/me', { token: newLogin.token });
  status(revoked, 401, 'revoked session rejection');
  observe('P20', 'Logout persists session revocation', revoked);

  const refreshed = await call('/api/v1/auth/refresh', { method: 'POST', body: { refreshToken: employee.refreshToken } });
  status(refreshed, 200, 'refresh token rotation');
  assert.ok(refreshed.data.accessToken && refreshed.data.refreshToken && refreshed.data.refreshToken !== employee.refreshToken);
  const oldRefresh = await call('/api/v1/auth/refresh', { method: 'POST', body: { refreshToken: employee.refreshToken } });
  status(oldRefresh, 401, 'replay of a rotated refresh token');
  observe('P21', 'Refresh token rotation and replay rejection', refreshed, { replayStatus: oldRefresh.status });
}

await mkdir(evidenceDir, { recursive: true });
try {
  await main();
} catch (error) {
  observations.push({ id: `P${String(observations.length + 1).padStart(2, '0')}`, title: 'Oracle integration smoke run', result: 'FAILED', message: error.message });
  process.exitCode = 1;
} finally {
  const summary = {
    runId,
    generatedAt: new Date().toISOString(),
    gateway: baseUrl,
    environment: process.env.DOTNET_ENVIRONMENT || 'Production',
    clockOverride: process.env.APP_TEST_NOW_SANTIAGO || null,
    passed: observations.filter((item) => item.result === 'PASSED').length,
    failed: observations.filter((item) => item.result === 'FAILED').length,
    items: observations
  };
  await writeFile(path.join(evidenceDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`${summary.passed} passed; ${summary.failed} failed. Evidence: docs/evidencias/entrega-2/${runId}/summary.json`);
}
