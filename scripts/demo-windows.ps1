<#
  Demo de Plataforma Escolar en Windows, SIN Docker (para computadoras sin virtualización).

  Requisitos (instaladores normales de Windows):
    - Node.js 22 o más nuevo (versión LTS): https://nodejs.org
    - PostgreSQL 16 o 17: https://www.postgresql.org/download/windows/  (anota la contraseña de "postgres")

  Uso, en PowerShell dentro de la carpeta del proyecto (fuera de OneDrive, p. ej. C:\demo\appAlumnos-main):
    powershell -ExecutionPolicy Bypass -File .\scripts\demo-windows.ps1              prepara (la primera vez) y arranca
    powershell -ExecutionPolicy Bypass -File .\scripts\demo-windows.ps1 -Reiniciar   borra la demo y la carga de nuevo
    powershell -ExecutionPolicy Bypass -File .\scripts\demo-windows.ps1 -Apagar      apaga los servidores

  Todo es ficticio y solo para mostrar en la propia computadora: las contraseñas son públicas.
#>
param(
  [switch]$Reiniciar,
  [switch]$Apagar
)

# Los programas de consola (node, pnpm) escriben avisos en stderr: no deben detener el script.
# Cada paso revisa el código de salida.
$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$Raiz = Split-Path -Parent $PSScriptRoot
Set-Location $Raiz
$Logs = Join-Path $Raiz "demo-logs"
$ArchivoPids = Join-Path $Logs "procesos.txt"
$ClaveDemo = "Demo-colegio-2026"
$ClaveSuperadmin = "Demo-superadmin-2026"
$EnvIdentity = Join-Path $Raiz "services\identity\.env"
$EnvAcademic = Join-Path $Raiz "services\academic\.env"

function Paso([string]$texto) {
  Write-Host ""
  Write-Host "== $texto" -ForegroundColor Cyan
}

function Falla([string]$texto) {
  Write-Host ""
  Write-Host $texto -ForegroundColor Red
  Write-Host ""
  exit 1
}

function Revisar([string]$queHacia) {
  if ($LASTEXITCODE -ne 0) { Falla "Falló: $queHacia. Revisa el mensaje de arriba." }
}

function PuertoOcupado([int]$puerto) {
  $cliente = New-Object System.Net.Sockets.TcpClient
  try {
    $cliente.Connect("127.0.0.1", $puerto)
    return $true
  } catch {
    return $false
  } finally {
    $cliente.Close()
  }
}

function ApagarServidores {
  if (Test-Path $ArchivoPids) {
    foreach ($id in Get-Content $ArchivoPids) {
      if ($id -match '^\d+$') { & taskkill /PID $id /T /F *> $null }
    }
    Remove-Item $ArchivoPids -Force
  }
}

function LeerUrlPostgres {
  $linea = Get-Content $EnvIdentity | Where-Object { $_ -like "DATABASE_URL=*" } | Select-Object -First 1
  if (-not $linea) { Falla "No encontré DATABASE_URL en services\identity\.env. Borra ese archivo y vuelve a ejecutar." }
  return ($linea.Substring("DATABASE_URL=".Length) -replace "/escolar_identity$", "")
}

# Ejecuta SQL con el driver de Postgres del proyecto (no hace falta psql).
function EjecutarSql([string]$url, [string]$sql) {
  $env:DEMO_PG_URL = "$url/postgres"
  $env:DEMO_PG_SQL = $sql
  $codigo = 'const { Client } = require(''pg''); const c = new Client({ connectionString: process.env.DEMO_PG_URL }); c.connect().then(() => (process.env.DEMO_PG_SQL ? c.query(process.env.DEMO_PG_SQL) : null)).then(() => c.end()).then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });'
  Push-Location (Join-Path $Raiz "services\identity")
  & node -e $codigo
  $ok = ($LASTEXITCODE -eq 0)
  Pop-Location
  Remove-Item Env:DEMO_PG_URL -ErrorAction SilentlyContinue
  Remove-Item Env:DEMO_PG_SQL -ErrorAction SilentlyContinue
  return $ok
}

