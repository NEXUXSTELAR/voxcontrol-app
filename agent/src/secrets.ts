import { Entry } from '@napi-rs/keyring';

// Coffre : Gestionnaire d'identification Windows. Rien n'est écrit sur disque en clair.
// Les tests utilisent un autre nom pour ne jamais toucher aux vraies clés.
const SERVICE = process.env.VOX_KEYRING ?? 'VoxControl';

export type SecretName = 'mistral' | 'openai' | 'gemini' | 'vapid_private';

export function getSecret(name: SecretName): string | null {
  try {
    return new Entry(SERVICE, name).getPassword() ?? null;
  } catch {
    return null;
  }
}

export function setSecret(name: SecretName, value: string) {
  new Entry(SERVICE, name).setPassword(value);
  registerForRedaction(value);
}

export function deleteSecret(name: SecretName) {
  try {
    new Entry(SERVICE, name).deletePassword();
  } catch {
    /* déjà absent */
  }
}

export function hint(name: SecretName): string | null {
  const v = getSecret(name);
  return v ? `••••${v.slice(-4)}` : null;
}

// Toute valeur secrète connue est masquée dans les journaux et les messages d'erreur.
const known = new Set<string>();
function registerForRedaction(v: string) {
  if (v && v.length >= 8) known.add(v);
}
for (const n of ['mistral', 'openai', 'gemini'] as const) {
  const v = getSecret(n);
  if (v) registerForRedaction(v);
}

export function redact(text: string): string {
  let out = text;
  for (const v of known) out = out.split(v).join('[clé masquée]');
  return out.replace(/\b(sk-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,})\b/g, '[clé masquée]');
}
