import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');

function run(cmd: string, args: string[], timeoutMs = 10 * 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { cwd: ROOT, windowsHide: true, shell: process.platform === 'win32' && cmd === 'npm' });
    let out = '';
    const t = setTimeout(() => {
      c.kill();
      reject(new Error(`${cmd} : délai dépassé`));
    }, timeoutMs);
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    c.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
    c.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`${cmd} ${args[0]} a échoué : ${out.trim().split('\n').slice(-3).join(' ')}`));
    });
  });
}

const version = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version as string;

export async function check(): Promise<{ current: string; behind: number; latest: string | null }> {
  await run('git', ['fetch', '--quiet', 'origin'], 60_000);
  const behind = Number((await run('git', ['rev-list', '--count', 'HEAD..@{u}'])) || 0);
  const latest = behind ? (await run('git', ['log', '-1', '--format=%s', '@{u}'])).slice(0, 120) : null;
  return { current: version(), behind, latest };
}

/** Récupère la nouvelle version, réinstalle et reconstruit. Refuse si des fichiers locaux ont été modifiés. */
export async function apply(): Promise<{ version: string; steps: string[] }> {
  const dirty = await run('git', ['status', '--porcelain', '--untracked-files=no']);
  if (dirty) throw new Error('Des fichiers du programme ont été modifiés sur le PC : mise à jour annulée pour ne rien écraser.');
  const steps: string[] = [];
  await run('git', ['pull', '--ff-only', '--quiet']);
  steps.push('Nouvelle version récupérée');
  await run('npm', ['ci', '--no-audit', '--no-fund']);
  steps.push('Dépendances installées');
  await run('npm', ['run', 'build']);
  steps.push('Application reconstruite');
  return { version: version(), steps };
}
