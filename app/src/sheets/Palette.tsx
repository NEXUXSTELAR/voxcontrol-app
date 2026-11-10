import { useMemo, useRef, useState } from 'react';
import { api, patchState, store, useStore } from '../api';
import { runAction } from '../actions';
import { openDraftFromText } from '../shared';
import { nav, toast } from '../nav';
import { Icon, type IconName } from '../ui/Icon';
import { Sheet } from '../ui/kit';

type Cmd = { id: string; group: string; title: string; sub?: string; icon: IconName; keywords?: string; run: () => void };

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function PaletteSheet({ level, docked }: { level: number; docked: boolean }) {
  const st = useStore((s) => s.state);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const cmds = useMemo<Cmd[]>(() => {
    if (!st) return [];
    const go = (fn: () => void) => () => {
      nav.close();
      fn();
    };
    const active = st.config.projects.find((p) => p.id === st.config.activeProjectId);
    const shot = async () => {
      try {
        const blob = await api<Blob>('/api/pc/screenshot');
        nav.replace({ kind: 'screenshot', url: URL.createObjectURL(blob) });
      } catch (e: any) {
        toast(e.message, 'error');
      }
    };
    const list: Cmd[] = [
      { id: 'shot', group: 'Rapide', title: 'Voir l’écran du PC', icon: 'camera', keywords: 'capture screenshot', run: shot },
      { id: 'lock', group: 'Rapide', title: 'Verrouiller le PC', icon: 'lock', run: go(() => runAction('pc.lock')) },
      ...(active ? [{ id: 'proj-folder', group: 'Rapide', title: `Ouvrir le dossier ${active.name}`, icon: 'folder' as IconName, run: go(() => runAction('folder.open', active.path, { label: `Ouvrir ${active.name}` })) }] : []),
      { id: 'sessions', group: 'Rapide', title: 'Reprendre une session Claude', icon: 'history', keywords: 'continuer claude', run: () => nav.replace({ kind: 'sessions' }) },
      { id: 'files', group: 'Rapide', title: 'Fichiers du PC', icon: 'folder', keywords: 'telecharger envoyer', run: () => (nav.close(), nav.setTab('pc')) },
      ...st.config.apps.map<Cmd>((a) => ({ id: `app-${a.id}`, group: 'Applications', title: a.name, icon: 'window', keywords: 'ouvrir lancer application', run: go(() => runAction('app.open', a.id, { label: `Ouvrir ${a.name}` })) })),
      { id: 'sleep', group: 'Alimentation', title: 'Mettre en veille', icon: 'moon', run: go(() => runAction('pc.sleep')) },
      { id: 'restart', group: 'Alimentation', title: 'Redémarrer le PC', icon: 'restart', run: go(() => runAction('pc.restart')) },
      { id: 'shutdown', group: 'Alimentation', title: 'Arrêter le PC', icon: 'power', keywords: 'eteindre', run: go(() => runAction('pc.shutdown')) },
      { id: 'cancel', group: 'Alimentation', title: 'Annuler l’arrêt prévu', icon: 'close', run: go(() => runAction('pc.cancel')) },
      ...st.config.projects.map<Cmd>((p) => ({
        id: `proj-${p.id}`,
        group: 'Projet actif',
        title: p.name,
        sub: p.id === st.config.activeProjectId ? 'Actif' : p.path,
        icon: p.id === st.config.activeProjectId ? 'check' : 'terminal',
        run: go(() => {
          patchState({ config: { ...st.config, activeProjectId: p.id } });
          api('/api/settings', { body: { activeProjectId: p.id } }).catch(() => {});
          toast(`Projet actif : ${p.name}`);
        }),
      })),
      ...st.prompts.map<Cmd>((p) => ({ id: `pr-${p.id}`, group: 'Prompts enregistrés', title: p.title, sub: p.body.slice(0, 80), icon: 'note', keywords: p.body, run: go(() => openDraftFromText(p.body)) })),
      { id: 'set-keys', group: 'Réglages', title: 'Connexions et clés', icon: 'key', keywords: 'mistral openai gemini api', run: () => nav.replace({ kind: 'settings', section: 'ai' }) },
      { id: 'set-device', group: 'Réglages', title: 'Face ID et notifications', icon: 'shield', run: () => nav.replace({ kind: 'settings', section: 'device' }) },
      { id: 'set-all', group: 'Réglages', title: 'Tous les réglages', icon: 'gear', run: () => nav.replace({ kind: 'settings' }) },
    ];
    return list;
  }, [st]);

  const query = norm(q.trim());
  const filtered = query ? cmds.filter((c) => norm(`${c.title} ${c.sub ?? ''} ${c.keywords ?? ''} ${c.group}`).includes(query)) : cmds;
  const extra: Cmd[] = q.trim().length > 3
    ? [
        { id: 'send', group: 'Avec ce texte', title: `Préparer « ${q.trim().slice(0, 40)} »`, icon: 'send', run: () => (nav.close(), openDraftFromText(q.trim())) },
        {
          id: 'save',
          group: 'Avec ce texte',
          title: 'Enregistrer comme prompt',
          icon: 'plus',
          run: () =>
            api('/api/prompts', { body: { title: q.trim().slice(0, 60), body: q.trim() } })
              .then((prompts) => {
                const s = store.get().state;
                if (s) patchState({ prompts });
                toast('Prompt enregistré', 'ok');
                setQ('');
              })
              .catch((e) => toast(e.message, 'error')),
        },
      ]
    : [];
  const all = [...filtered, ...extra];
  const groups = [...new Set(all.map((c) => c.group))];

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(all.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      all[sel]?.run();
    }
  };

  let i = -1;
  return (
    <Sheet title="Actions" level={level} docked={docked} full>
      <div className="palette-search" style={{ margin: '0 0 8px' }}>
        <Icon name="search" size={18} />
        <input
          autoFocus={!('ontouchstart' in window)}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKey}
          placeholder="Chercher ou écrire une demande"
          aria-label="Chercher une action"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
        />
      </div>
      <div ref={listRef} id="palette-list" role="listbox">
        {groups.map((g) => (
          <div key={g} className="sec" style={{ marginTop: 12 }}>
            <h3>{g}</h3>
            <div className="list">
              {all
                .filter((c) => c.group === g)
                .map((c) => {
                  i++;
                  const idx = i;
                  return (
                    <button key={c.id} className="item pal-item" role="option" aria-selected={idx === sel} onClick={c.run} onMouseEnter={() => setSel(idx)}>
                      <span className="lead">
                        <Icon name={c.icon} />
                      </span>
                      <span className="main">
                        <div className="t">{c.title}</div>
                        {c.sub && <div className="s">{c.sub}</div>}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
        {all.length === 0 && <p className="soft">Aucune action. Écris une phrase plus longue pour la préparer comme demande.</p>}
      </div>
    </Sheet>
  );
}
