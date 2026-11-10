import { useEffect, useState } from 'react';
import { api, patchState, refreshState, useStore } from '../api';
import { ago, copy } from '../format';
import { nav, toast } from '../nav';
import type { Project, Session } from '../types';
import { Icon } from '../ui/Icon';
import { Item, Section, Sheet, useAsync } from '../ui/kit';

type P = { level: number; docked: boolean };

export function ProjectsSheet({ level, docked }: P) {
  const st = useStore((s) => s.state);
  const [editing, setEditing] = useState<Project | null>(null);
  const [adding, setAdding] = useState(false);
  if (!st) return null;
  const choose = (id: string) => {
    patchState({ config: { ...st.config, activeProjectId: id } });
    api('/api/settings', { body: { activeProjectId: id } }).catch(() => {});
    nav.close();
  };
  return (
    <Sheet title="Projets" level={level} docked={docked} full>
      <p className="soft" style={{ marginTop: 0 }}>Le dossier dans lequel Claude Code travaille.</p>
      {(adding || editing) && <ProjectForm initial={editing} onDone={() => (setAdding(false), setEditing(null))} />}
      {st.config.projects.length > 0 && (
        <div className="list">
          {st.config.projects.map((p) => (
            <Item
              key={p.id}
              icon={p.id === st.config.activeProjectId ? 'check' : 'folder'}
              title={p.name}
              sub={p.path}
              onClick={() => choose(p.id)}
              end={
                <button className="btn sm ghost" onClick={(e) => (e.stopPropagation(), setEditing(p))}>
                  Modifier
                </button>
              }
            />
          ))}
        </div>
      )}
      {!adding && !editing && (
        <button className="btn block" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
          <Icon name="plus" size={18} /> Ajouter un dossier
        </button>
      )}
    </Sheet>
  );
}

export function SessionsSheet({ level, docked }: P) {
  const st = useStore((s) => s.state);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  useEffect(() => {
    api<Session[]>('/api/claude/sessions').then(setSessions).catch(() => setSessions([]));
  }, []);
  if (!st) return null;
  const resume = (s: Session) => {
    const proj = st.config.projects.find((p) => samePath(p.path, s.cwd));
    if (!proj) {
      toast('Ajoute d’abord ce dossier dans Projets.', 'error');
      nav.replace({ kind: 'projects' });
      return;
    }
    nav.setFollowUp({ sessionId: s.id, title: s.title, projectId: proj.id });
    patchState({ config: { ...st.config, activeProjectId: proj.id } });
    api('/api/settings', { body: { activeProjectId: proj.id } }).catch(() => {});
    nav.setTab('talk');
    toast('Ta prochaine demande continuera cette session');
  };
  return (
    <Sheet title="Reprendre une session" level={level} docked={docked} full>
      <div className="list">
        {sessions === null && <Item title="Chargement…" />}
        {sessions?.length === 0 && <Item title="Aucune session" />}
        {sessions?.slice(0, 20).map((s) => (
          <Item
            key={s.id}
            icon="terminal"
            title={s.title}
            sub={`${s.cwd.split(/[\\/]/).pop() || s.cwd} · ${ago(s.lastModified)}`}
            end={s.busy ? <span className="tag wait">en cours</span> : undefined}
            chevron={!s.busy}
            onClick={s.busy ? undefined : () => resume(s)}
          />
        ))}
      </div>
      <Section title="Taper dans le terminal ouvert">
        <p className="soft" style={{ marginTop: 0 }}>
          Pour écrire directement dans la session du terminal : lance <span className="mono">claude rc</span> sur le PC, puis ouvre claude.ai/code dans Safari avec le compte du PC.
        </p>
        <button className="btn sm" onClick={() => copy('claude rc').then(() => toast('Commande copiée', 'ok'))}>
          <Icon name="copy" size={18} /> Copier la commande
        </button>
      </Section>
    </Sheet>
  );
}

const samePath = (a: string, b: string) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();

function ProjectForm({ initial, onDone }: { initial: Project | null; onDone: () => void }) {
  const st = useStore((s) => s.state)!;
  const exists = initial && st.config.projects.some((p) => p.id === initial.id);
  const [name, setName] = useState(initial?.name ?? '');
  const [path, setPath] = useState(initial?.path ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const { busy, error, run } = useAsync();

  const save = () =>
    run(async () => {
      const id = initial?.id ?? crypto.randomUUID();
      const list = exists ? st.config.projects.map((p) => (p.id === id ? { id, name, path, notes } : p)) : [...st.config.projects, { id, name: name || path.split(/[\\/]/).pop() || 'Projet', path, notes }];
      await api('/api/settings', { body: { projects: list, activeProjectId: st.config.activeProjectId ?? id } });
      await refreshState();
      onDone();
    });

  const remove = () =>
    run(async () => {
      await api('/api/settings', { body: { projects: st.config.projects.filter((p) => p.id !== initial!.id), activeProjectId: st.config.activeProjectId === initial!.id ? null : st.config.activeProjectId } });
      await refreshState();
      onDone();
    });

  return (
    <div className="list" style={{ padding: 12, marginBottom: 10 }}>
      <label className="label" style={{ marginTop: 0 }}>
        Dossier sur le PC
      </label>
      <input className="input mono" value={path} placeholder="C:\Users\…\MonProjet" onChange={(e) => setPath(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <label className="label">Nom</label>
      <input className="input" value={name} placeholder="Mon projet" onChange={(e) => setName(e.target.value)} />
      <label className="label">Consignes permanentes (facultatif)</label>
      <textarea className="textarea" rows={3} style={{ minHeight: 70 }} value={notes} placeholder="Ex. : toujours lancer les tests après une modification." onChange={(e) => setNotes(e.target.value)} />
      <p className="help">Ajoutées au contexte quand tu utilises Affiner.</p>
      {error && <p className="error">{error}</p>}
      <div className="btns" style={{ marginTop: 12 }}>
        {exists && (
          <button className="btn sm ghost" onClick={remove} disabled={busy}>
            Retirer
          </button>
        )}
        <button className="btn sm" onClick={onDone}>
          Annuler
        </button>
        <button className="btn sm ink" disabled={busy || !path.trim()} onClick={save}>
          Enregistrer
        </button>
      </div>
    </div>
  );
}
