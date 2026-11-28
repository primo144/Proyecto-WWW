# Evidencia ejecutable — Unidad 2

La prueba de integración ejecutable es `npm run test:oracle`; su runbook [`../../../tests/oracle/run-entrega2-tests.ps1`](../../../tests/oracle/run-entrega2-tests.ps1) restaura Oracle con datos ficticios y habilita un reloj controlado para el recorrido normal de emisión a las 21:00 de Santiago (turno 2). La corrida incluye API, Oracle, autenticación, permisos, GraphQL, creación de datos, emisión, canje, pagos, procedimiento almacenado y mensajes negativos.

## Corridas conservadas

| Corrida | Resultado | Archivo |
| --- | --- | --- |
| `RUN_UNIT2_2026-11-28T03-05-06-867Z` | 22 aprobadas, 0 fallidas; Oracle API, rotación de refresh y administración desde SPA | [`summary.json`](RUN_UNIT2_2026-11-28T03-05-06-867Z/summary.json) |
| `RUN_UNIT2_2026-11-28T02-49-46-852Z` | 21 aprobadas, 0 fallidas; API Oracle y administración desde SPA headless, deps npm audit limpias | [`summary.json`](RUN_UNIT2_2026-11-28T02-49-46-852Z/summary.json) |
| `RUN_UNIT2_2026-11-28T02-47-13-889Z` | 21 aprobadas, 0 fallidas; API Oracle y administración desde SPA headless | [`summary.json`](RUN_UNIT2_2026-11-28T02-47-13-889Z/summary.json) |
| `RUN_UNIT2_2026-11-28T02-38-38-776Z` | 21 aprobadas, 0 fallidas; API Oracle y administración desde SPA en Edge headless | [`summary.json`](RUN_UNIT2_2026-11-28T02-38-38-776Z/summary.json) |
| `RUN_UNIT2_2026-11-28T02-28-46-225Z` | 21 aprobadas, 0 fallidas; imagen y seeds finales, reloj de prueba controlado | [`summary.json`](RUN_UNIT2_2026-11-28T02-28-46-225Z/summary.json) |
| `RUN_UNIT2_2026-11-28T02-26-16-599Z` | 21 aprobadas, 0 fallidas; asignación de turnos determinista y reloj controlado | [`summary.json`](RUN_UNIT2_2026-11-28T02-26-16-599Z/summary.json) |
| `RUN_UNIT2_2026-11-28T02-21-11-357Z` | 21 aprobadas, 0 fallidas | [`summary.json`](RUN_UNIT2_2026-11-28T02-21-11-357Z/summary.json) |
| `RUN_UNIT2_2026-11-28T02-16-20-922Z` | Corrida inicial de depuración: 15 aprobadas; el rechazo FUERA_DE_HORARIO llevó a alinear seed y reloj de prueba | [`summary.json`](RUN_UNIT2_2026-11-28T02-16-20-922Z/summary.json) |

Cada summary registra fecha UTC, resultado HTTP, latencia observada y `X-Correlation-ID`; no escribe tokens, contraseñas ni datos personales reales. Las cuentas y productos usados son ficticios. La corrida controlada valida lógica y contratos locales, no concurrencia/p95 de producción ni interoperabilidad SMTP real.

La ruta de administrador también se probó en navegador Edge headless contra el frontend servido por Nginx: [`ui-admin-report.json`](ui-admin-report.json) enlaza las dos capturas de creación de producto y funcionario con respuestas `201` y cero errores JS observados. Es evidencia de UI automatizada/emulada, no de hardware físico.
