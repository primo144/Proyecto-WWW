# Informe de integración frontend–backend y validación · Unidad 3

**Caso:** Caso 18, emisión y control de vales de alimentación (Libros Impresos S.A.).
**Secuencia de versiones:** línea base `6f640fb` → Entrega 1 `73b638d` → Entrega 2 `1bc3226` + correcciones `0a1ce4b`/`1485899` → Entrega 3 en esta rama.
**Producto validado:** SPA real servida por Nginx + gateway ASP.NET Core + auth, clients, inventory, orders, payments, GraphQL y Oracle Free.
**Límite central:** las pruebas usan cuentas y datos sintéticos, Docker Desktop local, correo sandbox y viewports emulados.

La regla de trazabilidad aplicada es **requisito → criterio → prueba → ejecución → evidencia → conclusión**. No se presenta una captura como prueba de persistencia ni un HTTP 200 aislado como prueba de un flujo funcional.

## Etapa 1 — Línea base y alcance

### Entorno registrado

| Componente | Implementación comprobada |
| --- | --- |
| Frontend | HTML/CSS/Bootstrap 5.3, JavaScript Vanilla modular, Nginx `:3000` |
| Gateway | ASP.NET Core 10, único puerto backend del host `:8080` |
| Auth / clients / inventory / orders / payments | Procesos .NET independientes; comunicación interna en `private_net` |
| GraphQL Gateway | Hot Chocolate, privado en `:4006` |
| Persistencia | Oracle Database Free 23.26.4, cinco cuentas/esquemas propietarios |
| Navegador usado en corridas | Chrome headless `158.0.8127.37` en Windows; emulación de viewport |
| Cuentas/datos | Seed ficticio idempotente; acceso de pruebas documentado en `README.md` |
| Dependencia de correo | `sandbox` por defecto; modo HTTP API externo disponible con configuración |
| Componentes condicionales | Sin servicio analítico separado ni gRPC, conforme al ADR-001 de Unidad 2 |

El stack se puede restablecer desde `docker compose --profile tools run --build --rm db-reset`. La configuración local `.env` no está versionada.

### Flujos inventariados y prioridad

| Flujo | Requisitos | Rol / pantalla | Datos afectados | Riesgo y cobertura final |
| --- | --- | --- | --- | --- |
| F01 autenticar | RF01, RF10 | Todos · P01 Login | Cuenta/sesión | Alto · login, refresh rotado, revocación y acceso protegido comprobados en API |
| F02 obtener resumen de turno | RF01, RF03, RF08 | Funcionario · P02 Tótem | Ficha propia, turno, horarios, tarifas y vales | Alto · GraphQL real con clients/inventory/orders/payments y respuesta parcial comprobados |
| F03 emitir/imprimir vale | RF02, RF07, RF08, RF13 | Funcionario · P02 Tótem | `ORDERS_SVC.VOUCHERS` | Crítico · emisión desde UI, lectura independiente, regla de duplicado y rechazo fuera de turno |
| F04 canjear | RF12, RF04 | Cajero · P03 Caja | Vale/canje/transacción/items | Crítico financiero · UI, cotización de inventory, liquidación y persistencia contrastadas |
| F05 adicionales | RF05 | Admin y funcionario · P04/P02 | Vales adicionales | Medio · creación admin desde SPA e impresión por beneficiario desde Tótem |
| F06 servicio extensible | RF03, RF09 | Admin · P04 | Servicio/ventana/valorización | Medio · API Oracle y configuración administrativa presentes; smoke de servicio |
| F07 multi-vale y sedes | RF06, RF11 | Secretaria · P02 | Vales y turno en sucursales | Alto · dos beneficiarios distintos, límite de repetición y `NORTE` desde test de integración |
| F08 informes y avisos | RF04, RF14 | Admin · P04 | Auditoría y notificaciones | Medio · auditoría/GraphQL/SP probados; SMTP productivo permanece parcial |
| F09 permisos y continuidad | RF01, RF10 | Todos · P01–P04 | Sesión y datos restringidos | Crítico · IDOR, RBAC, requests anónimos y caída controlada de payments comprobados |

### Recorridos críticos de validación profunda

