# Entrega 1 — Prototipo frontend responsivo y dinámico

## Caso, actor y flujo

- **Caso:** Caso 18, Sistema de Emisión y Control de Vales de Alimentación.
- **Actor principal:** funcionario de planta que trabaja por turnos.
- **Objetivo:** obtener el vale de alimentación correspondiente a un servicio habilitado durante su turno.
- **Flujo:** identificarse con un código ficticio → consultar los servicios → seleccionar uno → emitir y visualizar el comprobante imprimible.
- **Requisitos del caso representados:** autenticación inicial como interacción de prototipo, emisión inferior a dos segundos por operación simulada, valorización según perfil y horario, registro de emisión demostrativo.

## Diseño y arquitectura de interfaz

El **artefacto de diseño local equivalente a Figma** está en [`prototipos/entrega-1.html`](prototipos/entrega-1.html); documenta el flujo, la jerarquía y los frames para escritorio, tablet y móvil. El prototipo funcional navegable está en [`../frontend/prototipo-eval1.html`](../frontend/prototipo-eval1.html); permite recorrer el mismo flujo de inicio a fin y verificar escenarios seleccionables. No requiere cuenta de Figma. La macroestructura usa el grid de 12 columnas de Bootstrap; el encabezado, las acciones y los controles de cada tarjeta utilizan Flexbox; `frontend/prototipo/eval1.css` declara `box-sizing`, espacios, bordes y anchos de los componentes.

La página genera tarjetas y comprobantes con `document.createElement`, `querySelector`, `append` y `addEventListener`. Los datos no están incrustados en el HTML.

## API simulada

Se ejecuta con un servidor Node.js mínimo sin dependencias, en [`../frontend/prototipo/server.mjs`](../frontend/prototipo/server.mjs). El adaptador conserva el estado en memoria y lo elimina al detener el proceso; no autentica cuentas, no usa base de datos y no representa vales reales.

| Operación | Contrato simulado | Resultado |
| --- | --- | --- |
| Identificación | `POST /api/demo/session` `{ "codigoFuncionario": "EMP001" }` | `200` con el perfil ficticio; `401` para un código desconocido |
| Consulta | `GET /api/demo/services?scenario=success` | `200` con opciones ficticias y horarios |
| Consulta vacía | `GET /api/demo/services?scenario=empty` | `200` con `services: []` |
| Error recuperable | `GET /api/demo/services?scenario=error` | `503` con código/mensaje orientado al usuario y opción de reintento |
| Acción simulada | `POST /api/demo/vouchers` con código y servicio | `201` con comprobante ficticio; `409` si se repite el mismo servicio |

Cada solicitud propaga o genera `X-Correlation-ID`. El selector visible permite comprobar normal, vacío y error sin editar código.

## Ejecutar

Requiere Node.js 20 o superior. Desde la raíz del repositorio:

```sh
npm run prototype
```

Abre `http://localhost:8081/prototipo-eval1.html`. Detén el servidor con `Ctrl+C`; los datos temporales se descartan.

## Validación responsiva y evidencia

La prueba `npm run test:prototype` automatiza el flujo de consulta y emisión con Edge/Chrome, revisa ausencia de desbordamiento horizontal en `375 × 812`, `768 × 1024`, `1024 × 768` y `1440 × 900`, y genera una captura de página completa por tamaño. Además prueba catálogo vacío, error y reintento y emisión duplicada en móvil. En móvil el encabezado, controles y columnas se apilan; en tablet las tarjetas se presentan en dos columnas; en laptop y escritorio el panel usa dos regiones y el catálogo cambia el número de tarjetas por fila. La impresión oculta el formulario y produce un comprobante centrado.

La carpeta [`evidencias/entrega-1/`](evidencias/entrega-1/README.md) contiene el protocolo de capturas y la tabla para registrar resultado observado. Las capturas todavía deben tomarse en un navegador de escritorio; no se etiquetan como observadas hasta ejecutarlas.

## Archivos relevantes

- `frontend/prototipo-eval1.html`
- `frontend/prototipo/eval1.css`
- `frontend/prototipo/eval1.js`
- `frontend/prototipo/server.mjs`
