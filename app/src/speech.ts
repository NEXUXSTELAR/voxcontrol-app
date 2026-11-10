import { useSyncExternalStore } from 'react';
import type { OpSummary } from './types';

// ---------- Préférences de cet appareil (gardées dans le navigateur) ----------

export type Prefs = {
  theme: 'auto' | 'light' | 'dark';
  speak: boolean;
  live: boolean;
  autoSend: boolean;
  icon: 'dark' | 'light';
};
const DEFAULTS: Prefs = { theme: 'auto', speak: false, live: false, autoSend: true, icon: 'dark' };

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('vox.prefs') ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}
let prefs = load();
const ls = new Set<() => void>();

export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]) {
  prefs = { ...prefs, [k]: v };
  try {
    localStorage.setItem('vox.prefs', JSON.stringify(prefs));
  } catch {
    /* préférence non gardée */
  }
  applyTheme();
  applyIcon();
  ls.forEach((l) => l());
}
export const getPrefs = () => prefs;
export function usePrefs() {
  return useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    () => prefs,
  );
}

export function applyTheme() {
  const t = prefs.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

/** L'icône compte au moment où l'app est ajoutée à l'écran d'accueil. */
export function applyIcon() {
  const link = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  if (link) link.href = prefs.icon === 'light' ? '/apple-touch-icon-light.png' : '/apple-touch-icon.png';
}

// ---------- Retour physique ----------
// Pris en charge sur Android et sur ordinateur ; Safari sur iPhone l'ignore sans erreur.
export function buzz(pattern: number | number[] = 12) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* non pris en charge */
  }
}

// ---------- Lecture à voix haute ----------

function plain(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, ' (bloc de code) ')
    .replace(/[#*_`>|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function say(text: string) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(plain(text).slice(0, 400));
  u.lang = 'fr-FR';
  const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('fr'));
  if (voice) u.voice = voice;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/** Appelé à chaque mise à jour d'une tâche : annonce la fin des tâches Claude si l'option est active. */
export function onOpUpdate(before: OpSummary | undefined, after: OpSummary) {
  if (!before || before.status === after.status) return;
  if (after.status === 'needs_you') buzz([10, 60, 10]);
  if (after.kind !== 'claude') return;
  if (after.status === 'done' || after.status === 'error') {
    buzz(20);
    if (prefs.speak && document.visibilityState === 'visible') {
      say(after.status === 'done' ? `Claude a terminé. ${after.result ?? ''}` : `Claude s'est arrêté sur une erreur.`);
    }
  }
}

applyTheme();
applyIcon();
