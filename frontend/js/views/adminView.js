import { apiRequest, graphqlRequest } from '../api.js';
import {
  clearNode,
  el,
  formatClp,
  formatDateTime,
  renderEmpty,
  renderError,
  renderLoading,
  showToast,
  statusBadge
} from '../ui.js';

const PANEL_AUDITORIA_QUERY = `
  query PanelAuditoria {
    panelAuditoria {
      resumen {
        totalRegistros
        disponiblesSinImprimir
        impresosNoUsados
        canjeadosUsados
        anulados
        montoEmitidoValidoClp
        montoCanjeadoClp
      }
      porServicio {
        servicioCodigo
        servicioNombre
        emitidosSinImprimir
        impresosNoUsados
        canjeados
        anulados
        totalValidos
        montoTotalClp
      }
      rendicionCasinos {
        casinoCodigo
        totalValesCanjeados
        totalValorValesClp
        totalConsumoClp
        totalCubiertoValeClp
        totalDiferenciasClp
        totalSaldosNoUsadosClp
      }
      partialErrors {
        subsystem
        code
        message
      }
    }
  }
`;

export function renderAdminView(root) {
  clearNode(root);

  let activeTab = 'audit';
  const tabBody = el('div', { className: 'mt-3' });

  const tabDefs = [
    { id: 'audit', label: 'Auditoria y Avisos (CU6 / CU9)' },
    { id: 'services', label: 'Servicios y Tarifas (CU3 / CU4)' },
    { id: 'profiles', label: 'Perfiles y Turnos (CU8)' },
    { id: 'vouchers', label: 'Vales Adicionales y Control (CU7)' }
  ];

  const navTabs = el('div', { className: 'd-flex flex-wrap gap-2' });

  function renderNavTabs() {
    clearNode(navTabs);
    for (const tab of tabDefs) {
      navTabs.appendChild(
        el('button', {
          type: 'button',
          className: `btn btn-sm ${activeTab === tab.id ? 'btn-primary' : 'btn-outline-primary'}`,
          text: tab.label,
          onClick: () => {
            activeTab = tab.id;
            renderNavTabs();
            loadActiveTab();
          }
        })
      );
    }
  }

  async function renderAuditTab() {
    renderLoading(tabBody, 'Consultando panel consolidado de auditoria y rendicion...');
    try {
      const [{ data: gqlRes }, auditRestRes, noticesRes] = await Promise.all([
        graphqlRequest(PANEL_AUDITORIA_QUERY),
        apiRequest('/api/v1/orders/reports/audit'),
        apiRequest('/api/v1/payments/notifications/weekly')
      ]);

      const panel = gqlRes.panelAuditoria;
      const byEmployee = auditRestRes.data.byEmployee || [];
      const notices = noticesRes.data.notifications || [];

      clearNode(tabBody);

      if (panel.partialErrors?.length > 0) {
        tabBody.appendChild(
          el('div', { className: 'alert alert-warning' }, [
            el('strong', { text: 'Degradacion parcial: ' }),
            el('span', { text: panel.partialErrors.map((e) => `${e.subsystem}: ${e.message}`).join(' | ') })
          ])
        );
      }

      const r = panel.resumen;
      const kpis = el('div', { className: 'row g-3 mb-4' }, [
        ['Vales Canjeados (Usados)', String(r.canjeadosUsados), formatClp(r.montoCanjeadoClp)],
        ['Impresos No Usados', String(r.impresosNoUsados), 'Detectados sin consumo'],
        ['Disponibles por Imprimir', String(r.disponiblesSinImprimir), 'Pendientes en totem'],
        ['Monto Emitido Valido', formatClp(r.montoEmitidoValidoClp), `${r.anulados} anulados`]
      ].map(([title, value, sub]) =>
        el('div', { className: 'col-12 col-sm-6 col-xl-3' }, [
          el('div', { className: 'kpi-card' }, [
            el('span', { className: 'small text-muted fw-semibold', text: title }),
            el('span', { className: 'kpi-value my-1', text: value }),
            el('span', { className: 'small text-muted', text: sub })
          ])
        ])
      ));

      const spActionFeedback = el('div', { className: 'mt-2' });
      const runWeeklyBtn = el('button', {
        type: 'button',
        className: 'btn btn-warning btn-sm fw-semibold',
        text: 'Ejecutar SP Avisos Semanales (CU9)',
        onClick: async () => {
          runWeeklyBtn.disabled = true;
          clearNode(spActionFeedback);
          try {
            const { data } = await apiRequest('/api/v1/payments/notifications/weekly/run', {
              method: 'POST',
              body: {}
            });
            showToast(`SP ejecutado: ${data.totalProcesados} funcionarios procesados (${data.dispatchedCount} enviados)`, 'success');
            await renderAuditTab();
          } catch (err) {
            renderError(spActionFeedback, err);
          } finally {
            runWeeklyBtn.disabled = false;
          }
        }
      });

      const serviceRows = panel.porServicio.map((s) =>
        el('tr', {}, [
          el('td', { text: `${s.servicioNombre} (${s.servicioCodigo})` }),
          el('td', { text: String(s.emitidosSinImprimir) }),
          el('td', { text: String(s.impresosNoUsados) }),
          el('td', { text: String(s.canjeados) }),
          el('td', { text: String(s.anulados) }),
          el('td', { className: 'fw-bold', text: formatClp(s.montoTotalClp) })
        ])
      );

      const empRows = byEmployee.map((e) =>
        el('tr', {}, [
          el('td', { className: 'font-monospace small', text: e.codigoFuncionario }),
          el('td', { text: e.nombreBeneficiario }),
          el('td', { text: String(e.disponibles) }),
          el('td', { className: e.impresosNoUsados > 0 ? 'text-danger fw-bold' : '', text: String(e.impresosNoUsados) }),
          el('td', { className: 'text-success fw-bold', text: String(e.canjeados) })
        ])
      );

      const reconRows =
        panel.rendicionCasinos.length === 0
          ? [el('tr', {}, [el('td', { attrs: { colspan: 7 }, className: 'text-center text-muted', text: 'Sin rendiciones registradas.' })])]
          : panel.rendicionCasinos.map((rc) =>
              el('tr', {}, [
                el('td', { className: 'fw-semibold', text: rc.casinoCodigo }),
                el('td', { text: String(rc.totalValesCanjeados) }),
                el('td', { text: formatClp(rc.totalValorValesClp) }),
                el('td', { text: formatClp(rc.totalConsumoClp) }),
                el('td', { text: formatClp(rc.totalDiferenciasClp) }),
                el('td', { text: formatClp(rc.totalSaldosNoUsadosClp) }),
                el('td', {}, [el('button', {
                  type: 'button',
                  className: 'btn btn-outline-primary btn-sm',
                  text: 'Cerrar mes actual',
                  onClick: async () => {
                    try {
                      const currentDate = new Date();
                      await apiRequest('/api/v1/payments/reconciliation/close', {
                        method: 'POST',
                        body: { casinoCodigo: rc.casinoCodigo, anio: currentDate.getFullYear(), mes: currentDate.getMonth() + 1 }
                      });
                      showToast(`Rendición mensual de ${rc.casinoCodigo} cerrada`, 'success');
                      await renderAuditTab();
                    } catch (err) {
                      showToast(err.message, 'error');
                    }
                  }
                })])
              ])
            );

      const noticeRows =
        notices.length === 0
          ? [el('tr', {}, [el('td', { attrs: { colspan: 6 }, className: 'text-center text-muted', text: 'Aun no se han generado avisos semanales.' })])]
          : notices.slice(0, 20).map((n) =>
              el('tr', {}, [
                el('td', { className: 'font-monospace small', text: n.codigoFuncionario }),
                el('td', { className: 'small', text: `${String(n.semanaInicio).slice(0, 10)} al ${String(n.semanaFin).slice(0, 10)}` }),
                el('td', { text: String(n.valesDisponibles) }),
                el('td', { text: String(n.valesUsados) }),
                el('td', { text: String(n.valesNoUsados) }),
                el('td', {}, [statusBadge(n.estadoEnvio)])
              ])
            );

      tabBody.appendChild(kpis);
      tabBody.appendChild(
        el('div', { className: 'row g-4' }, [
          el('div', { className: 'col-12 col-xl-6' }, [
            el('div', { className: 'panel-card' }, [
              el('div', { className: 'panel-card-header' }, [
                el('h3', { className: 'panel-title', text: 'Auditoria Exacta por Servicio (RF4)' })
              ]),
              el('div', { className: 'table-responsive' }, [
                el('table', { className: 'table table-sm align-middle mb-0' }, [
                  el('thead', { className: 'table-light' }, [
                    el('tr', {}, [
                      el('th', { text: 'Servicio' }),
                      el('th', { text: 'Emit.' }),
                      el('th', { text: 'No Usad.' }),
                      el('th', { text: 'Canj.' }),
                      el('th', { text: 'Anul.' }),
                      el('th', { text: 'Monto Valido' })
                    ])
                  ]),
                  el('tbody', {}, serviceRows)
                ])
              ])
            ])
          ]),
          el('div', { className: 'col-12 col-xl-6' }, [
            el('div', { className: 'panel-card' }, [
              el('div', { className: 'panel-card-header' }, [
                el('h3', { className: 'panel-title', text: 'Uso de Vales por Funcionario' })
              ]),
              el('div', { className: 'table-responsive' }, [
                el('table', { className: 'table table-sm align-middle mb-0' }, [
                  el('thead', { className: 'table-light' }, [
                    el('tr', {}, [
                      el('th', { text: 'Codigo' }),
                      el('th', { text: 'Funcionario' }),
                      el('th', { text: 'Disp.' }),
                      el('th', { text: 'No Usados' }),
                      el('th', { text: 'Usados' })
                    ])
                  ]),
                  el('tbody', {}, empRows)
                ])
              ])
            ])
          ]),
          el('div', { className: 'col-12' }, [
            el('div', { className: 'panel-card' }, [
              el('div', { className: 'panel-card-header' }, [
                el('h3', { className: 'panel-title', text: 'Rendicion Consolidada Empresa Externa de Casinos' })
              ]),
              el('div', { className: 'table-responsive' }, [
                el('table', { className: 'table table-sm align-middle mb-0' }, [
                  el('thead', { className: 'table-light' }, [
                    el('tr', {}, [
                      el('th', { text: 'Casino' }),
                      el('th', { text: 'Vales Canjeados' }),
                      el('th', { text: 'Valor Vales' }),
                      el('th', { text: 'Consumo Real' }),
                      el('th', { text: 'Diferencias Pagadas' }),
                      el('th', { text: 'Saldos no Usados' }),
                      el('th', { text: 'Cierre' })
                    ])
                  ]),
                  el('tbody', {}, reconRows)
                ])
              ])
            ])
          ]),
          el('div', { className: 'col-12' }, [
            el('div', { className: 'panel-card' }, [
              el('div', { className: 'panel-card-header' }, [
                el('h3', { className: 'panel-title', text: 'Avisos Semanales por Correo (SP + EmailSandboxAdapter)' }),
                runWeeklyBtn
              ]),
              spActionFeedback,
              el('div', { className: 'table-responsive' }, [
                el('table', { className: 'table table-sm align-middle mb-0' }, [
                  el('thead', { className: 'table-light' }, [
                    el('tr', {}, [
                      el('th', { text: 'Codigo' }),
                      el('th', { text: 'Semana' }),
                      el('th', { text: 'Disponibles' }),
                      el('th', { text: 'Usados' }),
                      el('th', { text: 'No Usados' }),
                      el('th', { text: 'Estado Envio' })
                    ])
                  ]),
                  el('tbody', {}, noticeRows)
                ])
              ])
            ])
          ])
        ])
      );
    } catch (err) {
      renderError(tabBody, err, renderAuditTab);
    }
  }

  async function renderServicesTab() {
    renderLoading(tabBody, 'Cargando servicios extensibles y valorizaciones...');
    try {
      const [servicesRes, profilesRes, productsRes] = await Promise.all([
        apiRequest('/api/v1/inventory/services'),
        apiRequest('/api/v1/clients/profiles'),
        apiRequest('/api/v1/inventory/products')
      ]);

      const services = servicesRes.data.services || [];
      const profiles = profilesRes.data.profiles || [];
      const products = productsRes.data.products || [];
      clearNode(tabBody);

      const svcFeedback = el('div', { className: 'mt-2' });
      const codeIn = el('input', { type: 'text', className: 'form-control form-control-sm', placeholder: 'COLACION_NOCTURNA', required: true });
      const nameIn = el('input', { type: 'text', className: 'form-control form-control-sm', placeholder: 'Colacion Nocturna Extra', required: true });
      const descIn = el('input', { type: 'text', className: 'form-control form-control-sm', placeholder: 'Servicio extensible para contingencias', required: true });
      const turnoSel = el('select', { className: 'form-select form-select-sm' }, [
        el('option', { value: '1', text: 'Turno 1 (08:00-16:00)' }),
        el('option', { value: '2', text: 'Turno 2 (16:00-24:00)' }),
        el('option', { value: '3', text: 'Turno 3 (00:00-08:00)' })
      ]);
      const startIn = el('input', { type: 'text', className: 'form-control form-control-sm', value: '10:00', required: true });
      const endIn = el('input', { type: 'text', className: 'form-control form-control-sm', value: '11:00', required: true });
      const baseAmountIn = el('input', { type: 'number', className: 'form-control form-control-sm', value: '5000', min: 500, required: true });

      const createSvcForm = el('form', { className: 'row g-2' }, [
        el('div', { className: 'col-12 col-md-4' }, [el('label', { className: 'form-label small mb-1', text: 'Codigo (MAYUS_)' }), codeIn]),
        el('div', { className: 'col-12 col-md-4' }, [el('label', { className: 'form-label small mb-1', text: 'Nombre' }), nameIn]),
        el('div', { className: 'col-12 col-md-4' }, [el('label', { className: 'form-label small mb-1', text: 'Valor inicial CLP (todos los perfiles)' }), baseAmountIn]),
        el('div', { className: 'col-12 col-md-6' }, [el('label', { className: 'form-label small mb-1', text: 'Descripcion' }), descIn]),
        el('div', { className: 'col-12 col-md-2' }, [el('label', { className: 'form-label small mb-1', text: 'Turno' }), turnoSel]),
        el('div', { className: 'col-6 col-md-2' }, [el('label', { className: 'form-label small mb-1', text: 'Inicio' }), startIn]),
        el('div', { className: 'col-6 col-md-2' }, [el('label', { className: 'form-label small mb-1', text: 'Fin' }), endIn]),
        el('div', { className: 'col-12' }, [
          el('button', { type: 'submit', className: 'btn btn-primary btn-sm', text: 'Crear Servicio Extensible (CU3)' })
        ]),
        el('div', { className: 'col-12' }, [svcFeedback])
      ]);

      createSvcForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        clearNode(svcFeedback);
        try {
          const valClp = Number(baseAmountIn.value);
          await apiRequest('/api/v1/inventory/services', {
            method: 'POST',
            body: {
              codigo: codeIn.value.trim().toUpperCase(),
              nombre: nameIn.value.trim(),
              descripcion: descIn.value.trim(),
              esBase: false,
              horarios: [
                {
                  numeroTurno: Number(turnoSel.value),
                  horaInicio: startIn.value.trim(),
                  horaFin: endIn.value.trim()
                }
              ],
              valorizaciones: profiles.map((p) => ({ perfilCodigo: p.codigo, valorClp: valClp }))
            }
          });
          showToast('Servicio creado exitosamente', 'success');
          await renderServicesTab();
        } catch (err) {
          renderError(svcFeedback, err);
        }
      });

      // Actualizar valorizacion por perfil (CU4)
      const valFeedback = el('div', { className: 'mt-2' });
      const valSvcSel = el(
        'select',
        { className: 'form-select form-select-sm' },
        services.map((s) => el('option', { value: s.id, text: `${s.nombre} (${s.codigo})` }))
      );
      const valProfSel = el(
        'select',
        { className: 'form-select form-select-sm' },
        profiles.map((p) => el('option', { value: p.codigo, text: `${p.nombre} (${p.codigo})` }))
      );
      const valAmountIn = el('input', { type: 'number', className: 'form-control form-control-sm', value: '7000', min: 500, required: true });

      const valForm = el('form', { className: 'row g-2 align-items-end' }, [
        el('div', { className: 'col-12 col-md-4' }, [el('label', { className: 'form-label small mb-1', text: 'Servicio' }), valSvcSel]),
        el('div', { className: 'col-12 col-md-4' }, [el('label', { className: 'form-label small mb-1', text: 'Perfil Comensal' }), valProfSel]),
        el('div', { className: 'col-12 col-md-2' }, [el('label', { className: 'form-label small mb-1', text: 'Valor CLP' }), valAmountIn]),
        el('div', { className: 'col-12 col-md-2' }, [
          el('button', { type: 'submit', className: 'btn btn-success btn-sm w-100', text: 'Guardar Tarifa' })
        ]),
        el('div', { className: 'col-12' }, [valFeedback])
      ]);

      valForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        clearNode(valFeedback);
        try {
          await apiRequest('/api/v1/inventory/valuations', {
            method: 'PUT',
            body: {
              servicioId: valSvcSel.value,
              perfilCodigo: valProfSel.value,
              valorClp: Number(valAmountIn.value),
              vigente: true
            }
          });
          showToast('Valorizacion actualizada', 'success');
          await renderServicesTab();
        } catch (err) {
          renderError(valFeedback, err);
        }
      });

      const productFeedback = el('div', { className: 'mt-2' });
      const productCodeIn = el('input', { type: 'text', className: 'form-control form-control-sm', placeholder: 'PROD-011', required: true });
      const productNameIn = el('input', { type: 'text', className: 'form-control form-control-sm', placeholder: 'Producto de casino', required: true });
      const productCategoryIn = el('input', { type: 'text', className: 'form-control form-control-sm', placeholder: 'Bebidas', required: true });
      const productPriceIn = el('input', { type: 'number', className: 'form-control form-control-sm', value: '2500', min: 1, required: true });
      const productForm = el('form', { className: 'row g-2 align-items-end' }, [
        el('div', { className: 'col-12 col-md-3' }, [el('label', { className: 'form-label small mb-1', text: 'Código' }), productCodeIn]),
        el('div', { className: 'col-12 col-md-3' }, [el('label', { className: 'form-label small mb-1', text: 'Producto' }), productNameIn]),
        el('div', { className: 'col-6 col-md-2' }, [el('label', { className: 'form-label small mb-1', text: 'Categoría' }), productCategoryIn]),
        el('div', { className: 'col-6 col-md-2' }, [el('label', { className: 'form-label small mb-1', text: 'Precio CLP' }), productPriceIn]),
        el('div', { className: 'col-12 col-md-2' }, [el('button', { type: 'submit', className: 'btn btn-primary btn-sm w-100', text: 'Agregar producto' })]),
        el('div', { className: 'col-12' }, [productFeedback])
      ]);
      productForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        clearNode(productFeedback);
        try {
          await apiRequest('/api/v1/inventory/products', {
            method: 'POST',
            body: {
              codigo: productCodeIn.value.trim().toUpperCase(),
              nombre: productNameIn.value.trim(),
              categoria: productCategoryIn.value.trim(),
              precioClp: Number(productPriceIn.value),
              disponible: true
            }
          });
          showToast('Producto agregado al catálogo del casino', 'success');
          await renderServicesTab();
        } catch (err) {
          renderError(productFeedback, err);
        }
      });

      const svcRows = services.map((s) =>
        el('tr', {}, [
          el('td', { className: 'font-monospace small', text: s.codigo }),
          el('td', { text: s.nombre }),
          el('td', { className: 'small', text: s.horarios.map((h) => `T${h.numeroTurno}: ${h.horaInicio}-${h.horaFin}`).join(' | ') || 'Solo adicional' }),
          el('td', { className: 'small', text: s.valorizaciones.map((v) => `${v.perfilCodigo}: ${formatClp(v.valorClp)}`).join(' · ') })
        ])
      );
      const productRows = products.map((product) =>
        el('tr', {}, [
          el('td', { className: 'font-monospace small', text: product.codigo }),
          el('td', { text: product.nombre }),
          el('td', { className: 'small', text: product.categoria }),
          el('td', { className: 'fw-semibold', text: formatClp(product.precioClp) }),
          el('td', {}, [statusBadge(product.disponible ? 'DISPONIBLE' : 'AGOTADO')]),
          el('td', {}, [el('button', {
            type: 'button',
            className: `btn btn-sm ${product.disponible ? 'btn-outline-danger' : 'btn-outline-success'}`,
            text: product.disponible ? 'Marcar agotado' : 'Reponer',
            onClick: async () => {
              try {
                await apiRequest(`/api/v1/inventory/products/${product.id}`, {
                  method: 'PUT',
                  body: { disponible: !product.disponible }
                });
                showToast(`Disponibilidad de ${product.nombre} actualizada`, 'success');
                await renderServicesTab();
              } catch (err) {
                showToast(err.message, 'error');
              }
            }
          })])
        ])
      );

      tabBody.appendChild(
        el('div', { className: 'row g-4' }, [
          el('div', { className: 'col-12' }, [
            el('div', { className: 'panel-card' }, [
              el('h3', { className: 'panel-title mb-3', text: 'Nuevo Servicio de Alimentacion Extensible (CU3 / RF9)' }),
              createSvcForm
            ])
          ]),
          el('div', { className: 'col-12' }, [
            el('div', { className: 'panel-card' }, [
              el('h3', { className: 'panel-title mb-3', text: 'Valorizacion por Servicio y Perfil (CU4 / RF3)' }),
              valForm
            ])
          ]),
          el('div', { className: 'col-12' }, [
            el('div', { className: 'panel-card' }, [
              el('h3', { className: 'panel-title mb-3', text: 'Catalogo Actual de Servicios' }),
              el('div', { className: 'table-responsive' }, [
                el('table', { className: 'table table-sm align-middle mb-0' }, [
                  el('thead', { className: 'table-light' }, [
                    el('tr', {}, [
                      el('th', { text: 'Codigo' }),
                      el('th', { text: 'Servicio' }),
                      el('th', { text: 'Horarios por Turno' }),
                      el('th', { text: 'Valorizaciones Vigentes' })
                    ])
                  ]),
                  el('tbody', {}, svcRows)
                ])
              ])
            ])
          ]),
          el('div', { className: 'col-12' }, [
            el('div', { className: 'panel-card' }, [
              el('h3', { className: 'panel-title mb-3', text: 'Productos y disponibilidad del casino (RF12)' }),
              productForm,
              el('div', { className: 'table-responsive mt-3' }, [
                el('table', { className: 'table table-sm align-middle mb-0' }, [
                  el('thead', { className: 'table-light' }, [el('tr', {}, [
                    el('th', { text: 'Código' }), el('th', { text: 'Producto' }), el('th', { text: 'Categoría' }),
                    el('th', { text: 'Precio' }), el('th', { text: 'Estado' }), el('th', { text: 'Acción' })
                  ])]),
                  products.length > 0
                    ? el('tbody', {}, productRows)
                    : el('tbody', {}, [el('tr', {}, [el('td', { attrs: { colspan: 6 }, className: 'text-center text-muted', text: 'No hay productos registrados.' })])])
                ])
              ])
            ])
          ])
        ])
      );
    } catch (err) {
      renderError(tabBody, err, renderServicesTab);
    }
  }

  async function renderProfilesTab() {
    renderLoading(tabBody, 'Cargando perfiles y funcionarios con turnos mensuales...');
    try {
      const [profilesRes, employeesRes, branchesRes] = await Promise.all([
        apiRequest('/api/v1/clients/profiles'),
        apiRequest('/api/v1/clients/employees'),
        apiRequest('/api/v1/clients/branches')
      ]);

      const profiles = profilesRes.data.profiles || [];
      const employees = employeesRes.data.employees || [];
      const branches = branchesRes.data.branches || [];
      clearNode(tabBody);

      const profFeedback = el('div', { className: 'mt-2' });
      const pCode = el('input', { type: 'text', className: 'form-control form-control-sm', placeholder: 'SUBGERENTE', required: true });
      const pName = el('input', { type: 'text', className: 'form-control form-control-sm', placeholder: 'Subgerente de Planta', required: true });
      const pDesc = el('input', { type: 'text', className: 'form-control form-control-sm', placeholder: 'Descripcion del perfil de comensal', required: true });
      const pMulti = el('input', { type: 'checkbox', className: 'form-check-input', id: 'prof-multi-chk' });
      const pMax = el('input', { type: 'number', className: 'form-control form-control-sm', value: '1', min: 1, max: 50 });

      const profForm = el('form', { className: 'row g-2 align-items-end' }, [
        el('div', { className: 'col-12 col-md-3' }, [el('label', { className: 'form-label small mb-1', text: 'Codigo' }), pCode]),
        el('div', { className: 'col-12 col-md-3' }, [el('label', { className: 'form-label small mb-1', text: 'Nombre' }), pName]),
        el('div', { className: 'col-12 col-md-4' }, [el('label', { className: 'form-label small mb-1', text: 'Descripcion' }), pDesc]),
        el('div', { className: 'col-6 col-md-2' }, [el('label', { className: 'form-label small mb-1', text: 'Max/horario' }), pMax]),
        el('div', { className: 'col-12 d-flex flex-wrap justify-content-between align-items-center gap-2 mt-2' }, [
          el('label', { className: 'form-check d-flex align-items-center gap-2 mb-0' }, [
            pMulti,
            el('span', { className: 'small fw-semibold', text: 'Permite Multi-Vale en mismo turno (visitas)' })
          ]),
          el('button', { type: 'submit', className: 'btn btn-primary btn-sm', text: 'Crear Perfil (CU8)' })
        ]),
        el('div', { className: 'col-12' }, [profFeedback])
      ]);

      profForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        clearNode(profFeedback);
        try {
          await apiRequest('/api/v1/clients/profiles', {
            method: 'POST',
            body: {
              codigo: pCode.value.trim().toUpperCase(),
              nombre: pName.value.trim(),
              descripcion: pDesc.value.trim(),
              permiteMultiVale: pMulti.checked,
              maxValesPorHorario: pMulti.checked ? Number(pMax.value) : 1
            }
          });
          showToast('Perfil de comensal creado', 'success');
          await renderProfilesTab();
        } catch (err) {
          renderError(profFeedback, err);
        }
      });

      const employeeFeedback = el('div', { className: 'mt-2' });
      const employeeCodeIn = el('input', { type: 'text', className: 'form-control form-control-sm', placeholder: 'EMP004', required: true });
      const employeeRutIn = el('input', { type: 'text', className: 'form-control form-control-sm', placeholder: '12345678-9', required: true });
      const employeeNameIn = el('input', { type: 'text', className: 'form-control form-control-sm', placeholder: 'Nombre funcionario', required: true });
      const employeeEmailIn = el('input', { type: 'email', className: 'form-control form-control-sm', placeholder: 'funcionario@example.test', required: true });
      const employeePasswordIn = el('input', { type: 'password', className: 'form-control form-control-sm', attrs: { autocomplete: 'new-password', minlength: '10' }, required: true });
      const employeeRoleSel = el('select', { className: 'form-select form-select-sm' }, [
        el('option', { value: 'FUNCIONARIO', text: 'Funcionario' }),
        el('option', { value: 'CAJERO', text: 'Cajero' }),
        el('option', { value: 'ADMINISTRADOR', text: 'Administrador' })
      ]);
      const employeeProfileSel = el('select', { className: 'form-select form-select-sm' },
        profiles.filter((profile) => profile.activo).map((profile) => el('option', { value: profile.codigo, text: `${profile.nombre} (${profile.codigo})` }))
      );
      const employeeBranchSel = el('select', { className: 'form-select form-select-sm' },
        branches.filter((branch) => branch.activa !== false).map((branch) => el('option', { value: branch.codigo, text: `${branch.nombre} (${branch.codigo})` }))
      );
      const employeeShiftSel = el('select', { className: 'form-select form-select-sm' }, [
        el('option', { value: '1', text: 'Turno 1 (08:00-16:00)' }),
        el('option', { value: '2', text: 'Turno 2 (16:00-24:00)' }),
        el('option', { value: '3', text: 'Turno 3 (00:00-08:00)' })
      ]);
      const employeeForm = el('form', { className: 'row g-2 align-items-end' }, [
        el('div', { className: 'col-12 col-md-3' }, [el('label', { className: 'form-label small mb-1', text: 'Código funcionario' }), employeeCodeIn]),
        el('div', { className: 'col-12 col-md-3' }, [el('label', { className: 'form-label small mb-1', text: 'RUT de prueba' }), employeeRutIn]),
        el('div', { className: 'col-12 col-md-6' }, [el('label', { className: 'form-label small mb-1', text: 'Nombre completo' }), employeeNameIn]),
        el('div', { className: 'col-12 col-md-4' }, [el('label', { className: 'form-label small mb-1', text: 'Correo de prueba' }), employeeEmailIn]),
        el('div', { className: 'col-12 col-md-4' }, [el('label', { className: 'form-label small mb-1', text: 'Perfil comensal' }), employeeProfileSel]),
        el('div', { className: 'col-12 col-md-4' }, [el('label', { className: 'form-label small mb-1', text: 'Rol del sistema' }), employeeRoleSel]),
        el('div', { className: 'col-12 col-md-4' }, [el('label', { className: 'form-label small mb-1', text: 'Sucursal base' }), employeeBranchSel]),
        el('div', { className: 'col-12 col-md-4' }, [el('label', { className: 'form-label small mb-1', text: 'Turno mensual inicial' }), employeeShiftSel]),
        el('div', { className: 'col-12 col-md-4' }, [el('label', { className: 'form-label small mb-1', text: 'Contraseña inicial (mín. 10)' }), employeePasswordIn]),
        el('div', { className: 'col-12' }, [el('button', { type: 'submit', className: 'btn btn-primary btn-sm', text: 'Crear funcionario y acceso' })]),
        el('div', { className: 'col-12' }, [employeeFeedback])
      ]);
      employeeForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        clearNode(employeeFeedback);
        try {
          const { data } = await apiRequest('/api/v1/clients/employees', {
            method: 'POST',
            body: {
              codigoFuncionario: employeeCodeIn.value.trim().toUpperCase(),
              rut: employeeRutIn.value.trim(),
              nombreCompleto: employeeNameIn.value.trim(),
              email: employeeEmailIn.value.trim(),
              role: employeeRoleSel.value,
              perfilCodigo: employeeProfileSel.value,
              sucursalCodigo: employeeBranchSel.value,
              numeroTurno: Number(employeeShiftSel.value),
              password: employeePasswordIn.value
            }
          });
          showToast(`Acceso creado para ${data.employee.codigoFuncionario}`, 'success');
          await renderProfilesTab();
        } catch (err) {
          renderError(employeeFeedback, err);
        }
      });

      // Reasignacion de turno mensual
      const shiftFeedback = el('div', { className: 'mt-2' });
      const empSel = el(
        'select',
        { className: 'form-select form-select-sm' },
        employees.map((e) => el('option', { value: e.id, text: `${e.codigoFuncionario} · ${e.nombreCompleto}` }))
      );
      const shiftNumSel = el('select', { className: 'form-select form-select-sm' }, [
        el('option', { value: '1', text: 'Turno 1 (08:00 - 16:00)' }),
        el('option', { value: '2', text: 'Turno 2 (16:00 - 24:00)' }),
        el('option', { value: '3', text: 'Turno 3 (00:00 - 08:00)' })
      ]);
      const branchSel = el(
        'select',
        { className: 'form-select form-select-sm' },
        branches.map((b) => el('option', { value: b.codigo, text: `${b.nombre} (${b.codigo})` }))
      );

      const shiftForm = el('form', { className: 'row g-2 align-items-end' }, [
        el('div', { className: 'col-12 col-md-4' }, [el('label', { className: 'form-label small mb-1', text: 'Funcionario' }), empSel]),
        el('div', { className: 'col-12 col-md-3' }, [el('label', { className: 'form-label small mb-1', text: 'Turno Mensual' }), shiftNumSel]),
        el('div', { className: 'col-12 col-md-3' }, [el('label', { className: 'form-label small mb-1', text: 'Sucursal Asignada' }), branchSel]),
        el('div', { className: 'col-12 col-md-2' }, [
          el('button', { type: 'submit', className: 'btn btn-success btn-sm w-100', text: 'Asignar Turno' })
        ]),
        el('div', { className: 'col-12' }, [shiftFeedback])
      ]);

      shiftForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        clearNode(shiftFeedback);
        try {
          await apiRequest(`/api/v1/clients/employees/${empSel.value}/shift`, {
            method: 'PUT',
            body: {
              numeroTurno: Number(shiftNumSel.value),
              sucursalCodigo: branchSel.value
            }
          });
          showToast('Turno mensual actualizado', 'success');
          await renderProfilesTab();
        } catch (err) {
          renderError(shiftFeedback, err);
        }
      });

      const empRows = employees.map((e) =>
        el('tr', {}, [
          el('td', { className: 'font-monospace small', text: e.codigoFuncionario }),
          el('td', { text: e.nombreCompleto }),
          el('td', { className: 'small', text: `${e.perfilNombre} ${e.permiteMultiVale ? '(Multi-vale)' : ''}` }),
          el('td', { className: 'small', text: e.numeroTurno ? `Turno ${e.numeroTurno} · ${e.sucursalAsignadaCodigo}` : 'Sin turno' })
        ])
      );

      tabBody.appendChild(
        el('div', { className: 'row g-4' }, [
          el('div', { className: 'col-12' }, [
            el('div', { className: 'panel-card' }, [
              el('h3', { className: 'panel-title mb-3', text: 'Crear Perfil de Comensal (CU8 / RF6)' }),
              profForm
            ])
          ]),
          el('div', { className: 'col-12' }, [
            el('div', { className: 'panel-card' }, [
              el('h3', { className: 'panel-title mb-3', text: 'Asignacion Mensual de Turno y Sucursal' }),
              shiftForm
            ])
          ]),
          el('div', { className: 'col-12' }, [
            el('div', { className: 'panel-card' }, [
              el('h3', { className: 'panel-title mb-2', text: 'Registrar funcionario y credenciales (CU1 / RF1)' }),
              el('p', { className: 'small text-muted', text: 'El backend guarda un hash adaptativo de la contraseña; este formulario solo se usa en una estación administrativa autorizada.' }),
              employeeForm
            ])
          ]),
          el('div', { className: 'col-12' }, [
            el('div', { className: 'panel-card' }, [
              el('h3', { className: 'panel-title mb-3', text: 'Dotacion Registrada' }),
              el('div', { className: 'table-responsive' }, [
                el('table', { className: 'table table-sm align-middle mb-0' }, [
                  el('thead', { className: 'table-light' }, [
                    el('tr', {}, [
                      el('th', { text: 'Codigo' }),
                      el('th', { text: 'Nombre' }),
                      el('th', { text: 'Perfil' }),
                      el('th', { text: 'Turno Vigente' })
                    ])
                  ]),
                  el('tbody', {}, empRows)
                ])
              ])
            ])
          ])
        ])
      );
    } catch (err) {
      renderError(tabBody, err, renderProfilesTab);
    }
  }

  async function renderVouchersTab() {
    renderLoading(tabBody, 'Cargando listado de vales y servicios...');
    try {
      const [vouchersRes, servicesRes, employeesRes, branchesRes] = await Promise.all([
        apiRequest('/api/v1/orders/vouchers'),
        apiRequest('/api/v1/inventory/services?activo=true'),
        apiRequest('/api/v1/clients/employees'),
        apiRequest('/api/v1/clients/branches')
      ]);

      const vouchers = vouchersRes.data.vouchers || [];
      const services = servicesRes.data.services || [];
      const employees = employeesRes.data.employees || [];
      const branches = branchesRes.data.branches || [];
      clearNode(tabBody);

      const addFeedback = el('div', { className: 'mt-2' });
      const tipoSel = el('select', { className: 'form-select form-select-sm' }, [
        el('option', { value: 'ADICIONAL_REUNION', text: 'Adicional Reunion (para imprimir en totem)' }),
        el('option', { value: 'VISITA_NO_PERSONALIZADO', text: 'Visita / Empleado Nuevo (no personalizado)' })
      ]);
      const empSel = el(
        'select',
        { className: 'form-select form-select-sm' },
        employees.map((e) => el('option', { value: e.codigoFuncionario, text: `${e.codigoFuncionario} · ${e.nombreCompleto}` }))
      );
      const visitNameIn = el('input', { type: 'text', className: 'form-control form-control-sm', placeholder: 'Nombre visita (si aplica)' });
      const svcSel = el(
        'select',
        { className: 'form-select form-select-sm' },
        services.map((s) => el('option', { value: s.codigo, text: `${s.nombre} (${s.codigo})` }))
      );
      const branchSel = el(
        'select',
        { className: 'form-select form-select-sm' },
        branches.map((b) => el('option', { value: b.codigo, text: b.nombre }))
      );
      const motivoIn = el('input', { type: 'text', className: 'form-control form-control-sm', value: 'Reunion de coordinacion editorial', required: true });

      const addForm = el('form', { className: 'row g-2 align-items-end' }, [
        el('div', { className: 'col-12 col-md-4' }, [el('label', { className: 'form-label small mb-1', text: 'Tipo de Vale' }), tipoSel]),
        el('div', { className: 'col-12 col-md-4' }, [el('label', { className: 'form-label small mb-1', text: 'Funcionario (si es Reunion)' }), empSel]),
        el('div', { className: 'col-12 col-md-4' }, [el('label', { className: 'form-label small mb-1', text: 'Beneficiario Visita' }), visitNameIn]),
        el('div', { className: 'col-12 col-md-4' }, [el('label', { className: 'form-label small mb-1', text: 'Servicio' }), svcSel]),
        el('div', { className: 'col-12 col-md-3' }, [el('label', { className: 'form-label small mb-1', text: 'Sucursal' }), branchSel]),
        el('div', { className: 'col-12 col-md-5' }, [el('label', { className: 'form-label small mb-1', text: 'Motivo / Justificacion' }), motivoIn]),
        el('div', { className: 'col-12 mt-2' }, [
          el('button', { type: 'submit', className: 'btn btn-primary btn-sm', text: 'Emitir Vale Adicional / Visita (CU7)' })
        ]),
        el('div', { className: 'col-12' }, [addFeedback])
      ]);

      addForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        clearNode(addFeedback);
        try {
          const isAdic = tipoSel.value === 'ADICIONAL_REUNION';
          const { data } = await apiRequest('/api/v1/orders/vouchers/additional', {
            method: 'POST',
            body: {
              tipoVale: tipoSel.value,
              ...(isAdic ? { funcionarioCodigo: empSel.value } : { nombreBeneficiarioVisita: visitNameIn.value.trim() || 'Visita Externa' }),
              servicioCodigo: svcSel.value,
              sucursalEmisionCodigo: branchSel.value,
              motivoAdicional: motivoIn.value.trim()
            }
          });
          showToast(`Vale ${data.voucher.numeroVale} generado en estado ${data.voucher.estado}`, 'success');
          await renderVouchersTab();
        } catch (err) {
          renderError(addFeedback, err);
        }
      });

      const rows = vouchers.map((v) => {
        const canCancel = v.estado === 'EMITIDO' || v.estado === 'IMPRESO';
        return el('tr', {}, [
          el('td', { className: 'font-monospace small', text: v.numeroVale }),
          el('td', { className: 'small', text: `${v.nombreBeneficiario} (${v.codigoFuncionario || 'VISITA'})` }),
          el('td', { className: 'small', text: `${v.servicioNombre} · ${v.tipoVale}` }),
          el('td', { text: formatClp(v.valorClp) }),
          el('td', {}, [statusBadge(v.estado)]),
          el('td', { className: 'small', text: formatDateTime(v.emitidoEn) }),
          el('td', {}, [
            canCancel
              ? el('button', {
                  type: 'button',
                  className: 'btn btn-outline-danger btn-sm',
                  text: 'Anular',
                  onClick: async () => {
                    try {
                      await apiRequest(`/api/v1/orders/vouchers/${v.id}/cancel`, { method: 'POST', body: {} });
                      showToast(`Vale ${v.numeroVale} anulado (registro preservado)`, 'success');
                      await renderVouchersTab();
                    } catch (err) {
                      showToast(err.message, 'error');
                    }
                  }
                })
              : el('span', { className: 'text-muted small', text: '—' })
          ])
        ]);
      });

      tabBody.appendChild(
        el('div', { className: 'row g-4' }, [
          el('div', { className: 'col-12' }, [
            el('div', { className: 'panel-card' }, [
              el('h3', { className: 'panel-title mb-3', text: 'Generar Vales Adicionales o de Visita (CU7 / RF5)' }),
              addForm
            ])
          ]),
          el('div', { className: 'col-12' }, [
            el('div', { className: 'panel-card' }, [
              el('h3', { className: 'panel-title mb-3', text: 'Control Completo de Vales Emitidos' }),
              vouchers.length === 0
                ? el('p', { className: 'small text-muted', text: 'Sin vales registrados.' })
                : el('div', { className: 'table-responsive' }, [
                    el('table', { className: 'table table-sm table-hover align-middle mb-0' }, [
                      el('thead', { className: 'table-light' }, [
                        el('tr', {}, [
                          el('th', { text: 'N° Vale' }),
                          el('th', { text: 'Beneficiario' }),
                          el('th', { text: 'Servicio / Tipo' }),
                          el('th', { text: 'Valor' }),
                          el('th', { text: 'Estado' }),
                          el('th', { text: 'Emitido' }),
                          el('th', { text: 'Accion' })
                        ])
                      ]),
                      el('tbody', {}, rows)
                    ])
                  ])
            ])
          ])
        ])
      );
    } catch (err) {
      renderError(tabBody, err, renderVouchersTab);
    }
  }

  function loadActiveTab() {
    if (activeTab === 'audit') renderAuditTab();
    else if (activeTab === 'services') renderServicesTab();
    else if (activeTab === 'profiles') renderProfilesTab();
    else renderVouchersTab();
  }

  renderNavTabs();
  root.appendChild(
    el('section', { className: 'panel-card mb-3' }, [
      el('div', { className: 'panel-card-header' }, [
        el('h2', { className: 'panel-title', text: 'Panel de Administracion y Auditoria' }),
        navTabs
      ])
    ])
  );
  root.appendChild(tabBody);
  loadActiveTab();
}
