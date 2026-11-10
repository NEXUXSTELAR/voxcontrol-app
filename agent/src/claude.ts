import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listSessions, query, type PermissionResult, type PermissionUpdate, type Query } from '@anthropic-ai/claude-agent-sdk';
import { getOp, newOp, saveOp, type Operation } from './bus.ts';
import { config } from './config.ts';
import { notify } from './push.ts';
import { redact } from './secrets.ts';

type Running = {
  q: Query;
  waiting: Map<string, { resolve: (r: PermissionResult) => void; suggestions?: PermissionUpdate[]; input: Record<string, unknown> }>;
};
const running = new Map<string, Running>();

// Le binaire Claude Code installé sur le PC : même version et même compte que dans le terminal.
const LOCAL_CLAUDE = path.join(os.homedir(), '.local', 'bin', 'claude.exe');

function toolSummary(name: string, input: any): string {
  if (!input || typeof input !== 'object') return name;
  if (name === 'Bash' || name === 'PowerShell') return String(input.command ?? '');
  if (input.file_path) return String(input.file_path);
  if (input.pattern) return `${input.pattern}${input.path ? ` dans ${input.path}` : ''}`;
  if (input.url) return String(input.url);
  if (input.description) return String(input.description);
  const s = JSON.stringify(input);
  return s.length > 160 ? s.slice(0, 160) + '…' : s;
}

const TOOL_LABEL: Record<string, string> = {
  Bash: 'Commande',
  PowerShell: 'Commande',
  Edit: 'Modifier',
  Write: 'Créer ou remplacer',
  Read: 'Lire',
  Glob: 'Chercher des fichiers',
  Grep: 'Chercher dans le code',
  WebFetch: 'Lire une page web',
  WebSearch: 'Recherche web',
  NotebookEdit: 'Modifier un notebook',
  Agent: 'Sous-agent',
};

