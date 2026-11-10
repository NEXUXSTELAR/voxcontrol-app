import { useSyncExternalStore } from 'react';
import type { AppState, Hello, LogEntry, Metrics, OpSummary, PowerPending } from './types';
import { onOpUpdate } from './speech';

const TOKEN_KEY = 'vox.token';

function readTokenRaw(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function saveToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* stockage indisponible */
  }
}

export class ApiError extends Error {
  status: number;
  stepUp?: string;
  constructor(message: string, status: number, stepUp?: string) {
    super(message);
    this.status = status;
    this.stepUp = stepUp;
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData; stepUp?: string; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = readTokenRaw();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.stepUp) headers['X-Vox-Stepup'] = opts.stepUp;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, signal: opts.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new ApiError('Le PC ne répond pas. Vérifie qu’il est allumé et que Tailscale est actif sur le téléphone.', 0);
  }
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : await res.blob();
  if (!res.ok) {
    if (res.status === 401 && token) {
      store.set({ boot: 'pair' });
    }
    throw new ApiError((data as any)?.error ?? `Erreur ${res.status}`, res.status, (data as any)?.stepUp);
  }
  return data as T;
}

// ---------- Store ----------

export type Conn = 'connecting' | 'online' | 'offline';

export type Store = {
  boot: 'loading' | 'pair' | 'ready';
  hello: Hello | null;
  state: AppState | null;
  ops: OpSummary[];
  metrics: Metrics | null;
  powerPending: PowerPending;
  // Journaux complets, chargés seulement pour les tâches ouvertes.
  logs: Record<string, LogEntry[]>;
  claudeRunning: number;
  conn: Conn;
  offlineSince: number | null;
  latency: number | null;
};

let current: Store = { boot: 'loading', hello: null, state: null, ops: [], metrics: null, powerPending: null, logs: {}, claudeRunning: 0, conn: 'connecting', offlineSince: null, latency: null };
const listeners = new Set<() => void>();

export const store = {
  get: () => current,
  set(patch: Partial<Store>) {
    current = { ...current, ...patch };
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useStore<T>(pick: (s: Store) => T): T {
  return useSyncExternalStore(store.subscribe, () => pick(store.get()));
}

function upsertOp(op: OpSummary) {
  onOpUpdate(current.ops.find((o) => o.id === op.id), op);
  const ops = current.ops.filter((o) => o.id !== op.id);
  ops.unshift(op);
  ops.sort((a, b) => b.updatedAt - a.updatedAt);
  store.set({ ops: ops.slice(0, 120) });
}

export async function refreshState() {
  const s = await api<AppState>('/api/state');
  store.set({ state: s, ops: s.ops, metrics: s.metrics, claudeRunning: s.claude.running, powerPending: s.powerPending });
  return s;
}

export function patchState(patch: Partial<AppState>) {
  if (current.state) store.set({ state: { ...current.state, ...patch } });
}

// ---------- Temps réel ----------

let ws: WebSocket | null = null;
let retry = 0;
let pingTimer: number | undefined;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  sock.onopen = () => {
    const token = readTokenRaw();
    if (token) sock.send(JSON.stringify({ type: 'auth', token }));
  };
  sock.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'ready') {
      retry = 0;
      store.set({ conn: 'online', offlineSince: null });
      refreshState().catch(() => {});
      clearInterval(pingTimer);
      pingTimer = window.setInterval(() => sock.readyState === 1 && sock.send(JSON.stringify({ type: 'ping', t: performance.now() })), 10_000);
      sock.send(JSON.stringify({ type: 'ping', t: performance.now() }));
    } else if (m.type === 'pong') {
      store.set({ latency: Math.round(performance.now() - m.t) });
    } else if (m.type === 'op') {
      upsertOp(m.op);
    } else if (m.type === 'ops-cleared') {
      refreshState().catch(() => {});
    } else if (m.type === 'log') {
      const have = current.logs[m.id];
      if (have) store.set({ logs: { ...current.logs, [m.id]: m.reset ? m.entries : [...have, ...m.entries] } });
    } else if (m.type === 'metrics') {
      store.set({ metrics: m.metrics, claudeRunning: m.claudeRunning, powerPending: m.powerPending ?? null });
    }
  };
  sock.onclose = (ev) => {
    clearInterval(pingTimer);
    if (ws !== sock) return;
    if (ev.code === 4001) {
      store.set({ boot: 'pair' });
      return;
    }
    store.set({ conn: 'offline', offlineSince: current.offlineSince ?? Date.now(), latency: null });
    const delay = Math.min(15_000, 1000 * 2 ** retry++);
    window.setTimeout(connect, delay);
  };
}

export function startRealtime() {
  if (ws && ws.readyState <= 1) return;
  connect();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && current.boot === 'ready') {
    if (!ws || ws.readyState > 1) {
      retry = 0;
      connect();
    } else refreshState().catch(() => {});
  }
});

export async function boot() {
  try {
    const hello = await api<Hello>('/api/hello');
    store.set({ hello });
    if (!hello.known) {
      store.set({ boot: 'pair' });
      return;
    }
    await refreshState();
    store.set({ boot: 'ready' });
    startRealtime();
  } catch {
    store.set({ conn: 'offline', offlineSince: Date.now() });
    window.setTimeout(boot, 4000);
  }
}

/** Charge le journal complet d'une tâche ; les lignes suivantes arrivent ensuite par le temps réel. */
export async function loadLog(id: string) {
  const op = await api<{ log: LogEntry[] }>(`/api/ops/${id}`);
  store.set({ logs: { ...current.logs, [id]: op.log } });
}

export function readToken(): string | null {
  return readTokenRaw();
}
