import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import fastifyMultipart from '@fastify/multipart';
import QRCode from 'qrcode';
import { APP_DIST, DATA_DIR, PORT, config, isBlockedDrive, isInsideAllowed, saveConfig, type ProviderId } from './config.ts';
import { audit, db, monthSpend } from './db.ts';
import { bus, clearOps, getOp, listOps, newOp, saveOp, summarize, type Operation } from './bus.ts';
import * as changes from './changes.ts';
import * as updater from './updater.ts';
import * as voice from './voice.ts';
import * as auth from './auth.ts';
import type { Caller } from './auth.ts';
import * as sys from './system.ts';
import * as ai from './ai.ts';
import * as claude from './claude.ts';
import * as push from './push.ts';
import { deleteSecret, hint, redact, setSecret } from './secrets.ts';

const VERSION = '0.1.0';

// ---------- Catalogue des actions et niveaux de risque ----------
// 0 consultation · 1 sans risque · 2 confirmation Face ID · 3 interdit sauf activation explicite
const LEVELS: Record<string, { level: 0 | 1 | 2 | 3; label: string }> = {
  'pc.screenshot': { level: 0, label: "Capture d'écran" },
  'pc.lock': { level: 1, label: 'Verrouiller le PC' },
  'pc.cancel': { level: 1, label: "Annuler l'arrêt prévu" },
  'app.open': { level: 1, label: 'Ouvrir une application' },
  'folder.open': { level: 1, label: 'Ouvrir un dossier sur le PC' },
  'ops.clear': { level: 1, label: "Effacer l'historique" },
  'pc.restart': { level: 2, label: 'Redémarrer le PC' },
  'pc.shutdown': { level: 2, label: 'Arrêter le PC' },
  'pc.sleep': { level: 2, label: 'Mettre en veille' },
  'app.close': { level: 2, label: 'Fermer une fenêtre' },
  'script.run': { level: 2, label: 'Lancer un script' },
  'file.upload': { level: 2, label: 'Envoyer un fichier vers le PC' },
  'device.revoke': { level: 2, label: 'Révoquer un appareil' },
  'key.delete': { level: 2, label: 'Supprimer une clé' },
  'danger.enable': { level: 2, label: 'Autoriser une action interdite' },
  'app.update': { level: 2, label: 'Mettre à jour VoxControl' },
  'settings.security': { level: 2, label: 'Modifier dossiers, applications et scripts' },
  'process.kill': { level: 3, label: 'Forcer la fermeture d\u2019un processus' },
};

// Arrêt ou redémarrage programmé (60 s) : affiché sur le téléphone tant qu'il est annulable.
let power: { kind: 'restart' | 'shutdown'; at: number } | null = null;
const powerPending = () => (power && power.at > Date.now() ? power : null);
let lastShot: { png: Buffer; at: number } | null = null;

const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
await app.register(fastifyWebsocket);
await app.register(fastifyMultipart, { limits: { fileSize: 200 * 1024 * 1024, files: 1 } });

declare module 'fastify' {
  interface FastifyRequest {
    caller: Caller | null;
  }
}
app.decorateRequest('caller', null);

app.addHook('onRequest', async (req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('X-Frame-Options', 'DENY');
  if (!req.url.startsWith('/api/')) return;
  const open = ['/api/hello', '/api/pair/claim'];
  const localOnly = ['/api/pair/start', '/api/pair/state'];
  req.caller = auth.identify(req);
  if (localOnly.some((p) => req.url.startsWith(p))) {
    if (!auth.isLocal(req)) return reply.code(403).send({ error: 'Réservé au PC.' });
    return;
  }
  if (open.some((p) => req.url.startsWith(p))) return;
  if (!req.caller) return reply.code(401).send({ error: 'Appareil non reconnu. Appaire-le de nouveau.' });
});

const who = (req: FastifyRequest) => (req.caller?.kind === 'device' ? req.caller.id : 'pc-local');

