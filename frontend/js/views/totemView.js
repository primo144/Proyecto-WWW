import { apiRequest, graphqlRequest } from '../api.js';
import {
  clearNode,
  el,
  formatClp,
  formatDateTime,
  renderEmpty,
  renderError,
  renderLoading,
  renderVoucherReceipt,
  showToast,
  statusBadge
} from '../ui.js';

const MI_RESUMEN_QUERY = `
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
        rol
        perfil {
          codigo
          nombre
          permiteMultiVale
          maxValesPorHorario
        }
        sucursalBase {
          codigo
          nombre
        }
        turnoActual {
          anio
          mes
          numeroTurno
          horarioLabel
          sucursalAsignadaCodigo
          sucursalAsignadaNombre
        }
      }
      sucursales {
        codigo
        nombre
      }
      serviciosDelTurno {
        id
        codigo
        nombre
        descripcion
        valorClp
        habilitadoAhora
        horarios {
          numeroTurno
          horaInicio
          horaFin
        }
      }
      valesDisponiblesParaImprimir {
        id
        numeroVale
        nombreBeneficiario
        perfilCodigo
        servicioCodigo
        servicioNombre
        tipoVale
        numeroTurno
        fechaVigencia
        horaInicioPermitida
        horaFinPermitida
        valorClp
        sucursalEmisionCodigo
        estado
        motivoAdicional
        emitidoEn
      }
      valesRecientes {
        id
        numeroVale
        nombreBeneficiario
        perfilCodigo
        servicioCodigo
        servicioNombre
        tipoVale
        numeroTurno
        fechaVigencia
        horaInicioPermitida
        horaFinPermitida
        valorClp
        sucursalEmisionCodigo
        estado
        motivoAdicional
        emitidoEn
        impresoEn
        canjeadoEn
      }
      avisosSemanales {
        id
        semanaInicio
        semanaFin
        valesDisponibles
        valesUsados
        valesNoUsados
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

export function renderTotemView(root) {
  clearNode(root);
  const contentWrap = el('div', { id: 'totem-content' });
  root.appendChild(contentWrap);

  let lastIssuedVoucher = null;
  let lastIssuedMeta = null;

  async function loadDashboard() {
    renderLoading(contentWrap, 'Consultando resumen consolidado via GraphQL Gateway...');
    try {
      const { data, correlationId } = await graphqlRequest(MI_RESUMEN_QUERY);
      const resumen = data?.miResumenComensal;
      if (!resumen) {
        renderEmpty(contentWrap, 'Sin informacion disponible', 'No se pudo obtener el resumen del funcionario.');
        return;
      }

      clearNode(contentWrap);
      const emp = resumen.funcionario;

      if (Array.isArray(resumen.partialErrors) && resumen.partialErrors.length > 0) {
        const alertBox = el('div', { className: 'alert alert-warning mb-3' }, [
          el('strong', { className: 'd-block', text: 'Degradacion parcial detectada en subsistemas secundarios:' }),
          el(
            'ul',
            { className: 'mb-0 small mt-1' },
            resumen.partialErrors.map((pe) => el('li', { text: `${pe.subsystem} (${pe.code}): ${pe.message}` }))
          )
        ]);
        contentWrap.appendChild(alertBox);
      }

      // Selector de sucursal donde esta ubicado el totem (Casa Central o Sucursal Norte - RF11)
      const branchSelect = el(
        'select',
        { id: 'totem-branch-select', className: 'form-select form-select-sm' },
        resumen.sucursales.map((b) => el('option', { value: b.codigo, text: `${b.nombre} (${b.codigo})` }))
      );
      if (emp.turnoActual?.sucursalAsignadaCodigo) {
        branchSelect.value = emp.turnoActual.sucursalAsignadaCodigo;
      }

      const visitorInput = el('input', {
        id: 'totem-visitor-name',
        type: 'text',
        className: 'form-control form-control-sm',
        placeholder: 'Nombre visita (opcional para perfil multi-vale)'
      });

      const actionFeedback = el('div', { className: 'mt-3' });
      const receiptZone = el('div', { className: 'mt-3' });
      if (lastIssuedVoucher) {
        receiptZone.appendChild(
          renderVoucherReceipt(lastIssuedVoucher, lastIssuedMeta?.elapsedMs ?? null, lastIssuedMeta?.correlationId ?? null)
        );
      }

      async function handleIssue(servicioCodigo) {
        clearNode(actionFeedback);
        const startClient = performance.now();
        try {
          const body = {
            servicioCodigo,
            sucursalEmisionCodigo: branchSelect.value
          };
          if (emp.perfil.permiteMultiVale && visitorInput.value.trim().length >= 2) {
            body.nombreBeneficiarioVisita = visitorInput.value.trim();
          }

          const { data: issueRes, correlationId: cid } = await apiRequest('/api/v1/orders/vouchers/issue', {
            method: 'POST',
            body
          });

          const totalClientMs = Math.round(performance.now() - startClient);
          lastIssuedVoucher = issueRes.voucher;
          lastIssuedMeta = {
            elapsedMs: issueRes.elapsedMs ?? totalClientMs,
            correlationId: cid
          };
          showToast(`Vale ${issueRes.voucher.numeroVale} impreso en ${lastIssuedMeta.elapsedMs} ms`, 'success');
          await loadDashboard();
        } catch (err) {
          renderError(actionFeedback, err);
        }
      }

      async function handlePrintAdditional(valeId) {
        clearNode(actionFeedback);
        try {
          const { data: printRes, correlationId: cid } = await apiRequest(`/api/v1/orders/vouchers/${valeId}/print`, {
            method: 'POST',
            body: {}
          });
          lastIssuedVoucher = printRes.voucher;
          lastIssuedMeta = { elapsedMs: printRes.elapsedMs ?? null, correlationId: cid };
          showToast(`Vale adicional ${printRes.voucher.numeroVale} impreso`, 'success');
          await loadDashboard();
        } catch (err) {
          renderError(actionFeedback, err);
        }
      }

      // Tarjetas de servicios del turno
      const servicesGrid = el('div', { className: 'row g-3' });
      if (resumen.serviciosDelTurno.length === 0) {
        servicesGrid.appendChild(
          el('div', { className: 'col-12' }, [
            el('div', { className: 'state-panel' }, [
              el('p', { className: 'mb-0 text-muted', text: 'No hay servicios asignados a su turno actual.' })
            ])
          ])
        );
      } else {
        for (const svc of resumen.serviciosDelTurno) {
          const horario = svc.horarios[0];
          const horarioText = horario ? `${horario.horaInicio} - ${horario.horaFin}` : 'Sin ventana';
          const btn = el('button', {
            type: 'button',
            className: `btn ${svc.habilitadoAhora ? 'btn-success' : 'btn-outline-secondary'} btn-sm`,
            text: svc.habilitadoAhora ? 'Emitir e Imprimir Vale (<2s)' : 'Fuera de Horario',
            onClick: () => handleIssue(svc.codigo)
          });

          servicesGrid.appendChild(
            el('div', { className: 'col-12 col-md-6' }, [
              el('div', { className: `service-card ${svc.habilitadoAhora ? 'is-active-window' : 'is-inactive-window'}` }, [
                el('div', {}, [
                  el('div', { className: 'service-card-header' }, [
                    el('h3', { className: 'h6 fw-bold mb-0', text: svc.nombre }),
                    el('span', {
                      className: `badge ${svc.habilitadoAhora ? 'bg-success' : 'bg-secondary'}`,
                      text: svc.habilitadoAhora ? 'Activo ahora' : horarioText
                    })
                  ]),
                  el('div', { className: 'service-card-body' }, [
                    el('p', { className: 'small text-muted mb-1', text: svc.descripcion }),
                    el('div', { className: 'small', text: `Ventana permitida: ${horarioText}` })
                  ])
                ]),
                el('div', { className: 'service-card-footer' }, [
                  el('span', { className: 'price-tag', text: svc.valorClp ? formatClp(svc.valorClp) : 'Sin tarifa' }),
                  btn
                ])
              ])
            ])
          );
        }
      }

      // Vales adicionales pre-emitidos pendientes de impresion (CU7)
      const pendingAdditionalPanel = el('section', { className: 'panel-card' }, [
        el('div', { className: 'panel-card-header' }, [
          el('h2', { className: 'panel-title', text: 'Vales Adicionales Disponibles para Imprimir (CU7)' }),
          el('span', { className: 'badge bg-info text-dark', text: `${resumen.valesDisponiblesParaImprimir.length} disponibles` })
        ])
      ]);
      if (resumen.valesDisponiblesParaImprimir.length === 0) {
        pendingAdditionalPanel.appendChild(
          el('p', { className: 'small text-muted mb-0', text: 'No posee vales adicionales pendientes de impresion en totem.' })
        );
      } else {
        const list = el('div', { className: 'd-flex flex-column gap-2' });
        for (const v of resumen.valesDisponiblesParaImprimir) {
          list.appendChild(
            el('div', { className: 'd-flex flex-wrap justify-content-between align-items-center gap-2 p-2 border rounded bg-light' }, [
              el('div', {}, [
                el('strong', { text: `${v.numeroVale} · ${v.servicioNombre}` }),
                el('div', { className: 'small text-muted', text: `${v.motivoAdicional || v.tipoVale} · ${formatClp(v.valorClp)}` })
              ]),
              el('button', {
                type: 'button',
                className: 'btn btn-primary btn-sm',
                text: 'Imprimir en Totem',
                onClick: () => handlePrintAdditional(v.id)
              })
            ])
          );
        }
        pendingAdditionalPanel.appendChild(list);
      }

      // Historial reciente de vales
      const historyBody = el('tbody');
      if (resumen.valesRecientes.length === 0) {
        historyBody.appendChild(
          el('tr', {}, [el('td', { attrs: { colspan: 6 }, className: 'text-center text-muted py-3', text: 'Aun no registra vales emitidos.' })])
        );
      } else {
        for (const v of resumen.valesRecientes) {
          historyBody.appendChild(
            el('tr', {}, [
              el('td', { className: 'font-monospace small', text: v.numeroVale }),
              el('td', { text: `${v.servicioNombre}` }),
              el('td', { className: 'small', text: v.sucursalEmisionCodigo }),
              el('td', { text: formatClp(v.valorClp) }),
              el('td', {}, [statusBadge(v.estado)]),
              el('td', { className: 'small', text: formatDateTime(v.impresoEn || v.emitidoEn) })
            ])
          );
        }
      }

      // Avisos semanales (CU9)
      const noticesContainer = el('div', { className: 'small' });
      if (resumen.avisosSemanales.length === 0) {
        noticesContainer.appendChild(el('p', { className: 'text-muted mb-0', text: 'Sin avisos semanales generados aun para su cuenta.' }));
      } else {
        for (const av of resumen.avisosSemanales) {
          noticesContainer.appendChild(
            el('div', { className: 'p-2 mb-2 border rounded bg-light d-flex flex-wrap justify-content-between gap-2' }, [
              el('span', {
                text: `Semana ${String(av.semanaInicio).slice(0, 10)} al ${String(av.semanaFin).slice(0, 10)}: Disponibles=${av.valesDisponibles}, Usados=${av.valesUsados}, No usados=${av.valesNoUsados}`
              }),
              statusBadge(av.estadoEnvio)
            ])
          );
        }
      }

      const mainGrid = el('div', { className: 'row g-4' }, [
        el('div', { className: 'col-12 col-lg-7' }, [
          el('section', { className: 'panel-card' }, [
            el('div', { className: 'panel-card-header' }, [
              el('div', {}, [
                el('h2', { className: 'panel-title', text: 'Totem de Emision e Impresion (CU2)' }),
                el('span', { className: 'small text-muted', text: `Fecha servidor: ${resumen.fechaConsultada} · Hora: ${resumen.horaServidor} (America/Santiago)` })
              ]),
              el('button', {
                type: 'button',
                className: 'btn btn-outline-secondary btn-sm',
                text: 'Actualizar',
                onClick: loadDashboard
              })
            ]),
            el('div', { className: 'row g-2 mb-3 p-2 bg-light border rounded' }, [
              el('div', { className: 'col-12 col-md-6' }, [
                el('div', { className: 'small text-muted', text: 'Funcionario y Perfil' }),
                el('strong', { text: `${emp.nombreCompleto} (${emp.codigoFuncionario})` }),
                el('div', { className: 'small', text: `${emp.perfil.nombre} · RUT: ${emp.rut || 'Restringido'}` })
              ]),
              el('div', { className: 'col-12 col-md-6' }, [
                el('div', { className: 'small text-muted', text: 'Turno Mensual Asignado' }),
                el('strong', { text: emp.turnoActual ? `Turno ${emp.turnoActual.numeroTurno}` : 'Sin turno' }),
                el('div', { className: 'small', text: emp.turnoActual?.horarioLabel || 'Contactar administracion' })
              ]),
              el('div', { className: 'col-12 col-md-6 mt-2' }, [
                el('label', { className: 'form-label small fw-semibold mb-1', attrs: { for: 'totem-branch-select' }, text: 'Sucursal de Impresion (en linea)' }),
                branchSelect
              ]),
              emp.perfil.permiteMultiVale
                ? el('div', { className: 'col-12 col-md-6 mt-2' }, [
                    el('label', {
                      className: 'form-label small fw-semibold mb-1',
                      attrs: { for: 'totem-visitor-name' },
                      text: `Multi-vale habilitado (max ${emp.perfil.maxValesPorHorario}/horario)`
                    }),
                    visitorInput
                  ])
                : null
            ]),
            servicesGrid,
            actionFeedback
          ]),
          pendingAdditionalPanel
        ]),
        el('div', { className: 'col-12 col-lg-5' }, [
          el('section', { className: 'panel-card' }, [
            el('div', { className: 'panel-card-header' }, [
              el('h2', { className: 'panel-title', text: 'Comprobante Impreso' }),
              el('span', { className: 'small font-monospace text-muted', text: `CID: ${correlationId.slice(0, 8)}...` })
            ]),
            receiptZone.childNodes.length > 0
              ? receiptZone
              : el('p', {
                  className: 'small text-muted mb-0',
                  text: 'Emita o imprima un vale para visualizar aqui el comprobante valorizado listo para canjear en casino.'
                })
          ]),
          el('section', { className: 'panel-card' }, [
            el('div', { className: 'panel-card-header' }, [
              el('h2', { className: 'panel-title', text: 'Avisos Semanales de Vales (CU9)' })
            ]),
            noticesContainer
          ])
        ]),
        el('div', { className: 'col-12' }, [
          el('section', { className: 'panel-card' }, [
            el('div', { className: 'panel-card-header' }, [
              el('h2', { className: 'panel-title', text: 'Mis Vales Recientes' })
            ]),
            el('div', { className: 'table-responsive' }, [
              el('table', { className: 'table table-sm table-hover align-middle mb-0' }, [
                el('thead', { className: 'table-light' }, [
                  el('tr', {}, [
                    el('th', { text: 'N° Vale' }),
                    el('th', { text: 'Servicio' }),
                    el('th', { text: 'Sucursal' }),
                    el('th', { text: 'Valor' }),
                    el('th', { text: 'Estado' }),
                    el('th', { text: 'Fecha Emision/Impresion' })
                  ])
                ]),
                historyBody
              ])
            ])
          ])
        ])
      ]);

      contentWrap.appendChild(mainGrid);
    } catch (err) {
      renderError(contentWrap, err, loadDashboard);
    }
  }

  loadDashboard();
}
