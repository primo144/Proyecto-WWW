import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const codeCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const trackedSourceChanges = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/).filter(Boolean).filter((line) => !line.slice(3).startsWith('docs/evidencias/entrega-3/'));
const sourceWorktreeClean = trackedSourceChanges.length === 0;
const gitBranch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim();
const gateway = process.env.GATEWAY_URL || 'http://localhost:8080';
const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';
const runId = process.env.RUN_ID || `RUN_BROWSER_${Date.now()}`;
const outDir = path.join(root, 'docs', 'evidencias', 'entrega-3', runId);
const password = process.env.TEST_USER_PASSWORD || 'Libros2026!';
const issueViewport = runId === 'RUN15' ? { width: 375, height: 812 } : { width: 1440, height: 900 };
const cashierViewport = runId === 'RUN15' ? { width: 1440, height: 900 } : { width: 375, height: 812 };
const viewports = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 }
];

function browserExecutable() {
  const paths = [
    process.env.BROWSER_EXECUTABLE_PATH,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
  return paths.find((candidate) => existsSync(candidate));
}

async function api(pathname, { method = 'GET', token, body } = {}) {
  const correlationId = crypto.randomUUID();
  const response = await fetch(`${gateway}${pathname}`, {
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
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 100) }; }
  return { status: response.status, data, correlationId };
}

async function login(page, code) {
  await page.locator('#login-code').fill(code);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: 'Iniciar Sesion' }).click();
}

async function storedSession(page) {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem('libros_impresos_session_v1') || 'null'));
}

async function waitForToasts(page) {
  await page.waitForFunction(() => document.querySelectorAll('#toast-container .app-toast').length === 0, undefined, { timeout: 8_000 });
}

function addObservation(results, id, name, observed, details = {}) {
  results.push({ id, name, result: 'PASSED', ...observed, ...details });
}

