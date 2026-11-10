import { useEffect, useState } from 'react';
import { api, refreshState } from '../api';
import { nav } from '../nav';
import { setPref, usePrefs } from '../speech';
import { Item, Section, Sheet, Switch, useAsync } from '../ui/kit';

// ---------- Préférences de cet appareil ----------

export function PrefsSection() {
  const p = usePrefs();
  return (
    <Section title="Affichage et voix">
      <div className="list">
        <Item
          title="Thème"
          end={
            <div className="seg" style={{ width: 210 }} role="group" aria-label="Thème">
              {(['auto', 'light', 'dark'] as const).map((t) => (
                <button key={t} aria-pressed={p.theme === t} onClick={() => setPref('theme', t)}>
                  {t === 'auto' ? 'Auto' : t === 'light' ? 'Clair' : 'Sombre'}
                </button>
              ))}
            </div>
          }
        />
        <Item
          title="Envoi automatique"
          sub="Demande courte et claire : part vers Claude après 3 s, annulable"
          end={<Switch label="Envoi automatique" on={p.autoSend} onChange={(v) => setPref('autoSend', v)} />}
        />
        <Item
          title="Transcription en direct"
          sub="Le texte s'écrit pendant que tu parles (environ 0,8 centime la minute)"
          end={<Switch label="Transcription en direct" on={p.live} onChange={(v) => setPref('live', v)} />}
        />
        <Item
          title="Lire les résultats à voix haute"
          sub="Quand Claude termine, l'iPhone lit le résumé"
          end={<Switch label="Lecture à voix haute" on={p.speak} onChange={(v) => setPref('speak', v)} />}
        />
        <Item
          title="Icône sur l'écran d'accueil"
          sub="Prise en compte au prochain ajout à l'écran d'accueil"
          end={
            <div className="icon-pick">
              {(['dark', 'light'] as const).map((i) => (
                <button key={i} aria-pressed={p.icon === i} onClick={() => setPref('icon', i)} aria-label={i === 'dark' ? 'Icône sombre' : 'Icône claire'}>
                  <img src={i === 'dark' ? '/apple-touch-icon.png' : '/apple-touch-icon-light.png'} alt="" />
                </button>
              ))}
            </div>
          }
        />
      </div>
    </Section>
  );
}

// ---------- Mise à jour ----------

export function UpdateSection() {
  const [info, setInfo] = useState<{ current: string; behind: number; latest: string | null } | null>(null);
  const { busy, error, run } = useAsync();
  const check = () => run(() => api('/api/update/check').then(setInfo));
  const n = info?.behind ?? 0;
  return (
    <Section title="Mise à jour">
      <div className="list">
        <Item
          icon="download"
          title={info ? (n ? `${n} nouveauté${n > 1 ? 's' : ''} disponible${n > 1 ? 's' : ''}` : 'VoxControl est à jour') : 'Vérifier les mises à jour'}
          sub={info?.latest ?? (info ? `Version ${info.current}` : undefined)}
          end={
            n ? (
              <button
                className="btn sm ink"
                onClick={() =>
                  nav.open({
                    kind: 'confirm',
                    action: 'app.update',
                    label: 'Mettre à jour VoxControl',
                    detail: "Le PC récupère la nouvelle version, la reconstruit (1 à 3 minutes) puis redémarre l'agent. L'app se reconnecte seule.",
                    run: (t) => api('/api/update', { method: 'POST', stepUp: t }),
                  })
                }
              >
                Mettre à jour
              </button>
            ) : (
              <button className="btn sm ghost" disabled={busy} onClick={check}>
                {busy ? 'Vérification…' : 'Vérifier'}
              </button>
            )
          }
        />
      </div>
      {error && <p className="error">{error}</p>}
    </Section>
  );
}

// ---------- Dossiers, applications et scripts ----------

type AppRow = { id: string; name: string; command: string };
type ScriptRow = { id: string; name: string; path: string };

export function SecuritySheet({ level, docked }: { level: number; docked: boolean }) {
  const [folders, setFolders] = useState<string[] | null>(null);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [scripts, setScripts] = useState<ScriptRow[]>([]);
  const [newFolder, setNewFolder] = useState('');
  const [newApp, setNewApp] = useState('');
  const [newScript, setNewScript] = useState('');

  useEffect(() => {
    api('/api/settings/security').then((r) => {
      setFolders(r.allowedFolders);
      setApps(r.appsFull);
      setScripts(r.scriptsFull);
    });
  }, []);

  const save = () =>
    nav.open({
      kind: 'confirm',
      action: 'settings.security',
      label: 'Enregistrer les accès',
      detail: 'Ces listes décident de ce que le téléphone peut voir et lancer sur le PC.',
      run: (t) =>
        api('/api/settings/security', { body: { allowedFolders: folders, apps, scripts }, stepUp: t }).then(() => {
          refreshState();
          nav.close();
        }),
    });

  if (!folders) return null;
  const base = (p: string) => p.split(/[\\/]/).pop() ?? p;
  const remove = (onClick: () => void) => (
    <button className="btn sm ghost" onClick={onClick}>
      Retirer
    </button>
  );
  return (
    <Sheet
      title="Accès au PC"
      level={level}
      docked={docked}
      full
      foot={
        <button className="btn primary block" onClick={save}>
          Enregistrer
        </button>
      }
    >
      <Section title="Dossiers visibles depuis le téléphone">
        <div className="list">
          {folders.map((f) => (
            <Item key={f} icon="folder" title={base(f)} sub={f} end={remove(() => setFolders(folders.filter((x) => x !== f)))} />
          ))}
        </div>
        <AddRow placeholder={'C:\\Users\\…\\MonDossier'} value={newFolder} onChange={setNewFolder} onAdd={() => (setFolders([...folders, newFolder.trim()]), setNewFolder(''))} />
      </Section>
      <Section title="Applications que le téléphone peut ouvrir">
        <div className="list">
          {apps.map((a) => (
            <Item key={a.id} icon="window" title={a.name} sub={a.command} end={remove(() => setApps(apps.filter((x) => x.id !== a.id)))} />
          ))}
        </div>
        <AddRow
          placeholder={'C:\\Program Files\\…\\programme.exe'}
          value={newApp}
          onChange={setNewApp}
          onAdd={() => (setApps([...apps, { id: '', name: base(newApp).replace(/\.exe$/i, ''), command: newApp.trim() }]), setNewApp(''))}
        />
      </Section>
      <Section title="Scripts autorisés">
        <div className="list">
          {scripts.length === 0 && <Item title="Aucun script" />}
          {scripts.map((s) => (
            <Item key={s.id} icon="play" title={s.name} sub={s.path} end={remove(() => setScripts(scripts.filter((x) => x.id !== s.id)))} />
          ))}
        </div>
        <AddRow
          placeholder={'C:\\…\\script.ps1'}
          value={newScript}
          onChange={setNewScript}
          onAdd={() => (setScripts([...scripts, { id: '', name: base(newScript), path: newScript.trim() }]), setNewScript(''))}
        />
        <p className="help">Formats acceptés : .ps1, .bat, .cmd. Chaque lancement demande Face ID.</p>
      </Section>
    </Sheet>
  );
}

function AddRow({ placeholder, value, onChange, onAdd }: { placeholder: string; value: string; onChange: (v: string) => void; onAdd: () => void }) {
  return (
    <div className="add-row">
      <input className="input mono" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <button className="btn sm ink" disabled={!value.trim()} onClick={onAdd}>
        Ajouter
      </button>
    </div>
  );
}
