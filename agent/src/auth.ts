import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
// Chargée à la demande : cette bibliothèque met plusieurs secondes à se charger au démarrage.
const webauthn = () => import('@simplewebauthn/server');
import { config, saveConfig } from './config.ts';
import { audit, db } from './db.ts';

export type Caller = { kind: 'local' } | { kind: 'device'; id: string; name: string };

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// Lettres sans ambiguïté (pas de 0/O, 1/I/L).
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function shortCode(n = 6) {
  const bytes = crypto.randomBytes(n);
  return Array.from(bytes, (b) => ALPHA[b % ALPHA.length]).join('');
}

/**
 * Requête faite sur le PC lui-même, sans passer par Tailscale Serve.
 * Serve ajoute toujours X-Forwarded-For et les en-têtes Tailscale-* : leur absence,
 * combinée à une adresse de bouclage, désigne un navigateur ouvert sur ce PC.
 */
export function isLocal(req: FastifyRequest): boolean {
  const ip = req.socket.remoteAddress ?? '';
  const loop = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  const h = req.headers;
  const proxied = Boolean(h['x-forwarded-for'] || h['tailscale-user-login'] || h['x-forwarded-host']);
  const host = String(h.host ?? '').split(':')[0];
  return loop && !proxied && (host === 'localhost' || host === '127.0.0.1');
}

function tailscaleLogin(req: FastifyRequest): string | null {
  const v = req.headers['tailscale-user-login'];
  return typeof v === 'string' ? v : null;
}

export function identify(req: FastifyRequest, tokenOverride?: string): Caller | null {
  if (isLocal(req)) return { kind: 'local' };
  const login = tailscaleLogin(req);
  if (config.ownerTailscaleLogin && login && login !== config.ownerTailscaleLogin) return null;
  const auth = req.headers.authorization;
  const token = tokenOverride ?? (auth?.startsWith('Bearer ') ? auth.slice(7) : null);
  if (!token) return null;
  const row = db.prepare('SELECT id, name FROM devices WHERE token_hash = ? AND revoked = 0').get(sha(token)) as
    | { id: string; name: string }
    | undefined;
  if (!row) return null;
  db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(Date.now(), row.id);
  return { kind: 'device', id: row.id, name: row.name };
}

// ---------- Appairage ----------

let pairing: { code: string; expires: number; attempts: number } | null = null;

export function startPairing() {
  pairing = { code: shortCode(6), expires: Date.now() + 5 * 60_000, attempts: 0 };
  return { code: pairing.code, expiresAt: pairing.expires };
}

export function pairingState() {
  if (!pairing || pairing.expires < Date.now()) return null;
  return { code: pairing.code, expiresAt: pairing.expires };
}

export function claimPairing(req: FastifyRequest, code: string, name: string): { token: string; deviceId: string } | { error: string } {
  if (!pairing || pairing.expires < Date.now()) return { error: "Aucun code actif. Sur le PC, clique sur « Appairer un téléphone »." };
  pairing.attempts += 1;
  if (pairing.attempts > 5) {
    pairing = null;
    return { error: 'Trop d’essais. Génère un nouveau code sur le PC.' };
  }
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!crypto.timingSafeEqual(Buffer.from(clean.padEnd(6)), Buffer.from(pairing.code))) return { error: 'Code incorrect.' };
  pairing = null;
  const token = crypto.randomBytes(32).toString('base64url');
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO devices (id, name, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?)').run(
    id, name.slice(0, 60) || 'iPhone', sha(token), Date.now(), Date.now(),
  );
  const login = tailscaleLogin(req);
  if (login && !config.ownerTailscaleLogin) {
    config.ownerTailscaleLogin = login;
    saveConfig();
  }
  audit(id, 'pair', 1, 'ok', name);
  return { token, deviceId: id };
}

export function listDevices() {
  return (db.prepare('SELECT id, name, created_at, last_seen, revoked FROM devices ORDER BY created_at DESC').all() as any[]).map((d) => ({
    id: d.id,
    name: d.name,
    createdAt: d.created_at,
    lastSeen: d.last_seen,
    revoked: Boolean(d.revoked),
    passkey: Boolean(db.prepare('SELECT 1 FROM passkeys WHERE device_id = ?').get(d.id)),
  }));
}

export function revokeDevice(id: string) {
  db.prepare('UPDATE devices SET revoked = 1 WHERE id = ?').run(id);
  db.prepare('DELETE FROM passkeys WHERE device_id = ?').run(id);
  db.prepare('DELETE FROM push_subs WHERE device_id = ?').run(id);
}

// ---------- Passkeys (Face ID) ----------

