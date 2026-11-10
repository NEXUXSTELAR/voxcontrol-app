import { useEffect, useState } from 'react';
import { api, boot, saveToken, store, useStore } from './api';
import { isIOS, isStandalone } from './format';
import { nav, useNav, useToasts, type SheetSpec, type Tab } from './nav';
import { ProjectsSheet, SessionsSheet } from './sheets/ClaudeSheets';
import { ConfirmSheet } from './sheets/Confirm';
import { DraftSheet } from './sheets/Draft';
import { OpSheet } from './sheets/Op';
import { PaletteSheet } from './sheets/Palette';
import { AppsSheet, FilesSheet, PowerSheet, ScreenshotSheet } from './sheets/PcSheets';
import { ClaudeSpace } from './spaces/Claude';
import { PcSpace } from './spaces/Pc';
import { StudioSpace } from './spaces/Studio';
import { TalkSpace } from './spaces/Talk';
import { PairSheet, ProviderSheet, SettingsSheet } from './sheets/Settings';
import { SecuritySheet } from './sheets/SettingsExtra';
import { Icon, type IconName } from './ui/Icon';
import { useWide } from './ui/kit';

function renderSheet(s: SheetSpec, level: number, docked: boolean) {
  const p = { level, docked };
  switch (s.kind) {
    case 'draft':
      return <DraftSheet {...p} text={s.text} suggestion={s.suggestion} transcribing={s.transcribing} error={s.error} keyboardHint={s.keyboardHint} />;
    case 'op':
      return <OpSheet {...p} id={s.id} />;
    case 'apps':
      return <AppsSheet {...p} />;
    case 'files':
      return <FilesSheet {...p} />;
    case 'power':
      return <PowerSheet {...p} />;
    case 'sessions':
      return <SessionsSheet {...p} />;
    case 'projects':
      return <ProjectsSheet {...p} />;
    case 'security':
      return <SecuritySheet {...p} />;
    case 'settings':
      return <SettingsSheet {...p} section={s.section} />;
    case 'provider':
      return <ProviderSheet {...p} id={s.id} />;
    case 'palette':
      return <PaletteSheet {...p} />;
    case 'confirm':
      return <ConfirmSheet {...p} action={s.action} label={s.label} detail={s.detail} run={s.run} />;
    case 'pair':
      return <PairSheet {...p} />;
    case 'screenshot':
      return <ScreenshotSheet {...p} url={s.url} />;
    default:
      return null;
  }
}

function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function App() {
  const bootState = useStore((s) => s.boot);
  const { stack, tab } = useNav();
  const waiting = useStore((x) => x.ops.filter((o) => o.status === 'needs_you').length);
  const power = useStore((x) => Boolean(x.powerPending));
  const wide = useWide();

  useEffect(() => {
    boot();
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        nav.open({ kind: 'palette' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('wide', wide);
  }, [wide]);

  // Ouverture depuis une notification : /?op=<id>
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('pair') && bootState === 'ready' && store.get().hello?.local) {
      history.replaceState(null, '', '/');
      nav.open({ kind: 'pair' });
    }
    const op = params.get('op');
    if (op && bootState === 'ready') {
      history.replaceState(null, '', '/');
      nav.open({ kind: 'op', id: op });
    }
    const onMsg = (e: MessageEvent) => e.data?.type === 'open-op' && nav.open({ kind: 'op', id: e.data.opId });
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg);
  }, [bootState]);

  if (bootState === 'loading') return <Splash />;
  if (bootState === 'pair') return <PairScreen />;

  const [first, second] = stack;
  return (
    <div className="layout">
      <div className="shell">
        <OfflineBanner />
        <main className="content">
          {tab === 'talk' && <TalkSpace />}
          {tab === 'claude' && <ClaudeSpace />}
          {tab === 'studio' && <StudioSpace />}
          {tab === 'pc' && <PcSpace />}
        </main>
        <TabBar tab={tab} badges={{ claude: waiting, pc: power ? 1 : 0 }} />
      </div>
      {wide && (
        <aside className="side">
          {first ? (
            renderSheet(first, 0, true)
          ) : (
            <div className="side-empty">
              <Icon name="wave" size={28} />
              <p>Les détails s'affichent ici.</p>
              <p className="faint" style={{ fontSize: 13 }}>
                Ctrl + K ouvre toutes les actions.
              </p>
            </div>
          )}
        </aside>
      )}
      {!wide && first && renderSheet(first, 0, false)}
      {second && renderSheet(second, 1, false)}
      <Toasts />
    </div>
  );
}

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'talk', label: 'Parler', icon: 'mic' },
  { id: 'claude', label: 'Claude', icon: 'terminal' },
  { id: 'studio', label: 'Studio', icon: 'refine' },
  { id: 'pc', label: 'PC', icon: 'pc' },
];