function fail(reply: FastifyReply, e: any, code = 400) {
  return reply.code(code).send({ error: redact(String(e?.message ?? e)) });
}

/** Vérifie le niveau de l'action et la confirmation Face ID si nécessaire. */
function gate(req: FastifyRequest, reply: FastifyReply, action: string): boolean {
  const def = LEVELS[action];
  if (!def) {
    fail(reply, 'Action inconnue.', 400);
    return false;
  }
  if (def.level === 3 && !config.enabledDangerous.includes(action)) {
    audit(who(req), action, 3, 'refusé', 'désactivée');
    fail(reply, 'Action désactivée. Tu peux l\u2019autoriser dans Réglages › Sécurité.', 403);
    return false;
  }
  if (def.level >= 2) {
    const token = req.headers['x-vox-stepup'];
    if (!auth.consumeStepUp(req.caller!, action, typeof token === 'string' ? token : undefined)) {
      audit(who(req), action, def.level, 'refusé', 'confirmation manquante');
      reply.code(428).send({ error: 'Confirmation Face ID requise.', stepUp: action });
      return false;
    }
  }
  return true;
}

function pcOp(title: string, status: Operation['status'], result?: string) {
  const op = newOp('pc', title);
  op.status = status;
  if (result) op.result = result;
  saveOp(op);
  return op;
}

// ---------- Ouvert ----------

app.get('/api/hello', async (req) => ({
  pcName: config.pcName,
  version: VERSION,
  local: auth.isLocal(req),
  known: Boolean(req.caller),
  hasDevices: auth.listDevices().some((d) => !d.revoked),
}));

app.post('/api/pair/claim', async (req, reply) => {
  const { code, name } = (req.body ?? {}) as { code?: string; name?: string };
  const r = auth.claimPairing(req, String(code ?? ''), String(name ?? 'iPhone'));
  if ('error' in r) return fail(reply, r.error, 400);
  return r;
});

// ---------- Réservé au PC ----------

app.post('/api/pair/start', async () => {
  const p = auth.startPairing();
  const ts = await sys.tailscaleStatus();
  const url = ts.serveUrl ?? null;
  const qr = url ? await QRCode.toString(url, { type: 'svg', margin: 0, color: { dark: '#0F1012', light: '#FFFFFF' } }) : null;
  return { ...p, url, qr };
});
app.get('/api/pair/state', async () => ({ pairing: auth.pairingState() }));

// ---------- État général ----------

function providerStatus() {
  return (Object.keys(ai.PROVIDERS) as ProviderId[]).map((id) => ({
    id,
    ...ai.PROVIDERS[id],
    enabled: config.providers[id].enabled,
    secondOpinion: config.providers[id].secondOpinion,
    model: config.providers[id].model,
    keyHint: hint(id),
  }));
}

function publicConfig() {
  return {
    pcName: config.pcName,
    allowedFolders: config.allowedFolders,
    apps: config.apps.map(({ id, name, process }) => ({ id, name, process })),
    scripts: config.scripts.map(({ id, name }) => ({ id, name })),
    projects: config.projects,
    activeProjectId: config.activeProjectId,
    refiner: config.refiner,
    transcribeModel: config.transcribeModel,
    readProjectContext: config.readProjectContext,
    monthlyCapUsd: config.monthlyCapUsd,
    prices: config.prices,
    enabledDangerous: config.enabledDangerous,
    claudeApprovals: config.claudeApprovals,
    blockedDrives: config.blockedDrives,
  };
}

app.get('/api/state', async (req) => {
  const ts = sys.cachedTailscale();
  const rdp = sys.cachedRdp();
  const caller = req.caller!;
  return {
    version: VERSION,
    caller: caller.kind === 'device' ? { kind: 'device', id: caller.id, name: caller.name, passkey: auth.hasPasskey(caller.id) } : { kind: 'local' },
    metrics: sys.metrics(),
    tailscale: ts,
    rdp,
    claude: { installed: claude.claudeInstalled(), running: claude.runningCount() },
    ops: listOps(80).map(summarize),
    powerPending: powerPending(),
    lastShotAt: lastShot?.at ?? null,
    config: publicConfig(),
    providers: providerStatus(),
    levels: LEVELS,
    spend: monthSpend(),
    prompts: db.prepare('SELECT id, title, body FROM prompts ORDER BY created_at DESC').all(),
    devices: auth.listDevices(),
    vapidPublicKey: push.vapidPublicKey,
  };
});

