import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config, saveConfig, type Project, type ProviderId } from './config.ts';
import { monthSpend, recordSpend } from './db.ts';
import { getSecret, redact } from './secrets.ts';

export const PROVIDERS: Record<ProviderId, { name: string; keyUrl: string; help: string }> = {
  mistral: {
    name: 'Mistral',
    keyUrl: 'https://console.mistral.ai/api-keys',
    help: 'Connecte-toi, puis « Create new key ». Copie la clé et colle-la ici. Pense à ajouter un moyen de paiement dans « Billing ».',
  },
  openai: {
    name: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    help: 'Connecte-toi, puis « Create new secret key ». Fixe aussi un plafond mensuel dans Settings › Limits.',
  },
  gemini: {
    name: 'Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    help: 'Connecte-toi avec ton compte Google, puis « Create API key ». En formule gratuite, Google peut utiliser tes requêtes pour entraîner ses modèles.',
  },
};

class AiError extends Error {}

function key(p: ProviderId): string {
  const k = getSecret(p);
  if (!k) throw new AiError(`Aucune clé ${PROVIDERS[p].name}. Ajoute-la dans Réglages › Connexions.`);
  return k;
}

function checkCap() {
  const total = monthSpend().reduce((s, r) => s + r.usd, 0);
  if (config.monthlyCapUsd > 0 && total >= config.monthlyCapUsd) {
    throw new AiError(`Plafond mensuel atteint (${config.monthlyCapUsd} $). Tu peux le relever dans Réglages › Dépenses.`);
  }
}

async function http(url: string, init: RequestInit, label: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(90_000) });
  } catch (e: any) {
    throw new AiError(`${label} injoignable : ${e?.name === 'TimeoutError' ? 'délai dépassé' : 'vérifie la connexion Internet du PC'}.`);
  }
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new AiError(`${label} refuse la clé (erreur ${res.status}). Vérifie-la dans Réglages.`);
    if (res.status === 429) throw new AiError(`${label} : trop de requêtes ou crédit épuisé (429).`);
    throw new AiError(`${label} : erreur ${res.status}. ${redact(text).slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------- Test de connexion et choix des modèles ----------

export async function testProvider(p: ProviderId): Promise<{ ok: true; models: string[] }> {
  const k = key(p);
  let models: string[] = [];
  if (p === 'mistral') {
    const j = await http('https://api.mistral.ai/v1/models', { headers: { Authorization: `Bearer ${k}` } }, 'Mistral');
    models = (j.data ?? []).map((m: any) => m.id);
    const transcribe = models.filter((m) => /voxtral.*transcribe/i.test(m));
    const pick = transcribe.find((m) => /mini.*latest/i.test(m)) ?? transcribe.find((m) => /mini/i.test(m)) ?? transcribe[0];
    if (pick) config.transcribeModel = pick;
    const realtime = models.filter((m) => /realtime/i.test(m) && /transcribe/i.test(m)).sort();
    if (realtime.length) config.realtimeModel = realtime[realtime.length - 1];
    if (!models.includes(config.providers.mistral.model)) {
      config.providers.mistral.model = models.find((m) => m === 'mistral-medium-latest') ?? models.find((m) => /mistral-(medium|small)-latest/.test(m)) ?? config.providers.mistral.model;
    }
  } else if (p === 'openai') {
    const j = await http('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${k}` } }, 'OpenAI');
    models = (j.data ?? []).map((m: any) => m.id).filter((m: string) => /^(gpt|o\d)/.test(m) && !/(audio|realtime|tts|transcribe|image|search)/.test(m)).sort();
    if (!models.includes(config.providers.openai.model)) {
      config.providers.openai.model = models.filter((m) => /mini/.test(m) && !/\d{4}-\d{2}-\d{2}/.test(m)).pop() ?? models[models.length - 1] ?? '';
    }
  } else {
    const j = await http(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': k } }, 'Gemini');
    models = (j.models ?? [])
      .filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m: any) => String(m.name).replace(/^models\//, ''))
      .filter((m: string) => /^gemini/.test(m) && !/(tts|image|embedding|live|audio)/.test(m));
    if (!models.includes(config.providers.gemini.model)) {
      config.providers.gemini.model = models.filter((m) => /flash/.test(m) && !/lite/.test(m) && !/preview|exp/.test(m)).pop() ?? models[0] ?? '';
    }
  }
  saveConfig();
  return { ok: true, models };
}

