# Estado del Proyecto: Lo Realizado y Lo Pendiente

**Proyecto:** Caso 18 — *"Sistema de Emisión y Control de Vales de Alimentación"* (Libros Impresos S.A.)  
**Fecha de corte:** `2026-11-24 11:24 -03:00`  
**Versión actual del código:** `v1.0.3`  
**Directorio raíz:** `/home/vergil/Documentos/USM/www`

---

## Resumen Ejecutivo

El sistema completo (infraestructura Docker aislada, persistencia PostgreSQL 16 en 5 esquemas, 5 microservicios privados + GraphQL Gateway privado + API Gateway público, frontend responsivo conectado por REST/GraphQL, suite automatizada E2E/Seguridad/Resiliencia/Carga y expedientes documentales de Unidades 2 y 3) **está implementado, compilado, levantado en Docker y verificado en vivo**.

Lo único pendiente corresponde a **actividades manuales de UI/navegador** (prototipo Figma, capturas en 4 anchos de viewport), **datos administrativos de entrega** (nombres de integrantes, inicialización/commits Git, rotación de `.env` local) e **integraciones productivas externas** declaradas como limitaciones (`SMTP` real para `RF14` y hardware biométrico/tótem físico).

---

## Parte 1 — Todo lo Hecho y Verificado

### 1.1 Cimientos, Infraestructura y Base de Datos (Misión 1)

- **Ordenamiento de enunciados:** Los 4 PDFs originales se trasladaron sin eliminar ninguno a `docs/enunciados/`:
  - [Caso18.pdf](enunciados/Caso18.pdf)
  - [Rúbrica Evaluación 1.pdf](enunciados/Rúbrica%20Evaluación%201.pdf)
  - [Unidad_2_Backend.pdf](enunciados/Unidad_2_Backend.pdf)
  - [Evaluacion 3 LWWW.pdf](enunciados/Evaluacion%203%20LWWW.pdf)
- **Configuración raíz y secretos simbólicos:** Creados [.gitignore](../.gitignore), [.dockerignore](../.dockerignore), [.env.example](../.env.example) (sin credenciales reales), [tsconfig.base.json](../tsconfig.base.json) y [package.json](../package.json) (monorepo con 10 workspaces).
- **Orquestación con aislamiento de red:** [docker-compose.yml](../docker-compose.yml) separa:
  - `public_net`: solo `frontend` (`3000:80`) y `gateway` (`8080:8080`).
  - `private_net` (`internal: true`): `postgres`, `db-seed`, `db-tools`, `auth-service`, `clients`, `inventory`, `orders`, `payments` y `graphql-gateway`, sin puertos expuestos al host.
- **Esquema PostgreSQL 16 y datos deterministas:**
  - [db/init.sql](../db/init.sql): 5 esquemas aislados (`auth`, `clients`, `inventory`, `orders`, `payments`), restricciones de unicidad (`clave_unicidad`, `vale_id`, `idempotency_key`, `uq_avisos_func_semana`) y el procedimiento almacenado `payments.sp_generar_avisos_semanales(p_inicio, p_fin)`.
  - [db/src/seed.ts](../db/src/seed.ts) y [db/src/reset-db.ts](../db/src/reset-db.ts): seed idempotente con 2 sucursales (`CENTRAL`, `NORTE`), 3 casinos, 6 perfiles (incluyendo `SECRETARIA_GERENCIA` multi-vale y `VISITA`), 7 usuarios de prueba (`EMP001`, `EMP002`, `EMP003`, `SEC001`, `CAJ001`, `CAJ002`, `ADM001`), turnos mensuales, 6 servicios (con solapamiento `11:30–12:00` para RF8), valorizaciones por perfil y 10 productos de casino.

### 1.2 Backend por Microservicios y Seguridad Interna (Misión 2)

