import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { db } from './db.ts';

export type OpStatus = 'running' | 'needs_you' | 'done' | 'error' | 'stopped';
export type OpKind = 'claude' | 'pc' | 'note';

export type Pending =
  | { type: 'permission'; requestId: string; tool: string; summary: string; detail: string }
  | null;

export type Operation = {
  id: string;
  kind: OpKind;
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
  pending: Pending;
  // Fichiers créés ou modifiés par Claude pendant la tâche.
  files?: string[];
};

/** Ce que le téléphone reçoit dans les listes : tout sauf le journal complet. */
export type OpSummary = Omit<Operation, 'log'> & { last: string | null; logCount: number };

export function summarize(op: Operation): OpSummary {
  const { log, ...rest } = op;
  const last = [...log].reverse().find((l) => l.kind === 'tool' || l.kind === 'text');
  return { ...rest, last: last ? last.text.split('\n')[0].slice(0, 200) : null, logCount: log.length };
}

// Longueur du journal déjà diffusée, pour n'envoyer que les nouvelles lignes.
const sentLog = new Map<string, number>();

export const bus = new EventEmitter();
bus.setMaxListeners(50);

const MAX_LOG = 400;

export function newOp(kind: OpKind, title: string, extra: Partial<Operation> = {}): Operation {
  const now = Date.now();
  const op: Operation = { id: crypto.randomUUID(), kind, title, status: 'running', createdAt: now, updatedAt: now, log: [], pending: null, ...extra };
  saveOp(op);
  return op;
}

export function saveOp(op: Operation) {
  op.updatedAt = Date.now();
  if (op.log.length > MAX_LOG) op.log = op.log.slice(-MAX_LOG);
  db.prepare('INSERT INTO operations (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').run(
    op.id, JSON.stringify(op), op.updatedAt,
  );
  const before = sentLog.get(op.id) ?? 0;
  if (op.log.length > before) bus.emit('log', { id: op.id, entries: op.log.slice(before), reset: false });
  else if (op.log.length < before) bus.emit('log', { id: op.id, entries: op.log, reset: true });
  sentLog.set(op.id, op.log.length);
  bus.emit('op', op);
}

export function getOp(id: string): Operation | null {
  const row = db.prepare('SELECT data FROM operations WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}

export function listOps(limit = 60): Operation[] {
  return (db.prepare('SELECT data FROM operations ORDER BY updated_at DESC LIMIT ?').all(limit) as { data: string }[]).map((r) => JSON.parse(r.data));
}

export function clearOps() {
  db.exec("DELETE FROM operations WHERE data NOT LIKE '%\"status\":\"running\"%' AND data NOT LIKE '%\"status\":\"needs_you\"%'");
  bus.emit('ops-cleared');
}

// Une opération restée « en cours » au redémarrage de l'agent ne tourne plus.
for (const op of listOps(200)) {
  if (op.status === 'running' || op.status === 'needs_you') {
    op.status = 'stopped';
    op.pending = null;
    op.log.push({ at: Date.now(), kind: 'info', text: "Arrêtée : l'agent a redémarré." });
    saveOp(op);
  }
}
