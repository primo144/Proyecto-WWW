/**
 * Helpers de construccion segura del DOM (createElement + textContent, sin innerHTML con datos remotos).
 */
export function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.id) node.id = options.id;
  if (options.type) node.type = options.type;
  if (options.value !== undefined) node.value = String(options.value);
  if (options.placeholder) node.placeholder = options.placeholder;
  if (options.name) node.name = options.name;
  if (options.disabled) node.disabled = Boolean(options.disabled);
  if (options.required) node.required = Boolean(options.required);
  if (options.min !== undefined) node.min = String(options.min);
  if (options.max !== undefined) node.max = String(options.max);
  if (options.text !== undefined) node.textContent = String(options.text);

  if (options.attrs) {
    for (const [k, v] of Object.entries(options.attrs)) {
      node.setAttribute(k, String(v));
    }
  }
  if (options.onClick) {
    node.addEventListener('click', options.onClick);
  }

  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      node.appendChild(document.createTextNode(String(child)));
    } else {
      node.appendChild(child);
    }
  }
  return node;
}

export function clearNode(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

export function formatClp(amount) {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0
  }).format(Number(amount || 0));
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    dateStyle: 'short',
    timeStyle: 'short'
  });
}

export function statusBadge(status) {
  const map = {
    EMITIDO: 'bg-info text-dark',
    IMPRESO: 'bg-primary',
    CANJEADO: 'bg-success',
    ANULADO: 'bg-secondary',
    ENVIADO_SANDBOX: 'bg-success',
    PENDIENTE: 'bg-warning text-dark',
    ERROR: 'bg-danger'
  };
  const cls = map[status] || 'bg-secondary';
  return el('span', { className: `badge ${cls}`, text: status });
}

export function renderLoading(container, message = 'Cargando informacion desde servicios...') {
  clearNode(container);
  container.appendChild(
    el('div', { className: 'state-panel' }, [
      el('div', { className: 'spinner-border text-primary', attrs: { role: 'status', 'aria-hidden': 'true' } }),
      el('p', { className: 'mb-0 fw-semibold', text: message })
    ])
  );
}

export function renderEmpty(container, title, subtitle) {
  clearNode(container);
  container.appendChild(
    el('div', { className: 'state-panel' }, [
      el('h3', { className: 'h6 mb-1 fw-bold text-secondary', text: title }),
      el('p', { className: 'mb-0 text-muted small', text: subtitle })
    ])
  );
}

export function renderError(container, error, retryFn = null) {
  clearNode(container);
  const children = [
    el('h3', { className: 'h6 mb-1 fw-bold', text: `Error (${error.code || 'ERROR'})` }),
    el('p', { className: 'mb-1', text: error.message || 'Ocurrio un problema al consultar el servicio.' })
  ];
  if (error.correlationId) {
    children.push(el('div', { className: 'small font-monospace', text: `X-Correlation-ID: ${error.correlationId}` }));
  }
  if (typeof retryFn === 'function') {
    children.push(
      el('button', {
        type: 'button',
        className: 'btn btn-outline-danger btn-sm mt-2',
        text: 'Reintentar operacion',
        onClick: retryFn
      })
    );
  }
  container.appendChild(el('div', { className: 'state-panel state-error' }, children));
}

export function showToast(message, variant = 'success') {
  const stack = document.querySelector('#toast-container');
  if (!stack) return;
  const toast = el('div', {
    className: `app-toast toast-${variant}`,
    text: message
  });
  stack.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4500);
}

export function renderVoucherReceipt(voucher, elapsedMs = null, correlationId = null) {
  const rows = [
    ['Numero de Vale', voucher.numeroVale],
    ['Estado', voucher.estado],
    ['Beneficiario', voucher.nombreBeneficiario],
    ['Perfil', voucher.perfilCodigo],
    ['Servicio', `${voucher.servicioNombre} (${voucher.servicioCodigo})`],
    ['Tipo de Vale', voucher.tipoVale],
    ['Turno / Ventana', `Turno ${voucher.numeroTurno} (${voucher.horaInicioPermitida} - ${voucher.horaFinPermitida})`],
    ['Fecha Vigencia', String(voucher.fechaVigencia).slice(0, 10)],
    ['Sucursal Emision', voucher.sucursalEmisionCodigo],
    ['Valorizacion', formatClp(voucher.valorClp)],
    ['Impreso En', formatDateTime(voucher.impresoEn)]
  ];

  if (voucher.motivoAdicional) {
    rows.push(['Motivo Adicional', voucher.motivoAdicional]);
  }
  if (elapsedMs !== null) {
    rows.push(['Tiempo Emision (RF2)', `${elapsedMs} ms`]);
  }
  if (correlationId) {
    rows.push(['Trazabilidad CID', correlationId]);
  }

  return el('div', { className: 'voucher-receipt' }, [
    el('div', { className: 'voucher-receipt-header' }, [
      el('div', {}, [
        el('strong', { className: 'd-block', text: 'LIBROS IMPRESOS S.A.' }),
        el('span', { className: 'small text-muted', text: 'Comprobante de Vale de Alimentacion' })
      ]),
      statusBadge(voucher.estado)
    ]),
    ...rows.map(([label, val]) =>
      el('div', { className: 'voucher-meta-row' }, [
        el('span', { className: 'text-muted', text: label }),
        el('strong', { text: val })
      ])
    ),
    el('div', { className: 'd-flex gap-2 justify-content-end mt-3 no-print' }, [
      el('button', {
        type: 'button',
        className: 'btn btn-outline-dark btn-sm',
        text: 'Imprimir Comprobante',
        onClick: () => window.print()
      })
    ])
  ]);
}
