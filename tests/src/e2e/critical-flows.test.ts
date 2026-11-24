import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiCall, getActiveShiftContext, graphqlCall, loginAs } from '../helpers/apiClient';
import { EvidenceRecorder } from '../helpers/evidenceLogger';

const recorder = new EvidenceRecorder('E2E');

describe('Recorridos Criticos E2E - Caso 18 Libros Impresos S.A.', () => {
  const shiftCtx = getActiveShiftContext();
  let activeServiceCode = '';
  let issuedVoucherId = '';
  let issuedVoucherNumber = '';
  let issuedVoucherValue = 0;

  beforeAll(async () => {
    const health = await apiCall('/health');
    expect(health.status).toBe(200);
  });

  afterAll(() => {
    recorder.writeSummary();
  });

  it('P01 (CA01 / F02): Login + Consulta consolidada GraphQL miResumenComensal', async () => {
    const loginRes = await loginAs(shiftCtx.activeEmployeeCode);
    const token = loginRes.data.accessToken;

    const query = `
      query MiResumenComensal {
        miResumenComensal {
          fechaConsultada
          horaServidor
          funcionario {
            id
            codigoFuncionario
            nombreCompleto
            rut
            email
            perfil {
              codigo
              permiteMultiVale
              maxValesPorHorario
            }
            turnoActual {
              numeroTurno
              sucursalAsignadaCodigo
            }
          }
          sucursales {
            codigo
            nombre
          }
          serviciosDelTurno {
            codigo
            nombre
            valorClp
            habilitadoAhora
          }
          valesDisponiblesParaImprimir {
            id
            numeroVale
            estado
          }
          avisosSemanales {
            id
            estadoEnvio
          }
          partialErrors {
            subsystem
            code
            message
          }
        }
      }
    `;

    const gqlRes = await graphqlCall(query, token);
    expect(gqlRes.status).toBe(200);
    expect(gqlRes.data.errors).toBeUndefined();

    const resumen = gqlRes.data.data.miResumenComensal;
    expect(resumen.funcionario.codigoFuncionario).toBe(shiftCtx.activeEmployeeCode);
    expect(resumen.funcionario.turnoActual.numeroTurno).toBe(shiftCtx.activeShiftNumber);
    expect(resumen.partialErrors).toEqual([]);
    expect(resumen.sucursales.length).toBeGreaterThanOrEqual(2);

    const activeService = resumen.serviciosDelTurno.find((s: any) => s.habilitadoAhora === true);
    expect(activeService).toBeDefined();
    expect(activeService.valorClp).toBeGreaterThan(0);
    activeServiceCode = activeService.codigo;

    recorder.record({
      testId: 'P01',
      criteriaId: 'CA01',
      title: 'Consulta consolidada GraphQL miResumenComensal',
      correlationIds: [loginRes.correlationId, gqlRes.correlationId],
      status: 'PASSED',
      steps: [
        {
          action: `Login ${shiftCtx.activeEmployeeCode}`,
          request: { codigoFuncionario: shiftCtx.activeEmployeeCode },
          responseStatus: loginRes.status,
          durationMs: loginRes.durationMs,
          correlationId: loginRes.correlationId
        },
        {
          action: 'POST /api/v1/graphql miResumenComensal',
          request: { operationName: 'MiResumenComensal' },
          responseStatus: gqlRes.status,
          responseBody: gqlRes.data,
          durationMs: gqlRes.durationMs,
          correlationId: gqlRes.correlationId
        }
      ]
    });
  });

  it('P02 (CA02 / F03): Emision e impresion de vale en turno (<2s RF2) + verificacion persistencia', async () => {
    const loginRes = await loginAs(shiftCtx.activeEmployeeCode);
    const token = loginRes.data.accessToken;

    const issueRes = await apiCall('/api/v1/orders/vouchers/issue', {
      method: 'POST',
      token,
      body: {
        servicioCodigo: activeServiceCode,
        sucursalEmisionCodigo: 'CENTRAL'
      }
    });

    expect(issueRes.status).toBe(201);
    expect(issueRes.durationMs).toBeLessThan(2000);
    expect(issueRes.data.voucher.estado).toBe('IMPRESO');
    expect(issueRes.data.voucher.valorClp).toBeGreaterThan(0);

    issuedVoucherId = issueRes.data.voucher.id;
    issuedVoucherNumber = issueRes.data.voucher.numeroVale;
    issuedVoucherValue = issueRes.data.voucher.valorClp;

    const persistRes = await apiCall(`/api/v1/orders/vouchers/${issuedVoucherId}`, { token });
    expect(persistRes.status).toBe(200);
    expect(persistRes.data.voucher.numeroVale).toBe(issuedVoucherNumber);
    expect(persistRes.data.voucher.estado).toBe('IMPRESO');

    recorder.record({
      testId: 'P02',
      criteriaId: 'CA02',
      title: 'Emision e impresion de vale en turno activo',
      correlationIds: [issueRes.correlationId, persistRes.correlationId],
      status: 'PASSED',
      steps: [
        {
          action: 'POST /api/v1/orders/vouchers/issue',
          request: { servicioCodigo: activeServiceCode, sucursalEmisionCodigo: 'CENTRAL' },
          responseStatus: issueRes.status,
          responseBody: issueRes.data,
          durationMs: issueRes.durationMs,
          correlationId: issueRes.correlationId
        }
      ],
      persistenceCheck: {
        action: `GET /api/v1/orders/vouchers/${issuedVoucherId}`,
        status: persistRes.status,
        voucherEstado: persistRes.data.voucher.estado,
        numeroVale: persistRes.data.voucher.numeroVale
      }
    });
  });

  it('P03 (CA03 / F04): Canje en casino por cajero + liquidacion payments + reflejo en auditoria', async () => {
    const cashierLogin = await loginAs('CAJ001');
    const cashierToken = cashierLogin.data.accessToken;

    const prodRes = await apiCall('/api/v1/inventory/products?available=true', { token: cashierToken });
    expect(prodRes.status).toBe(200);
    const menuProd = prodRes.data.products.find((p: any) => p.codigo === 'PROD-001');
    expect(menuProd).toBeDefined();

    // Consumir 2 unidades (13.000 CLP > valor del vale) para verificar calculo exacto de diferencia a pagar
    const redeemRes = await apiCall(`/api/v1/orders/vouchers/${issuedVoucherNumber}/redeem`, {
      method: 'POST',
      token: cashierToken,
      body: {
        casinoCodigo: 'CASINO_CENTRAL_COMEDOR',
        items: [{ productoId: menuProd.id, cantidad: 2 }],
        metodoPagoDiferencia: 'EFECTIVO'
      }
    });

    expect(redeemRes.status).toBe(201);
    expect(redeemRes.data.voucher.estado).toBe('CANJEADO');
    expect(redeemRes.data.paymentTransaction.estado).toBe('LIQUIDADO');
    expect(redeemRes.data.paymentTransaction.totalConsumoClp).toBe(menuProd.precioClp * 2);
    expect(redeemRes.data.paymentTransaction.diferenciaPagadaClp).toBe(
      Math.max(0, menuProd.precioClp * 2 - issuedVoucherValue)
    );

    const txRes = await apiCall(`/api/v1/payments/transactions?valeId=${issuedVoucherId}`, {
      token: cashierToken
    });
    expect(txRes.status).toBe(200);
    expect(txRes.data.transactions.length).toBe(1);
    expect(txRes.data.transactions[0].numeroVale).toBe(issuedVoucherNumber);

    const adminLogin = await loginAs('ADM001');
    const auditRes = await apiCall('/api/v1/orders/reports/audit', { token: adminLogin.data.accessToken });
    expect(auditRes.status).toBe(200);
    expect(auditRes.data.summary.canjeadosUsados).toBeGreaterThanOrEqual(2);

    recorder.record({
      testId: 'P03',
      criteriaId: 'CA03',
      title: 'Canje en casino por cajero y auditoria',
      correlationIds: [redeemRes.correlationId, txRes.correlationId, auditRes.correlationId],
      status: 'PASSED',
      steps: [
        {
          action: `POST /api/v1/orders/vouchers/${issuedVoucherNumber}/redeem`,
          request: { casinoCodigo: 'CASINO_CENTRAL_COMEDOR', cantidad: 2, metodoPagoDiferencia: 'EFECTIVO' },
          responseStatus: redeemRes.status,
          responseBody: redeemRes.data,
          durationMs: redeemRes.durationMs,
          correlationId: redeemRes.correlationId
        }
      ],
      persistenceCheck: {
        ordersEstado: redeemRes.data.voucher.estado,
        paymentsEstado: txRes.data.transactions[0].estado,
        auditCanjeadosTotal: auditRes.data.summary.canjeadosUsados
      }
    });
  });

  it('P04 (CA04 / F05-F06): Vale adicional + impresion totem + servicio extensible + SP avisos semanales', async () => {
    const adminToken = (await loginAs('ADM001')).data.accessToken;
    const emp1Token = (await loginAs('EMP001')).data.accessToken;

    // 1. Admin emite vale adicional de reunion para EMP001
    const adicRes = await apiCall('/api/v1/orders/vouchers/additional', {
      method: 'POST',
      token: adminToken,
      body: {
        tipoVale: 'ADICIONAL_REUNION',
        funcionarioCodigo: 'EMP001',
        servicioCodigo: 'REUNION_COFFEE',
        sucursalEmisionCodigo: 'CENTRAL',
        motivoAdicional: 'Reunion de validacion automatizada E2E'
      }
    });
    expect(adicRes.status).toBe(201);
    expect(adicRes.data.voucher.estado).toBe('EMITIDO');

    // 2. Funcionario imprime vale adicional en totem
    const printRes = await apiCall(`/api/v1/orders/vouchers/${adicRes.data.voucher.id}/print`, {
      method: 'POST',
      token: emp1Token,
      body: {}
    });
    expect(printRes.status).toBe(200);
    expect(printRes.data.voucher.estado).toBe('IMPRESO');

    // 3. Admin crea servicio extensible (RF9)
    const extCode = `SNACK_${Date.now().toString().slice(-6)}`;
    const svcRes = await apiCall('/api/v1/inventory/services', {
      method: 'POST',
      token: adminToken,
      body: {
        codigo: extCode,
        nombre: 'Colacion Nocturna Extensible',
        descripcion: 'Servicio creado dinamicamente para validar extensibilidad RF9',
        esBase: false,
        horarios: [{ numeroTurno: 1, horaInicio: '09:00', horaFin: '11:00' }],
        valorizaciones: [{ perfilCodigo: 'OBRERO', valorClp: 4200 }]
      }
    });
    expect(svcRes.status).toBe(201);
    expect(svcRes.data.service.codigo).toBe(extCode);

    // 4. Admin ejecuta procedimiento almacenado de avisos semanales (CU9 / RNF4)
    const spRes = await apiCall('/api/v1/payments/notifications/weekly/run', {
      method: 'POST',
      token: adminToken,
      body: {}
    });
    expect(spRes.status).toBe(200);
    expect(spRes.data.totalProcesados).toBeGreaterThanOrEqual(5);
    expect(spRes.data.notifications.some((n: any) => n.estadoEnvio === 'ENVIADO_SANDBOX')).toBe(true);

    recorder.record({
      testId: 'P04',
      criteriaId: 'CA04',
      title: 'Vale adicional, servicio extensible y SP avisos semanales',
      correlationIds: [adicRes.correlationId, printRes.correlationId, svcRes.correlationId, spRes.correlationId],
      status: 'PASSED',
      steps: [
        {
          action: 'Emitir vale adicional + imprimir en totem',
          responseStatus: printRes.status,
          responseBody: printRes.data.voucher,
          correlationId: printRes.correlationId
        },
        {
          action: 'Crear servicio extensible + ejecutar SP avisos semanales',
          responseStatus: spRes.status,
          responseBody: {
            createdService: svcRes.data.service.codigo,
            totalProcesados: spRes.data.totalProcesados,
            dispatchedCount: spRes.data.dispatchedCount
          },
          correlationId: spRes.correlationId
        }
      ]
    });
  });

  it('P05 (CA05 / F07): Perfil multi-vale (SEC001) + operacion en linea multi-sucursal (RF11)', async () => {
    const adminToken = (await loginAs('ADM001')).data.accessToken;
    const secLogin = await loginAs('SEC001');
    const secToken = secLogin.data.accessToken;
    const secId = secLogin.data.user.id;

    // Asegurar que SEC001 opere en el turno activo actual para que la prueba funcione 24/7
    const shiftUpdate = await apiCall(`/api/v1/clients/employees/${secId}/shift`, {
      method: 'PUT',
      token: adminToken,
      body: { numeroTurno: shiftCtx.activeShiftNumber, sucursalCodigo: 'CENTRAL' }
    });
    expect(shiftUpdate.status).toBe(200);

    const v1 = await apiCall('/api/v1/orders/vouchers/issue', {
      method: 'POST',
      token: secToken,
      body: {
        servicioCodigo: activeServiceCode,
        sucursalEmisionCodigo: 'CENTRAL',
        nombreBeneficiarioVisita: 'Visita Editorial 1'
      }
    });
    expect(v1.status).toBe(201);

    const v2 = await apiCall('/api/v1/orders/vouchers/issue', {
      method: 'POST',
      token: secToken,
      body: {
        servicioCodigo: activeServiceCode,
        sucursalEmisionCodigo: 'NORTE',
        nombreBeneficiarioVisita: 'Visita Editorial 2'
      }
    });
    expect(v2.status).toBe(201);
    expect(v2.data.voucher.sucursalEmisionCodigo).toBe('NORTE');
    expect(v2.data.voucher.numeroVale).not.toBe(v1.data.voucher.numeroVale);

    recorder.record({
      testId: 'P05',
      criteriaId: 'CA05',
      title: 'Perfil multi-vale y emision multi-sucursal en linea',
      correlationIds: [v1.correlationId, v2.correlationId],
      status: 'PASSED',
      steps: [
        {
          action: 'Emision multi-vale en CENTRAL',
          responseStatus: v1.status,
          responseBody: { numeroVale: v1.data.voucher.numeroVale, sucursal: 'CENTRAL' },
          correlationId: v1.correlationId
        },
        {
          action: 'Emision multi-vale en NORTE',
          responseStatus: v2.status,
          responseBody: { numeroVale: v2.data.voucher.numeroVale, sucursal: 'NORTE' },
          correlationId: v2.correlationId
        }
      ]
    });
  });
});
