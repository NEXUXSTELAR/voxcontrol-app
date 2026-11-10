import { useEffect, useRef, useState } from 'react';
import { api, loadLog, useStore } from '../api';
import { ago, copy } from '../format';
import { nav, toast } from '../nav';
import { AskCard, Elapsed, StatusGlyph } from '../shared';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/kit';
import { Markdown } from '../ui/Markdown';

const STATUS: Record<string, string> = { running: 'En cours', needs_you: 'Attend ton accord', done: 'Terminé', error: 'Erreur', stopped: 'Arrêtée' };

type Diff = { git: boolean; files: { path: string; status: string; diff: string | null }[] };

export function OpSheet({ id, level, docked }: { id: string; level: number; docked: boolean }) {
  const op = useStore((s) => s.ops.find((o) => o.id === id));
  const log = useStore((s) => s.logs[id]);
  const end = useRef<HTMLDivElement>(null);
  const [stopping, setStopping] = useState(false);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const live = op?.status === 'running' || op?.status === 'needs_you';

  useEffect(() => {
    loadLog(id).catch(() => {});
  }, [id]);
  useEffect(() => {
    if (live) end.current?.scrollIntoView({ block: 'end' });
  }, [log?.length, live]);
  useEffect(() => {
    if (op && !live && op.files?.length) api<Diff>(`/api/ops/${op.id}/diff`).then(setDiff).catch(() => {});
  }, [op?.status, op?.files?.length]);

  if (!op) {
    return (
      <Sheet title="Tâche" level={level} docked={docked}>
        <p className="soft">Cette tâche a été effacée.</p>
      </Sheet>
    );
  }

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

  const remove = async () => {
    await api(`/api/ops/${op.id}`, { method: 'DELETE' });
    nav.close();
  };

  const foot =
    op.kind === 'claude' ? (
      live ? (
        <button className="btn block danger" disabled={stopping} onClick={stop}>
          <Icon name="stop" size={18} /> Arrêter
        </button>
      ) : (
        <div className="btns">
          {op.result && (
            <button className="btn" onClick={() => copy(op.result!).then(() => toast('Résultat copié', 'ok'))}>
              <Icon name="copy" size={18} /> Copier
            </button>
          )}
          {op.sessionId && (
            <button
              className="btn ink"
              style={{ flex: 2 }}
              onClick={() => {
                nav.setFollowUp({ sessionId: op.sessionId!, title: op.title, projectId: op.projectId ?? null });
                nav.setTab('talk');
              }}
            >
              Continuer cette session
            </button>
          )}
        </div>
      )
    ) : op.result ? (
      <button className="btn block" onClick={() => copy(op.result!).then(() => toast('Copié', 'ok'))}>
        <Icon name="copy" size={18} /> Copier
      </button>
    ) : undefined;

  return (
    <Sheet
      title={op.title}
      level={level}
      docked={docked}
      full={op.kind === 'claude'}
      foot={foot}
      actions={
        !live ? (
          <button className="icon-btn" onClick={remove} aria-label="Effacer">
            <Icon name="trash" />
          </button>
        ) : undefined
      }
    >
      <div className="route-line" style={{ marginTop: 0, marginBottom: 12 }}>
        <span className="glyph" style={{ display: 'inline-grid', width: 18 }}>
          <StatusGlyph op={op} />
        </span>
        <span>
          {STATUS[op.status]} · {live ? <Elapsed since={op.createdAt} /> : ago(op.updatedAt)}
          {op.cwd ? ` · ${op.cwd.split(/[\\/]/).pop()}` : ''}
        </span>
      </div>

      {op.pending && (
        <div style={{ margin: '0 -16px 12px' }}>
          <AskCard op={op} />
          <details style={{ margin: '0 16px' }}>
            <summary className="soft" style={{ fontSize: 13 }}>
              Détail technique
            </summary>
            <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
              {op.pending.detail}
            </pre>
          </details>
        </div>
      )}

      {diff && diff.files.length > 0 && (
        <section className="changes">
          <h3>
            {diff.files.length} fichier{diff.files.length > 1 ? 's' : ''} modifié{diff.files.length > 1 ? 's' : ''}
            {!diff.git && <span className="faint"> · hors dépôt Git, détail indisponible</span>}
          </h3>
          {diff.files.map((f) => (
            <div key={f.path} className="change">
              <button className="change-head" onClick={() => setOpenFile(openFile === f.path ? null : f.path)} disabled={!f.diff}>
                <span className={`tag${f.status === 'nouveau' ? ' ok' : f.status === 'supprimé' ? ' danger' : ''}`}>{f.status}</span>
                <span className="mono one-line">{f.path}</span>
                {f.diff && <Icon name={openFile === f.path ? 'chevronDown' : 'chevronRight'} size={16} />}
              </button>
              {openFile === f.path && f.diff && (
                <pre className="diff mono">
                  {f.diff.split('\n').map((l, i) => (
                    <span key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') ? 'hunk' : ''}>
                      {l}
                      {'\n'}
                    </span>
                  ))}
                </pre>
              )}
            </div>
          ))}
        </section>
      )}

      <div className="log">
        {!log && <div className="skeleton"><i style={{ width: '80%' }} /><i style={{ width: '60%' }} /></div>}
        {log?.map((l, i) =>
          l.kind === 'user' ? (
            <div key={i} className="log-user">
              {l.text}
            </div>
          ) : l.kind === 'tool' ? (
            <div key={i} className="log-tool">
              <Icon name="terminal" size={16} />
              <span className="mono" style={{ fontSize: 12.5 }}>
                {l.text}
              </span>
            </div>
          ) : l.kind === 'info' ? (
            <div key={i} className="log-info">
              {l.text}
            </div>
          ) : l.kind === 'error' ? (
            <div key={i} className="log-error">
              {l.text}
            </div>
          ) : (
            <Markdown key={i} text={l.text} />
          ),
        )}
        {op.status === 'running' && (
          <div className="log-info" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="dot run" /> {op.last ? `En cours : ${op.last.slice(0, 80)}` : 'Claude travaille…'}
          </div>
        )}
        {op.kind !== 'claude' && op.result && <div className="result mono">{op.result}</div>}
        {op.kind === 'claude' && op.status === 'error' && op.result && <div className="result log-error">{op.result}</div>}
        <div ref={end} />
      </div>
    </Sheet>
  );
}
