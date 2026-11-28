$ErrorActionPreference = 'Stop'

# Reuse active, locally configured Compose secrets without printing them.
function Get-ServiceEnvironment([string]$service) {
  $containerId = (docker compose ps -q $service).Trim()
  if ([string]::IsNullOrWhiteSpace($containerId)) { throw "Compose service '$service' is not running; start the stack before running this cycle." }
  return (docker inspect $containerId | ConvertFrom-Json)[0].Config.Env
}

$gatewayEnvironment = Get-ServiceEnvironment 'gateway'
foreach ($entry in $gatewayEnvironment) {
  $parts = $entry.Split('=', 2)
  if ($parts[0].StartsWith('INTERNAL_TOKEN_')) { Set-Item -Path "Env:$($parts[0])" -Value $parts[1] }
}
$authEnvironment = Get-ServiceEnvironment 'auth-service'
foreach ($entry in $authEnvironment) {
  $parts = $entry.Split('=', 2)
  if ($parts[0] -eq 'JWT_SECRET') { $env:JWT_SECRET = $parts[1] }
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
  foreach ($run in @('RUN15', 'RUN16')) {
    Write-Host "[Entrega 3] Restoring Oracle before $run"
    docker compose --profile tools run --build --rm db-reset
    if (-not $?) { throw "Oracle reset failed before $run." }

    $env:DOTNET_ENVIRONMENT = 'Testing'
    $env:APP_TEST_NOW_SANTIAGO = $testClock
    $env:RUN_ID = $run
    docker compose up --build -d --no-deps orders-service graphql-gateway
    if (-not $?) { throw "Could not enable the controlled test clock before $run." }

    npm run test:ui:e2e
    if (-not $?) { throw "Browser acceptance run $run failed." }

    Remove-Item Env:RUN_ID -ErrorAction SilentlyContinue
  }
}
finally {
  Remove-Item Env:RUN_ID -ErrorAction SilentlyContinue
  Remove-Item Env:DOTNET_ENVIRONMENT -ErrorAction SilentlyContinue
  Remove-Item Env:APP_TEST_NOW_SANTIAGO -ErrorAction SilentlyContinue
  docker compose up -d --no-deps orders-service graphql-gateway
  docker compose start payments-service | Out-Null
  try {
    docker compose --profile tools run --build --rm db-reset
    if (-not $?) { Write-Warning 'Could not restore the Oracle seed after the browser validation cycle.' }
  }
  catch { Write-Warning 'Could not restore the Oracle seed after the browser validation cycle.' }
}