// ---------- Temps réel ----------

app.get('/ws', { websocket: true }, (socket, req) => {
  let caller: Caller | null = auth.isLocal(req) ? { kind: 'local' } : null;
  const send = (m: unknown) => socket.readyState === 1 && socket.send(JSON.stringify(m));
  // Le téléphone reçoit un résumé de chaque tâche, et seulement les nouvelles lignes de journal.
  const onOp = (op: Operation) => caller && send({ type: 'op', op: summarize(op) });
  const onLog = (l: { id: string; entries: Operation['log']; reset: boolean }) => caller && send({ type: 'log', ...l });
  const onClear = () => caller && send({ type: 'ops-cleared' });
  const tick = setInterval(
    () => caller && send({ type: 'metrics', metrics: sys.metrics(), claudeRunning: claude.runningCount(), powerPending: powerPending() }),
    3000,
  );
  const authTimer = setTimeout(() => !caller && socket.close(4001, 'auth'), 5000);
  bus.on('op', onOp);
  bus.on('log', onLog);
  bus.on('ops-cleared', onClear);
  if (caller) send({ type: 'ready' });
  socket.on('message', (raw) => {
    let m: any;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m.type === 'auth' && !caller) {
      caller = auth.identify(req, String(m.token ?? ''));
      if (!caller) return socket.close(4001, 'auth');
      send({ type: 'ready' });
    }
    if (m.type === 'ping') send({ type: 'pong', t: m.t });
  });
  socket.on('close', () => {
    clearInterval(tick);
    clearTimeout(authTimer);
    bus.off('op', onOp);
    bus.off('log', onLog);
    bus.off('ops-cleared', onClear);
  });
});

// Transcription en direct : le téléphone envoie du son brut, l'agent relaie vers Voxtral.
app.get('/ws/voice', { websocket: true }, (socket, req) => {
  let caller: Caller | null = auth.isLocal(req) ? { kind: 'local' } : null;
  let session: voice.LiveSession | null = null;
  const send = (m: unknown) => socket.readyState === 1 && socket.send(JSON.stringify(m));
  const authTimer = setTimeout(() => !caller && socket.close(4001, 'auth'), 5000);
  socket.on('message', (raw, isBinary) => {
    if (isBinary) {
      session?.push(raw as Buffer);
      return;
    }
    let m: any;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m.type === 'auth' && !caller) {
      caller = auth.identify(req, String(m.token ?? ''));
      if (!caller) return socket.close(4001, 'auth');
    }
    if (!caller) return;
    if (m.type === 'start' && !session) {
      session = voice.startLive({
        onDelta: (text) => send({ type: 'delta', text }),
        onDone: (text) => send({ type: 'done', text, suggestion: text ? ai.suggest(text) : null }),
        onError: (message) => send({ type: 'error', message: redact(message) }),
      });
      send({ type: 'started' });
    }
    if (m.type === 'stop') session?.end();
  });
  socket.on('close', () => {
    clearTimeout(authTimer);
    session?.end();
  });
});

// ---------- Voix et IA ----------

app.post('/api/voice', async (req, reply) => {
  try {
    const file = await req.file();
    if (!file) return fail(reply, 'Aucun son reçu.');
    const buf = await file.toBuffer();
    const seconds = Number((file.fields as any)?.seconds?.value ?? 10);
    const text = await ai.transcribe(buf, file.mimetype, seconds);
    if (!text) return fail(reply, "Je n'ai rien entendu. Réessaie plus près du micro.");
    return { text, suggestion: ai.suggest(text) };
  } catch (e) {
    return fail(reply, e, e instanceof ai.AiError ? 400 : 500);
  }
});

