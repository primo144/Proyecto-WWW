import { afterAll, describe, expect, it } from 'vitest';
import { apiCall, getActiveShiftContext, graphqlCall, loginAs } from '../helpers/apiClient';
import { EvidenceRecorder } from '../helpers/evidenceLogger';

const recorder = new EvidenceRecorder('SECURITY');

describe('Pruebas Negativas, Seguridad y Reglas de Negocio - Caso 18', () => {
  const shiftCtx = getActiveShiftContext();

  afterAll(() => {
    recorder.writeSummary();
  });

  it('P06 (CA06): Acceso sin token, token invalido y sesion revocada tras logout', async () => {
    const noTokenRest = await apiCall('/api/v1/orders/vouchers/my');
    expect(noTokenRest.status).toBe(401);

    const noTokenGql = await graphqlCall('{ miResumenComensal { fechaConsultada } }');
    expect(noTokenGql.status).toBe(401);

    const invalidTokenRes = await apiCall('/api/v1/orders/vouchers/my', {
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmYWtlIn0.invalid'
    });
    expect(invalidTokenRes.status).toBe(401);

    // Login -> Logout -> Reutilizar token revocado debe ser rechazado (401)
    const empLogin = await loginAs('EMP001');
    const token = empLogin.data.accessToken;
    const logoutRes = await apiCall('/api/v1/auth/logout', { method: 'POST', token, body: {} });
    expect(logoutRes.status).toBe(200);

    const afterLogoutRes = await apiCall('/api/v1/orders/vouchers/my', { token });
    expect(afterLogoutRes.status).toBe(401);

    recorder.record({
      testId: 'P06',
      criteriaId: 'CA06',
      title: 'Rechazo sin token, token invalido y sesion revocada',
      correlationIds: [noTokenRest.correlationId, invalidTokenRes.correlationId, afterLogoutRes.correlationId],
      status: 'PASSED',
      steps: [
        { action: 'GET /api/v1/orders/vouchers/my sin token', responseStatus: noTokenRest.status, responseBody: noTokenRest.data },
        { action: 'POST /api/v1/graphql sin token', responseStatus: noTokenGql.status, responseBody: noTokenGql.data },
        { action: 'GET con token revocado tras logout', responseStatus: afterLogoutRes.status, responseBody: afterLogoutRes.data }
      ]
    });
  });

  it('P07 (CA07): Rol sin permiso (RBAC) y descarte de cabeceras internas falsificadas', async () => {
    const empToken = (await loginAs('EMP001')).data.accessToken;
    const cajToken = (await loginAs('CAJ001')).data.accessToken;

    // Funcionario intentando crear servicio (Admin) -> 403
    const empCreateSvc = await apiCall('/api/v1/inventory/services', {
      method: 'POST',
      token: empToken,
      body: { codigo: 'HACK_SVC', nombre: 'Ilegal', descripcion: 'Intento sin permiso' }
    });
    expect(empCreateSvc.status).toBe(403);

    // Funcionario intentando canjear vale (Cajero) -> 403
    const empRedeem = await apiCall('/api/v1/orders/vouchers/VAL-HIST-0001/redeem', {
      method: 'POST',
      token: empToken,
      body: { casinoCodigo: 'CASINO_CENTRAL_COMEDOR', items: [] }
    });
    expect(empRedeem.status).toBe(403);

    // Cajero intentando generar vale adicional (Admin) -> 403
    const cajAdditional = await apiCall('/api/v1/orders/vouchers/additional', {
      method: 'POST',
      token: cajToken,
      body: {}
    });
    expect(cajAdditional.status).toBe(403);

    // Intento de falsificar x-user-role / x-user-id desde el navegador -> Gateway los elimina
    const spoofedRes = await apiCall('/api/v1/orders/reports/audit', {
      token: empToken,
      extraHeaders: {
        'x-user-role': 'ADMINISTRADOR',
        'x-user-id': '30000000-0000-4000-8000-000000000001',
        'x-internal-service-token': 'spoofed'
      }
    });
    expect(spoofedRes.status).toBe(403);

    recorder.record({
      testId: 'P07',
      criteriaId: 'CA07',
      title: 'Control RBAC por rol y descarte de cabeceras falsificadas',
      correlationIds: [empCreateSvc.correlationId, empRedeem.correlationId, cajAdditional.correlationId, spoofedRes.correlationId],
      status: 'PASSED',
      steps: [
        { action: 'FUNCIONARIO -> POST /inventory/services', responseStatus: empCreateSvc.status },
        { action: 'FUNCIONARIO -> POST /orders/vouchers/.../redeem', responseStatus: empRedeem.status },
        { action: 'CAJERO -> POST /orders/vouchers/additional', responseStatus: cajAdditional.status },
        { action: 'FUNCIONARIO con cabeceras x-user-role falsificadas -> /reports/audit', responseStatus: spoofedRes.status }
      ]
    });
  });

  it('P08 (CA08): Proteccion anti-IDOR en REST y autorizacion por campo/query en GraphQL', async () => {
    const emp1Token = (await loginAs('EMP001')).data.accessToken;

    // EMP001 intentando leer ficha de EMP002 -> 403
    const idorProfile = await apiCall('/api/v1/clients/employees/30000000-0000-4000-8000-000000000003', {
      token: emp1Token
    });
    expect(idorProfile.status).toBe(403);

    // EMP001 intentando leer vale historico de EMP002 -> 403
    const idorVoucher = await apiCall('/api/v1/orders/vouchers/60000000-0000-4000-8000-000000000002', {
      token: emp1Token
    });
    expect(idorVoucher.status).toBe(403);

    // EMP001 intentando consultar vale ajeno via GraphQL detalleVale -> FORBIDDEN
    const gqlIdorVoucher = await graphqlCall(
      `query { detalleVale(numeroVale: "VAL-HIST-0002") { id numeroVale } }`,
      emp1Token
    );
    expect(gqlIdorVoucher.data.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');

    // EMP001 intentando consultar panelAuditoria via GraphQL -> FORBIDDEN
    const gqlAuditDenied = await graphqlCall(
      `query { panelAuditoria { resumen { totalRegistros } } }`,
      emp1Token
    );
    expect(gqlAuditDenied.data.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');

    recorder.record({
      testId: 'P08',
      criteriaId: 'CA08',
      title: 'Control anti-IDOR en REST y GraphQL',
      correlationIds: [idorProfile.correlationId, idorVoucher.correlationId, gqlIdorVoucher.correlationId, gqlAuditDenied.correlationId],
      status: 'PASSED',
      steps: [
        { action: 'EMP001 GET ficha EMP002', responseStatus: idorProfile.status },
        { action: 'EMP001 GET vale EMP002', responseStatus: idorVoucher.status },
        { action: 'EMP001 GraphQL detalleVale ajeno', responseStatus: gqlIdorVoucher.status, responseBody: gqlIdorVoucher.data },
        { action: 'EMP001 GraphQL panelAuditoria', responseStatus: gqlAuditDenied.status, responseBody: gqlAuditDenied.data }
      ]
    });
  });

  it('P09 (CA09): Rechazo de precios/saldos alterados enviados desde cliente', async () => {
    const cajToken = (await loginAs('CAJ001')).data.accessToken;
    const prodRes = await apiCall('/api/v1/inventory/products?available=true', { token: cajToken });
    const firstProd = prodRes.data.products[0];

    const tamperedRedeem = await apiCall('/api/v1/orders/vouchers/VAL-SEED-ADIC-0001/redeem', {
      method: 'POST',
      token: cajToken,
      body: {
        casinoCodigo: 'CASINO_CENTRAL_COMEDOR',
        items: [{ productoId: firstProd.id, cantidad: 1 }],
        metodoPagoDiferencia: 'NO_APLICA',
        precioUnitarioClp: 1,
        valorValeClp: 999999
      }
    });

    expect(tamperedRedeem.status).toBe(400);
    expect(tamperedRedeem.data.error.code).toBe('VALIDACION_ESTRICTA');

    recorder.record({
      testId: 'P09',
      criteriaId: 'CA09',
      title: 'Rechazo de campos de precio/saldo manipulados desde cliente',
      correlationIds: [tamperedRedeem.correlationId],
      status: 'PASSED',
      steps: [
        {
          action: 'POST redeem con precioUnitarioClp y valorValeClp inyectados',
          responseStatus: tamperedRedeem.status,
          responseBody: tamperedRedeem.data,
          correlationId: tamperedRedeem.correlationId
        }
      ]
    });
  });

  it('P10 (CA10): Reglas de negocio negativas (fuera de turno, doble emision y doble canje)', async () => {
    // 1. Funcionario fuera de turno activo -> 422 FUERA_DE_HORARIO
    const outToken = (await loginAs(shiftCtx.inactiveEmployeeCode)).data.accessToken;
    const outOfShiftRes = await apiCall('/api/v1/orders/vouchers/issue', {
      method: 'POST',
      token: outToken,
      body: { sucursalEmisionCodigo: 'CENTRAL' }
    });
    expect(outOfShiftRes.status).toBe(422);
    expect(outOfShiftRes.data.error.code).toBe('FUERA_DE_HORARIO');

    // 2. Doble emision en mismo horario para funcionario normal -> 409 VALE_DUPLICADO
    const activeToken = (await loginAs(shiftCtx.activeEmployeeCode)).data.accessToken;
    const resumenRes = await graphqlCall(
      `query { miResumenComensal { serviciosDelTurno { codigo habilitadoAhora } } }`,
      activeToken
    );
    const activeSvc = resumenRes.data.data?.miResumenComensal.serviciosDelTurno.find((s: any) => s.habilitadoAhora)?.codigo;

    // Primera llamada puede ser 201 (si aun no emitio hoy) o 409 (si P02 ya emitio hoy); la segunda SIEMPRE debe ser 409
    await apiCall('/api/v1/orders/vouchers/issue', {
      method: 'POST',
      token: activeToken,
      body: { servicioCodigo: activeSvc, sucursalEmisionCodigo: 'CENTRAL' }
    });
    const duplicateRes = await apiCall('/api/v1/orders/vouchers/issue', {
      method: 'POST',
      token: activeToken,
      body: { servicioCodigo: activeSvc, sucursalEmisionCodigo: 'CENTRAL' }
    });
    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.data.error.code).toBe('VALE_DUPLICADO');

    // 3. Doble canje de un vale ya canjeado -> 409 VALE_YA_CANJEADO
    const cajToken = (await loginAs('CAJ001')).data.accessToken;
    const prodRes = await apiCall('/api/v1/inventory/products?available=true', { token: cajToken });
    const doubleRedeem = await apiCall('/api/v1/orders/vouchers/VAL-HIST-0001/redeem', {
      method: 'POST',
      token: cajToken,
      body: {
        casinoCodigo: 'CASINO_CENTRAL_COMEDOR',
        items: [{ productoId: prodRes.data.products[0].id, cantidad: 1 }],
        metodoPagoDiferencia: 'NO_APLICA'
      }
    });
    expect(doubleRedeem.status).toBe(409);
    expect(doubleRedeem.data.error.code).toBe('VALE_YA_CANJEADO');

    recorder.record({
      testId: 'P10',
      criteriaId: 'CA10',
      title: 'Prevencion de emision fuera de turno, doble emision y doble canje',
      correlationIds: [outOfShiftRes.correlationId, duplicateRes.correlationId, doubleRedeem.correlationId],
      status: 'PASSED',
      steps: [
        { action: `Emision fuera de turno (${shiftCtx.inactiveEmployeeCode})`, responseStatus: outOfShiftRes.status, responseBody: outOfShiftRes.data },
        { action: `Doble emision en mismo horario (${shiftCtx.activeEmployeeCode})`, responseStatus: duplicateRes.status, responseBody: duplicateRes.data },
        { action: 'Doble canje de VAL-HIST-0001', responseStatus: doubleRedeem.status, responseBody: doubleRedeem.data }
      ]
    });
  });

  it('P11 (CA11): Limite de profundidad y complejidad en GraphQL Gateway', async () => {
    const empToken = (await loginAs('EMP001')).data.accessToken;

    // Profundidad = 5 > maxDepth (4): miResumenComensal(1) -> valesRecientes(2) -> canje(3) -> items(4) -> productoCodigo(5)
    const depth5BusinessQuery = `
      query Depth5Business {
        miResumenComensal {
          valesRecientes {
            canje {
              items {
                productoCodigo
              }
            }
          }
        }
      }
    `;
    const depthRes = await graphqlCall(depth5BusinessQuery, empToken);
    expect(depthRes.data.errors?.[0]?.extensions?.code).toBe('GRAPHQL_DEPTH_LIMIT_EXCEEDED');

    const overComplexityQuery = `
      query HighComplexity {
        ${Array.from({ length: 40 }, (_, idx) => `q${idx}: miResumenComensal { fechaConsultada horaServidor funcionario { id codigoFuncionario perfil { codigo nombre } } }`).join('\n')}
      }
    `;
    const complexityRes = await graphqlCall(overComplexityQuery, empToken);
    expect(complexityRes.data.errors?.[0]?.extensions?.code).toBe('GRAPHQL_COMPLEXITY_LIMIT_EXCEEDED');

    recorder.record({
      testId: 'P11',
      criteriaId: 'CA11',
      title: 'Rechazo de consultas GraphQL que exceden limite de profundidad y complejidad',
      correlationIds: [depthRes.correlationId, complexityRes.correlationId],
      status: 'PASSED',
      steps: [
        { action: 'Consulta GraphQL profundidad 5 (> maxDepth 4)', responseStatus: depthRes.status, responseBody: depthRes.data },
        { action: 'Consulta GraphQL complejidad > 500', responseStatus: complexityRes.status, responseBody: complexityRes.data }
      ]
    });
  });
});
