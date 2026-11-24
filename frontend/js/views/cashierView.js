import { apiRequest } from '../api.js';
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

export function renderCashierView(root) {
  clearNode(root);

  let selectedVoucher = null;
  let products = [];
  let casinos = [];
  const cart = new Map(); // productoId -> { product, cantidad }

  const casinoSelect = el('select', { id: 'cashier-casino-select', className: 'form-select form-select-sm' });
  const voucherInput = el('input', {
    id: 'cashier-voucher-input',
    type: 'text',
    className: 'form-control',
    placeholder: 'Ej: VAL-20261124-XXXXXX'
  });
  const voucherDetailZone = el('div', { className: 'mt-3' });
  const productsZone = el('div');
  const cartZone = el('div');
  const redeemFeedback = el('div', { className: 'mt-3' });

  const paymentMethodSelect = el('select', { id: 'cashier-payment-method', className: 'form-select form-select-sm' }, [
    el('option', { value: 'NO_APLICA', text: 'Sin diferencia (cubierto 100% por el vale)' }),
    el('option', { value: 'EFECTIVO', text: 'Efectivo' }),
    el('option', { value: 'TARJETA_DEBITO', text: 'Tarjeta Debito' }),
    el('option', { value: 'TARJETA_CREDITO', text: 'Tarjeta Credito' })
  ]);

  function renderVoucherDetail() {
    clearNode(voucherDetailZone);
    if (!selectedVoucher) {
      voucherDetailZone.appendChild(
        el('p', { className: 'small text-muted mb-0', text: 'Busque un numero de vale emitido/impreso para iniciar el canje.' })
      );
      return;
    }

    voucherDetailZone.appendChild(
      el('div', { className: 'p-3 border rounded bg-light' }, [
        el('div', { className: 'd-flex justify-content-between align-items-center mb-2' }, [
          el('strong', { text: `${selectedVoucher.numeroVale} · ${selectedVoucher.servicioNombre}` }),
          statusBadge(selectedVoucher.estado)
        ]),
        el('div', { className: 'small', text: `Beneficiario: ${selectedVoucher.nombreBeneficiario} (${selectedVoucher.perfilCodigo})` }),
        el('div', { className: 'small fw-bold text-primary mt-1', text: `Monto Autorizado del Vale: ${formatClp(selectedVoucher.valorClp)}` })
      ])
    );
  }

  function renderCart() {
    clearNode(cartZone);
    if (cart.size === 0) {
      renderEmpty(cartZone, 'Canasta vacia', 'Seleccione productos del catalogo del casino para calcular el canje.');
      return;
    }

    let totalConsumo = 0;
    const rows = el('div', { className: 'mb-3' });

    for (const { product, cantidad } of cart.values()) {
      const subtotal = product.precioClp * cantidad;
      totalConsumo += subtotal;

      rows.appendChild(
        el('div', { className: 'cart-item-row' }, [
          el('div', {}, [
            el('div', { className: 'fw-semibold small', text: product.nombre }),
            el('div', { className: 'text-muted small', text: `${formatClp(product.precioClp)} c/u · Subtotal ${formatClp(subtotal)}` })
          ]),
          el('div', { className: 'cart-qty-controls' }, [
            el('button', {
              type: 'button',
              className: 'btn btn-outline-secondary btn-sm',
              text: '-',
              onClick: () => {
                if (cantidad <= 1) cart.delete(product.id);
                else cart.set(product.id, { product, cantidad: cantidad - 1 });
                renderCart();
              }
            }),
            el('span', { className: 'px-2 fw-bold', text: String(cantidad) }),
            el('button', {
              type: 'button',
              className: 'btn btn-outline-secondary btn-sm',
              text: '+',
              onClick: () => {
                cart.set(product.id, { product, cantidad: cantidad + 1 });
                renderCart();
              }
            })
          ])
        ])
      );
    }

    const valorVale = selectedVoucher ? selectedVoucher.valorClp : 0;
    const saldoAFavor = selectedVoucher ? Math.max(0, valorVale - totalConsumo) : 0;
    const diferencia = selectedVoucher ? Math.max(0, totalConsumo - valorVale) : totalConsumo;

    if (diferencia === 0 && selectedVoucher) {
      paymentMethodSelect.value = 'NO_APLICA';
    } else if (diferencia > 0 && paymentMethodSelect.value === 'NO_APLICA') {
      paymentMethodSelect.value = 'EFECTIVO';
    }

    const confirmBtn = el('button', {
      type: 'button',
      className: 'btn btn-success w-100 mt-3',
      text: 'Confirmar Venta y Canjear Vale (CU5)',
      disabled: !selectedVoucher || (selectedVoucher.estado !== 'IMPRESO' && selectedVoucher.tipoVale !== 'VISITA_NO_PERSONALIZADO')
    });

    confirmBtn.addEventListener('click', async () => {
      if (!selectedVoucher) return;
      clearNode(redeemFeedback);
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Liquidando transaccion...';

      try {
        const items = Array.from(cart.values()).map(({ product, cantidad }) => ({
          productoId: product.id,
          cantidad
        }));
        const { data, correlationId } = await apiRequest(
          `/api/v1/orders/vouchers/${encodeURIComponent(selectedVoucher.numeroVale)}/redeem`,
          {
            method: 'POST',
            body: {
              casinoCodigo: casinoSelect.value,
              items,
              metodoPagoDiferencia: paymentMethodSelect.value
            }
          }
        );

        selectedVoucher = data.voucher;
        cart.clear();
        renderVoucherDetail();
        renderCart();
        showToast(`Vale ${data.voucher.numeroVale} canjeado exitosamente`, 'success');

        const tx = data.paymentTransaction;
        redeemFeedback.appendChild(
          el('div', { className: 'alert alert-success mb-0' }, [
            el('strong', { className: 'd-block', text: `Canje registrado y liquidado (${tx.estado})` }),
            el('div', { className: 'small', text: `Total Consumo: ${formatClp(tx.totalConsumoClp)} · Cubierto por Vale: ${formatClp(tx.montoCubiertoValeClp)}` }),
            el('div', { className: 'small', text: `Saldo a favor no usado: ${formatClp(tx.saldoAFavorClp)} · Diferencia pagada: ${formatClp(tx.diferenciaPagadaClp)} (${tx.metodoPagoDiferencia})` }),
            el('div', { className: 'small font-monospace mt-1', text: `Tx: ${tx.id} · CID: ${correlationId}` })
          ])
        );
      } catch (err) {
        renderError(redeemFeedback, err);
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirmar Venta y Canjear Vale (CU5)';
      }
    });

    cartZone.appendChild(rows);
    cartZone.appendChild(
      el('div', { className: 'p-3 bg-light border rounded' }, [
        el('div', { className: 'd-flex justify-content-between small', text: '' }, [
          el('span', { text: 'Total Consumo:' }),
          el('strong', { text: formatClp(totalConsumo) })
        ]),
        el('div', { className: 'd-flex justify-content-between small mt-1' }, [
          el('span', { text: 'Cobertura del Vale:' }),
          el('strong', { text: formatClp(valorVale) })
        ]),
        el('div', { className: 'd-flex justify-content-between small mt-1 text-success' }, [
          el('span', { text: 'Saldo a Favor del Vale:' }),
          el('strong', { text: formatClp(saldoAFavor) })
        ]),
        el('div', { className: 'd-flex justify-content-between small mt-1 text-danger' }, [
          el('span', { text: 'Diferencia a Pagar por Funcionario:' }),
          el('strong', { text: formatClp(diferencia) })
        ]),
        el('div', { className: 'mt-2' }, [
          el('label', { className: 'form-label small fw-semibold mb-1', attrs: { for: 'cashier-payment-method' }, text: 'Metodo de pago de diferencia' }),
          paymentMethodSelect
        ]),
        confirmBtn
      ])
    );
  }

  async function searchVoucher(event) {
    if (event) event.preventDefault();
    const num = voucherInput.value.trim().toUpperCase();
    if (!num) return;
    clearNode(redeemFeedback);
    try {
      const { data } = await apiRequest(`/api/v1/orders/vouchers/by-number/${encodeURIComponent(num)}`);
      selectedVoucher = data.voucher;
      renderVoucherDetail();
      renderCart();
    } catch (err) {
      selectedVoucher = null;
      renderVoucherDetail();
      renderError(redeemFeedback, err);
    }
  }

  async function initCashierData() {
    renderLoading(productsZone, 'Cargando casinos y productos desde backend...');
    try {
      const [branchesRes, productsRes] = await Promise.all([
        apiRequest('/api/v1/clients/branches'),
        apiRequest('/api/v1/inventory/products?available=true')
      ]);

      casinos = [];
      clearNode(casinoSelect);
      for (const b of branchesRes.data.branches || []) {
        for (const c of b.casinos || []) {
          casinos.push(c);
          casinoSelect.appendChild(el('option', { value: c.codigo, text: `${c.nombre} (${b.nombre})` }));
        }
      }

      products = productsRes.data.products || [];
      if (products.length === 0) {
        renderEmpty(productsZone, 'Sin productos disponibles', 'No existen productos activos en inventory.');
        return;
      }

      clearNode(productsZone);
      const grid = el('div', { className: 'row g-3' });
      for (const p of products) {
        grid.appendChild(
          el('div', { className: 'col-12 col-sm-6 col-xl-4' }, [
            el('div', { className: 'product-card' }, [
              el('div', {}, [
                el('span', { className: 'badge bg-light text-dark border', text: p.categoria }),
                el('h3', { className: 'h6 fw-bold mt-2 mb-1', text: p.nombre }),
                el('div', { className: 'small text-muted', text: p.codigo })
              ]),
              el('div', { className: 'product-card-footer' }, [
                el('strong', { className: 'text-primary', text: formatClp(p.precioClp) }),
                el('button', {
                  type: 'button',
                  className: 'btn btn-outline-primary btn-sm',
                  text: 'Agregar',
                  onClick: () => {
                    const existing = cart.get(p.id);
                    cart.set(p.id, { product: p, cantidad: (existing?.cantidad || 0) + 1 });
                    renderCart();
                  }
                })
              ])
            ])
          ])
        );
      }
      productsZone.appendChild(grid);
    } catch (err) {
      renderError(productsZone, err, initCashierData);
    }
  }

  const searchForm = el('form', { className: 'd-flex gap-2' }, [
    voucherInput,
    el('button', { type: 'submit', className: 'btn btn-primary', text: 'Buscar' })
  ]);
  searchForm.addEventListener('submit', searchVoucher);

  const layout = el('div', { className: 'row g-4' }, [
    el('div', { className: 'col-12 col-lg-7' }, [
      el('section', { className: 'panel-card' }, [
        el('div', { className: 'panel-card-header' }, [
          el('h2', { className: 'panel-title', text: 'Catalogo de Productos del Casino' }),
          el('div', { className: 'd-flex align-items-center gap-2' }, [
            el('label', { className: 'small fw-semibold mb-0', attrs: { for: 'cashier-casino-select' }, text: 'Casino:' }),
            casinoSelect
          ])
        ]),
        productsZone
      ])
    ]),
    el('div', { className: 'col-12 col-lg-5' }, [
      el('section', { className: 'panel-card' }, [
        el('div', { className: 'panel-card-header' }, [
          el('h2', { className: 'panel-title', text: 'Validar Vale y Canjear (CU5)' })
        ]),
        el('div', { className: 'mb-2' }, [
          el('label', { className: 'form-label small fw-semibold', attrs: { for: 'cashier-voucher-input' }, text: 'Numero de Vale' }),
          searchForm
        ]),
        voucherDetailZone,
        el('hr'),
        el('h3', { className: 'h6 fw-bold mb-2', text: 'Detalle de Consumo' }),
        cartZone,
        redeemFeedback
      ])
    ])
  ]);

  root.appendChild(layout);
  renderVoucherDetail();
  renderCart();
  initCashierData();
}
