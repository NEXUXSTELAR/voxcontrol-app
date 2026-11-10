import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config, isBlockedDrive, isInsideAllowed } from './config.ts';

export function ps(script: string, timeoutMs = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], {
      windowsHide: true,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('PowerShell : délai dépassé'));
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim() || `PowerShell a renvoyé ${code}`));
    });
    child.stdin.end(`$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;\n${script}`);
  });
}

async function psJson<T>(script: string): Promise<T> {
  const out = await ps(`${script} | ConvertTo-Json -Depth 4 -Compress`);
  if (!out) return [] as T;
  const parsed = JSON.parse(out);
  return parsed as T;
}
const asArray = <T,>(v: T | T[]): T[] => (Array.isArray(v) ? v : v ? [v] : []);

// ---------- Mesures ----------

let lastCpu = os.cpus();
let cpuPercent = 0;
setInterval(() => {
  const now = os.cpus();
  let idle = 0;
  let total = 0;
  now.forEach((c, i) => {
    const p = lastCpu[i]?.times;
    if (!p) return;
    const t = c.times;
    idle += t.idle - p.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq - (p.user + p.nice + p.sys + p.idle + p.irq);
  });
  lastCpu = now;
  if (total > 0) cpuPercent = Math.round(100 * (1 - idle / total));
}, 2000).unref();

type Disk = { name: string; label: string; total: number; free: number };
let disks: Disk[] = [];
let battery: { percent: number; charging: boolean } | null = null;

async function refreshSlow() {
  try {
    const d = await psJson<any>(
      "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,VolumeName,Size,FreeSpace",
    );
    disks = asArray(d).filter((x: any) => !isBlockedDrive(`${x.DeviceID}\\`)).map((x: any) => ({ name: x.DeviceID, label: x.VolumeName ?? '', total: Number(x.Size), free: Number(x.FreeSpace) }));
    const b = await psJson<any>('Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus');
    const first = asArray(b)[0];
    battery = first ? { percent: Number(first.EstimatedChargeRemaining), charging: [2, 6, 7, 8, 9].includes(Number(first.BatteryStatus)) } : null;
  } catch {
    /* mesure indisponible : on garde la précédente */
  }
}
refreshSlow();
setInterval(refreshSlow, 60_000).unref();

export function metrics() {
  return {
    pcName: config.pcName,
    cpu: cpuPercent,
    memTotal: os.totalmem(),
    memUsed: os.totalmem() - os.freemem(),
    uptime: os.uptime(),
    disks,
    battery,
    at: Date.now(),
  };
}

export async function processes() {
  const list = await psJson<any>(
    'Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 25 Id,ProcessName,@{n="Mem";e={$_.WorkingSet64}},@{n="Cpu";e={[math]::Round($_.CPU,1)}},MainWindowTitle',
  );
  return asArray(list).map((p: any) => ({ pid: p.Id, name: p.ProcessName, mem: Number(p.Mem), cpuSeconds: Number(p.Cpu ?? 0), window: p.MainWindowTitle || '' }));
}

export async function openWindows() {
  const list = await psJson<any>(
    "Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object Id,ProcessName,MainWindowTitle",
  );
  return asArray(list).map((p: any) => ({ pid: p.Id, name: p.ProcessName, title: p.MainWindowTitle }));
}

// ---------- Actions ----------

export async function lock() {
  await ps('rundll32.exe user32.dll,LockWorkStation');
}

export async function powerAction(kind: 'restart' | 'shutdown' | 'sleep' | 'cancel') {
  if (kind === 'cancel') return ps('shutdown.exe /a');
  if (kind === 'sleep') return ps('Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState("Suspend", $false, $false)');
  // Délai de 60 s : laisse le temps d'annuler depuis le téléphone.
  const flag = kind === 'restart' ? '/r' : '/s';
  return ps(`shutdown.exe ${flag} /t 60 /c "VoxControl : ${kind === 'restart' ? 'redémarrage' : 'arrêt'} demandé depuis le téléphone."`);
}

export async function openApp(id: string) {
  const app = config.apps.find((a) => a.id === id);
  if (!app) throw new Error('Application absente de ta liste.');
  const child = spawn(app.command, app.args ?? [], { detached: true, stdio: 'ignore', windowsHide: false, shell: !path.isAbsolute(app.command) });
  child.unref();
  return app;
}

