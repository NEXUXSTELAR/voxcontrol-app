# Installation de VoxControl sur ce PC. À lancer par : clic droit › Exécuter avec PowerShell
# ou : powershell -ExecutionPolicy Bypass -File scripts\install.ps1
# Ne demande pas les droits administrateur (sauf winget si Node.js ou Tailscale manquent).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }

Step 'Node.js'
$node = Get-Command node -ErrorAction SilentlyContinue
$major = if ($node) { [int]((node --version).TrimStart('v').Split('.')[0]) } else { 0 }
if ($major -lt 24) {
  winget install --id OpenJS.NodeJS -e --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
node --version

Step 'Dépendances et construction de l''application'
npm ci --no-audit --no-fund
npm run build

Step 'Tailscale'
$ts = 'C:\Program Files\Tailscale\tailscale.exe'
if (-not (Test-Path $ts)) { winget install --id Tailscale.Tailscale -e --accept-source-agreements --accept-package-agreements }
$status = & $ts status --json | ConvertFrom-Json
if ($status.BackendState -ne 'Running') {
  Write-Host 'Connecte-toi à Tailscale dans la fenêtre qui s''ouvre, puis relance ce script.' -ForegroundColor Yellow
  & $ts up
}
# Publie l'agent en HTTPS, visible seulement par tes appareils Tailscale.
$p = Start-Process -FilePath $ts -ArgumentList 'serve', '--bg', '47821' -NoNewWindow -PassThru -RedirectStandardOutput "$env:TEMP\vox_serve.txt"
if (-not $p.WaitForExit(15000)) {
  $p.Kill()
  Get-Content "$env:TEMP\vox_serve.txt"
  Write-Host 'Ouvre le lien ci-dessus pour autoriser Tailscale Serve, puis relance ce script.' -ForegroundColor Yellow
}

Step 'Démarrage automatique à l''ouverture de session'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\scripts\tray.ps1`" -Background"
$trigger = @(
  (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME),
  # Filet de sécurité : relance l'icône si elle s'est arrêtée (sans rien ouvrir si elle tourne).
  (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5))
)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'VoxControl' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

Step 'Raccourci sur le Bureau'
$wsh = New-Object -ComObject WScript.Shell
$lnk = $wsh.CreateShortcut("$([Environment]::GetFolderPath('Desktop'))\VoxControl.lnk")
$lnk.TargetPath = 'powershell.exe'
$lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\scripts\tray.ps1`""
$lnk.WorkingDirectory = $root
$lnk.Save()

Step 'Veille'
Write-Host 'Sur secteur, un PC en veille est injoignable depuis le téléphone.'
$ans = Read-Host 'Désactiver la mise en veille automatique sur secteur ? (o/n)'
if ($ans -match '^[oOyY]') { powercfg /change standby-timeout-ac 0; Write-Host 'Veille sur secteur désactivée.' }

Step 'Lancement'
Start-ScheduledTask -TaskName 'VoxControl'
Start-Sleep -Seconds 4
Start-Process 'http://localhost:47821'
Write-Host "`nVoxControl est installé. L'icône est dans la zone de notification." -ForegroundColor Green
