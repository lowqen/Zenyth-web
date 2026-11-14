<#
  데스크톱 Z0 — Yixin.exe ↔ 엔진 대화 녹취.

  배포 폴더(test-yixin)를 **임시 복제본**에 옮기고, 엔진 자리에 녹취기(Tee.cs)를 끼운 뒤 Yixin.exe 를 띄운다.
  사용자가 시나리오(README «녹취 시나리오»)를 진행하고 창을 닫으면 녹취가 golden\ 에 남는다.
  운영 폴더 · 운영 DB 는 건드리지 않는다(핸드북 불변 규칙 7).

    powershell -ExecutionPolicy Bypass -File record.ps1 -Name analysis-basic
    powershell -ExecutionPolicy Bypass -File record.ps1 -Name server-db -Engine engine_bak.exe   # 원격 서버(프록시)

  -Engine   : 녹취기 뒤에서 실제로 돌 엔진. 기본 engine.exe(로컬 Rapfi), engine_bak.exe 는 Tailscale 서버 프록시.
  -WithDb   : 운영 rapfi.db 의 **복사본**을 함께 넣는다(기본은 빈 DB 로 시작).
#>
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [string]$YixinDir = '',
  [string]$WorkDir = '',
  [string]$Engine = 'engine.exe',
  [switch]$WithDb
)
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 은 param 기본값을 계산할 때 $PSScriptRoot 가 빌 수 있다 — 본문에서 정한다.
$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $YixinDir) { $YixinDir = Join-Path $here '..\..\..\..\test-yixin' }
if (-not $WorkDir) { $WorkDir = Join-Path $env:TEMP 'z0-yixin' }
$WorkDir = [IO.Path]::GetFullPath($WorkDir)
$YixinDir = (Resolve-Path $YixinDir).Path
$golden = Join-Path $here '..\golden'
# 지난 녹취의 rapfi.db · 로그가 남지 않게 복제본은 매번 새로 만든다.
if (Test-Path $WorkDir) { Remove-Item $WorkDir -Recurse -Force }
New-Item -ItemType Directory -Force $WorkDir, $golden | Out-Null

# GUI 실행에 필요한 것 + 엔진 자산. 팩(RenjuNet 파생)과 연구 산출물은 옮기지 않는다.
$items = @('Yixin.exe', '*.dll', 'gspawn-*.exe', 'share', 'skin', 'language', 'function', 'piece*.bmp', 'icon.ico',
  'settings.txt', 'settings_dev.txt', 'config.toml', '*.bin.lz4', 'model*.bin')
foreach ($i in $items) { Copy-Item (Join-Path $YixinDir $i) $WorkDir -Recurse -Force }
if ($WithDb) { Copy-Item (Join-Path $YixinDir 'rapfi.db') $WorkDir -Force }
Copy-Item (Join-Path $YixinDir $Engine) (Join-Path $WorkDir 'rapfi-real.exe') -Force

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc -nologo -codepage:65001 -platform:x64 -target:exe -out:(Join-Path $WorkDir 'engine.exe') (Join-Path $here 'Tee.cs')
if ($LASTEXITCODE -ne 0) { throw "Tee.cs 컴파일 실패" }

$out = Join-Path (Resolve-Path $golden).Path ("$Name.jsonl")
if (Test-Path $out) { Remove-Item $out }
$env:Z0_LOG = $out
Write-Host "녹취 중 → $out  (Yixin 창을 닫으면 끝난다)"
Start-Process -FilePath (Join-Path $WorkDir 'Yixin.exe') -WorkingDirectory $WorkDir -Wait
# 정상 종료면 GUI 의 end 로 엔진도 곧 끝난다. 남아 있으면 정리한다(다음 실행의 복제본 삭제가 잠기지 않게).
$deadline = (Get-Date).AddSeconds(5)
function Leftovers { Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($WorkDir, [StringComparison]::OrdinalIgnoreCase) } }
while ((Get-Date) -lt $deadline -and @(Leftovers).Count) { Start-Sleep -Milliseconds 200 }
$left = @(Leftovers)
if ($left.Count) { $left | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Write-Host "주의: 엔진이 스스로 끝나지 않아 강제 종료했다(GUI 가 end 를 보내지 않음)" }
$lines = @(Get-Content $out)
$sent = @($lines | Where-Object { $_ -match '"dir":"gui>eng"' }).Count
$recv = @($lines | Where-Object { $_ -match '"dir":"eng>gui"' }).Count
Write-Host "끝: 보낸 줄 $sent, 받은 줄 $recv"