function Iniciar([string]$nombre, [string]$carpeta, [string[]]$argumentos) {
  $salida = Join-Path $Logs "$nombre.log"
  $errores = Join-Path $Logs "$nombre.error.log"
  $proceso = Start-Process -FilePath "node" -ArgumentList $argumentos -WorkingDirectory (Join-Path $Raiz $carpeta) `
    -RedirectStandardOutput $salida -RedirectStandardError $errores -WindowStyle Hidden -PassThru
  if (-not $proceso) { Falla "No se pudo iniciar $nombre (node no se encontró)." }
  $null = $proceso.Handle  # sin esto Windows no guarda el código de salida
  Add-Content -Path $ArchivoPids -Value $proceso.Id
  $script:Procesos[$nombre] = $proceso
}

function MostrarRegistro([string]$nombre) {
  foreach ($archivo in "$nombre.log", "$nombre.error.log") {
    $ruta = Join-Path $Logs $archivo
    if ((Test-Path $ruta) -and (Get-Item $ruta).Length -gt 0) {
      Write-Host ""
      Write-Host "Últimas líneas de demo-logs\${archivo}:" -ForegroundColor Yellow
      Get-Content $ruta -Tail 12 | ForEach-Object { Write-Host "   $_" }
    }
  }
}

function Esperar([string]$nombre, [string]$url) {
  $proceso = $script:Procesos[$nombre]
  for ($i = 0; $i -lt 120; $i++) {
    if ($proceso -and $proceso.HasExited) {
      MostrarRegistro $nombre
      ApagarServidores
      Falla "$nombre se cerró al arrancar (código $($proceso.ExitCode)). Manda una captura de las líneas de arriba."
    }
    # Con Node y no con Invoke-WebRequest: este usa el proxy de Windows y puede no llegar a la propia PC.
    & node -e "fetch('$url', { signal: AbortSignal.timeout(2000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
    if ($LASTEXITCODE -eq 0) {
      Write-Host "   $nombre listo" -ForegroundColor Green
      return
    }
    Start-Sleep -Seconds 1
  }
  MostrarRegistro $nombre
  ApagarServidores
  Falla "$nombre no respondió en 2 minutos. Manda una captura de las líneas de arriba."
}

# Huella del código: si cambia (se descargó una versión nueva), se reinstala y se recompila.
function HuellaDelCodigo {
  $carpetas = @("apps\web\src", "apps\web\public", "packages\shared\src", "packages\service-kit\src",
    "services\identity\src", "services\identity\drizzle", "services\academic\src", "services\academic\drizzle")
  $archivos = @()
  foreach ($c in $carpetas) {
    $archivos += Get-ChildItem -Path (Join-Path $Raiz $c) -Recurse -File -ErrorAction SilentlyContinue
  }
  $archivos += Get-Item (Join-Path $Raiz "pnpm-lock.yaml"), (Join-Path $Raiz "apps\web\next.config.ts")
  $lineas = $archivos | Sort-Object FullName | ForEach-Object {
    "$($_.FullName.Substring($Raiz.Length))|$((Get-FileHash $_.FullName -Algorithm SHA256).Hash)"
  }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  return [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($lineas -join "`n")))).Replace("-", "")
}

function EscribirArchivo([string]$ruta, [string[]]$lineas) {
  # UTF-8 sin BOM: Node no reconoce la primera variable si el archivo empieza con BOM.
  [System.IO.File]::WriteAllLines($ruta, $lineas)
}

New-Item -ItemType Directory -Force -Path $Logs | Out-Null
$script:Procesos = @{}

if ($Apagar) {
  ApagarServidores
  Write-Host "Demo apagada." -ForegroundColor Green
  exit 0
}

