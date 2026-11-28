using Oracle.ManagedDataAccess.Client;

namespace Libros.Api;

public static class OracleResetRunner
{
    public static async Task RunAsync(IConfiguration configuration, ILogger logger)
    {
        await Clean(Required(configuration, "SEED_AUTH_CONNECTION"), "AUTH_SVC.SESSIONS", "AUTH_SVC.USERS");
        await Clean(Required(configuration, "SEED_CLIENTS_CONNECTION"), "CLIENTS_SVC.SHIFTS", "CLIENTS_SVC.EMPLOYEES", "CLIENTS_SVC.CASINOS", "CLIENTS_SVC.PROFILES", "CLIENTS_SVC.BRANCHES");
        await Clean(Required(configuration, "SEED_INVENTORY_CONNECTION"), "INVENTORY_SVC.SERVICE_WINDOWS", "INVENTORY_SVC.VALUATIONS", "INVENTORY_SVC.PRODUCTS", "INVENTORY_SVC.FOOD_SERVICES");
        await Clean(Required(configuration, "SEED_ORDERS_CONNECTION"), "ORDERS_SVC.REDEMPTION_ITEMS", "ORDERS_SVC.REDEMPTIONS", "ORDERS_SVC.VOUCHERS");
        await Clean(Required(configuration, "SEED_PAYMENTS_CONNECTION"), "PAYMENTS_SVC.TRANSACTIONS", "PAYMENTS_SVC.WEEKLY_NOTICES", "PAYMENTS_SVC.RECONCILIATIONS");
        logger.LogInformation("Oracle transactional schemas cleared; deterministic seed will be restored.");
    }

    private static async Task Clean(string connectionString, params string[] tables)
    {
        await using var connection = new OracleConnection(connectionString);
        await connection.OpenAsync();
        await using var transaction = connection.BeginTransaction();
        try
        {
            foreach (var table in tables)
            {
                await using var command = new OracleCommand($"DELETE FROM {table}", connection) { Transaction = transaction };
                await command.ExecuteNonQueryAsync();
            }
            await transaction.CommitAsync();
        }
        catch
        {
            await transaction.RollbackAsync();
            throw;
        }
    }

    private static string Required(IConfiguration configuration, string key)
        => configuration[key] ?? throw new InvalidOperationException($"Falta {key} para resetear Oracle.");
}