export async function closeWindow(pid: number) {
  if (!Number.isInteger(pid)) throw new Error('Processus invalide.');
  await ps(`$p = Get-Process -Id ${pid} -ErrorAction Stop; [void]$p.CloseMainWindow()`);
}

export async function killProcess(pid: number) {
  if (!Number.isInteger(pid)) throw new Error('Processus invalide.');
  await ps(`Stop-Process -Id ${pid} -Force -ErrorAction Stop`);
}

export function openFolder(p: string) {
  if (!isInsideAllowed(p)) throw new Error('Dossier hors de ta liste autorisée.');
  spawn('explorer.exe', [path.resolve(p)], { detached: true, stdio: 'ignore' }).unref();
}

export async function runScript(id: string) {
  const s = config.scripts.find((x) => x.id === id);
  if (!s) throw new Error('Script absent de ta liste.');
  const ext = path.extname(s.path).toLowerCase();
  if (ext === '.ps1') return ps(`& '${s.path.replace(/'/g, "''")}'`, 10 * 60_000);
  return ps(`& cmd.exe /c '"${s.path.replace(/'/g, "''")}"'`, 10 * 60_000);
}

export async function screenshot(): Promise<Buffer> {
  const file = path.join(os.tmpdir(), `vox-${Date.now()}.png`);
  await ps(`
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace Vox -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][Vox.Dpi]::SetProcessDPIAware()
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$bmp.Save('${file}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()`);
  // Les blocs sur plusieurs lignes passent mal par l'entrée standard de PowerShell : on vérifie le résultat.
  if (!fs.existsSync(file)) throw new Error('Capture d’écran impossible (session Windows verrouillée ?).');
  const buf = fs.readFileSync(file);
  fs.rmSync(file, { force: true });
  return buf;
}

// ---------- Fichiers ----------

export function listDir(p: string) {
  if (!isInsideAllowed(p)) throw new Error('Dossier hors de ta liste autorisée.');
  const entries = fs.readdirSync(p, { withFileTypes: true });
  return entries
    .filter((e) => !e.name.startsWith('.') && e.name !== 'desktop.ini')
    .map((e) => {
      const full = path.join(p, e.name);
      let size = 0;
      let mtime = 0;
      try {
        const st = fs.statSync(full);
        size = st.size;
        mtime = st.mtimeMs;
      } catch {
        /* fichier verrouillé */
      }
      return { name: e.name, path: full, dir: e.isDirectory(), size, mtime };
    })
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, 'fr'));
}

export function rdpEnabled(): Promise<boolean> {
  return ps("(Get-ItemProperty 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server').fDenyTSConnections")
    .then((v) => v.trim() === '0')
    .catch(() => false);
}

export async function tailscaleStatus(): Promise<{ installed: boolean; online: boolean; dnsName: string | null; serveUrl: string | null }> {
  const exe = 'C:\\Program Files\\Tailscale\\tailscale.exe';
  if (!fs.existsSync(exe)) return { installed: false, online: false, dnsName: null, serveUrl: null };
  try {
    const out = await new Promise<string>((resolve, reject) => {
      const c = spawn(exe, ['status', '--json'], { windowsHide: true });
      let s = '';
      c.stdout.on('data', (d) => (s += d));
      c.on('close', (code) => (code === 0 ? resolve(s) : reject(new Error('tailscale status'))));
      c.on('error', reject);
    });
    const j = JSON.parse(out);
    const dnsName = (j.Self?.DNSName as string | undefined)?.replace(/\.$/, '') ?? null;
    return { installed: true, online: j.BackendState === 'Running', dnsName, serveUrl: dnsName ? `https://${dnsName}` : null };
  } catch {
    return { installed: true, online: false, dnsName: null, serveUrl: null };
  }
}

// Ces deux vérifications lancent des programmes externes (1 à 5 s) : on les garde en cache
// et on les rafraîchit en arrière-plan pour que l'ouverture de l'app reste instantanée.
type TsStatus = Awaited<ReturnType<typeof tailscaleStatus>>;
let tsCache: TsStatus = { installed: false, online: false, dnsName: null, serveUrl: null };
let rdpCache = false;
async function refreshNetwork() {
  [tsCache, rdpCache] = await Promise.all([tailscaleStatus(), rdpEnabled()]);
}
refreshNetwork();
setInterval(refreshNetwork, 30_000).unref();

export const cachedTailscale = () => tsCache;
export const cachedRdp = () => rdpCache;
