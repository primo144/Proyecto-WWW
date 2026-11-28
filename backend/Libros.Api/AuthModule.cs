using Oracle.ManagedDataAccess.Client;

namespace Libros.Api;

public static class AuthModule
{
    public static void Map(WebApplication app)
    {
        var db = app.Services.GetRequiredService<OracleStore>();
        var tokens = app.Services.GetRequiredService<JwtTokens>();
        app.MapGet("/health", (CancellationToken ct) => ServiceHealth.Oracle(db, "auth", ct));
        app.MapPost("/auth/login", async (LoginRequest body, HttpContext context, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(body.CodigoFuncionario) || body.CodigoFuncionario.Length > 32 || string.IsNullOrWhiteSpace(body.Password) || body.Password.Length > 200)
                throw new DomainException(400, "VALIDATION_ERROR", "El código y la contraseña son obligatorios.");
            var account = await db.OneAsync("SELECT ID,EMPLOYEE_CODE,PASSWORD_HASH,USER_ROLE,ACTIVE FROM AUTH_SVC.USERS WHERE EMPLOYEE_CODE=:code", c => OracleStore.AddText(c, "code", body.CodigoFuncionario.Trim().ToUpperInvariant()),
                r => new { Id = OracleStore.Text(r, "ID"), Code = OracleStore.Text(r, "EMPLOYEE_CODE"), Hash = OracleStore.Text(r, "PASSWORD_HASH"), Role = OracleStore.Text(r, "USER_ROLE"), Active = OracleStore.Bool(r, "ACTIVE") }, ct);
            if (account is null || !account.Active || !Passwords.Verify(body.Password, account.Hash))
                throw new DomainException(401, "INVALID_CREDENTIALS", "Código o contraseña incorrectos.");

            var user = new UserContext(account.Id, account.Code, account.Role);
            var sessionId = Guid.NewGuid().ToString();
            var refresh = tokens.Issue(user, sessionId, "refresh", TimeSpan.FromDays(7));
            await db.ExecuteAsync("INSERT INTO AUTH_SVC.SESSIONS (ID,USER_ID,REFRESH_HASH,EXPIRES_AT) VALUES (:id,:user_id,:refresh_hash,:expires_at)", c =>
            {
                OracleStore.AddText(c, "id", sessionId); OracleStore.AddText(c, "user_id", user.UserId);
                OracleStore.AddText(c, "refresh_hash", Passwords.Sha256(refresh)); OracleStore.AddDate(c, "expires_at", DateTime.UtcNow.AddDays(7));
            }, ct);
            var access = tokens.Issue(user, sessionId, "access", TimeSpan.FromMinutes(15));
            InternalSecurity.CorrelationId(context);
            return Results.Ok(new { accessToken = access, refreshToken = refresh, expiresIn = "15m", user = new { id = user.UserId, codigoFuncionario = user.Code, role = user.Role } });
        });

        app.MapPost("/auth/refresh", async (RefreshRequest body, HttpContext context, CancellationToken ct) =>
        {
            if (!tokens.TryRead(body.RefreshToken, "refresh", out var user, out var sessionId) || user is null)
                throw new DomainException(401, "INVALID_REFRESH_TOKEN", "La sesión debe volver a autenticarse.");
            var hash = Passwords.Sha256(body.RefreshToken);
            var valid = await db.OneAsync("SELECT COUNT(*) N FROM AUTH_SVC.SESSIONS WHERE ID=:id AND USER_ID=:user_id AND REFRESH_HASH=:hash AND REVOKED_AT IS NULL AND EXPIRES_AT>SYSTIMESTAMP", c =>
            {
                OracleStore.AddText(c, "id", sessionId); OracleStore.AddText(c, "user_id", user.UserId); OracleStore.AddText(c, "hash", hash);
            }, r => OracleStore.Int(r, "N") == 1, ct);
            if (valid != true) throw new DomainException(401, "SESSION_REVOKED", "La sesión fue revocada o expiró.");
            var rotatedRefresh = tokens.Issue(user, sessionId, "refresh", TimeSpan.FromDays(7));
            var changed = await db.ExecuteAsync("UPDATE AUTH_SVC.SESSIONS SET REFRESH_HASH=:hash,EXPIRES_AT=:expires_at WHERE ID=:id AND REVOKED_AT IS NULL", c =>
            {
                OracleStore.AddText(c, "hash", Passwords.Sha256(rotatedRefresh)); OracleStore.AddDate(c, "expires_at", DateTime.UtcNow.AddDays(7)); OracleStore.AddText(c, "id", sessionId);
            }, ct);
            if (changed != 1) throw new DomainException(401, "SESSION_REVOKED", "La sesión fue revocada.");
            InternalSecurity.CorrelationId(context);
            return Results.Ok(new { accessToken = tokens.Issue(user, sessionId, "access", TimeSpan.FromMinutes(15)), refreshToken = rotatedRefresh, expiresIn = "15m", user = new { id = user.UserId, codigoFuncionario = user.Code, role = user.Role } });
        });

