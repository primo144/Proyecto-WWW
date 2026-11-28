using Oracle.ManagedDataAccess.Client;

namespace Libros.Api;

public static class PaymentsModule
{
    public static void Map(WebApplication app)
    {
        var db = app.Services.GetRequiredService<OracleStore>();
        var notices = app.Services.GetRequiredService<WeeklyNoticeService>();
        app.MapGet("/health", (CancellationToken ct) => ServiceHealth.Oracle(db, "payments", ct));
        app.MapPost("/transactions/settle", async (SettleRequest body, HttpContext context, CancellationToken ct) =>
        {
            RequestContext.RequireRole(context, "CAJERO", "ADMINISTRADOR");
            if (string.IsNullOrWhiteSpace(body.IdempotencyKey) || body.IdempotencyKey.Length > 120 || body.TotalConsumoClp <= 0 || body.ValorValeClp <= 0)
                throw new DomainException(400, "VALIDATION_ERROR", "La liquidación tiene datos incompletos o inválidos.");
            var existing = await FindByKey(db, body.IdempotencyKey, ct);
            if (existing is not null)
            {
                EnsureSameSettlement(existing, body);
                return Results.Ok(new { transaction = existing, idempotentReplay = true });
            }
            var voucherCover = Math.Min(body.ValorValeClp, body.TotalConsumoClp);
            var favor = Math.Max(0, body.ValorValeClp - body.TotalConsumoClp);
            var difference = Math.Max(0, body.TotalConsumoClp - body.ValorValeClp);
            var method = body.MetodoPagoDiferencia.ToUpperInvariant();
            if (difference == 0) method = "NO_APLICA";
            else if (method is not ("EFECTIVO" or "TARJETA_DEBITO" or "TARJETA_CREDITO"))
                throw new DomainException(400, "PAYMENT_METHOD_REQUIRED", "Selecciona un medio de pago para la diferencia.");
            var id = Guid.NewGuid().ToString();
            try
            {
                await db.ExecuteAsync("INSERT INTO PAYMENTS_SVC.TRANSACTIONS (ID,IDEMPOTENCY_KEY,VOUCHER_ID,VOUCHER_NUMBER,EMPLOYEE_ID,CASHIER_ID,CASINO_CODE,VOUCHER_AMOUNT_CLP,TOTAL_CLP,COVERED_CLP,FAVOR_BALANCE_CLP,DIFFERENCE_CLP,PAYMENT_METHOD,STATUS) VALUES (:id,:idempotency_key,:voucher_identifier,:voucher_number,:employee_identifier,:cashier_identifier,:casino_identifier,:voucher_value,:consumption_total,:voucher_covered,:favour_amount,:difference_amount,:payment_method,'LIQUIDADO')", c =>
                {
                    OracleStore.AddText(c, "id", id); OracleStore.AddText(c, "idempotency_key", body.IdempotencyKey); OracleStore.AddText(c, "voucher_identifier", body.ValeId);
                    OracleStore.AddText(c, "voucher_number", body.NumeroVale); OracleStore.AddText(c, "employee_identifier", body.FuncionarioId); OracleStore.AddText(c, "cashier_identifier", body.CajeroId);
                    OracleStore.AddText(c, "casino_identifier", body.CasinoCodigo); OracleStore.AddInt(c, "voucher_value", body.ValorValeClp); OracleStore.AddInt(c, "consumption_total", body.TotalConsumoClp);
                    OracleStore.AddInt(c, "voucher_covered", voucherCover); OracleStore.AddInt(c, "favour_amount", favor); OracleStore.AddInt(c, "difference_amount", difference); OracleStore.AddText(c, "payment_method", method);
                }, ct);
            }
            catch (OracleException ex) when (ex.Number == 1)
            {
                existing = await FindByKey(db, body.IdempotencyKey, ct);
                if (existing is null) throw;
                EnsureSameSettlement(existing, body);
                return Results.Ok(new { transaction = existing, idempotentReplay = true });
            }
            var transaction = await FindByKey(db, body.IdempotencyKey, ct)
                ?? throw new DomainException(500, "PAYMENT_NOT_PERSISTED", "No se encontró la liquidación recién registrada.");
            return Results.Created($"/transactions/{transaction.Id}", new { transaction, idempotentReplay = false });
        });

        app.MapGet("/transactions", async (HttpContext context, string? casinoCodigo, string? valeId, CancellationToken ct) =>
        {
            var user = RequestContext.Require(context);
            if (user.Role is not ("CAJERO" or "ADMINISTRADOR")) throw new DomainException(403, "FORBIDDEN", "No tienes permiso para consultar liquidaciones.");
            var filters = new List<string>();
            if (user.Role == "CAJERO") filters.Add("CASHIER_ID=:cashier");
            if (!string.IsNullOrWhiteSpace(casinoCodigo)) filters.Add("CASINO_CODE=:casino");
            if (!string.IsNullOrWhiteSpace(valeId)) filters.Add("VOUCHER_ID=:voucher");
            var transactions = await db.ManyAsync("SELECT ID,VOUCHER_ID,VOUCHER_NUMBER,VOUCHER_AMOUNT_CLP,TOTAL_CLP,COVERED_CLP,FAVOR_BALANCE_CLP,DIFFERENCE_CLP,PAYMENT_METHOD,STATUS,CREATED_AT FROM PAYMENTS_SVC.TRANSACTIONS WHERE " + (filters.Count == 0 ? "1=1" : string.Join(" AND ", filters)) + " ORDER BY CREATED_AT DESC FETCH FIRST 200 ROWS ONLY", c =>
            {
                if (user.Role == "CAJERO") OracleStore.AddText(c, "cashier", user.UserId);
                if (!string.IsNullOrWhiteSpace(casinoCodigo)) OracleStore.AddText(c, "casino", casinoCodigo.ToUpperInvariant());
                if (!string.IsNullOrWhiteSpace(valeId)) OracleStore.AddText(c, "voucher", valeId);
            }, MapTransaction, ct);
            return Results.Ok(new { transactions });
        });
        app.MapGet("/reconciliation", async (HttpContext context, CancellationToken ct) =>
        {
            RequestContext.RequireRole(context, "ADMINISTRADOR");
            var summaryByCasino = await Reconciliation(db, ct);
            var closures = await db.ManyAsync("SELECT ID,CASINO_CODE,CLOSURE_YEAR,CLOSURE_MONTH,VOUCHER_COUNT,VOUCHER_AMOUNT_CLP,CONSUMPTION_CLP,DIFFERENCE_CLP,FAVOR_BALANCE_CLP,STATUS,CREATED_AT FROM PAYMENTS_SVC.RECONCILIATIONS ORDER BY CLOSURE_YEAR DESC,CLOSURE_MONTH DESC", null,
                r => new { id = OracleStore.Text(r, "ID"), casinoCodigo = OracleStore.Text(r, "CASINO_CODE"), anio = OracleStore.Int(r, "CLOSURE_YEAR"), mes = OracleStore.Int(r, "CLOSURE_MONTH"), totalValesCanjeados = OracleStore.Int(r, "VOUCHER_COUNT"), totalValorValesClp = OracleStore.Int(r, "VOUCHER_AMOUNT_CLP"), totalConsumoClp = OracleStore.Int(r, "CONSUMPTION_CLP"), totalDiferenciasClp = OracleStore.Int(r, "DIFFERENCE_CLP"), totalSaldosNoUsadosClp = OracleStore.Int(r, "FAVOR_BALANCE_CLP"), estado = OracleStore.Text(r, "STATUS"), generadaEn = OracleStore.Date(r, "CREATED_AT") }, ct);
            return Results.Ok(new { summaryByCasino, closures });
        });
        app.MapPost("/reconciliation/close", async (CloseReconciliationRequest body, HttpContext context, CancellationToken ct) =>
        {
            var user = RequestContext.Require(context);
            RequestContext.RequireRole(context, "ADMINISTRADOR");
            if (body.Anio is < 2024 or > 2100 || body.Mes is < 1 or > 12 || string.IsNullOrWhiteSpace(body.CasinoCodigo))
                throw new DomainException(400, "VALIDATION_ERROR", "Casino, año o mes de cierre inválido.");
            var totals = await db.OneAsync("SELECT COUNT(*) N,NVL(SUM(VOUCHER_AMOUNT_CLP),0) VOUCHER_TOTAL,NVL(SUM(TOTAL_CLP),0) CONSUMPTION,NVL(SUM(DIFFERENCE_CLP),0) DIFFERENCE,NVL(SUM(FAVOR_BALANCE_CLP),0) FAVOR FROM PAYMENTS_SVC.TRANSACTIONS WHERE CASINO_CODE=:casino AND EXTRACT(YEAR FROM CREATED_AT)=:year AND EXTRACT(MONTH FROM CREATED_AT)=:month", c =>
            {
                OracleStore.AddText(c, "casino", body.CasinoCodigo.ToUpperInvariant()); OracleStore.AddInt(c, "year", body.Anio); OracleStore.AddInt(c, "month", body.Mes);
            }, r => new { Count = OracleStore.Int(r, "N"), Vouchers = OracleStore.Int(r, "VOUCHER_TOTAL"), Consumption = OracleStore.Int(r, "CONSUMPTION"), Difference = OracleStore.Int(r, "DIFFERENCE"), Favor = OracleStore.Int(r, "FAVOR") }, ct)
                ?? throw new DomainException(500, "RECONCILIATION_FAILED", "No se pudieron calcular los totales del cierre.");
            var id = Guid.NewGuid().ToString();
            await db.ExecuteAsync("MERGE INTO PAYMENTS_SVC.RECONCILIATIONS t USING (SELECT :casino CASINO_CODE,:year CLOSURE_YEAR,:month CLOSURE_MONTH FROM dual) s ON (t.CASINO_CODE=s.CASINO_CODE AND t.CLOSURE_YEAR=s.CLOSURE_YEAR AND t.CLOSURE_MONTH=s.CLOSURE_MONTH) WHEN MATCHED THEN UPDATE SET t.VOUCHER_COUNT=:count,t.VOUCHER_AMOUNT_CLP=:vouchers,t.CONSUMPTION_CLP=:consumption,t.DIFFERENCE_CLP=:difference,t.FAVOR_BALANCE_CLP=:favor,t.STATUS='CERRADA',t.CREATED_BY=:user_id,t.CREATED_AT=SYSTIMESTAMP WHEN NOT MATCHED THEN INSERT (ID,CASINO_CODE,CLOSURE_YEAR,CLOSURE_MONTH,VOUCHER_COUNT,VOUCHER_AMOUNT_CLP,CONSUMPTION_CLP,DIFFERENCE_CLP,FAVOR_BALANCE_CLP,STATUS,CREATED_BY) VALUES (:id,:casino,:year,:month,:count,:vouchers,:consumption,:difference,:favor,'CERRADA',:user_id)", c =>
            {
                OracleStore.AddText(c, "casino", body.CasinoCodigo.ToUpperInvariant()); OracleStore.AddInt(c, "year", body.Anio); OracleStore.AddInt(c, "month", body.Mes);
                OracleStore.AddInt(c, "count", totals.Count); OracleStore.AddInt(c, "vouchers", totals.Vouchers); OracleStore.AddInt(c, "consumption", totals.Consumption);
                OracleStore.AddInt(c, "difference", totals.Difference); OracleStore.AddInt(c, "favor", totals.Favor); OracleStore.AddText(c, "user_id", user.UserId); OracleStore.AddText(c, "id", id);
            }, ct);
            return Results.Created("/reconciliation", new { closure = new { id, casinoCodigo = body.CasinoCodigo.ToUpperInvariant(), anio = body.Anio, mes = body.Mes, totalValesCanjeados = totals.Count, totalValorValesClp = totals.Vouchers, totalConsumoClp = totals.Consumption, totalDiferenciasClp = totals.Difference, totalSaldosNoUsadosClp = totals.Favor, estado = "CERRADA" } });
        });
        app.MapPost("/notifications/weekly/run", async (WeeklyRunRequest body, HttpContext context, CancellationToken ct) =>
        {
            RequestContext.RequireRole(context, "ADMINISTRADOR");
            var (start, end) = DateRanges.NoticeRange(body.FechaInicio, body.FechaFin);
            return Results.Ok(await notices.RunAsync(start, end, ct));
        });
        app.MapGet("/notifications/weekly", async (HttpContext context, CancellationToken ct) =>
        {
            var user = RequestContext.Require(context);
            var admin = user.Role == "ADMINISTRADOR";
            var rows = await db.ManyAsync("SELECT ID,EMPLOYEE_ID,EMPLOYEE_CODE,EMAIL_ADDRESS,TO_CHAR(WEEK_START,'YYYY-MM-DD') WEEK_START,TO_CHAR(WEEK_END,'YYYY-MM-DD') WEEK_END,VOUCHERS_AVAILABLE,VOUCHERS_USED,VOUCHERS_UNUSED,DELIVERY_STATUS FROM PAYMENTS_SVC.WEEKLY_NOTICES WHERE (:admin=1 OR EMPLOYEE_ID=:employee) ORDER BY WEEK_START DESC,EMPLOYEE_CODE FETCH FIRST 200 ROWS ONLY", c =>
            {
                OracleStore.AddInt(c, "admin", admin ? 1 : 0); OracleStore.AddText(c, "employee", user.UserId);
            }, r => new WeeklyNoticeDto(OracleStore.Text(r, "ID"), OracleStore.Text(r, "EMPLOYEE_ID"), OracleStore.Text(r, "EMPLOYEE_CODE"), admin ? OracleStore.Text(r, "EMAIL_ADDRESS") : null,
                OracleStore.Text(r, "WEEK_START"), OracleStore.Text(r, "WEEK_END"), OracleStore.Int(r, "VOUCHERS_AVAILABLE"), OracleStore.Int(r, "VOUCHERS_USED"), OracleStore.Int(r, "VOUCHERS_UNUSED"), OracleStore.Text(r, "DELIVERY_STATUS")), ct);
            return Results.Ok(new { notifications = rows });
        });
    }