# ───────────────────────────── Requisitos ─────────────────────────────
Paso "Revisando requisitos"
if ($Raiz -like "*OneDrive*") {
  Falla "La carpeta está dentro de OneDrive y eso hace muy lenta (o rompe) la instalación. Muévela, por ejemplo, a C:\demo\appAlumnos-main y vuelve a ejecutar el script desde ahí."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Falla "No encontré Node.js. Instálalo desde https://nodejs.org (versión LTS), cierra esta ventana, abre otra y vuelve a ejecutar."
}
$versionNode = (& node -v).Trim()
if ([int]($versionNode.TrimStart("v").Split(".")[0]) -lt 22) {
  Falla "Tienes Node.js $versionNode; hace falta la 22 o más nueva. Instala la versión LTS desde https://nodejs.org."
}
Write-Host "   Node.js $versionNode"
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host "   Instalando pnpm…"
  & npm install -g pnpm@10
  Revisar "instalar pnpm"
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Falla "Se instaló pnpm pero esta ventana todavía no lo ve. Cierra la ventana, abre otra y vuelve a ejecutar."
  }
}
if (-not (PuertoOcupado 5432)) {
  Falla "PostgreSQL no está corriendo en el puerto 5432. Instálalo desde https://www.postgresql.org/download/windows/ (deja el puerto 5432) y vuelve a ejecutar."
}
Write-Host "   PostgreSQL en el puerto 5432"

# Si quedó una demo anterior encendida, se apaga antes de seguir.
ApagarServidores
foreach ($puerto in 3000, 3001, 3002) {
  if (PuertoOcupado $puerto) {
    Falla "El puerto $puerto está ocupado por otro programa. Ciérralo (o reinicia la computadora) y vuelve a ejecutar."
  }
}

# ───────────────────────────── Instalación ─────────────────────────────
$ArchivoHuella = Join-Path $Logs "compilado.txt"
$Huella = HuellaDelCodigo
$Anterior = ""
if (Test-Path $ArchivoHuella) { $Anterior = (Get-Content $ArchivoHuella -Raw).Trim() }
$Recompilar = ($Huella -ne $Anterior)
if ($Recompilar -and $Anterior) { Write-Host "   Hay una versión nueva del código: se vuelve a compilar." }
if ($Recompilar -or -not (Test-Path (Join-Path $Raiz "node_modules\.modules.yaml"))) {
  Paso "Instalando dependencias (la primera vez tarda unos minutos)"
  & pnpm install --frozen-lockfile
  Revisar "instalar dependencias"
}

# ───────────────────────────── Configuración ─────────────────────────────
if (-not ((Test-Path $EnvIdentity) -and (Test-Path $EnvAcademic))) {
  Paso "Configuración"
  $url = $null
  for ($intento = 1; $intento -le 3; $intento++) {
    $segura = Read-Host "   Contraseña del usuario postgres (la que pusiste al instalar PostgreSQL)" -AsSecureString
    $puntero = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
    try {
      $plana = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($puntero)
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($puntero)
    }
    $prueba = "postgres://postgres:$([Uri]::EscapeDataString($plana))@localhost:5432"
    if (EjecutarSql $prueba "") {
      $url = $prueba
      break
    }
    Write-Host "   No se pudo entrar a PostgreSQL con esa contraseña. Intenta de nuevo." -ForegroundColor Yellow
  }
  if (-not $url) { Falla "No se pudo entrar a PostgreSQL. Revisa la contraseña del usuario postgres." }

  Write-Host "   Generando llaves de sesión…"
  $llaves = & pnpm -s keys:generate
  Revisar "generar las llaves de sesión"

  EscribirArchivo $EnvIdentity (@(
      "DATABASE_URL=$url/escolar_identity",
      "PORT=3001",
      "SEED_SUPERADMIN_EMAIL=superadmin@escolar.local",
      "SEED_SUPERADMIN_PASSWORD=$ClaveSuperadmin",
      "SEED_DEMO=false",
      "SEED_DEMO_PASSWORD=$ClaveDemo"
    ) + $llaves)
  EscribirArchivo $EnvAcademic @(
    "DATABASE_URL=$url/escolar_academic",
    "PORT=3002",
    "SEED_SUPERADMIN_EMAIL=superadmin@escolar.local",
    "SEED_SUPERADMIN_PASSWORD=$ClaveSuperadmin",
    "SEED_DEMO_PASSWORD=$ClaveDemo"
  )
  Write-Host "   Listo (guardado en services\identity\.env y services\academic\.env)"
}

