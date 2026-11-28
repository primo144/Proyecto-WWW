using System.Net.Http.Json;
using System.Text.Json;

namespace Libros.Api;

public sealed class ServiceHttp(IHttpClientFactory clients, IConfiguration configuration)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<T> GetAsync<T>(string service, string path, UserContext? user, string? correlationId = null, CancellationToken ct = default)
        => await SendAsync<T>(service, HttpMethod.Get, path, null, user, correlationId, ct);

    public async Task<T> PostAsync<T>(string service, string path, object body, UserContext? user, string? correlationId = null, CancellationToken ct = default)
        => await SendAsync<T>(service, HttpMethod.Post, path, body, user, correlationId, ct);

    public async Task<T> PutAsync<T>(string service, string path, object body, UserContext? user, string? correlationId = null, CancellationToken ct = default)
        => await SendAsync<T>(service, HttpMethod.Put, path, body, user, correlationId, ct);

    public async Task<T> SendAsync<T>(string service, HttpMethod method, string path, object? body, UserContext? user, string? correlationId, CancellationToken ct = default)
    {
        var baseUrl = configuration[$"SERVICE_{service.ToUpperInvariant()}_URL"]
            ?? throw new InvalidOperationException($"SERVICE_{service.ToUpperInvariant()}_URL no está configurado.");
        using var request = new HttpRequestMessage(method, $"{baseUrl.TrimEnd('/')}/{path.TrimStart('/')}");
        var token = configuration[$"INTERNAL_TOKEN_{service.ToUpperInvariant()}"];
        if (string.IsNullOrWhiteSpace(token)) throw new InvalidOperationException($"Falta el token interno para {service}.");
        request.Headers.TryAddWithoutValidation("x-internal-service-token", token);
        request.Headers.TryAddWithoutValidation("X-Correlation-ID", correlationId ?? Guid.NewGuid().ToString());
        if (user is not null)
        {
            request.Headers.TryAddWithoutValidation("x-user-id", user.UserId);
            request.Headers.TryAddWithoutValidation("x-user-code", user.Code);
            request.Headers.TryAddWithoutValidation("x-user-role", user.Role);
        }
        if (body is not null) request.Content = JsonContent.Create(body, options: JsonOptions);

        HttpResponseMessage response;
        try
        {
            response = await clients.CreateClient("internal").SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new DomainException(504, "UPSTREAM_TIMEOUT", $"El subsistema {service} excedió el plazo configurado.");
        }
        catch (HttpRequestException)
        {
            throw new DomainException(503, "UPSTREAM_UNAVAILABLE", $"El subsistema {service} no está disponible.");
        }
        using (response)
        {
        var json = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            try
            {
                using var errorDoc = JsonDocument.Parse(json);
                var error = errorDoc.RootElement.TryGetProperty("error", out var e) ? e : errorDoc.RootElement;
                var code = error.TryGetProperty("code", out var c) ? c.GetString() : "UPSTREAM_ERROR";
                var message = error.TryGetProperty("message", out var m) ? m.GetString() : "Un subsistema rechazó la solicitud.";
                throw new DomainException((int)response.StatusCode, code ?? "UPSTREAM_ERROR", message ?? "Error de servicio interno.");
            }
            catch (JsonException)
            {
                throw new DomainException((int)response.StatusCode, "UPSTREAM_ERROR", "Un subsistema interno no completó la solicitud.");
            }
        }
        try
        {
            return JsonSerializer.Deserialize<T>(json, JsonOptions)
                ?? throw new DomainException(502, "INVALID_UPSTREAM_RESPONSE", "La respuesta del subsistema estaba vacía.");
        }
        catch (JsonException)
        {
            throw new DomainException(502, "INVALID_UPSTREAM_RESPONSE", "La respuesta del subsistema no respeta el contrato JSON.");
        }
        }
    }
}
