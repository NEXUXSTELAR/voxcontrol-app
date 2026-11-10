import fs from 'node:fs';
import path from 'node:path';
import * as webpush from 'web-push';
import { DATA_DIR } from './config.ts';
import { db } from './db.ts';
import { getSecret, setSecret } from './secrets.ts';

// La clé publique VAPID est publique par nature ; la privée reste dans le coffre Windows.
const PUB_FILE = path.join(DATA_DIR, 'vapid-public.txt');
let publicKey = fs.existsSync(PUB_FILE) ? fs.readFileSync(PUB_FILE, 'utf8').trim() : '';
let privateKey = getSecret('vapid_private') ?? '';
if (!publicKey || !privateKey) {
  const k = webpush.generateVAPIDKeys();
  publicKey = k.publicKey;
  privateKey = k.privateKey;
  fs.writeFileSync(PUB_FILE, publicKey);
  setSecret('vapid_private', privateKey);
}
webpush.setVapidDetails('mailto:voxcontrol@localhost.invalid', publicKey, privateKey);

export const vapidPublicKey = publicKey;

export function subscribe(deviceId: string, sub: any) {
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint)) throw new Error('Abonnement invalide.');
  db.prepare('INSERT OR REPLACE INTO push_subs (endpoint, device_id, data) VALUES (?, ?, ?)').run(sub.endpoint, deviceId, JSON.stringify(sub));
}

export function unsubscribe(endpoint: string) {
  db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);
}

export function notify(msg: { title: string; body: string; opId?: string }) {
  const subs = db.prepare('SELECT endpoint, data FROM push_subs').all() as { endpoint: string; data: string }[];
  for (const s of subs) {
    webpush.sendNotification(JSON.parse(s.data), JSON.stringify(msg), { TTL: 3600, urgency: 'high' }).catch((e: any) => {
      if (e?.statusCode === 404 || e?.statusCode === 410) unsubscribe(s.endpoint);
    });
  }
}
