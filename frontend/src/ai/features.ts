// Variables de mercado por vela M1 (port exacto de backend/xauai/features.py, mismas fórmulas que el entrenamiento).
import { BarStore, DAY, dowOf } from "./bars";

export const FEATURES = ["hour", "dow", "atr", "atr_rank", "rv60", "rv240", "ret5", "ret15", "ret60", "ret240", "ret_day",
  "er60", "er240", "ema_fast", "ema_slow", "ema_slope", "day_rng", "day_pos", "asia_w", "asia_pos",
  "pd_hi", "pd_lo", "r50", "spread", "vol_ratio", "d1_trend", "d1_ret5", "since_open"] as const;
export type FeatName = typeof FEATURES[number];
export type FeatTable = Record<FeatName, Float64Array>;
export type FeatRow = Record<FeatName, number>;

const fin = Number.isFinite;

function shift(x: Float64Array, k = 1) {
  const y = new Float64Array(x.length).fill(NaN);
  for (let i = k; i < x.length; i++) y[i] = x[i - k];
  return y;
}

/** Suma/medias móviles ignorando NaN, con mínimo de observaciones (pandas rolling). */
function rollingSum(x: Float64Array, w: number, minP: number, mean = false) {
  const n = x.length, out = new Float64Array(n).fill(NaN);
  let s = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    if (fin(x[i])) { s += x[i]; cnt++; }
    if (i >= w && fin(x[i - w])) { s -= x[i - w]; cnt--; }
    if (cnt >= minP) out[i] = mean ? s / cnt : s;
  }
  return out;
}

/** Desviación típica móvil (ddof = 1), cálculo directo por ventana para no acumular error. */
function rollingStd(x: Float64Array, w: number, minP: number) {
  const n = x.length, out = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    let s = 0, cnt = 0;
    const a = Math.max(0, i - w + 1);
    for (let k = a; k <= i; k++) if (fin(x[k])) { s += x[k]; cnt++; }
    if (cnt < minP || cnt < 2) continue;
    const m = s / cnt;
    let q = 0;
    for (let k = a; k <= i; k++) if (fin(x[k])) q += (x[k] - m) * (x[k] - m);
    out[i] = Math.sqrt(q / (cnt - 1));
  }
  return out;
}

/** EWM de pandas con adjust=False (y valores NaN solo al principio). */
function ewm(x: Float64Array, span: number) {
  const a = 2 / (span + 1), out = new Float64Array(x.length).fill(NaN);
  let y = NaN;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (fin(y)) { if (fin(v)) y = (1 - a) * y + a * v; }
    else if (fin(v)) y = v;
    out[i] = y;
  }
  return out;
}

/** Percentil del último valor dentro de la ventana (pandas rolling().rank(pct=True), empates = media). */
function rollingRankPct(x: Float64Array, w: number, minP: number) {
  const n = x.length, out = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!fin(x[i])) continue;
    let cnt = 0, less = 0, eq = 0;
    for (let k = Math.max(0, i - w + 1); k <= i; k++) {
      if (!fin(x[k])) continue;
      cnt++;
      if (x[k] < x[i]) less++; else if (x[k] === x[i]) eq++;
    }
    if (cnt >= minP) out[i] = (less + (eq + 1) / 2) / cnt;
  }
  return out;
}

const ffill = (x: Float64Array) => { let last = NaN; for (let i = 0; i < x.length; i++) { if (fin(x[i])) last = x[i]; else x[i] = last; } return x; };
const bfill = (x: Float64Array) => { let nxt = NaN; for (let i = x.length - 1; i >= 0; i--) { if (fin(x[i])) nxt = x[i]; else x[i] = nxt; } return x; };
const roundHalfEven = (v: number) => { const f = Math.floor(v), d = v - f; if (d > 0.5) return f + 1; if (d < 0.5) return f; return f % 2 === 0 ? f : f + 1; };

