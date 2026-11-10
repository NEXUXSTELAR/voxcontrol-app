import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PORT = Number(process.env.VOX_PORT ?? 47821);
export const DATA_DIR = process.env.VOX_DATA_DIR ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'VoxControl');
export const APP_DIST = path.resolve(import.meta.dirname, '../../app/dist');
fs.mkdirSync(DATA_DIR, { recursive: true });

const HOME = os.homedir();

export type AppEntry = { id: string; name: string; command: string; args?: string[]; process?: string };
export type ScriptEntry = { id: string; name: string; path: string };
export type Project = { id: string; name: string; path: string; notes: string };
export type ProviderId = 'mistral' | 'openai' | 'gemini';

export type Config = {
  pcName: string;
  allowedFolders: string[];
  apps: AppEntry[];
  scripts: ScriptEntry[];
  projects: Project[];
  activeProjectId: string | null;
  providers: Record<ProviderId, { enabled: boolean; model: string; secondOpinion: boolean }>;
  transcribeModel: string;
  realtimeModel: string;
  refiner: ProviderId;
  readProjectContext: boolean;
  // Prix en dollars : par minute d'audio, par million de jetons. Modifiables dans Réglages.
  prices: { transcribePerMin: number; transcribeRealtimePerMin: number; llm: Record<ProviderId, { in: number; out: number }> };
  monthlyCapUsd: number;
  // Niveau 3 : actions désactivées par défaut, activables une par une.
  enabledDangerous: string[];
  ownerTailscaleLogin: string | null;
  // 'ask' : VoxControl demande ton accord pour les commandes et modifications, même si ton PC les autorise.
  claudeApprovals: 'ask' | 'pc';
  // Lecteurs jamais visibles ni listés depuis le téléphone (ex. ["D:"]).
  blockedDrives: string[];
};

function detectApps(): AppEntry[] {
  const local = process.env.LOCALAPPDATA ?? '';
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const candidates: AppEntry[] = [
    { id: 'vscode', name: 'Visual Studio Code', command: path.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'), process: 'Code' },
    { id: 'chrome', name: 'Google Chrome', command: path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'), process: 'chrome' },
    { id: 'edge', name: 'Microsoft Edge', command: path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), process: 'msedge' },
    { id: 'terminal', name: 'Terminal', command: 'wt.exe', process: 'WindowsTerminal' },
    { id: 'explorer', name: 'Explorateur', command: 'explorer.exe', process: 'explorer' },
    { id: 'notepad', name: 'Bloc-notes', command: 'notepad.exe', process: 'Notepad' },
    { id: 'calc', name: 'Calculatrice', command: 'calc.exe', process: 'CalculatorApp' },
    { id: 'taskmgr', name: 'Gestionnaire des tâches', command: 'taskmgr.exe', process: 'Taskmgr' },
  ];
  return candidates.filter((a) => !path.isAbsolute(a.command) || fs.existsSync(a.command));
}

function defaults(): Config {
  return {
    pcName: os.hostname(),
    allowedFolders: [path.join(HOME, 'Desktop'), path.join(HOME, 'Documents'), path.join(HOME, 'Downloads')],
    apps: detectApps(),
    scripts: [],
    projects: [],
    activeProjectId: null,
    providers: {
      mistral: { enabled: true, model: 'mistral-medium-latest', secondOpinion: false },
      openai: { enabled: false, model: '', secondOpinion: true },
      gemini: { enabled: false, model: '', secondOpinion: true },
    },
    transcribeModel: 'voxtral-mini-latest',
    realtimeModel: 'voxtral-mini-transcribe-realtime-2602',
    refiner: 'mistral',
    readProjectContext: true,
    prices: {
      transcribePerMin: 0.0035,
      transcribeRealtimePerMin: 0.008,
      llm: { mistral: { in: 0.4, out: 2 }, openai: { in: 0, out: 0 }, gemini: { in: 0, out: 0 } },
    },
    monthlyCapUsd: 10,
    enabledDangerous: [],
    ownerTailscaleLogin: null,
    claudeApprovals: 'ask',
    blockedDrives: [],
  };
}

const FILE = path.join(DATA_DIR, 'config.json');

function load(): Config {
  const base = defaults();
  if (!fs.existsSync(FILE)) return base;
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { ...base, ...saved, providers: { ...base.providers, ...saved.providers }, prices: { ...base.prices, ...saved.prices } };
  } catch {
    return base;
  }
}

export const config: Config = load();

export function saveConfig() {
  fs.writeFileSync(FILE, JSON.stringify(config, null, 2));
}

export function updateConfig(patch: Partial<Config>) {
  Object.assign(config, patch);
  saveConfig();
}

if (!fs.existsSync(FILE)) saveConfig();

export function isBlockedDrive(p: string): boolean {
  const drive = path.resolve(p).slice(0, 2).toLowerCase();
  return config.blockedDrives.some((d) => d.toLowerCase().replace(/\\$/, '') === drive);
}

export function isInsideAllowed(p: string): boolean {
  const target = path.resolve(p).toLowerCase();
  if (isBlockedDrive(target)) return false;
  return config.allowedFolders.some((root) => {
    const r = path.resolve(root).toLowerCase();
    return target === r || target.startsWith(r + path.sep);
  });
}
