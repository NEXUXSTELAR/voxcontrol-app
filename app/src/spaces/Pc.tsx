import { useEffect, useRef, useState } from 'react';
import { api, useStore } from '../api';
import { OpRow } from '../shared';
import { runAction } from '../actions';
import { bytes, duration } from '../format';
import { nav, toast } from '../nav';
import { Icon, type IconName } from '../ui/Icon';
import { useAsync } from '../ui/kit';

/** Espace PC : l'appareil d'abord, puis six actions. Le détail s'ouvre en feuille. */
export function PcSpace() {
  const m = useStore((s) => s.metrics);
  const st = useStore((s) => s.state);
  const conn = useStore((s) => s.conn);
  const shot = useAsync();
  const [shotVersion, setShotVersion] = useState(0);
  const power = useStore((s) => s.powerPending);
  const ops = useStore((s) => s.ops);
  const recent = ops.filter((o) => o.kind === 'pc').slice(0, 5);
  const online = conn === 'online';
  const memPct = m ? Math.round((100 * m.memUsed) / m.memTotal) : 0;
  const c = m?.disks.find((d) => d.name === 'C:') ?? m?.disks[0];

  const takeShot = () =>
    shot.run(async () => {
      const blob = await api<Blob>('/api/pc/screenshot');
      nav.open({ kind: 'screenshot', url: URL.createObjectURL(blob) });
      setShotVersion((v) => v + 1);
    });

  const remote = () => {
    if (!st?.rdp) {
      toast('Bureau à distance pas encore activé : lance scripts\\enable-rdp.ps1 sur le PC (voir le guide).', 'error');
      return;
    }
    const host = st.tailscale.dnsName;
    if (host) {
      navigator.clipboard?.writeText(host).catch(() => {});
      toast(`Adresse copiée. Ouvre Windows App et ajoute ${host}.`);
    }
  };

  const actions: { icon: IconName; label: string; run: () => void; busy?: boolean }[] = [
    { icon: 'camera', label: shot.busy ? 'Capture…' : 'Voir l’écran', run: takeShot, busy: shot.busy },
    { icon: 'lock', label: 'Verrouiller', run: () => runAction('pc.lock') },
    { icon: 'window', label: 'Applications', run: () => nav.open({ kind: 'apps' }) },
    { icon: 'folder', label: 'Fichiers', run: () => nav.open({ kind: 'files' }) },
    { icon: 'remote', label: 'Bureau à distance', run: remote },
    { icon: 'power', label: 'Alimentation', run: () => nav.open({ kind: 'power' }) },
  ];

  return (
    <div className="space" data-space="pc">
      {power && <PowerBanner kind={power.kind} at={power.at} />}
      <section className="device">
        <LaptopWithScreen online={online} version={shotVersion + (st?.lastShotAt ? 1 : 0)} />
        <div className="device-name">{st?.config.pcName ?? 'Mon PC'}</div>
        <div className="device-state">
          <span className={`dot ${online ? 'on' : 'off'}`} />
          {online ? `Connecté${m ? ` · allumé depuis ${duration(m.uptime)}` : ''}` : 'Injoignable'}
        </div>
        {m && online && (
          <div className="stats">
            <div>
              <b>{m.cpu}</b>
              <small>%</small>
              <span>Processeur</span>
            </div>
            <div>
              <b>{memPct}</b>
              <small>%</small>
              <span>Mémoire</span>
            </div>
            <div>
              <b>{c ? bytes(c.free).split(' ')[0] : '–'}</b>
              <small>{c ? bytes(c.free).split(' ')[1] : ''}</small>
              <span>Libres</span>
            </div>
          </div>
        )}
      </section>

      <div className="actions-grid">
        {actions.map((a) => (
          <button key={a.label} className="action" data-tone={a.icon === "power" ? "danger" : undefined} onClick={a.run} disabled={!online || a.busy}>
            <Icon name={a.icon} size={24} />
            <span>{a.label}</span>
          </button>
        ))}
      </div>
      {shot.error && <p className="error">{shot.error}</p>}

      {recent.length > 0 && (
        <>
          <div className="group" style={{ padding: '22px 0 2px' }}>
            <span>Dernières actions</span>
          </div>
          <div style={{ margin: '0 -16px' }}>
            {recent.map((o) => (
              <OpRow key={o.id} op={o} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Coins de l'écran dans laptop.webp, mesurés sur l'image (fractions de largeur et de hauteur).
const SCREEN = { tl: [0.0644, 0.128], tr: [0.6522, 0.0536], br: [0.7, 0.5491], bl: [0.1333, 0.6726] } as const;

/** Transformation qui projette un rectangle w × h sur un quadrilatère (perspective). */
function quadMatrix(w: number, h: number, q: number[][]) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den;
  const hh = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + hh * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + hh * y3;
  return `matrix3d(${[a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, x0, y0, 0, 1].join(',')})`;
}

/** L'ordinateur 3D, avec la dernière capture d'écran posée dans son écran. */
function LaptopWithScreen({ online, version }: { online: boolean; version: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!version) return;
    let revoke: string | null = null;
    api<Blob>('/api/pc/screenshot/last')
      .then((b) => {
        revoke = URL.createObjectURL(b);
        setUrl(revoke);
      })
      .catch(() => setUrl(null));
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [version]);

  const q = size ? [SCREEN.tl, SCREEN.tr, SCREEN.br, SCREEN.bl].map(([x, y]) => [x * size.w, y * size.h]) : null;
  return (
    <div className="laptop" ref={box}>
      <img src="/art/laptop.webp" alt="" className={online ? '' : 'off'} draggable={false} />
      {url && q && online && (
        <img className="laptop-screen" src={url} alt="Dernière capture de l'écran du PC" style={{ width: 100, height: 100, transform: quadMatrix(100, 100, q) }} />
      )}
    </div>
  );
}

function PowerBanner({ kind, at }: { kind: 'restart' | 'shutdown'; at: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.round((at - now) / 1000));
  return (
    <div className="power-banner" role="alert">
      <Icon name={kind === 'restart' ? 'restart' : 'power'} />
      <span>
        {kind === 'restart' ? 'Redémarrage' : 'Arrêt'} dans <b>{left} s</b>
      </span>
      <button className="btn sm" onClick={() => runAction('pc.cancel')}>
        Annuler
      </button>
    </div>
  );
}
