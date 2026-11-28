using Oracle.ManagedDataAccess.Client;

namespace Libros.Api;

public static class SeedRunner
{
    private static readonly string BranchCentral = "10000000-0000-4000-8000-000000000001";
    private static readonly string BranchNorth = "10000000-0000-4000-8000-000000000002";

    public static async Task RunAsync(IConfiguration configuration, ILogger logger, CancellationToken ct = default)
    {
        var clients = Required(configuration, "SEED_CLIENTS_CONNECTION");
        var auth = Required(configuration, "SEED_AUTH_CONNECTION");
        var inventory = Required(configuration, "SEED_INVENTORY_CONNECTION");
        var localNow = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("America/Santiago"));
        var profiles = new[]
        {
            (Id:"20000000-0000-4000-8000-000000000001", Code:"OBRERO", Name:"Obrero", Multi:false, Max:1),
            (Id:"20000000-0000-4000-8000-000000000002", Code:"ADMINISTRATIVO", Name:"Administrativo", Multi:false, Max:1),
            (Id:"20000000-0000-4000-8000-000000000003", Code:"JEFE", Name:"Jefe", Multi:false, Max:1),
            (Id:"20000000-0000-4000-8000-000000000004", Code:"SECRETARIA_GERENCIA", Name:"Secretaría de Gerencia", Multi:true, Max:10),
            (Id:"20000000-0000-4000-8000-000000000005", Code:"GERENTE", Name:"Gerente", Multi:false, Max:1),
            (Id:"20000000-0000-4000-8000-000000000006", Code:"VISITA", Name:"Visita", Multi:false, Max:1)
        };
        await WithConnection(clients, async c =>
        {
            await Execute(c, "MERGE INTO CLIENTS_SVC.BRANCHES t USING (SELECT :id ID,:code CODE,:name NAME,:address ADDRESS FROM dual) s ON (t.ID=s.ID) WHEN MATCHED THEN UPDATE SET t.NAME=s.NAME,t.ADDRESS=s.ADDRESS,t.ACTIVE=1 WHEN NOT MATCHED THEN INSERT(ID,CODE,NAME,ADDRESS,ACTIVE) VALUES(s.ID,s.CODE,s.NAME,s.ADDRESS,1)",
                ("id", BranchCentral), ("code", "CENTRAL"), ("name", "Casa Central"), ("address", "Santiago, Chile"));
            await Execute(c, "MERGE INTO CLIENTS_SVC.BRANCHES t USING (SELECT :id ID,:code CODE,:name NAME,:address ADDRESS FROM dual) s ON (t.ID=s.ID) WHEN MATCHED THEN UPDATE SET t.NAME=s.NAME,t.ADDRESS=s.ADDRESS,t.ACTIVE=1 WHEN NOT MATCHED THEN INSERT(ID,CODE,NAME,ADDRESS,ACTIVE) VALUES(s.ID,s.CODE,s.NAME,s.ADDRESS,1)",
                ("id", BranchNorth), ("code", "NORTE"), ("name", "Imprenta Norte"), ("address", "Concepción, Chile"));

            foreach (var p in profiles)
                await Execute(c, "MERGE INTO CLIENTS_SVC.PROFILES t USING (SELECT :id ID,:code CODE,:name NAME,:multi ALLOW_MULTI,:max MAX_PER_WINDOW FROM dual) s ON (t.ID=s.ID) WHEN MATCHED THEN UPDATE SET t.NAME=s.NAME,t.ALLOW_MULTI=s.ALLOW_MULTI,t.MAX_PER_WINDOW=s.MAX_PER_WINDOW,t.ACTIVE=1 WHEN NOT MATCHED THEN INSERT(ID,CODE,NAME,DESCRIPTION,ALLOW_MULTI,MAX_PER_WINDOW,ACTIVE) VALUES(s.ID,s.CODE,s.NAME,s.NAME,s.ALLOW_MULTI,s.MAX_PER_WINDOW,1)",
                    ("id", p.Id), ("code", p.Code), ("name", p.Name), ("multi", p.Multi ? 1 : 0), ("max", p.Max));

            await Casino(c, "11000000-0000-4000-8000-000000000001", "CASINO_CENTRAL_COMEDOR", "Comedor Central", "COMEDOR", BranchCentral);
            await Casino(c, "11000000-0000-4000-8000-000000000002", "CASINO_CENTRAL_CAFETERIA", "Cafetería Central", "CAFETERIA", BranchCentral);
            await Casino(c, "11000000-0000-4000-8000-000000000003", "CASINO_NORTE_COMEDOR", "Comedor Norte", "COMEDOR", BranchNorth);

            var people = new[]
            {
                new Person("30000000-0000-4000-8000-000000000001","EMP001","1-9","Empleado Uno","emp001@example.test","FUNCIONARIO",profiles[0].Id,BranchCentral,1,Passwords.Hash("Libros2026!")),
                new Person("30000000-0000-4000-8000-000000000002","EMP002","2-7","Empleado Dos","emp002@example.test","FUNCIONARIO",profiles[1].Id,BranchCentral,2,Passwords.Hash("Libros2026!")),
                new Person("30000000-0000-4000-8000-000000000003","EMP003","3-5","Empleado Tres","emp003@example.test","FUNCIONARIO",profiles[2].Id,BranchNorth,3,Passwords.Hash("Libros2026!")),
                new Person("30000000-0000-4000-8000-000000000004","SEC001","4-3","Secretaría de Gerencia","sec001@example.test","FUNCIONARIO",profiles[3].Id,BranchCentral,1,Passwords.Hash("Libros2026!")),
                new Person("30000000-0000-4000-8000-000000000005","CAJ001","5-1","Cajero Central","caj001@example.test","CAJERO",profiles[1].Id,BranchCentral,1,Passwords.Hash("Libros2026!")),
                new Person("30000000-0000-4000-8000-000000000006","CAJ002","6-8","Cajero Norte","caj002@example.test","CAJERO",profiles[1].Id,BranchNorth,2,Passwords.Hash("Libros2026!")),
                new Person("30000000-0000-4000-8000-000000000007","ADM001","7-6","Administradora de Prueba","adm001@example.test","ADMINISTRADOR",profiles[4].Id,BranchCentral,1,Passwords.Hash("Libros2026!"))
            };
            foreach (var person in people)
            {
                await Execute(c, "MERGE INTO CLIENTS_SVC.EMPLOYEES t USING (SELECT :id ID FROM dual) s ON (t.ID=s.ID) WHEN MATCHED THEN UPDATE SET t.FULL_NAME=:name,t.USER_ROLE=:role,t.ACTIVE=1 WHEN NOT MATCHED THEN INSERT(ID,CODE,RUT,FULL_NAME,EMAIL,USER_ROLE,PROFILE_ID,BASE_BRANCH_ID,ACTIVE) VALUES(:id,:code,:rut,:name,:email,:role,:profile,:branch,1)",
                    ("id", person.Id), ("name", person.Name), ("role", person.Role), ("code", person.Code), ("rut", person.Rut), ("email", person.Email), ("profile", person.ProfileId), ("branch", person.BranchId));
                await Execute(c, "MERGE INTO CLIENTS_SVC.SHIFTS t USING (SELECT :employee_id EMPLOYEE_ID,:shift_year SHIFT_YEAR,:shift_month SHIFT_MONTH FROM dual) s ON (t.EMPLOYEE_ID=s.EMPLOYEE_ID AND t.SHIFT_YEAR=s.SHIFT_YEAR AND t.SHIFT_MONTH=s.SHIFT_MONTH) WHEN MATCHED THEN UPDATE SET t.NUMBER_VALUE=:number_value,t.BRANCH_ID=:branch_id WHEN NOT MATCHED THEN INSERT(ID,EMPLOYEE_ID,SHIFT_YEAR,SHIFT_MONTH,NUMBER_VALUE,BRANCH_ID) VALUES(:id,:employee_id,:shift_year,:shift_month,:number_value,:branch_id)",
                    ("id", Guid.NewGuid().ToString()), ("employee_id", person.Id), ("shift_year", localNow.Year), ("shift_month", localNow.Month), ("number_value", person.Shift), ("branch_id", person.BranchId));
            }
            return 0;
        });

