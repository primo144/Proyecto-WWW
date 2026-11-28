# Paquete de evidencias — Unidad 3

## Runs finales reproducibles

| Run | Emisión del vale | Caja/canje | Viewports clave | Resultado |
| --- | --- | --- | --- | --- |
| `RUN13` | SPA en 375×812 | SPA en 1440×900 | Los cuatro tamaños | 10 aprobadas, 0 fallidas · [summary](RUN13/summary.json) |
| `RUN14` | SPA en 1440×900 | SPA en 375×812 | Los cuatro tamaños | 10 aprobadas, 0 fallidas · [summary](RUN14/summary.json) |

Cada iteración del runbook [`../../../tests/oracle/run-entrega3-cycle.ps1`](../../../tests/oracle/run-entrega3-cycle.ps1) limpia Oracle, inicia Orders y GraphQL con el test clock de 21:00 America/Santiago y ejecuta desde Chrome headless. Ambas repiten los mismos criterios con la orientación de viewport de emisión/canje intercambiada. Las capturas `totem-<width>x<height>.png` se guardan por run; `cashier-*` y `employee-extra-print-*` muestran los flujos en los tamaños asignados.

## Criterios comprobados en los dos runs

1. Gateway disponible y petición anónima a órdenes rechazada.
2. `SEC001` emite dos vales para beneficiarios distintos en CENTRAL/NORTE; repetición idempotente del mismo beneficiario bloqueada.
3. Emisión fuera del turno contestada `422 FUERA_DE_HORARIO`.
4. Resumen GraphQL del titular y ausencia de desbordamiento horizontal en 375×812, 768×1024, 1024×768 y 1440×900.
5. Vale CENA1 emitido desde el Tótem, lectura posterior de Oracle y `window.print()`/CSS de impresión verificados.
6. Vale duplicado `409`, acceso IDOR `403` y auditoría sin rol admin `403`.
7. Caja completa canje con precios de Inventory y muestra error recuperable ante la caída controlada de `payments-service`; REST responde 504, GraphQL devuelve `partialErrors` y `ORDERS` conserva `IMPRESO`.
8. Tras recuperar Payments, el mismo carrito se confirma; Oracle mantiene un solo pago `LIQUIDADO` y vale `CANJEADO`.
9. Administración crea un vale adicional desde la SPA y el beneficiario de ese folio lo imprime desde el Tótem.
10. Administración vuelve al panel, sin errores JavaScript no manejados.

La matriz de requisitos completa está en [`../../TRAZABILIDAD_UNIDAD_3.csv`](../../TRAZABILIDAD_UNIDAD_3.csv); el informe describe el alcance y calcula métricas a partir de RUN13/RUN14, no de capturas de corridas distintas.

## Corridas de diagnóstico conservadas

- `RUN01`: el contrato GraphQL del Tótem faltaba el campo `canjeadoEn`; se corrigió el DTO y aparece en RUN13/RUN14.
- `RUN02`: el runner buscaba un rol ARIA `alert`; el panel presentaba correctamente `.state-error`. Se corrigió el selector del test y se conservó `failure-state.png`.
- `RUN07`: el vale adicional quedó a nombre de `SEC001`, que el formulario preseleccionaba; el runner esperaba imprimirlo como `EMP001`. La prueba ahora usa el beneficiario real de la respuesta. Se guardó la captura del estado, pero no un summary completo porque el primer runner se interrumpió antes de serializarlo.
- `RUN03`–`RUN12`: corridas de implementación exploratorias que preceden a la versión final de diez criterios; se mantienen para trazabilidad pero se excluyen del denominador final.

Chrome headless y los viewports son emulación de navegador, no pruebas en un teléfono/tablet físico ni en un tótem con impresora. Tokens, contraseñas y datos personales reales no se guardan en este paquete.
