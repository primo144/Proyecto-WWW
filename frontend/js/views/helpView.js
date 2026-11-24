import { clearNode, el } from '../ui.js';

export function renderHelpView(root) {
  clearNode(root);

  const cards = [
    [
      '1. Turnos y Ventanas Horarias (24/7)',
      'Turno 1 (08:00-16:00): Desayuno (08:00-12:00) y Almuerzo (11:30-16:00). Turno 2 (16:00-24:00): Once (16:00-20:00) y Cena 1 (20:00-24:00). Turno 3 (00:00-08:00): Cena 2 (00:00-04:00) y Desayuno (04:00-08:00).'
    ],
    [
      '2. Regla Anti-Duplicados y Multi-Vale',
      'Los funcionarios normales pueden emitir 1 vale por servicio y horario. Las secretarias de gerencia (perfil multi-vale) pueden emitir multiples vales para visitas dentro del limite configurado.'
    ],
    [
      '3. Canje en Casino y Diferencias (CU5)',
      'El cajero ingresa el N° de vale y los productos entregados. Si el consumo es menor al valor del vale, queda saldo a favor; si excede, el funcionario paga la diferencia (efectivo o tarjeta).'
    ],
    [
      '4. Operacion Multi-Sucursal en Linea',
      'Todos los vales emitidos en Casa Central o Sucursal Norte se validan en tiempo real contra el API Gateway y PostgreSQL, asegurando consistencia cuando un trabajador opera temporalmente en otra imprenta.'
    ]
  ];

  root.appendChild(
    el('section', { className: 'panel-card' }, [
      el('div', { className: 'panel-card-header' }, [
        el('h2', { className: 'panel-title', text: 'Ayuda en Linea y Manual Operativo (RNF12 / RNF14)' })
      ]),
      el(
        'div',
        { className: 'row g-3' },
        cards.map(([title, body]) =>
          el('div', { className: 'col-12 col-md-6' }, [
            el('div', { className: 'p-3 border rounded bg-light h-100' }, [
              el('h3', { className: 'h6 fw-bold text-primary', text: title }),
              el('p', { className: 'small mb-0 text-muted', text: body })
            ])
          ])
        )
      )
    ])
  );
}