    private static async Task<PaymentTransactionDto?> FindByKey(OracleStore db, string key, CancellationToken ct)
        => await db.OneAsync("SELECT ID,VOUCHER_ID,VOUCHER_NUMBER,VOUCHER_AMOUNT_CLP,TOTAL_CLP,COVERED_CLP,FAVOR_BALANCE_CLP,DIFFERENCE_CLP,PAYMENT_METHOD,STATUS,CREATED_AT FROM PAYMENTS_SVC.TRANSACTIONS WHERE IDEMPOTENCY_KEY=:key", c => OracleStore.AddText(c, "key", key), MapTransaction, ct);

    private static PaymentTransactionDto MapTransaction(OracleDataReader r) => new(OracleStore.Text(r, "ID"), OracleStore.Text(r, "VOUCHER_ID"), OracleStore.Text(r, "VOUCHER_NUMBER"), OracleStore.Int(r, "VOUCHER_AMOUNT_CLP"), OracleStore.Int(r, "TOTAL_CLP"), OracleStore.Int(r, "COVERED_CLP"), OracleStore.Int(r, "FAVOR_BALANCE_CLP"), OracleStore.Int(r, "DIFFERENCE_CLP"), OracleStore.Text(r, "PAYMENT_METHOD"), OracleStore.Text(r, "STATUS"), OracleStore.Date(r, "CREATED_AT"));

