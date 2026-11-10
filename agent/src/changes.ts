import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function git(cwd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const c = spawn('git', args, { cwd, windowsHide: true });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.on('error', () => resolve({ code: -1, out: '' }));
    c.on('close', (code) => resolve({ code: code ?? -1, out }));
  });
}

export type FileChange = { path: string; status: 'modifié' | 'nouveau' | 'supprimé' | 'inconnu'; diff: string | null };

const MAX = 60_000;

/**
 * Changements des fichiers touchés par Claude pendant une tâche.
 * Dans un dépôt Git : différences par rapport au dernier commit. Sinon : la liste seule.
 */
export async function diffFor(cwd: string, files: string[]): Promise<{ git: boolean; files: FileChange[] }> {
  const unique = [...new Set(files)].slice(0, 40);
  const inRepo = (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).out.trim() === 'true';
  if (!inRepo) {
    return { git: false, files: unique.map((f) => ({ path: f, status: fs.existsSync(f) ? 'modifié' : 'supprimé', diff: null })) };
  }
  const result: FileChange[] = [];
  let budget = MAX;
  for (const f of unique) {
    const rel = path.relative(cwd, f) || f;
    const tracked = (await git(cwd, ['ls-files', '--error-unmatch', '--', rel])).code === 0;
    let diff = '';
    let status: FileChange['status'] = 'modifié';
    if (tracked) {
      diff = (await git(cwd, ['diff', '--no-color', '--no-ext-diff', 'HEAD', '--', rel])).out;
      if (!fs.existsSync(f)) status = 'supprimé';
    } else if (fs.existsSync(f)) {
      status = 'nouveau';
      const content = fs.readFileSync(f, 'utf8').slice(0, 8000).replace(/\r?\n$/, '');
      diff = content.split('\n').map((l) => `+${l}`).join('\n');
    } else status = 'supprimé';
    const cut = diff.slice(0, Math.max(0, budget));
    budget -= cut.length;
    result.push({ path: rel, status, diff: cut || null });
  }
  return { git: true, files: result };
}
