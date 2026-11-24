import { afterAll, describe, expect, it } from 'vitest';
import { apiCall, graphqlCall, loginAs } from '../helpers/apiClient';
import { EvidenceRecorder } from '../helpers/evidenceLogger';

const recorder = new EvidenceRecorder('RESILIENCE');

describe('P12 (CA12): Resiliencia y degradacion controlada ante caida de microservicio payments', () => {
  afterAll(() => {
    recorder.writeSummary();
  });

  it('Verifica error controlado 503 en Gateway y partialErrors en GraphQL cuando payments esta detenido', async () => {
    const health = await apiCall('/health');
    const paymentsStatus = health.data?.upstreams?.find((u: any) => u.service === 'payments')?.status;

    if (paymentsStatus === 'ok' && process.env.RESILIENCE_TEST_ENABLED !== '1') {
      recorder.record({
        testId: 'P12',
        criteriaId: 'CA12',
        title: 'Caida controlada de payments (omitida porque payments esta activo)',
        correlationIds: [health.correlationId],
        status: 'SKIPPED',
        steps: [
          {
            action: 'GET /health',
            responseStatus: health.status,
            responseBody: health.data
          }
        ],
        notes: 'Ejecute `docker compose stop payments` y luego `RESILIENCE_TEST_ENABLED=1 npm run test:resilience` para verificar caida real.'
      });
      return;
    }

    const adminToken = (await loginAs('ADM001')).data.accessToken;
    const empToken = (await loginAs('EMP001')).data.accessToken;

    // 1. Llamada REST directa hacia payments via Gateway -> 503 controlado con X-Correlation-ID sin stack trace
    const restDown = await apiCall('/api/v1/payments/transactions', { token: adminToken });
    expect([503, 504]).toContain(restDown.status);
    expect(restDown.data.error.correlationId).toBeTruthy();
    expect(JSON.stringify(restDown.data)).not.toContain('at ');

    // 2. Agregacion GraphQL miResumenComensal sigue funcionando parcialmente reportando partialErrors
    const gqlDegraded = await graphqlCall(
      `
      query DegradedResumen {
        miResumenComensal {
          funcionario { codigoFuncionario }
          serviciosDelTurno { codigo }
          avisosSemanales { id }
          partialErrors { subsystem code message }
        }
      }
      `,
      empToken
    );

    expect(gqlDegraded.status).toBe(200);
    const resumen = gqlDegraded.data.data.miResumenComensal;
    expect(resumen.funcionario.codigoFuncionario).toBe('EMP001');
    expect(resumen.partialErrors.some((pe: any) => pe.subsystem === 'payments')).toBe(true);

    recorder.record({
      testId: 'P12',
      criteriaId: 'CA12',
      title: 'Caida controlada de payments y degradacion parcial en GraphQL',
      correlationIds: [restDown.correlationId, gqlDegraded.correlationId],
      status: 'PASSED',
      steps: [
        {
          action: 'GET /api/v1/payments/transactions con payments detenido',
          responseStatus: restDown.status,
          responseBody: restDown.data,
          correlationId: restDown.correlationId
        },
        {
          action: 'POST /api/v1/graphql miResumenComensal con payments detenido',
          responseStatus: gqlDegraded.status,
          responseBody: gqlDegraded.data,
          correlationId: gqlDegraded.correlationId
        }
      ]
    });
  });
});
