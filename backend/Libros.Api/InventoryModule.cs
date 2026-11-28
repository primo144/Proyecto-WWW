using Oracle.ManagedDataAccess.Client;

namespace Libros.Api;

public static class InventoryModule
{
    public static void Map(WebApplication app)
    {
        var db = app.Services.GetRequiredService<OracleStore>();
        app.MapGet("/health", (CancellationToken ct) => ServiceHealth.Oracle(db, "inventory", ct));
        app.MapGet("/public/products", async (bool? available, CancellationToken ct) =>
            Results.Ok(new { products = await Products(db, available, ct) }));
        app.MapGet("/products", async (bool? available, HttpContext context, CancellationToken ct) =>
        {
            RequestContext.Require(context);
            return Results.Ok(new { products = await Products(db, available, ct) });
        });
        app.MapGet("/services", async (bool? activo, int? turno, string? perfilCodigo, CancellationToken ct) =>
        {
            if (turno is < 1 or > 3) throw new DomainException(400, "INVALID_FILTER", "turno debe ser 1, 2 o 3.");
            return Results.Ok(new { services = await Services(db, activo, turno, perfilCodigo, ct) });
        });
        app.MapGet("/valuations", async (HttpContext context, CancellationToken ct) =>
        {
            RequestContext.Require(context);
            var valuations = await db.ManyAsync("SELECT v.SERVICE_ID,s.CODE SERVICE_CODE,v.PROFILE_CODE,v.AMOUNT_CLP,v.ACTIVE FROM INVENTORY_SVC.VALUATIONS v JOIN INVENTORY_SVC.FOOD_SERVICES s ON s.ID=v.SERVICE_ID ORDER BY s.CODE,v.PROFILE_CODE", null,
                r => new { servicioId = OracleStore.Text(r, "SERVICE_ID"), servicioCodigo = OracleStore.Text(r, "SERVICE_CODE"), perfilCodigo = OracleStore.Text(r, "PROFILE_CODE"), valorClp = OracleStore.Int(r, "AMOUNT_CLP"), vigente = OracleStore.Bool(r, "ACTIVE") }, ct);
            return Results.Ok(new { valuations });
        });
        app.MapPost("/services", async (CreateServiceRequest body, HttpContext context, CancellationToken ct) =>
        {
            RequestContext.RequireRole(context, "ADMINISTRADOR");
            ValidateService(body);
            var id = Guid.NewGuid().ToString();
            await db.TransactionAsync(async (connection, transaction, token) =>
            {
                await Insert(connection, transaction, "INSERT INTO INVENTORY_SVC.FOOD_SERVICES (ID,CODE,NAME,DESCRIPTION,IS_BASE,ACTIVE) VALUES (:id,:code,:name,:description,:is_base,1)", c =>
                {
                    OracleStore.AddText(c, "id", id); OracleStore.AddText(c, "code", body.Codigo.ToUpperInvariant()); OracleStore.AddText(c, "name", body.Nombre.Trim());
                    OracleStore.AddText(c, "description", body.Descripcion.Trim()); OracleStore.AddInt(c, "is_base", body.EsBase ? 1 : 0);
                }, token);
                foreach (var window in body.Horarios)
                    await Insert(connection, transaction, "INSERT INTO INVENTORY_SVC.SERVICE_WINDOWS (ID,SERVICE_ID,SHIFT_NUMBER,START_TIME,END_TIME) VALUES (:id,:service_id,:shift,:start_time,:end_time)", c =>
                    {
                        OracleStore.AddText(c, "id", Guid.NewGuid().ToString()); OracleStore.AddText(c, "service_id", id); OracleStore.AddInt(c, "shift", window.NumeroTurno);
                        OracleStore.AddText(c, "start_time", window.HoraInicio); OracleStore.AddText(c, "end_time", window.HoraFin);
                    }, token);
                foreach (var valuation in body.Valorizaciones)
                    await Insert(connection, transaction, "INSERT INTO INVENTORY_SVC.VALUATIONS (ID,SERVICE_ID,PROFILE_CODE,AMOUNT_CLP,ACTIVE) VALUES (:id,:service_id,:profile,:amount,1)", c =>
                    {
                        OracleStore.AddText(c, "id", Guid.NewGuid().ToString()); OracleStore.AddText(c, "service_id", id); OracleStore.AddText(c, "profile", valuation.PerfilCodigo);
                        OracleStore.AddInt(c, "amount", valuation.ValorClp);
                    }, token);
                return id;
            }, ct);
            return Results.Created($"/services/{id}", new { service = (await ServiceById(db, id, ct))! });
        });
        app.MapPut("/services/{id}", async (string id, UpdateServiceRequest body, HttpContext context, CancellationToken ct) =>
        {
            RequestContext.RequireRole(context, "ADMINISTRADOR");
            var changed = await db.ExecuteAsync("UPDATE INVENTORY_SVC.FOOD_SERVICES SET NAME=NVL(:name,NAME),DESCRIPTION=NVL(:description,DESCRIPTION),ACTIVE=NVL(:active,ACTIVE) WHERE ID=:id",
                c => { OracleStore.AddText(c, "name", body.Nombre); OracleStore.AddText(c, "description", body.Descripcion); c.Parameters.Add("active", OracleDbType.Int32).Value = body.Activo.HasValue ? (body.Activo.Value ? 1 : 0) : DBNull.Value; OracleStore.AddText(c, "id", id); }, ct);
            if (changed == 0) throw new DomainException(404, "SERVICE_NOT_FOUND", "Servicio no encontrado.");
            return Results.Ok(new { service = (await ServiceById(db, id, ct))! });
        });
        app.MapPut("/valuations", async (UpdateValuationRequest body, HttpContext context, CancellationToken ct) =>
        {
            RequestContext.RequireRole(context, "ADMINISTRADOR");
            if (body.ValorClp <= 0) throw new DomainException(400, "VALIDATION_ERROR", "El valor debe ser positivo.");
            await db.ExecuteAsync("MERGE INTO INVENTORY_SVC.VALUATIONS t USING (SELECT :service_id SERVICE_ID,:profile PROFILE_CODE FROM dual) s ON (t.SERVICE_ID=s.SERVICE_ID AND t.PROFILE_CODE=s.PROFILE_CODE) WHEN MATCHED THEN UPDATE SET t.AMOUNT_CLP=:amount,t.ACTIVE=:active WHEN NOT MATCHED THEN INSERT (ID,SERVICE_ID,PROFILE_CODE,AMOUNT_CLP,ACTIVE) VALUES (:id,:service_id,:profile,:amount,:active)", c =>
            {
                OracleStore.AddText(c, "service_id", body.ServicioId); OracleStore.AddText(c, "profile", body.PerfilCodigo); OracleStore.AddInt(c, "amount", body.ValorClp);
                OracleStore.AddInt(c, "active", body.Vigente ? 1 : 0); OracleStore.AddText(c, "id", Guid.NewGuid().ToString());
            }, ct);
            return Results.Ok(new { valuation = body });
        });
        app.MapPost("/products", async (CreateProductRequest body, HttpContext context, CancellationToken ct) =>
        {
            RequestContext.RequireRole(context, "ADMINISTRADOR");
            ValidateProduct(body);
            var id = Guid.NewGuid().ToString();
            await db.ExecuteAsync("INSERT INTO INVENTORY_SVC.PRODUCTS (ID,CODE,NAME,CATEGORY,PRICE_CLP,AVAILABLE) VALUES (:id,:code,:name,:category,:price,:available)", c =>
            {
                OracleStore.AddText(c, "id", id); OracleStore.AddText(c, "code", body.Codigo.ToUpperInvariant()); OracleStore.AddText(c, "name", body.Nombre.Trim());
                OracleStore.AddText(c, "category", body.Categoria.Trim()); OracleStore.AddInt(c, "price", body.PrecioClp); OracleStore.AddInt(c, "available", body.Disponible ? 1 : 0);
            }, ct);
            return Results.Created($"/products/{id}", new { product = new ProductDto(id, body.Codigo.ToUpperInvariant(), body.Nombre.Trim(), body.Categoria.Trim(), body.PrecioClp, body.Disponible) });
        });
        app.MapPut("/products/{id}", async (string id, UpdateProductRequest body, HttpContext context, CancellationToken ct) =>
        {
            RequestContext.RequireRole(context, "ADMINISTRADOR");
            var changed = await db.ExecuteAsync("UPDATE INVENTORY_SVC.PRODUCTS SET NAME=NVL(:name,NAME),CATEGORY=NVL(:category,CATEGORY),PRICE_CLP=NVL(:price,PRICE_CLP),AVAILABLE=NVL(:available,AVAILABLE) WHERE ID=:id", c =>
            {
                OracleStore.AddText(c, "name", body.Nombre); OracleStore.AddText(c, "category", body.Categoria);
                c.Parameters.Add("price", OracleDbType.Int32).Value = body.PrecioClp.HasValue ? body.PrecioClp.Value : DBNull.Value;
                c.Parameters.Add("available", OracleDbType.Int32).Value = body.Disponible.HasValue ? (body.Disponible.Value ? 1 : 0) : DBNull.Value;
                OracleStore.AddText(c, "id", id);
            }, ct);
            if (changed == 0) throw new DomainException(404, "PRODUCT_NOT_FOUND", "Producto no encontrado.");
            var product = await db.OneAsync("SELECT ID,CODE,NAME,CATEGORY,PRICE_CLP,AVAILABLE FROM INVENTORY_SVC.PRODUCTS WHERE ID=:id", c => OracleStore.AddText(c, "id", id), MapProduct, ct);
            return Results.Ok(new { product });
        });
        app.MapPost("/internal/products/quote", async (QuoteRequest body, HttpContext context, CancellationToken ct) =>
        {
            if (body.Items is null || body.Items.Count is < 1 or > 50 || body.Items.Any(i => i.Cantidad is < 1 or > 100))
                throw new DomainException(400, "VALIDATION_ERROR", "Los productos y cantidades no son válidos.");
            return Results.Ok(await Quote(db, body, ct));
        });
    }

