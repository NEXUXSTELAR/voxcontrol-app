import { useEffect, useState } from 'react';
import { useStore } from '../api';
import { performRegistration, performStepUp, prepareRegistration, prepareStepUp } from '../actions';
import { nav, toast } from '../nav';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/kit';

/**
 * Confirmation d'une action sensible. Sur le téléphone, Face ID est obligatoire ;
 * sur le PC lui-même, un simple bouton suffit (tu es devant l'écran).
 */
export function ConfirmSheet(props: { level: number; docked: boolean; action: string; label: string; detail?: string; run: (stepUp?: string) => Promise<unknown> }) {
  const caller = useStore((s) => s.state?.caller);
  const lvl = useStore((s) => s.state?.levels[props.action]?.level ?? 2);
  const [options, setOptions] = useState<any>(null);
  const [regOptions, setRegOptions] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const device = caller?.kind === 'device';
  const hasPasskey = caller?.kind === 'device' && caller.passkey;

  useEffect(() => {
    if (!device) return;
    if (hasPasskey) prepareStepUp(props.action).then(setOptions).catch((e) => setError(e.message));
    else prepareRegistration().then(setRegOptions).catch((e) => setError(e.message));
  }, [device, hasPasskey, props.action]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = device ? await performStepUp(options) : undefined;
      await props.run(token);
      nav.close();
      toast(`${props.label} : fait`, 'ok');
    } catch (e: any) {
      setError(e?.name === 'NotAllowedError' ? 'Face ID annulé.' : e.message);
      if (device) prepareStepUp(props.action).then(setOptions).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const register = async () => {
    setBusy(true);
    setError(null);
    try {
      await performRegistration(regOptions);
      toast('Face ID activé', 'ok');
    } catch (e: any) {
      setError(e?.name === 'NotAllowedError' ? 'Activation annulée.' : e.message);
      prepareRegistration().then(setRegOptions).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={props.label}
      level={props.level}
      docked={props.docked}
      foot={
        device && !hasPasskey ? (
          <button className="btn ink block" disabled={busy || !regOptions} onClick={register}>
            <Icon name="shield" size={18} /> Activer Face ID
          </button>
        ) : (
          <div className="btns">
            <button className="btn" onClick={() => nav.close()}>
              Annuler
            </button>
            <button className={`btn ${lvl >= 3 || /shutdown|restart|kill|delete|revoke/.test(props.action) ? 'danger' : 'primary'}`} style={{ flex: 2 }} disabled={busy || (device && !options)} onClick={confirm}>
              {device ? <Icon name="shield" size={18} /> : null} {device ? 'Confirmer avec Face ID' : 'Confirmer'}
            </button>
          </div>
        )
      }
    >
      {props.detail && <p style={{ marginTop: 0 }}>{props.detail}</p>}
      {device && !hasPasskey ? (
        <p className="soft" style={{ marginTop: 0 }}>
          Les actions sensibles se confirment avec Face ID. Active-le une fois pour cet iPhone : la clé reste dans ton trousseau, le PC ne voit jamais ton visage.
        </p>
      ) : (
        <p className="soft" style={{ marginTop: 0 }}>
          {props.action === 'pc.restart' || props.action === 'pc.shutdown'
            ? 'Le PC attendra 60 secondes : tu pourras encore annuler depuis le fil ou la palette.'
            : 'Cette action est enregistrée dans le journal.'}
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </Sheet>
  );
}
