# Paquete de Evidencias Trazables (`docs/evidencias/`)

Este directorio almacena las salidas reales depuradas generadas por la suite automatizada en `tests/` cuando se ejecuta contra el entorno completo en Docker Compose.

## Integridad Probatoria y Proteccion de Secretos

- **Cero evidencias fabricadas:** Ningun archivo `RUNxx` ni reporte `load_report_*.json` es pre-generado artificialmente. Todos se producen al ejecutar el sistema real.
- **Enmascaramiento automatico:** El modulo `tests/src/helpers/evidenceLogger.ts` (`sanitizePayload`) reemplaza automaticamente cualquier JWT (`eyJ...`), cabecera `Authorization`, `password`, `refreshToken`, `accessToken` o `x-internal-service-token` por `***REDACTED***` antes de escribir en disco.
- **Trazabilidad:** Cada archivo `E<NN>_<PXX>_<slug>.json` conserva `runId`, `testId`, `criteriaId`, `timestamp`, `correlationIds` (`X-Correlation-ID`), solicitud sanitizada, respuesta HTTP/GraphQL, verificacion de persistencia independiente y estado (`PASSED`, `FAILED` o `SKIPPED`).

## Estructura Generada al Ejecutar `npm run test:cycle`

```text
docs/evidencias/
├── README.md
├── RUN01/
│   ├── E01_P01_*.json ... E11_P11_*.json
│   └── summary_<timestamp>.json
├── RUN02/                  # Repeticion independiente tras restauracion de BD
│   ├── E01_P01_*.json ... E11_P11_*.json
│   └── summary_<timestamp>.json
├── RUN_RESILIENCE/         # Corrida P12 con payments detenido (si DOCKER_RESILIENCE=1)
│   └── E01_P12_*.json
└── load_report_<timestamp>.json
```

## Como Generar las Evidencias Reales

```bash
# 1. Levantar la plataforma completa
cp .env.example .env
# (Opcional: ajustar secretos locales en .env)
docker compose up --build -d

# 2. Instalar dependencias locales para correr la suite desde el host contra localhost:8080
npm install

# 3. Ejecutar el ciclo completo (reset -> RUN01 -> reset -> RUN02 -> carga -> resiliencia)
RESET_VIA_DOCKER=1 DOCKER_RESILIENCE=1 npm run test:cycle
```