- **Biblioteca común `@libros/shared` ([shared/src/](../shared/src/index.ts)):** Logger `pino` con `redact` (enmascara contraseñas, tokens y cabeceras sensibles), `AppError`, `correlationIdMiddleware` (`X-Correlation-ID`), `requireInternalToken` (`timingSafeEqual`), `extractUserContext`, `requireRoles`, `getParam` e `internalFetch` con timeout.
- **`auth-service` (`:4001`, [auth-service/src/app.ts](../auth-service/src/app.ts)):** Login con `bcryptjs` (costo 10) + JWT access/refresh, verificación de sesión activa (`/auth/verify`), renovación (`/auth/refresh`), revocación persistente (`/auth/logout`) y alta administrativa (`/auth/users`).
- **`clients` (`:4002`, [services/clients/src/app.ts](../services/clients/src/app.ts)):** Sucursales/casinos, perfiles multi-vale, ficha propia (`/employees/me`), control anti-IDOR (`/employees/:id`) y asignación mensual de turnos.
- **`inventory` (`:4003`, [services/inventory/src/app.ts](../services/inventory/src/app.ts)):** Catálogo público (`/products`), servicios extensibles (`CU3`/`RF9`), valorizaciones por perfil (`CU4`/`RF3`) y cotización autoritativa interna (`/internal/products/quote`).
- **`orders` (`:4004`, [services/orders/src/app.ts](../services/orders/src/app.ts)):** Emisión/impresión `< 2s` (`CU2`), validación de turno y ventana horaria (`America/Santiago`), prevención atómica de duplicados y límite multi-vale (`RF6`/`RF7`), operación multi-sucursal (`RF11`), vales adicionales/visitas (`CU7`), anulación histórica sin borrado físico, canje en caja (`CU5` con Zod `.strict()`) y reporte de auditoría (`CU6`).
- **`payments` (`:4005`, [services/payments/src/app.ts](../services/payments/src/app.ts)):** Liquidación idempotente (`/transactions/settle`), rendición por casino y ejecución del procedimiento almacenado semanal conectado a [EmailSandboxAdapter](../services/payments/src/emailAdapter.ts).

### 1.3 GraphQL Gateway Privado y API Gateway Público (Misión 3)

- **`graphql-gateway` (`:4006` privado, [graphql-gateway/src/](../graphql-gateway/src/app.ts)):** `graphql-yoga` con `DataLoader` anti-N+1 (`loaders.ts`), reglas `depthLimitRule(4)` y `complexityLimitRule(500)` (`validationRules.ts`), autorización por campo (`Funcionario.rut` y `Funcionario.email`), queries `miResumenComensal`, `detalleVale`, `panelAuditoria` y `catalogoCasino`, y degradación controlada vía `partialErrors` (`GRAPHQL_SUBSYSTEM_TIMEOUT_MS=1500`).
- **`gateway` (`:8080` público, [gateway/src/](../gateway/src/app.ts)):** Único punto público del backend; `SecretProvider`, lista blanca explícita de rutas `S01`–`S39`, `sanitizeIncomingHeaders` (elimina cabeceras internas falsificadas), rate limiting (`authLimiter` / `apiLimiter`), validación JWT contra `auth-service` y manejo controlado de caídas/timeouts (`UPSTREAM_TIMEOUT_MS=4000`).

### 1.4 Frontend Responsivo Integrado (Misión 4 — Evaluación 1)

- **Estructura y estilos ([frontend/index.html](../frontend/index.html), [frontend/css/styles.css](../frontend/css/styles.css)):** HTML5 semántico, Bootstrap 5.3 Grid de 12 columnas, Box Model y Flexbox explícitos, media queries responsivas y `@media print` para comprobante térmico.
- **Módulos JS Vanilla ES Modules ([frontend/js/](../frontend/js/app.js)):** `api.js`, `auth.js`, `ui.js` (construcción DOM segura con `createElement` + `textContent`, estados de carga/vacío/error/recuperación y `X-Correlation-ID`) y 5 vistas integradas al backend real (cero datos dummy, cero secretos en navegador):
  - `loginView.js` (`CU1` + catálogo público)
  - `totemView.js` (`CU2` + GraphQL `miResumenComensal` + impresión de vales adicionales `CU7` + `partialErrors`)
  - `cashierView.js` (`CU5` canje en casino)
  - `adminView.js` (`CU3`, `CU4`, `CU6`, `CU7`, `CU8`, `CU9`)
  - `helpView.js` (ayuda en línea `RNF12`/`RNF14`)
- **Nginx proxy ([frontend/nginx.conf](../frontend/nginx.conf)):** Sirve en `:3000` y proxya `/api/` y `/graphql` hacia `gateway:8080`.

