import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api, ApiError, refreshState, store } from './api';
import { nav, toast } from './nav';

export function levelOf(action: string): number {
  return store.get().state?.levels[action]?.level ?? 2;
}

/**
 * Point d'entrée unique des actions Windows : applique le niveau de risque côté interface
 * (le PC le vérifie de nouveau de son côté).
 */
export function runAction(action: string, arg?: string, opts: { label?: string; detail?: string } = {}) {
  const lvl = levelOf(action);
  const label = opts.label ?? store.get().state?.levels[action]?.label ?? action;
  const exec = (stepUp?: string) => api('/api/action', { body: { action, arg }, stepUp });
  if (lvl >= 2) {
    nav.open({ kind: 'confirm', action, arg, label, detail: opts.detail, run: exec });
    return;
  }
  exec()
    .then(() => toast(`${label} : fait`, 'ok'))
    .catch((e: ApiError) => toast(e.message, 'error'));
}

// Les options sont demandées à l'ouverture de la feuille, pour que l'appel Face ID
// parte directement du toucher (Safari l'exige).
export async function prepareStepUp(action: string) {
  return api('/api/stepup/options', { body: { action } });
}

export async function performStepUp(options: any): Promise<string> {
  const response = await startAuthentication({ optionsJSON: options });
  const r = await api<{ token: string }>('/api/stepup/verify', { body: response });
  return r.token;
}

export async function prepareRegistration() {
  return api('/api/passkey/register/options', { method: 'POST' });
}

export async function performRegistration(options: any) {
  const response = await startRegistration({ optionsJSON: options });
  await api('/api/passkey/register/verify', { body: response });
  await refreshState();
}

function urlB64ToUint8(base64: string) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function enablePush(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Sur iPhone, les notifications marchent seulement depuis l’app ajoutée à l’écran d’accueil (iOS 16.4 ou plus récent).');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications refusées. Tu peux les réactiver dans Réglages iPhone › Notifications › VoxControl.');
  const reg = await navigator.serviceWorker.ready;
  const key = store.get().state?.vapidPublicKey;
  if (!key) throw new Error('Clé de notification indisponible.');
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(key) }));
  await api('/api/push/subscribe', { body: sub.toJSON() });
}

export async function pushEnabled(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || Notification.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return Boolean(await reg?.pushManager.getSubscription());
  } catch {
    return false;
  }
}
