/*
 * Íconos del panel: trazos simples en SVG (sin librerías), del color del texto. Cada opción del menú
 * tiene el suyo según su dirección, para encontrar las cosas de un vistazo.
 */

const PATHS = {
  home: "M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5",
  message: "M4 5h16v11H8l-4 4V5z",
  chat: "M3 6h12v8H7l-4 3V6zM15 9h6v8l-3-2h-6v-1",
  clipboard: "M9 4h6v3H9zM7 5H5v16h14V5h-2M8.5 13l2.5 2.5 4.5-5",
  book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5zM4 19a2 2 0 0 1 2-2h13",
  planner: "M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M8 13h4M8 16h7",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  shield: "M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3z",
  users:
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3",
  wallet: "M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zM3 7l12-4v4M16 13.5h2",
  transfer: "M4 8h14l-4-4M20 16H6l4 4",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  leave:
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 11-5.7M17 14v4l2.5 1.5M17 21a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  staff: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 12-4.9M19 15v2M19 21v.01M16 18h6",
  megaphone: "M3 10v4h4l7 5V5L7 10H3zM18 8a5 5 0 0 1 0 8",
  calendar: "M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01",
  file: "M6 3h8l5 5v13H6V3zM14 3v5h5M9 13h7M9 17h7",
  library: "M4 4h4v16H4zM10 4h4v16h-4zM16 5l4 1-3 14-4-1",
  inbox: "M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6l2-8z",
  layers: "M12 3 3 8l9 5 9-5-9-5zM3 13l9 5 9-5",
  download: "M12 3v12M7 10l5 5 5-5M4 21h16",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  building: "M4 21V7l8-4 8 4v14M9 21v-5h6v5M8 10h.01M12 10h.01M16 10h.01M8 13.5h.01M16 13.5h.01",
  help: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5v.7M12 17h.01",
  grades: "M4 4h16v16H4zM8 15l2.5-6 2.5 6M9 13h3M16 9v6M14 12h4",
  family:
    "M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20a5 5 0 0 1 10 0M12 20a5 5 0 0 1 10 0",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  check: "M5 12.5 10 17l9-10",
  alert: "M12 4 2 20h20L12 4zM12 10v4M12 17h.01",
  arrow: "M5 12h14M13 6l6 6-6 6",
  plus: "M12 5v14M5 12h14",
  user: "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`${className} shrink-0`}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** El ícono de cada opción del menú, por su dirección (la más específica primero). */
const BY_HREF: Array<[string, IconName]> = [
  ["/panel/region/indicadores", "chart"],
  ["/panel/region", "globe"],
  ["/panel/familia", "family"],
  ["/panel/mis-notas", "grades"],
  ["/panel/pagos", "wallet"],
  ["/panel/mensajes", "message"],
  ["/panel/chats", "chat"],
  ["/panel/cuaderno", "clipboard"],
  ["/panel/aula", "book"],
  ["/panel/planificacion", "planner"],
  ["/panel/horario", "clock"],
  ["/panel/conducta", "shield"],
  ["/panel/alumnos", "users"],
  ["/panel/traslados", "transfer"],
  ["/panel/seguimiento", "chart"],
  ["/panel/licencias", "leave"],
  ["/panel/usuarios", "staff"],
  ["/panel/avisos", "megaphone"],
  ["/panel/calendario", "calendar"],
  ["/panel/documentos", "file"],
  ["/panel/biblioteca", "library"],
  ["/panel/solicitudes", "inbox"],
  ["/panel/estructura", "layers"],
  ["/panel/exportar", "download"],
  ["/panel/cierre", "flag"],
  ["/panel/bitacora", "list"],
  ["/panel/colegio", "building"],
  ["/panel/colegios", "building"],
  ["/panel/departamentos", "globe"],
  ["/panel/ayuda", "help"],
  ["/panel/cuenta", "user"],
];

export function iconForHref(href: string): IconName {
  if (href === "/panel") return "home";
  return BY_HREF.find(([prefix]) => href.startsWith(prefix))?.[1] ?? "arrow";
}