    public static async Task<QuoteDto> Quote(OracleStore db, QuoteRequest body, CancellationToken ct)
    {
        var items = new List<QuotedItem>();
        foreach (var item in body.Items)
        {
            var product = await db.OneAsync("SELECT ID,CODE,NAME,CATEGORY,PRICE_CLP,AVAILABLE FROM INVENTORY_SVC.PRODUCTS WHERE ID=:id AND AVAILABLE=1", c => OracleStore.AddText(c, "id", item.ProductoId), MapProduct, ct)
                ?? throw new DomainException(409, "PRODUCT_UNAVAILABLE", $"El producto {item.ProductoId} no está disponible.");
            checked { items.Add(new QuotedItem(product.Id, product.Codigo, product.Nombre, item.Cantidad, product.PrecioClp, product.PrecioClp * item.Cantidad)); }
        }
        return new QuoteDto(items, items.Sum(x => x.SubtotalClp));
    }

    public static async Task<IReadOnlyList<FoodServiceDto>> Services(OracleStore db, bool? active, int? shift, string? profile, CancellationToken ct)
    {
        var rows = await db.ManyAsync("SELECT s.ID,s.CODE,s.NAME,s.DESCRIPTION,s.IS_BASE,s.ACTIVE FROM INVENTORY_SVC.FOOD_SERVICES s WHERE (:active IS NULL OR s.ACTIVE=:active) AND (:shift IS NULL OR EXISTS (SELECT 1 FROM INVENTORY_SVC.SERVICE_WINDOWS w WHERE w.SERVICE_ID=s.ID AND w.SHIFT_NUMBER=:shift)) AND (:profile IS NULL OR EXISTS (SELECT 1 FROM INVENTORY_SVC.VALUATIONS v WHERE v.SERVICE_ID=s.ID AND v.PROFILE_CODE=:profile AND v.ACTIVE=1)) ORDER BY s.CODE", c =>
        {
            c.Parameters.Add("active", OracleDbType.Int32).Value = active.HasValue ? (active.Value ? 1 : 0) : DBNull.Value;
            c.Parameters.Add("shift", OracleDbType.Int32).Value = shift.HasValue ? shift.Value : DBNull.Value;
            OracleStore.AddText(c, "profile", profile);
        }, MapServiceRow, ct);
        var result = new List<FoodServiceDto>();
        foreach (var row in rows)
        {
            var windows = await db.ManyAsync("SELECT SHIFT_NUMBER,START_TIME,END_TIME FROM INVENTORY_SVC.SERVICE_WINDOWS WHERE SERVICE_ID=:id ORDER BY SHIFT_NUMBER", c => OracleStore.AddText(c, "id", row.Id),
                r => new ServiceWindowDto(OracleStore.Int(r, "SHIFT_NUMBER"), OracleStore.Text(r, "START_TIME"), OracleStore.Text(r, "END_TIME")), ct);
            var valuations = await db.ManyAsync("SELECT PROFILE_CODE,AMOUNT_CLP,ACTIVE FROM INVENTORY_SVC.VALUATIONS WHERE SERVICE_ID=:id ORDER BY PROFILE_CODE", c => OracleStore.AddText(c, "id", row.Id),
                r => new ValuationDto(OracleStore.Text(r, "PROFILE_CODE"), OracleStore.Int(r, "AMOUNT_CLP"), OracleStore.Bool(r, "ACTIVE")), ct);
            result.Add(row with { Horarios = windows, Valorizaciones = valuations });
        }
        return result;
    }

