import { config } from './config.ts';
import { monthSpend, recordSpend } from './db.ts';
import { getSecret } from './secrets.ts';

export type LiveSession = { push: (pcm: Buffer) => void; end: () => void };

/**
 * Relais de transcription en direct. Le téléphone envoie du PCM 16 bits mono à 16 kHz ;
 * les morceaux de texte reviennent au fil de la parole.
 */
export function startLive(h: { onDelta: (t: string) => void; onDone: (t: string) => void; onError: (m: string) => void }): LiveSession {
  const queue: Buffer[] = [];
  let ended = false;
  let wake: (() => void) | null = null;
  let bytes = 0;

  const key = getSecret('mistral');
  const total = monthSpend().reduce((s, r) => s + r.usd, 0);
  if (!key || (config.monthlyCapUsd > 0 && total >= config.monthlyCapUsd)) {
    h.onError(!key ? 'Aucune clé Mistral.' : 'Plafond mensuel atteint.');
    return { push() {}, end() {} };
  }

  async function* audio(): AsyncGenerator<Uint8Array> {
    while (true) {
      if (queue.length) {
        const b = queue.shift()!;
        bytes += b.length;
        yield new Uint8Array(b);
        continue;
      }
      if (ended) return;
      await new Promise<void>((r) => (wake = r));
    }
  }

  (async () => {
    let text = '';
    try {
      // Chargé à la demande : le kit Mistral ralentirait le démarrage de l'agent.
      const { RealtimeTranscription } = await import('@mistralai/mistralai/extra/realtime');
      const client = new RealtimeTranscription({ apiKey: key, serverURL: 'wss://api.mistral.ai' });
      for await (const ev of client.transcribeStream(audio(), config.realtimeModel, { audioFormat: { encoding: 'pcm_s16le', sampleRate: 16000 } } as any)) {
        const e = ev as any;
        if (e.type === 'transcription.text.delta') {
          text += e.text;
          h.onDelta(e.text);
        } else if (e.type === 'transcription.done') {
          if (typeof e.text === 'string' && e.text) text = e.text;
          break;
        } else if (e.type === 'error') {
          throw new Error(typeof e.error?.message === 'string' ? e.error.message : 'Erreur de transcription en direct.');
        }
      }
      h.onDone(text.trim());
    } catch (err: any) {
      h.onError(String(err?.message ?? err));
    } finally {
      const minutes = bytes / 32000 / 60;
      if (minutes > 0) recordSpend('mistral', 'transcription-direct', minutes, minutes * config.prices.transcribeRealtimePerMin);
    }
  })();

  return {
    push(pcm) {
      if (ended) return;
      queue.push(pcm);
      wake?.();
      wake = null;
    },
    end() {
      ended = true;
      wake?.();
      wake = null;
    },
  };
}
