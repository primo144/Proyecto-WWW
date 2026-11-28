using HotChocolate;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Libros.Api;

public static class GraphQLModule
{
    private static readonly Regex AliasPattern = new(@"\b[A-Za-z_][A-Za-z0-9_]*\s*:\s*[A-Za-z_][A-Za-z0-9_]*", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex FieldPattern = new(@"\b[A-Za-z_][A-Za-z0-9_]*\b", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static void ConfigureServices(IServiceCollection services)
    {
        services.AddHttpContextAccessor();
        services.AddGraphQLServer()
            .AddQueryType<GraphQuery>()
            .ModifyRequestOptions(options => options.IncludeExceptionDetails = false);
    }

    public static void Map(WebApplication app)
    {
        app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "graphql-gateway" }));
        app.Use(async (context, next) =>
        {
            if (context.Request.Path == "/graphql" && HttpMethods.IsPost(context.Request.Method))
            {
                context.Request.EnableBuffering();
                using var document = await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: context.RequestAborted);
                context.Request.Body.Position = 0;
                var query = document.RootElement.TryGetProperty("query", out var queryValue) ? queryValue.GetString() ?? "" : "";
                var depth = MaximumSelectionDepth(query);
                var complexity = Math.Max(0, FieldPattern.Matches(query).Count - AliasPattern.Matches(query).Count);
                if (depth > 4 || complexity > 500 || AliasPattern.Matches(query).Count > 40)
                {
                    var code = depth > 4 ? "GRAPHQL_DEPTH_LIMIT_EXCEEDED" : "GRAPHQL_COMPLEXITY_LIMIT_EXCEEDED";
                    context.Response.StatusCode = StatusCodes.Status400BadRequest;
                    await context.Response.WriteAsJsonAsync(new { errors = new[] { new { message = "La operación GraphQL supera los límites de recursos configurados.", extensions = new { code } } } }, context.RequestAborted);
                    return;
                }
            }
            await next(context);
        });
        app.MapGraphQL("/graphql");
    }

    private static int MaximumSelectionDepth(string query)
    {
        var depth = 0;
        var maximum = 0;
        var quoted = false;
        var escaped = false;
        foreach (var c in query)
        {
            if (quoted)
            {
                if (escaped) escaped = false;
                else if (c == '\\') escaped = true;
                else if (c == '"') quoted = false;
                continue;
            }
            if (c == '"') quoted = true;
            else if (c == '{') maximum = Math.Max(maximum, ++depth);
            else if (c == '}') depth = Math.Max(0, depth - 1);
        }
        return maximum;
    }
}