1. **Lectura y autorización:** login → `miResumenComensal` real → sucursales/horarios/tarifas/vales; intentos anónimo, IDOR y rol no autorizado.
2. **Cambio persistente de estado:** emitir vale desde el Tótem → comprobar Oracle desde otra lectura → buscarlo en Caja → cotizar producto desde `inventory` → liquidar en `payments` → comprobar estado de orden y transacción.
3. **Fallo y recuperación:** detener `payments-service` antes de confirmar la venta → comprobar error comprensible en Caja, `504` en REST, `partialErrors` en GraphQL y vale todavía `IMPRESO` → restaurar Payments y reintentar el mismo carrito → confirmar una sola transacción.

## Etapa 2 — Criterios de aceptación y protocolo

Los resultados esperados se fijaron antes de la ejecución final. La suite Oracle complementaria en `Entrega-2` cubre contratos, PL/SQL y otras operaciones REST; el browser runner de esta rama cubre los recorridos desde la SPA.

| Criterio | Resultado observable | Prueba en RUN15/RUN16 |
| --- | --- | --- |
| CA01 identidad y límite público | `/health` responde; pedido anónimo recibe 401 | P01 |
| CA02 multi-vale/multi-sede | `SEC001` crea dos folios para beneficiarios distintos en CENTRAL/NORTE; repetición idempotente del mismo beneficiario recibe 409 | P02 |
| CA03 reglas horarias | Funcionario de turno 1 intenta `CENA1` en el test clock de turno 2 y recibe 422 | P03 |
| CA04 responsividad y lectura GraphQL | Resumen del titular se muestra a 375×812, 768×1024, 1024×768 y 1440×900, sin overflow horizontal | P04 |
| CA05 emisión RF2 y persistencia | Tótem produce folio `IMPRESO`, recibo imprimible y lectura Oracle independiente; transacción <2.000 ms | P05 |
| CA06 controles negativos | Vale duplicado 409, acceso a ficha ajena 403 y auditoría con rol funcionario 403 | P06 |
| CA07 indisponibilidad controlada | API Gateway 504; caja muestra `UPSTREAM_UNAVAILABLE`; GraphQL mantiene resumen y reporta payments parcial; el vale no cambia | P07 |
| CA08 recuperación/idempotencia | Mismo carrito se reintenta tras recuperar payments; vale `CANJEADO`, una transacción `LIQUIDADO` | P08 |
| CA09 adicional | Admin emite vale desde la SPA y el beneficiario lo imprime desde el Tótem | P09 |
| CA10 manejo posterior y errores UI | Admin vuelve al panel después de recuperación; cero errores JavaScript no manejados | P10 |

La suite toma screenshots de página completa y guarda `X-Correlation-ID` para solicitudes clave. Verifica persistencia con GET independiente y comprueba la cobertura en el UI por viewport. Para RF2 se mide la solicitud normal y el flujo del browser en dos corridas. **No** se declara un p95/concurrencia de producción.

El print smoke intercepta `window.print()` y verifica que CSS `@media print` oculte acciones de pantalla. No imprime en un tótem físico.

## Etapa 3 — Integración incremental y correcciones

| Incidencia | Hallazgo y efecto | Cambio | Revalidación |
| --- | --- | --- | --- |
| INC-01 (`RUN01`) | Tótem recibía GraphQL HTTP 400 por falta del campo `canjeadoEn` que solicitaba la SPA. | DTO Oracle/REST/GraphQL de vale incluye `canjeadoEn`; el contrato quedó probado en el smoke API de Entrega 2. | Corridas browser RUN15/RUN16 muestran resumen GraphQL y vales recientes desde la SPA. La evidencia pre-fix se conserva en `RUN01/`. |
| INC-02 (`RUN02`) | El panel de error por fallo de Payments estaba presente, pero el test buscaba un rol ARIA `alert` que el helper UI no declara. | El browser runner observa el nodo `.state-error`; no se suprimió el mensaje ni se cambió el criterio funcional. | P07 en RUN15/RUN16 registra `UPSTREAM_UNAVAILABLE` visible. El screenshot pre-fix del selector se conserva en `RUN02/`. |
| INC-03 (`RUN07`) | El combo de beneficiario seleccionó `SEC001`; la prueba asumía `EMP001` e intentó imprimir como titular distinto. | El runner toma `codigoFuncionario` del vale emitido y comprueba el derecho del beneficiario real. | CA09/P09 en RUN15/RUN16: vale adicional se crea en UI y se imprime por su titular. El screenshot de creación fallida del runner se conserva en `RUN07/`. |