    private static async Task<IReadOnlyList<ProductDto>> Products(OracleStore db, bool? available, CancellationToken ct)
        => await db.ManyAsync("SELECT ID,CODE,NAME,CATEGORY,PRICE_CLP,AVAILABLE FROM INVENTORY_SVC.PRODUCTS WHERE (:available IS NULL OR AVAILABLE=:available) ORDER BY CODE", c => c.Parameters.Add("available", OracleDbType.Int32).Value = available.HasValue ? (available.Value ? 1 : 0) : DBNull.Value, MapProduct, ct);

    private static async Task<FoodServiceDto?> ServiceById(OracleStore db, string id, CancellationToken ct)
        => (await Services(db, null, null, null, ct)).FirstOrDefault(s => s.Id == id);

    private static FoodServiceDto MapServiceRow(OracleDataReader r) => new(OracleStore.Text(r, "ID"), OracleStore.Text(r, "CODE"), OracleStore.Text(r, "NAME"), OracleStore.Text(r, "DESCRIPTION"), OracleStore.Bool(r, "IS_BASE"), OracleStore.Bool(r, "ACTIVE"), [], []);
    private static ProductDto MapProduct(OracleDataReader r) => new(OracleStore.Text(r, "ID"), OracleStore.Text(r, "CODE"), OracleStore.Text(r, "NAME"), OracleStore.Text(r, "CATEGORY"), OracleStore.Int(r, "PRICE_CLP"), OracleStore.Bool(r, "AVAILABLE"));