        await WithConnection(auth, async c =>
        {
            foreach (var person in new[]
            {
                new AuthSeed("30000000-0000-4000-8000-000000000001","EMP001","FUNCIONARIO"),new AuthSeed("30000000-0000-4000-8000-000000000002","EMP002","FUNCIONARIO"),
                new AuthSeed("30000000-0000-4000-8000-000000000003","EMP003","FUNCIONARIO"),new AuthSeed("30000000-0000-4000-8000-000000000004","SEC001","FUNCIONARIO"),
                new AuthSeed("30000000-0000-4000-8000-000000000005","CAJ001","CAJERO"),new AuthSeed("30000000-0000-4000-8000-000000000006","CAJ002","CAJERO"),
                new AuthSeed("30000000-0000-4000-8000-000000000007","ADM001","ADMINISTRADOR")
            })
                await Execute(c, "MERGE INTO AUTH_SVC.USERS t USING (SELECT :id ID FROM dual) s ON (t.ID=s.ID) WHEN MATCHED THEN UPDATE SET t.PASSWORD_HASH=:hash,t.USER_ROLE=:role,t.ACTIVE=1 WHEN NOT MATCHED THEN INSERT(ID,EMPLOYEE_CODE,PASSWORD_HASH,USER_ROLE,ACTIVE) VALUES(:id,:code,:hash,:role,1)",
                    ("id", person.Item1), ("code", person.Item2), ("hash", Passwords.Hash("Libros2026!")), ("role", person.Item3));
            return 0;
        });

