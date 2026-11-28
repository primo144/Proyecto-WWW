using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;

namespace Libros.Api;

public static class GatewayModule
{
    private static readonly string[] Methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];

    public static void Map(WebApplication app)
    {
        var configuration = app.Configuration;
        app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "api-gateway" }));

        app.MapMethods("/api/v1/auth/{**path}", Methods, (HttpContext context, CancellationToken ct) => Forward(context, ct))
            .RequireRateLimiting("auth");
        app.MapMethods("/api/v1/{**path}", Methods, (HttpContext context, CancellationToken ct) => Forward(context, ct))
            .RequireRateLimiting("api");

        async Task<IResult> Forward(HttpContext context, CancellationToken ct)
        {
            var correlationId = InternalSecurity.CorrelationId(context);
            var route = Resolve(context.Request.Path.Value ?? "", context.Request.Method);
            if (route is null) throw new DomainException(404, "ROUTE_NOT_FOUND", "La ruta solicitada no está publicada por el gateway.");

            UserContext? user = null;
            if (!route.Anonymous)
            {
                var authorization = context.Request.Headers.Authorization.FirstOrDefault();
                if (authorization?.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) != true)
                    throw new DomainException(401, "UNAUTHENTICATED", "Se requiere una sesión válida.");
                var authUrl = configuration["SERVICE_AUTH_URL"] ?? throw new InvalidOperationException("SERVICE_AUTH_URL no está configurado.");
                using var verification = new HttpRequestMessage(HttpMethod.Post, $"{authUrl.TrimEnd('/')}/internal/verify");
                verification.Headers.Authorization = AuthenticationHeaderValue.Parse(authorization);
                verification.Headers.TryAddWithoutValidation("X-Correlation-ID", correlationId);
                verification.Headers.TryAddWithoutValidation("x-internal-service-token", RequiredToken(configuration, "AUTH"));
                HttpResponseMessage authResponse;
                try { authResponse = await context.RequestServices.GetRequiredService<IHttpClientFactory>().CreateClient("internal").SendAsync(verification, ct); }
                catch (HttpRequestException) { throw new DomainException(503, "AUTH_UNAVAILABLE", "El servicio de autenticación no está disponible."); }
                using (authResponse)
                {
                    if (authResponse.StatusCode == HttpStatusCode.Unauthorized)
                        throw new DomainException(401, "INVALID_TOKEN", "La sesión expiró o fue revocada.");
                    if (!authResponse.IsSuccessStatusCode)
                        throw new DomainException(503, "AUTH_UNAVAILABLE", "El servicio de autenticación no pudo validar la sesión.");
                    var validated = await authResponse.Content.ReadFromJsonAsync<GatewayVerifyResponse>(cancellationToken: ct);
                    user = validated?.User ?? throw new DomainException(502, "INVALID_AUTH_RESPONSE", "El servicio de autenticación devolvió una respuesta inválida.");
                }
            }

            var baseUrl = configuration[$"SERVICE_{route.Service.ToUpperInvariant()}_URL"]
                ?? throw new InvalidOperationException($"SERVICE_{route.Service.ToUpperInvariant()}_URL no está configurado.");
            using var outgoing = new HttpRequestMessage(new HttpMethod(context.Request.Method), $"{baseUrl.TrimEnd('/')}{route.InternalPath}{context.Request.QueryString}");
            outgoing.Headers.TryAddWithoutValidation("x-internal-service-token", RequiredToken(configuration, route.Service.ToUpperInvariant()));
            outgoing.Headers.TryAddWithoutValidation("X-Correlation-ID", correlationId);
            if (user is not null)
            {
                outgoing.Headers.TryAddWithoutValidation("x-user-id", user.UserId);
                outgoing.Headers.TryAddWithoutValidation("x-user-code", user.Code);
                outgoing.Headers.TryAddWithoutValidation("x-user-role", user.Role);
                if (context.Request.Headers.Authorization.FirstOrDefault() is { } bearer)
                    outgoing.Headers.TryAddWithoutValidation("Authorization", bearer);
            }
            if (context.Request.ContentLength is > 0 || context.Request.Headers.ContainsKey("Transfer-Encoding"))
            {
                outgoing.Content = new StreamContent(context.Request.Body);
                if (MediaTypeHeaderValue.TryParse(context.Request.ContentType, out var contentType)) outgoing.Content.Headers.ContentType = contentType;
            }

            HttpResponseMessage response;
            try { response = await context.RequestServices.GetRequiredService<IHttpClientFactory>().CreateClient("internal").SendAsync(outgoing, HttpCompletionOption.ResponseHeadersRead, ct); }
            catch (HttpRequestException) { throw new DomainException(504, "UPSTREAM_UNAVAILABLE", "El servicio solicitado no respondió a tiempo."); }
            using (response)
            {
                context.Response.StatusCode = (int)response.StatusCode;
                if (response.Content.Headers.ContentType is not null) context.Response.ContentType = response.Content.Headers.ContentType.ToString();
                context.Response.Headers["X-Correlation-ID"] = correlationId;
                await response.Content.CopyToAsync(context.Response.Body, ct);
            }
            return Results.Empty;
        }
    }

    private static GatewayRoute? Resolve(string path, string method)
    {
        if (!Methods.Contains(method, StringComparer.Ordinal)) return null;
        if (path is "/api/v1/auth/login" or "/api/v1/auth/refresh")
            return new("auth", path.Replace("/api/v1/auth", "/auth", StringComparison.Ordinal), true);
        if (path.StartsWith("/api/v1/auth/", StringComparison.Ordinal))
            return new("auth", path.Replace("/api/v1/auth", "/auth", StringComparison.Ordinal), false);
        if (path == "/api/v1/public/products") return new("inventory", "/public/products", true);
        if (path == "/api/v1/public/branches") return new("clients", "/public/branches", true);
        if (path.StartsWith("/api/v1/clients/", StringComparison.Ordinal)) return new("clients", path["/api/v1/clients".Length..], false);
        if (path.StartsWith("/api/v1/inventory/", StringComparison.Ordinal)) return new("inventory", path["/api/v1/inventory".Length..], false);
        if (path.StartsWith("/api/v1/orders/", StringComparison.Ordinal)) return new("orders", path["/api/v1/orders".Length..], false);
        if (path.StartsWith("/api/v1/payments/", StringComparison.Ordinal)) return new("payments", path["/api/v1/payments".Length..], false);
        if (path == "/api/v1/graphql") return new("graphql", "/graphql", false);
        return null;
    }

    private static string RequiredToken(IConfiguration configuration, string service)
        => configuration[$"INTERNAL_TOKEN_{service}"] ?? throw new InvalidOperationException($"Falta INTERNAL_TOKEN_{service}.");

    private sealed record GatewayRoute(string Service, string InternalPath, bool Anonymous);
    private sealed record GatewayVerifyResponse(UserContext User);
}
