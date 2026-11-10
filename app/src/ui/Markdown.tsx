import type { ReactNode } from 'react';

/**
 * Mise en forme légère des réponses de Claude : titres, listes, code, gras, code en ligne.
 * Construit des éléments React (jamais de HTML injecté) : un texte piégé ne peut rien exécuter.
 */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      out.push(
        <pre key={key++} className="md-code mono">
          {code.join('\n')}
        </pre>,
      );
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      out.push(
        <div key={key++} className={`md-h md-h${h[1].length}`}>
          {inline(h[2])}
        </div>,
      );
      i++;
      continue;
    }
    if (/^\s*([-*]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+[.)])\s+/, ''));
      const L = ordered ? 'ol' : 'ul';
      out.push(
        <L key={key++} className="md-list">
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </L>,
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*([-*]|\d+[.)])\s+)/.test(lines[i])) para.push(lines[i++]);
    out.push(
      <p key={key++} className="md-p">
        {inline(para.join(' '))}
      </p>,
    );
  }
  return <div className="md">{out}</div>;
}

function inline(s: string): ReactNode[] {
  const parts = s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`') && p.length > 2) return <code key={i} className="md-inline mono">{p.slice(1, -1)}</code>;
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <strong key={i}>{p.slice(2, -2)}</strong>;
    return p;
  });
}