public sealed class GraphQuery
{
    [GraphQLName("miResumenComensal")]
    public async Task<MealSummaryGraph> GetMealSummary([Service] ServiceHttp http, [Service] IHttpContextAccessor accessor, [Service] IConfiguration configuration, CancellationToken ct)
    {
        var context = accessor.HttpContext ?? throw new GraphQLException("No hay contexto de solicitud.");
        var user = RequestContext.Require(context);
        var correlationId = InternalSecurity.CorrelationId(context);
        var employeeResponse = await http.GetAsync<EmployeeResponse>("CLIENTS", "/employees/me", user, correlationId, ct);
        var employee = employeeResponse.Employee;
        var partial = new List<PartialErrorGraph>();
        IReadOnlyList<FoodServiceGraph> services = [];
        IReadOnlyList<VoucherDto> recent = [];
        IReadOnlyList<WeeklyNoticeDto> weekly = [];
        IReadOnlyList<BranchDto> branches = [];

        var serviceTask = Safe(async () =>
        {
            if (employee.NumeroTurno is null) return;
            var envelope = await http.GetAsync<ServiceListResponse>("INVENTORY", $"/services?activo=true&turno={employee.NumeroTurno}&perfilCodigo={Uri.EscapeDataString(employee.PerfilCodigo)}", user, correlationId, ct);
            services = envelope.Services.Select(s =>
            {
                var window = s.Horarios.FirstOrDefault(w => w.NumeroTurno == employee.NumeroTurno);
                var active = window is not null && IsActiveNow(window.HoraInicio, window.HoraFin, configuration);
                var value = s.Valorizaciones.FirstOrDefault(v => v.PerfilCodigo == employee.PerfilCodigo && v.Vigente)?.ValorClp;
                return new FoodServiceGraph(s.Id, s.Codigo, s.Nombre, s.Descripcion, value, active, s.Horarios);
            }).ToArray();
        }, "inventory", partial);
        var ordersTask = Safe(async () =>
        {
            var envelope = await http.GetAsync<VoucherListResponse>("ORDERS", "/vouchers/my", user, correlationId, ct);
            recent = envelope.Vouchers;
        }, "orders", partial);
        var noticesTask = Safe(async () =>
        {
            var envelope = await http.GetAsync<NoticeListResponse>("PAYMENTS", "/notifications/weekly", user, correlationId, ct);
            weekly = envelope.Notifications;
        }, "payments", partial);
        var branchesTask = Safe(async () =>
        {
            var envelope = await http.GetAsync<BranchListResponse>("CLIENTS", "/public/branches", user, correlationId, ct);
            branches = envelope.Branches;
        }, "clients", partial);
        await Task.WhenAll(serviceTask, ordersTask, noticesTask, branchesTask);

        var clock = LocalNow(configuration);
        return new MealSummaryGraph(clock.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), clock.Time.ToString("HH:mm", CultureInfo.InvariantCulture), ToEmployeeGraph(employee, clock.Date),
            branches, services, recent.Where(v => v.Estado == "EMITIDO").ToArray(), recent.Take(20).ToArray(), weekly, partial);
    }

    [GraphQLName("detalleVale")]
    public async Task<VoucherDto> GetVoucher(string numeroVale, [Service] ServiceHttp http, [Service] IHttpContextAccessor accessor, CancellationToken ct)
    {
        var context = accessor.HttpContext ?? throw new GraphQLException("No hay contexto de solicitud.");
        RequestContext.Require(context);
        var response = await http.GetAsync<VoucherResponse>("ORDERS", $"/vouchers/by-number/{Uri.EscapeDataString(numeroVale)}", RequestContext.Get(context), InternalSecurity.CorrelationId(context), ct);
        return response.Voucher;
    }

    [GraphQLName("panelAuditoria")]
    public async Task<AuditPanelGraph> GetAuditPanel([Service] ServiceHttp http, [Service] IHttpContextAccessor accessor, CancellationToken ct)
    {
        var context = accessor.HttpContext ?? throw new GraphQLException("No hay contexto de solicitud.");
        RequestContext.RequireRole(context, "ADMINISTRADOR");
        var user = RequestContext.Get(context);
        var correlationId = InternalSecurity.CorrelationId(context);
        var audit = await http.GetAsync<AuditResponse>("ORDERS", "/reports/audit", user, correlationId, ct);
        var partial = new List<PartialErrorGraph>();
        IReadOnlyList<CasinoSettlementDto> reconciliation = [];
        try
        {
            var result = await http.GetAsync<ReconciliationResponse>("PAYMENTS", "/reconciliation", user, correlationId, ct);
            reconciliation = result.SummaryByCasino;
        }
        catch (Exception ex) when (ex is DomainException or HttpRequestException)
        {
            partial.Add(new PartialErrorGraph("payments", ex is DomainException d ? d.Code : "UPSTREAM_UNAVAILABLE", "Rendición temporalmente no disponible."));
        }
        return new AuditPanelGraph(audit.Summary, audit.ByService, reconciliation, partial);
    }

    [GraphQLName("catalogoCasino")]
    public async Task<IReadOnlyList<ProductDto>> GetCatalog([GraphQLName("soloDisponibles")] bool soloDisponibles = true,
        [Service] ServiceHttp http = null!, [Service] IHttpContextAccessor accessor = null!, CancellationToken ct = default)
    {
        var context = accessor.HttpContext ?? throw new GraphQLException("No hay contexto de solicitud.");
        RequestContext.Require(context);
        var query = soloDisponibles ? "?available=true" : "";
        var envelope = await http.GetAsync<ProductListResponse>("INVENTORY", $"/products{query}", RequestContext.Get(context), InternalSecurity.CorrelationId(context), ct);
        return envelope.Products;
    }

    private static bool IsActiveNow(string start, string end, IConfiguration configuration)
    {
        var now = LocalNow(configuration).Time;
        var from = TimeOnly.ParseExact(start, "HH:mm", CultureInfo.InvariantCulture);
        var to = end == "24:00" ? TimeOnly.MinValue : TimeOnly.ParseExact(end, "HH:mm", CultureInfo.InvariantCulture);
        if (end == "24:00") return now >= from;
        return from <= to ? now >= from && now < to : now >= from || now < to;
    }

    private static (DateOnly Date, TimeOnly Time) LocalNow(IConfiguration configuration)
    {
        if (string.Equals(configuration["DOTNET_ENVIRONMENT"], "Testing", StringComparison.OrdinalIgnoreCase) &&
            DateTimeOffset.TryParse(configuration["APP_TEST_NOW_SANTIAGO"], CultureInfo.InvariantCulture, DateTimeStyles.None, out var testNow))
        {
            var testLocal = TimeZoneInfo.ConvertTime(testNow, TimeZoneInfo.FindSystemTimeZoneById("America/Santiago"));
            return (DateOnly.FromDateTime(testLocal.DateTime), TimeOnly.FromDateTime(testLocal.DateTime));
        }
        var zone = TimeZoneInfo.FindSystemTimeZoneById("America/Santiago");
        var local = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, zone);
        return (DateOnly.FromDateTime(local.DateTime), TimeOnly.FromDateTime(local.DateTime));
    }

    private static EmployeeSummaryGraph ToEmployeeGraph(EmployeeDto employee, DateOnly date)
    {
        var shiftLabel = employee.NumeroTurno switch
        {
            1 => "08:00 - 16:00 (Desayuno + Almuerzo)",
            2 => "16:00 - 24:00 (Once + Cena 1)",
            3 => "00:00 - 08:00 (Cena 2 + Desayuno)",
            _ => "Sin turno vigente"
        };
        return new EmployeeSummaryGraph(employee.Id, employee.CodigoFuncionario, employee.NombreCompleto, employee.Role, employee.Rut, employee.Email,
            new ProfileSummaryGraph(employee.PerfilCodigo, employee.PerfilNombre, employee.PermiteMultiVale, employee.MaxValesPorHorario),
            new BranchSummaryGraph(employee.SucursalBaseCodigo, employee.SucursalBaseNombre),
            employee.NumeroTurno is null ? null : new ShiftSummaryGraph(date.Year, date.Month, employee.NumeroTurno.Value, shiftLabel,
                employee.SucursalAsignadaCodigo ?? employee.SucursalBaseCodigo, employee.SucursalBaseNombre));
    }

    private static async Task Safe(Func<Task> action, string subsystem, List<PartialErrorGraph> errors)
    {
        try { await action(); }
        catch (Exception ex) when (ex is DomainException or HttpRequestException or TaskCanceledException)
        {
            errors.Add(new PartialErrorGraph(subsystem, ex is DomainException d ? d.Code : "UPSTREAM_UNAVAILABLE", $"El subsistema {subsystem} está temporalmente no disponible."));
        }
    }

    private sealed record EmployeeResponse(EmployeeDto Employee);
    private sealed record ServiceListResponse(IReadOnlyList<FoodServiceDto> Services);
    private sealed record VoucherListResponse(IReadOnlyList<VoucherDto> Vouchers);
    private sealed record VoucherResponse(VoucherDto Voucher);
    private sealed record NoticeListResponse(IReadOnlyList<WeeklyNoticeDto> Notifications);
    private sealed record BranchListResponse(IReadOnlyList<BranchDto> Branches);
    private sealed record ProductListResponse(IReadOnlyList<ProductDto> Products);
    private sealed record AuditResponse(AuditSummaryGraph Summary, IReadOnlyList<AuditServiceGraph> ByService);
    private sealed record ReconciliationResponse(IReadOnlyList<CasinoSettlementDto> SummaryByCasino);
}

