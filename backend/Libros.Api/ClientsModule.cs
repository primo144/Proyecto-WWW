using Oracle.ManagedDataAccess.Client;

namespace Libros.Api;

public static class ClientsModule
{
    public static void Map(WebApplication app)
    {
        var db = app.Services.GetRequiredService<OracleStore>();
        var internalHttp = app.Services.GetRequiredService<ServiceHttp>();

        app.MapGet("/health", (CancellationToken ct) => ServiceHealth.Oracle(db, "clients", ct));
        app.MapGet("/public/branches", async (CancellationToken ct) => Results.Ok(new { branches = await Branches(db, ct) }));
        app.MapGet("/branches", async (CancellationToken ct) => Results.Ok(new { branches = await Branches(db, ct) }));
        app.MapGet("/profiles", async (CancellationToken ct) => Results.Ok(new { profiles = await Profiles(db, ct) }));
        app.MapPost("/profiles", async (CreateProfileRequest body, HttpContext context, CancellationToken ct) =>
        {
            RequestContext.RequireRole(context, "ADMINISTRADOR");
            ValidateCode(body.Codigo);
            if (body.Nombre.Trim().Length is < 2 or > 80 || body.Descripcion.Trim().Length < 4 || body.MaxValesPorHorario is < 1 or > 50)
                throw new DomainException(400, "VALIDATION_ERROR", "Los campos del perfil no son válidos.");
            var id = Guid.NewGuid().ToString();
            await db.ExecuteAsync("INSERT INTO CLIENTS_SVC.PROFILES (ID,CODE,NAME,DESCRIPTION,ALLOW_MULTI,MAX_PER_WINDOW,ACTIVE) VALUES (:id,:code,:name,:description,:multi,:max,1)", c =>
            {
                OracleStore.AddText(c, "id", id); OracleStore.AddText(c, "code", body.Codigo.Trim().ToUpperInvariant());
                OracleStore.AddText(c, "name", body.Nombre.Trim()); OracleStore.AddText(c, "description", body.Descripcion.Trim());
                OracleStore.AddInt(c, "multi", body.PermiteMultiVale ? 1 : 0); OracleStore.AddInt(c, "max", body.PermiteMultiVale ? body.MaxValesPorHorario : 1);
            }, ct);
            return Results.Created($"/profiles/{id}", new { profile = new ProfileDto(id, body.Codigo.ToUpperInvariant(), body.Nombre.Trim(), body.Descripcion.Trim(), body.PermiteMultiVale, body.PermiteMultiVale ? body.MaxValesPorHorario : 1) });
        });
        app.MapPut("/profiles/{id}", async (string id, UpdateProfileRequest body, HttpContext context, CancellationToken ct) =>
        {
            RequestContext.RequireRole(context, "ADMINISTRADOR");
            if (body.Nombre?.Trim().Length is < 2 or > 80 || body.Descripcion?.Trim().Length < 4 || body.MaxValesPorHorario is < 1 or > 50)
                throw new DomainException(400, "VALIDATION_ERROR", "Los campos del perfil no son válidos.");
            var changed = await db.ExecuteAsync("UPDATE CLIENTS_SVC.PROFILES SET NAME=NVL(:name,NAME),DESCRIPTION=NVL(:description,DESCRIPTION),ALLOW_MULTI=NVL(:multi,ALLOW_MULTI),MAX_PER_WINDOW=NVL(:max,MAX_PER_WINDOW),ACTIVE=NVL(:active,ACTIVE) WHERE ID=:id", c =>
            {
                OracleStore.AddText(c, "name", body.Nombre?.Trim()); OracleStore.AddText(c, "description", body.Descripcion?.Trim());
                c.Parameters.Add("multi", OracleDbType.Int32).Value = body.PermiteMultiVale.HasValue ? (body.PermiteMultiVale.Value ? 1 : 0) : DBNull.Value;
                c.Parameters.Add("max", OracleDbType.Int32).Value = body.MaxValesPorHorario.HasValue ? body.MaxValesPorHorario.Value : DBNull.Value;
                c.Parameters.Add("active", OracleDbType.Int32).Value = body.Activo.HasValue ? (body.Activo.Value ? 1 : 0) : DBNull.Value;
                OracleStore.AddText(c, "id", id);
            }, ct);
            if (changed == 0) throw new DomainException(404, "PROFILE_NOT_FOUND", "Perfil no encontrado.");
            var profile = (await Profiles(db, ct)).FirstOrDefault(p => p.Id == id);
            return Results.Ok(new { profile });
        });

        app.MapGet("/employees/me", async (HttpContext context, CancellationToken ct) =>
        {
            var user = RequestContext.Require(context);
            var employee = await Employee(db, "e.ID=:value", user.UserId, includePersonal: true, ct)
                ?? throw new DomainException(404, "EMPLOYEE_NOT_FOUND", "No existe la ficha del usuario autenticado.");
            return Results.Ok(new { employee });
        });
        app.MapGet("/employees", async (HttpContext context, string? ids, CancellationToken ct) =>
        {
            RequestContext.RequireRole(context, "ADMINISTRADOR");
            var requested = string.IsNullOrWhiteSpace(ids) ? null : ids.Split(',').Select(x => Guid.TryParse(x, out var id) ? id.ToString() : "").Where(x => x.Length > 0).Take(100).ToArray();
            var employees = await EmployeeList(db, requested, includePersonal: true, ct);
            return Results.Ok(new { employees });
        });
        app.MapPost("/employees", async (CreateEmployeeRequest body, HttpContext context, CancellationToken ct) =>
        {
            var actor = RequestContext.Require(context);
            RequestContext.RequireRole(context, "ADMINISTRADOR");
            ValidateCode(body.CodigoFuncionario);
            if (body.Rut.Trim().Length is < 7 or > 20 || body.NombreCompleto.Trim().Length is < 3 or > 150 ||
                !System.Net.Mail.MailAddress.TryCreate(body.Email, out _) || body.Email.Length > 150 || string.IsNullOrWhiteSpace(body.Password) || body.Password.Length is < 10 or > 200 ||
                body.NumeroTurno is < 1 or > 3 || !new[] { "FUNCIONARIO", "CAJERO", "ADMINISTRADOR" }.Contains(body.Role))
                throw new DomainException(400, "VALIDATION_ERROR", "Los datos del funcionario o la contraseña son inválidos.");
            var profileId = await db.OneAsync("SELECT ID FROM CLIENTS_SVC.PROFILES WHERE CODE=:code AND ACTIVE=1", c => OracleStore.AddText(c, "code", body.PerfilCodigo.ToUpperInvariant()), r => OracleStore.Text(r, "ID"), ct)
                ?? throw new DomainException(404, "PROFILE_NOT_FOUND", "Perfil de comensal no encontrado.");
            var branchId = await db.OneAsync("SELECT ID FROM CLIENTS_SVC.BRANCHES WHERE CODE=:code AND ACTIVE=1", c => OracleStore.AddText(c, "code", body.SucursalCodigo.ToUpperInvariant()), r => OracleStore.Text(r, "ID"), ct)
                ?? throw new DomainException(404, "BRANCH_NOT_FOUND", "Sucursal no encontrada.");
            var id = Guid.NewGuid().ToString();
            var localNow = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("America/Santiago"));
            await db.TransactionAsync(async (connection, transaction, token) =>
            {
                await using var insert = new OracleCommand("INSERT INTO CLIENTS_SVC.EMPLOYEES (ID,CODE,RUT,FULL_NAME,EMAIL,USER_ROLE,PROFILE_ID,BASE_BRANCH_ID,ACTIVE) VALUES (:id,:code,:rut,:full_name,:email,:user_role,:profile_id,:branch_id,1)", connection) { BindByName = true, Transaction = transaction };
                OracleStore.AddText(insert, "id", id); OracleStore.AddText(insert, "code", body.CodigoFuncionario.ToUpperInvariant()); OracleStore.AddText(insert, "rut", body.Rut.Trim());
                OracleStore.AddText(insert, "full_name", body.NombreCompleto.Trim()); OracleStore.AddText(insert, "email", body.Email.Trim().ToLowerInvariant()); OracleStore.AddText(insert, "user_role", body.Role);
                OracleStore.AddText(insert, "profile_id", profileId); OracleStore.AddText(insert, "branch_id", branchId); await insert.ExecuteNonQueryAsync(token);
                await using var shift = new OracleCommand("INSERT INTO CLIENTS_SVC.SHIFTS (ID,EMPLOYEE_ID,SHIFT_YEAR,SHIFT_MONTH,NUMBER_VALUE,BRANCH_ID) VALUES (:shift_id,:employee_id,:shift_year,:shift_month,:number_value,:branch_id)", connection) { BindByName = true, Transaction = transaction };
                OracleStore.AddText(shift, "shift_id", Guid.NewGuid().ToString()); OracleStore.AddText(shift, "employee_id", id); OracleStore.AddInt(shift, "shift_year", localNow.Year); OracleStore.AddInt(shift, "shift_month", localNow.Month);
                OracleStore.AddInt(shift, "number_value", body.NumeroTurno); OracleStore.AddText(shift, "branch_id", branchId); await shift.ExecuteNonQueryAsync(token);
                return id;
            }, ct);
            try
            {
                await internalHttp.PostAsync<AuthUserResponse>("AUTH", "/auth/users", new CreateAuthUserRequest(body.CodigoFuncionario.ToUpperInvariant(), body.Password!, body.Role), actor, InternalSecurity.CorrelationId(context), ct);
            }
            catch
            {
                await db.ExecuteAsync("DELETE FROM CLIENTS_SVC.SHIFTS WHERE EMPLOYEE_ID=:id", c => OracleStore.AddText(c, "id", id), ct);
                await db.ExecuteAsync("DELETE FROM CLIENTS_SVC.EMPLOYEES WHERE ID=:id", c => OracleStore.AddText(c, "id", id), ct);
                throw;
            }
            var employee = await Employee(db, "e.ID=:value", id, includePersonal: true, ct);
            return Results.Created($"/employees/{id}", new { employee });
        });
        app.MapGet("/employees/{id}", async (string id, HttpContext context, CancellationToken ct) =>
        {
            var user = RequestContext.Require(context);
            if (user.Role != "ADMINISTRADOR" && user.UserId != id)
                throw new DomainException(403, "FORBIDDEN", "Solo puedes consultar tu propia ficha.");
            var employee = await Employee(db, "e.ID=:value", id, includePersonal: user.Role == "ADMINISTRADOR" || user.UserId == id, ct)
                ?? throw new DomainException(404, "EMPLOYEE_NOT_FOUND", "Funcionario no encontrado.");
            return Results.Ok(new { employee });
        });
        app.MapPut("/employees/{id}/shift", async (string id, AssignShiftRequest body, HttpContext context, CancellationToken ct) =>
        {
            RequestContext.RequireRole(context, "ADMINISTRADOR");
            if (body.NumeroTurno is < 1 or > 3) throw new DomainException(400, "VALIDATION_ERROR", "El número de turno debe ser 1, 2 o 3.");
            var year = body.Anio ?? DateTime.UtcNow.Year;
            var month = body.Mes ?? DateTime.UtcNow.Month;
            var branchCode = body.SucursalCodigo ?? await db.OneAsync("SELECT BASE_BRANCH_CODE FROM CLIENTS_SVC.EMPLOYEES WHERE ID=:id", c => OracleStore.AddText(c, "id", id), r => OracleStore.Text(r, "BASE_BRANCH_CODE"), ct)
                ?? throw new DomainException(404, "EMPLOYEE_NOT_FOUND", "Funcionario no encontrado.");
            var branchId = await db.OneAsync("SELECT ID FROM CLIENTS_SVC.BRANCHES WHERE CODE=:code AND ACTIVE=1", c => OracleStore.AddText(c, "code", branchCode), r => OracleStore.Text(r, "ID"), ct)
                ?? throw new DomainException(404, "BRANCH_NOT_FOUND", "Sucursal no encontrada.");
            var shiftId = Guid.NewGuid().ToString();
            await db.ExecuteAsync("MERGE INTO CLIENTS_SVC.SHIFTS t USING (SELECT :employee_id EMPLOYEE_ID, :shift_year SHIFT_YEAR, :shift_month SHIFT_MONTH FROM dual) s ON (t.EMPLOYEE_ID=s.EMPLOYEE_ID AND t.SHIFT_YEAR=s.SHIFT_YEAR AND t.SHIFT_MONTH=s.SHIFT_MONTH) WHEN MATCHED THEN UPDATE SET t.NUMBER_VALUE=:number_value,t.BRANCH_ID=:branch_id WHEN NOT MATCHED THEN INSERT (ID,EMPLOYEE_ID,SHIFT_YEAR,SHIFT_MONTH,NUMBER_VALUE,BRANCH_ID) VALUES (:id,:employee_id,:shift_year,:shift_month,:number_value,:branch_id)", c =>
            {
                OracleStore.AddText(c, "employee_id", id); OracleStore.AddInt(c, "shift_year", year); OracleStore.AddInt(c, "shift_month", month);
                OracleStore.AddInt(c, "number_value", body.NumeroTurno); OracleStore.AddText(c, "branch_id", branchId); OracleStore.AddText(c, "id", shiftId);
            }, ct);
            return Results.Ok(new { shift = new ShiftDto(year, month, body.NumeroTurno, branchCode) });
        });
    }

    private static async Task<IReadOnlyList<BranchDto>> Branches(OracleStore db, CancellationToken ct)
    {
        var rows = await db.ManyAsync("SELECT ID,CODE,NAME FROM CLIENTS_SVC.BRANCHES WHERE ACTIVE=1 ORDER BY CODE", null,
            r => (Id: OracleStore.Text(r, "ID"), Code: OracleStore.Text(r, "CODE"), Name: OracleStore.Text(r, "NAME")), ct);
        var result = new List<BranchDto>();
        foreach (var branch in rows)
        {
            var casinos = await db.ManyAsync("SELECT CODE,NAME,CASINO_TYPE TYPE FROM CLIENTS_SVC.CASINOS WHERE BRANCH_ID=:id AND ACTIVE=1 ORDER BY CODE",
                c => OracleStore.AddText(c, "id", branch.Id), r => new CasinoDto(OracleStore.Text(r, "CODE"), OracleStore.Text(r, "NAME"), OracleStore.Text(r, "TYPE")), ct);
            result.Add(new BranchDto(branch.Id, branch.Code, branch.Name, casinos));
        }
        return result;
    }

    private static async Task<IReadOnlyList<ProfileDto>> Profiles(OracleStore db, CancellationToken ct)
        => await db.ManyAsync("SELECT ID,CODE,NAME,DESCRIPTION,ALLOW_MULTI,MAX_PER_WINDOW,ACTIVE FROM CLIENTS_SVC.PROFILES ORDER BY CODE", null,
            r => new ProfileDto(OracleStore.Text(r, "ID"), OracleStore.Text(r, "CODE"), OracleStore.Text(r, "NAME"), OracleStore.Text(r, "DESCRIPTION"), OracleStore.Bool(r, "ALLOW_MULTI"), OracleStore.Int(r, "MAX_PER_WINDOW"), OracleStore.Bool(r, "ACTIVE")), ct);

    private static async Task<EmployeeDto?> Employee(OracleStore db, string predicate, string value, bool includePersonal, CancellationToken ct)
    {
        var sql = $"SELECT e.ID,e.CODE,e.FULL_NAME,e.USER_ROLE ROLE,e.ACTIVE,e.RUT,e.EMAIL,p.CODE PROFILE_CODE,p.NAME PROFILE_NAME,p.ALLOW_MULTI,p.MAX_PER_WINDOW,b.CODE BASE_BRANCH_CODE,b.NAME BASE_BRANCH_NAME,s.NUMBER_VALUE SHIFT_NUMBER,sb.CODE SHIFT_BRANCH_CODE FROM CLIENTS_SVC.EMPLOYEES e JOIN CLIENTS_SVC.PROFILES p ON p.ID=e.PROFILE_ID JOIN CLIENTS_SVC.BRANCHES b ON b.ID=e.BASE_BRANCH_ID LEFT JOIN CLIENTS_SVC.SHIFTS s ON s.EMPLOYEE_ID=e.ID AND s.SHIFT_YEAR=EXTRACT(YEAR FROM SYSTIMESTAMP AT TIME ZONE 'America/Santiago') AND s.SHIFT_MONTH=EXTRACT(MONTH FROM SYSTIMESTAMP AT TIME ZONE 'America/Santiago') LEFT JOIN CLIENTS_SVC.BRANCHES sb ON sb.ID=s.BRANCH_ID WHERE {predicate}";
        return await db.OneAsync(sql, c => OracleStore.AddText(c, "value", value), r => new EmployeeDto(
            OracleStore.Text(r, "ID"), OracleStore.Text(r, "CODE"), OracleStore.Text(r, "FULL_NAME"), OracleStore.Text(r, "ROLE"), OracleStore.Bool(r, "ACTIVE"),
            OracleStore.Text(r, "PROFILE_CODE"), OracleStore.Text(r, "PROFILE_NAME"), OracleStore.Bool(r, "ALLOW_MULTI"), OracleStore.Int(r, "MAX_PER_WINDOW"),
            OracleStore.Text(r, "BASE_BRANCH_CODE"), OracleStore.Text(r, "BASE_BRANCH_NAME"), r["SHIFT_NUMBER"] is DBNull ? null : OracleStore.Int(r, "SHIFT_NUMBER"),
            OracleStore.NullableText(r, "SHIFT_BRANCH_CODE"), includePersonal ? OracleStore.Text(r, "RUT") : null, includePersonal ? OracleStore.Text(r, "EMAIL") : null), ct);
    }

    private static async Task<IReadOnlyList<EmployeeDto>> EmployeeList(OracleStore db, string[]? ids, bool includePersonal, CancellationToken ct)
    {
        if (ids is { Length: 0 }) return [];
        var sql = "SELECT e.ID,e.CODE,e.FULL_NAME,e.USER_ROLE ROLE,e.ACTIVE,e.RUT,e.EMAIL,p.CODE PROFILE_CODE,p.NAME PROFILE_NAME,p.ALLOW_MULTI,p.MAX_PER_WINDOW,b.CODE BASE_BRANCH_CODE,b.NAME BASE_BRANCH_NAME,s.NUMBER_VALUE SHIFT_NUMBER,sb.CODE SHIFT_BRANCH_CODE FROM CLIENTS_SVC.EMPLOYEES e JOIN CLIENTS_SVC.PROFILES p ON p.ID=e.PROFILE_ID JOIN CLIENTS_SVC.BRANCHES b ON b.ID=e.BASE_BRANCH_ID LEFT JOIN CLIENTS_SVC.SHIFTS s ON s.EMPLOYEE_ID=e.ID AND s.SHIFT_YEAR=EXTRACT(YEAR FROM SYSTIMESTAMP AT TIME ZONE 'America/Santiago') AND s.SHIFT_MONTH=EXTRACT(MONTH FROM SYSTIMESTAMP AT TIME ZONE 'America/Santiago') LEFT JOIN CLIENTS_SVC.BRANCHES sb ON sb.ID=s.BRANCH_ID WHERE e.ACTIVE=1";
        if (ids is not null) sql += " AND e.ID IN (" + string.Join(',', ids.Select((_, i) => $":id{i}")) + ")";
        return await db.ManyAsync(sql, c =>
        {
            if (ids is not null) for (var i = 0; i < ids.Length; i++) OracleStore.AddText(c, $"id{i}", ids[i]);
        }, r => new EmployeeDto(OracleStore.Text(r, "ID"), OracleStore.Text(r, "CODE"), OracleStore.Text(r, "FULL_NAME"), OracleStore.Text(r, "ROLE"), OracleStore.Bool(r, "ACTIVE"),
            OracleStore.Text(r, "PROFILE_CODE"), OracleStore.Text(r, "PROFILE_NAME"), OracleStore.Bool(r, "ALLOW_MULTI"), OracleStore.Int(r, "MAX_PER_WINDOW"),
            OracleStore.Text(r, "BASE_BRANCH_CODE"), OracleStore.Text(r, "BASE_BRANCH_NAME"), r["SHIFT_NUMBER"] is DBNull ? null : OracleStore.Int(r, "SHIFT_NUMBER"),
            OracleStore.NullableText(r, "SHIFT_BRANCH_CODE"), includePersonal ? OracleStore.Text(r, "RUT") : null, includePersonal ? OracleStore.Text(r, "EMAIL") : null), ct);
    }

    private static void ValidateCode(string code)
    {
        if (string.IsNullOrWhiteSpace(code) || code.Length > 40 || code.Any(c => !(char.IsAsciiLetterOrDigit(c) || c == '_')))
            throw new DomainException(400, "VALIDATION_ERROR", "El código solo puede contener letras, números y guion bajo.");
    }
}

public sealed record AssignShiftRequest(int NumeroTurno, string? SucursalCodigo, int? Anio, int? Mes);
public sealed record UpdateProfileRequest(string? Nombre, string? Descripcion, bool? PermiteMultiVale, int? MaxValesPorHorario, bool? Activo);
public sealed record AuthUserResponse(string Id, string CodigoFuncionario, string Role, bool Activo);