Los intentos iniciales fallidos pertenecen a versiones de implementación/test diferentes. Se reportan como incidencias cerradas; no se combinan con los indicadores de la versión final. RUN03–RUN12 son corridas exploratorias previas y permanecen como histórico.

### Bitácora de integración

| Incremento | Componente | Corrección / decisión | Estado |
| --- | --- | --- | --- |
| BASE | Contratos REST y GraphQL .NET/Oracle | Se conserva `X-Correlation-ID`; se endurece JSON con rechazo de propiedades no mapeadas; pagos y valores se calculan server-side | Integrado |
| INT-01 | SPA → Gateway → GraphQL → subsistemas | Se alinea el DTO `Vale` con los campos que el Tótem realmente solicita, incluido `canjeadoEn` | Corregido y verificado |
| INT-02 | Browser E2E | El locator comprueba `.state-error`, coherente con el DOM del helper | Corregido y verificado |
| INT-03 | Emisión `CU7` | La prueba usa la identidad beneficiaria real que responde el servicio | Corregido y verificado |
| INT-04 | `orders` → `payments` | HttpClient clasifica timeout como 504 y servicio sin conexión como 503 controlado; no actualiza el vale si la liquidación no se confirma | Verificado en P07/P08 |
| INT-05 | Refresh de sesión | La SPA guarda el refresh token rotado en `sessionStorage` | Verificado en test Oracle de Entrega 2 |

## Etapa 4 — Ejecución y evidencias

El runbook realiza `db-reset`, pone Orders y GraphQL en `DOTNET_ENVIRONMENT=Testing` con `APP_TEST_NOW_SANTIAGO=21:00 America/Santiago`, y ejecuta dos resets completos independientes. En RUN15 se emite desde viewport móvil y se canjea en escritorio; en RUN16 se invierten esos viewports. Ambos resúmenes registran branch/commit probado y árbol fuente limpio, marca UTC, versión de Chrome headless, resultados por criterio, folio y correlaciones sanitizadas.

| Run final | Pruebas browser | Resultado | Evidencia |
| --- | ---: | --- | --- |
| RUN15 | 10 | 10 aprobadas, 0 fallidas | [`summary.json`](evidencias/entrega-3/RUN15/summary.json), screenshots asociados |
| RUN16 | 10 | 10 aprobadas, 0 fallidas | [`summary.json`](evidencias/entrega-3/RUN16/summary.json), screenshots asociados |

Ambas corridas registran `gitBranch=Entrega-3`, `codeCommit=12dbceb` y `sourceWorktreeClean=true` en sus summaries.

El paquete lleva [índice y límites de validez](evidencias/entrega-3/README.md) y [matriz CSV](TRAZABILIDAD_UNIDAD_3.csv). Los tokens viven en memoria de la suite; no se serializan. `RUN01`, `RUN02`, `RUN07` registran las iteraciones de depuración y no cuentan dentro de las métricas de RUN15/RUN16. RUN13/RUN14 se conservan como las dos ejecuciones previas de los mismos criterios, antes de incorporar metadatos de procedencia a los summaries.

## Etapa 5 — Incidencias y regresión

INC-01, INC-02 e INC-03 quedan cerradas con causa identificada y nueva ejecución. P07/P08 son **escenarios de fallo y recuperación**, no defectos adicionales: detenido Payments no recibe liquidación, el usuario ve mensaje y CID; después del `docker compose start payments-service`, repetir la misma operación desde el carrito abierto finaliza una sola vez. Se conserva la pantalla anterior al reintento y el estado Oracle `IMPRESO`.

El rechazo de una prueba durante desarrollo no se borra: `RUN01`, `RUN02` y `RUN07` se indexan en el README de evidencias. No representan defectos abiertos de las corridas finales. La solución no se etiqueta como lista para producción.

## Etapa 6 — Métricas, conclusiones y amenazas a la validez

Indicadores para el alcance de trazabilidad RF01–RF14:

