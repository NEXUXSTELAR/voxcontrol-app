import { useState } from 'react';
import { api, useStore } from '../api';
import { nav, toast } from '../nav';
import { AskCard, Elapsed, OpRow } from '../shared';
import { Icon } from '../ui/Icon';

/** Espace Claude : ce qui tourne, ce qui t'attend, puis l'historique. */
export function ClaudeSpace() {
  const ops = useStore((s) => s.ops);
  const st = useStore((s) => s.state);
  const project = st?.config.projects.find((p) => p.id === st.config.activeProjectId);
  const waiting = ops.filter((o) => o.status === 'needs_you');
  const running = ops.filter((o) => o.status === 'running' && o.kind === 'claude');
  // Seulement Claude : les actions PC vont dans l'espace PC, les notes restent dans la palette.
  const rest = ops.filter((o) => o.kind === 'claude' && o.status !== 'needs_you' && o.status !== 'running');
  const [all, setAll] = useState(false);

  return (
    <div className="space" data-space="claude">
      <header className="space-head">
        <h1>Claude</h1>
        <button className="chip" onClick={() => nav.open({ kind: 'projects' })}>
          <Icon name="folder" size={16} />
          {project?.name ?? 'Choisir un projet'}
          <Icon name="chevronDown" size={16} />
        </button>
      </header>

      {waiting.map((o) => (
        <div key={o.id} style={{ margin: '0 -16px' }}>
          <AskCard op={o} />
        </div>
      ))}

      {running.map((o) => (
        <LiveCard key={o.id} id={o.id} />
      ))}

      {!waiting.length && !running.length && (
        <p className="lead-text">Claude est prêt. Parle depuis l'espace « Parler » ou reprends une session existante.</p>
      )}

      <button className="item outline" onClick={() => nav.open({ kind: 'sessions' })}>
        <span className="lead">
          <Icon name="history" />
        </span>
        <span className="main">
          <div className="t">Reprendre une session du PC</div>
        </span>
        <span className="end">
          <Icon name="chevronRight" size={18} />
        </span>
      </button>

      {rest.length > 0 && (
        <>
          <div className="group" style={{ padding: '18px 0 2px' }}>
            <span>Historique</span>
            {rest.length > 8 && <button onClick={() => setAll(!all)}>{all ? 'Réduire' : `Tout (${rest.length})`}</button>}
          </div>
          <div style={{ margin: '0 -16px' }}>
            {(all ? rest : rest.slice(0, 8)).map((o) => (
              <OpRow key={o.id} op={o} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function LiveCard({ id }: { id: string }) {
  const op = useStore((s) => s.ops.find((o) => o.id === id));
  const [stopping, setStopping] = useState(false);
  if (!op) return null;
  const stop = async () => {
    setStopping(true);
    try {
      await api('/api/claude/stop', { body: { opId: op.id } });
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setStopping(false);
    }
  };
  return (
    <div className="live">
      <button className="live-main" onClick={() => nav.open({ kind: 'op', id: op.id })}>
        <div className="live-head">
          <span className="dot run" /> En cours · <Elapsed since={op.createdAt} />
        </div>
        <div className="live-title">{op.title}</div>
        <div className="mono one-line soft">{op.last ?? 'Démarrage…'}</div>
      </button>
      <button className="btn sm" onClick={stop} disabled={stopping}>
        <Icon name="stop" size={16} /> Arrêter
      </button>
    </div>
  );
}
