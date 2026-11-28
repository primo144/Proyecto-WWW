# Entrega 2 · Backend seguro con Oracle y .NET

Rama acumulativa: conserva la Entrega 1 (prototipo responsivo, equivalente local a Figma, API simulada y evidencias) e integra los flujos del Caso 18 con un backend en **ASP.NET Core 10** y **Oracle Database Free**. El Compose predeterminado inicia esta arquitectura .NET/Oracle.

- [Informe de arquitectura — Unidad 2](docs/INFORME_UNIDAD_2_BACKEND.md)
- [Informe y evidencias de la Entrega 1](docs/ENTREGA_1_FRONTEND.md)
- [Enunciado del Caso 18 y pautas](docs/enunciados/)
- [Evidencias del frontend](docs/evidencias/entrega-1/README.md)

El backend Node.js/PostgreSQL heredado se mantiene intacto en `main` y `Entrega-1`; esta rama deja ese stack fuera del código activo para que el despliegue y la evaluación usen Oracle/.NET sin ambigüedad.

## Arquitectura activa

- Una imagen ASP.NET Core, ejecutada como procesos de servicio independientes: `auth-service`, `clients-service`, `inventory-service`, `orders-service`, `payments-service`, `graphql-gateway` y `gateway`.
- Oracle Free con propietarios y credenciales de esquema separados (`AUTH_SVC`, `CLIENTS_SVC`, `INVENTORY_SVC`, `ORDERS_SVC`, `PAYMENTS_SVC`); el gateway es el único backend publicado.
- Frontend SPA existente y el prototipo de la Entrega 1 en Nginx.
- API Gateway con allowlist de rutas, JWT/session verification, limpieza de cabeceras internas, límites de solicitudes, propagación `X-Correlation-ID` y respuestas de error controladas.
- GraphQL privado con agregaciones `miResumenComensal`, `detalleVale`, `panelAuditoria` y `catalogoCasino`; controla el acceso, profundidad y consultas excesivas.
- Contraseñas con PBKDF2-HMAC-SHA256, 210.000 iteraciones y sal individual; acceso JWT de 15 minutos, refresh de 7 días y sesiones revocables.

## Inicio

Requisitos: Docker Desktop/Compose v2, .NET SDK 10 y Node.js 20+ para las suites locales.

1. Copia la plantilla: `Copy-Item .env.example .env`.
2. Sustituye los secretos `CHANGE_ME_*` por valores aleatorios (32+ caracteres). No reutilices tokens entre servicios. Las contraseñas de Oracle de cada esquema **deben coincidir con las referencias de `db/oracle/01-create-users.sql`**; si rotas esas credenciales, actualiza ambos lugares y reinicia la base eliminando su volumen.
3. Construye y levanta el stack:

   ```powershell
   docker compose up --build -d
   docker compose ps
   Invoke-RestMethod http://localhost:8080/health
   ```

4. Abre `http://localhost:3000`. La API pública está en `http://localhost:8080`; Oracle y los microservicios no publican puertos en el host.

Oracle ejecuta `db/oracle/01-create-users.sql` en el primer inicio. El servicio `db-seed` carga las cuentas y los datos ficticios de forma idempotente. El reset determinista es:

```powershell
docker compose --profile tools run --rm db-reset
```

`docker compose down` detiene el stack conservando el volumen Oracle; `docker compose down -v` lo elimina para recrear la base desde cero.

## Cuentas ficticias

Contraseña inicial **solo para la base local de pruebas**: `Libros2026!`.

| Código | Rol | Perfil / uso |
| --- | --- | --- |
| `EMP001` | Funcionario | Obrero, turno 1 |
| `EMP002` | Funcionario | Administrativo, turno 2 |
| `EMP003` | Funcionario | Jefe, turno 3, Sucursal Norte |
| `SEC001` | Funcionario | Secretaria de Gerencia, multi-vale |
| `CAJ001`, `CAJ002` | Cajero | Caja Central / Norte |
| `ADM001` | Administrador | Administración, pruebas de auditoría |

Los registros usan correos y RUT ficticios. No uses personas reales ni la contraseña de demostración en un entorno externo.

## Pruebas

La Entrega 1 mantiene su suite de navegador y capturas de los cuatro viewports:

```powershell
npm ci
npm run test:prototype
```

Para validar Oracle y los recorridos backend desde un estado limpio, ejecuta:

```powershell
.\tests\oracle\run-entrega2-tests.ps1
```

El script restablece Oracle, inicia temporalmente `orders-service` con un reloj simulado a las 21:00 de Santiago (para que el ensayo repetible emita `CENA1` del turno 2), ejecuta `npm run test:oracle` y devuelve ese servicio al modo normal. Las pruebas crean empleados/productos/servicios y vales ficticios; las evidencias sanitizadas se guardan en `docs/evidencias/entrega-2/`.

Las salidas registran una medición aislada de emisión; **no** constituyen benchmark de concurrencia ni una afirmación de p95. Las capturas de Entrega 1 son emulación de navegador, no pruebas en hardware físico.

## Entrega 1 conservada

El prototipo UI/diseño equivalente local se puede ejecutar independientemente:

```powershell
npm run prototype
```

Abre `http://localhost:8081/prototipo-eval1.html`. Emplea servicios HTTP simulados en memoria y se reinicia al cerrar Node; no requiere Oracle ni emite vales de negocio.
