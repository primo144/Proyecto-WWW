# Manual de usuario

## 1. Inicio, cuentas y tipos de usuario

Para iniciar la aplicación en el equipo local, sigue la sección **Inicio** del [README](../README.md): prepara `.env`, ejecuta `docker compose up --build -d` y abre `http://localhost:3000`. La API de la aplicación responde en `http://localhost:8080`.

Las cuentas se crean al iniciar el servicio de seed. Para la base local de evaluación, todas usan la contraseña `Libros2026!`:

| Código | Rol | Uso |
| --- | --- | --- |
| `EMP001` | Funcionario | Obrero, turno 1 |
| `EMP002` | Funcionario | Administrativo, turno 2 |
| `EMP003` | Funcionario | Jefe, turno 3, Sucursal Norte |
| `SEC001` | Funcionario | Secretaría de Gerencia, perfil multi-vale |
| `CAJ001` | Cajero | Caja Central |
| `CAJ002` | Cajero | Caja Norte |
| `ADM001` | Administrador | Administración y auditoría |

En **Ingreso / Catalogo**, escribe el código y contraseña y pulsa **Iniciar Sesion**. El sistema abre Tótem, Caja Casino o Administración según el rol. Pulsa **Cerrar Sesion** al terminar; la sesión se revoca en el servidor.

Los roles son **Funcionario** (Tótem/ayuda), **Cajero** (Caja/ayuda) y **Administrador** (Administración completa). El cajero no puede consultar auditoría; un funcionario no puede operar otra ficha o vale.

## 2. Funcionario — Tótem de vales

1. Comprueba el funcionario/perfil, turno mensual y sucursal que muestra **Totem Vales**. La información llega del backend mediante GraphQL.
2. Busca una tarjeta con la etiqueta **Activo ahora**. La hora permitida y el valor dependen del turno, perfil y servicio vigentes.
3. Revisa nombre, ventana y valor del servicio. Si más de uno está activo, selecciona el que corresponde a tu turno.
4. Pulsa **Emitir e Imprimir Vale (<2s)** una sola vez y espera el comprobante. Guarda el folio que aparece; usa **Imprimir Comprobante** para imprimir o abrir el diálogo del navegador.
5. Un vale emitido queda persistido en el sistema. Si ya se emitió el mismo servicio/horario, el backend lo rechaza para evitar duplicidad.
6. Si el perfil admite multi-vale, escribe el nombre del visitante antes de emitir. Para imprimir vales adicionales generados por administración, utiliza la sección **Vales Adicionales Disponibles para Imprimir**.
7. **Mis Vales Recientes** muestra estados e historial; **Avisos Semanales** muestra los avisos registrados para la cuenta.

**Si aparece “Fuera de Horario” o 422:** revisa el turno, horario y servicio asignado; no repitas la petición esperando eludir la regla. Si el resumen falla parcialmente, revisa los subsistemas señalados y reintenta cuando estén disponibles.

## 3. Cajero — Registrar un canje

1. Abre **Caja Casino** y elige el casino correcto.
2. En **Validar Vale y Canjear (CU5)** ingresa el número completo del vale y pulsa **Buscar**. Confirma beneficiario, servicio, valor y estado `IMPRESO`.
3. Agrega productos al detalle de consumo. Los precios visibles son informativos; inventory vuelve a cotizar por IDs en el servidor.
4. Revisa total, cobertura del vale, saldo a favor o diferencia a pagar. Cuando se solicita una diferencia, selecciona el medio de pago.
5. Pulsa **Confirmar Venta y Canjear Vale (CU5)** una vez. Al confirmarse, el vale pasa a `CANJEADO` y aparece el estado de liquidación y el correlativo.

**Si falla un subsistema durante el canje:** lee el código y `X-Correlation-ID` del mensaje. No entregues los productos hasta que se confirme la operación. Si la pantalla conserva el carrito y el vale sigue `IMPRESO`, espera recuperación del servicio y reintenta; el servidor evita registrar dos pagos para la misma llave de idempotencia. Nunca envíes precios o totales editados desde el navegador.

## 4. Administrador — Catálogos, perfiles y control

- **Auditoria y Avisos (CU6 / CU9):** revisa estados por servicio/funcionario, rendición y avisos; la acción semanal llama al procedimiento PL/SQL.
- **Servicios y Tarifas:** crea servicios de alimentación con ventanas de turno y una valoración positiva por perfil; ajusta valores. Registra productos del casino y cambia su disponibilidad sin borrarlos del historial.
- **Perfiles y Turnos:** define perfiles multi-vale, crea un funcionario con cuenta asociada y establece perfil, rol, sucursal y turno mensual.
- **Vales Adicionales y Control:** genera vales de reunión o visita con motivo y beneficiario; conserva el registro al anular.

Los permisos también se validan en backend. Ocultar un botón no concede acceso a datos ni modifica la autorización del servidor.

## 5. Ayuda, accesibilidad y resolución de problemas

- La navegación muestra solo las pantallas habilitadas para el rol; usa teclado, etiquetas de formulario y mensajes anunciados por la región de estado de la pantalla.
- El catálogo público se puede consultar antes del login. El resto de los datos exige una sesión válida.
- El indicador inferior `CID` muestra el identificador que puedes entregar a soporte académico; no contiene tokens.
- Si no se conecta la plataforma, comprueba `docker compose ps` y `/health`. Una falla de Oracle requiere recuperar el contenedor; un error de permisos debe remitirse al administrador.
- Si la sesión expira, vuelve a autenticarte. El refresh token se rota; un token revocado no puede reactivarse desde el browser.

## 6. Entorno de evaluación

La contraseña y las cuentas anteriores son sólo para evaluación local. No las uses en un entorno externo ni con datos personales. La entrega usa servicios y persistencia Oracle reales en Docker; los correos quedan en `sandbox` por defecto. La impresora térmica, entrega SMTP externa y hardware biométrico no son parte de esta demostración.
