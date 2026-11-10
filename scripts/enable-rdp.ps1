# Active le Bureau à distance Windows, joignable uniquement depuis le réseau Tailscale (100.64.0.0/10).
# Demande les droits administrateur.
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  exit
}
Set-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name fDenyTSConnections -Value 0
Set-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' -Name UserAuthentication -Value 1
# Les règles Windows d'origine acceptent tout le réseau local : on les remplace par une règle limitée à Tailscale.
Get-NetFirewallRule -DisplayGroup '@FirewallAPI.dll,-28752' -ErrorAction SilentlyContinue | Disable-NetFirewallRule
Remove-NetFirewallRule -DisplayName 'VoxControl RDP via Tailscale' -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'VoxControl RDP via Tailscale' -Direction Inbound -Protocol TCP -LocalPort 3389 -RemoteAddress 100.64.0.0/10 -Action Allow | Out-Null
Write-Host 'Bureau à distance activé, limité aux appareils Tailscale.' -ForegroundColor Green
Read-Host 'Entrée pour fermer'
