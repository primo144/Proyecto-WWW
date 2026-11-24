# Sistema de Emision y Control de Vales de Alimentacion — Caso 18 ("Libros Impresos S.A.")

Proyecto integral de la asignatura **Lenguajes de Programacion en WWW** (Evaluaciones 1, 2 y 3). Implementa de extremo a extremo la solucion automatizada de vales de colacion para **Libros Impresos S.A.** (500 funcionarios en expansion a una segunda sucursal/imprenta, operacion 24/7 en 3 turnos mensuales).

---

## 1. Arquitectura y Stack Tecnologico

- **Frontend Responsivo (Evaluacion 1):** HTML5 semantico, **Bootstrap 5.3** (Grid de 12 columnas), CSS3 con **Box Model y Flexbox explicitos** (`frontend/css/styles.css`) y **JavaScript Vanilla ES Modules** con manipulacion real del DOM (`createElement`, `querySelector`, `addEventListener`, estados de carga/exito/vacio/error y cero datos dummy).
- **API Gateway (`gateway/`, puerto `8080`):** Unico punto de entrada publico. Implementa rate limiting, limpieza de cabeceras internas falsificadas (`sanitizeHeaders`), validacion de JWT contra `auth-service`, inyeccion de contexto verificado (`x-user-id`, `x-user-role`, `x-user-code`), propagacion de `X-Correlation-ID`, timeouts y tolerancia a fallos.
- **GraphQL Gateway Privado (`graphql-gateway/`, puerto `4006` en `private_net`):** `graphql-yoga` + `DataLoader` para agregaciones multi-subsistema (`miResumenComensal`, `detalleVale`, `panelAuditoria`, `catalogoCasino`), limites de profundidad (`maxDepth=4`) y complejidad (`maxComplexity=500`), autorizacion por campo (`rut`, `email`) y degradacion controlada (`partialErrors`).
- **Microservicios Privados en `private_net` (Node.js 24 LTS + TypeScript strict + Zod + Pino + Prisma ORM):**
  - `auth-service` (4001, esquema `auth`): Login con hash adaptativo `bcryptjs`, emision/verificacion/renovacion/revocacion de JWT y sesiones en PostgreSQL.
  - `clients` (4002, esquema `clients`): Sucursales (`CENTRAL`, `NORTE`), casinos, perfiles de comensal (normal y multi-vale), funcionarios y turnos mensuales.
  - `inventory` (4003, esquema `inventory`): Servicios de alimentacion extensibles, ventanas horarias por turno, valorizaciones por perfil y catalogo/cotizacion autoritativa de productos del casino.
  - `orders` (4004, esquema `orders`): Motor de emision e impresion en totem (`< 2s`), validacion de turno/horario, prevencion atomica de duplicados, vales adicionales/visitas y registro de canje en casino.
  - `payments` (4005, esquema `payments`): Liquidacion idempotente (cobertura, saldo a favor y diferencia pagada), rendicion mensual y ejecucion del procedimiento almacenado `payments.sp_generar_avisos_semanales` con `EmailSandboxAdapter`.
- **Persistencia:** PostgreSQL 16 con 5 esquemas aislados (`auth`, `clients`, `inventory`, `orders`, `payments`) sin exposicion de puerto al host.
- **Aislamiento de Red (`docker-compose.yml`):**
  - `public_net`: conecta solo `frontend` (`3000:80`) y `gateway` (`8080:8080`).
  - `private_net` (`internal: true`): conecta `postgres`, `auth-service`, `clients`, `inventory`, `orders`, `payments`, `graphql-gateway` y `gateway`. Ningun microservicio privado ni la BD expone puertos al host.

---

## 2. Estructura del Repositorio

```text
.
├── docker-compose.yml            # Orquestacion con public_net y private_net (internal)
├── .env.example                  # Plantilla simbolica de variables (sin secretos reales)
├── package.json                  # Workspaces del monorepo
├── shared/                       # Logger Pino con redact, AppError, middlewares, internalFetch
├── db/                           # init.sql (5 esquemas + SP), seed.ts y reset-db.ts
├── auth-service/                 # Autenticacion bcrypt + JWT + sesiones
├── services/
│   ├── clients/                  # Funcionarios, perfiles, sucursales y turnos mensuales
│   ├── inventory/                # Servicios extensibles, valorizaciones y productos
│   ├── orders/                   # Emision/impresion de vales, canje y auditoria
│   └── payments/                 # Liquidacion idempotente, rendiciones y avisos SP
├── graphql-gateway/              # Agregacion GraphQL privada + DataLoader + limites
├── gateway/                      # API Gateway publico (unica frontera HTTP expuesta)
├── frontend/                     # SPA modular HTML5 + Bootstrap 5 + CSS + JS Vanilla
├── tests/                        # Suite Vitest (E2E, Seguridad, Resiliencia) + autocannon
└── docs/
    ├── enunciados/               # Los 4 PDFs originales de la asignatura
    ├── evidencias/               # Destino de salidas RUNxx, Exx y load_report_*.json
    ├── INFORME_UNIDAD_2_BACKEND.md
    └── INFORME_UNIDAD_3_VALIDACION.md
```

---

## 3. Requisitos Previos e Inicio desde Cero

- Docker Engine + Docker Compose v2 (`docker compose`).
- Node.js >= 20 (para ejecutar scripts locales de verificacion/pruebas desde el host; los contenedores usan Node 24 LTS).

### Pasos de Despliegue Reproducible

