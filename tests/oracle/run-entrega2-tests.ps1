$ErrorActionPreference = 'Stop'

# Reuse the active compose configuration without printing its secret values.
function Get-ServiceEnvironment([string]$service) {
  $containerId = (docker compose ps -q $service).Trim()
  if ([string]::IsNullOrWhiteSpace($containerId)) { throw "Compose service '$service' is not running; start the stack before running this test." }
  return (docker inspect $containerId | ConvertFrom-Json)[0].Config.Env
}

$gatewayEnvironment = Get-ServiceEnvironment 'gateway'
foreach ($entry in $gatewayEnvironment) {
  $parts = $entry.Split('=', 2)
  if ($parts[0].StartsWith('INTERNAL_TOKEN_')) {
    Set-Item -Path "Env:$($parts[0])" -Value $parts[1]
  }
}
$oracleEnvironment = Get-ServiceEnvironment 'oracle'
foreach ($entry in $oracleEnvironment) {
  $parts = $entry.Split('=', 2)
  if ($parts[0] -eq 'ORACLE_PASSWORD') { $env:ORACLE_SYSTEM_PASSWORD = $parts[1] }
}
$connectionMappings = @(
  @{ Container = 'auth-service'; Variable = 'AUTH_DB_PASSWORD' },
  @{ Container = 'clients-service'; Variable = 'CLIENTS_DB_PASSWORD' },
  @{ Container = 'inventory-service'; Variable = 'INVENTORY_DB_PASSWORD' },
  @{ Container = 'orders-service'; Variable = 'ORDERS_DB_PASSWORD' },
  @{ Container = 'payments-service'; Variable = 'PAYMENTS_DB_PASSWORD' }
)
foreach ($mapping in $connectionMappings) {
  $serviceEnvironment = Get-ServiceEnvironment $mapping.Container
  foreach ($entry in $serviceEnvironment) {
    if ($entry.StartsWith('ORACLE_CONNECTION_STRING=')) {
      $connection = $entry.Substring('ORACLE_CONNECTION_STRING='.Length)
      if ($connection -match 'Password=([^;]+)') { Set-Item -Path "Env:$($mapping.Variable)" -Value $Matches[1] }
    }
  }
}

$timeZone = [TimeZoneInfo]::FindSystemTimeZoneById('Pacific SA Standard Time')
$localToday = [TimeZoneInfo]::ConvertTime([DateTimeOffset]::UtcNow, $timeZone).DateTime.Date
$localTestTime = [DateTime]::SpecifyKind($localToday.AddHours(21), [DateTimeKind]::Unspecified)
$offset = $timeZone.GetUtcOffset($localTestTime)
$testClock = [DateTimeOffset]::new($localTestTime, $offset).ToString("yyyy-MM-dd'T'HH:mm:sszzz")

try {
  docker compose --profile tools run --build --rm db-reset
  if (-not $?) { throw 'No se pudo restaurar Oracle con db-reset.' }

  $env:DOTNET_ENVIRONMENT = 'Testing'
  $env:APP_TEST_NOW_SANTIAGO = $testClock
  docker compose up --build -d --no-deps orders-service graphql-gateway
  if (-not $?) { throw 'No se pudieron iniciar orders-service y GraphQL con el reloj de prueba controlado.' }

  npm run test:oracle
  if (-not $?) { throw 'Fallaron las pruebas de integración de Entrega 2.' }

  npm run test:oracle:ui
  if (-not $?) { throw 'Fallaron las pruebas de administración desde el navegador.' }
}
finally {
  Remove-Item Env:DOTNET_ENVIRONMENT -ErrorAction SilentlyContinue
  Remove-Item Env:APP_TEST_NOW_SANTIAGO -ErrorAction SilentlyContinue
  docker compose up -d --no-deps orders-service graphql-gateway
}