app.post('/api/suggest', async (req) => ai.suggest(String((req.body as any)?.text ?? '')));

function projectById(id?: string | null) {
  return config.projects.find((p) => p.id === (id ?? config.activeProjectId)) ?? null;
}

app.post('/api/refine', async (req, reply) => {
  const b = (req.body ?? {}) as { text?: string; projectId?: string; answers?: string };
  try {
    return await ai.refine(String(b.text ?? ''), projectById(b.projectId), b.answers);
  } catch (e) {
    return fail(reply, e);
  }
});

app.post('/api/second-opinion', async (req, reply) => {
  const b = (req.body ?? {}) as { prompt?: string; original?: string; projectId?: string };
  try {
    return await ai.secondOpinion(String(b.prompt ?? ''), String(b.original ?? ''), projectById(b.projectId));
  } catch (e) {
    return fail(reply, e);
  }
});

app.post('/api/note', async (req) => {
  const text = String((req.body as any)?.text ?? '').slice(0, 20000);
  const op = newOp('note', text.length > 70 ? text.slice(0, 70) + '…' : text);
  op.status = 'done';
  op.result = text;
  saveOp(op);
  return op;
});

// ---------- Claude Code ----------

app.post('/api/claude/send', async (req, reply) => {
  const b = (req.body ?? {}) as { prompt?: string; projectId?: string; resume?: string; title?: string };
  const prompt = String(b.prompt ?? '').trim();
  if (!prompt) return fail(reply, 'Instruction vide.');
  const project = projectById(b.projectId);
  if (!project) return fail(reply, 'Choisis d\u2019abord un projet (dossier) pour Claude Code.');
  try {
    const op = claude.sendToClaude({ prompt, cwd: project.path, projectId: project.id, resume: b.resume ?? null, title: b.title });
    audit(who(req), 'claude.send', 1, 'ok', project.name);
    return op;
  } catch (e) {
    return fail(reply, e);
  }
});

app.post('/api/claude/decide', async (req, reply) => {
  const b = (req.body ?? {}) as { opId: string; requestId: string; allow: boolean; always?: boolean; note?: string };
  try {
    claude.decide(b.opId, b.requestId, Boolean(b.allow), Boolean(b.always), b.note);
    audit(who(req), 'claude.permission', 1, b.allow ? 'autorisé' : 'refusé');
    return { ok: true };
  } catch (e) {
    return fail(reply, e);
  }
});

app.post('/api/claude/stop', async (req) => {
  await claude.stop(String((req.body as any)?.opId));
  audit(who(req), 'claude.stop', 1, 'ok');
  return { ok: true };
});

app.get('/api/claude/sessions', async (_req, reply) => {
  try {
    return await claude.sessions(40);
  } catch (e) {
    return fail(reply, e, 500);
  }
});

// ---------- Actions Windows ----------

