import { useEffect, useRef, useState } from 'react';
import { api, type ApiError, useStore } from '../api';
import { performStepUp, prepareStepUp, runAction } from '../actions';
import { ago, bytes } from '../format';
import { nav, toast } from '../nav';
import { Icon } from '../ui/Icon';
import { Item, Section, Sheet } from '../ui/kit';

type P = { level: number; docked: boolean };
type Win = { pid: number; name: string; title: string };
type Entry = { name: string; path: string; dir: boolean; size: number; mtime: number };

export function AppsSheet({ level, docked }: P) {
  const st = useStore((s) => s.state);
  const [wins, setWins] = useState<Win[] | null>(null);
  useEffect(() => {
    api<Win[]>('/api/pc/windows').then(setWins).catch(() => setWins([]));
  }, []);

  const close = (w: Win) =>
    nav.open({
      kind: 'confirm',
      action: 'app.close',
      label: `Fermer « ${w.title.slice(0, 40)} »`,
      detail: 'Windows demandera d’enregistrer si un document n’est pas sauvegardé.',
      run: (t) => api('/api/action', { body: { action: 'app.close', arg: String(w.pid) }, stepUp: t }).then(() => setWins((x) => x?.filter((y) => y.pid !== w.pid) ?? null)),
    });

  return (
    <Sheet title="Applications" level={level} docked={docked} full>
      <Section title="Ouvrir">
        <div className="list">
          {st?.config.apps.map((a) => (
            <Item key={a.id} icon="window" title={a.name} chevron onClick={() => runAction('app.open', a.id, { label: `Ouvrir ${a.name}` })} />
          ))}
        </div>
      </Section>
      <Section title="Fenêtres ouvertes">
        <div className="list">
          {wins === null && <Item title="Chargement…" />}
          {wins?.length === 0 && <Item title="Aucune fenêtre" />}
          {wins?.map((w) => (
            <Item
              key={w.pid}
              title={w.title}
              sub={w.name}
              end={
                <button className="btn sm ghost" onClick={() => close(w)}>
                  Fermer
                </button>
              }
            />
          ))}
        </div>
      </Section>
    </Sheet>
  );
}

export function PowerSheet({ level, docked }: P) {
  return (
    <Sheet title="Alimentation" level={level} docked={docked}>
      <div className="list">
        <Item icon="moon" title="Mettre en veille" chevron onClick={() => runAction('pc.sleep')} />
        <Item icon="restart" title="Redémarrer" sub="Dans 60 secondes, annulable" chevron onClick={() => runAction('pc.restart')} />
        <Item icon="power" title="Arrêter" sub="Impossible de le rallumer à distance" chevron danger onClick={() => runAction('pc.shutdown')} />
        <Item icon="close" title="Annuler un arrêt prévu" chevron onClick={() => runAction('pc.cancel')} />
      </div>
    </Sheet>
  );
}

export function FilesSheet({ level, docked }: P) {
  const st = useStore((s) => s.state);
  const [dir, setDir] = useState<string | null>(null);
  const [data, setData] = useState<{ path: string | null; parent?: string | null; entries: Entry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [uploadOptions, setUploadOptions] = useState<any>(null);

  const load = (p: string | null) => {
    setError(null);
    api(`/api/files${p ? `?path=${encodeURIComponent(p)}` : ''}`)
      .then((d) => {
        setData(d);
        setDir(p);
      })
      .catch((e: ApiError) => setError(e.message));
  };
  useEffect(() => load(null), []);
  useEffect(() => {
    if (dir && st?.caller.kind === 'device' && st.caller.passkey) prepareStepUp('file.upload').then(setUploadOptions).catch(() => {});
  }, [dir]);

  const download = async (e: Entry) => {
    try {
      const blob = await api<Blob>(`/api/files/download?path=${encodeURIComponent(e.path)}`);
      const file = new File([blob], e.name, { type: blob.type || 'application/octet-stream' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
      else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = e.name;
        a.click();
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') toast(err.message, 'error');
    }
  };

  const upload = async (f: File) => {
    if (!dir) return;
    try {
      let token: string | undefined;
      if (st?.caller.kind === 'device') {
        if (!uploadOptions) throw new Error('Active Face ID dans Réglages pour envoyer des fichiers.');
        token = await performStepUp(uploadOptions);
      }
      const form = new FormData();
      form.append('dir', dir);
      form.append('file', f, f.name);
      await api('/api/files/upload', { form, stepUp: token });
      toast(`${f.name} envoyé`, 'ok');
      load(dir);
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  return (
    <Sheet
      title={dir ? dir.split(/[\\/]/).pop() : 'Fichiers'}
      level={level}
      docked={docked}
      full
      foot={
        dir ? (
          <div className="btns">
            <button className="btn" onClick={() => runAction('folder.open', dir, { label: 'Ouvrir sur le PC' })}>
              Ouvrir sur le PC
            </button>
            <button className="btn ink" onClick={() => input.current?.click()}>
              <Icon name="upload" size={18} /> Envoyer ici
            </button>
          </div>
        ) : undefined
      }
    >
      <input ref={input} type="file" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <div className="list">
        {dir && <Item icon="chevronLeft" title="Retour" onClick={() => load(data?.parent ?? null)} />}
        {data?.entries.length === 0 && <Item title="Dossier vide" />}
        {data?.entries.slice(0, 100).map((e) => (
          <Item
            key={e.path}
            icon={e.dir ? 'folder' : 'file'}
            title={e.name}
            sub={e.dir ? undefined : `${bytes(e.size)} · ${ago(e.mtime)}`}
            chevron={e.dir}
            end={!e.dir ? <Icon name="download" size={18} /> : undefined}
            onClick={() => (e.dir ? load(e.path) : download(e))}
          />
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {!dir && <p className="help">Seuls tes dossiers autorisés sont visibles.</p>}
    </Sheet>
  );
}

export function ScreenshotSheet({ url, level, docked }: P & { url: string }) {
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <Sheet title="Écran du PC" level={level} docked={docked} full foot={<a className="btn block" href={url} download="ecran.png">Enregistrer l'image</a>}>
      <img className="shot" src={url} alt="Capture de l'écran du PC" />
    </Sheet>
  );
}
