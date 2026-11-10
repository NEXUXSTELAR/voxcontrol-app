// Jeu d'icônes dessiné pour VoxControl : grille de 24, trait de 1,75, extrémités rondes.
const P: Record<string, string> = {
  mic: 'M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3Z M6 11a6 6 0 0 0 12 0 M12 17v3.5',
  stop: 'M7.5 7.5h9v9h-9z',
  send: 'M12 19V5 M6 11l6-6 6 6',
  keyboard: 'M3.5 7.5h17v10h-17z M7 11h.01 M10 11h.01 M13 11h.01 M16 11h.01 M8 14.5h8',
  command: 'M9 9h6v6H9z M9 9V7a2 2 0 1 0-2 2h2 M15 9V7a2 2 0 1 1 2 2h-2 M9 15v2a2 2 0 1 1-2-2h2 M15 15v2a2 2 0 1 0 2-2h-2',
  chevronRight: 'M10 6l6 6-6 6',
  chevronDown: 'M6 10l6 6 6-6',
  chevronLeft: 'M14 6l-6 6 6 6',
  close: 'M6 6l12 12 M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  pc: 'M3.5 5h17v11h-17z M9 20h6 M12 16v4',
  terminal: 'M4 5.5h16v13H4z M7.5 10l2.5 2-2.5 2 M12 14.5h4',
  gear: 'M18.80 9.63L21.19 10.04L21.19 13.96L18.80 14.37L18.49 15.13L19.89 17.12L17.12 19.89L15.13 18.49L14.37 18.80L13.96 21.19L10.04 21.19L9.63 18.80L8.87 18.49L6.88 19.89L4.11 17.12L5.51 15.13L5.20 14.37L2.81 13.96L2.81 10.04L5.20 9.63L5.51 8.87L4.11 6.88L6.88 4.11L8.87 5.51L9.63 5.20L10.04 2.81L13.96 2.81L14.37 5.20L15.13 5.51L17.12 4.11L19.89 6.88L18.49 8.87Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  lock: 'M6 10.5h12v9H6z M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5',
  power: 'M12 3.5v8 M7.2 6.6a7 7 0 1 0 9.6 0',
  restart: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3 M4.5 4.5v4h4',
  moon: 'M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z',
  camera: 'M4 8h3.5L9 5.5h6L16.5 8H20v11H4z M12 10.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  folder: 'M3.5 6.5h6l2 2h9v10h-17z',
  file: 'M6.5 3.5h7l4 4v13h-11z M13.5 3.5v4h4',
  download: 'M12 4v11 M7 10.5l5 5 5-5 M5 19.5h14',
  upload: 'M12 15.5v-11 M7 9l5-5 5 5 M5 19.5h14',
  copy: 'M8.5 8.5h11v11h-11z M15.5 8.5v-4h-11v11h4',
  refine: 'M4 7h9 M17 7h3 M15 5v4 M4 17h3 M11 17h9 M9 15v4 M4 12h5 M13 12h7 M11 10v4',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  trash: 'M4.5 7h15 M9.5 7V4.5h5V7 M6.5 7l1 12.5h9l1-12.5',
  plus: 'M12 5v14 M5 12h14',
  shield: 'M12 3.5l7 2.5v5.5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z',
  key: 'M8.5 11a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M11.3 12.2L19.5 4 M16 7.5l2.5 2.5 M18 5.5l2 2',
  bell: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z M10 20.5h4',
  clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z M12 8v4.5l3 2',
  external: 'M13.5 4.5h6v6 M19.5 4.5l-8 8 M10 6H4.5v13.5H18V14',
  search: 'M10.5 4.5a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z M15 15l4.5 4.5',
  network: 'M4 9.5a11.5 11.5 0 0 1 16 0 M7 13a7 7 0 0 1 10 0 M10 16.5a2.5 2.5 0 0 1 4 0 M12 19.5h.01',
  window: 'M3.5 5h17v14h-17z M3.5 9h17',
  play: 'M8 5.5v13l10-6.5z',
  bolt: 'M13 3.5L5.5 13.5H12L11 20.5l7.5-10H12z',
  wave: 'M3 12h2 M7 8v8 M11 5v14 M15 9v6 M19 11v2',
  remote: 'M3.5 4.5h17v11h-17z M8 19.5h8 M12 15.5v4 M10 8.5l4 2.5-4 2.5z',
  note: 'M5.5 4.5h13v15h-13z M8.5 9h7 M8.5 12.5h7 M8.5 16h4',
  alert: 'M12 4l8.5 15h-17z M12 10v4 M12 16.8h.01',
  history: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3 M4.5 4.5v4h4 M12 8.5V12l2.5 1.5',
  more: 'M6 12h.01 M12 12h.01 M18 12h.01',
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 20, className, label }: { name: IconName; size?: number; className?: string; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <path d={P[name]} />
    </svg>
  );
}