// ---------- Transcription ----------

function findFfmpeg(): string | null {
  const r = spawnSync('where', ['ffmpeg'], { encoding: 'utf8', windowsHide: true });
  const line = r.stdout?.split(/\r?\n/).find(Boolean);
  return line && fs.existsSync(line) ? line : null;
}
const FFMPEG = findFfmpeg();

function toMp3(input: Buffer, ext: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!FFMPEG) return reject(new Error('no ffmpeg'));
    const src = path.join(os.tmpdir(), `vox-in-${Date.now()}.${ext}`);
    const dst = src.replace(/\.[^.]+$/, '.mp3');
    fs.writeFileSync(src, input);
    const c = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-i', src, '-ac', '1', '-ar', '16000', '-b:a', '48k', dst], { windowsHide: true });
    c.on('close', (code) => {
      fs.rmSync(src, { force: true });
      if (code !== 0) return reject(new Error('ffmpeg'));
      const out = fs.readFileSync(dst);
      fs.rmSync(dst, { force: true });
      resolve(out);
    });
  });
}

export async function transcribe(audio: Buffer, mime: string, seconds: number): Promise<string> {
  checkCap();
  const k = key('mistral');
  const ext = mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac') ? 'm4a' : mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : 'wav';
  let body = audio;
  let name = `dictee.${ext}`;
  let type = mime || 'audio/mp4';
  try {
    body = await toMp3(audio, ext);
    name = 'dictee.mp3';
    type = 'audio/mpeg';
  } catch {
    /* sans ffmpeg, on envoie le format d'origine */
  }
  const form = new FormData();
  form.append('model', config.transcribeModel);
  form.append('language', 'fr');
  form.append('file', new Blob([new Uint8Array(body)], { type }), name);
  const j = await http('https://api.mistral.ai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${k}` }, body: form }, 'Voxtral');
  const minutes = Math.max(seconds, 1) / 60;
  recordSpend('mistral', 'transcription', minutes, minutes * config.prices.transcribePerMin);
  return String(j.text ?? '').trim();
}

// ---------- Appels de modèles en JSON ----------

type Usage = { in: number; out: number };

async function chatJSON(p: ProviderId, system: string, user: string): Promise<{ data: any; usage: Usage; model: string }> {
  checkCap();
  const k = key(p);
  const model = config.providers[p].model;
  if (!model) throw new AiError(`Aucun modèle choisi pour ${PROVIDERS[p].name}. Teste la connexion dans Réglages.`);
  let text = '';
  let usage: Usage = { in: 0, out: 0 };
  if (p === 'mistral' || p === 'openai') {
    const url = p === 'mistral' ? 'https://api.mistral.ai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const j = await http(
      url,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      },
      PROVIDERS[p].name,
    );
    text = j.choices?.[0]?.message?.content ?? '';
    usage = { in: j.usage?.prompt_tokens ?? 0, out: j.usage?.completion_tokens ?? 0 };
  } else {
    const j = await http(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': k, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      },
      'Gemini',
    );
    text = (j.candidates?.[0]?.content?.parts ?? []).map((x: any) => x.text ?? '').join('');
    usage = { in: j.usageMetadata?.promptTokenCount ?? 0, out: j.usageMetadata?.candidatesTokenCount ?? 0 };
  }
  const price = config.prices.llm[p];
  recordSpend(p, 'llm', usage.in + usage.out, (usage.in * price.in + usage.out * price.out) / 1e6);
  let data: any;
  try {
    data = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new AiError(`${PROVIDERS[p].name} a renvoyé une réponse illisible. Réessaie.`);
  }
  return { data, usage, model };
}

// ---------- Contexte du projet ----------

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', 'target', '.cache']);

export function projectContext(project: Project | null): string {
  if (!project || !config.readProjectContext || !fs.existsSync(project.path)) return '';
  const lines: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (lines.length > 180 || depth > 2) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP.has(e.name) || e.name.startsWith('.env')) continue;
      lines.push(`${'  '.repeat(depth)}${e.name}${e.isDirectory() ? '/' : ''}`);
      if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(project.path, 0);
  let docs = '';
  for (const f of ['CLAUDE.md', 'README.md']) {
    const p = path.join(project.path, f);
    if (fs.existsSync(p)) docs += `\n--- ${f} (début) ---\n${fs.readFileSync(p, 'utf8').slice(0, 3000)}\n`;
  }
  const notes = project.notes ? `\n--- Consignes permanentes du projet ---\n${project.notes}\n` : '';
  return `Projet « ${project.name} » (${project.path})\nArborescence :\n${lines.join('\n')}\n${docs}${notes}`;
}