### 1.5 Pruebas Automatizadas, Correcciones y Evidencias Reales (Misión 5)

- **Validación estática y de compilación:**
  - `npm run prisma:validate` y `prisma:generate`: **5/5** esquemas válidos y generados aisladamente.
  - `npm run build`: **9/9** workspaces compilados sin errores (`exit 0`).
  - `npm run typecheck`: **10/10** workspaces sin errores (`exit 0`).
  - `node --check` sobre todos los JS del frontend: `FRONTEND_JS_SYNTAX_OK`.
  - Auditoría: `TODO_COUNT=0`.
- **Ejecución en vivo contra Docker Compose:**
  - Salud `/health`: **6/6** servicios internos `"ok"`; frontend `:3000` y proxy `/api/v1/public/products` responden `HTTP 200`.
  - **`RUN01` y `RUN02` (`P01`–`P11`):** **11/11 aprobadas** en dos ejecuciones independientes tras `reset-db` (`5/5` E2E + `6/6` Seguridad en [RUN01](evidencias/RUN01/) y [RUN02](evidencias/RUN02/)).
  - **`RUN_RESILIENCE` (`P12`):** **1/1 aprobada** con `payments` detenido ([E01_P12](evidencias/RUN_RESILIENCE/E01_P12_caida_controlada_de_payments_y_degradaci.json)): `504 GATEWAY_TIMEOUT` controlado en REST y `200` con `partialErrors` (`payments: UPSTREAM_TIMEOUT`) en GraphQL.
  - **`RUN_LOAD_02` (`autocannon`):** [load_report_2026-11-24T14-09-22-685Z.json](evidencias/load_report_2026-11-24T14-09-22-685Z.json) — Emisión RF2 `8/8` HTTP `201` (`avg = 20 ms`, **`p95 = 26 ms < 2.000 ms`**), Catálogo `150/150` (`p95 = 17 ms`, `0` errores), GraphQL `150/150` (`p95 = 129 ms`, `0` errores).
  - **Incidencias reales detectadas, corregidas y verificadas:** `INC-01` (complejidad GraphQL `141 → 500`), `INC-02` (ambigüedad `ON CONFLICT` en `sp_generar_avisos_semanales`), `INC-03` (ajuste de ráfaga `autocannon` dentro de `RATE_LIMIT_API_MAX`), `INC-04` (presupuesto jerárquico de timeouts `1500 ms` vs `4000 ms`).

### 1.6 Documentación Técnica Entregada (Misión 6)

- [README.md](../README.md): Guía paso a paso de arranque, cuentas ficticias, `reset-db`, comandos de prueba y protocolo responsivo.
- [docs/evidencias/README.md](evidencias/README.md): Guía de evidencias y enmascaramiento de secretos.
- [INFORME_UNIDAD_2_BACKEND.md](INFORME_UNIDAD_2_BACKEND.md): 10 Módulos completos (matriz `S01`–`S39`, diagramas UML/componentes/secuencia en Mermaid, stakeholders/RBAC, fronteras de confianza, inventario simbólico de secretos, SDL GraphQL, ADR-001 sobre Analítica/gRPC y resultados reales).
- [INFORME_UNIDAD_3_VALIDACION.md](INFORME_UNIDAD_3_VALIDACION.md): 7 Etapas completas (línea base, inventario `F01`–`F09`, fichas `P01`–`P12`, bitácora `INC01`–`INC06`, incidencias cerradas `INC-01`–`INC-04`, 4 indicadores cuantitativos, amenazas a la validez, matriz de trazabilidad completa y guion de defensa).

---

## Parte 2 — Todo lo que Falta (Manual, Administrativo o Fuera del Entorno Sandbox)

### 2.1 Pendientes Manuales de Evaluación 1 y Validación Visual en Navegador