    private static void EnsureSameSettlement(PaymentTransactionDto existing, SettleRequest incoming)
    {
        if (existing.ValeId != incoming.ValeId || existing.TotalConsumoClp != incoming.TotalConsumoClp || existing.ValorValeClp != incoming.ValorValeClp)
            throw new DomainException(409, "IDEMPOTENCY_KEY_REUSED", "La llave de idempotencia ya se usó con otros valores.");
    }

    public static async Task<IReadOnlyList<CasinoSettlementDto>> Reconciliation(OracleStore db, CancellationToken ct)
        => await db.ManyAsync("SELECT CASINO_CODE,COUNT(*) VOUCHERS,NVL(SUM(VOUCHER_AMOUNT_CLP),0) VOUCHER_TOTAL,NVL(SUM(TOTAL_CLP),0) CONSUMPTION,NVL(SUM(COVERED_CLP),0) COVERED,NVL(SUM(DIFFERENCE_CLP),0) DIFFERENCE,NVL(SUM(FAVOR_BALANCE_CLP),0) FAVOR FROM PAYMENTS_SVC.TRANSACTIONS GROUP BY CASINO_CODE ORDER BY CASINO_CODE", null,
            r => new CasinoSettlementDto(OracleStore.Text(r, "CASINO_CODE"), OracleStore.Int(r, "VOUCHERS"), OracleStore.Int(r, "VOUCHER_TOTAL"), OracleStore.Int(r, "CONSUMPTION"), OracleStore.Int(r, "COVERED"), OracleStore.Int(r, "DIFFERENCE"), OracleStore.Int(r, "FAVOR")), ct);
}

