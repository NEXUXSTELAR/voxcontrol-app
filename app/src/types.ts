export type OpStatus = 'running' | 'needs_you' | 'done' | 'error' | 'stopped';

export type Operation = {
  id: string;
  kind: 'claude' | 'pc' | 'note';
  title: string;
  status: OpStatus;
  createdAt: number;
  updatedAt: number;
  projectId?: string | null;
  sessionId?: string | null;
  cwd?: string;
  prompt?: string;
  log: { at: number; kind: 'text' | 'tool' | 'info' | 'error' | 'user'; text: string }[];
  result?: string;
  costUsd?: number;
  pending: null | { type: 'permission'; requestId: string; tool: string; summary: string; detail: string };
  files?: string[];
};

export type LogEntry = Operation['log'][number];

/** Version légère reçue dans les listes (sans le journal). */
export type OpSummary = Omit<Operation, 'log'> & { last: string | null; logCount: number };

export type PowerPending = { kind: 'restart' | 'shutdown'; at: number } | null;

export type Metrics = {
  pcName: string;
  cpu: number;
  memTotal: number;
  memUsed: number;
  uptime: number;
  disks: { name: string; label: string; total: number; free: number }[];
  battery: { percent: number; charging: boolean } | null;
  at: number;
};

export type Hello = { pcName: string; version: string; local: boolean; known: boolean; hasDevices: boolean };

export type ProviderId = 'mistral' | 'openai' | 'gemini';
export type Provider = {
  id: ProviderId;
  name: string;
  keyUrl: string;
  help: string;
  enabled: boolean;
  secondOpinion: boolean;
  model: string;
  keyHint: string | null;
};

export type Project = { id: string; name: string; path: string; notes: string };

export type PublicConfig = {
  pcName: string;
  allowedFolders: string[];
  apps: { id: string; name: string; process?: string }[];
  scripts: { id: string; name: string }[];
  projects: Project[];
  activeProjectId: string | null;
  refiner: ProviderId;
  transcribeModel: string;
  readProjectContext: boolean;
  monthlyCapUsd: number;
  prices: { transcribePerMin: number; llm: Record<ProviderId, { in: number; out: number }> };
  enabledDangerous: string[];
  claudeApprovals: 'ask' | 'pc';
  blockedDrives: string[];
};

export type Device = { id: string; name: string; createdAt: number; lastSeen: number | null; revoked: boolean; passkey: boolean };

export type AppState = {
  version: string;
  caller: { kind: 'local' } | { kind: 'device'; id: string; name: string; passkey: boolean };
  metrics: Metrics;
  tailscale: { installed: boolean; online: boolean; dnsName: string | null; serveUrl: string | null };
  rdp: boolean;
  claude: { installed: boolean; running: number };
  ops: OpSummary[];
  powerPending: PowerPending;
  lastShotAt: number | null;
  config: PublicConfig;
  providers: Provider[];
  levels: Record<string, { level: 0 | 1 | 2 | 3; label: string }>;
  spend: { provider: string; usd: number }[];
  prompts: { id: string; title: string; body: string }[];
  devices: Device[];
  vapidPublicKey: string;
};

export type Suggestion = {
  route: 'claude' | 'pc' | 'note';
  mode: 'direct' | 'smart';
  pc?: { action: string; arg?: string; label: string };
  reason: string;
};

export type Refined = {
  titre: string;
  intention: string;
  prompt: string;
  objectifs: string[];
  etapes: string[];
  fichiers: string[];
  risques: string[];
  questions: string[];
  provider: ProviderId;
  model: string;
  usage: { in: number; out: number };
};

export type Session = { id: string; title: string; cwd: string; lastModified: number; busy: boolean };