        app.MapPost("/auth/logout", async (HttpContext context, CancellationToken ct) =>
        {
            var user = RequestContext.Require(context);
            var authorization = context.Request.Headers.Authorization.FirstOrDefault();
            var token = authorization?.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) == true ? authorization[7..] : null;
            if (!tokens.TryRead(token, "access", out _, out var sessionId)) throw new DomainException(401, "UNAUTHENTICATED", "La sesión no es válida.");
            await db.ExecuteAsync("UPDATE AUTH_SVC.SESSIONS SET REVOKED_AT=SYSTIMESTAMP WHERE ID=:id AND USER_ID=:user_id AND REVOKED_AT IS NULL", c =>
            {
                OracleStore.AddText(c, "id", sessionId); OracleStore.AddText(c, "user_id", user.UserId);
            }, ct);
            return Results.Ok(new { ok = true, message = "Sesión revocada." });
        });

        app.MapPost("/auth/users", async (CreateAuthUserRequest body, HttpContext context, CancellationToken ct) =>
        {
            RequestContext.RequireRole(context, "ADMINISTRADOR");
            if (body.Password.Length < 10 || body.Password.Length > 200 || body.CodigoFuncionario.Length is < 3 or > 32 || !new[] { "FUNCIONARIO", "CAJERO", "ADMINISTRADOR" }.Contains(body.Role))
                throw new DomainException(400, "VALIDATION_ERROR", "Los datos de la cuenta no cumplen las reglas de seguridad.");
            var id = Guid.NewGuid().ToString();
            await db.ExecuteAsync("INSERT INTO AUTH_SVC.USERS (ID,EMPLOYEE_CODE,PASSWORD_HASH,USER_ROLE,ACTIVE) VALUES (:id,:code,:hash,:role,1)", c =>
            {
                OracleStore.AddText(c, "id", id); OracleStore.AddText(c, "code", body.CodigoFuncionario.ToUpperInvariant());
                OracleStore.AddText(c, "hash", Passwords.Hash(body.Password)); OracleStore.AddText(c, "role", body.Role);
            }, ct);
            return Results.Created($"/auth/users/{id}", new { id, codigoFuncionario = body.CodigoFuncionario.ToUpperInvariant(), role = body.Role, activo = true });
        });

        app.MapPost("/internal/verify", async (HttpContext context, CancellationToken ct) =>
        {
            if (!InternalSecurity.IsAuthorized(context)) throw new DomainException(401, "INVALID_INTERNAL_IDENTITY", "Identidad de servicio no válida.");
            var authorization = context.Request.Headers.Authorization.FirstOrDefault();
            var token = authorization?.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) == true ? authorization[7..] : null;
            if (!tokens.TryRead(token, "access", out var user, out var sessionId) || user is null)
                throw new DomainException(401, "INVALID_TOKEN", "El token no es válido o expiró.");
            var active = await db.OneAsync("SELECT COUNT(*) N FROM AUTH_SVC.SESSIONS WHERE ID=:id AND USER_ID=:user_id AND REVOKED_AT IS NULL AND EXPIRES_AT>SYSTIMESTAMP", c =>
            {
                OracleStore.AddText(c, "id", sessionId); OracleStore.AddText(c, "user_id", user.UserId);
            }, r => OracleStore.Int(r, "N") == 1, ct);
            if (active != true) throw new DomainException(401, "SESSION_REVOKED", "La sesión fue revocada o expiró.");
            return Results.Ok(new { user });
        });

        app.MapPost("/internal/users", async (CreateAuthUserRequest body, HttpContext context, CancellationToken ct) =>
        {
            if (!InternalSecurity.IsAuthorized(context)) throw new DomainException(401, "INVALID_INTERNAL_IDENTITY", "Identidad de servicio no válida.");
            RequestContext.RequireRole(context, "ADMINISTRADOR");
            if (body.Password.Length < 10 || body.CodigoFuncionario.Length is < 3 or > 32 || !new[] { "FUNCIONARIO", "CAJERO", "ADMINISTRADOR" }.Contains(body.Role))
                throw new DomainException(400, "VALIDATION_ERROR", "Los datos de la cuenta no cumplen las reglas de seguridad.");
            var id = Guid.NewGuid().ToString();
            await db.ExecuteAsync("INSERT INTO AUTH_SVC.USERS (ID,EMPLOYEE_CODE,PASSWORD_HASH,USER_ROLE,ACTIVE) VALUES (:id,:code,:hash,:role,1)", c =>
            {
                OracleStore.AddText(c, "id", id); OracleStore.AddText(c, "code", body.CodigoFuncionario.ToUpperInvariant());
                OracleStore.AddText(c, "hash", Passwords.Hash(body.Password)); OracleStore.AddText(c, "role", body.Role);
            }, ct);
            return Results.Created($"/auth/users/{id}", new { id, codigoFuncionario = body.CodigoFuncionario.ToUpperInvariant(), role = body.Role, activo = true });
        });
    }
}

public sealed record RefreshRequest(string RefreshToken);
public sealed record CreateAuthUserRequest(string CodigoFuncionario, string Password, string Role);
