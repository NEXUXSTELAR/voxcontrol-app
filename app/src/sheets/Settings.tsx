import { useEffect, useState } from 'react';
import { api, patchState, refreshState, saveToken, useStore } from '../api';
import { enablePush, performRegistration, prepareRegistration, pushEnabled } from '../actions';
import { ago, isIOS, isStandalone, usd } from '../format';
import { nav, toast } from '../nav';
import type { ProviderId } from '../types';
import { Icon } from '../ui/Icon';
import { Item, Section, Sheet, Switch, useAsync } from '../ui/kit';
import { PrefsSection, UpdateSection } from './SettingsExtra';

export function SettingsSheet({ level, docked, section }: { level: number; docked: boolean; section?: string }) {
  const st = useStore((s) => s.state);
  const hello = useStore((s) => s.hello);
  const [audit, setAudit] = useState<any[] | null>(null);
  useEffect(() => {
    if (section) document.getElementById(`set-${section}`)?.scrollIntoView({ block: 'start' });
  }, [section]);
  if (!st) return null;
  const device = st.caller.kind === 'device' ? st.caller : null;
  const spendTotal = st.spend.reduce((s, r) => s + r.usd, 0);

  const save = (body: any) =>
    api('/api/settings', { body })
      .then((config) => patchState({ config }))
      .catch((e) => toast(e.message, 'error'));

  return (
    <Sheet title="Réglages" level={level} docked={docked} full>
      <div id="set-ai" />
      <Section title="Connexions">
        <div className="list">
          {st.providers.map((p) => (
            <Item
              key={p.id}
              icon="key"
              title={p.name}
              sub={p.keyHint ? `${p.id === 'mistral' ? 'Dictée et Affiner' : 'Deuxième avis'} · clé ${p.keyHint}` : p.id === 'mistral' ? 'Recommandé : dictée et Affiner' : 'Facultatif : deuxième avis'}
              end={<span className={`dot ${p.keyHint && p.enabled ? 'on' : 'off'}`} />}
              chevron
              onClick={() => nav.open({ kind: 'provider', id: p.id })}
            />
          ))}
          <Item icon="terminal" title="Claude Code" sub={st.claude.installed ? 'Compte du PC' : 'Introuvable sur le PC'} end={<span className={`dot ${st.claude.installed ? 'on' : 'err'}`} />} />
          <Item icon="network" title="Tailscale" sub={st.tailscale.dnsName ?? (st.tailscale.installed ? 'Non connecté' : 'Non installé')} end={<span className={`dot ${st.tailscale.online ? 'on' : 'off'}`} />} />
          <Item icon="remote" title="Bureau à distance" sub={st.rdp ? 'Activé, joignable via Tailscale' : 'Désactivé'} end={<span className={`dot ${st.rdp ? 'on' : 'off'}`} />} />
        </div>
      </Section>

      <Section title="Affiner">
        <div className="list">
          <Item
            title="IA qui rédige"
            end={
              <select className="select" style={{ width: 'auto', padding: '6px 8px' }} value={st.config.refiner} onChange={(e) => save({ refiner: e.target.value })} aria-label="IA qui rédige">
                {st.providers
                  .filter((p) => p.keyHint)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                {!st.providers.some((p) => p.keyHint) && <option value="mistral">Mistral</option>}
              </select>
            }
          />
          <Item title="Lire le dossier du projet" sub="Arborescence, README et CLAUDE.md. Jamais les fichiers .env." end={<Switch label="Lire le dossier du projet" on={st.config.readProjectContext} onChange={(v) => save({ readProjectContext: v })} />} />
        </div>
      </Section>

      <PrefsSection />
      <div id="set-device" />
      {device && <DeviceSection passkey={device.passkey} />}

      <Section title="Appareils" aside={hello?.local ? <button className="soft" onClick={() => nav.open({ kind: 'pair' })}>Appairer</button> : undefined}>
        <div className="list">
          {st.devices.filter((d) => !d.revoked).length === 0 && <Item title="Aucun téléphone appairé" sub={hello?.local ? 'Touche « Appairer » pour afficher un code.' : undefined} />}
          {st.devices
            .filter((d) => !d.revoked)
            .map((d) => (
              <Item
                key={d.id}
                icon="shield"
                title={`${d.name}${device?.id === d.id ? ' (cet appareil)' : ''}`}
                sub={`${d.passkey ? 'Face ID actif' : 'Sans Face ID'} · vu ${d.lastSeen ? ago(d.lastSeen) : 'jamais'}`}
                end={
                  <button
                    className="btn sm ghost"
                    onClick={() =>
                      nav.open({
                        kind: 'confirm',
                        action: 'device.revoke',
                        label: `Révoquer ${d.name}`,
                        detail: 'Cet appareil ne pourra plus rien faire. Il faudra l’appairer de nouveau.',
                        run: (t) =>
                          api(`/api/devices/${d.id}/revoke`, { method: 'POST', stepUp: device?.id === d.id ? undefined : t }).then(() => {
                            if (device?.id === d.id) {
                              saveToken(null);
                              location.reload();
                            } else refreshState();
                          }),
                      })
                    }
                  >
                    Révoquer
                  </button>
                }
              />
            ))}
        </div>
      </Section>

      <Section title="Sécurité">
        <div className="list">
          {Object.entries(st.levels)
            .filter(([, v]) => v.level === 3)
            .map(([k, v]) => {
              const on = st.config.enabledDangerous.includes(k);
              return (
                <Item
                  key={k}
                  icon="alert"
                  title={v.label}
                  sub={on ? 'Autorisé, avec Face ID à chaque fois' : 'Interdit par défaut'}
                  end={
                    <Switch
                      label={v.label}
                      on={on}
                      onChange={(val) =>
                        val
                          ? nav.open({
                              kind: 'confirm',
                              action: 'danger.enable',
                              label: `Autoriser : ${v.label}`,
                              run: (t) => api('/api/settings/danger', { body: { action: k }, stepUp: t }).then((config) => patchState({ config })),
                            })
                          : save({ disableDangerous: [k] })
                      }
                    />
                  }
                />
              );
            })}
          <Item
            icon="folder"
            title="Dossiers, applications et scripts"
            sub={st.config.allowedFolders.map((f) => f.split(/[\\/]/).pop()).join(', ')}
            chevron
            onClick={() => nav.open({ kind: 'security' })}
          />
        </div>
      </Section>

      <Section title="Dépenses ce mois-ci" aside={<span className="faint">{usd(spendTotal)}</span>}>
        <div className="list">
          {st.spend.length === 0 && <Item title="Rien pour l'instant" />}
          {st.spend.map((s) => (
            <Item key={s.provider} title={st.providers.find((p) => p.id === s.provider)?.name ?? s.provider} end={usd(s.usd)} />
          ))}
          <Item
            title="Plafond mensuel"
            sub="Au-delà, VoxControl n'appelle plus les IA."
            end={
              <input
                className="input"
                style={{ width: 84, textAlign: 'right', padding: '6px 8px' }}
                inputMode="decimal"
                defaultValue={String(st.config.monthlyCapUsd).replace('.', ',')}
                aria-label="Plafond mensuel en dollars"
                onBlur={(e) => {
                  const v = Number(e.target.value.replace(',', '.'));
                  if (!Number.isNaN(v) && v >= 0) save({ monthlyCapUsd: v });
                }}
              />
            }
          />
        </div>
        <p className="help">Estimation à partir des tarifs publics. Claude Code utilise ton abonnement : il n'apparaît pas ici.</p>
      </Section>

      <UpdateSection />

      <Section title="Journal et données">
        <div className="list" style={{ marginBottom: 8 }}>
          <Item icon="search" title="Toutes les actions" sub="Recherche rapide (Ctrl + K sur le PC)" chevron onClick={() => nav.open({ kind: 'palette' })} />
        </div>
        <div className="list">
          <Item icon="history" title="Journal des actions" chevron onClick={() => api('/api/audit').then(setAudit)} />
          <Item
            icon="trash"
            title="Effacer l'historique du fil"
            sub="Les tâches en cours sont gardées."
            onClick={() =>
              api('/api/action', { body: { action: 'ops.clear' } })
                .then(() => toast('Historique effacé', 'ok'))
                .catch((e) => toast(e.message, 'error'))
            }
          />
        </div>
        {audit && (
          <div className="list" style={{ marginTop: 8, maxHeight: 300, overflow: 'auto' }}>
            {audit.map((a, i) => (
              <Item key={i} title={`${st.levels[a.action]?.label ?? a.action} · ${a.outcome}`} sub={`${ago(a.at)}${a.detail ? ` · ${a.detail}` : ''}`} />
            ))}
          </div>
        )}
      </Section>

      <p className="help" style={{ textAlign: 'center', margin: '24px 0 8px' }}>
        VoxControl {st.version} · {st.config.pcName}
      </p>
    </Sheet>
  );
}

function DeviceSection({ passkey }: { passkey: boolean }) {
  const [reg, setReg] = useState<any>(null);
  const [push, setPush] = useState<boolean | null>(null);
  const { busy, error, run } = useAsync();
  useEffect(() => {
    if (!passkey) prepareRegistration().then(setReg).catch(() => {});
    pushEnabled().then(setPush);
  }, [passkey]);

  return (
    <Section title="Cet appareil">
      <div className="list">
        <Item
          icon="shield"
          title="Face ID pour les actions sensibles"
          sub={passkey ? 'Actif' : 'Requis pour redémarrer, arrêter, envoyer un fichier…'}
          end={
            passkey ? (
              <Icon name="check" />
            ) : (
              <button className="btn sm ink" disabled={busy || !reg} onClick={() => run(() => performRegistration(reg).then(() => toast('Face ID activé', 'ok')))}>
                Activer
              </button>
            )
          }
        />
        <Item
          icon="bell"
          title="Notifications"
          sub={isIOS && !isStandalone ? 'Ajoute d’abord VoxControl à l’écran d’accueil.' : push ? 'Actives' : 'Fin de tâche, accord demandé, erreur'}
          end={
            push ? (
              <button className="btn sm ghost" onClick={() => api('/api/push/test', { method: 'POST' })}>
                Tester
              </button>
            ) : (
              <button className="btn sm ink" disabled={busy} onClick={() => run(() => enablePush().then(() => (setPush(true), toast('Notifications activées', 'ok'))))}>
                Activer
              </button>
            )
          }
        />
      </div>
      {error && <p className="error">{error}</p>}
    </Section>
  );
}

// ---------- Fournisseur d'IA ----------

export function ProviderSheet({ id, level, docked }: { id: ProviderId; level: number; docked: boolean }) {
  const p = useStore((s) => s.state?.providers.find((x) => x.id === id));
  const st = useStore((s) => s.state);
  const [key, setKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const { busy, error, run } = useAsync();
  if (!p || !st) return null;

  const saveKey = () =>
    run(async () => {
      const r = await api<{ models: string[]; providers: any }>(`/api/keys/${id}`, { body: { key } });
      setKey('');
      setModels(r.models);
      await refreshState();
      toast(`${p.name} connecté`, 'ok');
    });

  const test = () =>
    run(async () => {
      const r = await api<{ models: string[] }>(`/api/keys/${id}/test`, { method: 'POST' });
      setModels(r.models);
      await refreshState();
      toast('Connexion vérifiée', 'ok');
    });

  const setProvider = (patch: any) =>
    api('/api/settings', { body: { providers: { [id]: patch } } })
      .then(() => refreshState())
      .catch((e) => toast(e.message, 'error'));

  return (
    <Sheet title={p.name} level={level} docked={docked} full>
      <div className="route-line" style={{ marginTop: 0 }}>
        <span className={`dot ${p.keyHint ? 'on' : 'off'}`} />
        <span>{p.keyHint ? `Connecté · clé ${p.keyHint}` : 'Pas encore connecté'}</span>
      </div>

      {!p.keyHint && (
        <Section title="Créer la clé">
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            <li>
              Ouvre la page officielle :{' '}
              <a href={p.keyUrl} target="_blank" rel="noreferrer" style={{ color: 'inherit', fontWeight: 600 }}>
                {p.keyUrl.replace('https://', '')}
              </a>
            </li>
            <li style={{ marginTop: 6 }}>{p.help}</li>
            <li style={{ marginTop: 6 }}>Colle la clé ci-dessous. Elle part directement dans le coffre de Windows sur ton PC.</li>
          </ol>
        </Section>
      )}

      <Section title={p.keyHint ? 'Remplacer la clé' : 'Ta clé'}>
        <input
          className="input mono"
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Colle la clé ici"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          aria-label={`Clé ${p.name}`}
        />
        <div className="btns" style={{ marginTop: 10 }}>
          {p.keyHint && (
            <button className="btn" disabled={busy} onClick={test}>
              Tester
            </button>
          )}
          <button className="btn ink" style={{ flex: 2 }} disabled={busy || key.trim().length < 16} onClick={saveKey}>
            {busy ? 'Vérification…' : 'Enregistrer et tester'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        <p className="help">La clé n'est jamais renvoyée au téléphone ni écrite dans les journaux.</p>
      </Section>

      {p.keyHint && (
        <Section title="Utilisation">
          <div className="list">
            <Item title="Activé" end={<Switch label="Activé" on={p.enabled} onChange={(v) => setProvider({ enabled: v })} />} />
            {id !== st.config.refiner && <Item title="Deuxième avis" sub="Relit les prompts préparés par une autre IA." end={<Switch label="Deuxième avis" on={p.secondOpinion} onChange={(v) => setProvider({ secondOpinion: v })} />} />}
            <Item
              title="Modèle"
              sub={id === 'mistral' ? `Dictée : ${st.config.transcribeModel}` : undefined}
              end={
                models.length ? (
                  <select className="select" style={{ width: 'auto', maxWidth: 180, padding: '6px 8px' }} value={p.model} onChange={(e) => setProvider({ model: e.target.value })} aria-label="Modèle">
                    {models.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                ) : (
                  <button className="btn sm ghost" onClick={test}>
                    {p.model || 'Choisir'}
                  </button>
                )
              }
            />
          </div>
          <div className="list" style={{ marginTop: 12 }}>
            <Item
              icon="trash"
              danger
              title="Supprimer la clé"
              onClick={() =>
                nav.open({
                  kind: 'confirm',
                  action: 'key.delete',
                  label: `Supprimer la clé ${p.name}`,
                  run: (t) => api(`/api/keys/${id}`, { method: 'DELETE', stepUp: t }).then(() => refreshState()),
                })
              }
            />
          </div>
        </Section>
      )}
    </Sheet>
  );
}

// ---------- Appairage (sur le PC) ----------

export function PairSheet({ level, docked }: { level: number; docked: boolean }) {
  const [p, setP] = useState<{ code: string; expiresAt: number; url: string | null; qr: string | null } | null>(null);
  const [now, setNow] = useState(Date.now());
  const { error, run } = useAsync();
  const devicesBefore = useStore((s) => s.state?.devices.length ?? 0);

  const start = () => run(() => api('/api/pair/start', { method: 'POST' }).then(setP));
  useEffect(() => {
    start();
    const t = window.setInterval(() => {
      setNow(Date.now());
      refreshState().catch(() => {});
    }, 2000);
    return () => clearInterval(t);
  }, []);
  const devicesNow = useStore((s) => s.state?.devices.length ?? 0);
  useEffect(() => {
    if (devicesNow > devicesBefore) {
      toast('Téléphone appairé', 'ok');
      nav.close();
    }
  }, [devicesNow]);

  const left = p ? Math.max(0, Math.round((p.expiresAt - now) / 1000)) : 0;
  return (
    <Sheet title="Appairer un téléphone" level={level} docked={docked} full>
      <ol style={{ paddingLeft: 20, marginTop: 0 }}>
        <li>Sur l'iPhone, ouvre l'app Tailscale et vérifie qu'elle est connectée.</li>
        <li style={{ marginTop: 6 }}>Scanne ce code avec l'appareil photo : Safari ouvre VoxControl.</li>
        <li style={{ marginTop: 6 }}>Dans Safari : Partager › Sur l'écran d'accueil. Ouvre VoxControl depuis l'icône.</li>
        <li style={{ marginTop: 6 }}>Saisis le code ci-dessous.</li>
      </ol>
      {p?.qr ? (
        <div className="qr" style={{ display: 'grid', placeItems: 'center', margin: '18px 0' }} dangerouslySetInnerHTML={{ __html: p.qr }} />
      ) : (
        <p className="error">Tailscale n'est pas connecté sur ce PC : l'iPhone ne pourra pas le joindre.</p>
      )}
      {p?.url && (
        <p className="mono" style={{ textAlign: 'center', margin: 0 }}>
          {p.url}
        </p>
      )}
      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <div className="soft" style={{ fontSize: 13 }}>
          Code à saisir sur l'iPhone
        </div>
        <div className="code-big">{left > 0 ? p?.code : '······'}</div>
        <div className="faint" style={{ fontSize: 13 }}>
          {left > 0 ? `Valable ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Code expiré'}
        </div>
        {left === 0 && (
          <button className="btn ink" style={{ marginTop: 12 }} onClick={start}>
            Nouveau code
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </Sheet>
  );
}

export function iosInstallHint() {
  return isIOS && !isStandalone;
}