function rp(req: FastifyRequest) {
  const fwdHost = req.headers['x-forwarded-host'];
  const host = String((typeof fwdHost === 'string' && fwdHost) || req.headers.host || 'localhost');
  const rpID = host.split(':')[0];
  const proto = isLocal(req) ? 'http' : 'https';
  return { rpID, origin: `${proto}://${host}` };
}

const challenges = new Map<string, { challenge: string; action?: string; expires: number }>();

export function hasPasskey(deviceId: string) {
  return Boolean(db.prepare('SELECT 1 FROM passkeys WHERE device_id = ?').get(deviceId));
}

export async function passkeyRegisterOptions(req: FastifyRequest, deviceId: string, deviceName: string) {
  const { rpID } = rp(req);
  const existing = db.prepare('SELECT id, transports FROM passkeys WHERE device_id = ?').all(deviceId) as any[];
  const { generateRegistrationOptions } = await webauthn();
  const opts = await generateRegistrationOptions({
    rpName: 'VoxControl',
    rpID,
    userName: deviceName,
    userID: new TextEncoder().encode(deviceId),
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports ? JSON.parse(p.transports) : undefined })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
  challenges.set(`reg:${deviceId}`, { challenge: opts.challenge, expires: Date.now() + 120_000 });
  return opts;
}

export async function passkeyRegisterVerify(req: FastifyRequest, deviceId: string, response: any) {
  const c = challenges.get(`reg:${deviceId}`);
  challenges.delete(`reg:${deviceId}`);
  if (!c || c.expires < Date.now()) throw new Error('Demande expirée, recommence.');
  const { rpID, origin } = rp(req);
  const { verifyRegistrationResponse } = await webauthn();
  const v = await verifyRegistrationResponse({ response, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
  if (!v.verified || !v.registrationInfo) throw new Error('Face ID non vérifié.');
  const cred = v.registrationInfo.credential;
  db.prepare('INSERT OR REPLACE INTO passkeys (id, device_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)').run(
    cred.id, deviceId, Buffer.from(cred.publicKey), cred.counter, JSON.stringify(cred.transports ?? []),
  );
  audit(deviceId, 'passkey.register', 1, 'ok');
}

export async function stepUpOptions(req: FastifyRequest, deviceId: string, action: string) {
  const { rpID } = rp(req);
  const keys = db.prepare('SELECT id, transports FROM passkeys WHERE device_id = ?').all(deviceId) as any[];
  if (!keys.length) throw new Error('Active Face ID dans Réglages › Cet appareil pour confirmer les actions sensibles.');
  const { generateAuthenticationOptions } = await webauthn();
  const opts = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
    allowCredentials: keys.map((k) => ({ id: k.id, transports: k.transports ? JSON.parse(k.transports) : undefined })),
  });
  challenges.set(`auth:${deviceId}`, { challenge: opts.challenge, action, expires: Date.now() + 120_000 });
  return opts;
}

const stepUps = new Map<string, { deviceId: string; action: string; expires: number }>();

// Les confirmations et défis expirés sont oubliés chaque minute.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of stepUps) if (v.expires < now) stepUps.delete(k);
  for (const [k, v] of challenges) if (v.expires < now) challenges.delete(k);
}, 60_000).unref();

export async function stepUpVerify(req: FastifyRequest, deviceId: string, response: any): Promise<string> {
  const c = challenges.get(`auth:${deviceId}`);
  challenges.delete(`auth:${deviceId}`);
  if (!c || c.expires < Date.now() || !c.action) throw new Error('Demande expirée, recommence.');
  const row = db.prepare('SELECT id, public_key, counter, transports FROM passkeys WHERE id = ? AND device_id = ?').get(response.id, deviceId) as any;
  if (!row) throw new Error('Clé inconnue pour cet appareil.');
  const { rpID, origin } = rp(req);
  const { verifyAuthenticationResponse } = await webauthn();
  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge: c.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: { id: row.id, publicKey: new Uint8Array(row.public_key), counter: row.counter, transports: row.transports ? JSON.parse(row.transports) : undefined },
  });
  if (!v.verified) throw new Error('Face ID non vérifié.');
  db.prepare('UPDATE passkeys SET counter = ? WHERE id = ?').run(v.authenticationInfo.newCounter, row.id);
  const token = crypto.randomBytes(24).toString('base64url');
  stepUps.set(token, { deviceId, action: c.action, expires: Date.now() + 90_000 });
  return token;
}

/** Une confirmation Face ID vaut pour une seule action, pendant 90 secondes. */
export function consumeStepUp(caller: Caller, action: string, token: string | undefined): boolean {
  if (caller.kind === 'local') return true;
  if (!token) return false;
  const s = stepUps.get(token);
  stepUps.delete(token);
  return Boolean(s && s.deviceId === caller.id && s.action === action && s.expires > Date.now());
}
