import fs from 'node:fs';
import path from 'node:path';
import autocannon from 'autocannon';
import { apiCall, GATEWAY_URL, getActiveShiftContext, loginAs } from '../helpers/apiClient';
import { sanitizePayload } from '../helpers/evidenceLogger';

function runAutocannon(opts: autocannon.Options): Promise<autocannon.Result> {
  return new Promise((resolve, reject) => {
    const instance = autocannon(opts, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
    autocannon.track(instance, { renderProgressBar: false });
  });
}

async function main() {
  const shiftCtx = getActiveShiftContext();
  const adminLogin = await loginAs('ADM001');
  const secLogin = await loginAs('SEC001');
  const adminToken = adminLogin.data.accessToken;
  const secToken = secLogin.data.accessToken;

  // Asegurar SEC001 en turno activo para medir emision real sin errores de horario
  await apiCall(`/api/v1/clients/employees/${secLogin.data.user.id}/shift`, {
    method: 'PUT',
    token: adminToken,
    body: { numeroTurno: shiftCtx.activeShiftNumber, sucursalCodigo: 'CENTRAL' }
  });

  // 1. Medir primero 8 emisiones reales RF2 (<2000ms) con SEC001 (max 10 por horario)
  // Se ejecuta antes de las rafagas autocannon para no contaminar el bucket de rate limit por IP.
  console.log('[load] 1/3 Benchmark real RF2 POST /api/v1/orders/vouchers/issue (<2000ms)...');
  const activeSvcRes = await apiCall('/api/v1/graphql', {
    method: 'POST',
    token: secToken,
    body: { query: `query { miResumenComensal { serviciosDelTurno { codigo habilitadoAhora } } }` }
  });
  const activeSvc = activeSvcRes.data?.data?.miResumenComensal?.serviciosDelTurno?.find((s: any) => s.habilitadoAhora)?.codigo;

  const issueLatenciesMs: number[] = [];
  let issueSuccess = 0;
  let issueErrors = 0;
  const issueStatuses: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    const res = await apiCall('/api/v1/orders/vouchers/issue', {
      method: 'POST',
      token: secToken,
      body: {
        servicioCodigo: activeSvc,
        sucursalEmisionCodigo: i % 2 === 0 ? 'CENTRAL' : 'NORTE',
        nombreBeneficiarioVisita: `LoadTest Visita ${i + 1}`
      }
    });
    issueLatenciesMs.push(res.durationMs);
    issueStatuses.push(res.status);
    if (res.status === 201) issueSuccess += 1;
    else issueErrors += 1;
  }

  // 2. Carga controlada acorde a proyeccion Caso 18 (150 req por escenario dentro de RATE_LIMIT_API_MAX=600/min)
  console.log('[load] 2/3 Benchmark GET /api/v1/public/products (150 req, 10 conexiones)...');
  const publicCatalogResult = await runAutocannon({
    url: `${GATEWAY_URL}/api/v1/public/products?available=true`,
    connections: 10,
    amount: 150
  });

  console.log('[load] 3/3 Benchmark GraphQL POST /api/v1/graphql miResumenComensal (150 req, 10 conexiones)...');
  const graphqlResult = await runAutocannon({
    url: `${GATEWAY_URL}/api/v1/graphql`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secToken}`
    },
    body: JSON.stringify({
      query: `query { miResumenComensal { fechaConsultada horaServidor funcionario { codigoFuncionario } serviciosDelTurno { codigo valorClp habilitadoAhora } } }`
    }),
    connections: 10,
    amount: 150
  });

  const sortedLat = [...issueLatenciesMs].sort((a, b) => a - b);
  const p95Index = Math.min(sortedLat.length - 1, Math.ceil(sortedLat.length * 0.95) - 1);
  const issueP95Ms = sortedLat[p95Index];
  const issueAvgMs = Math.round(sortedLat.reduce((a, b) => a + b, 0) / sortedLat.length);

  const report = sanitizePayload({
    timestamp: new Date().toISOString(),
    gatewayUrl: GATEWAY_URL,
    rf2ThresholdMs: 2000,
    scenarios: {
      publicCatalog: {
        requestsTotal: publicCatalogResult.requests.total,
        rpsAvg: publicCatalogResult.requests.average,
        latencyP95Ms: publicCatalogResult.latency.p97_5,
        latencyAvgMs: publicCatalogResult.latency.average,
        non2xx: publicCatalogResult.non2xx,
        errors: publicCatalogResult.errors
      },
      graphqlSummary: {
        requestsTotal: graphqlResult.requests.total,
        rpsAvg: graphqlResult.requests.average,
        latencyP95Ms: graphqlResult.latency.p97_5,
        latencyAvgMs: graphqlResult.latency.average,
        non2xx: graphqlResult.non2xx,
        errors: graphqlResult.errors
      },
      voucherIssuanceRF2: {
        samples: issueLatenciesMs.length,
        success201: issueSuccess,
        errors: issueErrors,
        statuses: issueStatuses,
        latenciesMs: issueLatenciesMs,
        avgMs: issueAvgMs,
        p95Ms: issueP95Ms,
        passesRf2Under2000Ms: issueP95Ms < 2000 && issueErrors === 0
      }
    }
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(__dirname, '../../../docs/evidencias');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `load_report_${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`[load] Reporte guardado en ${outPath}`);
  console.log(JSON.stringify(report, null, 2));

  if (
    issueP95Ms >= 2000 ||
    issueErrors > 0 ||
    publicCatalogResult.non2xx > 0 ||
    graphqlResult.non2xx > 0
  ) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[load] Error en prueba de carga:', err);
  process.exit(1);
});