// ---------- Mode intelligent ----------

const REFINE_SYSTEM = `Tu prépares des instructions pour Claude Code, un agent de développement qui travaille dans le dossier d'un projet sur un PC Windows.
L'utilisateur a dicté une demande à l'oral, souvent vague. Transforme-la en instruction claire, précise et vérifiable, en français.
Règles :
- Ne jamais inventer de fichiers : cite seulement ceux qui apparaissent dans le contexte, sinon décris ce qu'il faut chercher.
- Si une information indispensable manque, pose la question dans "questions" (au plus 3) au lieu de deviner.
- Le prompt final s'adresse directement à Claude Code, à l'impératif, avec les critères de fin (comment vérifier que c'est réussi).
- Demande à Claude Code de montrer son plan avant toute modification importante.
- Signale dans "risques" ce qui pourrait casser ou supprimer quelque chose.
Réponds uniquement avec un objet JSON :
{"titre": "5 à 8 mots", "intention": "une phrase", "prompt": "instruction complète pour Claude Code", "objectifs": ["..."], "etapes": ["..."], "fichiers": ["..."], "risques": ["..."], "questions": ["..."]}`;

export type Refined = {
  titre: string;
  intention: string;
  prompt: string;
  objectifs: string[];
  etapes: string[];
  fichiers: string[];
  risques: string[];
  questions: string[];
  provider: ProviderId;
  model: string;
  usage: Usage;
};

const arr = (v: any): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

export async function refine(text: string, project: Project | null, answers?: string): Promise<Refined> {
  const p = config.refiner;
  if (!config.providers[p].enabled) throw new AiError(`${PROVIDERS[p].name} est désactivé. Active-le dans Réglages.`);
  const ctx = projectContext(project);
  const user = `Demande dictée :\n"""${text}"""\n${answers ? `\nRéponses de l'utilisateur à tes questions :\n${answers}\n` : ''}${ctx ? `\nContexte :\n${ctx}` : '\nAucun contexte de projet fourni.'}`;
  const { data, usage, model } = await chatJSON(p, REFINE_SYSTEM, user);
  return {
    titre: String(data.titre ?? 'Demande'),
    intention: String(data.intention ?? ''),
    prompt: String(data.prompt ?? text),
    objectifs: arr(data.objectifs),
    etapes: arr(data.etapes),
    fichiers: arr(data.fichiers),
    risques: arr(data.risques),
    questions: arr(data.questions),
    provider: p,
    model,
    usage,
  };
}

const REVIEW_SYSTEM = `Tu relis une instruction destinée à Claude Code (agent de développement). Ne la réécris pas.
Liste seulement ce qui manque ou pose problème : oubli, risque, ambiguïté, vérification à ajouter. Au plus 5 remarques, chacune en une phrase concrète, en français.
Si l'instruction est bonne, renvoie une liste vide.
Réponds uniquement avec un objet JSON : {"remarques": [{"type": "oubli" | "risque" | "ambiguite" | "verification", "texte": "..."}]}`;

export async function secondOpinion(prompt: string, original: string, project: Project | null) {
  const p = (['openai', 'gemini', 'mistral'] as ProviderId[]).find((x) => x !== config.refiner && config.providers[x].enabled && config.providers[x].secondOpinion && getSecret(x));
  if (!p) throw new AiError('Aucune IA de deuxième avis active. Ajoute OpenAI ou Gemini dans Réglages › Connexions.');
  const ctx = projectContext(project);
  const { data, usage, model } = await chatJSON(p, REVIEW_SYSTEM, `Demande d'origine :\n"""${original}"""\n\nInstruction préparée :\n"""${prompt}"""${ctx ? `\n\nContexte :\n${ctx}` : ''}`);
  const remarques = (Array.isArray(data.remarques) ? data.remarques : [])
    .map((r: any) => ({ type: String(r.type ?? 'oubli'), texte: String(r.texte ?? '') }))
    .filter((r: any) => r.texte);
  return { provider: p, model, usage, remarques };
}

