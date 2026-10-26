// Temas de color del gráfico. Cada tema define el lienzo, las velas y los colores de las capas
// (rangos, niveles, órdenes de las estrategias, operaciones y zonas de riesgo/beneficio).
export type ChartTheme = {
  id: string; name: string; light?: boolean;
  bg: string; grid: string; text: string; border: string; crosshair: string;
  up: string; down: string; wickUp: string; wickDown: string;
  zone: { asia: string; tokyo: string; aorb: string };
  level: { pd: string; open: string; r50: string };
  buy: string; sell: string; entry: string; sl: string; tp: string;
  win: string; loss: string; forecast: string; tagBg: string; tagText: string;
};

const base = {
  zone: { asia: "#4c8dff", tokyo: "#b47cff", aorb: "#f0883e" },
  buy: "#2f81f7", sell: "#f0883e", forecast: "#e0b04f",
};

export const THEMES: ChartTheme[] = [
  { id: "grafito", name: "Grafito", ...base, bg: "#0e141d", grid: "#171f2b", text: "#8d98aa", border: "#222c3a", crosshair: "#5e697b",
    up: "#16b07a", down: "#e5484d", wickUp: "#16b07a", wickDown: "#e5484d", level: { pd: "#b4bed2", open: "#8d98aa", r50: "#d8a23c" },
    entry: "#9aa4b8", sl: "#e5484d", tp: "#16b07a", win: "#16b07a", loss: "#e5484d", forecast: "#d8a23c", tagBg: "rgba(14,20,29,.9)", tagText: "#e8ecf2" },
  { id: "tv", name: "Clásico oscuro", ...base, bg: "#131722", grid: "#1e222d", text: "#b2b5be", border: "#2a2e39", crosshair: "#758696",
    up: "#089981", down: "#f23645", wickUp: "#089981", wickDown: "#f23645", level: { pd: "#d1d4dc", open: "#9598a1", r50: "#f7c548" },
    entry: "#b2b5be", sl: "#f23645", tp: "#089981", win: "#089981", loss: "#f23645", tagBg: "rgba(19,23,34,.9)", tagText: "#d1d4dc" },
  { id: "noche", name: "Medianoche", ...base, bg: "#0a1222", grid: "#13203a", text: "#8fa3c7", border: "#1f2f52", crosshair: "#5a6f99",
    up: "#2ec4b6", down: "#ff6b81", wickUp: "#2ec4b6", wickDown: "#ff6b81", zone: { asia: "#5aa9ff", tokyo: "#c38bff", aorb: "#ffa65c" },
    level: { pd: "#c4d3f0", open: "#8fa3c7", r50: "#ffd166" }, entry: "#a8b8d8", sl: "#ff6b81", tp: "#2ec4b6", win: "#2ec4b6", loss: "#ff6b81",
    tagBg: "rgba(10,18,34,.9)", tagText: "#e3ebff" },
  { id: "oro", name: "Oro negro", ...base, bg: "#0a0a0a", grid: "#17140f", text: "#b5a47c", border: "#2a2418", crosshair: "#6e6146",
    up: "#e0b04f", down: "#5f6672", wickUp: "#e0b04f", wickDown: "#7c8494", zone: { asia: "#e0b04f", tokyo: "#c9a0ff", aorb: "#ff9f5a" },
    level: { pd: "#e9dcb8", open: "#a89a76", r50: "#f3cd7a" }, buy: "#e0b04f", sell: "#9aa3b2", entry: "#cdbf98", sl: "#ff6b5e", tp: "#7fd6a4",
    win: "#e0b04f", loss: "#ff6b5e", forecast: "#f3cd7a", tagBg: "rgba(10,10,10,.9)", tagText: "#f3e6c3" },
  { id: "mono", name: "Monocromo", ...base, bg: "#111214", grid: "#1b1c1f", text: "#9a9ca3", border: "#2a2c31", crosshair: "#6b6e76",
    up: "#e8e9ec", down: "#5d6068", wickUp: "#c9cbd0", wickDown: "#7d8088", zone: { asia: "#c9cbd0", tokyo: "#9aa0aa", aorb: "#b8b0a0" },
    level: { pd: "#d6d8dc", open: "#9a9ca3", r50: "#c8c2b0" }, buy: "#d6d8dc", sell: "#8f939b", entry: "#b8bac0", sl: "#f07167", tp: "#7bd389",
    win: "#7bd389", loss: "#f07167", forecast: "#e8e9ec", tagBg: "rgba(17,18,20,.9)", tagText: "#f1f2f4" },
  { id: "contraste", name: "Alto contraste", ...base, bg: "#000000", grid: "#1f1f1f", text: "#e0e0e0", border: "#3a3a3a", crosshair: "#9e9e9e",
    up: "#00e676", down: "#ff1744", wickUp: "#00e676", wickDown: "#ff1744", zone: { asia: "#40c4ff", tokyo: "#e040fb", aorb: "#ffab40" },
    level: { pd: "#ffffff", open: "#bdbdbd", r50: "#ffd740" }, buy: "#40c4ff", sell: "#ffab40", entry: "#e0e0e0", sl: "#ff1744", tp: "#00e676",
    win: "#00e676", loss: "#ff1744", forecast: "#ffd740", tagBg: "rgba(0,0,0,.92)", tagText: "#ffffff" },
  { id: "papel", name: "Papel (claro)", light: true, ...base, bg: "#ffffff", grid: "#eef1f6", text: "#4a5262", border: "#d8dde6", crosshair: "#9aa3b2",
    up: "#089981", down: "#f23645", wickUp: "#089981", wickDown: "#f23645", zone: { asia: "#2962ff", tokyo: "#8e24aa", aorb: "#ef6c00" },
    level: { pd: "#37404f", open: "#6b7487", r50: "#b7791f" }, buy: "#2962ff", sell: "#ef6c00", entry: "#6b7487", sl: "#e53935", tp: "#089981",
    win: "#089981", loss: "#e53935", forecast: "#b7791f", tagBg: "rgba(255,255,255,.94)", tagText: "#1f2633" },
];

export const themeById = (id?: string) => THEMES.find((t) => t.id === id) || THEMES[0];

/** Color con transparencia a partir de #rrggbb. */
export function alpha(hex: string, a: number) {
  if (!hex.startsWith("#")) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export type ChartPrefs = { theme: string; candles: "rellenas" | "huecas"; grid: boolean; rr: boolean };
export const DEFAULT_PREFS: ChartPrefs = { theme: "grafito", candles: "rellenas", grid: true, rr: true };
