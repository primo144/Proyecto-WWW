import { apiRequest } from '../api.js';
import { loginWithCredentials } from '../auth.js';
import { clearNode, el, formatClp, renderEmpty, renderError, renderLoading, showToast } from '../ui.js';

export function renderLoginView(root, onAuthenticated) {
  clearNode(root);

  const loginFeedback = el('div', { className: 'mt-3' });
  const codeInput = el('input', {
    id: 'login-code',
    name: 'codigoFuncionario',
    type: 'text',
    className: 'form-control',
    placeholder: 'Ej: EMP001, CAJ001, ADM001',
    required: true
  });
  const passwordInput = el('input', {
    id: 'login-password',
    name: 'password',
    type: 'password',
    className: 'form-control',
    placeholder: 'Ingrese su contrasena',
    required: true
  });
  const submitBtn = el('button', {
    type: 'submit',
    className: 'btn btn-primary w-100',
    text: 'Iniciar Sesion'
  });

  const form = el('form', { className: 'mt-2' }, [
    el('div', { className: 'mb-3' }, [
      el('label', { className: 'form-label fw-semibold', attrs: { for: 'login-code' }, text: 'Codigo de Funcionario' }),
      codeInput
    ]),
    el('div', { className: 'mb-3' }, [
      el('label', { className: 'form-label fw-semibold', attrs: { for: 'login-password' }, text: 'Contrasena' }),
      passwordInput
    ]),
    submitBtn,
    loginFeedback
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearNode(loginFeedback);
    submitBtn.disabled = true;
    submitBtn.textContent = 'Validando credenciales...';
    try {
      const { user } = await loginWithCredentials(codeInput.value.trim(), passwordInput.value);
      showToast(`Bienvenido ${user.codigoFuncionario} (${user.role})`, 'success');
      onAuthenticated(user);
    } catch (err) {
      renderError(loginFeedback, err);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Iniciar Sesion';
    }
  });

  const catalogBody = el('div', { id: 'public-catalog-container' });
  const onlyAvailableCheck = el('input', {
    type: 'checkbox',
    id: 'filter-available',
    className: 'form-check-input'
  });
  onlyAvailableCheck.checked = true;

  async function loadPublicCatalog() {
    renderLoading(catalogBody, 'Cargando catalogo del casino desde backend...');
    try {
      const query = onlyAvailableCheck.checked ? '?available=true' : '';
      const { data } = await apiRequest(`/api/v1/public/products${query}`, { anonymous: true });
      const products = data?.products || [];
      if (products.length === 0) {
        renderEmpty(catalogBody, 'Sin productos disponibles', 'No hay productos registrados para el filtro seleccionado.');
        return;
      }
      clearNode(catalogBody);
      const grid = el('div', { className: 'row g-3' });
      for (const p of products) {
        grid.appendChild(
          el('div', { className: 'col-12 col-sm-6 col-xl-4' }, [
            el('div', { className: 'product-card' }, [
              el('div', {}, [
                el('div', { className: 'd-flex justify-content-between align-items-start gap-2' }, [
                  el('span', { className: 'badge bg-light text-dark border', text: p.categoria }),
                  el('span', {
                    className: `badge ${p.disponible ? 'bg-success' : 'bg-secondary'}`,
                    text: p.disponible ? 'Disponible' : 'Agotado'
                  })
                ]),
                el('h3', { className: 'h6 fw-bold mt-2 mb-1', text: p.nombre }),
                el('div', { className: 'small text-muted', text: `Codigo: ${p.codigo}` })
              ]),
              el('div', { className: 'product-card-footer' }, [
                el('span', { className: 'small text-muted', text: 'Valor referencia' }),
                el('strong', { className: 'text-primary', text: formatClp(p.precioClp) })
              ])
            ])
          ])
        );
      }
      catalogBody.appendChild(grid);
    } catch (err) {
      renderError(catalogBody, err, loadPublicCatalog);
    }
  }

  onlyAvailableCheck.addEventListener('change', loadPublicCatalog);

  const layout = el('div', { className: 'row g-4' }, [
    el('div', { className: 'col-12 col-lg-5' }, [
      el('section', { className: 'panel-card' }, [
        el('div', { className: 'panel-card-header' }, [
          el('h2', { className: 'panel-title', text: 'Ingreso al Sistema (CU1)' }),
          el('span', { className: 'badge bg-secondary', text: 'JWT + Bcrypt' })
        ]),
        el('p', {
          className: 'small text-muted',
          text: 'Autentiquese con su codigo de funcionario para emitir vales en totem, registrar canjes en casino o administrar el sistema.'
        }),
        form,
        el('div', { className: 'mt-4 p-3 bg-light border rounded small' }, [
          el('strong', { className: 'd-block mb-1', text: 'Cuentas de prueba configurables (ver README.md):' }),
          el('ul', { className: 'mb-0 ps-3' }, [
            el('li', { text: 'EMP001 · Turno 1 (08:00-16:00) · Obrero' }),
            el('li', { text: 'EMP002 · Turno 2 (16:00-24:00) · Administrativo' }),
            el('li', { text: 'EMP003 · Turno 3 (00:00-08:00) · Jefe (Sucursal Norte)' }),
            el('li', { text: 'SEC001 · Turno 1 · Secretaria Multi-vale (Visitas)' }),
            el('li', { text: 'CAJ001 / CAJ002 · Cajero Casino Externo' }),
            el('li', { text: 'ADM001 · Administrador' })
          ])
        ])
      ])
    ]),
    el('div', { className: 'col-12 col-lg-7' }, [
      el('section', { className: 'panel-card' }, [
        el('div', { className: 'panel-card-header' }, [
          el('div', {}, [
            el('h2', { className: 'panel-title', text: 'Catalogo del Casino Externo' }),
            el('span', { className: 'small text-muted', text: 'Consulta publica sin datos personales (GET /api/v1/public/products)' })
          ]),
          el('label', { className: 'form-check form-switch mb-0 d-flex align-items-center gap-2' }, [
            onlyAvailableCheck,
            el('span', { className: 'small fw-semibold', text: 'Solo disponibles' })
          ])
        ]),
        catalogBody
      ])
    ])
  ]);

  root.appendChild(layout);
  loadPublicCatalog();
}
