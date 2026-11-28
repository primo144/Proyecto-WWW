using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Libros.Api;

public static class Passwords
{
    private const int Iterations = 210_000;
    private const int SaltSize = 16;
    private const int HashSize = 32;

    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, HashSize);
        return $"pbkdf2-sha256${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string password, string encoded)
    {
        var parts = encoded.Split('$');
        if (parts.Length != 4 || parts[0] != "pbkdf2-sha256" || !int.TryParse(parts[1], out var iterations)) return false;
        try
        {
            var salt = Convert.FromBase64String(parts[2]);
            var expected = Convert.FromBase64String(parts[3]);
            var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch (FormatException) { return false; }
    }

    public static string Sha256(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}

public sealed class JwtTokens
{
    private readonly byte[] _secret;

    public JwtTokens(IConfiguration configuration)
    {
        var configured = configuration["JWT_SECRET"] ?? throw new InvalidOperationException("JWT_SECRET debe configurarse desde .env.");
        _secret = Encoding.UTF8.GetBytes(configured);
        if (_secret.Length < 32 || configured.StartsWith("CHANGE_ME", StringComparison.Ordinal))
            throw new InvalidOperationException("JWT_SECRET debe ser un secreto aleatorio local de al menos 32 caracteres.");
    }

    public string Issue(UserContext user, string sessionId, string type, TimeSpan lifetime)
    {
        var now = DateTimeOffset.UtcNow;
        var payload = new Dictionary<string, object>
        {
            ["sub"] = user.UserId, ["code"] = user.Code, ["role"] = user.Role,
            ["sid"] = sessionId, ["typ"] = type, ["iat"] = now.ToUnixTimeSeconds(), ["exp"] = now.Add(lifetime).ToUnixTimeSeconds()
        };
        var head = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new { alg = "HS256", typ = "JWT" }));
        var body = Base64Url(JsonSerializer.SerializeToUtf8Bytes(payload));
        var signed = $"{head}.{body}";
        return $"{signed}.{Base64Url(HMACSHA256.HashData(_secret, Encoding.ASCII.GetBytes(signed)))}";
    }

    public bool TryRead(string? token, string expectedType, out UserContext? user, out string sessionId)
    {
        user = null;
        sessionId = "";
        if (string.IsNullOrWhiteSpace(token)) return false;
        var parts = token.Split('.');
        if (parts.Length != 3) return false;
        try
        {
            var signingInput = $"{parts[0]}.{parts[1]}";
            var expected = HMACSHA256.HashData(_secret, Encoding.ASCII.GetBytes(signingInput));
            if (!CryptographicOperations.FixedTimeEquals(expected, FromBase64Url(parts[2]))) return false;
            using var payload = JsonDocument.Parse(FromBase64Url(parts[1]));
            var root = payload.RootElement;
            if (root.GetProperty("typ").GetString() != expectedType || root.GetProperty("exp").GetInt64() <= DateTimeOffset.UtcNow.ToUnixTimeSeconds()) return false;
            user = new UserContext(root.GetProperty("sub").GetString()!, root.GetProperty("code").GetString()!, root.GetProperty("role").GetString()!);
            sessionId = root.GetProperty("sid").GetString()!;
            return user.UserId.Length > 0 && sessionId.Length > 0;
        }
        catch (Exception ex) when (ex is FormatException or JsonException or System.Collections.Generic.KeyNotFoundException or InvalidOperationException)
        {
            return false;
        }
    }

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static byte[] FromBase64Url(string text) => Convert.FromBase64String(text.Replace('-', '+').Replace('_', '/') + new string('=', (4 - text.Length % 4) % 4));
}

public static class InternalSecurity
{
    public static bool IsAuthorized(HttpContext context)
    {
        var configured = context.RequestServices.GetRequiredService<IConfiguration>()["INTERNAL_TOKEN"];
        var supplied = context.Request.Headers["x-internal-service-token"].FirstOrDefault();
        if (string.IsNullOrEmpty(configured) || string.IsNullOrEmpty(supplied)) return false;
        var a = Encoding.UTF8.GetBytes(configured);
        var b = Encoding.UTF8.GetBytes(supplied);
        return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
    }

    public static string CorrelationId(HttpContext context)
    {
        var current = context.Request.Headers["X-Correlation-ID"].FirstOrDefault();
        if (!Guid.TryParse(current, out _)) current = Guid.NewGuid().ToString();
        context.Response.Headers["X-Correlation-ID"] = current;
        return current;
    }
}
