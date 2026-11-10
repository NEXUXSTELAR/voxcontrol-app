import { useEffect, useRef, useState } from 'react';
import { api, type ApiError, useStore } from '../api';
import { pushEnabled } from '../actions';
import { isIOS, isStandalone } from '../format';
import { nav, useNav } from '../nav';
import { LiveTranscriber } from '../livevoice';
import { useRecorder } from '../recorder';
import { buzz, usePrefs } from '../speech';
import { AskCard, openDraftFromText } from '../shared';
import type { Suggestion } from '../types';
import { Icon } from '../ui/Icon';
import { studio } from './Studio';

type Mode = 'direct' | 'smart';
function readMode(): Mode {
  try {
    return localStorage.getItem('vox.mode') === 'smart' ? 'smart' : 'direct';
  } catch {
    return 'direct';
  }
}

/** Espace « Parler » : un objet central, un choix de mode, trois suggestions. Rien d'autre. */
export function TalkSpace() {
  const orbRef = useRef<HTMLButtonElement>(null);
  const [mode, setModeState] = useState<Mode>(readMode);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const conn = useStore((s) => s.conn);
  const st = useStore((s) => s.state);
  const ops = useStore((s) => s.ops);
  const { followUp } = useNav();
  const waiting = ops.filter((o) => o.status === 'needs_you');
  const hasMistral = Boolean(st?.providers.find((p) => p.id === 'mistral')?.keyHint);
  const project = st?.config.projects.find((p) => p.id === st.config.activeProjectId);

  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem('vox.mode', m);
    } catch {
      /* préférence non mémorisée */
    }
  };

  const handleText = (t: string) => {
    if (mode === 'smart') {
      studio.start(t);
      nav.setTab('studio');
    } else openDraftFromText(t);
  };

  const prefs = usePrefs();
  const live = useRef<LiveTranscriber | null>(null);
  const [liveText, setLiveText] = useState('');

  const deliver = (t: string, suggestion: Suggestion | null) => {
    if (mode === 'smart') {
      nav.closeAll();
      studio.start(t);
      nav.setTab('studio');
    } else nav.replace({ kind: 'draft', text: t, suggestion });
  };

  const rec = useRecorder(
    async (blob, seconds) => {
      buzz(8);
      nav.open({ kind: 'draft', text: liveText, suggestion: null, transcribing: true });
      try {
        // Transcription en direct si elle a marché, sinon la dictée classique prend le relais.
        if (live.current) {
          const t = await live.current.finish().catch(() => '');
          live.current = null;
          if (t.trim()) {
            const sug = await api<Suggestion>('/api/suggest', { body: { text: t } }).catch(() => null);
            deliver(t.trim(), sug);
            return;
          }
        }
        const form = new FormData();
        form.append('seconds', String(Math.round(seconds)));
        form.append('audio', blob, 'dictee');
        const r = await api<{ text: string; suggestion: Suggestion }>('/api/voice', { form });
        deliver(r.text, r.suggestion);
      } catch (e: any) {
        nav.replace({ kind: 'draft', text: '', suggestion: null, error: (e as ApiError).message, keyboardHint: true });
      } finally {
        setLiveText('');
        rec.done();
      }
    },
    orbRef,
    {
      onStream: (ctx, src) => {
        if (!prefs.live) return;
        const l = new LiveTranscriber(setLiveText);
        live.current = l;
        l.attach(ctx, src).catch(() => {
          l.cancel();
          live.current = null;
        });
      },
      onCancel: () => {
        live.current?.cancel();
        live.current = null;
        setLiveText('');
      },
    },
  );

  const onOrb = () => {
    if (rec.state === 'recording') return rec.stop();
    if (rec.state !== 'idle') return;
    if (!hasMistral) return setTyping(true);
    buzz(12);
    rec.start();
  };

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    setTyping(false);
    handleText(t);
  };

  const status =
    rec.error ??
    (rec.state === 'recording'
      ? `${Math.floor(rec.elapsed / 60)}:${String(Math.floor(rec.elapsed % 60)).padStart(2, '0')} · touche pour terminer`
      : rec.state === 'sending'
        ? 'Transcription…'
        : rec.state === 'starting'
          ? 'Ouverture du micro…'
          : conn !== 'online'
            ? 'PC injoignable'
            : hasMistral
              ? 'Touche et parle'
              : 'Touche pour écrire');

  const suggestions = learnedSuggestions(ops, Boolean(followUp));

  return (
    <div className="space talk" data-space="talk">
      <header className="talk-head">
        <ConnLine />
        <button className="icon-btn" onClick={() => nav.open({ kind: 'settings' })} aria-label="Réglages">
          <Icon name="gear" />
        </button>
      </header>

      {waiting.slice(0, 1).map((o) => (
        <AskCard key={o.id} op={o} />
      ))}
      <SetupLine />

      <div className="stage">
        {typing ? (
          <div className="type-box">
            <textarea
              className="field"
              autoFocus
              rows={3}
              value={text}
              placeholder={hasMistral ? 'Écris ta demande…' : 'Écris ou dicte avec le micro du clavier…'}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <div className="btns">
              <button className="btn" onClick={() => setTyping(false)}>
                Annuler
              </button>
              <button className="btn primary" style={{ flex: 2 }} disabled={!text.trim()} onClick={submit}>
                Continuer
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              ref={orbRef}
              className={`orb${rec.state === 'recording' ? ' rec' : ''}${rec.state === 'sending' || rec.state === 'starting' ? ' busy' : ''}`}
              onClick={onOrb}
              disabled={conn === 'offline'}
              aria-label={rec.state === 'recording' ? 'Terminer la dictée' : 'Parler'}
            >
              <span className="orb-ring" />
              <img src="/art/orb.webp" alt="" draggable={false} />
              <span className="orb-icon">
                <Icon name={rec.state === 'recording' ? 'stop' : 'mic'} size={30} />
              </span>
            </button>
            {liveText && rec.state === 'recording' && <p className="live-text">{liveText}</p>}
            <p className="orb-status" role="status" style={rec.error ? { color: 'var(--danger)' } : undefined}>
              {status}
            </p>
            {rec.state === 'recording' ? (
              <button className="btn sm ghost" onClick={rec.cancel}>
                Annuler
              </button>
            ) : hasMistral ? (
              <button className="btn sm ghost" onClick={() => setTyping(true)}>
                <Icon name="keyboard" size={18} /> Écrire
              </button>
            ) : null}
          </>
        )}
      </div>

      <div className="seg mode" role="group" aria-label="Mode">
        <button aria-pressed={mode === 'direct'} onClick={() => setMode('direct')}>
          Direct
        </button>
        <button aria-pressed={mode === 'smart'} onClick={() => setMode('smart')}>
          Affiner
        </button>
      </div>
      <p className="mode-help">
        {mode === 'direct' ? 'Ta phrase part telle quelle' : 'Une IA en fait un prompt précis, tu valides'}
        {project ? ` · ${project.name}` : ''}
        {followUp ? ' · suite de session' : ''}
      </p>

      <div className="chips">
        {suggestions.map((s) => (
          <button key={s} className="chip" onClick={() => openDraftFromText(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function ConnLine() {
  const conn = useStore((s) => s.conn);
  const running = useStore((s) => s.claudeRunning);
  const text = conn === 'online' ? `PC connecté · Claude ${running ? `travaille (${running})` : 'prêt'}` : conn === 'connecting' ? 'Connexion…' : 'PC injoignable';
  return (
    <button className="conn" onClick={() => nav.setTab('pc')}>
      <span className={`dot ${conn === 'online' ? (running ? 'run' : 'on') : conn === 'connecting' ? 'run' : 'off'}`} />
      {text}
    </button>
  );
}

/** Une seule ligne au lieu d'une liste : les étapes restantes s'ouvrent dans les Réglages. */
function SetupLine() {
  const s = useStore((x) => x.state);
  const hello = useStore((x) => x.hello);
  const [push, setPush] = useState<boolean | null>(null);
  useEffect(() => {
    pushEnabled().then(setPush);
  }, []);
  if (!s) return null;
  const device = s.caller.kind === 'device';
  const todo: { label: string; go: () => void }[] = [];
  if (!s.config.projects.length) todo.push({ label: 'choisir un projet', go: () => nav.open({ kind: 'projects' }) });
  if (!s.providers.find((p) => p.id === 'mistral')?.keyHint) todo.push({ label: 'clé Mistral', go: () => nav.open({ kind: 'provider', id: 'mistral' }) });
  if (!device && hello?.local && !s.devices.some((d) => !d.revoked)) todo.push({ label: 'appairer l’iPhone', go: () => nav.open({ kind: 'pair' }) });
  if (device && isIOS && !isStandalone) todo.push({ label: 'ajouter à l’écran d’accueil', go: () => nav.open({ kind: 'settings', section: 'device' }) });
  if (device && s.caller.kind === 'device' && !s.caller.passkey) todo.push({ label: 'Face ID', go: () => nav.open({ kind: 'settings', section: 'device' }) });
  if (device && push === false) todo.push({ label: 'notifications', go: () => nav.open({ kind: 'settings', section: 'device' }) });
  if (!todo.length) return null;
  return (
    <button className="setup" onClick={todo[0].go}>
      <span>
        À finir : <strong>{todo[0].label}</strong>
        {todo.length > 1 ? ` et ${todo.length - 1} autre${todo.length > 2 ? 's' : ''}` : ''}
      </span>
      <Icon name="chevronRight" size={18} />
    </button>
  );
}

const DEFAULT_SUGGESTIONS = ['Résume l’état du projet', 'Lance les tests du projet', 'Verrouille le PC'];

/** Tes 3 demandes les plus fréquentes (au moins 2 fois), complétées par des exemples. */
function learnedSuggestions(ops: { kind: string; prompt?: string }[], followUp: boolean): string[] {
  const count = new Map<string, { text: string; n: number }>();
  for (const o of ops) {
    if (o.kind !== 'claude' || !o.prompt || o.prompt.length > 70) continue;
    const key = o.prompt.trim().toLowerCase().replace(/[.!?]+$/, '');
    const cur = count.get(key);
    count.set(key, { text: o.prompt.trim(), n: (cur?.n ?? 0) + 1 });
  }
  const learned = [...count.values()].filter((x) => x.n >= 2).sort((a, b) => b.n - a.n).map((x) => x.text);
  const base = followUp ? ['Continue la tâche en cours', ...learned] : learned;
  return [...new Set([...base, ...DEFAULT_SUGGESTIONS])].slice(0, 3);
}