const ASK_TOOLS = ['Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'mcp__*'];

export function isSessionBusy(sessionId: string) {
  for (const [opId] of running) {
    const op = getOp(opId);
    if (op?.sessionId === sessionId) return true;
  }
  return false;
}

export function runningCount() {
  return running.size;
}

export function sendToClaude(opts: { prompt: string; cwd: string; projectId?: string | null; resume?: string | null; title?: string }): Operation {
  if (!fs.existsSync(opts.cwd)) throw new Error(`Dossier introuvable : ${opts.cwd}`);
  if (opts.resume && isSessionBusy(opts.resume)) throw new Error('Cette session travaille déjà. Attends la fin ou arrête-la.');

  const title = opts.title ?? (opts.prompt.length > 70 ? opts.prompt.slice(0, 70).trimEnd() + '…' : opts.prompt);
  const op = newOp('claude', title, { projectId: opts.projectId ?? null, sessionId: opts.resume ?? null, cwd: opts.cwd, prompt: opts.prompt });
  op.log.push({ at: Date.now(), kind: 'user', text: opts.prompt });
  saveOp(op);

  const waiting: Running['waiting'] = new Map();

  const q = query({
    prompt: opts.prompt,
    options: {
      cwd: opts.cwd,
      resume: opts.resume ?? undefined,
      permissionMode: 'default',
      settingSources: ['user', 'project', 'local'],
      // Les règles « ask » passent avant les « allow » de tes réglages : chaque commande ou modification remonte au téléphone.
      ...(config.claudeApprovals === 'ask' ? { settings: { permissions: { ask: ASK_TOOLS } } } : {}),
      ...(fs.existsSync(LOCAL_CLAUDE) ? { pathToClaudeCodeExecutable: LOCAL_CLAUDE } : {}),
      canUseTool: (toolName, input, { signal, suggestions }) =>
        new Promise<PermissionResult>((resolve) => {
          const requestId = crypto.randomUUID();
          const cur = getOp(op.id) ?? op;
          cur.status = 'needs_you';
          cur.pending = {
            type: 'permission',
            requestId,
            tool: TOOL_LABEL[toolName] ?? toolName,
            summary: toolSummary(toolName, input),
            detail: redact(JSON.stringify(input, null, 2)).slice(0, 4000),
          };
          saveOp(cur);
          notify({ title: 'Claude attend ton accord', body: `${cur.pending.tool} : ${cur.pending.summary}`.slice(0, 140), opId: op.id });
          waiting.set(requestId, { resolve, suggestions, input });
          signal.addEventListener('abort', () => {
            waiting.delete(requestId);
            resolve({ behavior: 'deny', message: 'Opération interrompue.' });
          });
        }),
    },
  });
  running.set(op.id, { q, waiting });

  (async () => {
    const cur = () => getOp(op.id) ?? op;
    try {
      for await (const msg of q) {
        const o = cur();
        if (msg.type === 'system' && msg.subtype === 'init') {
          o.sessionId = msg.session_id;
          o.log.push({ at: Date.now(), kind: 'info', text: `Session ${opts.resume ? 'reprise' : 'ouverte'} · ${msg.model}` });
          saveOp(o);
        } else if (msg.type === 'assistant' && !msg.parent_tool_use_id) {
          for (const block of msg.message.content as any[]) {
            if (block.type === 'text' && block.text?.trim()) o.log.push({ at: Date.now(), kind: 'text', text: block.text });
            if (block.type === 'tool_use' && ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(block.name)) {
              const f = block.input?.file_path ?? block.input?.notebook_path;
              if (f && !(o.files ?? []).includes(f)) o.files = [...(o.files ?? []), String(f)];
            }
            if (block.type === 'tool_use') o.log.push({ at: Date.now(), kind: 'tool', text: `${TOOL_LABEL[block.name] ?? block.name} · ${toolSummary(block.name, block.input)}` });
          }
          saveOp(o);
        } else if (msg.type === 'result') {
          o.costUsd = msg.total_cost_usd;
          o.pending = null;
          if (msg.subtype === 'success' && !msg.is_error) {
            o.status = 'done';
            o.result = msg.result;
          } else {
            o.status = o.status === 'stopped' ? 'stopped' : 'error';
            o.result = msg.subtype === 'success' ? msg.result : `Arrêt : ${msg.subtype}`;
          }
          saveOp(o);
          notify({ title: o.status === 'done' ? 'Claude a terminé' : 'Claude s’est arrêté', body: o.title, opId: o.id });
        }
      }
    } catch (e: any) {
      const o = cur();
      if (o.status !== 'stopped') {
        o.status = 'error';
        o.result = redact(String(e?.message ?? e));
        o.log.push({ at: Date.now(), kind: 'error', text: o.result });
        notify({ title: 'Erreur Claude Code', body: o.result.slice(0, 140), opId: o.id });
      }
      o.pending = null;
      saveOp(o);
    } finally {
      running.delete(op.id);
      const o = cur();
      if (o.status === 'running' || o.status === 'needs_you') {
        o.status = 'done';
        o.pending = null;
        saveOp(o);
      }
    }
  })();

  return op;
}

export function decide(opId: string, requestId: string, allow: boolean, always: boolean, note?: string) {
  const r = running.get(opId);
  const w = r?.waiting.get(requestId);
  if (!r || !w) throw new Error('Cette demande n’est plus en attente.');
  r.waiting.delete(requestId);
  const o = getOp(opId);
  if (o) {
    o.log.push({ at: Date.now(), kind: 'info', text: allow ? (always ? 'Autorisé pour toute la session' : 'Autorisé') : `Refusé${note ? ` : ${note}` : ''}` });
    o.pending = null;
    o.status = 'running';
    saveOp(o);
  }
  if (allow) w.resolve({ behavior: 'allow', updatedInput: w.input, ...(always && w.suggestions ? { updatedPermissions: w.suggestions } : {}) });
  else w.resolve({ behavior: 'deny', message: note ? `L'utilisateur refuse : ${note}` : "L'utilisateur a refusé cette action." });
}

export async function stop(opId: string) {
  const r = running.get(opId);
  const o = getOp(opId);
  if (o) {
    o.status = 'stopped';
    o.pending = null;
    o.log.push({ at: Date.now(), kind: 'info', text: 'Arrêtée depuis le téléphone.' });
    saveOp(o);
  }
  if (!r) return;
  for (const [, w] of r.waiting) w.resolve({ behavior: 'deny', message: 'Opération interrompue.', interrupt: true });
  r.waiting.clear();
  try {
    await r.q.interrupt();
  } catch {
    /* déjà terminée */
  }
}

export async function sessions(limit = 40) {
  const list = await listSessions({ limit });
  return list.map((s) => ({
    id: s.sessionId,
    title: s.customTitle || s.summary || s.firstPrompt || 'Session',
    cwd: s.cwd ?? '',
    lastModified: s.lastModified,
    busy: isSessionBusy(s.sessionId),
  }));
}

export function claudeInstalled() {
  return fs.existsSync(LOCAL_CLAUDE);
}