| Ítem | Referencia Rúbrica | Qué Falta Hacer | Cómo Completarlo |
| :--- | :--- | :--- | :--- |
| **Prototipo en Figma** | Eval 1 (`C2` 15% y Entregable 1) | Crear o adjuntar el enlace navegable del diseño previo en Figma (escritorio, tablet y móvil) | Exportar/enlazar el frame de Figma de las vistas `P01`–`P04` en `README.md` o portada de entrega de Eval 1 |
| **Prueba responsiva en 4 viewports + capturas** | Eval 1 (`C3`, `C9`) y Unidad 3 (Etapa 4.3) | Inspeccionar `http://localhost:3000` en DevTools en `375x812`, `768x1024`, `1024x768` y `1440x900`, tomar capturas limpias (sin JWT visibles) y reemplazar `[PENDIENTE DE EJECUCIÓN EN NAVEGADOR]` | Abrir `http://localhost:3000` en Chrome/Firefox DevTools, recorrer Login → Tótem → Caja → Admin en los 4 tamaños y llenar la tabla de la Sección 4.3 de `INFORME_UNIDAD_3_VALIDACION.md` |
| **Prueba interactiva manual E2E desde UI** | Unidad 3 (Etapa 3 / Etapa 7 Defensa) | Verificar manualmente en navegador la impresión térmica (`window.print()`) y, si coincide con la ventana `11:30–12:00`, el selector de servicios solapados (`RF8`) | Recorrer los flujos en `http://localhost:3000` con `EMP001`, `CAJ001` y `ADM001` antes de la defensa |

### 2.2 Pendientes Administrativos y de Entrega Académica

| Ítem | Referencia | Qué Falta Hacer |
| :--- | :--- | :--- |
| **Datos de portada e integrantes** | Unidad 2 (Portada) y Unidad 3 (Etapa 1 y 7.6) | Agregar los nombres reales de los integrantes del equipo y el detalle de aportes individuales en ambos informes (`INFORME_UNIDAD_2_BACKEND.md` e `INFORME_UNIDAD_3_VALIDACION.md`). |
| **Repositorio Git y commits trazables** | Unidad 3 (Etapa 7.6 Bitácora) | La carpeta `/home/vergil/Documentos/USM/www` aún no tiene `.git`. Si el docente solicita historial de commits o enlace a repositorio, ejecutar `git init`, verificar que `.gitignore` ignore `.env`, `node_modules/` y `generated/`, y registrar los commits del equipo. |
| **Reemplazar secretos `CHANGE_ME_*` en `.env` local** | Unidad 2 (Módulo 6) | El archivo local `.env` (ignorado por Git) es actualmente copia directa de `.env.example`. Para la defensa en vivo, se recomienda reemplazar los valores `CHANGE_ME_*` por claves aleatorias generadas localmente y reiniciar Docker (`docker compose up -d`). |
| **Limpiar carpeta `docs/evidencias/` de corridas previas fallidas (opcional)** | Unidad 3 (Etapa 5) | En `RUN01/` coexisten `summary_179552859*.json` (corrida pre-fix `INC-01`) y `summary_179552915*.json` (corrida post-fix `11/11`), al igual que `load_report_*14-06-32*` (`INC-03`) y `load_report_*14-09-22*` (`RUN_LOAD_02`), y `summary_1795529494520.json` en `RUN_RESILIENCE/` (`INC-04`). Conservarlos respalda la trazabilidad de Etapa 5; si se prefiere una carpeta nueva 100% limpia tras todo corregido, puede ejecutarse una última corrida etiquetada `RUN_FINAL`. |

### 2.3 Limitaciones Funcionales Declaradas (Fuera de Alcance de Laboratorio)

| Ítem | Estado Actual | Por qué Falta / Alcance |
| :--- | :--- | :--- |
| **Envío SMTP real de avisos semanales (`RF14`)** | Parcialmente demostrado (`EmailSandboxAdapter` en modo `sandbox`) | No se conectó un servidor SMTP/API externo productivo; para producción requiere credenciales SMTP reales y un scheduler/cron semanal automático que invoque `POST /notifications/weekly/run`. |
| **Autenticación biométrica / lectura de tarjetas (`RF10` futuro)** | Implementado con código de funcionario + contraseña (`bcrypt` + JWT) | Caso 18 establece biometría y tarjetas como estudio posterior tras la fase inicial web/tótem. |
| **Pruebas en hardware físico y red WAN entre sedes** | Probado en Docker Compose local con emulación de viewport | No se validó latencia WAN real entre Casa Central y Sucursal Norte ni en tótems con impresora térmica física. |
