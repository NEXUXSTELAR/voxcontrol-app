import { useSyncExternalStore, useState } from 'react';
import { api, store, useStore } from '../api';
import { copy, usd } from '../format';
import { nav, toast, useNav } from '../nav';
import { openDraftFromText } from '../shared';
import type { Refined } from '../types';
import { Icon } from '../ui/Icon';

// ---------- État du Studio (garde le travail en cours quand on change d'espace) ----------

type Remark = { type: string; texte: string };
type StudioState = {
  text: string;
  stage: 'empty' | 'refining' | 'ready';
  refined: Refined | null;
  prompt: string;
  answers: string[];
  review: { provider: string; items: Remark[] } | null;
  picked: number[];
  reviewing: boolean;
  error: string | null;
};

let s: StudioState = { text: '', stage: 'empty', refined: null, prompt: '', answers: [], review: null, picked: [], reviewing: false, error: null };
const ls = new Set<() => void>();
const set = (p: Partial<StudioState>) => {
  s = { ...s, ...p };
  ls.forEach((l) => l());
};

// Le projet suivi (suite de session) passe avant le projet actif.
const currentProjectId = () => nav.get().followUp?.projectId ?? store.get().state?.config.activeProjectId ?? null;

async function runRefine(answers?: string) {
  set({ stage: 'refining', error: null, review: null });
  try {
    const r = await api<Refined>('/api/refine', { body: { text: s.text, answers, projectId: currentProjectId() } });
    set({ stage: 'ready', refined: r, prompt: r.prompt, answers: r.questions.map(() => '') });
  } catch (e: any) {
    set({ stage: s.refined ? 'ready' : 'empty', error: e.message });
  }
}

export const studio = {
  start(text: string) {
    set({ text, refined: null, prompt: '', review: null, picked: [], error: null });
    const hasKey = store.get().state?.providers.find((p) => p.id === store.get().state?.config.refiner)?.keyHint;
    if (!hasKey) {
      set({ stage: 'empty', error: 'Ajoute une clé Mistral pour affiner (Réglages › Connexions).' });
      return;
    }
    runRefine();
  },
  reset() {
    set({ text: '', stage: 'empty', refined: null, prompt: '', review: null, picked: [], error: null });
  },
};

function useStudio() {
  return useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    () => s,
  );
}

// ---------- Rendu : une chaîne d'étapes reliées ----------

const REMARK: Record<string, string> = { oubli: 'Oubli', risque: 'Risque', ambiguite: 'Ambigu', verification: 'À vérifier' };
const pname = (id?: string) => (id === 'openai' ? 'OpenAI' : id === 'gemini' ? 'Gemini' : 'Mistral');