app.post('/api/action', async (req, reply) => {
  const { action, arg } = (req.body ?? {}) as { action: string; arg?: string };
  if (!gate(req, reply, action)) return reply;
  const label = LEVELS[action].label;
  try {
    let op: Operation;
    switch (action) {
      case 'pc.lock':
        await sys.lock();
        op = pcOp('PC verrouillé', 'done');
        break;
      case 'pc.restart':
      case 'pc.shutdown':
        await sys.powerAction(action === 'pc.restart' ? 'restart' : 'shutdown');
        power = { kind: action === 'pc.restart' ? 'restart' : 'shutdown', at: Date.now() + 60_000 };
        op = pcOp(action === 'pc.restart' ? 'Redémarrage dans 60 s' : 'Arrêt dans 60 s', 'done', 'Tu peux encore annuler pendant une minute.');
        break;
      case 'pc.sleep':
        op = pcOp('Mise en veille', 'done', 'Le PC sera injoignable jusqu\u2019à son réveil.');
        setTimeout(() => sys.powerAction('sleep').catch(() => {}), 1500);
        break;
      case 'pc.cancel':
        power = null;
        await sys.powerAction('cancel');
        op = pcOp('Arrêt annulé', 'done');
        break;
      case 'app.open': {
        const a = await sys.openApp(String(arg));
        op = pcOp(`${a.name} ouvert`, 'done');
        break;
      }
      case 'app.close':
        await sys.closeWindow(Number(arg));
        op = pcOp('Fenêtre fermée', 'done');
        break;
      case 'process.kill':
        await sys.killProcess(Number(arg));
        op = pcOp('Processus arrêté de force', 'done');
        break;
      case 'folder.open':
        sys.openFolder(String(arg));
        op = pcOp(`Dossier ouvert : ${path.basename(String(arg))}`, 'done');
        break;
      case 'script.run': {
        const s = config.scripts.find((x) => x.id === arg);
        const out = await sys.runScript(String(arg));
        op = pcOp(`Script : ${s?.name ?? arg}`, 'done', out.slice(-4000));
        break;
      }
      case 'ops.clear':
        clearOps();
        audit(who(req), action, 1, 'ok');
        return { ok: true };
      default:
        return fail(reply, 'Action non disponible ici.');
    }
    audit(who(req), action, LEVELS[action].level, 'ok', arg ? String(arg) : undefined);
    return op;
  } catch (e) {
    audit(who(req), action, LEVELS[action].level, 'erreur', String((e as any)?.message ?? e));
    pcOp(`Échec : ${label}`, 'error', redact(String((e as any)?.message ?? e)));
    return fail(reply, e, 500);
  }
});

app.get('/api/pc/processes', async () => sys.processes());
app.get('/api/pc/windows', async () => sys.openWindows());
app.get('/api/pc/screenshot', async (req, reply) => {
  const png = await sys.screenshot();
  lastShot = { png, at: Date.now() };
  audit(who(req), 'pc.screenshot', 0, 'ok');
  reply.header('Cache-Control', 'no-store').type('image/png').send(png);
});

// La dernière capture reste en mémoire (jamais sur disque) pour l'afficher dans l'écran de l'ordinateur.
app.get('/api/pc/screenshot/last', async (_req, reply) => {
  if (!lastShot) return reply.code(404).send({ error: 'Aucune capture.' });
  reply.header('Cache-Control', 'no-store').type('image/png').send(lastShot.png);
});

// ---------- Détail d'une tâche ----------

app.get('/api/ops/:id', async (req, reply) => {
  const op = getOp((req.params as any).id);
  return op ?? reply.code(404).send({ error: 'Tâche introuvable.' });
});

app.get('/api/ops/:id/diff', async (req, reply) => {
  const op = getOp((req.params as any).id);
  if (!op?.cwd) return reply.code(404).send({ error: 'Tâche introuvable.' });
  return changes.diffFor(op.cwd, op.files ?? []);
});

// ---------- Mise à jour ----------

app.get('/api/update/check', async (_req, reply) => {
  try {
    return await updater.check();
  } catch (e) {
    return fail(reply, e, 500);
  }
});

app.post('/api/update', async (req, reply) => {
  if (!gate(req, reply, 'app.update')) return reply;
  try {
    const out = await updater.apply();
    audit(who(req), 'app.update', 2, 'ok', out.version);
    // L'icône de la zone de notification relance l'agent après son arrêt.
    setTimeout(() => process.exit(0), 800);
    return out;
  } catch (e) {
    audit(who(req), 'app.update', 2, 'erreur', String((e as any)?.message ?? e));
    return fail(reply, e, 500);
  }
});

// ---------- Réglages de sécurité (dossiers, applications, scripts) ----------