// ---------- Mode automatique ----------

export type Suggestion = {
  route: 'claude' | 'pc' | 'note';
  mode: 'direct' | 'smart';
  pc?: { action: string; arg?: string; label: string };
  reason: string;
};

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const APP_ALIASES: Record<string, string[]> = {
  vscode: ['vs code', 'vscode', 'visual studio code', 'visual studio', 'code'],
  chrome: ['chrome', 'google chrome', 'navigateur'],
  edge: ['edge'],
  terminal: ['terminal', 'invite de commande', 'powershell'],
  explorer: ['explorateur', 'explorateur de fichiers'],
  notepad: ['bloc-notes', 'bloc notes', 'notepad'],
  calc: ['calculatrice'],
  taskmgr: ['gestionnaire des taches', 'gestionnaire de taches'],
};

export function suggest(raw: string): Suggestion {
  const t = norm(raw.trim());
  const words = t.split(/\s+/).filter(Boolean).length;

  if (/\bverrouill/.test(t)) return { route: 'pc', mode: 'direct', pc: { action: 'pc.lock', label: 'Verrouiller le PC' }, reason: 'Commande Windows reconnue' };
  if (/\bredemarr/.test(t)) return { route: 'pc', mode: 'direct', pc: { action: 'pc.restart', label: 'Redémarrer le PC' }, reason: 'Commande Windows reconnue' };
  if (/\b(eteins|eteindre|extinction)\b|\barrete (le pc|l'ordinateur|l'ordi|le portable)/.test(t)) return { route: 'pc', mode: 'direct', pc: { action: 'pc.shutdown', label: 'Arrêter le PC' }, reason: 'Commande Windows reconnue' };
  if (/\b(mets? (le pc |l'ordinateur )?en veille)\b/.test(t)) return { route: 'pc', mode: 'direct', pc: { action: 'pc.sleep', label: 'Mettre en veille' }, reason: 'Commande Windows reconnue' };
  if (/\b(capture d'ecran|capture l'ecran|montre(-moi)? l'ecran|screenshot)\b/.test(t)) return { route: 'pc', mode: 'direct', pc: { action: 'pc.screenshot', label: "Capture d'écran" }, reason: 'Commande Windows reconnue' };

  const open = t.match(/^(?:ouvre|ouvrir|lance|lancer|demarre|demarrer)\s+(?:moi\s+)?(?:le |la |l'|les )?(.+)$/);
  if (open && words <= 8) {
    const target = open[1].replace(/[.!?]+$/, '').trim();
    for (const app of config.apps) {
      const aliases = APP_ALIASES[app.id] ?? [norm(app.name)];
      if (aliases.some((a) => target === a || target.startsWith(a + ' ') || norm(app.name) === target)) {
        return { route: 'pc', mode: 'direct', pc: { action: 'app.open', arg: app.id, label: `Ouvrir ${app.name}` }, reason: 'Application de ta liste' };
      }
    }
    const folderMatch = target.match(/^(?:dossier\s+(?:de |du |des )?)(.+)$/);
    if (folderMatch) {
      const name = folderMatch[1];
      const project = config.projects.find((p) => norm(p.name).includes(name) || name.includes(norm(p.name)));
      if (project) return { route: 'pc', mode: 'direct', pc: { action: 'folder.open', arg: project.path, label: `Ouvrir le dossier ${project.name}` }, reason: 'Dossier de projet' };
      const folder = config.allowedFolders.find((f) => norm(path.basename(f)).includes(name));
      if (folder) return { route: 'pc', mode: 'direct', pc: { action: 'folder.open', arg: folder, label: `Ouvrir ${path.basename(folder)}` }, reason: 'Dossier autorisé' };
    }
  }

  const vague = /\b(ameliore|moderne|refais|optimise|nettoie|revois|tout fonctionne|verifie que tout|plus joli|plus propre|repense|restructure)\b/.test(t);
  if (words > 35 || (vague && words > 6)) return { route: 'claude', mode: 'smart', reason: words > 35 ? 'Demande longue : mieux vaut la structurer' : 'Demande ouverte : mieux vaut la préciser' };
  return { route: 'claude', mode: 'direct', reason: 'Instruction courte et claire' };
}

export { AiError };
