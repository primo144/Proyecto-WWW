# Evidencias manuales — Entrega 1

Las siguientes dimensiones corresponden a la rúbrica. `npm run test:prototype` ejecuta el flujo usando Chrome/Edge headless con emulación de viewport y genera las capturas y `responsive-report.json`. La emulación no representa pruebas en dispositivos físicos. No guardes tokens, contraseñas reales ni datos personales.

| Archivo | Viewport | Comprobaciones | Resultado observado |
| --- | --- | --- | --- |
| `viewport-375x812.png` | 375 × 812 | Encabezado/controles apilados, sin desplazamiento horizontal, flujo y estados alternos | PASSED · emulación de navegador |
| `viewport-768x1024.png` | 768 × 1024 | Tarjetas en dos columnas, formularios legibles, sin desbordamiento | PASSED · emulación de navegador |
| `viewport-1024x768.png` | 1024 × 768 | Panel en dos regiones, contenido sin recorte, sin desbordamiento | PASSED · emulación de navegador |
| `viewport-1440x900.png` | 1440 × 900 | Panel y catálogo en tres columnas, comprobante centrado, sin desbordamiento | PASSED · emulación de navegador |

## Escenarios de servicio

- Respuesta normal: consultar, emitir un vale de demostración, recargar y observar que el estado en memoria vive solo durante esa instancia.
- Catálogo vacío: seleccionar `Catálogo vacío` y consultar el mensaje vacío.
- Error: seleccionar `Error recuperable`, observar el `503` y activar `Reintentar consulta`.
- Regla de duplicado: emitir dos veces el mismo servicio para el mismo código y verificar `409 VALE_DUPLICADO`.

El reporte JSON incluye el navegador, su versión, fecha UTC y resultado observado de cada viewport. Completa manualmente cualquier observación adicional del equipo; no infieras compatibilidad con hardware físico a partir de esta emulación.