async function main() {
  const executablePath = browserExecutable();
  assert.ok(executablePath, 'Set BROWSER_EXECUTABLE_PATH or install Edge/Chrome.');
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-gpu', '--no-first-run'] });
  const page = await browser.newPage({ viewport: issueViewport, deviceScaleFactor: 1 });
  const pageErrors = [];
  const results = [];
  let paymentsStopped = false;
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    const health = await api('/health');
    assert.equal(health.status, 200);
    const anonymous = await api('/api/v1/orders/vouchers/my');
    assert.equal(anonymous.status, 401);
    addObservation(results, 'CA01/P01', 'Gateway ready; anonymous order request is rejected', { httpHealth: health.status, anonymousStatus: anonymous.status });

    const adminBootstrap = await api('/api/v1/auth/login', { method: 'POST', body: { codigoFuncionario: 'ADM001', password } });
    assert.equal(adminBootstrap.status, 200);
    const adminToken = adminBootstrap.data.accessToken;
    const employeeList = await api('/api/v1/clients/employees', { token: adminToken });
    assert.equal(employeeList.status, 200);
    const secretary = employeeList.data.employees.find((employee) => employee.codigoFuncionario === 'SEC001');
    assert.ok(secretary, 'multi-voucher secretary account must be seeded');
    const assigned = await api(`/api/v1/clients/employees/${secretary.id}/shift`, {
      method: 'PUT', token: adminToken, body: { numeroTurno: 2, sucursalCodigo: 'CENTRAL' }
    });
    assert.equal(assigned.status, 200);
    const secretarySession = await api('/api/v1/auth/login', { method: 'POST', body: { codigoFuncionario: 'SEC001', password } });
    assert.equal(secretarySession.status, 200);
    const multiA = await api('/api/v1/orders/vouchers/issue', {
      method: 'POST', token: secretarySession.data.accessToken,
      body: { servicioCodigo: 'CENA1', sucursalEmisionCodigo: 'CENTRAL', nombreBeneficiarioVisita: 'Visita de Gerencia A' }
    });
    const multiB = await api('/api/v1/orders/vouchers/issue', {
      method: 'POST', token: secretarySession.data.accessToken,
      body: { servicioCodigo: 'CENA1', sucursalEmisionCodigo: 'NORTE', nombreBeneficiarioVisita: 'Visita de Gerencia B' }
    });
    assert.equal(multiA.status, 201);
    assert.equal(multiB.status, 201);
    assert.notEqual(multiA.data.voucher.numeroVale, multiB.data.voucher.numeroVale);
    assert.equal(multiB.data.voucher.sucursalEmisionCodigo, 'NORTE');
    const multiDuplicate = await api('/api/v1/orders/vouchers/issue', {
      method: 'POST', token: secretarySession.data.accessToken,
      body: { servicioCodigo: 'CENA1', sucursalEmisionCodigo: 'CENTRAL', nombreBeneficiarioVisita: 'Visita de Gerencia A' }
    });
    assert.equal(multiDuplicate.status, 409);
    addObservation(results, 'CA02/P02', 'Secretary multi-voucher limit and cross-branch issue', {
      emitted: 2,
      distinctVoucherNumbers: multiA.data.voucher.numeroVale !== multiB.data.voucher.numeroVale,
      branches: [multiA.data.voucher.sucursalEmisionCodigo, multiB.data.voucher.sucursalEmisionCodigo],
      duplicateStatus: multiDuplicate.status
    });

    const offShiftEmployee = await api('/api/v1/auth/login', { method: 'POST', body: { codigoFuncionario: 'EMP001', password } });
    assert.equal(offShiftEmployee.status, 200);
    const offShiftIssue = await api('/api/v1/orders/vouchers/issue', {
      method: 'POST', token: offShiftEmployee.data.accessToken,
      body: { servicioCodigo: 'CENA1', sucursalEmisionCodigo: 'CENTRAL' }
    });
    assert.equal(offShiftIssue.status, 422);
    assert.equal(offShiftIssue.data.error.code, 'FUERA_DE_HORARIO');
    addObservation(results, 'CA03/P03', 'Issue request for a service outside the employee shift is rejected', { status: offShiftIssue.status, errorCode: offShiftIssue.data.error.code });

    await page.goto(frontend, { waitUntil: 'domcontentloaded' });
    await login(page, 'EMP002');
    await page.getByRole('heading', { name: /Totem/ }).waitFor();
    await page.locator('.service-card').filter({ hasText: 'Cena 1' }).waitFor();
    await waitForToasts(page);
    const employeeSession = await storedSession(page);
    assert.ok(employeeSession?.accessToken);

    const responsive = [];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(120);
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
      assert.ok(dimensions.scrollWidth <= dimensions.width, `${viewport.width}x${viewport.height}: horizontal overflow ${JSON.stringify(dimensions)}`);
      const screenshot = `totem-${viewport.width}x${viewport.height}.png`;
      await page.screenshot({ path: path.join(outDir, screenshot), fullPage: true });
      responsive.push({ viewport: `${viewport.width}x${viewport.height}`, horizontalOverflow: false, screenshot });
    }
    addObservation(results, 'CA04/P04', 'Authenticated GraphQL totem summary is responsive at four viewports', { employeeCode: 'EMP002', viewports: responsive });

    await page.setViewportSize(issueViewport);
    const serviceCard = page.locator('.service-card').filter({ hasText: 'Cena 1' });
    const issueButton = serviceCard.getByRole('button', { name: 'Emitir e Imprimir Vale (<2s)' });
    await issueButton.waitFor();
    const issueStart = Date.now();
    await issueButton.click();
    await page.locator('.voucher-receipt').waitFor();
    const issueDurationMs = Date.now() - issueStart;
    const receiptText = await page.locator('.voucher-receipt').innerText();
    const numberMatch = receiptText.match(/Numero de Vale\s+(VAL-[A-Z0-9-]+)/);
    assert.ok(numberMatch, 'Totem receipt should display the emitted voucher number.');
    const voucherNumber = numberMatch[1];
    const voucherByNumber = await api(`/api/v1/orders/vouchers/by-number/${encodeURIComponent(voucherNumber)}`, { token: employeeSession.accessToken });
    assert.equal(voucherByNumber.status, 200);
    assert.equal(voucherByNumber.data.voucher.estado, 'IMPRESO');
    assert.ok(voucherByNumber.data.voucher.valorClp > 0);
    const persisted = await api(`/api/v1/orders/vouchers/${voucherByNumber.data.voucher.id}`, { token: employeeSession.accessToken });
    assert.equal(persisted.status, 200);
    assert.equal(persisted.data.voucher.numeroVale, voucherNumber);
    assert.ok(issueDurationMs < 2_000, `UI wait for issue exceeded RF2: ${issueDurationMs}ms`);

    await page.evaluate(() => { window.__printInvoked = false; window.print = () => { window.__printInvoked = true; }; });
    await page.getByRole('button', { name: 'Imprimir Comprobante' }).click();
    assert.equal(await page.evaluate(() => window.__printInvoked), true);
    await page.emulateMedia({ media: 'print' });
    const printControlHidden = await page.locator('.voucher-receipt .no-print').evaluate((node) => getComputedStyle(node).display === 'none');
    await page.emulateMedia({ media: 'screen' });
    assert.equal(printControlHidden, true, 'thermal print stylesheet hides screen-only actions');
    await waitForToasts(page);
    await page.screenshot({ path: path.join(outDir, `totem-issued-${issueViewport.width}x${issueViewport.height}.png`), fullPage: true });
    addObservation(results, 'CA05/P05', 'Employee issues, prints and reloads persisted CENA1 vale', {
      voucherNumber,
      apiState: persisted.data.voucher.estado,
      printActionInvoked: true,
      printStylesVerified: true,
      issueDurationMs,
      correlationIds: [health.correlationId, voucherByNumber.correlationId, persisted.correlationId]
    });

    const duplicateIssue = await api('/api/v1/orders/vouchers/issue', {
      method: 'POST', token: employeeSession.accessToken,
      body: { servicioCodigo: 'CENA1', sucursalEmisionCodigo: 'CENTRAL' }
    });
    assert.equal(duplicateIssue.status, 409);
    const idor = await api('/api/v1/clients/employees/30000000-0000-4000-8000-000000000001', { token: employeeSession.accessToken });
    assert.equal(idor.status, 403);
    const rbac = await api('/api/v1/orders/reports/audit', { token: employeeSession.accessToken });
    assert.equal(rbac.status, 403);
    addObservation(results, 'CA06/P06', 'Duplicate voucher, IDOR and role escalation attempts are denied', { duplicateStatus: duplicateIssue.status, idorStatus: idor.status, adminRouteStatus: rbac.status });

    const employeeServiceSession = await api('/api/v1/auth/login', { method: 'POST', body: { codigoFuncionario: 'EMP002', password } });
    assert.equal(employeeServiceSession.status, 200);
    await page.getByRole('button', { name: 'Cerrar Sesion' }).click();
    await page.locator('#login-code').waitFor();
    await page.setViewportSize(cashierViewport);
    await login(page, 'CAJ001');
    await page.getByRole('heading', { name: /Catalogo de Productos del Casino/ }).waitFor();
    await waitForToasts(page);
    const cashierDimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(cashierDimensions.scrollWidth <= cashierDimensions.width, `cashier ${cashierViewport.width}px has horizontal overflow: ${JSON.stringify(cashierDimensions)}`);
    await page.locator('#cashier-voucher-input').fill(voucherNumber);
    await page.getByRole('button', { name: 'Buscar' }).click();
    await page.locator('#cashier-voucher-input').waitFor();
    await page.getByText(new RegExp(voucherNumber)).waitFor();
    const firstProduct = page.locator('.product-card').first();
    await firstProduct.getByRole('button', { name: 'Agregar' }).click();
    await firstProduct.getByRole('button', { name: 'Agregar' }).click();

    const preFailure = await api(`/api/v1/orders/vouchers/${voucherByNumber.data.voucher.id}`, { token: (await storedSession(page)).accessToken });
    assert.equal(preFailure.status, 200);
    assert.equal(preFailure.data.voucher.estado, 'IMPRESO');
    execFileSync('docker', ['compose', 'stop', 'payments-service'], { cwd: root, stdio: 'ignore', windowsHide: true });
    paymentsStopped = true;

    const restFailure = await api('/api/v1/payments/transactions', { token: (await storedSession(page)).accessToken });
    assert.equal(restFailure.status, 504, 'Gateway should report controlled upstream timeout when payments stops.');
    const partialGraphql = await api('/api/v1/graphql', {
      method: 'POST', token: employeeServiceSession.data.accessToken,
      body: { query: 'query { miResumenComensal { funcionario { codigoFuncionario } partialErrors { subsystem code } } }' }
    });
    assert.equal(partialGraphql.status, 200);
    assert.ok(partialGraphql.data.data.miResumenComensal.partialErrors.some((error) => error.subsystem === 'payments'));

    const confirm = page.getByRole('button', { name: 'Confirmar Venta y Canjear Vale (CU5)' });
    await confirm.click();
    await page.locator('.state-error').waitFor();
    const failureText = await page.locator('.state-error').innerText();
    assert.match(failureText, /UPSTREAM_UNAVAILABLE|UPSTREAM_TIMEOUT|DATABASE_UNAVAILABLE/);
    const unchanged = await api(`/api/v1/orders/vouchers/${voucherByNumber.data.voucher.id}`, { token: (await storedSession(page)).accessToken });
    assert.equal(unchanged.status, 200);
    assert.equal(unchanged.data.voucher.estado, 'IMPRESO', 'failed settlement must not mark a vale as redeemed');
    await waitForToasts(page);
    await page.screenshot({ path: path.join(outDir, `cashier-failure-${cashierViewport.width}x${cashierViewport.height}.png`), fullPage: true });
    addObservation(results, 'CA07/P07', 'Payments failure is visible in UI; GraphQL is partial and order state remains unchanged', {
      uiMessage: failureText,
      restFailureStatus: restFailure.status,
      partialError: partialGraphql.data.data.miResumenComensal.partialErrors.find((error) => error.subsystem === 'payments')?.code,
      voucherStateAfterFailure: unchanged.data.voucher.estado,
      correlationIds: [restFailure.correlationId, partialGraphql.correlationId, unchanged.correlationId]
    });

    execFileSync('docker', ['compose', 'start', 'payments-service'], { cwd: root, stdio: 'ignore', windowsHide: true });
    paymentsStopped = false;
    let recovered;
    for (let attempt = 0; attempt < 30; attempt++) {
      recovered = await api('/api/v1/payments/transactions', { token: (await storedSession(page)).accessToken });
      if (recovered.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    assert.equal(recovered?.status, 200, 'payments service should recover before retry.');

    await confirm.click();
    await page.getByText(/Canje registrado y liquidado/).waitFor();
    const cashierSession = await storedSession(page);
    const persistedPayment = await api(`/api/v1/payments/transactions?valeId=${encodeURIComponent(voucherByNumber.data.voucher.id)}`, { token: cashierSession.accessToken });
    assert.equal(persistedPayment.status, 200);
    assert.equal(persistedPayment.data.transactions.length, 1);
    const redeemedVoucher = await api(`/api/v1/orders/vouchers/${voucherByNumber.data.voucher.id}`, { token: cashierSession.accessToken });
    assert.equal(redeemedVoucher.status, 200);
    assert.equal(redeemedVoucher.data.voucher.estado, 'CANJEADO');
    await waitForToasts(page);
    await page.screenshot({ path: path.join(outDir, `cashier-recovered-${cashierViewport.width}x${cashierViewport.height}.png`), fullPage: true });
    addObservation(results, 'CA08/P08', 'Restoring payments allows the same UI cart to retry once and persist a single settlement', {
      recoveredStatus: recovered.status,
      voucherState: redeemedVoucher.data.voucher.estado,
      transactionCount: persistedPayment.data.transactions.length,
      transactionState: persistedPayment.data.transactions[0].estado,
      cashierViewport: `${cashierViewport.width}x${cashierViewport.height}`,
      cashierHorizontalOverflow: false,
      correlationIds: [recovered.correlationId, persistedPayment.correlationId, redeemedVoucher.correlationId]
    });

    await page.getByRole('button', { name: 'Cerrar Sesion' }).click();
    await page.locator('#login-code').waitFor();
    await login(page, 'ADM001');
    await page.getByRole('heading', { name: /Panel de Administracion/ }).waitFor();
    await page.getByRole('button', { name: /Vales Adicionales y Control/ }).click();
    await page.locator('form select').nth(2).selectOption('REUNION_COFFEE');
    const addResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/v1/orders/vouchers/additional') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Emitir Vale Adicional / Visita (CU7)' }).click();
    const addResponse = await addResponsePromise;
    assert.equal(addResponse.status(), 201);
    const extraVoucher = (await addResponse.json()).voucher;
    assert.equal(extraVoucher.estado, 'EMITIDO');
    await page.getByText(new RegExp(extraVoucher.numeroVale)).waitFor();
    await waitForToasts(page);
    await page.screenshot({ path: path.join(outDir, `admin-extra-voucher-${cashierViewport.width}x${cashierViewport.height}.png`), fullPage: true });

    await page.getByRole('button', { name: 'Cerrar Sesion' }).click();
    await page.locator('#login-code').waitFor();
    const extraVoucherOwner = extraVoucher.codigoFuncionario || 'EMP001';
    await login(page, extraVoucherOwner);
    await page.getByRole('heading', { name: /Totem/ }).waitFor();
    const printAdditionalPromise = page.waitForResponse((response) => response.url().includes(`/api/v1/orders/vouchers/${extraVoucher.id}/print`) && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Imprimir en Totem' }).click();
    assert.equal((await printAdditionalPromise).status(), 200);
    const employeeOneSession = await storedSession(page);
    const printedExtra = await api(`/api/v1/orders/vouchers/${extraVoucher.id}`, { token: employeeOneSession.accessToken });
    assert.equal(printedExtra.status, 200);
    assert.equal(printedExtra.data.voucher.estado, 'IMPRESO');
    await page.locator('.voucher-receipt').waitFor();
    await waitForToasts(page);
    await page.screenshot({ path: path.join(outDir, `employee-extra-print-${cashierViewport.width}x${cashierViewport.height}.png`), fullPage: true });
    addObservation(results, 'CA09/P09', 'Admin creates an additional voucher in the SPA; beneficiary prints it in the totem', {
      voucherNumber: extraVoucher.numeroVale,
      employeeCode: extraVoucherOwner,
      stateAfterCreation: extraVoucher.estado,
      stateAfterEmployeePrint: printedExtra.data.voucher.estado,
      correlationIds: [addResponse.headers()['x-correlation-id'] || null, printedExtra.correlationId]
    });

    await page.getByRole('button', { name: 'Cerrar Sesion' }).click();
    await page.locator('#login-code').waitFor();
    await login(page, 'ADM001');
    await page.getByRole('heading', { name: /Panel de Administracion/ }).waitFor();
    await waitForToasts(page);
    await page.screenshot({ path: path.join(outDir, `admin-audit-${cashierViewport.width}x${cashierViewport.height}.png`), fullPage: true });
    assert.deepEqual(pageErrors, [], 'no unhandled JavaScript errors in the UI run');
    addObservation(results, 'CA10/P10', 'Administrator can return to the SPA audit panel after recovery', { browserErrors: 0 });

    await writeFile(path.join(outDir, 'summary.json'), JSON.stringify({
      runId,
      generatedAt: new Date().toISOString(),
      gitBranch,
      codeCommit,
      sourceWorktreeClean,
      browser: path.basename(executablePath),
      browserVersion: browser.version(),
      platform: 'Windows headless browser with emulated viewports (not physical devices)',
      issueViewport,
      cashierViewport,
      passed: results.length,
      failed: 0,
      tests: results
    }, null, 2));
    console.log(`${results.length} browser acceptance checks passed (${runId}); report and captures saved under docs/evidencias/entrega-3/${runId}/.`);
  } catch (error) {
    await page.screenshot({ path: path.join(outDir, 'failure-state.png'), fullPage: true }).catch(() => {});
    await writeFile(path.join(outDir, 'summary.json'), JSON.stringify({
      runId,
      generatedAt: new Date().toISOString(),
      gitBranch,
      codeCommit,
      sourceWorktreeClean,
      result: 'FAILED',
      passed: results.filter((item) => item.result === 'PASSED').length,
      failed: 1,
      error: error.message,
      tests: results,
      pageErrors
    }, null, 2));
    throw error;
  } finally {
    if (paymentsStopped) {
      try { execFileSync('docker', ['compose', 'start', 'payments-service'], { cwd: root, stdio: 'ignore', windowsHide: true }); }
      catch { /* the runner reports the test failure; the operator can use docker compose start */ }
    }
    await browser.close();
  }
}

await main();
