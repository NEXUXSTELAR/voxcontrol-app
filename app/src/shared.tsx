import { useEffect, useState } from 'react';
import { api, store } from './api';
import { ago } from './format';
import { nav, toast } from './nav';
import type { OpSummary, Suggestion } from './types';
import { Icon } from './ui/Icon';

export async function openDraftFromText(text: string) {
  let suggestion: Suggestion | null = null;
  try {
    suggestion = await api<Suggestion>('/api/suggest', { body: { text } });
  } catch {
    /* proposition indisponible : l'utilisateur choisit */
  }
  nav.open({ kind: 'draft', text, suggestion });
}

export function StatusGlyph({ op }: { op: OpSummary }) {
  if (op.status === 'running') return <span className="dot run" aria-label="En cours" />;
  if (op.status === 'needs_you') return <span className="dot wait" aria-label="Attend ton accord" />;
  if (op.status === 'error') return <Icon name="alert" size={18} label="Erreur" />;
  if (op.status === 'stopped') return <span className="dot off" aria-label="Arrêtée" />;
  return <Icon name="check" size={18} label="Terminé" />;
}

const KIND_LABEL: Record<OpSummary['kind'], string> = { claude: 'Claude', pc: 'PC', note: 'Note' };

function projectName(id?: string | null) {
  return store.get().state?.config.projects.find((p) => p.id === id)?.name;
}

export function OpRow({ op }: { op: OpSummary }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <button className="row" onClick={() => nav.open({ kind: 'op', id: op.id })}>
      <span className="glyph" style={op.status === 'error' ? { color: 'var(--danger)' } : undefined}>
        <StatusGlyph op={op} />
      </span>
      <span className="body">
        <span className="title">{op.title}</span>
        <span className="meta">
          {KIND_LABEL[op.kind]}
          {op.kind === 'claude' && projectName(op.projectId) ? ` · ${projectName(op.projectId)}` : ''} · {op.status === 'error' ? 'Erreur' : op.status === 'stopped' ? 'Arrêtée' : ago(op.updatedAt)}
        </span>
        {op.status === 'running' && op.last && <span className="meta mono one-line">{op.last}</span>}
      </span>
    </button>
  );
}

export function AskCard({ op }: { op: OpSummary }) {
  const [busy, setBusy] = useState(false);
  const p = op.pending;
  if (!p) return null;
  const decide = async (allow: boolean, always = false) => {
    setBusy(true);
    try {
      await api('/api/claude/decide', { body: { opId: op.id, requestId: p.requestId, allow, always } });
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ask" role="group" aria-label="Autorisation demandée">
      <div className="ask-head">
        <span className="dot wait" /> Claude demande : {p.tool}
      </div>
      <pre className="mono">{p.summary}</pre>
      <div className="ask-actions">
        <button className="btn sm ink" style={{ flex: 1 }} disabled={busy} onClick={() => decide(true)}>
          Autoriser
        </button>
        <button className="btn sm" style={{ flex: 1 }} disabled={busy} onClick={() => decide(false)}>
          Refuser
        </button>
        <button className="btn sm ghost" disabled={busy} onClick={() => decide(true, true)} aria-label="Autoriser jusqu'à la fin de la session">
          Toujours
        </button>
      </div>
    </div>
  );
}

/** Temps écoulé qui se met à jour chaque seconde. */
export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <>{s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`}</>;
}