app.post('/api/settings/security', async (req, reply) => {
  if (!gate(req, reply, 'settings.security')) return reply;
  const b = (req.body ?? {}) as { allowedFolders?: string[]; apps?: any[]; scripts?: any[] };
  try {
    if (Array.isArray(b.allowedFolders)) {
      const list = b.allowedFolders.map(String).map((f) => f.trim()).filter(Boolean);
      for (const f of list) {
        if (isBlockedDrive(f)) throw new Error(`Le lecteur ${f.slice(0, 2)} est bloqué dans la configuration.`);
        if (!fs.existsSync(f) || !fs.statSync(f).isDirectory()) throw new Error(`Dossier introuvable : ${f}`);
      }
      if (!list.length) throw new Error('Garde au moins un dossier.');
      config.allowedFolders = list;
    }
    if (Array.isArray(b.apps)) {
      config.apps = b.apps.map((a) => {
        const command = String(a.command ?? '').trim();
        if (!command) throw new Error('Chemin d\u2019application vide.');
        if (path.isAbsolute(command) && !fs.existsSync(command)) throw new Error(`Programme introuvable : ${command}`);
        if (!/\.exe$/i.test(command)) throw new Error('Seuls les programmes .exe sont acceptés.');
        return { id: String(a.id || crypto.randomUUID()), name: String(a.name || path.basename(command, '.exe')).slice(0, 40), command, process: a.process ? String(a.process) : undefined };
      });
    }
    if (Array.isArray(b.scripts)) {
      config.scripts = b.scripts.map((s) => {
        const p = String(s.path ?? '').trim();
        if (!/\.(ps1|bat|cmd)$/i.test(p)) throw new Error('Script accepté : .ps1, .bat ou .cmd.');
        if (!fs.existsSync(p)) throw new Error(`Script introuvable : ${p}`);
        return { id: String(s.id || crypto.randomUUID()), name: String(s.name || path.basename(p)).slice(0, 40), path: p };
      });
    }
    saveConfig();
    audit(who(req), 'settings.security', 2, 'ok');
    return { ...publicConfig(), appsFull: config.apps, scriptsFull: config.scripts };
  } catch (e) {
    return fail(reply, e);
  }
});

app.get('/api/settings/security', async () => ({ appsFull: config.apps, scriptsFull: config.scripts, allowedFolders: config.allowedFolders }));

app.get('/api/files', async (req, reply) => {
  const p = String((req.query as any)?.path ?? '');
  try {
    if (!p) return { path: null, entries: config.allowedFolders.map((f) => ({ name: path.basename(f), path: f, dir: true, size: 0, mtime: 0 })) };
    return { path: p, parent: config.allowedFolders.some((r) => path.resolve(r).toLowerCase() === path.resolve(p).toLowerCase()) ? null : path.dirname(p), entries: sys.listDir(p) };
  } catch (e) {
    return fail(reply, e, 403);
  }
});