# La carga de la demo inicia sesión con cada maestro: en esta demo local se sube el límite por minuto.
$lineas = @(Get-Content $EnvIdentity | Where-Object { $_ -notlike "LOGIN_RATE_LIMIT_PER_MINUTE=*" })
EscribirArchivo $EnvIdentity ($lineas + @("LOGIN_RATE_LIMIT_PER_MINUTE=300"))

# Los servicios se hablan por IPv4 (en Windows "localhost" puede ir primero a IPv6).
$lineas = @(Get-Content $EnvAcademic | Where-Object { $_ -notlike "IDENTITY_URL=*" -and $_ -notlike "ACADEMIC_URL=*" })
EscribirArchivo $EnvAcademic ($lineas + @("IDENTITY_URL=http://127.0.0.1:3001", "ACADEMIC_URL=http://127.0.0.1:3002"))

if ($Reiniciar) {
  Paso "Borrando la demo anterior"
  $url = LeerUrlPostgres
  foreach ($base in "escolar_academic", "escolar_identity") {
    if (-not (EjecutarSql $url "DROP DATABASE IF EXISTS $base WITH (FORCE)")) { Falla "No se pudo borrar la base $base." }
  }
  Write-Host "   Listo: se carga de nuevo con las fechas de hoy"
}

# ───────────────────────────── Compilación ─────────────────────────────
foreach ($servicio in "identity", "academic") {
  if ($Recompilar -or -not (Test-Path (Join-Path $Raiz "services\$servicio\dist\index.js"))) {
    Paso "Compilando el servicio $servicio"
    & pnpm --filter "@escolar/$servicio" build
    Revisar "compilar $servicio"
  }
}
if ($Recompilar -or -not (Test-Path (Join-Path $Raiz "apps\web\.next\BUILD_ID"))) {
  Paso "Compilando el panel web (tarda un par de minutos)"
  $env:STANDALONE = "false"
  & pnpm --filter "@escolar/web" build
  Revisar "compilar el panel web"
}
Set-Content -Path $ArchivoHuella -Value $Huella

# ───────────────────────────── Arranque y datos ─────────────────────────────
Paso "Arrancando"
Iniciar "identity" "services\identity" @("--env-file=.env", "dist/index.js")
Esperar "identity" "http://127.0.0.1:3001/health"

& pnpm --filter "@escolar/identity" db:seed
Revisar "crear el usuario administrador"

Iniciar "academic" "services\academic" @("--env-file=.env", "dist/index.js")
Esperar "academic" "http://127.0.0.1:3002/health"

Paso "Cargando la demo (si ya está cargada, no hace nada)"
& pnpm --filter "@escolar/academic" db:seed:region
Revisar "cargar la demo"

$env:COOKIE_SECURE = "false"
$env:IDENTITY_URL = "http://127.0.0.1:3001"
$env:ACADEMIC_URL = "http://127.0.0.1:3002"
$env:STANDALONE = "false"
Iniciar "web" "apps\web" @("node_modules/next/dist/bin/next", "start", "--port", "3000")
Esperar "web" "http://127.0.0.1:3000/api/health"

# ───────────────────────────── Lista ─────────────────────────────
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host " Demo lista: http://localhost:3000" -ForegroundColor Green
Write-Host " Contraseña de todas las cuentas: $ClaveDemo" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host "   departamental@demo-ihb.hn      Tablero de los 7 centros"
Write-Host "   distrital.roatan@demo-ihb.hn   Centros del distrito de Roatán"
Write-Host "   director@demo-oak-ridge.hn     Licencia sin sustituto"
Write-Host "   director@demo-west-end.hn      Seguimiento y cuadro para el SACE"
Write-Host "   maestro4@demo-west-end.hn      Mi cuaderno (asistencia y notas)"
Write-Host "   shanice.bodden@demo-ihb.hn     Maestra en dos escuelas"
Write-Host "   0000-2026-00001                Familia con dos hijos (portal de familias)"
Write-Host ""
Start-Process "http://localhost:3000"

Read-Host "Deja esta ventana abierta durante la presentación. Presiona Enter aquí para apagar la demo"
ApagarServidores
Write-Host "Demo apagada." -ForegroundColor Green
