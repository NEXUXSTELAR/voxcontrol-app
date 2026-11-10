import { useEffect, useRef, useState } from 'react';
import { api, store, useStore } from '../api';
import { runAction } from '../actions';
import { copy } from '../format';
import { nav, toast, useNav } from '../nav';
import { studio } from '../spaces/Studio';
import { getPrefs } from '../speech';
import type { Suggestion } from '../types';
import { Icon } from '../ui/Icon';
import { Sheet, useAsync } from '../ui/kit';

type Route = 'claude' | 'pc' | 'note';

/** Après la parole : le texte, où il va, un bouton. Rien de plus. */
export function DraftSheet(props: { level: number; docked: boolean; text: string; suggestion: Suggestion | null; transcribing?: boolean; error?: string; keyboardHint?: boolean }) {
  const [text, setText] = useState(props.text);
  const [route, setRoute] = useState<Route>(props.suggestion?.route ?? 'claude');
  const send = useAsync();
  const st = useStore((s) => s.state);
  const { followUp } = useNav();
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(props.text);
    setRoute(props.suggestion?.route ?? 'claude');
  }, [props.text, props.suggestion]);
  useEffect(() => {
    if (props.keyboardHint) ta.current?.focus();
  }, [props.keyboardHint]);

  const project = st?.config.projects.find((p) => p.id === (followUp?.projectId ?? st.config.activeProjectId));
  const smart = props.suggestion?.mode === 'smart';
  const pc = props.suggestion?.pc;
  // Envoi automatique : seulement vers Claude, pour une demande courte jugée claire. Toucher quoi que ce soit l'annule.
  const [countdown, setCountdown] = useState<number | null>(null);
  useEffect(() => {
    const eligible = getPrefs().autoSend && !props.transcribing && !props.error && props.suggestion?.route === 'claude' && props.suggestion.mode === 'direct' && project && props.text.trim().length > 0 && props.text.length <= 120;
    setCountdown(eligible ? 3 : null);
  }, [props.text, props.suggestion, props.transcribing]);
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      setCountdown(null);
      toClaude();
      return;
    }
    const t = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown]);
  const stopCountdown = () => setCountdown(null);

  if (props.transcribing) {
    return (
      <Sheet title="Transcription…" level={props.level} docked={props.docked}>
        <div className="skeleton" aria-busy="true">
          <i style={{ width: '92%' }} />
          <i style={{ width: '70%' }} />
        </div>
      </Sheet>
    );
  }

  const toClaude = async () => {
    if (!project) {
      nav.replace({ kind: 'projects' });
      return;
    }
    const r = await send.run(() => api('/api/claude/send', { body: { prompt: text, projectId: project.id, resume: followUp?.sessionId ?? null } }));
    if (r) {
      nav.closeAll();
      nav.setTab('claude');
      toast('Envoyé à Claude Code', 'ok');
    }
  };

  const refine = () => {
    studio.start(text);
    nav.setTab('studio');
  };

  const keep = async () => {
    await copy(text);
    await send.run(() => api('/api/note', { body: { text } }));
    nav.closeAll();
    toast('Copié', 'ok');
  };

  const foot =
    countdown !== null ? (
      <div className="btns">
        <button className="btn" onClick={stopCountdown}>
          Annuler
        </button>
        <button className="btn primary" style={{ flex: 2 }} onClick={() => (stopCountdown(), toClaude())}>
          Envoi dans {countdown} s
        </button>
      </div>
    ) : route === 'claude' ? (
      <div className="btns">
        <button className={`btn${smart ? ' primary' : ''}`} style={smart ? { flex: 2, order: 2 } : undefined} disabled={!text.trim()} onClick={refine}>
          <Icon name="refine" size={18} /> Affiner
        </button>
        <button className={`btn${smart ? '' : ' primary'}`} style={smart ? undefined : { flex: 2 }} disabled={!text.trim() || send.busy} onClick={toClaude}>
          <Icon name="send" size={18} /> {smart ? 'Tel quel' : 'Envoyer'}
        </button>
      </div>
    ) : route === 'pc' ? (
      <button
        className="btn primary block"
        disabled={!pc}
        onClick={() => {
          nav.close();
          runAction(pc!.action, pc!.arg, { label: pc!.label });
        }}
      >
        {pc ? pc.label : 'Aucune commande reconnue'}
      </button>
    ) : (
      <button className="btn primary block" disabled={!text.trim()} onClick={keep}>
        <Icon name="copy" size={18} /> Copier
      </button>
    );

  return (
    <Sheet title={route === 'pc' && pc ? pc.label : 'Ta demande'} level={props.level} docked={props.docked} foot={foot}>
      {props.error && <p className="error" style={{ marginTop: 0 }}>{props.error}</p>}
      <textarea ref={ta} className="draft-text" rows={3} value={text} onChange={(e) => (stopCountdown(), setText(e.target.value))} onFocus={stopCountdown} placeholder="Ce que tu veux faire…" aria-label="Texte de la demande" />
      <div className="seg" style={{ marginTop: 12 }} role="group" aria-label="Destination">
        <button aria-pressed={route === 'claude'} onClick={() => (stopCountdown(), setRoute('claude'))}>
          Claude
        </button>
        <button aria-pressed={route === 'pc'} onClick={() => (stopCountdown(), setRoute('pc'))}>
          PC
        </button>
        <button aria-pressed={route === 'note'} onClick={() => (stopCountdown(), setRoute('note'))}>
          Copier
        </button>
      </div>
      <p className="help">
        {route === 'claude' && (project ? `Dans ${project.name}${followUp ? ', suite de la session' : ', nouvelle session'}${smart ? ' · demande ouverte : Affiner conseillé' : ''}` : 'Choisis un projet à l’envoi')}
        {route === 'pc' && (pc ? (store.get().state?.levels[pc.action]?.level === 2 ? 'Confirmation Face ID à l’étape suivante' : 'Exécuté tout de suite') : 'Pas de commande Windows reconnue. Essaie l’espace PC.')}
        {route === 'note' && 'Copié dans le presse-papiers et gardé dans l’historique'}
      </p>
      {send.error && <p className="error">{send.error}</p>}
    </Sheet>
  );
}