public sealed class WeeklyNoticeService(OracleStore db, IConfiguration configuration, IHttpClientFactory clients, ILogger<WeeklyNoticeService> logger)
{
    public async Task<WeeklyRunResult> RunAsync(DateOnly start, DateOnly end, CancellationToken ct)
    {
        if (end < start || end.DayNumber - start.DayNumber > 14)
            throw new DomainException(400, "INVALID_DATE_RANGE", "El periodo de avisos debe abarcar entre uno y catorce días.");
        await db.ExecuteAsync("BEGIN PAYMENTS_SVC.SP_GENERAR_AVISOS_SEMANALES(:p_inicio,:p_fin); END;", c =>
        {
            c.Parameters.Add("p_inicio", OracleDbType.Date).Value = start.ToDateTime(TimeOnly.MinValue);
            c.Parameters.Add("p_fin", OracleDbType.Date).Value = end.ToDateTime(TimeOnly.MinValue);
        }, ct);
        var notices = await db.ManyAsync("SELECT ID,EMPLOYEE_ID,EMPLOYEE_CODE,EMAIL_ADDRESS,TO_CHAR(WEEK_START,'YYYY-MM-DD') WEEK_START,TO_CHAR(WEEK_END,'YYYY-MM-DD') WEEK_END,VOUCHERS_AVAILABLE,VOUCHERS_USED,VOUCHERS_UNUSED,DELIVERY_STATUS FROM PAYMENTS_SVC.WEEKLY_NOTICES WHERE WEEK_START=TO_DATE(:start_date,'YYYY-MM-DD') AND WEEK_END=TO_DATE(:end_date,'YYYY-MM-DD') ORDER BY EMPLOYEE_CODE", c =>
        {
            OracleStore.AddText(c, "start_date", start.ToString("yyyy-MM-dd")); OracleStore.AddText(c, "end_date", end.ToString("yyyy-MM-dd"));
        }, r => new WeeklyNoticeDto(OracleStore.Text(r, "ID"), OracleStore.Text(r, "EMPLOYEE_ID"), OracleStore.Text(r, "EMPLOYEE_CODE"), OracleStore.Text(r, "EMAIL_ADDRESS"), OracleStore.Text(r, "WEEK_START"), OracleStore.Text(r, "WEEK_END"), OracleStore.Int(r, "VOUCHERS_AVAILABLE"), OracleStore.Int(r, "VOUCHERS_USED"), OracleStore.Int(r, "VOUCHERS_UNUSED"), OracleStore.Text(r, "DELIVERY_STATUS")), ct);
        var mode = configuration["EMAIL_PROVIDER_MODE"] ?? "sandbox";
        var delivered = new List<WeeklyNoticeDto>();
        foreach (var notice in notices)
        {
            if (notice.EstadoEnvio is "ENVIADO" or "ENVIADO_SANDBOX") { delivered.Add(notice); continue; }
            var accepted = mode == "sandbox";
            string providerMessage = "SANDBOX_OK";
            if (mode == "http")
            {
                var endpoint = configuration["EMAIL_API_URL"];
                var key = configuration["EMAIL_API_KEY"];
                if (string.IsNullOrWhiteSpace(endpoint) || string.IsNullOrWhiteSpace(key))
                    throw new DomainException(503, "EMAIL_PROVIDER_NOT_CONFIGURED", "EMAIL_API_URL y EMAIL_API_KEY son obligatorios para EMAIL_PROVIDER_MODE=http.");
                using var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
                request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", key);
                request.Content = System.Net.Http.Json.JsonContent.Create(new
                {
                    to = notice.EmailDestino,
                    subject = $"Resumen semanal de vales {notice.SemanaInicio}–{notice.SemanaFin}",
                    data = new { notice.ValesDisponibles, notice.ValesUsados, notice.ValesNoUsados }
                });
                using var response = await clients.CreateClient("email").SendAsync(request, ct);
                accepted = response.IsSuccessStatusCode;
                providerMessage = accepted ? "EMAIL_API_ACCEPTED" : $"EMAIL_API_HTTP_{(int)response.StatusCode}";
            }
            var state = accepted ? mode == "sandbox" ? "ENVIADO_SANDBOX" : "ENVIADO" : "ERROR";
            await db.ExecuteAsync("UPDATE PAYMENTS_SVC.WEEKLY_NOTICES SET DELIVERY_STATUS=:status,PROVIDER_MESSAGE=:message WHERE ID=:id", c =>
            {
                OracleStore.AddText(c, "status", state); OracleStore.AddText(c, "message", providerMessage, 255); OracleStore.AddText(c, "id", notice.Id);
            }, ct);
            delivered.Add(notice with { EstadoEnvio = state });
            logger.LogInformation("Aviso semanal procesado. employeeCode={EmployeeCode} state={State} providerMode={ProviderMode}", notice.CodigoFuncionario, state, mode);
        }
        return new WeeklyRunResult(start.ToString("yyyy-MM-dd"), end.ToString("yyyy-MM-dd"), mode, notices.Count, delivered.Count(x => x.EstadoEnvio.StartsWith("ENVIADO", StringComparison.Ordinal)), delivered);
    }
}