```bash
# 1. Crear configuracion local desde la plantilla simbolica
cp .env.example .env

# 2. (Recomendado) Reemplazar los valores CHANGE_ME_* en .env con claves aleatorias locales
# Por ejemplo usando openssl:
# sed -i "s/CHANGE_ME_DB_PASSWORD/$(openssl rand -hex 16)/g" .env

# 3. Construir e iniciar toda la infraestructura + seed inicial determinista
docker compose up --build -d

# 4. Verificar salud de los servicios via API Gateway
curl -s http://localhost:8080/health | jq .
```

Accesos disponibles en el navegador:
- **Aplicacion Web (Frontend):** `http://localhost:3000`
- **API Gateway (REST / GraphQL):** `http://localhost:8080`

Para detener el sistema conservando datos o eliminando volumenes:

```bash
docker compose down        # Detener contenedores
docker compose down -v     # Detener y eliminar volumen PostgreSQL
```

---

## 4. Datos Ficticios de Prueba y Restauracion Determinista

El script `db/src/seed.ts` pobla automaticamente sucursales (`CENTRAL`, `NORTE`), casinos, servicios (`DESAYUNO`, `ALMUERZO`, `ONCE`, `CENA1`, `CENA2`, `REUNION_COFFEE`), 10 productos de casino, valorizaciones por perfil y turnos mensuales para el mes actual.

Cuentas ficticias de prueba (contrasena inicial de entorno de pruebas: `Libros2026!`):

| Codigo | Rol | Perfil | Turno Mensual | Sucursal Base | Uso Principal en Pruebas |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `EMP001` | `FUNCIONARIO` | `OBRERO` | Turno 1 (`08:00-16:00`) | `CENTRAL` | Totem diurno y vale adicional |
| `EMP002` | `FUNCIONARIO` | `ADMINISTRATIVO` | Turno 2 (`16:00-24:00`) | `CENTRAL` | Totem vespertino y prueba IDOR |
| `EMP003` | `FUNCIONARIO` | `JEFE` | Turno 3 (`00:00-08:00`) | `NORTE` | Totem nocturno y Sucursal Norte |
| `SEC001` | `FUNCIONARIO` | `SECRETARIA_GERENCIA` | Turno 1 (`08:00-16:00`) | `CENTRAL` | Multi-vale (visitas, hasta 10/horario) |
| `CAJ001` | `CAJERO` | `ADMINISTRATIVO` | Turno 1 | `CENTRAL` | Canje en comedor/cafeteria Central |
| `CAJ002` | `CAJERO` | `ADMINISTRATIVO` | Turno 2 | `NORTE` | Canje en comedor Sucursal Norte |
| `ADM001` | `ADMINISTRADOR` | `GERENTE` | Turno 1 | `CENTRAL` | Servicios, perfiles, auditoria y SP |

### Restauracion Limpia de Datos Iniciales (`reset-db`)

```bash
docker compose --profile tools run --rm db-tools npm run reset-db:prod
```

---

## 5. Ejecucion de Pruebas Automatizadas (E2E, Seguridad, Carga y Resiliencia)

Instale dependencias en el host (una sola vez) para ejecutar las suites contra `http://localhost:8080`:

```bash
npm install
```

### Comandos Individuales

```bash
# 1. Recorridos criticos E2E (P01 - P05)
npm run test:e2e

# 2. Pruebas negativas y de seguridad (P06 - P11)
npm run test:security

# 3. Prueba de carga RF2 (< 2s) con autocannon + reporte JSON
npm run test:load

# 4. Prueba de caida controlada de payments (P12)
docker compose stop payments
RESILIENCE_TEST_ENABLED=1 RUN_ID=RUN_RESILIENCE npm run test:resilience
docker compose start payments
```

### Ciclo Completo de Validacion Reproducible (`RUN01` + `RUN02` + Carga + Resiliencia)

```bash
RESET_VIA_DOCKER=1 DOCKER_RESILIENCE=1 npm run test:cycle
```

Las evidencias depuradas (sin JWT ni contrasenas) se escriben automaticamente en `docs/evidencias/`.

---

## 6. Protocolo de Verificacion Responsiva (Evaluacion 1)

El frontend (`frontend/index.html`, `frontend/css/styles.css`, `frontend/js/`) debe comprobarse en 4 anchos de viewport (ej. mediante DevTools del navegador):

1. **Movil (`375 x 812`):** Cabecera pasa a disposicion vertical (`flex-direction: column`), barra de navegacion reordenada (`order: 3`), tarjetas de servicio y productos ocupan `12` columnas (`col-12`), botones ocupan ancho completo sin desborde horizontal.
2. **Tablet (`768 x 1024`):** Tarjetas de servicio en `2` columnas (`col-md-6`), panel de caja y carrito pasan a apilamiento `col-12` legible, tablas dentro de `.table-responsive`.
3. **Laptop (`1024 x 768`):** Layout de 2 regiones principales (`col-lg-7` y `col-lg-5`) en Totem, Caja y Login; catalogo de productos en 2 columnas (`col-sm-6`).
4. **Escritorio (`1440 x 900`):** Grilla completa de 12 columnas con catalogo en 3 columnas (`col-xl-4`), KPIs de auditoria en 4 columnas (`col-xl-3`) y comprobante termico centrado (`max-width: 440px`).

---

## 7. Documentacion Completa del Expediente

- [Informe de Arquitectura Backend — Unidad 2 (10 Modulos + ADR)](docs/INFORME_UNIDAD_2_BACKEND.md)
- [Informe de Integracion y Validacion — Unidad 3 (7 Etapas + Matriz de Trazabilidad + Guion de Defensa)](docs/INFORME_UNIDAD_3_VALIDACION.md)
- [Guia del Paquete de Evidencias](docs/evidencias/README.md)
- [Enunciados Originales](docs/enunciados/)