    private static async Task Insert(OracleConnection connection, OracleTransaction transaction, string sql, Action<OracleCommand> bind, CancellationToken ct)
    {
        await using var command = new OracleCommand(sql, connection) { BindByName = true, Transaction = transaction };
        bind(command);
        await command.ExecuteNonQueryAsync(ct);
    }

    private static void ValidateService(CreateServiceRequest body)
    {
        ValidateCode(body.Codigo);
        if (body.Nombre.Trim().Length is < 2 or > 100 || body.Descripcion.Trim().Length < 4 || body.Valorizaciones.Count == 0 || body.Valorizaciones.Any(v => v.ValorClp <= 0))
            throw new DomainException(400, "VALIDATION_ERROR", "El servicio debe tener nombre, descripción y valorizaciones positivas.");
        if (body.Horarios.Any(h => h.NumeroTurno is < 1 or > 3 || !ValidTime(h.HoraInicio) || !ValidTime(h.HoraFin)))
            throw new DomainException(400, "VALIDATION_ERROR", "Los horarios deben usar formato HH:mm y turnos 1, 2 o 3.");
    }

    private static bool ValidTime(string value) => TimeOnly.TryParseExact(value, "HH:mm", out _) || value == "24:00";
    private static void ValidateProduct(CreateProductRequest body)
    {
        ValidateCode(body.Codigo);
        if (body.PrecioClp <= 0 || body.Nombre.Trim().Length is < 2 or > 120 || body.Categoria.Trim().Length < 2)
            throw new DomainException(400, "VALIDATION_ERROR", "Los campos del producto no son válidos.");
    }
    private static void ValidateCode(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 40 || value.Any(c => !(char.IsAsciiLetterOrDigit(c) || c == '_')))
            throw new DomainException(400, "VALIDATION_ERROR", "El código solo admite letras, números y guion bajo.");
    }
}

public sealed record UpdateServiceRequest(string? Nombre, string? Descripcion, bool? Activo);
public sealed record UpdateValuationRequest(string ServicioId, string PerfilCodigo, int ValorClp, bool Vigente = true);
public sealed record UpdateProductRequest(string? Nombre, string? Categoria, int? PrecioClp, bool? Disponible);