| Indicador | Cálculo | Resultado | Lectura |
| --- | --- | ---: | --- |
| Cobertura del diseño | 14 requisitos con criterio y referencia de prueba / 14 | 100% | Planificación/trazabilidad, no éxito automático |
| Ejecución del plan browser final | 10 pruebas distintas con resultado / 10 planificadas | 100% | Sin bloqueadas/no ejecutadas dentro del conjunto P01–P10 |
| Aprobación final observada | 10 pruebas distintas aprobadas / 10 ejecutadas | 100% | RUN15 y RUN16 repiten los 10 criterios (20/20 resultados aprobados) |
| Logro demostrado | 13 requisitos con criterio observable/evidencia suficiente / 14 en alcance | 92,9% | RF14 queda parcialmente demostrado por correo sandbox/API de prueba |

La matriz [`TRAZABILIDAD_UNIDAD_3.csv`](TRAZABILIDAD_UNIDAD_3.csv) vincula RF, flujo, pantalla, rol, sistema, criterio, prueba, ejecución y conclusión. El porcentaje de logro refleja límites del caso; no es probabilidad de éxito en producción.

### Conclusiones por flujo

- **Totem:** lectura GraphQL real, titular y turno, colación activa, emisión/recibo y comprobación Oracle se realizaron desde UI. La medición observada estuvo entre 200–300 ms en entorno local; dos muestras no acreditan carga de 500–1.000 personas.
- **Canje:** el cajero verificó vale, añadió dos unidades de producto, vio la diferencia pagada, obtuvo fallo visible cuando Payments se detuvo y pudo reintentar tras recuperarlo. El backend dejó el vale `IMPRESO` hasta que la liquidación `LIQUIDADO` se persistió.
- **Adicionales:** administración creó el vale en la SPA; lo imprimió el beneficiario según identidad de sesión.
- **Seguridad y GraphQL:** API anónima/protegida, acceso ajeno, rol, profundidad/alias y propagación de correlación tienen pruebas específicas en la evidencia de Unidad 2/3.
- **Notificaciones:** Oracle ejecutó el SP PL/SQL y el adaptador marcó `ENVIADO_SANDBOX`. No se probó entrega SMTP o API externa real.

### Amenazas a la validez

1. Cuentas/registro pequeños y sintéticos; no representan 500/1.000 personas reales.
2. Docker Desktop local; no emula red WAN, latencia entre sedes ni disponibilidad cloud.
3. Viewports de Chrome/Edge headless; no son dispositivos físicos ni tótem táctil/impresora real.
4. El error de Payments se induce deteniendo un contenedor, no con fallo WAN o pérdida de red.
5. `window.print()` se intercepta, no se confirma una hoja térmica impresa.
6. Email está en sandbox por defecto; rebotes, entregabilidad y proveedor real no se acreditan.
7. La misma persona/equipo desarrolla y ejecuta pruebas; los resultados sí consultan Oracle/Gateway independientemente, pero no equivalen a auditoría externa.

## Etapa 7 — Defensa y entrega

### Orden sugerido de demostración

1. Identificar commit/versión y entorno; enseñar `docker compose ps` y `/health`.
2. Abrir el Tótem en móvil, mostrar resumen GraphQL y emitir CENA1; comprobar el estado almacenado desde otra solicitud.
3. En Caja agregar productos y detener `payments-service` antes de confirmar; mostrar error/CID, `partialErrors` y estado aún `IMPRESO`.
4. Iniciar Payments, reintentar la misma canasta y mostrar el único registro `LIQUIDADO` más la auditoría administrativa.
5. Ejecutar dos vales multi-visitante en distintas sucursales y adicional CU7; explicar la idempotencia y la autorización por titular (el máximo de 10 permitido al perfil no se agotó en esta muestra).
6. Abrir un resultado y reconstruir RF → CA → P → RUN → evidencia → conclusión. Mostrar un debug fallido conservado y la regresión.
7. Declarar límites (sandbox, Docker local, viewport emulado, muestra pequeña) y responder por el stack Oracle/.NET requerido.

El README original identifica a Cristóbal Barahona como integrante. Los aportes individuales de la Unidad 3 deben completarse con tareas reales y atribuidas por el equipo; este informe no inventa nombres ni contribuciones.
