const form = document.querySelector('#identity-form');
const codeInput = document.querySelector('#employee-code');
const scenarioSelect = document.querySelector('#scenario-select');
const feedback = document.querySelector('#feedback');
const servicesSection = document.querySelector('#services-section');
const servicesList = document.querySelector('#services-list');
const serviceCount = document.querySelector('#service-count');
const receiptContent = document.querySelector('#receipt-content');
const receiptActions = document.querySelector('#receipt-actions');
const printButton = document.querySelector('#print-button');
const correlationStatus = document.querySelector('#correlation-id');

let employee = null;
let lastVoucher = null;

function makeCorrelationId() {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `demo-${Date.now()}`;
}

function element(tag, { className, text, attributes = {} } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  for (const child of children) node.appendChild(child);
  return node;
}

function setLoading(isLoading, message = '') {
  form.querySelector('button[type="submit"]').disabled = isLoading;
  form.classList.toggle('is-loading', isLoading);
  feedback.replaceChildren();
  if (message) feedback.appendChild(element('div', { className: 'alert alert-info', text: message, attributes: { role: 'status' } }));
}

async function callApi(path, options = {}) {
  const correlationId = makeCorrelationId();
  correlationStatus.textContent = `CID: ${correlationId}`;
  const response = await fetch(path, {
    ...options,
    headers: { Accept: 'application/json', 'X-Correlation-ID': correlationId, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  const payload = await response.json();
  correlationStatus.textContent = `CID: ${payload.correlationId || correlationId}`;
  if (!response.ok) {
    const error = new Error(payload.error?.message || `Error HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload.error?.code || 'API_ERROR';
    throw error;
  }
  return payload;
}

function showError(error) {
  feedback.replaceChildren(element('div', { className: 'alert alert-danger', text: `${error.message} (${error.code || 'ERROR'})`, attributes: { role: 'alert' } }));
  const retry = element('button', { className: 'btn btn-sm btn-outline-danger mt-2', text: 'Reintentar consulta', attributes: { type: 'button' } });
  retry.addEventListener('click', loadServices);
  feedback.firstElementChild.appendChild(retry);
}

function renderVoucher(voucher) {
  receiptContent.className = '';
  receiptContent.replaceChildren(
    element('article', { className: 'voucher-receipt', attributes: { 'aria-label': 'Comprobante del vale emitido' } }, [
      element('h3', { text: 'VALE DE ALIMENTACIÓN' }),
      element('p', { className: 'receipt-label', text: 'LIBROS IMPRESOS S.A. · COMPROBANTE DEMOSTRATIVO' }),
      element('div', { className: 'receipt-row' }, [element('span', { text: 'N.º vale' }), element('span', { className: 'receipt-value', text: voucher.numeroVale })]),
      element('div', { className: 'receipt-row' }, [element('span', { text: 'Funcionario' }), element('span', { className: 'receipt-value', text: voucher.codigoFuncionario })]),
      element('div', { className: 'receipt-row' }, [element('span', { text: 'Servicio' }), element('span', { className: 'receipt-value', text: voucher.servicioNombre })]),
      element('div', { className: 'receipt-row' }, [element('span', { text: 'Horario' }), element('span', { className: 'receipt-value', text: voucher.horario })]),
      element('div', { className: 'receipt-row' }, [element('span', { text: 'Valor' }), element('span', { className: 'receipt-value', text: new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(voucher.valorClp) })]),
      element('div', { className: 'receipt-state', text: 'EMITIDO · SOLO PARA DEMOSTRACIÓN' })
    ])
  );
  receiptActions.hidden = false;
}

function renderServices(services) {
  servicesSection.hidden = false;
  servicesList.replaceChildren();
  serviceCount.textContent = `${services.length} ${services.length === 1 ? 'opción' : 'opciones'}`;

  if (services.length === 0) {
    servicesList.appendChild(element('div', { className: 'empty-state', text: '', attributes: { role: 'status' } }, [
      element('strong', { text: 'No hay servicios disponibles' }),
      element('span', { text: 'No encontramos opciones en este escenario. Cambia la respuesta simulada y vuelve a consultar.' })
    ]));
    return;
  }

  const columns = services.map((service) => {
    const button = element('button', { className: 'btn btn-sm btn-outline-primary', text: 'Emitir este vale', attributes: { type: 'button' } });
    button.addEventListener('click', () => issueVoucher(service, button));
    return element('div', { className: 'col-12 col-md-6 col-xl-4 service-column' }, [
      element('article', { className: `service-card${service.disponibleAhora ? ' is-active' : ''}` }, [
        element('div', {}, [
          element('div', { className: 'service-top' }, [
            element('h3', { className: 'service-title', text: service.nombre }),
            element('span', { className: `availability${service.disponibleAhora ? '' : ' is-later'}`, text: service.disponibleAhora ? 'EN HORARIO' : 'PRÓXIMAMENTE' })
          ]),
          element('span', { className: 'service-code', text: service.codigo }),
          element('p', { className: 'service-window', text: `Horario de uso: ${service.inicio} a ${service.fin}` })
        ]),
        element('div', { className: 'service-bottom' }, [
          element('span', { className: 'service-price', text: new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(service.valorClp) })
        ]),
        button
      ])
    ]);
  });
  servicesList.append(...columns);
}

async function loadServices() {
  if (!employee) {
    form.requestSubmit();
    return;
  }
  setLoading(true, 'Consultando los servicios disponibles…');
  servicesList.replaceChildren();
  try {
    const payload = await callApi(`/api/demo/services?scenario=${encodeURIComponent(scenarioSelect.value)}`);
    feedback.replaceChildren();
    renderServices(payload.services);
  } catch (error) {
    servicesSection.hidden = true;
    showError(error);
  } finally {
    form.querySelector('button[type="submit"]').disabled = false;
    form.classList.remove('is-loading');
  }
}

async function issueVoucher(service, button) {
  button.disabled = true;
  button.textContent = 'Emitiendo…';
  try {
    const payload = await callApi('/api/demo/vouchers', {
      method: 'POST',
      body: JSON.stringify({ codigoFuncionario: employee.codigoFuncionario, servicioCodigo: service.codigo })
    });
    lastVoucher = payload.voucher;
    renderVoucher(lastVoucher);
    feedback.replaceChildren(element('div', { className: 'alert alert-success', text: `Vale ${lastVoucher.numeroVale} emitido en la demostración.`, attributes: { role: 'status' } }));
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
    button.textContent = 'Emitir este vale';
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  employee = null;
  servicesSection.hidden = true;
  receiptContent.replaceChildren(element('span', { className: 'placeholder-icon', text: '▤', attributes: { 'aria-hidden': 'true' } }), element('p', { text: 'Tu comprobante aparecerá aquí después de emitir el vale.' }));
  receiptContent.className = 'receipt-placeholder';
  receiptActions.hidden = true;
  setLoading(true, 'Verificando el identificador de demostración…');
  try {
    const payload = await callApi('/api/demo/session', { method: 'POST', body: JSON.stringify({ codigoFuncionario: codeInput.value }) });
    employee = payload.user;
    feedback.replaceChildren(element('div', { className: 'alert alert-success', text: `Sesión de demostración iniciada como ${employee.codigoFuncionario} · ${employee.perfil}.`, attributes: { role: 'status' } }));
    const result = await callApi(`/api/demo/services?scenario=${encodeURIComponent(scenarioSelect.value)}`);
    renderServices(result.services);
  } catch (error) {
    showError(error);
  } finally {
    form.querySelector('button[type="submit"]').disabled = false;
    form.classList.remove('is-loading');
  }
});

scenarioSelect.addEventListener('change', () => {
  if (employee) loadServices();
});
printButton.addEventListener('click', () => { if (lastVoucher) window.print(); });

callApi('/api/demo/health').catch(() => {
  document.querySelector('.api-status').textContent = 'API simulada sin conexión';
  document.querySelector('.status-dot').style.background = '#e46a6a';
});