        await WithConnection(inventory, async c =>
        {
            var services = new[]
            {
                new ServiceSeed("40000000-0000-4000-8000-000000000001","DESAYUNO","Desayuno","Servicio de desayuno",true,1,"08:00","10:00",3500),
                new ServiceSeed("40000000-0000-4000-8000-000000000002","ALMUERZO","Almuerzo","Servicio de almuerzo",true,1,"11:30","14:30",6500),
                new ServiceSeed("40000000-0000-4000-8000-000000000003","ONCE","Once","Servicio de once",true,2,"18:00","20:00",4500),
                new ServiceSeed("40000000-0000-4000-8000-000000000004","CENA1","Cena 1","Servicio de cena turno 2",true,2,"20:00","22:00",6500),
                new ServiceSeed("40000000-0000-4000-8000-000000000005","CENA2","Cena 2","Servicio de cena turno 3",true,3,"00:00","02:00",6500),
                new ServiceSeed("40000000-0000-4000-8000-000000000006","REUNION_COFFEE","Coffee de reunión","Vale adicional para reuniones",false,0,"00:00","00:00",5000)
            };
            foreach (var service in services)
            {
                await Execute(c, "MERGE INTO INVENTORY_SVC.FOOD_SERVICES t USING (SELECT :id ID FROM dual) s ON (t.ID=s.ID) WHEN MATCHED THEN UPDATE SET t.NAME=:name,t.DESCRIPTION=:description,t.ACTIVE=1 WHEN NOT MATCHED THEN INSERT(ID,CODE,NAME,DESCRIPTION,IS_BASE,ACTIVE) VALUES(:id,:code,:name,:description,:base,1)",
                    ("id", service.Id), ("code", service.Code), ("name", service.Name), ("description", service.Description), ("base", service.IsBase ? 1 : 0));
                if (service.Shift > 0)
                    await Execute(c, "MERGE INTO INVENTORY_SVC.SERVICE_WINDOWS t USING (SELECT :service SERVICE_ID,:shift SHIFT_NUMBER FROM dual) s ON (t.SERVICE_ID=s.SERVICE_ID AND t.SHIFT_NUMBER=s.SHIFT_NUMBER) WHEN MATCHED THEN UPDATE SET t.START_TIME=:start_time,t.END_TIME=:end_time WHEN NOT MATCHED THEN INSERT(ID,SERVICE_ID,SHIFT_NUMBER,START_TIME,END_TIME) VALUES(:id,:service,:shift,:start_time,:end_time)",
                        ("id", Guid.NewGuid().ToString()), ("service", service.Id), ("shift", service.Shift), ("start_time", service.Start), ("end_time", service.End));
                foreach (var profile in new[] { "OBRERO", "ADMINISTRATIVO", "JEFE", "SECRETARIA_GERENCIA", "GERENTE", "VISITA" })
                    await Execute(c, "MERGE INTO INVENTORY_SVC.VALUATIONS t USING (SELECT :service SERVICE_ID,:profile PROFILE_CODE FROM dual) s ON (t.SERVICE_ID=s.SERVICE_ID AND t.PROFILE_CODE=s.PROFILE_CODE) WHEN MATCHED THEN UPDATE SET t.AMOUNT_CLP=:amount,t.ACTIVE=1 WHEN NOT MATCHED THEN INSERT(ID,SERVICE_ID,PROFILE_CODE,AMOUNT_CLP,ACTIVE) VALUES(:id,:service,:profile,:amount,1)",
                        ("id", Guid.NewGuid().ToString()), ("service", service.Id), ("profile", profile), ("amount", service.Amount));
            }
            var products = new[]
            {
                ("50000000-0000-4000-8000-000000000001","PROD-001","Sándwich ave palta","Sándwiches",6500),
                ("50000000-0000-4000-8000-000000000002","PROD-002","Jugo natural","Bebidas",2200),
                ("50000000-0000-4000-8000-000000000003","PROD-003","Café americano","Bebidas calientes",1800),
                ("50000000-0000-4000-8000-000000000004","PROD-004","Ensalada de temporada","Ensaladas",5200),
                ("50000000-0000-4000-8000-000000000005","PROD-005","Galletas surtidas","Snacks",1500)
            };
            foreach (var product in products)
                await Execute(c, "MERGE INTO INVENTORY_SVC.PRODUCTS t USING (SELECT :id ID FROM dual) s ON (t.ID=s.ID) WHEN MATCHED THEN UPDATE SET t.NAME=:name,t.PRICE_CLP=:price,t.AVAILABLE=1 WHEN NOT MATCHED THEN INSERT(ID,CODE,NAME,CATEGORY,PRICE_CLP,AVAILABLE) VALUES(:id,:code,:name,:category,:price,1)",
                    ("id", product.Item1), ("code", product.Item2), ("name", product.Item3), ("category", product.Item4), ("price", product.Item5));
            return 0;
        });
        logger.LogInformation("Seed Oracle completado de forma idempotente para {ShiftYear}-{ShiftMonth}", localNow.Year, localNow.Month);
    }

    private static string Required(IConfiguration configuration, string key) => configuration[key] ?? throw new InvalidOperationException($"Falta {key}.");

    private static async Task<T> WithConnection<T>(string connectionString, Func<OracleConnection, Task<T>> action)
    {
        await using var connection = new OracleConnection(connectionString);
        await connection.OpenAsync();
        return await action(connection);
    }

    private static async Task Execute(OracleConnection connection, string sql, params (string Name, object Value)[] values)
    {
        await using var command = new OracleCommand(sql, connection) { BindByName = true };
        foreach (var (name, value) in values) command.Parameters.Add(name, value is int ? OracleDbType.Int32 : OracleDbType.Varchar2).Value = value;
        await command.ExecuteNonQueryAsync();
    }

    private static Task Casino(OracleConnection c, string id, string code, string name, string type, string branchId)
        => Execute(c, "MERGE INTO CLIENTS_SVC.CASINOS t USING (SELECT :id ID FROM dual) s ON (t.ID=s.ID) WHEN MATCHED THEN UPDATE SET t.NAME=:name,t.ACTIVE=1 WHEN NOT MATCHED THEN INSERT(ID,CODE,NAME,CASINO_TYPE,BRANCH_ID,ACTIVE) VALUES(:id,:code,:name,:type,:branch,1)",
            ("id", id), ("code", code), ("name", name), ("type", type), ("branch", branchId));

    private sealed record Person(string Id, string Code, string Rut, string Name, string Email, string Role, string ProfileId, string BranchId, int Shift, string PasswordHash);
    private sealed record AuthSeed(string Item1, string Item2, string Item3);
    private sealed record ServiceSeed(string Id, string Code, string Name, string Description, bool IsBase, int Shift, string Start, string End, int Amount);
}
