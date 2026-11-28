import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidenceDir = path.join(root, 'docs', 'evidencias', 'entrega-2');
const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
const password = process.env.TEST_USER_PASSWORD || 'Libros2026!';

function findBrowser() {
  const candidates = [
    process.env.BROWSER_EXECUTABLE_PATH,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

const browserPath = findBrowser();
if (!browserPath) throw new Error('Chrome/Edge not found; set BROWSER_EXECUTABLE_PATH.');
await mkdir(evidenceDir, { recursive: true });
const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--disable-gpu', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const browserErrors = [];
const apiResponses = [];
page.on('pageerror', (error) => browserErrors.push(error.message));
page.on('response', (response) => {
  if (response.url().includes('/api/v1/clients/')) apiResponses.push({ status: response.status(), path: new URL(response.url()).pathname });
});

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#login-code').fill('ADM001');
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: 'Iniciar Sesion' }).click();
  await page.getByRole('heading', { name: /Panel de Administracion/ }).waitFor();

  await page.getByRole('button', { name: /Servicios y Tarifas/ }).click();
  const productCode = `UI_${Date.now().toString(36).toUpperCase()}`;
  await page.locator('input[placeholder="PROD-011"]').fill(productCode);
  await page.locator('input[placeholder="Producto de casino"]').fill('Producto UI de prueba');
  await page.locator('input[placeholder="Bebidas"]').fill('Pruebas');
  await page.locator('input[type="number"]').last().fill('3100');
  const productResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/inventory/products') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Agregar producto' }).click();
  assert.equal((await productResponse).status(), 201, 'product should be created through the frontend');
  await page.getByRole('row', { name: new RegExp(productCode) }).waitFor();
  await page.screenshot({ path: path.join(evidenceDir, 'ui-admin-productos.png'), fullPage: true });

  await page.getByRole('button', { name: /Perfiles y Turnos/ }).click();
  const employeeCodeField = page.locator('input[placeholder="EMP004"]');
  try {
    await employeeCodeField.waitFor({ timeout: 8_000 });
  } catch {
    console.error(`Profiles screen did not render: ${await page.locator('#app-root').innerText()}`);
    console.error(`Clients API responses: ${JSON.stringify(apiResponses)}`);
    throw new Error('Profile form did not render after opening the tab.');
  }
  const suffix = Date.now().toString().slice(-8);
  const employeeCode = `UI${suffix}`;
  await employeeCodeField.fill(employeeCode);
  await page.locator('input[placeholder="12345678-9"]').fill(`9${suffix}-1`);
  await page.locator('input[placeholder="Nombre funcionario"]').fill('Funcionario UI de Prueba');
  await page.locator('input[type="email"]').fill(`ui_${suffix}@example.test`);
  await page.locator('input[autocomplete="new-password"]').fill('UiTest2026!');
  const employeeResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/clients/employees') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Crear funcionario y acceso' }).click();
  assert.equal((await employeeResponse).status(), 201, 'employee and auth account should be created through the frontend');
  await page.getByRole('row', { name: new RegExp(employeeCode) }).waitFor();
  await page.screenshot({ path: path.join(evidenceDir, 'ui-admin-funcionarios.png'), fullPage: true });
  assert.deepEqual(browserErrors, []);

  const report = {
    generatedAt: new Date().toISOString(),
    browser: path.basename(browserPath),
    browserVersion: browser.version(),
    viewport: '1440x900 (emulated, headless)',
    result: 'PASSED',
    checks: [
      { flow: 'Admin crea producto desde SPA', status: 201, productCode, screenshot: 'ui-admin-productos.png' },
      { flow: 'Admin registra funcionario y credenciales desde SPA', status: 201, employeeCode, screenshot: 'ui-admin-funcionarios.png' }
    ],
    browserErrors
  };
  await writeFile(path.join(evidenceDir, 'ui-admin-report.json'), JSON.stringify(report, null, 2));
  console.log('PASS browser SPA admin: create product and linked employee/login; screenshots and report saved in docs/evidencias/entrega-2/.');
} finally {
  await browser.close();
}
