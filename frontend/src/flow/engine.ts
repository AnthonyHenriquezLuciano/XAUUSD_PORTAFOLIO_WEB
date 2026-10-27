/** Institutional Flow · analytics from historical MT5 M1 tick activity.
 * These are NON-exchange measurements. A candle's tick volume is distributed
 * uniformly across its OHLC range: price-at-volume and delta are NOT observable.
 * Computations accept an explicit cutoff and never inspect later candles.
 */
import { BarStore, dayOf, dowOf, lowerBound } from "../ai/bars";
import { chartSessionWindows, type SessionId } from "../sessions/marketSessions";
import { volumePressure, type FlowPressure } from "./volumeSignals";
import type { ReachEvidence } from "./reach";
import {buildVolumeSuite,buildLiquidityMap,type VolumeSuite,type LiquidityCluster} from "./institutionalSuite";

export type FlowMode = "session" | "fixed" | "recent";
export type FlowScope = SessionId | "day";
export type FlowBin = { low: number; high: number; price: number; volume: number; share: number; node: "HVN" | "LVN" | null };
export type FlowProfile = {
  start: number; end: number; min: number; max: number; poc: number; vah: number; val: number;
  total: number; bars: number; coverage: number; bins: FlowBin[]; vwap: number | null;
  vwapSigma: number|null; vwapBands: number[];
  hvn: number[]; lvn: number[]; method: "MT5_TICK_VOLUME_OHLC_UNIFORM";
};
export type Sweep = { time:number; side:"high"|"low"; level:number; rejection:number; timeframe:"M5" };
export type Gap = { id: string; side: 1 | -1; start: number; last: number; lo: number; hi: number; state: "open" | "partial" | "filled"; size: number };
export type FlowLevel = { key: string; label: string; price: number; source: string; side: "above" | "below" | "at" };
export type FlowResponse = {
  ok: boolean; mode: FlowMode; scope: FlowScope; title: string; profile: FlowProfile | null;
  levels: FlowLevel[]; gaps: Gap[]; sweeps: Sweep[]; price: number | null; vwap: number | null;
  pressure: FlowPressure | null; reach?: ReachEvidence[];
  suite?:VolumeSuite;heatmap?:LiquidityCluster[];
  direction: "above_poc" | "below_poc" | "at_poc" | "unknown";
  evidence: string[]; quality: { validBars: number; withVolume: number; coveragePct: number; cutoff: number; disclaimer: string };
};
const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v));
const round = (v: number) => Math.round(v * 100) / 100;

