/** Sesiones de referencia de los principales centros FX.
 * NO son el horario contractual de XAUUSD del bróker ni modifican las ventanas del EA.
 * Cada sesión se calcula en la zona IANA de su ciudad para respetar cambios DST reales.
 */
export type SessionId = "tokyo" | "london" | "newyork";
export type DisplayZone = "rd" | "utc" | "broker";
export type SessionWindow = {
  id: SessionId;
  name: string;
  cityZone: string;
  localHours: string;
  color: string;
  openUtcMs: number;
  closeUtcMs: number;
};
export const SESSIONS: readonly {
  id: SessionId; name: string; cityZone: string;
  opens: number; closes: number; color: string; description: string;
}[] = [
  { id: "tokyo", name: "Tokio · Asia", cityZone: "Asia/Tokyo", opens: 9, closes: 18, color: "#b998e4",
    description: "Actividad del centro de Tokio; no confundir con el rango ALB del EA." },
  { id: "london", name: "Londres", cityZone: "Europe/London", opens: 8, closes: 17, color: "#83afd0",
    description: "Ventana del centro financiero de Londres. Ajuste BST/GMT automático." },
  { id: "newyork", name: "Nueva York", cityZone: "America/New_York", opens: 8, closes: 17, color: "#d8ad61",
    description: "Ventana del centro de Nueva York. Ajuste EDT/EST automático." },
];
const dayMs = 86400000;
const partFormatters = new Map<string, Intl.DateTimeFormat>();
function localParts(dateMs: number, zone: string) {
  let formatter = partFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    });
    partFormatters.set(zone, formatter);
  }
  const values: Record<string, number> = {};
  for (const p of formatter.formatToParts(new Date(dateMs))) {
    if (p.type !== "literal") values[p.type] = Number(p.value);
  }
  return values;
}

/** Convertir hora de pared local a instante UTC sin fijar offsets de verano/invierno. */
export function wallTimeToUtc(y: number, mo: number, d: number, hour: number, zone: string): number {
  const target = Date.UTC(y, mo - 1, d, hour);
  let candidate = target;
  // Iteración de punto fijo: permite tanto UTC+9 (Tokio) como GMT/BST y EST/EDT.
  for (let i = 0; i < 4; i++) {
    const p = localParts(candidate, zone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const diff = target - seen;
    if (diff === 0) return candidate;
    candidate += diff;
  }
  return candidate;
}

/** Usar fechas CIVILES de la ciudad para respetar los días laborables locales. */
export function sessionWindows(fromUtcMs: number, toUtcMs: number): SessionWindow[] {
  if (!Number.isFinite(fromUtcMs) || !Number.isFinite(toUtcMs) || fromUtcMs > toUtcMs) return [];
  const from = Math.floor(fromUtcMs / dayMs) * dayMs - 2 * dayMs;
  const to = Math.floor(toUtcMs / dayMs) * dayMs + 2 * dayMs;
  const windows: SessionWindow[] = [];
  for (let civil = from; civil <= to && windows.length < 400; civil += dayMs) {
    const day = new Date(civil);
    // El mismo calendario civil (año/mes/día) tiene el mismo día de la semana.
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
    const y = day.getUTCFullYear(), mo = day.getUTCMonth() + 1, d = day.getUTCDate();
    for (const s of SESSIONS) {
      const openUtcMs = wallTimeToUtc(y, mo, d, s.opens, s.cityZone);
      const closeUtcMs = wallTimeToUtc(y, mo, d, s.closes, s.cityZone);
      if (openUtcMs > toUtcMs || closeUtcMs < fromUtcMs) continue;
      windows.push({ id: s.id, name: s.name, cityZone: s.cityZone,
        localHours: String(s.opens).padStart(2, "0") + ":00–" + String(s.closes).padStart(2, "0") + ":00",
        color: s.color, openUtcMs, closeUtcMs });
    }
  }
  return windows.sort((a, b) => a.openUtcMs - b.openUtcMs);
}

export function sessionStatus(nowUtcMs: number) {
  const windows = sessionWindows(nowUtcMs - dayMs, nowUtcMs + 8 * dayMs);
  return SESSIONS.map(s => {
    const same = windows.filter(w => w.id === s.id);
    const active = same.find(w => w.openUtcMs <= nowUtcMs && nowUtcMs < w.closeUtcMs);
    const next = same.find(w => w.openUtcMs > nowUtcMs);
    const shown = active ?? next;
    return { spec: s, active: !!active, window: shown,
      nextChangeMs: active ? active.closeUtcMs : next?.openUtcMs ?? null };
  });
}

export function formatSessionTime(instantMs: number, zone: DisplayZone, brokerOffsetSec?: number | null, showDate = false) {
  if (zone === "broker" && brokerOffsetSec == null) return "No disponible";
  const ms = zone === "broker" ? instantMs + (brokerOffsetSec || 0) * 1000 : instantMs;
  const tz = zone === "broker" || zone === "utc" ? "UTC" : "America/Santo_Domingo";
  return new Intl.DateTimeFormat("es-DO", {
    timeZone: tz, ...(showDate ? { weekday: "short", day: "2-digit", month: "short" } : {}),
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(new Date(ms));
}

export function countdown(targetMs: number | null, nowMs: number) {
  if (targetMs == null) return "—";
  const total = Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return (h >= 24 ? Math.floor(h / 24) + "d " : "") +
    String(h % 24).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

/** Proyección de instantes reales a timestamps naive usados en el gráfico del bróker.
 * brokerOffsetSec debe proceder de una cotización sincronizada, NO de la zona del usuario.
 */
export function chartSessionWindows(fromBrokerSec: number, toBrokerSec: number, brokerOffsetSec: number) {
  const utcFrom = (fromBrokerSec - brokerOffsetSec) * 1000;
  const utcTo = (toBrokerSec - brokerOffsetSec) * 1000;
  return sessionWindows(utcFrom, utcTo).map(w => ({
    id: w.id, name: w.name, t0: w.openUtcMs / 1000 + brokerOffsetSec,
    t1: w.closeUtcMs / 1000 + brokerOffsetSec, color: w.color
  }));
}
