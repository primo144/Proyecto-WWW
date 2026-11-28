using Oracle.ManagedDataAccess.Client;
using System.Data;

namespace Libros.Api;

public sealed class OracleStore(IConfiguration configuration)
{
    private readonly string _connectionString = configuration["ORACLE_CONNECTION_STRING"]
        ?? throw new InvalidOperationException("ORACLE_CONNECTION_STRING no está configurado.");

    public async Task<T?> OneAsync<T>(string sql, Action<OracleCommand>? bind, Func<OracleDataReader, T> map, CancellationToken ct = default)
    {
        await using var connection = new OracleConnection(_connectionString);
        await connection.OpenAsync(ct);
        await using var command = new OracleCommand(sql, connection) { BindByName = true };
        bind?.Invoke(command);
        await using var reader = await command.ExecuteReaderAsync(CommandBehavior.SingleRow, ct);
        return await reader.ReadAsync(ct) ? map(reader) : default;
    }

    public async Task<List<T>> ManyAsync<T>(string sql, Action<OracleCommand>? bind, Func<OracleDataReader, T> map, CancellationToken ct = default)
    {
        await using var connection = new OracleConnection(_connectionString);
        await connection.OpenAsync(ct);
        await using var command = new OracleCommand(sql, connection) { BindByName = true };
        bind?.Invoke(command);
        await using var reader = await command.ExecuteReaderAsync(ct);
        var result = new List<T>();
        while (await reader.ReadAsync(ct)) result.Add(map(reader));
        return result;
    }

    public async Task<int> ExecuteAsync(string sql, Action<OracleCommand>? bind, CancellationToken ct = default)
    {
        await using var connection = new OracleConnection(_connectionString);
        await connection.OpenAsync(ct);
        await using var command = new OracleCommand(sql, connection) { BindByName = true };
        bind?.Invoke(command);
        return await command.ExecuteNonQueryAsync(ct);
    }

    public async Task<T> TransactionAsync<T>(Func<OracleConnection, OracleTransaction, CancellationToken, Task<T>> action, CancellationToken ct = default)
    {
        await using var connection = new OracleConnection(_connectionString);
        await connection.OpenAsync(ct);
        // Row-level state checks and unique constraints enforce the business invariants; ReadCommitted avoids
        // Oracle ORA-08177 serialization failures during legitimate concurrent updates to different records.
        await using var transaction = connection.BeginTransaction(IsolationLevel.ReadCommitted);
        try
        {
            var value = await action(connection, transaction, ct);
            await transaction.CommitAsync(ct);
            return value;
        }
        catch
        {
            await transaction.RollbackAsync(ct);
            throw;
        }
    }

    public static string Text(OracleDataReader r, string name) => r[name] is DBNull ? "" : Convert.ToString(r[name]) ?? "";
    public static string? NullableText(OracleDataReader r, string name) => r[name] is DBNull ? null : Convert.ToString(r[name]);
    public static int Int(OracleDataReader r, string name) => Convert.ToInt32(r[name]);
    public static bool Bool(OracleDataReader r, string name) => Convert.ToInt32(r[name]) == 1;
    public static DateTime Date(OracleDataReader r, string name) => Convert.ToDateTime(r[name]);
    public static DateTime? NullableDate(OracleDataReader r, string name) => r[name] is DBNull ? null : Convert.ToDateTime(r[name]);

    public static void AddText(OracleCommand command, string name, string? value, int size = 4000)
        => command.Parameters.Add(name, OracleDbType.Varchar2, size).Value = (object?)value ?? DBNull.Value;
    public static void AddInt(OracleCommand command, string name, int value)
        => command.Parameters.Add(name, OracleDbType.Int32).Value = value;
    public static void AddDate(OracleCommand command, string name, DateTime value)
        => command.Parameters.Add(name, OracleDbType.TimeStamp).Value = value;
}

public static class ServiceHealth
{
    public static async Task<IResult> Oracle(OracleStore db, string service, CancellationToken ct)
    {
        try
        {
            var ready = await db.OneAsync("SELECT 1 VALUE FROM DUAL", null, r => Convert.ToInt32(r["VALUE"]), ct);
            return ready == 1 ? Results.Ok(new { status = "ok", service }) : Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
        }
        catch
        {
            return Results.Json(new { status = "degraded", service }, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }
}