export function volumeProfile(st: BarStore, start: number, end: number, cutoff: number, count = 64): FlowProfile | null {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !st.length) return null;
  const nBins = Math.round(clamp(count, 24, 128));
  const from = lowerBound(st.ts, start);
  const to = Math.min(st.length, lowerBound(st.ts, Math.min(end, cutoff + 1)));
  let min = Infinity, max = -Infinity, valid = 0, withVol = 0, weighted = 0, weightedSquare = 0, total = 0;
  for (let i = from; i < to; i++) {
    const h = st.h[i], l = st.l[i], v = st.vol[i];
    if (!Number.isFinite(h) || !Number.isFinite(l) || h < l) continue;
    valid++;
    if (!(Number.isFinite(v) && v > 0)) continue;
    withVol++; min = Math.min(min, l); max = Math.max(max, h);
    const typical = (st.h[i] + st.l[i] + st.c[i]) / 3;
    weighted += typical * v;
    weightedSquare += typical * typical * v;
    total += v;
  }
  if (withVol < 2 || !(total > 0) || !(max >= min)) return null;
  const size = Math.max(.01, (max - min) / nBins);
  const bucket = new Float64Array(nBins);
  for (let i = from; i < to; i++) {
    const v = st.vol[i], lo = st.l[i], hi = st.h[i];
    if (!(v > 0) || !Number.isFinite(v) || !Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) continue;
    if (hi - lo < 1e-9) {
      const idx = clamp(Math.floor((lo - min) / size), 0, nBins - 1);
      bucket[idx] += v;
      continue;
    }
    const first = clamp(Math.floor((lo - min) / size), 0, nBins - 1);
    const last = clamp(Math.floor((hi - min) / size), 0, nBins - 1);
    for (let j = first; j <= last; j++) {
      const overlap = Math.max(0, Math.min(hi, min + (j + 1) * size) - Math.max(lo, min + j * size));
      bucket[j] += v * overlap / (hi - lo);
    }
  }
  let pocIdx = 0;
  for (let i = 1; i < bucket.length; i++) if (bucket[i] > bucket[pocIdx]) pocIdx = i;
  // Value Area: contiguous growth starting from the POC until >= 70% of tick activity.
  let left = pocIdx, right = pocIdx, acc = bucket[pocIdx];
  while (acc < total * .7 && (left > 0 || right < nBins - 1)) {
    const down = left > 0 ? bucket[left - 1] : -1;
    const up = right < nBins - 1 ? bucket[right + 1] : -1;
    if (up > down) { right++; acc += bucket[right]; }
    else { left--; acc += bucket[left]; }
  }
  // Local peaks/troughs are only reported when distinct enough from the mean.
  const avg = total / nBins;
  const bins: FlowBin[] = Array.from(bucket, (vol, j) => {
    const p = min + (j + .5) * size;
    const prev = j > 0 ? bucket[j - 1] : vol, next = j < nBins - 1 ? bucket[j + 1] : vol;
    const peak = j > 0 && j < nBins - 1 && vol >= prev && vol > next && vol >= avg * 1.35;
    const valley = j > 0 && j < nBins - 1 && vol < prev && vol <= next && vol <= avg * .55;
    return { low: min + j * size, high: min + (j + 1) * size, price: p, volume: vol, share: vol / total,
      node: peak ? "HVN" : valley ? "LVN" : null };
  });
  const vwap = weighted / total;
  const vwapSigma = Math.sqrt(Math.max(0, weightedSquare / total - vwap * vwap));
  return {
    start, end: Math.min(end, cutoff + 1), min: round(min), max: round(max),
    poc: round(bins[pocIdx].price), val: round(bins[left].low), vah: round(bins[right].high),
    total, bars: valid, coverage: valid ? withVol / valid : 0, bins,
    vwap: round(vwap), vwapSigma:round(vwapSigma),vwapBands:[-2,-1,1,2].map(k=>round(vwap+k*vwapSigma)), hvn: bins.filter(b => b.node === "HVN").sort((a,b)=>b.volume-a.volume).slice(0,5).map(x=>round(x.price)),
    lvn: bins.filter(b => b.node === "LVN").sort((a,b)=>a.volume-b.volume).slice(0,5).map(x=>round(x.price)),
    method: "MT5_TICK_VOLUME_OHLC_UNIFORM"
  };
}

export function fairValueGaps(st: BarStore, cutoff: number, tfMin = 5, maxGaps = 14): Gap[] {
  const candle = st.tf(tfMin) as {time:number;open:number;high:number;low:number;close:number}[];
  const n = Math.min(candle.length, lowerBound(candle.map(x=>x.time), cutoff + 1));
  const start = Math.max(2, n - 650);
  const candidates: Gap[] = [];
  for (let i = start; i < n; i++) {
    const left = candle[i - 2], mid = candle[i - 1], right = candle[i];
    if (!(right.time + tfMin * 60 <= cutoff + 60)) continue; // closed candle only
    let avgTr = 0, count = 0;
    for (let j = Math.max(1, i - 21); j < i; j++) {
      avgTr += Math.max(candle[j].high - candle[j].low, Math.abs(candle[j].high - candle[j - 1].close),
        Math.abs(candle[j].low - candle[j - 1].close));
      count++;
    }
    if (!count) continue;
    avgTr /= count;
    const displacement = Math.abs(mid.close - mid.open) >= avgTr * 1.1;
    const bull = left.high < right.low, bear = left.low > right.high;
    if (!displacement || (!bull && !bear)) continue;
    const gapLow = bull ? left.high : right.high, gapHigh = bull ? right.low : left.low;
    if (gapHigh - gapLow < avgTr * .12) continue;
    const side: 1 | -1 = bull ? 1 : -1;
    let remainingLo = gapLow, remainingHi = gapHigh, last = right.time, state: Gap["state"] = "open";
    for (let j = i + 1; j < n; j++) {
      if (!(candle[j].time + tfMin * 60 <= cutoff + 60)) break;
      const bar = candle[j];
      last = bar.time;
      if (side === 1 && bar.low < gapHigh) {
        remainingHi = Math.min(remainingHi, Math.max(gapLow, bar.low));
        state = remainingHi <= gapLow ? "filled" : "partial";
      } else if (side === -1 && bar.high > gapLow) {
        remainingLo = Math.max(remainingLo, Math.min(gapHigh, bar.high));
        state = remainingLo >= gapHigh ? "filled" : "partial";
      }
      if (state === "filled") break;
    }
    if (state !== "filled") candidates.push({
      id: "fvg-" + tfMin + "-" + right.time, side, start: right.time, last,
      lo: round(remainingLo), hi: round(remainingHi), state, size: round(gapHigh - gapLow)
    });
  }
  return candidates.slice(-Math.round(clamp(maxGaps, 1, 30)));
}

