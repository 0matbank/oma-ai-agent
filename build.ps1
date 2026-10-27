# Installs Oma for this user: builds Oma.exe, sets up its Python, starts it at login, and (re)starts it now.
# Run it again after any change:  powershell -ExecutionPolicy Bypass -File .\build.ps1
# -Stage (the app's updater): build into Oma.next beside the running app; the app swaps it in when it restarts.
param([switch]$Stage)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$ProgressPreference = 'SilentlyContinue'
$local = Join-Path $env:LOCALAPPDATA 'Oma'
$app = Join-Path $env:LOCALAPPDATA 'Programs\Oma'

if ([Environment]::OSVersion.Version.Build -lt 19041) { throw 'Oma needs Windows 10 (2004) or later; Windows 11 looks best.' }
if (-not (Test-Path "$env:ProgramFiles\Git\bin\bash.exe") -and -not (Test-Path "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe")) {
  Write-Host 'Note: Git for Windows is not installed. Claude Code needs it: winget install Git.Git' -ForegroundColor Yellow
}

# Python 3.11+ for Oma.py, in its own venv
$py = $null
foreach ($c in @(@('py', '-3.13'), @('py', '-3.12'), @('py', '-3.11'), @('python'))) {
  try { $v = & $c[0] $c[1..9] -c 'import sys; print(sys.version_info >= (3, 11))' 2>$null; if ($v -eq 'True') { $py = $c; break } } catch {}
}
if (-not $py) { throw 'Oma needs Python 3.11 or later: winget install Python.Python.3.12   then run build.ps1 again.' }
$venv = Join-Path $local 'venv'
if (-not (Test-Path "$venv\Scripts\python.exe")) { & $py[0] $py[1..9] -m venv $venv }
& "$venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -r requirements.txt
if ($LASTEXITCODE) { throw 'pip install failed' }

# .NET 10 SDK, for the app itself (installed per user if missing; no admin needed)
$dotnet = $null
foreach ($d in @((Get-Command dotnet -ErrorAction SilentlyContinue).Source, "$env:LOCALAPPDATA\Microsoft\dotnet\dotnet.exe", "$env:ProgramFiles\dotnet\dotnet.exe")) {
  if ($d -and (Test-Path $d) -and ((& $d --list-sdks) -match '^(1[0-9])\.')) { $dotnet = $d; break }
}
if (-not $dotnet) {
  Write-Host 'Installing the .NET 10 SDK for this user…'
  Invoke-WebRequest https://dot.net/v1/dotnet-install.ps1 -OutFile "$env:TEMP\dotnet-install.ps1"
  & powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\dotnet-install.ps1" -Channel 10.0 -InstallDir "$env:LOCALAPPDATA\Microsoft\dotnet" | Out-Null
  $dotnet = "$env:LOCALAPPDATA\Microsoft\dotnet\dotnet.exe"
}

# A compiler error must leave the installed app alone.
$out = Join-Path $env:TEMP ('Oma-build-' + [guid]::NewGuid())
& $dotnet publish win\Oma -c Release -r win-x64 --self-contained -p:DebugType=none -o $out --nologo -v q
if ($LASTEXITCODE) { Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue; throw 'Build failed; the installed Oma is unchanged.' }

$dest = if ($Stage) { "$app.next" } else { $app }
if ($Stage) { Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue }
else {
  Get-Process Oma -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$app\*" } | Stop-Process -Force
  Start-Sleep -Milliseconds 500
  Remove-Item "$app.next" -Recurse -Force -ErrorAction SilentlyContinue   # an older staged update must not replace this build
}
New-Item -ItemType Directory -Force $dest, "$dest\ui" | Out-Null
Copy-Item "$out\*" $dest -Recurse -Force
Remove-Item $out -Recurse -Force
Copy-Item Oma.py, winctl.py $dest -Force
New-Item -ItemType Directory -Force "$dest\integrations" | Out-Null
Copy-Item integrations\*.py "$dest\integrations" -Force
Copy-Item ui\*.html, ui\*.js, ui\AppIcon.ico, ui\AppIcon.png "$dest\ui" -Force
$version = (git log -1 --format='%h - %cd' --date=format:'%b %d, %Y' 2>$null)
@{ python = "$venv\Scripts\python.exe"; source = $PSScriptRoot; version = "$version" } | ConvertTo-Json | Set-Content "$dest\Oma.json" -Encoding utf8
if ($Stage) { exit 0 }

# Start menu shortcut, so "Oma" opens Settings from Start
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Oma.lnk")
$lnk.TargetPath = "$app\Oma.exe"; $lnk.IconLocation = "$app\ui\AppIcon.ico"; $lnk.Description = 'Hold Ctrl+Alt+Space and talk'; $lnk.Save()

# Starts at login unless turned off in Settings
$prefs = Join-Path $env:APPDATA 'Oma\settings.json'
$login = $true
if (Test-Path $prefs) { try { $p = Get-Content $prefs -Raw | ConvertFrom-Json; if ($p.login -eq $false) { $login = $false } } catch {} }
if ($login) { Set-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name Oma -Value "`"$app\Oma.exe`"" }

if ($env:Oma_NO_RESTART) { exit 0 }
Start-Process "$app\Oma.exe"
Write-Host 'Oma is running. Hold Ctrl+Alt+Space and talk.'

