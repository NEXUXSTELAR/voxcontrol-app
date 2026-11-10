import { useEffect, useRef, useState, type ReactNode } from 'react';
import { nav } from '../nav';
import { Icon, type IconName } from './Icon';

export function useWide() {
  const q = '(min-width: 900px)';
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/**
 * Feuille montante. Sur grand écran, la première feuille s'affiche dans la colonne de droite
 * (« docked ») au lieu de recouvrir le fil.
 */
export function Sheet(props: { title: ReactNode; children: ReactNode; foot?: ReactNode; full?: boolean; level: number; docked?: boolean; actions?: ReactNode; onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<number | null>(null);
  const [dy, setDy] = useState(0);
  const close = props.onClose ?? (() => nav.close());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onDown = (e: React.PointerEvent) => {
    start.current = e.clientY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (start.current !== null) setDy(Math.max(0, e.clientY - start.current));
  };
  const onUp = () => {
    if (dy > 90) close();
    start.current = null;
    setDy(0);
  };

  const cls = `sheet${props.full ? ' full' : ''}${props.level > 0 ? ' lvl2' : ''}${props.docked ? ' docked' : ''}`;
  return (
    <>
      {!props.docked && <div className={`scrim${props.level > 0 ? ' lvl2' : ''}`} onClick={close} />}
      <div ref={ref} className={cls} role="dialog" aria-modal={!props.docked} style={dy ? { transform: `translateY(${dy}px)`, transition: 'none' } : undefined}>
        <div className="grab" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <i />
        </div>
        <div className="sheet-head">
          <h2>{props.title}</h2>
          {props.actions}
          <button className="icon-btn" onClick={close} aria-label="Fermer">
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-body">{props.children}</div>
        {props.foot && <div className="sheet-foot">{props.foot}</div>}
      </div>
    </>
  );
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button className="switch" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

export function Item(props: { icon?: IconName; title: ReactNode; sub?: ReactNode; end?: ReactNode; onClick?: () => void; chevron?: boolean; danger?: boolean }) {
  const inner = (
    <>
      {props.icon && (
        <span className="lead">
          <Icon name={props.icon} />
        </span>
      )}
      <span className="main">
        <div className="t">{props.title}</div>
        {props.sub && <div className="s">{props.sub}</div>}
      </span>
      {(props.end || props.chevron) && (
        <span className="end">
          {props.end}
          {props.chevron && <Icon name="chevronRight" size={18} />}
        </span>
      )}
    </>
  );
  const cls = `item${props.danger ? ' danger' : ''}`;
  return props.onClick ? (
    <button className={cls} onClick={props.onClick}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function Section({ title, children, aside }: { title?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="sec">
      {title && (
        <h3 style={aside ? { display: 'flex', justifyContent: 'space-between' } : undefined}>
          <span>{title}</span>
          {aside}
        </h3>
      )}
      {children}
    </section>
  );
}

export function useAsync() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(e?.message ?? String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}