export function StudioSpace() {
  const st = useStudio();
  const app = useStore((x) => x.state);
  const { followUp } = useNav();
  const [sending, setSending] = useState(false);
  const [details, setDetails] = useState(false);
  const project = app?.config.projects.find((p) => p.id === (followUp?.projectId ?? app?.config.activeProjectId));
  const reviewer = app?.providers.find((p) => p.id !== app.config.refiner && p.enabled && p.secondOpinion && p.keyHint);

  if (st.stage === 'empty' && !st.text) {
    return (
      <div className="space" data-space="studio">
        <header className="space-head">
          <h1>Studio</h1>
        </header>
        <p className="lead-text">Transforme une idée floue en instruction précise pour Claude, que tu relis avant l'envoi.</p>
        <button className="btn primary block" onClick={() => nav.setTab('talk')}>
          <Icon name="mic" size={18} /> Dicter une demande
        </button>
        <p className="help" style={{ textAlign: 'center' }}>Choisis « Affiner » sous le micro.</p>
        <ol className="chain preview" aria-label="Les étapes du Studio">
          {[
            ['Ta demande', 'Dictée ou écrite, même floue'],
            ['Rédaction', `${pname(app?.config.refiner)} lit le projet et prépare le prompt`],
            ['Prompt', 'Tu le relis et tu le modifies'],
            ['Relecture', 'Une autre IA cherche les oublis (facultatif)'],
            ['Envoi', 'Claude Code commence, tu suis dans l’espace Claude'],
          ].map(([t, d], i) => (
            <li key={t} className="done">
              <div className="node">{i + 1}</div>
              <div className="chain-body">
                <div className="chain-title" style={{ marginBottom: 0 }}>{t}</div>
                <div className="soft" style={{ fontSize: 13.5 }}>{d}</div>
              </div>
            </li>
          ))}
        </ol>
        {app && app.prompts.length > 0 && (
          <section className="sec">
            <h3>Prompts enregistrés</h3>
            <div className="list">
              {app.prompts.map((p) => (
                <button key={p.id} className="item" onClick={() => openDraftFromText(p.body)}>
                  <span className="lead">
                    <Icon name="note" />
                  </span>
                  <span className="main">
                    <div className="t">{p.title}</div>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  const r = st.refined;
  const tokens = r ? r.usage.in + r.usage.out : 0;
  const price = r && app ? app.config.prices.llm[r.provider] : null;
  const cost = r && price ? (r.usage.in * price.in + r.usage.out * price.out) / 1e6 : 0;

  const send = async () => {
    if (!project) {
      nav.open({ kind: 'projects' });
      return;
    }
    setSending(true);
    try {
      await api('/api/claude/send', { body: { prompt: st.prompt, projectId: project.id, resume: followUp?.sessionId ?? null, title: r?.titre } });
      toast('Envoyé à Claude Code', 'ok');
      studio.reset();
      nav.setTab('claude');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const review = async () => {
    set({ reviewing: true, error: null });
    try {
      const x = await api<{ provider: string; remarques: Remark[] }>('/api/second-opinion', { body: { prompt: st.prompt, original: st.text, projectId: currentProjectId() } });
      set({ review: { provider: x.provider, items: x.remarques }, picked: x.remarques.map((_, i) => i) });
    } catch (e: any) {
      set({ error: e.message });
    } finally {
      set({ reviewing: false });
    }
  };

  const applyReview = () => {
    if (!st.review) return;
    const lines = st.review.items.filter((_, i) => st.picked.includes(i)).map((x) => `- ${x.texte}`);
    set({ prompt: lines.length ? `${st.prompt.trimEnd()}\n\nPoints à traiter aussi :\n${lines.join('\n')}` : st.prompt, review: null });
  };

  const step = (n: number) => (st.stage === 'refining' ? (n === 2 ? 'now' : n < 2 ? 'done' : '') : st.stage === 'ready' ? (n <= 3 ? 'done' : n === 4 ? 'now' : '') : n === 1 ? 'done' : '');

  return (
    <div className="space" data-space="studio">
      <header className="space-head">
        <h1>Studio</h1>
        <button className="btn sm ghost" onClick={studio.reset}>
          Effacer
        </button>
      </header>

      <ol className="chain">
        <li className={step(1)}>
          <div className="node">1</div>
          <div className="chain-body">
            <div className="chain-title">Ta demande</div>
            <div className="chain-text">{st.text}</div>
          </div>
        </li>

        <li className={step(2)}>
          <div className={st.stage === 'refining' ? 'node spin' : 'node'}>2</div>
          <div className="chain-body">
            <div className="chain-title">
              Rédaction · {pname(app?.config.refiner)}
              {project && app?.config.readProjectContext ? ` lit ${project.name}` : ''}
            </div>
            {st.stage === 'refining' && <div className="chain-text soft">Préparation du prompt…</div>}
            {r && (
              <div className="chain-text soft">
                {r.intention}
                <span className="faint"> · {tokens.toLocaleString('fr-FR')} jetons{cost ? ` · ≈ ${usd(cost)}` : ''}</span>
              </div>
            )}
          </div>
        </li>

        {r && r.questions.length > 0 && (
          <li className="now">
            <div className="node">?</div>
            <div className="chain-body">
              <div className="chain-title">Une précision</div>
              {r.questions.map((q, i) => (
                <div key={i} style={{ marginTop: 6 }}>
                  <label className="label" style={{ marginTop: 0 }}>
                    {q}
                  </label>
                  <input className="input" value={st.answers[i] ?? ''} onChange={(e) => set({ answers: st.answers.map((a, j) => (j === i ? e.target.value : a)) })} />
                </div>
              ))}
              <button className="btn sm ink" style={{ marginTop: 8 }} disabled={!st.answers.some((a) => a.trim())} onClick={() => runRefine(r.questions.map((q, i) => `${q} → ${st.answers[i] || '(sans réponse)'}`).join('\n'))}>
                Mettre à jour
              </button>
            </div>
          </li>
        )}

        {r && (
          <li className={step(3)}>
            <div className="node">3</div>
            <div className="chain-body">
              <div className="chain-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Prompt · {r.titre}</span>
                <button className="soft" onClick={() => copy(st.prompt).then(() => toast('Copié', 'ok'))} aria-label="Copier le prompt">
                  <Icon name="copy" size={18} />
                </button>
              </div>
              <textarea className="textarea mono" rows={8} value={st.prompt} onChange={(e) => set({ prompt: e.target.value })} />
              <button className="soft link" onClick={() => setDetails(!details)}>
                {details ? 'Masquer le plan' : 'Voir le plan (objectifs, étapes, risques)'}
              </button>
              {details && (
                <div className="plan">
                  {[
                    ['Objectifs', r.objectifs],
                    ['Étapes', r.etapes],
                    ['Fichiers', r.fichiers],
                    ['Risques', r.risques],
                  ].map(([t, items]) =>
                    (items as string[]).length ? (
                      <div key={t as string}>
                        <strong>{t as string}</strong>
                        <ul>
                          {(items as string[]).map((x, i) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null,
                  )}
                </div>
              )}
            </div>
          </li>
        )}

        {r && (
          <li className={st.review ? 'now' : ''}>
            <div className={st.reviewing ? 'node spin' : 'node'}>4</div>
            <div className="chain-body">
              <div className="chain-title">Relecture {reviewer ? `· ${reviewer.name}` : '(facultatif)'}</div>
              {!st.review && (
                <button className="btn sm" disabled={!reviewer || st.reviewing} onClick={review}>
                  {st.reviewing ? 'Relecture…' : reviewer ? 'Faire relire' : 'Ajoute OpenAI ou Gemini dans Réglages'}
                </button>
              )}
              {st.review && st.review.items.length === 0 && <div className="chain-text soft">Rien à ajouter.</div>}
              {st.review && st.review.items.length > 0 && (
                <>
                  {st.review.items.map((x, i) => (
                    <div className="remark" key={i}>
                      <button
                        className="check"
                        role="checkbox"
                        aria-checked={st.picked.includes(i)}
                        aria-label={x.texte}
                        onClick={() => set({ picked: st.picked.includes(i) ? st.picked.filter((p) => p !== i) : [...st.picked, i] })}
                      >
                        {st.picked.includes(i) && <Icon name="check" size={14} />}
                      </button>
                      <div>
                        <span className={`tag${x.type === 'risque' ? ' danger' : x.type === 'oubli' ? ' wait' : ''}`}>{REMARK[x.type] ?? x.type}</span>
                        <div style={{ marginTop: 4 }}>{x.texte}</div>
                      </div>
                    </div>
                  ))}
                  <button className="btn sm ink" onClick={applyReview}>
                    Ajouter {st.picked.length} au prompt
                  </button>
                </>
              )}
            </div>
          </li>
        )}

        {r && (
          <li className={step(4)}>
            <div className="node">
              <Icon name="send" size={14} />
            </div>
            <div className="chain-body">
              <div className="chain-title">Envoi · {project?.name ?? 'choisis un projet'}{followUp ? ' · suite de session' : ''}</div>
              <button className="btn primary block" disabled={sending || !st.prompt.trim()} onClick={send}>
                Envoyer à Claude
              </button>
            </div>
          </li>
        )}
      </ol>
      {st.error && <p className="error">{st.error}</p>}
    </div>
  );
}