/** Variables para todas las velas del almacén. */
export function computeFeatures(st: BarStore): FeatTable {
  const n = st.length;
  const { o, h, l, c, sp, vol, mod, dayn } = st;
  const nd = st.days.length;
  const A = () => new Float64Array(n);

  // ATR diario conocido al inicio del día, ffill/bfill por vela
  const atr = A();
  for (let i = 0; i < n; i++) { const k = st.dayIdx(dayn[i]); atr[i] = k >= 0 ? st.dAtr[k] : NaN; }
  ffill(atr); bfill(atr);
  for (let i = 0; i < n; i++) if (atr[i] <= 0) atr[i] = NaN;

  // percentil del ATR en 120 días
  const dAtrF = ffill(Float64Array.from(st.dAtr));
  const rank = rollingRankPct(dAtrF, 120, 20);
  const atrRank = A();
  for (let i = 0; i < n; i++) { const k = st.dayIdx(dayn[i]); atrRank[i] = k >= 0 ? rank[k] : NaN; }

  const pc = shift(c);
  const lr = A(); lr[0] = NaN;
  for (let i = 1; i < n; i++) lr[i] = Math.log(c[i]) - Math.log(c[i - 1]);
  const lrPrev = shift(lr);
  const sd60 = rollingStd(lrPrev, 60, 30), sd240 = rollingStd(lrPrev, 240, 120);
  const rv60 = A(), rv240 = A();
  for (let i = 0; i < n; i++) { rv60[i] = sd60[i] * Math.sqrt(60) * c[i] / atr[i]; rv240[i] = sd240[i] * Math.sqrt(240) * c[i] / atr[i]; }

  const ret = (k: number) => { const s = shift(c, k + 1), out = A(); for (let i = 0; i < n; i++) out[i] = (pc[i] - s[i]) / atr[i]; return out; };
  const absd = A(); absd[0] = NaN;
  for (let i = 1; i < n; i++) absd[i] = Math.abs(pc[i] - pc[i - 1]);
  const er = (k: number) => {
    const den = rollingSum(absd, k, Math.floor(k / 2)), s = shift(pc, k), out = A();
    for (let i = 0; i < n; i++) { const num = Math.abs(pc[i] - s[i]); out[i] = den[i] > 0 ? num / den[i] : NaN; }
    return out;
  };
  const emaF = ewm(pc, 1200), emaS = ewm(pc, 3000);
  const emaF300 = shift(emaF, 300);

  // por día: máximos/mínimos acumulados hasta la vela anterior, apertura, apertura de las 01:05, rango de Asia
  const dayHi = A(), dayLo = A(), dayOpen = A(), o105 = A(), ah = A(), al = A();
  {
    let curD = NaN, hi = -Infinity, lo = Infinity, aH = -Infinity, aL = Infinity, first = 0;
    let p105 = NaN;
    const groupStart: number[] = [];
    for (let i = 0; i < n; i++) {
      if (dayn[i] !== curD) {
        curD = dayn[i]; hi = -Infinity; lo = Infinity; aH = -Infinity; aL = Infinity; first = i; groupStart.push(i);
        dayHi[i] = NaN; dayLo[i] = NaN; ah[i] = NaN; al[i] = NaN;
      } else { dayHi[i] = hi; dayLo[i] = lo; ah[i] = aH; al[i] = aL; }
      if (h[i] > hi) hi = h[i];
      if (l[i] < lo) lo = l[i];
      const inAsia = mod[i] >= 65 && mod[i] < 540;
      if (inAsia) { if (h[i] > aH) aH = h[i]; if (l[i] < aL) aL = l[i]; }
      dayOpen[i] = o[first];
    }
    // apertura 01:05 = primera apertura del día con minuto >= 65 (transform first)
    for (let g = 0; g < groupStart.length; g++) {
      const a = groupStart[g], b = g + 1 < groupStart.length ? groupStart[g + 1] : n;
      p105 = NaN;
      for (let i = a; i < b; i++) if (mod[i] >= 65) { p105 = o[i]; break; }
      for (let i = a; i < b; i++) o105[i] = p105;
    }
  }

  // máximos/mínimos del día anterior y tendencia diaria (días laborables)
  const ph = new Float64Array(nd), pl = new Float64Array(nd), pcl = new Float64Array(nd);
  for (let k = 0; k < nd; k++) { const wk = dowOf(st.days[k]) < 5; ph[k] = wk ? st.dHigh[k] : NaN; pl[k] = wk ? st.dLow[k] : NaN; pcl[k] = wk ? st.dClose[k] : NaN; }
  ffill(ph); ffill(pl); ffill(pcl);
  const phS = shift(ph), plS = shift(pl);
  const ma20 = shift(rollingSum(pcl, 20, 10, true));
  const pcl5 = shift(pcl, 5), r5raw = new Float64Array(nd);
  for (let k = 0; k < nd; k++) r5raw[k] = pcl[k] / pcl5[k] - 1;
  const r5 = shift(r5raw), pclPrev = shift(pcl);

  const vr = shift(vol);
  const v15 = rollingSum(vr, 15, 5, true), v1000 = rollingSum(vr, 1000, 100, true);

  const T = {} as FeatTable;
  for (const f of FEATURES) T[f] = A();
  const r5_ = ret(5), r15 = ret(15), r60 = ret(60), r240 = ret(240), er60 = er(60), er240 = er(240);
  for (let i = 0; i < n; i++) {
    const k = st.dayIdx(dayn[i]);
    const a = atr[i];
    T.hour[i] = mod[i] / 60;
    T.dow[i] = (Math.floor(dayn[i] / DAY) + 3) % 7;
    T.atr[i] = a;
    T.atr_rank[i] = atrRank[i];
    T.rv60[i] = rv60[i]; T.rv240[i] = rv240[i];
    T.ret5[i] = r5_[i]; T.ret15[i] = r15[i]; T.ret60[i] = r60[i]; T.ret240[i] = r240[i];
    const ref = mod[i] >= 65 ? o105[i] : dayOpen[i];
    T.ret_day[i] = (o[i] - ref) / a;
    T.er60[i] = er60[i]; T.er240[i] = er240[i];
    T.ema_fast[i] = (o[i] - emaF[i]) / a; T.ema_slow[i] = (o[i] - emaS[i]) / a; T.ema_slope[i] = (emaF[i] - emaF300[i]) / a;
    T.day_rng[i] = (dayHi[i] - dayLo[i]) / a;
    T.day_pos[i] = dayHi[i] > dayLo[i] ? (o[i] - dayLo[i]) / (dayHi[i] - dayLo[i]) * 2 - 1 : 0;
    const ok = fin(ah[i]) && fin(al[i]) && ah[i] > al[i];
    T.asia_w[i] = ok ? (ah[i] - al[i]) / a : NaN;
    T.asia_pos[i] = ok ? (o[i] - (ah[i] + al[i]) / 2) / (ah[i] - al[i]) * 2 : NaN;
    T.pd_hi[i] = k >= 0 ? (o[i] - phS[k]) / a : NaN;
    T.pd_lo[i] = k >= 0 ? (o[i] - plS[k]) / a : NaN;
    T.r50[i] = (o[i] - roundHalfEven(o[i] / 50) * 50) / a;
    T.spread[i] = sp[i] / a;
    T.vol_ratio[i] = v15[i] / v1000[i];
    T.d1_trend[i] = k >= 0 ? (pclPrev[k] - ma20[k]) / a : NaN;
    T.d1_ret5[i] = k >= 0 ? r5[k] * o[i] / a : NaN;
    T.since_open[i] = (o[i] - dayOpen[i]) / a;
  }
  for (const f of FEATURES) { const x = T[f]; for (let i = 0; i < n; i++) if (!fin(x[i])) x[i] = NaN; }
  return T;
}

export function featRow(T: FeatTable, i: number): FeatRow {
  const r = {} as FeatRow;
  for (const f of FEATURES) r[f] = T[f][i];
  return r;
}