public sealed record FoodServiceGraph(string Id, string Codigo, string Nombre, string Descripcion, int? ValorClp, bool HabilitadoAhora, IReadOnlyList<ServiceWindowDto> Horarios);
public sealed record PartialErrorGraph(string Subsystem, string Code, string Message);
public sealed record ProfileSummaryGraph(string Codigo, string Nombre, bool PermiteMultiVale, int MaxValesPorHorario);
public sealed record BranchSummaryGraph(string Codigo, string Nombre);
public sealed record ShiftSummaryGraph(int Anio, int Mes, int NumeroTurno, string HorarioLabel, string SucursalAsignadaCodigo, string SucursalAsignadaNombre);
public sealed record EmployeeSummaryGraph(string Id, string CodigoFuncionario, string NombreCompleto, string Rol, string? Rut, string? Email,
    ProfileSummaryGraph Perfil, BranchSummaryGraph SucursalBase, ShiftSummaryGraph? TurnoActual);
public sealed record MealSummaryGraph(string FechaConsultada, string HoraServidor, EmployeeSummaryGraph Funcionario, IReadOnlyList<BranchDto> Sucursales,
    IReadOnlyList<FoodServiceGraph> ServiciosDelTurno, IReadOnlyList<VoucherDto> ValesDisponiblesParaImprimir,
    IReadOnlyList<VoucherDto> ValesRecientes, IReadOnlyList<WeeklyNoticeDto> AvisosSemanales, IReadOnlyList<PartialErrorGraph> PartialErrors);
public sealed record AuditSummaryGraph(int TotalRegistros, int DisponiblesSinImprimir, int ImpresosNoUsados, int CanjeadosUsados, int Anulados, int MontoEmitidoValidoClp, int MontoCanjeadoClp);
public sealed record AuditServiceGraph(string ServicioCodigo, string ServicioNombre, int EmitidosSinImprimir, int ImpresosNoUsados, int Canjeados, int Anulados, int TotalValidos, int MontoTotalClp);
public sealed record AuditPanelGraph(AuditSummaryGraph Resumen, IReadOnlyList<AuditServiceGraph> PorServicio,
    IReadOnlyList<CasinoSettlementDto> RendicionCasinos, IReadOnlyList<PartialErrorGraph> PartialErrors);
