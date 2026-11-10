# Icône VoxControl dans la zone de notification : lance l'agent, le relance s'il s'arrête,
# et donne accès aux actions courantes. Lancée à l'ouverture de session, puis vérifiée
# toutes les 5 minutes par la tâche planifiée (avec -Background).
param([switch]$Background)
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
# À régler avant de créer le moindre élément d'interface.
[System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)

$root = Split-Path -Parent $PSScriptRoot
$data = Join-Path $env:LOCALAPPDATA 'VoxControl'
New-Item -ItemType Directory -Force $data | Out-Null
$log = Join-Path $data 'agent.log'
$trayLog = Join-Path $data 'tray.log'
$url = 'http://localhost:47821'

function Write-TrayLog([string]$msg) {
  try { Add-Content -Path $trayLog -Value "$(Get-Date -Format s) $msg" } catch {}
}

# Une seule icône à la fois. Lancée en arrière-plan alors qu'elle tourne déjà : on sort sans rien ouvrir.
$mutex = New-Object System.Threading.Mutex($false, 'Global\VoxControlTray')
# Si l'icône précédente a été tuée, le verrou est « abandonné » : on le reprend normalement.
try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
if (-not $owned) {
  if (-not $Background) { Start-Process $url }
  exit
}
Write-TrayLog 'Icône démarrée'

$script:agent = $null
$script:quitting = $false

function Start-Agent {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) {
    Write-TrayLog 'Node.js introuvable'
    return
  }
  # Un agent resté seul (icône fermée brutalement) est arrêté avant d'en lancer un nouveau.
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'agent/src/main\.ts' -and $_.CommandLine -notmatch 'VOX_TEST' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  # La redirection passe par cmd : les événements .NET de sortie feraient planter PowerShell.
  $cmdArgs = "/d /c `"`"$node`" --disable-warning=ExperimentalWarning agent/src/main.ts >> `"$log`" 2>&1`""
  $script:agent = Start-Process -FilePath cmd.exe -ArgumentList $cmdArgs -WorkingDirectory $root -WindowStyle Hidden -PassThru
  Write-TrayLog "Agent lancé (cmd $($script:agent.Id))"
}

function Stop-Agent {
  if ($script:agent -and -not $script:agent.HasExited) {
    & taskkill.exe /T /F /PID $script:agent.Id | Out-Null
    $script:agent.WaitForExit(3000) | Out-Null
  }
}

function Safe([scriptblock]$block) {
  return { try { & $block } catch { Write-TrayLog "Erreur : $_" } }.GetNewClosure()
}

$icon = New-Object System.Windows.Forms.NotifyIcon
$png = Join-Path $root 'app\public\icon-192.png'
if (Test-Path $png) {
  $bmp = [System.Drawing.Bitmap]::FromFile($png)
  $icon.Icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
} else { $icon.Icon = [System.Drawing.SystemIcons]::Application }
$icon.Text = 'VoxControl'
$icon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$menu.Items.Add('Ouvrir VoxControl', $null, (Safe { Start-Process $url })) | Out-Null
$menu.Items.Add('Appairer un téléphone', $null, (Safe { Start-Process "$url/?pair=1" })) | Out-Null
$menu.Items.Add('Voir le journal', $null, (Safe { Start-Process notepad.exe $log })) | Out-Null
$menu.Items.Add('-') | Out-Null
$menu.Items.Add('Redémarrer l''agent', $null, (Safe { Stop-Agent; Start-Agent; $icon.ShowBalloonTip(2000, 'VoxControl', 'Agent redémarré.', 'Info') })) | Out-Null
$menu.Items.Add('Quitter', $null, (Safe { $script:quitting = $true; Stop-Agent; $icon.Visible = $false; [System.Windows.Forms.Application]::Exit() })) | Out-Null
$icon.ContextMenuStrip = $menu
$icon.add_DoubleClick((Safe { Start-Process $url }))

Start-Agent

# Relance automatique si l'agent s'arrête (vérifié toutes les 5 s).
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.add_Tick({
  try {
    if (-not $script:quitting -and (-not $script:agent -or $script:agent.HasExited)) {
      Write-TrayLog 'Agent arrêté : relance'
      Start-Agent
    }
  } catch { Write-TrayLog "Erreur de relance : $_" }
})
$timer.Start()

# Une erreur dans un menu ou une minuterie ne doit jamais fermer l'icône.
[System.Windows.Forms.Application]::add_ThreadException({ param($s, $e) Write-TrayLog "Erreur : $($e.Exception.Message)" })
try { [System.Windows.Forms.Application]::Run() } catch { Write-TrayLog "Arrêt inattendu : $_" }
Write-TrayLog 'Icône fermée'
$mutex.ReleaseMutex()