function TabBar({ tab, badges }: { tab: Tab; badges: Partial<Record<Tab, number>> }) {
  return (
    <nav className="tabbar" aria-label="Espaces">
      {TABS.map((t) => (
        <button key={t.id} data-space={t.id} aria-current={tab === t.id ? "page" : undefined} onClick={() => nav.setTab(t.id)}>
          <span className="tab-ic">
            <Icon name={t.icon} size={22} />
            {(badges[t.id] ?? 0) > 0 && <i className={t.id === 'pc' ? 'badge alert' : 'badge'}>{t.id === 'pc' ? '!' : badges[t.id]}</i>}
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}

function OfflineBanner() {
  const conn = useStore((s) => s.conn);
  if (conn !== 'offline') return null;
  return (
    <div className="banner" role="alert">
      <Icon name="alert" size={18} />
      <span>PC injoignable. Vérifie qu'il est allumé et que l'app Tailscale est active sur ce téléphone. Nouvelle tentative automatique.</span>
    </div>
  );
}

function Splash() {
  const conn = useStore((s) => s.conn);
  return (
    <div className="pair" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
      <div className="mark">
        <Icon name="wave" size={24} />
      </div>
      <p className="soft">{conn === 'offline' ? 'PC injoignable. Nouvelle tentative…' : 'Connexion au PC…'}</p>
      {conn === 'offline' && <p className="help">Vérifie que le PC est allumé et que Tailscale est actif sur ce téléphone.</p>}
    </div>
  );
}

function PairScreen() {
  const [code, setCode] = useState('');
  const [name, setName] = useState(isIOS ? 'iPhone' : 'Navigateur');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [force, setForce] = useState(false);
  const pcName = useStore((s) => s.hello?.pcName);

  if (isIOS && !isStandalone && !force) {
    return (
      <div className="pair">
        <div className="mark">
          <Icon name="wave" size={24} />
        </div>
        <h1>Installe VoxControl</h1>
        <p className="soft">Sur iPhone, l'appairage doit se faire dans l'app installée, sinon il serait perdu à l'ouverture depuis l'icône.</p>
        <ol style={{ paddingLeft: 20, lineHeight: 1.7 }}>
          <li>Touche le bouton Partager de Safari.</li>
          <li>Choisis « Sur l'écran d'accueil », puis « Ajouter ».</li>
          <li>Ouvre VoxControl depuis la nouvelle icône.</li>
        </ol>
        <div style={{ flex: 1 }} />
        <button className="btn ghost" onClick={() => setForce(true)}>
          Continuer dans Safari quand même
        </button>
      </div>
    );
  }

  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string }>('/api/pair/claim', { body: { code, name } });
      saveToken(r.token);
      store.set({ boot: 'loading' });
      boot();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pair">
      <div className="mark">
        <Icon name="wave" size={24} />
      </div>
      <h1>Relier ce téléphone{pcName ? ` à ${pcName}` : ''}</h1>
      <p className="soft">Sur le PC, ouvre VoxControl puis Réglages › Appareils › Appairer. Un code de 6 caractères s'affiche.</p>
      <label className="label" htmlFor="code">
        Code affiché sur le PC
      </label>
      <input
        id="code"
        className="input code-input"
        value={code}
        maxLength={6}
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="one-time-code"
        spellCheck={false}
        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
      />
      <label className="label" htmlFor="name">
        Nom de cet appareil
      </label>
      <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
      {error && <p className="error">{error}</p>}
      <div style={{ flex: 1, minHeight: 24 }} />
      <button className="btn primary block" disabled={busy || code.length !== 6} onClick={claim}>
        {busy ? 'Vérification…' : 'Relier'}
      </button>
    </div>
  );
}
