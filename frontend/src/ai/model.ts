// IA en el navegador: modelo de entradas (árboles exportados de HistGradientBoosting), cono de predicción
// e historial por escenario. Los modelos se entrenaron con XAUUSD M1 2024-2026 y se validaron fuera de muestra.
import type { FeatRow } from "./features";

export const CLASSES = ["TP", "SL", "TIEMPO+", "TIEMPO-"];
const NEUTRAL = ["hour", "dow", "atr", "atr_rank", "rv60", "rv240", "er60", "er240", "day_rng", "asia_w", "spread", "vol_ratio", "since_open"];

type Entry = {
  features: string[]; classes: number[]; baseline: number[]; n_class: number; n_iter: number; offsets: number[]; n_nodes: number;
  f: Int16Array; thr: Float64Array; miss: Uint8Array; left: Uint16Array; right: Uint16Array; val: Float32Array;
  class_r: Record<string, number>; meta: any;
};
export type Models = { entry: Entry; forecast: { tables: Record<string, Record<string, { q: number[]; up: number; n: number }>>; meta: any }; scen: { overall: Record<string, any>; table: Record<string, any> }; version: number };

function dec<T>(b64: string, C: any): T {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new C(u8.buffer) as T;
}

let cache: Promise<Models> | null = null;
export function loadModels(url = "/ai/models.json"): Promise<Models> {
  if (!cache) cache = fetch(url).then((r) => { if (!r.ok) throw new Error("No se pudo cargar la IA"); return r.json(); }).then(parseModels);
  return cache;
}
export function parseModels(j: any): Models {
  const e = j.entry;
  e.f = dec<Int16Array>(e.f, Int16Array); e.thr = dec<Float64Array>(e.thr, Float64Array); e.miss = dec<Uint8Array>(e.miss, Uint8Array);
  e.left = dec<Uint16Array>(e.left, Uint16Array); e.right = dec<Uint16Array>(e.right, Uint16Array); e.val = dec<Float32Array>(e.val, Float32Array);
  return j as Models;
}

/** Probabilidades por clase para un vector de variables (mismo orden que entry.features). */
export function predictProba(m: Models, x: number[]) {
  const e = m.entry, K = e.n_class;
  const raw = e.baseline.slice();
  for (let it = 0; it < e.n_iter; it++) {
    for (let k = 0; k < K; k++) {
      const base = e.offsets[it * K + k];
      let node = 0;
      for (;;) {
        const f = e.f[base + node];
        if (f < 0) { raw[k] += e.val[base + node]; break; }
        const v = x[f];
        node = Number.isNaN(v) ? (e.miss[base + node] ? e.left[base + node] : e.right[base + node]) : v <= e.thr[base + node] ? e.left[base + node] : e.right[base + node];
      }
    }
  }
  const mx = Math.max(...raw);
  const ex = raw.map((r) => Math.exp(r - mx));
  const s = ex.reduce((a, b) => a + b, 0);
  return ex.map((v) => v / s);
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export type EntryPred = { probs: Record<string, number>; p_ganancia: number; exp_R: number };

/** Resultado probable de una entrada: TP, SL, cierre por tiempo en ganancia o en pérdida (horizonte en horas). */
export function predictEntry(m: Models | null, f: FeatRow | null, side: number, slDist: number, tpR: number, horizonH = 4): EntryPred | null {
  if (!m || !f) return null;
  const atr = f.atr;
  if (!Number.isFinite(atr) || atr <= 0 || !(slDist > 0)) return null;
  const vals: Record<string, number> = {};
  for (const k of NEUTRAL) vals[k] = (f as any)[k];
  vals.side = side; vals.sl_atr = slDist / atr; vals.tp_r = tpR; vals.horizon_h = horizonH;
  const x = m.entry.features.map((k) => (vals[k] == null ? NaN : vals[k]));
  const p = predictProba(m, x);
  const probs: Record<string, number> = {};
  m.entry.classes.forEach((c, j) => { probs[CLASSES[c]] = r3(p[j]); });
  const cr = m.entry.class_r;
  let er = 0;
  m.entry.classes.forEach((c, j) => { er += p[j] * (c === 0 ? tpR : c === 1 ? -1 : (cr[String(c)] ?? 0)); });
  return { probs, p_ganancia: r3((probs.TP || 0) + (probs["TIEMPO+"] || 0)), exp_R: r3(er) };
}

/** Cono de rango probable (cuantiles 10/50/90 %) a 1, 2, 4 y 8 horas. */
export function forecast(m: Models | null, f: FeatRow | null, price: number, tNow: number) {
  if (!m || !f || !Number.isFinite(f.atr)) return null;
  const sig = Math.max(Number.isFinite(f.rv240) ? f.rv240 : 0.2, 0.05) * f.atr;
  const hb = Math.floor(f.hour / 4);
  const pts: any[] = [{ h: 0, t: tNow, p10: price, p50: price, p90: price, p_up: 0.5 }];
  for (const H of [1, 2, 4, 8]) {
    const tb = m.forecast.tables[String(H)] || {};
    const d = tb[String(hb)] || Object.values(tb)[0];
    if (!d) continue;
    const k = sig * Math.sqrt(H / 4);
    pts.push({ h: H, t: tNow + H * 3600, p10: price + d.q[0] * k, p50: price + d.q[1] * k, p90: price + d.q[2] * k, p_up: r3(d.up) });
  }
  return { points: pts, atr: f.atr, sigma4h: sig, metrics: m.forecast.meta?.metrics || {} };
}

/** Historial de una estrategia en el escenario (régimen x volatilidad), encogido hacia su media con pocos casos. */
export function scenGet(m: Models | null, name: string, regime: string, vol: string) {
  if (!m) return null;
  const base = m.scen.overall[name];
  if (!base) return null;
  const cell = m.scen.table[`${name}|${regime}|${vol}`];
  if (!cell) return { ...base, n_cell: 0, shrunk: true };
  const w = cell.n / (cell.n + 30);
  const p: any = {};
  for (const k of Object.keys(base.p)) p[k] = w * cell.p[k] + (1 - w) * base.p[k];
  return { n: base.n, n_cell: cell.n, expR: w * cell.expR + (1 - w) * base.expR, win: w * cell.win + (1 - w) * base.win, p, raw_expR: cell.expR };
}

// ---------------------------------------------------------------- régimen y volatilidad (signals.py)
export const trendScore = (f: FeatRow) => 0.5 * f.ema_slope / 0.145 + 0.5 * f.ret240 / 0.278;
export function labelRegime(f: FeatRow) {
  const ts = trendScore(f), er = f.er240;
  // NaN en las comparaciones = falso, como numpy
  if (ts > 1.0 && er >= 0.04) return "alcista";
  if (ts < -1.0 && er >= 0.04) return "bajista";
  if (Math.abs(ts) < 0.4 && er < 0.08) return "rango";
  return "transicion";
}
export function labelVol(f: FeatRow) {
  const r = Number.isFinite(f.atr_rank) ? f.atr_rank : 0.5;
  if (r > 0.92) return "extrema";
  if (r > 0.75) return "alta";
  if (r < 0.25) return "baja";
  return "normal";
}
export const session = (m: number) => m < 60 ? "Cierre diario" : m < 540 ? "Asia" : m < 930 ? "Londres" : m < 1140 ? "Londres + Nueva York" : "Nueva York tarde";
