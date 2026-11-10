import { readToken } from './api';

// Petit processeur audio : renvoie chaque bloc de son brut au fil de l'eau.
const WORKLET = `class VoxPcm extends AudioWorkletProcessor {
  process(inputs) { const c = inputs[0] && inputs[0][0]; if (c) this.port.postMessage(c.slice(0)); return true; }
}
registerProcessor('vox-pcm', VoxPcm);`;

/**
 * Transcription en direct : le son (PCM 16 bits, 16 kHz) part vers le PC, qui le relaie à Voxtral.
 * Le texte revient par morceaux pendant que tu parles.
 */
export class LiveTranscriber {
  private ws: WebSocket;
  private text = '';
  private settled = false;
  private resolveDone!: (t: string) => void;
  private rejectDone!: (e: Error) => void;
  private pending: ArrayBuffer[] = [];
  private nodes: AudioNode[] = [];
  readonly done: Promise<string>;

  constructor(onText: (t: string) => void) {
    this.done = new Promise((res, rej) => {
      this.resolveDone = (t) => {
        this.settled = true;
        res(t);
      };
      this.rejectDone = (e) => {
        this.settled = true;
        rej(e);
      };
    });
    this.done.catch(() => {});
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws/voice`);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => {
      const token = readToken();
      if (token) this.ws.send(JSON.stringify({ type: 'auth', token }));
      this.ws.send(JSON.stringify({ type: 'start' }));
      for (const b of this.pending) this.ws.send(b);
      this.pending = [];
    };
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'delta') {
        this.text += m.text;
        onText(this.text);
      } else if (m.type === 'done') this.resolveDone(m.text || this.text);
      else if (m.type === 'error') this.rejectDone(new Error(m.message));
    };
    this.ws.onclose = () => !this.settled && this.rejectDone(new Error('Connexion de transcription fermée.'));
  }

  async attach(ctx: AudioContext, src: MediaStreamAudioSourceNode) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(ctx, 'vox-pcm');
    // Sortie muette : certains navigateurs n'exécutent le processeur que s'il est relié à la sortie.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
    this.nodes = [node, mute];
    const ratio = ctx.sampleRate / 16000;
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const input = e.data;
      const outLen = Math.floor(input.length / ratio);
      const out = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.min(input.length, Math.floor((i + 1) * ratio));
        let sum = 0;
        for (let j = start; j < end; j++) sum += input[j];
        const v = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
        out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(out.buffer);
      else if (this.ws.readyState === WebSocket.CONNECTING) this.pending.push(out.buffer);
    };
  }

  /** Termine l'écoute et attend le texte final (au plus 8 s). */
  async finish(): Promise<string> {
    this.nodes.forEach((n) => n.disconnect());
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'stop' }));
    const timeout = new Promise<string>((_, rej) => setTimeout(() => rej(new Error('Délai dépassé.')), 8000));
    try {
      return await Promise.race([this.done, timeout]);
    } finally {
      this.ws.close();
    }
  }

  cancel() {
    this.nodes.forEach((n) => n.disconnect());
    this.ws.close();
  }
}
