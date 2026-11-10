import { useSyncExternalStore } from 'react';
import type { Operation, Suggestion } from './types';

// Une seule page, aucune route : iOS coupe le micro des apps installées quand l'adresse change.
export type SheetSpec =
  | { kind: 'draft'; text: string; suggestion: Suggestion | null; transcribing?: boolean; error?: string; keyboardHint?: boolean }
  | { kind: 'op'; id: string }
  | { kind: 'apps' }
  | { kind: 'files' }
  | { kind: 'power' }
  | { kind: 'sessions' }
  | { kind: 'projects' }
  | { kind: 'security' }
  | { kind: 'settings'; section?: string }
  | { kind: 'provider'; id: 'mistral' | 'openai' | 'gemini' }
  | { kind: 'palette' }
  | { kind: 'confirm'; action: string; arg?: string; label: string; detail?: string; run: (stepUp?: string) => Promise<unknown> }
  | { kind: 'pair' }
  | { kind: 'screenshot'; url: string };

export type Tab = 'talk' | 'claude' | 'studio' | 'pc';

type NavState = { tab: Tab; stack: SheetSpec[]; followUp: { sessionId: string; title: string; projectId: string | null } | null };

let state: NavState = { tab: 'talk', stack: [], followUp: null };
const ls = new Set<() => void>();
const emit = () => ls.forEach((l) => l());

export const nav = {
  get: () => state,
  open(spec: SheetSpec) {
    // Au plus deux niveaux : au-delà, la feuille du dessus remplace la précédente.
    const stack = state.stack.length >= 2 ? [state.stack[0], spec] : [...state.stack, spec];
    state = { ...state, stack };
    emit();
  },
  replace(spec: SheetSpec) {
    state = { ...state, stack: [...state.stack.slice(0, -1), spec] };
    emit();
  },
  close() {
    state = { ...state, stack: state.stack.slice(0, -1) };
    emit();
  },
  closeAll() {
    state = { ...state, stack: [] };
    emit();
  },
  setTab(tab: Tab) {
    state = { ...state, tab, stack: [] };
    emit();
  },
  setFollowUp(f: NavState['followUp']) {
    state = { ...state, followUp: f };
    emit();
  },
  subscribe(l: () => void) {
    ls.add(l);
    return () => ls.delete(l);
  },
};

export function useNav() {
  return useSyncExternalStore(nav.subscribe, nav.get);
}

export function followUpFrom(op: Operation) {
  if (op.sessionId) nav.setFollowUp({ sessionId: op.sessionId, title: op.title, projectId: op.projectId ?? null });
}

// ---------- Messages éphémères ----------

export type Toast = { id: number; text: string; tone: 'ok' | 'error' | 'info' };
let toasts: Toast[] = [];
const tl = new Set<() => void>();
let seq = 0;

export function toast(text: string, tone: Toast['tone'] = 'info') {
  const t = { id: ++seq, text, tone };
  toasts = [...toasts.slice(-2), t];
  tl.forEach((l) => l());
  window.setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    tl.forEach((l) => l());
  }, tone === 'error' ? 6000 : 3200);
}

export function useToasts() {
  return useSyncExternalStore(
    (l) => {
      tl.add(l);
      return () => tl.delete(l);
    },
    () => toasts,
  );
}
