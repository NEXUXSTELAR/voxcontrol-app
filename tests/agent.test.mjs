// Tests de l'agent : lancent une copie isolée (port, dossier de données et coffre de clés à part),
// puis vérifient l'appairage, l'authentification et les niveaux de risque.
// Lancer : npm test
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Entry } from '@napi-rs/keyring';

const PORT = 47899;
const B = `http://localhost:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-test-'));
const KEYRING = 'VoxControlTest';
// Configuration de test : un lecteur bloqué, pour vérifier la règle.
fs.writeFileSync(path.join(DATA, 'config.json'), JSON.stringify({ blockedDrives: ['D:'] }));
// Simule un téléphone qui passe par Tailscale Serve.
const REMOTE = { 'X-Forwarded-For': '100.101.102.103', 'Tailscale-User-Login': 'proprietaire@test', 'X-Forwarded-Host': 'pc.test.ts.net' };
let agent;
let token;
let deviceId;

const json = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const call = (p, { method, body, headers = {} } = {}) =>
  fetch(B + p, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }).then(json);
const asPhone = (p, opts = {}) => call(p, { ...opts, headers: { ...REMOTE, Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) } });

before(async () => {
  agent = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'agent/src/main.ts', 'VOX_TEST'], {
    env: { ...process.env, VOX_PORT: String(PORT), VOX_DATA_DIR: DATA, VOX_KEYRING: KEYRING },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${B}/api/hello`)).ok) return;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Agent de test non démarré');
});

after(async () => {
  if (agent && agent.exitCode === null) {
    const exited = new Promise((r) => agent.once('exit', r));
    agent.kill();
    await exited;
  }
  for (const n of ['vapid_private', 'mistral', 'openai', 'gemini']) {
    try {
      new Entry(KEYRING, n).deletePassword();
    } catch {
      /* absente */
    }
  }
  fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
});

test('sans appairage, rien n\u2019est accessible à distance', async () => {
  for (const h of [{ 'X-Forwarded-For': '1.2.3.4' }, { 'Tailscale-User-Login': 'x@y' }]) {
    assert.equal((await call('/api/state', { headers: h })).status, 401);
  }
  assert.equal((await call('/api/state', { headers: { ...REMOTE, Authorization: 'Bearer faux' } })).status, 401);
});

test('le code d\u2019appairage ne se demande que depuis le PC', async () => {
  assert.equal((await call('/api/pair/start', { method: 'POST', headers: REMOTE })).status, 403);
});

test('appairage : mauvais code refusé, bon code accepté', async () => {
  const start = await call('/api/pair/start', { method: 'POST' });
  assert.equal(start.status, 200);
  const bad = await call('/api/pair/claim', { body: { code: 'AAAAAA', name: 'Test' }, headers: REMOTE });
  assert.equal(bad.status, 400);
  const ok = await call('/api/pair/claim', { body: { code: start.body.code.toLowerCase(), name: 'Téléphone test' }, headers: REMOTE });
  assert.equal(ok.status, 200);
  token = ok.body.token;
  deviceId = ok.body.deviceId;
  const st = await asPhone('/api/state');
  assert.equal(st.status, 200);
  assert.equal(st.body.caller.kind, 'device');
});

test('un autre compte Tailscale est refusé, même avec le jeton', async () => {
  assert.equal((await asPhone('/api/state', { headers: { 'Tailscale-User-Login': 'intrus@test' } })).status, 401);
});

test('les actions sensibles exigent Face ID', async () => {
  for (const action of ['pc.restart', 'pc.shutdown', 'pc.sleep']) {
    const r = await asPhone('/api/action', { body: { action } });
    assert.equal(r.status, 428, action);
  }
  assert.equal((await asPhone('/api/action', { body: { action: 'pc.restart' }, headers: { 'X-Vox-Stepup': 'invente' } })).status, 428);
  assert.equal((await asPhone('/api/update', { method: 'POST' })).status, 428);
  assert.equal((await asPhone('/api/settings/security', { body: { allowedFolders: ['C:\\'] } })).status, 428);
});

test('les actions interdites le restent, même depuis le PC', async () => {
  const r = await call('/api/action', { body: { action: 'process.kill', arg: '1' } });
  assert.equal(r.status, 403);
});

test('les dossiers hors liste et les lecteurs bloqués sont inaccessibles', async () => {
  assert.equal((await asPhone(`/api/files?path=${encodeURIComponent('C:\\Windows')}`)).status, 403);
  assert.equal((await asPhone(`/api/files?path=${encodeURIComponent('D:\\')}`)).status, 403);
  assert.equal((await asPhone(`/api/files/download?path=${encodeURIComponent('C:\\Windows\\win.ini')}`)).status, 403);
});

test('la liste des tâches n\u2019envoie pas les journaux complets', async () => {
  await asPhone('/api/note', { body: { text: 'note de test' } });
  const st = await asPhone('/api/state');
  const op = st.body.ops[0];
  assert.equal(op.log, undefined);
  assert.equal(typeof op.logCount, 'number');
  const full = await asPhone(`/api/ops/${op.id}`);
  assert.ok(Array.isArray(full.body.log));
});

test('une clé API n\u2019est jamais renvoyée en clair', async () => {
  const st = await asPhone('/api/state');
  assert.ok(!JSON.stringify(st.body).match(/sk-[A-Za-z0-9]{12,}/));
});

test('un appareil peut se révoquer lui-même, et perd tout accès', async () => {
  assert.equal((await asPhone(`/api/devices/${deviceId}/revoke`, { method: 'POST' })).status, 200);
  assert.equal((await asPhone('/api/state')).status, 401);
});
