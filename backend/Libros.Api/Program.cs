using System.Net;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Libros.Api;
using Oracle.ManagedDataAccess.Client;

var builder = WebApplication.CreateBuilder(args);
var kind = (builder.Configuration["SERVICE_KIND"] ?? "GATEWAY").ToUpperInvariant();
builder.Services.AddHttpClient("internal", client => client.Timeout = TimeSpan.FromMilliseconds(int.TryParse(builder.Configuration["UPSTREAM_TIMEOUT_MS"], out var timeout) ? timeout : 4_000));
builder.Services.AddHttpClient("email", client => client.Timeout = TimeSpan.FromSeconds(8));
builder.Services.AddSingleton<OracleStore>();
builder.Services.AddSingleton<JwtTokens>();
builder.Services.AddSingleton<ServiceHttp>();
builder.Services.AddSingleton<WeeklyNoticeService>();
builder.Services.AddHealthChecks();
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 1_000_000);

if (kind is "SEED" or "RESET")
{
    var seedApp = builder.Build();
    if (kind == "RESET") await OracleResetRunner.RunAsync(seedApp.Configuration, seedApp.Logger);
    await SeedRunner.RunAsync(seedApp.Configuration, seedApp.Logger);
    return;
}

if (kind == "GATEWAY")
{
    var origin = builder.Configuration["CORS_ORIGIN"] ?? "http://localhost:3000";
    builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy.WithOrigins(origin).AllowAnyHeader().AllowAnyMethod().WithExposedHeaders("X-Correlation-ID")));
    builder.Services.AddRateLimiter(options =>
    {
        options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
        options.AddPolicy("api", context => RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions { PermitLimit = int.TryParse(builder.Configuration["RATE_LIMIT_API_MAX"], out var value) ? value : 600, Window = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = true }));
        options.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions { PermitLimit = int.TryParse(builder.Configuration["RATE_LIMIT_AUTH_MAX"], out var value) ? value : 60, Window = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = true }));
    });
}
if (kind == "GRAPHQL") GraphQLModule.ConfigureServices(builder.Services);
if (kind == "PAYMENTS" && builder.Configuration["WEEKLY_NOTICES_ENABLED"]?.Equals("true", StringComparison.OrdinalIgnoreCase) == true)
    builder.Services.AddHostedService<WeeklyNoticeWorker>();

var app = builder.Build();
if (kind == "GATEWAY")
{
    foreach (var target in new[] { "AUTH", "CLIENTS", "INVENTORY", "ORDERS", "PAYMENTS", "GRAPHQL" })
        RequireConfiguredSecret(app.Configuration, $"INTERNAL_TOKEN_{target}");
}
else
{
    RequireConfiguredSecret(app.Configuration, "INTERNAL_TOKEN");
    if (kind == "AUTH") RequireConfiguredSecret(app.Configuration, "JWT_SECRET");
}
app.Use(async (context, next) =>
{
    var correlationId = InternalSecurity.CorrelationId(context);
    try { await next(context); }
    catch (DomainException ex) when (!context.Response.HasStarted)
    {
        context.Response.Clear(); context.Response.StatusCode = ex.Status;
        await context.Response.WriteAsJsonAsync(new { error = new { code = ex.Code, message = ex.Message, correlationId } }, context.RequestAborted);
    }
    catch (OracleException ex) when (!context.Response.HasStarted)
    {
        app.Logger.LogError(ex, "Oracle request failed. correlationId={CorrelationId} oracleCode={OracleCode}", correlationId, ex.Number);
        context.Response.Clear(); context.Response.StatusCode = ex.Number == 1 ? 409 : StatusCodes.Status503ServiceUnavailable;
        await context.Response.WriteAsJsonAsync(new { error = new { code = ex.Number == 1 ? "DUPLICATE_RESOURCE" : "DATABASE_UNAVAILABLE", message = ex.Number == 1 ? "Ya existe un registro con esos datos." : "No fue posible acceder al almacenamiento. Intenta nuevamente.", correlationId } }, context.RequestAborted);
    }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
    catch (Exception ex) when (!context.Response.HasStarted)
    {
        app.Logger.LogError(ex, "Unhandled request failure. correlationId={CorrelationId}", correlationId);
        context.Response.Clear(); context.Response.StatusCode = StatusCodes.Status500InternalServerError;
        await context.Response.WriteAsJsonAsync(new { error = new { code = "INTERNAL_ERROR", message = "No fue posible completar la operación.", correlationId } }, context.RequestAborted);
    }
});
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    if (kind == "GATEWAY")
    {
        context.Response.Headers["Cache-Control"] = "no-store";
        if (context.Request.Method == HttpMethods.Options) { await next(context); return; }
    }
    await next(context);
});

if (kind == "GATEWAY")
{
    app.UseRouting();
    app.UseCors();
    app.UseRateLimiter();
    GatewayModule.Map(app);
}
else
{
    app.Use(async (context, next) =>
    {
        if (context.Request.Path == "/health" || (kind == "AUTH" && context.Request.Path.Value is "/auth/login" or "/auth/refresh"))
        {
            await next(context);
            return;
        }
        if (!InternalSecurity.IsAuthorized(context))
            throw new DomainException(401, "INVALID_INTERNAL_IDENTITY", "Se requiere identidad de servicio válida.");
        await next(context);
    });
    switch (kind)
    {
        case "AUTH": AuthModule.Map(app); break;
        case "CLIENTS": ClientsModule.Map(app); break;
        case "INVENTORY": InventoryModule.Map(app); break;
        case "ORDERS": OrdersModule.Map(app); break;
        case "PAYMENTS": PaymentsModule.Map(app); break;
        case "GRAPHQL": GraphQLModule.Map(app); break;
        default: throw new InvalidOperationException($"SERVICE_KIND desconocido: {kind}");
    }
}

app.MapGet("/", () => Results.Ok(new { name = "Libros Impresos API", version = "2.0", database = "Oracle Database Free", status = "ok" }));
await app.RunAsync();

static void RequireConfiguredSecret(IConfiguration configuration, string key)
{
    var value = configuration[key];
    if (string.IsNullOrWhiteSpace(value) || value.StartsWith("CHANGE_ME", StringComparison.Ordinal) || value.Length < 32)
        throw new InvalidOperationException($"{key} debe ser un secreto aleatorio local de al menos 32 caracteres. Configúralo en .env.");
}

public partial class Program;
