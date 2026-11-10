import { useEffect, useRef, useState } from 'react';

export type RecState = 'idle' | 'starting' | 'recording' | 'sending';

const MAX_SECONDS = 180;

function pickMime(): string {
  const options = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
  return options.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) ?? '';
}

/**
 * Enregistrement micro. Le flux est fermé dès l'arrêt pour que l'indicateur orange d'iOS
 * disparaisse ; le niveau sonore réel est écrit dans --level sur l'élément fourni.
 */
export function useRecorder(
  onDone: (blob: Blob, seconds: number) => void,
  levelTarget: React.RefObject<HTMLElement | null>,
  hooks: { onStream?: (ctx: AudioContext, src: MediaStreamAudioSourceNode) => void; onCancel?: () => void } = {},
) {
  const [state, setState] = useState<RecState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; ctx: AudioContext; raf: number; started: number; timer: number } | null>(null);

  const cleanup = () => {
    const r = rec.current;
    if (!r) return;
    cancelAnimationFrame(r.raf);
    clearInterval(r.timer);
    r.stream.getTracks().forEach((t) => t.stop());
    r.ctx.close().catch(() => {});
    levelTarget.current?.style.setProperty('--level', '0');
    rec.current = null;
  };

  useEffect(() => cleanup, []);

  const start = async () => {
    if (rec.current) return;
    setError(null);
    setState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = pickMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      hooks.onStream?.(ctx, src);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const rms = Math.sqrt(sum / buf.length);
        levelTarget.current?.style.setProperty('--level', Math.min(1, rms * 4).toFixed(3));
        if (rec.current) rec.current.raf = requestAnimationFrame(tick);
      };
      const started = performance.now();
      mr.onstop = () => {
        const seconds = (performance.now() - started) / 1000;
        const blob = new Blob(chunks, { type: mr.mimeType || mime || 'audio/mp4' });
        cleanup();
        if (seconds < 0.6 || blob.size < 1200) {
          setState('idle');
          setError('Trop court. Touche le micro, parle, puis touche de nouveau.');
          return;
        }
        setState('sending');
        onDone(blob, seconds);
      };
      const timer = window.setInterval(() => {
        const s = (performance.now() - started) / 1000;
        setElapsed(s);
        if (s >= MAX_SECONDS) stop();
      }, 250);
      rec.current = { mr, stream, ctx, raf: requestAnimationFrame(tick), started, timer };
      mr.start(250);
      setElapsed(0);
      setState('recording');
      navigator.vibrate?.(10);
    } catch (e: any) {
      cleanup();
      setState('idle');
      setError(
        e?.name === 'NotAllowedError'
          ? 'Micro refusé. Autorise-le dans Réglages iPhone › VoxControl (ou Safari › Micro).'
          : 'Micro indisponible sur cet appareil.',
      );
    }
  };

  const stop = () => {
    const r = rec.current;
    if (r && r.mr.state !== 'inactive') r.mr.stop();
  };

  const cancel = () => {
    hooks.onCancel?.();
    const r = rec.current;
    if (r) {
      r.mr.onstop = null;
      if (r.mr.state !== 'inactive') r.mr.stop();
    }
    cleanup();
    setState('idle');
  };

  return { state, elapsed, error, setError, start, stop, cancel, done: () => setState('idle') };
}
