namespace Libros.Api;

public sealed record UserContext(string UserId, string Code, string Role);
public sealed record LoginRequest(string CodigoFuncionario, string Password);
public sealed record EmployeeDto(string Id, string CodigoFuncionario, string NombreCompleto, string Role, bool Activo,
    string PerfilCodigo, string PerfilNombre, bool PermiteMultiVale, int MaxValesPorHorario,
    string SucursalBaseCodigo, string SucursalBaseNombre, int? NumeroTurno, string? SucursalAsignadaCodigo,
    string? Rut = null, string? Email = null);
public sealed record ShiftDto(int Anio, int Mes, int NumeroTurno, string SucursalAsignadaCodigo);
public sealed record BranchDto(string Id, string Codigo, string Nombre, IReadOnlyList<CasinoDto> Casinos);
public sealed record CasinoDto(string Codigo, string Nombre, string Tipo);
public sealed record ProfileDto(string Id, string Codigo, string Nombre, string Descripcion, bool PermiteMultiVale, int MaxValesPorHorario, bool Activo = true);
public sealed record ServiceWindowDto(int NumeroTurno, string HoraInicio, string HoraFin);
public sealed record ValuationDto(string PerfilCodigo, int ValorClp, bool Vigente);
public sealed record FoodServiceDto(string Id, string Codigo, string Nombre, string Descripcion, bool EsBase,
    bool Activo, IReadOnlyList<ServiceWindowDto> Horarios, IReadOnlyList<ValuationDto> Valorizaciones);
public sealed record ProductDto(string Id, string Codigo, string Nombre, string Categoria, int PrecioClp, bool Disponible);
public sealed record VoucherDto(string Id, string NumeroVale, string? FuncionarioId, string? CodigoFuncionario,
    string NombreBeneficiario, string PerfilCodigo, string ServicioCodigo, string ServicioNombre,
    string TipoVale, int NumeroTurno, string FechaVigencia, string HoraInicioPermitida,
    string HoraFinPermitida, int ValorClp, string SucursalEmisionCodigo, string Estado,
    DateTime EmitidoEn, DateTime? ImpresoEn, string? MotivoAdicional);
public sealed record IssueVoucherRequest(string? ServicioCodigo, string? SucursalEmisionCodigo, string? NombreBeneficiarioVisita);
public sealed record AdditionalVoucherRequest(string TipoVale, string? FuncionarioCodigo, string? NombreBeneficiarioVisita,
    string ServicioCodigo, string? SucursalEmisionCodigo, string MotivoAdicional, bool ImprimirInmediato = false);
public sealed record QuoteItemRequest(string ProductoId, int Cantidad);
public sealed record QuoteRequest(IReadOnlyList<QuoteItemRequest> Items);
public sealed record QuotedItem(string ProductoId, string ProductoCodigo, string ProductoNombre, int Cantidad, int PrecioUnitarioClp, int SubtotalClp);
public sealed record QuoteDto(IReadOnlyList<QuotedItem> Items, int TotalConsumoClp);
public sealed record RedeemRequest(string CasinoCodigo, IReadOnlyList<QuoteItemRequest> Items, string MetodoPagoDiferencia);
public sealed record SettleRequest(string IdempotencyKey, string ValeId, string NumeroVale, string FuncionarioId,
    string CajeroId, string CasinoCodigo, int ValorValeClp, int TotalConsumoClp, string MetodoPagoDiferencia);
public sealed record PaymentTransactionDto(string Id, string ValeId, string NumeroVale, int ValorValeClp,
    int TotalConsumoClp, int MontoCubiertoValeClp, int SaldoAFavorClp, int DiferenciaPagadaClp,
    string MetodoPagoDiferencia, string Estado, DateTime CreatedAt);
public sealed record CreateServiceRequest(string Codigo, string Nombre, string Descripcion, bool EsBase,
    IReadOnlyList<ServiceWindowDto> Horarios, IReadOnlyList<ValuationDto> Valorizaciones);
public sealed record CreateProductRequest(string Codigo, string Nombre, string Categoria, int PrecioClp, bool Disponible = true);
public sealed record CreateProfileRequest(string Codigo, string Nombre, string Descripcion, bool PermiteMultiVale = false, int MaxValesPorHorario = 1);
public sealed record CreateEmployeeRequest(string CodigoFuncionario, string Rut, string NombreCompleto, string Email,
    string Role, string PerfilCodigo, string SucursalCodigo, int NumeroTurno = 1, string? Password = null);

public sealed class DomainException(int status, string code, string message) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}

public static class RequestContext
{
    public static UserContext? Get(HttpContext context)
    {
        var id = context.Request.Headers["x-user-id"].FirstOrDefault();
        var code = context.Request.Headers["x-user-code"].FirstOrDefault();
        var role = context.Request.Headers["x-user-role"].FirstOrDefault();
        return string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(role)
            ? null
            : new UserContext(id, code, role);
    }

    public static UserContext Require(HttpContext context)
        => Get(context) ?? throw new DomainException(401, "UNAUTHENTICATED", "Se requiere una sesión válida.");

    public static void RequireRole(HttpContext context, params string[] roles)
    {
        var user = Require(context);
        if (!roles.Contains(user.Role, StringComparer.Ordinal))
            throw new DomainException(403, "FORBIDDEN", "El rol no puede realizar esta operación.");
    }
}
