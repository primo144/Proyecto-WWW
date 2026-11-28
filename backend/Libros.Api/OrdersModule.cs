using Oracle.ManagedDataAccess.Client;
using System.Diagnostics;
using System.Globalization;
using System.Net;

namespace Libros.Api;

public static class OrdersModule
{
    public static void Map(WebApplication app)
    {
        var db = app.Services.GetRequiredService<OracleStore>();
        var internalHttp = app.Services.GetRequiredService<ServiceHttp>();
        var configuration = app.Configuration;

        app.MapGet("/health", (CancellationToken ct) => ServiceHealth.Oracle(db, "orders", ct));
        app.MapGet("/vouchers/my", async (HttpContext context, string? estado, CancellationToken ct) =>
        {
            var user = RequestContext.Require(context);
            var vouchers = await FindVouchers(db, "EMPLOYEE_ID=:employee_id" + (string.IsNullOrWhiteSpace(estado) ? "" : " AND STATUS=:status"), c =>
            {
                OracleStore.AddText(c, "employee_id", user.UserId);
                if (!string.IsNullOrWhiteSpace(estado)) OracleStore.AddText(c, "status", estado.ToUpperInvariant());
            }, ct);
            return Results.Ok(new { vouchers });
        });
        app.MapGet("/vouchers", async (HttpContext context, string? estado, string? servicioCodigo, string? sucursal, string? funcionarioId, CancellationToken ct) =>
        {
            RequestContext.RequireRole(context, "ADMINISTRADOR", "CAJERO");
            var filters = new List<string>();
            if (!string.IsNullOrWhiteSpace(estado)) filters.Add("STATUS=:status");
            if (!string.IsNullOrWhiteSpace(servicioCodigo)) filters.Add("SERVICE_CODE=:service");
            if (!string.IsNullOrWhiteSpace(sucursal)) filters.Add("BRANCH_CODE=:branch");
            if (!string.IsNullOrWhiteSpace(funcionarioId)) filters.Add("EMPLOYEE_ID=:employee");
            var vouchers = await FindVouchers(db, filters.Count == 0 ? "1=1" : string.Join(" AND ", filters), c =>
            {
                if (!string.IsNullOrWhiteSpace(estado)) OracleStore.AddText(c, "status", estado.ToUpperInvariant());
                if (!string.IsNullOrWhiteSpace(servicioCodigo)) OracleStore.AddText(c, "service", servicioCodigo.ToUpperInvariant());
                if (!string.IsNullOrWhiteSpace(sucursal)) OracleStore.AddText(c, "branch", sucursal.ToUpperInvariant());
                if (!string.IsNullOrWhiteSpace(funcionarioId)) OracleStore.AddText(c, "employee", funcionarioId);
            }, ct);
            return Results.Ok(new { vouchers });
        });
        app.MapGet("/vouchers/by-number/{numeroVale}", async (string numeroVale, HttpContext context, CancellationToken ct) =>
        {
            var user = RequestContext.Require(context);
            var voucher = await FindVoucher(db, "VOUCHER_NUMBER=:voucher_number", c => OracleStore.AddText(c, "voucher_number", numeroVale.ToUpperInvariant()), ct)
                ?? throw new DomainException(404, "VOUCHER_NOT_FOUND", "Vale no encontrado.");
            AuthorizeOwner(user, voucher);
            return Results.Ok(new { voucher });
        });
        app.MapGet("/vouchers/{id}", async (string id, HttpContext context, CancellationToken ct) =>
        {
            var user = RequestContext.Require(context);
            var voucher = await FindVoucher(db, "ID=:id", c => OracleStore.AddText(c, "id", id), ct)
                ?? throw new DomainException(404, "VOUCHER_NOT_FOUND", "Vale no encontrado.");
            AuthorizeOwner(user, voucher);
            return Results.Ok(new { voucher });
        });
        app.MapPost("/vouchers/issue", async (IssueVoucherRequest body, HttpContext context, CancellationToken ct) =>
        {
            var timer = Stopwatch.StartNew();
            var user = RequestContext.Require(context);
            if (user.Role != "FUNCIONARIO") throw new DomainException(403, "FORBIDDEN", "Solo un funcionario puede emitir en el tótem.");
            var employee = await internalHttp.GetAsync<EmployeeResponse>("CLIENTS", "/employees/me", user, context.TraceIdentifier, ct);
            if (!employee.Employee.Activo || employee.Employee.NumeroTurno is null)
                throw new DomainException(422, "SHIFT_NOT_ASSIGNED", "No tienes turno mensual vigente asignado.");
            var now = SantiagoNow(configuration);
            var serviceResult = await internalHttp.GetAsync<ServiceListResponse>("INVENTORY", $"/services?activo=true&turno={employee.Employee.NumeroTurno}&perfilCodigo={Uri.EscapeDataString(employee.Employee.PerfilCodigo)}", user, context.TraceIdentifier, ct);
            var services = serviceResult.Services;
            var active = services.SelectMany(s => s.Horarios.Where(w => w.NumeroTurno == employee.Employee.NumeroTurno)
                    .Select(w => (Service: s, Window: w)))
                .Where(x => WithinWindow(now.Time, x.Window.HoraInicio, x.Window.HoraFin))
                .Where(x => string.IsNullOrWhiteSpace(body.ServicioCodigo) || string.Equals(x.Service.Codigo, body.ServicioCodigo, StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (string.Equals(configuration["DOTNET_ENVIRONMENT"], "Testing", StringComparison.OrdinalIgnoreCase))
                app.Logger.LogInformation("Test clock issuance decision: localDate={LocalDate}, localTime={LocalTime}, employeeShift={Shift}, activeCandidates={CandidateCount}", now.Date, now.Time, employee.Employee.NumeroTurno, active.Count);
            if (active.Count == 0) throw new DomainException(422, "FUERA_DE_HORARIO", "No hay un servicio de alimentación habilitado para tu turno en este horario.");
            if (active.Count > 1 && string.IsNullOrWhiteSpace(body.ServicioCodigo))
                throw new DomainException(409, "SERVICE_SELECTION_REQUIRED", "Hay más de un servicio habilitado; selecciona uno.");
            var selected = active[0];
            var valuation = selected.Service.Valorizaciones.FirstOrDefault(v => v.Vigente && v.PerfilCodigo == employee.Employee.PerfilCodigo)
                ?? throw new DomainException(422, "VALUATION_NOT_FOUND", "El servicio no tiene una valorización para tu perfil.");
            var visitor = string.IsNullOrWhiteSpace(body.NombreBeneficiarioVisita) ? null : body.NombreBeneficiarioVisita.Trim();
            if (visitor is not null && !employee.Employee.PermiteMultiVale)
                throw new DomainException(403, "MULTI_VOUCHER_NOT_ALLOWED", "Tu perfil no permite emitir vales para visitas.");
            if (visitor?.Length > 150) throw new DomainException(400, "VALIDATION_ERROR", "El nombre de visita supera el máximo permitido.");
            var count = await db.OneAsync("SELECT COUNT(*) N FROM ORDERS_SVC.VOUCHERS WHERE EMPLOYEE_ID=:employee AND VOUCHER_DATE=TO_DATE(:day,'YYYY-MM-DD') AND SHIFT_NUMBER=:shift AND SERVICE_CODE=:service AND VOUCHER_TYPE='NORMAL_TURNO' AND STATUS<>'ANULADO'", c =>
            {
                OracleStore.AddText(c, "employee", user.UserId); OracleStore.AddText(c, "day", now.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
                OracleStore.AddInt(c, "shift", employee.Employee.NumeroTurno.Value); OracleStore.AddText(c, "service", selected.Service.Codigo);
            }, r => OracleStore.Int(r, "N"), ct);
            if (count >= employee.Employee.MaxValesPorHorario) throw new DomainException(409, "MULTIPLE_SERVICES_IN_WINDOW", "Ya alcanzaste el máximo de vales permitido para este horario.");
            var beneficiary = visitor ?? employee.Employee.NombreCompleto;
            var idempotency = $"{user.UserId}:{selected.Service.Codigo}:{now.Date:yyyyMMdd}:{beneficiary.ToUpperInvariant()}";
            var voucher = NewVoucher(user, employee.Employee, selected.Service, selected.Window, valuation.ValorClp, body.SucursalEmisionCodigo ?? employee.Employee.SucursalAsignadaCodigo ?? employee.Employee.SucursalBaseCodigo, "NORMAL_TURNO", now.Date, beneficiary, idempotency);
            await InsertVoucher(db, voucher, printed: true, ct);
            timer.Stop();
            return Results.Created($"/vouchers/{voucher.Id}", new { voucher = await FindVoucher(db, "ID=:id", c => OracleStore.AddText(c, "id", voucher.Id), ct), elapsedMs = timer.ElapsedMilliseconds });
        });
        app.MapPost("/vouchers/additional", async (AdditionalVoucherRequest body, HttpContext context, CancellationToken ct) =>
        {
            var user = RequestContext.Require(context);
            RequestContext.RequireRole(context, "ADMINISTRADOR");
            if (body.MotivoAdicional.Trim().Length is < 4 or > 255 || body.TipoVale is not ("ADICIONAL_REUNION" or "VISITA_NO_PERSONALIZADO"))
                throw new DomainException(400, "VALIDATION_ERROR", "Tipo de vale o motivo inválido.");
            var services = await internalHttp.GetAsync<ServiceListResponse>("INVENTORY", "/services?activo=true", user, context.TraceIdentifier, ct);
            var service = services.Services.FirstOrDefault(s => s.Codigo == body.ServicioCodigo)
                ?? throw new DomainException(404, "SERVICE_NOT_FOUND", "Servicio de alimentación no encontrado.");
            EmployeeDto? beneficiaryEmployee = null;
            if (body.TipoVale == "ADICIONAL_REUNION" && !string.IsNullOrWhiteSpace(body.FuncionarioCodigo))
            {
                var employees = await internalHttp.GetAsync<EmployeeListResponse>("CLIENTS", "/employees", user, context.TraceIdentifier, ct);
                beneficiaryEmployee = employees.Employees.FirstOrDefault(e => e.CodigoFuncionario == body.FuncionarioCodigo);
            }
            if (body.TipoVale == "ADICIONAL_REUNION" && beneficiaryEmployee is null)
                throw new DomainException(404, "EMPLOYEE_NOT_FOUND", "El funcionario beneficiario no está registrado.");
            var profile = beneficiaryEmployee?.PerfilCodigo ?? "VISITA";
            var valuation = service.Valorizaciones.FirstOrDefault(v => v.PerfilCodigo == profile && v.Vigente)
                ?? throw new DomainException(422, "VALUATION_NOT_FOUND", "El servicio no tiene una valorización para el perfil beneficiario.");
            var now = SantiagoNow(configuration);
            var windows = service.Horarios.FirstOrDefault(w => w.NumeroTurno == (beneficiaryEmployee?.NumeroTurno ?? 1))
                ?? new ServiceWindowDto(beneficiaryEmployee?.NumeroTurno ?? 1, "00:00", "24:00");
            var beneficiary = beneficiaryEmployee?.NombreCompleto ?? (body.NombreBeneficiarioVisita?.Trim() is { Length: > 1 } name ? name : "Visita Externa");
            var employeeContext = beneficiaryEmployee is null ? new EmployeeDto("", "", beneficiary, "FUNCIONARIO", true, profile, "Visita", false, 1, "", "", null, null) : beneficiaryEmployee;
            var voucher = NewVoucher(user, employeeContext, service, windows, valuation.ValorClp, body.SucursalEmisionCodigo ?? "CENTRAL", body.TipoVale, now.Date, beneficiary, $"ADDITIONAL:{Guid.NewGuid():N}", body.MotivoAdicional.Trim());
            await InsertVoucher(db, voucher, body.ImprimirInmediato, ct);
            return Results.Created($"/vouchers/{voucher.Id}", new { voucher = await FindVoucher(db, "ID=:id", c => OracleStore.AddText(c, "id", voucher.Id), ct) });
        });
        app.MapPost("/vouchers/{id}/print", async (string id, HttpContext context, CancellationToken ct) =>
        {
            var user = RequestContext.Require(context);
            var voucher = await FindVoucher(db, "ID=:id", c => OracleStore.AddText(c, "id", id), ct)
                ?? throw new DomainException(404, "VOUCHER_NOT_FOUND", "Vale no encontrado.");
            AuthorizeOwner(user, voucher);
            var changed = await db.ExecuteAsync("UPDATE ORDERS_SVC.VOUCHERS SET STATUS='IMPRESO',PRINTED_AT=SYSTIMESTAMP WHERE ID=:id AND STATUS='EMITIDO'", c => OracleStore.AddText(c, "id", id), ct);
            if (changed != 1) throw new DomainException(409, "INVALID_STATE_TRANSITION", "El vale no se puede imprimir en su estado actual.");
            return Results.Ok(new { voucher = await FindVoucher(db, "ID=:id", c => OracleStore.AddText(c, "id", id), ct) });
        });
        app.MapPost("/vouchers/{id}/cancel", async (string id, HttpContext context, CancellationToken ct) =>
        {
            RequestContext.RequireRole(context, "ADMINISTRADOR");
            var changed = await db.ExecuteAsync("UPDATE ORDERS_SVC.VOUCHERS SET STATUS='ANULADO',CANCELLED_AT=SYSTIMESTAMP WHERE ID=:id AND STATUS IN ('EMITIDO','IMPRESO')", c => OracleStore.AddText(c, "id", id), ct);
            if (changed != 1) throw new DomainException(409, "VOUCHER_CANNOT_BE_CANCELLED", "El vale no existe o ya fue canjeado/anulado.");
            return Results.Ok(new { voucher = await FindVoucher(db, "ID=:id", c => OracleStore.AddText(c, "id", id), ct) });
        });
        app.MapPost("/vouchers/{numeroVale}/redeem", async (string numeroVale, RedeemRequest body, HttpContext context, CancellationToken ct) =>
        {
            RequestContext.RequireRole(context, "CAJERO");
            var user = RequestContext.Require(context);
            if (body.Items is null || body.Items.Count == 0 || body.Items.Count > 50)
                throw new DomainException(400, "VALIDATION_ERROR", "El canje debe incluir productos.");
            var voucher = await FindVoucher(db, "VOUCHER_NUMBER=:voucher_number", c => OracleStore.AddText(c, "voucher_number", numeroVale.ToUpperInvariant()), ct)
                ?? throw new DomainException(404, "VOUCHER_NOT_FOUND", "Vale no encontrado.");
            if (voucher.Estado != "IMPRESO") throw new DomainException(409, "VALE_YA_CANJEADO", "Solo se pueden canjear vales impresos vigentes.");
            var quote = await internalHttp.PostAsync<QuoteDto>("INVENTORY", "/internal/products/quote", new QuoteRequest(body.Items), user, context.TraceIdentifier, ct);
            var cover = Math.Min(voucher.ValorClp, quote.TotalConsumoClp);
            var favor = Math.Max(0, voucher.ValorClp - quote.TotalConsumoClp);
            var difference = Math.Max(0, quote.TotalConsumoClp - voucher.ValorClp);
            var payment = await internalHttp.PostAsync<PaymentResponse>("PAYMENTS", "/transactions/settle", new SettleRequest(
                $"VOUCHER:{voucher.Id}", voucher.Id, voucher.NumeroVale, voucher.FuncionarioId ?? "VISITA", user.UserId,
                body.CasinoCodigo, voucher.ValorClp, quote.TotalConsumoClp, difference == 0 ? "NO_APLICA" : body.MetodoPagoDiferencia), user, context.TraceIdentifier, ct);
            var redemptionId = Guid.NewGuid().ToString();
            await db.TransactionAsync(async (connection, transaction, token) =>
            {
                await using var update = new OracleCommand("UPDATE ORDERS_SVC.VOUCHERS SET STATUS='CANJEADO',REDEEMED_AT=SYSTIMESTAMP WHERE ID=:id AND STATUS='IMPRESO'", connection) { BindByName = true, Transaction = transaction };
                OracleStore.AddText(update, "id", voucher.Id);
                if (await update.ExecuteNonQueryAsync(token) != 1) throw new DomainException(409, "VALE_YA_CANJEADO", "Este vale ya fue consumido por otra caja.");
                await using var insert = new OracleCommand("INSERT INTO ORDERS_SVC.REDEMPTIONS (ID,VOUCHER_ID,VOUCHER_NUMBER,CASHIER_ID,CASHIER_CODE,CASINO_CODE,TOTAL_CLP,AMOUNT_COVERED_CLP,FAVOR_BALANCE_CLP,DIFFERENCE_CLP,PAYMENT_ID) VALUES (:id,:voucher_id,:voucher_number,:cashier_id,:cashier_code,:casino,:total,:covered,:favor,:difference,:payment_id)", connection) { BindByName = true, Transaction = transaction };
                OracleStore.AddText(insert, "id", redemptionId); OracleStore.AddText(insert, "voucher_id", voucher.Id); OracleStore.AddText(insert, "voucher_number", voucher.NumeroVale);
                OracleStore.AddText(insert, "cashier_id", user.UserId); OracleStore.AddText(insert, "cashier_code", user.Code); OracleStore.AddText(insert, "casino", body.CasinoCodigo);
                OracleStore.AddInt(insert, "total", quote.TotalConsumoClp); OracleStore.AddInt(insert, "covered", cover); OracleStore.AddInt(insert, "favor", favor); OracleStore.AddInt(insert, "difference", difference);
                OracleStore.AddText(insert, "payment_id", payment.Transaction.Id);
                await insert.ExecuteNonQueryAsync(token);
                foreach (var item in quote.Items)
                {
                    await using var itemCmd = new OracleCommand("INSERT INTO ORDERS_SVC.REDEMPTION_ITEMS (ID,REDEMPTION_ID,PRODUCT_ID,PRODUCT_CODE,PRODUCT_NAME,QUANTITY,UNIT_PRICE_CLP,SUBTOTAL_CLP) VALUES (:id,:redemption,:product,:code,:name,:quantity,:price,:subtotal)", connection) { BindByName = true, Transaction = transaction };
                    OracleStore.AddText(itemCmd, "id", Guid.NewGuid().ToString()); OracleStore.AddText(itemCmd, "redemption", redemptionId); OracleStore.AddText(itemCmd, "product", item.ProductoId);
                    OracleStore.AddText(itemCmd, "code", item.ProductoCodigo); OracleStore.AddText(itemCmd, "name", item.ProductoNombre); OracleStore.AddInt(itemCmd, "quantity", item.Cantidad);
                    OracleStore.AddInt(itemCmd, "price", item.PrecioUnitarioClp); OracleStore.AddInt(itemCmd, "subtotal", item.SubtotalClp); await itemCmd.ExecuteNonQueryAsync(token);
                }
                return redemptionId;
            }, ct);
            return Results.Created($"/vouchers/{voucher.Id}", new { voucher = await FindVoucher(db, "ID=:id", c => OracleStore.AddText(c, "id", voucher.Id), ct), redemption = new { id = redemptionId, casinoCodigo = body.CasinoCodigo, items = quote.Items, totalConsumoClp = quote.TotalConsumoClp, valorValeClp = voucher.ValorClp, saldoAFavorClp = favor, diferenciaPagadaClp = difference }, paymentTransaction = payment.Transaction });
        });
        app.MapGet("/reports/audit", async (HttpContext context, CancellationToken ct) =>
        {
            RequestContext.RequireRole(context, "ADMINISTRADOR");
            var summary = await db.OneAsync("SELECT COUNT(*) TOTAL_REGISTROS,SUM(CASE WHEN STATUS='EMITIDO' THEN 1 ELSE 0 END) DISPONIBLES,SUM(CASE WHEN STATUS='IMPRESO' THEN 1 ELSE 0 END) NO_USADOS,SUM(CASE WHEN STATUS='CANJEADO' THEN 1 ELSE 0 END) CANJEADOS,SUM(CASE WHEN STATUS='ANULADO' THEN 1 ELSE 0 END) ANULADOS,NVL(SUM(CASE WHEN STATUS<>'ANULADO' THEN AMOUNT_CLP ELSE 0 END),0) MONTO_EMITIDO,NVL(SUM(CASE WHEN STATUS='CANJEADO' THEN AMOUNT_CLP ELSE 0 END),0) MONTO_CANJEADO FROM ORDERS_SVC.VOUCHERS", null,
                r => new { totalRegistros = OracleStore.Int(r, "TOTAL_REGISTROS"), disponiblesSinImprimir = OracleStore.Int(r, "DISPONIBLES"), impresosNoUsados = OracleStore.Int(r, "NO_USADOS"), canjeadosUsados = OracleStore.Int(r, "CANJEADOS"), anulados = OracleStore.Int(r, "ANULADOS"), montoEmitidoValidoClp = OracleStore.Int(r, "MONTO_EMITIDO"), montoCanjeadoClp = OracleStore.Int(r, "MONTO_CANJEADO") }, ct);
            var byService = await db.ManyAsync("SELECT SERVICE_CODE,SERVICE_NAME,SUM(CASE WHEN STATUS='EMITIDO' THEN 1 ELSE 0 END) ISSUED,SUM(CASE WHEN STATUS='IMPRESO' THEN 1 ELSE 0 END) UNUSED,SUM(CASE WHEN STATUS='CANJEADO' THEN 1 ELSE 0 END) REDEEMED,SUM(CASE WHEN STATUS='ANULADO' THEN 1 ELSE 0 END) CANCELLED,COUNT(*) TOTAL,NVL(SUM(CASE WHEN STATUS<>'ANULADO' THEN AMOUNT_CLP ELSE 0 END),0) AMOUNT FROM ORDERS_SVC.VOUCHERS GROUP BY SERVICE_CODE,SERVICE_NAME ORDER BY SERVICE_CODE", null,
                r => new { servicioCodigo = OracleStore.Text(r, "SERVICE_CODE"), servicioNombre = OracleStore.Text(r, "SERVICE_NAME"), emitidosSinImprimir = OracleStore.Int(r, "ISSUED"), impresosNoUsados = OracleStore.Int(r, "UNUSED"), canjeados = OracleStore.Int(r, "REDEEMED"), anulados = OracleStore.Int(r, "CANCELLED"), totalValidos = OracleStore.Int(r, "TOTAL"), montoTotalClp = OracleStore.Int(r, "AMOUNT") }, ct);
            var byEmployee = await db.ManyAsync("SELECT NVL(EMPLOYEE_CODE,'VISITA') EMPLOYEE_CODE,BENEFICIARY_NAME,SUM(CASE WHEN STATUS='EMITIDO' THEN 1 ELSE 0 END) AVAILABLE,SUM(CASE WHEN STATUS='IMPRESO' THEN 1 ELSE 0 END) UNUSED,SUM(CASE WHEN STATUS='CANJEADO' THEN 1 ELSE 0 END) REDEEMED FROM ORDERS_SVC.VOUCHERS GROUP BY EMPLOYEE_CODE,BENEFICIARY_NAME ORDER BY EMPLOYEE_CODE", null,
                r => new { codigoFuncionario = OracleStore.Text(r, "EMPLOYEE_CODE"), nombreBeneficiario = OracleStore.Text(r, "BENEFICIARY_NAME"), disponibles = OracleStore.Int(r, "AVAILABLE"), impresosNoUsados = OracleStore.Int(r, "UNUSED"), canjeados = OracleStore.Int(r, "REDEEMED") }, ct);
            return Results.Ok(new { summary, byService, byEmployee });
        });
    }

    private static async Task<VoucherDto?> FindVoucher(OracleStore db, string predicate, Action<OracleCommand> bind, CancellationToken ct)
        => await db.OneAsync($"SELECT ID,VOUCHER_NUMBER,EMPLOYEE_ID,EMPLOYEE_CODE,BENEFICIARY_NAME,PROFILE_CODE,SERVICE_CODE,SERVICE_NAME,VOUCHER_TYPE,SHIFT_NUMBER,TO_CHAR(VOUCHER_DATE,'YYYY-MM-DD') VOUCHER_DATE,START_TIME,END_TIME,AMOUNT_CLP,BRANCH_CODE,STATUS,ISSUED_AT,PRINTED_AT,REDEEMED_AT,REASON FROM ORDERS_SVC.VOUCHERS WHERE {predicate}", bind, MapVoucher, ct);

    private static async Task<IReadOnlyList<VoucherDto>> FindVouchers(OracleStore db, string predicate, Action<OracleCommand> bind, CancellationToken ct)
        => await db.ManyAsync($"SELECT ID,VOUCHER_NUMBER,EMPLOYEE_ID,EMPLOYEE_CODE,BENEFICIARY_NAME,PROFILE_CODE,SERVICE_CODE,SERVICE_NAME,VOUCHER_TYPE,SHIFT_NUMBER,TO_CHAR(VOUCHER_DATE,'YYYY-MM-DD') VOUCHER_DATE,START_TIME,END_TIME,AMOUNT_CLP,BRANCH_CODE,STATUS,ISSUED_AT,PRINTED_AT,REDEEMED_AT,REASON FROM ORDERS_SVC.VOUCHERS WHERE {predicate} ORDER BY ISSUED_AT DESC FETCH FIRST 200 ROWS ONLY", bind, MapVoucher, ct);

    private static VoucherDto MapVoucher(OracleDataReader r) => new(OracleStore.Text(r, "ID"), OracleStore.Text(r, "VOUCHER_NUMBER"), OracleStore.NullableText(r, "EMPLOYEE_ID"), OracleStore.NullableText(r, "EMPLOYEE_CODE"),
        OracleStore.Text(r, "BENEFICIARY_NAME"), OracleStore.Text(r, "PROFILE_CODE"), OracleStore.Text(r, "SERVICE_CODE"), OracleStore.Text(r, "SERVICE_NAME"), OracleStore.Text(r, "VOUCHER_TYPE"),
        OracleStore.Int(r, "SHIFT_NUMBER"), OracleStore.Text(r, "VOUCHER_DATE"), OracleStore.Text(r, "START_TIME"), OracleStore.Text(r, "END_TIME"), OracleStore.Int(r, "AMOUNT_CLP"), OracleStore.Text(r, "BRANCH_CODE"), OracleStore.Text(r, "STATUS"),
        OracleStore.Date(r, "ISSUED_AT"), OracleStore.NullableDate(r, "PRINTED_AT"), OracleStore.NullableDate(r, "REDEEMED_AT"), OracleStore.NullableText(r, "REASON"));

    private static VoucherInsert NewVoucher(UserContext issuer, EmployeeDto employee, FoodServiceDto service, ServiceWindowDto window,
        int amount, string branchCode, string type, DateOnly date, string beneficiary, string key, string? reason = null)
        => new(Guid.NewGuid().ToString(), $"VAL-{date:yyyyMMdd}-{Guid.NewGuid():N}"[..19].ToUpperInvariant(), key,
            string.IsNullOrWhiteSpace(employee.Id) ? null : employee.Id, string.IsNullOrWhiteSpace(employee.CodigoFuncionario) ? null : employee.CodigoFuncionario,
            beneficiary, employee.PerfilCodigo, service.Id, service.Codigo, service.Nombre, type, window.NumeroTurno, date, window.HoraInicio, window.HoraFin, amount,
            branchCode.Trim().ToUpperInvariant(), issuer.UserId, reason);

    private static async Task InsertVoucher(OracleStore db, VoucherInsert voucher, bool printed, CancellationToken ct)
    {
        await db.ExecuteAsync("INSERT INTO ORDERS_SVC.VOUCHERS (ID,VOUCHER_NUMBER,IDEMPOTENCY_KEY,EMPLOYEE_ID,EMPLOYEE_CODE,BENEFICIARY_NAME,PROFILE_CODE,SERVICE_ID,SERVICE_CODE,SERVICE_NAME,VOUCHER_TYPE,SHIFT_NUMBER,VOUCHER_DATE,START_TIME,END_TIME,AMOUNT_CLP,BRANCH_CODE,STATUS,REASON,ISSUED_BY_ID,PRINTED_AT) VALUES (:id,:voucher_number,:key,:employee_id,:employee_code,:beneficiary,:profile,:service_id,:service_code,:service_name,:type,:shift,TO_DATE(:voucher_date,'YYYY-MM-DD'),:start_time,:end_time,:amount,:branch,:status,:reason,:issued_by,:printed_at)", c =>
        {
            OracleStore.AddText(c, "id", voucher.Id); OracleStore.AddText(c, "voucher_number", voucher.Number); OracleStore.AddText(c, "key", voucher.IdempotencyKey);
            OracleStore.AddText(c, "employee_id", voucher.EmployeeId); OracleStore.AddText(c, "employee_code", voucher.EmployeeCode); OracleStore.AddText(c, "beneficiary", voucher.Beneficiary);
            OracleStore.AddText(c, "profile", voucher.ProfileCode); OracleStore.AddText(c, "service_id", voucher.ServiceId); OracleStore.AddText(c, "service_code", voucher.ServiceCode);
            OracleStore.AddText(c, "service_name", voucher.ServiceName); OracleStore.AddText(c, "type", voucher.Type); OracleStore.AddInt(c, "shift", voucher.Shift);
            OracleStore.AddText(c, "voucher_date", voucher.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)); OracleStore.AddText(c, "start_time", voucher.Start); OracleStore.AddText(c, "end_time", voucher.End);
            OracleStore.AddInt(c, "amount", voucher.Amount); OracleStore.AddText(c, "branch", voucher.BranchCode); OracleStore.AddText(c, "status", printed ? "IMPRESO" : "EMITIDO");
            OracleStore.AddText(c, "reason", voucher.Reason); OracleStore.AddText(c, "issued_by", voucher.IssuedBy);
            c.Parameters.Add("printed_at", OracleDbType.TimeStamp).Value = printed ? DateTime.UtcNow : DBNull.Value;
        }, ct);
    }

    private static void AuthorizeOwner(UserContext user, VoucherDto voucher)
    {
        if (user.Role == "FUNCIONARIO" && voucher.FuncionarioId != user.UserId)
            throw new DomainException(403, "FORBIDDEN", "No puedes consultar el vale de otra persona.");
    }

    private static async Task Insert(OracleConnection connection, OracleTransaction transaction, string sql, Action<OracleCommand> bind, CancellationToken ct)
    {
        await using var command = new OracleCommand(sql, connection) { BindByName = true, Transaction = transaction };
        bind(command); await command.ExecuteNonQueryAsync(ct);
    }

    private static (DateOnly Date, TimeOnly Time) SantiagoNow(IConfiguration configuration)
    {
        if (string.Equals(configuration["DOTNET_ENVIRONMENT"], "Testing", StringComparison.OrdinalIgnoreCase) &&
            DateTimeOffset.TryParse(configuration["APP_TEST_NOW_SANTIAGO"], CultureInfo.InvariantCulture, DateTimeStyles.None, out var testNow))
        {
            var testLocal = TimeZoneInfo.ConvertTime(testNow, TimeZoneInfo.FindSystemTimeZoneById("America/Santiago"));
            return (DateOnly.FromDateTime(testLocal.DateTime), TimeOnly.FromDateTime(testLocal.DateTime));
        }
        var timezone = TimeZoneInfo.FindSystemTimeZoneById("America/Santiago");
        var local = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, timezone);
        return (DateOnly.FromDateTime(local.DateTime), TimeOnly.FromDateTime(local.DateTime));
    }

    private static bool WithinWindow(TimeOnly now, string start, string end)
    {
        var from = TimeOnly.ParseExact(start, "HH:mm", CultureInfo.InvariantCulture);
        var to = end == "24:00" ? TimeOnly.MinValue : TimeOnly.ParseExact(end, "HH:mm", CultureInfo.InvariantCulture);
        if (end == "24:00") return now >= from;
        return from <= to ? now >= from && now < to : now >= from || now < to;
    }

    private sealed record VoucherInsert(string Id, string Number, string IdempotencyKey, string? EmployeeId, string? EmployeeCode, string Beneficiary,
        string ProfileCode, string ServiceId, string ServiceCode, string ServiceName, string Type, int Shift, DateOnly Date,
        string Start, string End, int Amount, string BranchCode, string IssuedBy, string? Reason);
    private sealed record EmployeeResponse(EmployeeDto Employee);
    private sealed record EmployeeListResponse(IReadOnlyList<EmployeeDto> Employees);
    private sealed record ServiceListResponse(IReadOnlyList<FoodServiceDto> Services);
    private sealed record PaymentResponse(PaymentTransactionDto Transaction);
}