app.get('/api/files/download', async (req, reply) => {
  const p = String((req.query as any)?.path ?? '');
  if (!isInsideAllowed(p) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return fail(reply, 'Fichier inaccessible.', 403);
  audit(who(req), 'file.download', 1, 'ok', p);
  reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(p))}`);
  return reply.type('application/octet-stream').send(fs.createReadStream(p));
});

app.post('/api/files/upload', async (req, reply) => {
  if (!gate(req, reply, 'file.upload')) return reply;
  const file = await req.file();
  const dir = String((file?.fields as any)?.dir?.value ?? '');
  if (!file || !isInsideAllowed(dir)) return fail(reply, 'Dossier de destination non autorisé.', 403);
  const name = path.basename(file.filename).replace(/[<>:"/\\|?*]/g, '_');
  let dest = path.join(dir, name);
  for (let i = 1; fs.existsSync(dest); i++) dest = path.join(dir, `${path.parse(name).name} (${i})${path.extname(name)}`);
  fs.writeFileSync(dest, await file.toBuffer());
  audit(who(req), 'file.upload', 2, 'ok', dest);
  return pcOp(`Fichier reçu : ${path.basename(dest)}`, 'done', dest);
});

// ---------- Réglages ----------

app.post('/api/settings', async (req, reply) => {
  const b = (req.body ?? {}) as any;
  if (Array.isArray(b.projects)) {
    for (const p of b.projects) if (!fs.existsSync(p.path)) return fail(reply, `Dossier introuvable : ${p.path}`);
    config.projects = b.projects.map((p: any) => ({ id: String(p.id), name: String(p.name).slice(0, 60), path: String(p.path), notes: String(p.notes ?? '').slice(0, 4000) }));
  }
  if ('activeProjectId' in b) config.activeProjectId = b.activeProjectId;
  if (b.refiner && b.refiner in config.providers) config.refiner = b.refiner;
  if (b.claudeApprovals === 'ask') config.claudeApprovals = 'ask';
  if (b.claudeApprovals === 'pc' && req.caller?.kind === 'local') config.claudeApprovals = 'pc';
  if (typeof b.readProjectContext === 'boolean') config.readProjectContext = b.readProjectContext;
  if (typeof b.monthlyCapUsd === 'number' && b.monthlyCapUsd >= 0) config.monthlyCapUsd = b.monthlyCapUsd;
  if (b.providers) {
    for (const id of Object.keys(config.providers) as ProviderId[]) {
      const p = b.providers[id];
      if (!p) continue;
      if (typeof p.enabled === 'boolean') config.providers[id].enabled = p.enabled;
      if (typeof p.secondOpinion === 'boolean') config.providers[id].secondOpinion = p.secondOpinion;
      if (typeof p.model === 'string') config.providers[id].model = p.model;
    }
  }
  if (b.prices) config.prices = { ...config.prices, ...b.prices };
  if (Array.isArray(b.allowedFolders)) {
    const ok = b.allowedFolders.map(String).filter((f: string) => !isBlockedDrive(f) && fs.existsSync(f));
    if (ok.length) config.allowedFolders = ok;
  }
  if (Array.isArray(b.disableDangerous)) config.enabledDangerous = config.enabledDangerous.filter((a) => !b.disableDangerous.includes(a));
  saveConfig();
  audit(who(req), 'settings', 1, 'ok');
  return publicConfig();
});

app.post('/api/settings/danger', async (req, reply) => {
  if (!gate(req, reply, 'danger.enable')) return reply;
  const action = String((req.body as any)?.action);
  if (LEVELS[action]?.level !== 3) return fail(reply, 'Action inconnue.');
  if (!config.enabledDangerous.includes(action)) config.enabledDangerous.push(action);
  saveConfig();
  audit(who(req), 'danger.enable', 2, 'ok', action);
  return publicConfig();
});

app.post('/api/keys/:provider', async (req, reply) => {
  const id = (req.params as any).provider as ProviderId;
  const k = String((req.body as any)?.key ?? '').trim();
  if (!(id in config.providers)) return fail(reply, 'Fournisseur inconnu.');
  if (k.length < 16 || /\s/.test(k)) return fail(reply, 'Cette clé semble incomplète.');
  setSecret(id, k);
  try {
    const r = await ai.testProvider(id);
    config.providers[id].enabled = true;
    saveConfig();
    audit(who(req), 'key.set', 1, 'ok', id);
    return { ok: true, models: r.models, providers: providerStatus() };
  } catch (e) {
    deleteSecret(id);
    audit(who(req), 'key.set', 1, 'erreur', id);
    return fail(reply, e);
  }
});

app.post('/api/keys/:provider/test', async (req, reply) => {
  const id = (req.params as any).provider as ProviderId;
  try {
    const r = await ai.testProvider(id);
    return { ok: true, models: r.models, providers: providerStatus() };
  } catch (e) {
    return fail(reply, e);
  }
});

app.delete('/api/keys/:provider', async (req, reply) => {
  if (!gate(req, reply, 'key.delete')) return reply;
  const id = (req.params as any).provider as ProviderId;
  deleteSecret(id);
  config.providers[id].enabled = false;
  saveConfig();
  audit(who(req), 'key.delete', 2, 'ok', id);
  return { providers: providerStatus() };
});

app.post('/api/devices/:id/revoke', async (req, reply) => {
  const id = (req.params as any).id;
  const self = req.caller?.kind === 'device' && req.caller.id === id;
  if (!self && !gate(req, reply, 'device.revoke')) return reply;
  auth.revokeDevice(id);
  audit(who(req), 'device.revoke', 2, 'ok', id);
  return { devices: auth.listDevices() };
});

app.post('/api/prompts', async (req) => {
  const b = (req.body ?? {}) as { title?: string; body?: string };
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO prompts (id, title, body, created_at) VALUES (?, ?, ?, ?)').run(id, String(b.title ?? '').slice(0, 80), String(b.body ?? '').slice(0, 8000), Date.now());
  return db.prepare('SELECT id, title, body FROM prompts ORDER BY created_at DESC').all();
});
app.delete('/api/prompts/:id', async (req) => {
  db.prepare('DELETE FROM prompts WHERE id = ?').run((req.params as any).id);
  return db.prepare('SELECT id, title, body FROM prompts ORDER BY created_at DESC').all();
});

app.delete('/api/ops/:id', async (req) => {
  const op = getOp((req.params as any).id);
  if (op && op.status !== 'running' && op.status !== 'needs_you') db.prepare('DELETE FROM operations WHERE id = ?').run(op.id);
  bus.emit('ops-cleared');
  return { ok: true };
});

app.get('/api/audit', async () => db.prepare('SELECT at, device, action, level, outcome, detail FROM audit ORDER BY id DESC LIMIT 200').all());

// ---------- Face ID ----------

function deviceOnly(req: FastifyRequest, reply: FastifyReply) {
  if (req.caller?.kind !== 'device') {
    fail(reply, 'Disponible seulement sur un téléphone appairé.');
    return null;
  }
  return req.caller;
}

app.post('/api/passkey/register/options', async (req, reply) => {
  const c = deviceOnly(req, reply);
  if (!c) return reply;
  return auth.passkeyRegisterOptions(req, c.id, c.name);
});
app.post('/api/passkey/register/verify', async (req, reply) => {
  const c = deviceOnly(req, reply);
  if (!c) return reply;
  try {
    await auth.passkeyRegisterVerify(req, c.id, req.body);
    return { ok: true };
  } catch (e) {
    return fail(reply, e);
  }
});
app.post('/api/stepup/options', async (req, reply) => {
  const c = deviceOnly(req, reply);
  if (!c) return reply;
  try {
    return await auth.stepUpOptions(req, c.id, String((req.body as any)?.action));
  } catch (e) {
    return fail(reply, e);
  }
});
app.post('/api/stepup/verify', async (req, reply) => {
  const c = deviceOnly(req, reply);
  if (!c) return reply;
  try {
    return { token: await auth.stepUpVerify(req, c.id, req.body) };
  } catch (e) {
    return fail(reply, e);
  }
});

// ---------- Notifications ----------

app.post('/api/push/subscribe', async (req, reply) => {
  const c = deviceOnly(req, reply);
  if (!c) return reply;
  try {
    push.subscribe(c.id, req.body);
    return { ok: true };
  } catch (e) {
    return fail(reply, e);
  }
});
app.post('/api/push/test', async () => {
  push.notify({ title: 'VoxControl', body: 'Les notifications fonctionnent.' });
  return { ok: true };
});

// ---------- Application ----------

if (fs.existsSync(APP_DIST)) {
  await app.register(fastifyStatic, {
    root: APP_DIST,
    setHeaders(reply, file) {
      if (/[\\/]assets[\\/]/.test(file)) reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      else reply.header('Cache-Control', 'no-cache');
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Introuvable.' });
    return reply.sendFile('index.html');
  });
}

await app.listen({ host: '127.0.0.1', port: PORT });
fs.writeFileSync(path.join(DATA_DIR, 'agent.pid'), String(process.pid));
console.log(`VoxControl ${VERSION} prêt sur http://localhost:${PORT}`);