public sealed class WeeklyNoticeWorker(IServiceScopeFactory scopes, IConfiguration configuration, ILogger<WeeklyNoticeWorker> logger) : BackgroundService
{
    private readonly HashSet<string> _completedWeeks = [];

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!bool.TryParse(configuration["WEEKLY_NOTICES_ENABLED"], out var enabled) || !enabled) return;
        var zone = TimeZoneInfo.FindSystemTimeZoneById(configuration["APP_TIMEZONE"] ?? "America/Santiago");
        var clock = TimeOnly.TryParse(configuration["WEEKLY_NOTICES_TIME"], out var configuredTime) ? configuredTime : new TimeOnly(1, 0);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var now = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, zone);
                var previousMonday = DateOnly.FromDateTime(now.DateTime).AddDays(-(((int)now.DayOfWeek + 6) % 7) - 7);
                var weekEnd = previousMonday.AddDays(6);
                var key = previousMonday.ToString("yyyy-MM-dd");
                if (now.DayOfWeek == DayOfWeek.Monday && TimeOnly.FromDateTime(now.DateTime) >= clock && !_completedWeeks.Contains(key))
                {
                    using var scope = scopes.CreateScope();
                    var service = scope.ServiceProvider.GetRequiredService<WeeklyNoticeService>();
                    await service.RunAsync(previousMonday, weekEnd, stoppingToken);
                    _completedWeeks.Add(key);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogError(ex, "No se pudo ejecutar el job semanal de avisos; se reintentará en el siguiente intervalo."); }
            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
        }
    }
}

