import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidenceDir = path.join(root, 'docs', 'evidencias', 'entrega-1');
const baseUrl = process.env.PROTOTYPE_URL || 'http://127.0.0.1:8081';
const viewports = [
  { name: '375x812', width: 375, height: 812 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1440x900', width: 1440, height: 900 }
];

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

async function waitForServer(child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Prototype API process exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/demo/health`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Prototype API did not start at ${baseUrl}`);
}

const browserPath = findBrowser();
if (!browserPath) {
  throw new Error('Chrome/Edge was not found. Set BROWSER_EXECUTABLE_PATH to its executable.');
}

await mkdir(evidenceDir, { recursive: true });
const server = spawn(process.execPath, ['frontend/prototipo/server.mjs'], {
  cwd: root,
  env: { ...process.env, PROTOTYPE_PORT: new URL(baseUrl).port || '8081' },
  stdio: 'ignore'
});
let browser;
const results = [];

try {
  await waitForServer(server);
  const malformed = await fetch(`${baseUrl}/api/demo/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{'
  });
  assert.equal(malformed.status, 400, 'invalid JSON should return a client error without stopping the demo server');
  await waitForServer(server);
  browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--disable-gpu', '--no-first-run'] });

for (const [index, viewport] of viewports.entries()) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
    const employeeCode = ['EMP001', 'EMP002', 'EMP003', 'SEC001'][index];
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`${baseUrl}/prototipo-eval1.html`, { waitUntil: 'domcontentloaded' });
    await page.locator('#employee-code').fill(employeeCode);
    await page.getByRole('button', { name: 'Consultar servicios' }).click();
    await page.locator('.service-card').first().waitFor();
    assert.equal(await page.locator('.service-card').count(), 3, `${viewport.name}: mock catalog should render three cards`);
    const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    assert.ok(widths.content <= widths.viewport, `${viewport.name}: horizontal overflow ${JSON.stringify(widths)}`);

    await page.locator('.service-card').first().getByRole('button', { name: 'Emitir este vale' }).click();
    await page.locator('.voucher-receipt').waitFor();
    assert.match(await page.locator('.voucher-receipt').innerText(), new RegExp(`VALE DE ALIMENTACIÓN[\\s\\S]*${employeeCode}`));
    const screenshot = path.join(evidenceDir, `viewport-${viewport.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });

    const verifiedScenarios = ['consulta normal', 'emisión 201'];
    if (viewport.width === 375) {
      await page.locator('.service-card').first().getByRole('button', { name: 'Emitir este vale' }).click();
      await page.getByRole('alert').waitFor();
      assert.match(await page.getByRole('alert').innerText(), /Ya emitiste un vale/);
      verifiedScenarios.push('vale duplicado 409');

      await page.locator('#scenario-select').selectOption('empty');
      await page.locator('.empty-state').waitFor();
      verifiedScenarios.push('catálogo vacío');
      await page.locator('#scenario-select').selectOption('error');
      await page.getByRole('alert').waitFor();
      assert.match(await page.getByRole('alert').innerText(), /No pudimos consultar/);
      verifiedScenarios.push('error 503 y recuperación disponible');
    }

    assert.deepEqual(pageErrors, [], `${viewport.name}: browser console errors`);
    results.push({
      viewport: `${viewport.width}x${viewport.height}`,
      employeeCode,
      result: 'PASSED',
      horizontalOverflow: false,
      catalogCards: 3,
      voucherReceiptRendered: true,
      scenarios: verifiedScenarios,
      screenshot: path.basename(screenshot)
    });
    console.log(`PASS ${viewport.name}: flow, responsive layout, no horizontal overflow; evidence ${path.basename(screenshot)}`);
    await page.close();
  }
  await writeFile(path.join(evidenceDir, 'responsive-report.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    browser: path.basename(browserPath),
    browserVersion: browser.version(),
    method: 'Automated browser run with emulated viewport sizes; not physical-device testing.',
    total: results.length,
    passed: results.filter((result) => result.result === 'PASSED').length,
    results
  }, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