export function detectSweeps(st:BarStore, cutoff:number, tfMin=5, maxSweeps=10):Sweep[] {
  const candles=st.tf(tfMin) as {time:number;open:number;high:number;low:number;close:number}[];
  const out:Sweep[]=[];
  for(let i=Math.max(20,candles.length-180);i<candles.length;i++){
    const bar=candles[i];
    if(bar.time+tfMin*60 > cutoff+60)break;
    let high=-Infinity,low=Infinity;
    for(let j=i-16;j<i;j++){ high=Math.max(high,candles[j].high);low=Math.min(low,candles[j].low); }
    // Classic rejection, not evidence of exchange stop orders.
    if(bar.high>high && bar.close<high && bar.close<bar.open)out.push({time:bar.time,side:"high",level:round(high),rejection:round(bar.high-high),timeframe:"M5"});
    else if(bar.low<low && bar.close>low && bar.close>bar.open)out.push({time:bar.time,side:"low",level:round(low),rejection:round(low-bar.low),timeframe:"M5"});
  }
  return out.slice(-maxSweeps);
}

export function buildFlow(st: BarStore, now: number, opts: {
  mode?: FlowMode; scope?: FlowScope; start?: number; end?: number;
  brokerOffsetSec?: number | null; bins?: number; cutoff?: number
} = {}): FlowResponse {
  const cutoff = Math.min(now, opts.cutoff ?? now, st.length ? st.ts[st.length - 1] + 59 : now);
  const lastIdx = st.length ? Math.min(st.length - 1, lowerBound(st.ts, cutoff + 1) - 1) : -1;
  const price = lastIdx >= 0 ? st.c[lastIdx] : null;
  const mode = opts.mode || "session", scope = opts.scope || "london";
  let start = cutoff - 6 * 3600, end = cutoff + 1;
  let title = "Últimas seis horas";
  if (mode === "fixed") {
    start = Number(opts.start); end = Number(opts.end);
    title = "Perfil dibujado";
    // Limit user ranges to 20 days of data; avoid accidental huge computations.
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 20 * 86400)
      return empty(mode, scope, cutoff, "Selecciona un intervalo de hasta 20 días", price);
  } else if (mode === "session") {
    const offset = opts.brokerOffsetSec;
    if (scope === "day") {
      const d = dayOf(st.toNorm(cutoff));
      start = st.toSrv(d);
      end = Math.min(cutoff + 1, start + 86400);
      title = "Día del EA";
    } else if (offset != null && Number.isFinite(offset)) {
      const windows = chartSessionWindows(cutoff - 5 * 86400, cutoff + 86400, offset);
      const candidates = windows.filter(w => w.id === scope && w.t0 <= cutoff);
      const latest = candidates[candidates.length - 1];
      if (latest) { start = latest.t0; end = Math.min(cutoff + 1, latest.t1); }
      else return empty(mode, scope, cutoff, "No hay sesión disponible", price);
      title = latest?.name || scope;
    } else return empty(mode, scope, cutoff, "Conecta MT5 para identificar el reloj del bróker", price);
  }
  const profile = volumeProfile(st, start, end, cutoff, opts.bins ?? 64);
  // Directional tick pressure always describes the latest six hours, even when the
  // selected historical session has already closed.
  const pressure = volumePressure(st, cutoff - 6 * 3600, cutoff + 1, cutoff);
  const gaps = fairValueGaps(st, cutoff, 5, 12);
  const sweeps = detectSweeps(st, cutoff, 5, 12);
  const levels: FlowLevel[] = [];
  const add = (key: string, label: string, value: number, source: string) => {
    if (Number.isFinite(value)) levels.push({ key, label, price: round(value), source,
      side: price == null ? "at" : value > price + .02 ? "above" : value < price - .02 ? "below" : "at" });
  };
  if (profile) {
    add("POC", "POC · actividad", profile.poc, "Tick volume / aproximación");
    add("VAH", "VAH · 70%", profile.vah, "Tick volume / aproximación");
    add("VAL", "VAL · 70%", profile.val, "Tick volume / aproximación");
    if (profile.vwap != null) add("VWAP", "VWAP proxy", profile.vwap, "Typical price × tick volume");
    for (const [i, n] of profile.hvn.entries()) add("HVN"+i, "HVN", n, "Nodo de actividad");
    for (const [i, n] of profile.lvn.entries()) add("LVN"+i, "LVN", n, "Nodo de baja actividad");
  }
  const today = dayOf(st.toNorm(cutoff));
  let prev = -1;
  for (let i = 0; i < st.days.length; i++) if (st.days[i] < today && dowOf(st.days[i]) < 5) prev = i;
  if (prev >= 0) {
    add("PDH", "PDH · máximo anterior", st.dHigh[prev], "Máximo de jornada previa");
    add("PDL", "PDL · mínimo anterior", st.dLow[prev], "Mínimo de jornada previa");
  }
  const monday = (t: number) => dayOf(t) - dowOf(t) * 86400;
  const weekStart = monday(today);
  let pwHigh = -Infinity, pwLow = Infinity;
  for (let i = 0; i < st.days.length; i++) if (st.days[i] >= weekStart - 7*86400 && st.days[i] < weekStart) {
    pwHigh = Math.max(pwHigh, st.dHigh[i]); pwLow = Math.min(pwLow, st.dLow[i]);
  }
  if (pwHigh > -Infinity) { add("PWH", "PWH · semana anterior", pwHigh, "Semana calendario anterior"); add("PWL", "PWL · semana anterior", pwLow, "Semana calendario anterior"); }
  const suite=buildVolumeSuite(st,profile,cutoff);
  const heatmap=buildLiquidityMap(levels,gaps,sweeps,profile,cutoff);
  const direction = !profile || price == null ? "unknown" :
    Math.abs(price - profile.poc) <= Math.max(.02,(profile.max - profile.min) / 64) ? "at_poc" :
    price > profile.poc ? "above_poc" : "below_poc";
  const evidence = profile ? [
    "Actividad MT5 aproximada: " + Math.round(profile.total).toLocaleString("es-ES") + " ticks en " + profile.bars + " velas M1.",
    "Precio " + (direction === "above_poc" ? "sobre" : direction === "below_poc" ? "bajo" : "cerca de") + " el POC (" + profile.poc.toFixed(2) + ").",
    "Área de valor: " + profile.val.toFixed(2) + "–" + profile.vah.toFixed(2) + "; no implica dirección futura.",
    gaps.length + " FVG M5 abiertos/parciales detectados, sin asegurar mitigación futura."
  ] : ["No hay suficientes velas con tick volume para calcular el perfil sin inventar datos."];
  const validBars = profile?.bars || 0;
  return {
    ok: !!profile, mode, scope, title, profile, levels, gaps, sweeps, price, pressure, suite, heatmap,
    vwap: profile?.vwap ?? null, direction, evidence,
    quality: { validBars, withVolume: Math.round(validBars * (profile?.coverage || 0)),
      coveragePct: Math.round((profile?.coverage || 0)*100), cutoff,
      disclaimer: "Estimación OHLC + tick volume del bróker; no es volumen centralizado, delta real ni garantía predictiva. El rango de la vela reparte actividad uniformemente." }
  };
}

function empty(mode: FlowMode, scope: FlowScope, cutoff: number, why: string, price: number|null): FlowResponse {
  return { ok:false, mode, scope, title: why, profile: null, levels: [], gaps: [], sweeps: [], price, vwap:null, pressure:null,
    direction:"unknown", evidence:[why], quality:{validBars:0,withVolume:0,coveragePct:0,cutoff,
      disclaimer:"Sin datos suficientes. No se inventa volumen."} };
}