public sealed record WeeklyNoticeDto(string Id, string FuncionarioId, string CodigoFuncionario, string? EmailDestino,
    string SemanaInicio, string SemanaFin, int ValesDisponibles, int ValesUsados, int ValesNoUsados, string EstadoEnvio);
public sealed record WeeklyRunRequest(string? FechaInicio, string? FechaFin);
public sealed record CloseReconciliationRequest(string CasinoCodigo, int Anio, int Mes);
public sealed record CasinoSettlementDto(string CasinoCodigo, int TotalValesCanjeados, int TotalValorValesClp, int TotalConsumoClp, int TotalCubiertoValeClp, int TotalDiferenciasClp, int TotalSaldosNoUsadosClp);
public sealed record WeeklyRunResult(string SemanaInicio, string SemanaFin, string ProviderMode, int TotalProcesados, int DispatchedCount, IReadOnlyList<WeeklyNoticeDto> Notifications);

public static class DateRanges
{
    public static (DateOnly Start, DateOnly End) NoticeRange(string? startText, string? endText)
    {
        var end = string.IsNullOrWhiteSpace(endText) ? DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1) : Parse(endText);
        var start = string.IsNullOrWhiteSpace(startText) ? end.AddDays(-6) : Parse(startText);
        return (start, end);
    }
    private static DateOnly Parse(string text) => DateOnly.TryParseExact(text, "yyyy-MM-dd", out var date) ? date : throw new DomainException(400, "INVALID_DATE", "La fecha debe estar en formato YYYY-MM-DD.");
}
