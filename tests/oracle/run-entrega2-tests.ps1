$ErrorActionPreference = 'Stop'

# Reuse the active compose configuration without printing its secret values.
$gatewayEnvironment = (docker inspect libros_api_gateway | ConvertFrom-Json)[0].Config.Env
foreach ($entry in $gatewayEnvironment) {
  $parts = $entry.Split('=', 2)
  if ($parts[0].StartsWith('INTERNAL_TOKEN_')) {
    Set-Item -Path "Env:$($parts[0])" -Value $parts[1]
  }
}
$oracleEnvironment = (docker inspect libros_oracle | ConvertFrom-Json)[0].Config.Env
foreach ($entry in $oracleEnvironment) {
  $parts = $entry.Split('=', 2)
  if ($parts[0] -eq 'ORACLE_PASSWORD') { $env:ORACLE_SYSTEM_PASSWORD = $parts[1] }
}
$connectionMappings = @(
  @{ Container = 'libros_auth_service'; Variable = 'AUTH_DB_PASSWORD' },
  @{ Container = 'libros_clients_service'; Variable = 'CLIENTS_DB_PASSWORD' },
  @{ Container = 'libros_inventory_service'; Variable = 'INVENTORY_DB_PASSWORD' },
  @{ Container = 'libros_orders_service'; Variable = 'ORDERS_DB_PASSWORD' },
  @{ Container = 'libros_payments_service'; Variable = 'PAYMENTS_DB_PASSWORD' }
)
foreach ($mapping in $connectionMappings) {
  $serviceEnvironment = (docker inspect $mapping.Container | ConvertFrom-Json)[0].Config.Env
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
