// Almacén de velas M1 en el navegador (port de backend/xauai/data.py).
// ts = hora del servidor del bróker (epoch "naive"), tn = hora normalizada (GMT+2/+3) = ts - desplazamiento.

export const DAY = 86400;
export const dowOf = (t: number) => (Math.floor(t / DAY) + 3) % 7;   // 0 = lunes
export const dayOf = (t: number) => t - (((t % DAY) + DAY) % DAY);
export const modOf = (t: number) => Math.floor((((t % DAY) + DAY) % DAY) / 60);
export const hm = (s: string) => { const [a, b] = s.split(":"); return +a * 60 + +b; };
export const fhm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function lowerBound(arr: ArrayLike<number>, v: number, lo = 0, hi = arr.length) {
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
  return lo;
}
export function upperBound(arr: ArrayLike<number>, v: number) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m + 1; else hi = m; }
  return lo;
}

export type RawBars = { ts: number[]; o: number[]; h: number[]; l: number[]; c: number[]; sp: number[]; v: number[] };
/** Días anteriores a las velas M1 cargadas (solo OHLC diario): sirven para el ATR, su percentil y la tendencia diaria. */
export type DailyBars = { d: number[]; o: number[]; h: number[]; l: number[]; c: number[] };

export class BarStore {
  ts!: Float64Array; o!: Float64Array; h!: Float64Array; l!: Float64Array; c!: Float64Array; sp!: Float64Array; vol!: Float64Array;
  tn!: Float64Array; mod!: Int32Array; dayn!: Float64Array;
  days!: Float64Array; dOpen!: Float64Array; dHigh!: Float64Array; dLow!: Float64Array; dClose!: Float64Array; dAtr!: Float64Array;
  dayFirst!: Int32Array; dayLast!: Int32Array;
  private dayIndex = new Map<number, number>();
  private tfCache = new Map<string, any>();

  extra: DailyBars = { d: [], o: [], h: [], l: [], c: [] };

  constructor(raw: RawBars, public shiftMin = 0, public atrPeriod = 14, extra?: DailyBars) { if (extra) this.extra = extra; this.set(raw); }

  setExtra(extra: DailyBars) { this.extra = extra; this.derive(); }

  get length() { return this.ts.length; }

  set(raw: RawBars) {
    const n = raw.ts.length;
    const idx = Array.from({ length: n }, (_, i) => i);
    let sorted = true;
    for (let i = 1; i < n; i++) if (raw.ts[i] < raw.ts[i - 1]) { sorted = false; break; }
    if (!sorted) idx.sort((a, b) => raw.ts[a] - raw.ts[b]);
    const F = (src: number[], def = 0) => { const a = new Float64Array(n); for (let k = 0; k < n; k++) { const v = src[idx[k]]; a[k] = v == null ? def : v; } return a; };
    this.ts = F(raw.ts); this.o = F(raw.o); this.h = F(raw.h); this.l = F(raw.l); this.c = F(raw.c);
    this.sp = F(raw.sp, 0.1); for (let k = 0; k < n; k++) if (!(this.sp[k] > 0)) this.sp[k] = 0.1;
    this.vol = F(raw.v || new Array(n).fill(0));
    this.derive();
  }

  /** Añade o sustituye velas desde la primera hora nueva. */
  append(raw: RawBars) {
    if (!raw.ts.length) return;
    const t0 = Math.min(...raw.ts);
    const keep = lowerBound(this.ts, t0);
    const cat = (a: Float64Array, b: number[]) => Array.from(a.subarray(0, keep)).concat(b);
    this.set({ ts: cat(this.ts, raw.ts), o: cat(this.o, raw.o), h: cat(this.h, raw.h), l: cat(this.l, raw.l), c: cat(this.c, raw.c), sp: cat(this.sp, raw.sp), v: cat(this.vol, raw.v || raw.ts.map(() => 0)) });
  }

  toNorm(t: number) { return t - this.shiftMin * 60; }
  toSrv(t: number) { return t + this.shiftMin * 60; }

  private derive() {
    const n = this.ts.length;
    this.tn = new Float64Array(n); this.mod = new Int32Array(n); this.dayn = new Float64Array(n);
    for (let i = 0; i < n; i++) { const t = this.toNorm(this.ts[i]); this.tn[i] = t; this.mod[i] = modOf(t); this.dayn[i] = dayOf(t); }
    this.tfCache.clear();
    // tabla diaria
    const brk: number[] = [];
    for (let i = 0; i < n; i++) if (i === 0 || this.dayn[i] !== this.dayn[i - 1]) brk.push(i);
    const firstDay = n ? this.dayn[0] : Infinity;
    const ex: number[] = [];
    for (let k = 0; k < this.extra.d.length; k++) if (this.extra.d[k] < firstDay) ex.push(k);
    const ne = ex.length;
    const nd = ne + brk.length;
    this.days = new Float64Array(nd); this.dOpen = new Float64Array(nd); this.dHigh = new Float64Array(nd); this.dLow = new Float64Array(nd);
    this.dClose = new Float64Array(nd); this.dAtr = new Float64Array(nd).fill(NaN); this.dayFirst = new Int32Array(nd); this.dayLast = new Int32Array(nd);
    this.dayIndex.clear();
    for (let q = 0; q < ne; q++) {
      const e = ex[q];
      this.days[q] = this.extra.d[e]; this.dOpen[q] = this.extra.o[e]; this.dHigh[q] = this.extra.h[e]; this.dLow[q] = this.extra.l[e]; this.dClose[q] = this.extra.c[e];
      this.dayFirst[q] = -1; this.dayLast[q] = -1;
      this.dayIndex.set(this.days[q], q);
    }
    for (let kk = 0; kk < brk.length; kk++) {
      const k = ne + kk;
      const a = brk[kk], b = kk + 1 < brk.length ? brk[kk + 1] : n;
      let hi = -Infinity, lo = Infinity;
      for (let i = a; i < b; i++) { if (this.h[i] > hi) hi = this.h[i]; if (this.l[i] < lo) lo = this.l[i]; }
      this.days[k] = this.dayn[a]; this.dOpen[k] = this.o[a]; this.dHigh[k] = hi; this.dLow[k] = lo; this.dClose[k] = this.c[b - 1];
      this.dayFirst[k] = a; this.dayLast[k] = b - 1;
      this.dayIndex.set(this.days[k], k);
    }
    // ATR de días laborables (SMA de TR conocida al empezar el día)
    const wi: number[] = [];
    for (let k = 0; k < nd; k++) if (dowOf(this.days[k]) < 5) wi.push(k);
    const P = this.atrPeriod;
    if (wi.length > P + 1) {
      const cs = [0];
      for (let k = 1; k < wi.length; k++) {
        const H = this.dHigh[wi[k]], L = this.dLow[wi[k]], Cp = this.dClose[wi[k - 1]];
        cs.push(cs[k - 1] + Math.max(H - L, Math.abs(H - Cp), Math.abs(L - Cp)));
      }
      for (let k = P + 1; k < wi.length; k++) this.dAtr[wi[k]] = (cs[k - 1] - cs[k - 1 - P]) / P;
    }
  }

  dayIdx(d: number) { return this.dayIndex.get(d) ?? -1; }

  atrForDay(d: number) {
    const k = this.dayIdx(d);
    if (k >= 0 && !Number.isNaN(this.dAtr[k])) return this.dAtr[k];
    const prev: number[] = [];
    for (let j = 0; j < this.days.length; j++) if (this.days[j] < d && dowOf(this.days[j]) < 5) prev.push(j);
    const P = this.atrPeriod;
    if (prev.length < P + 1) return NaN;
    const sel = prev.slice(-(P + 1));
    let s = 0;
    for (let q = 1; q < sel.length; q++) {
      const H = this.dHigh[sel[q]], L = this.dLow[sel[q]], Cp = this.dClose[sel[q - 1]];
      s += Math.max(H - L, Math.abs(H - Cp), Math.abs(L - Cp));
    }
    return s / P;
  }

  /** Primera vela con hora normalizada en [minute, minute+tol] de ese día; -1 si no hay. */
  barAt(d: number, minute: number, tol = 5, upto = this.length) {
    const t = d + minute * 60;
    const i = lowerBound(this.tn, t);
    if (i < upto && this.tn[i] - t <= tol * 60 && this.dayn[i] === d) return i;
    return -1;
  }

  /** Máximo/mínimo de velas con apertura en [start, end) del día (exige la mitad de las velas). */
  rangeHL(d: number, start: number, end: number, upto?: number): [number, number] | null {
    const a = lowerBound(this.tn, d + start * 60);
    let b = lowerBound(this.tn, d + end * 60);
    if (upto != null) b = Math.min(b, upto);
    if (b - a < Math.max(1, Math.floor((end - start) / 2))) return null;
    let hi = -Infinity, lo = Infinity;
    for (let k = a; k < b; k++) { if (this.h[k] > hi) hi = this.h[k]; if (this.l[k] < lo) lo = this.l[k]; }
    return [hi, lo];
  }

  /** Velas agregadas para el gráfico. time = inicio de la vela (hora del servidor). */
  tf(minutes: number) {
    const key = String(minutes);
    if (this.tfCache.has(key)) return this.tfCache.get(key);
    const out: { time: number; open: number; high: number; low: number; close: number }[] = [];
    if (minutes >= 1440) for (let k = 0; k < this.days.length; k++) if (this.dayFirst[k] < 0) out.push({ time: this.toSrv(this.days[k]), open: this.dOpen[k], high: this.dHigh[k], low: this.dLow[k], close: this.dClose[k] });
    for (let i = 0; i < this.length; i++) {
      const k = minutes >= 1440 ? this.dayn[i] + (this.ts[i] - this.tn[i]) : this.ts[i] - (this.ts[i] % (minutes * 60));
      const last = out[out.length - 1];
      if (!last || last.time !== k) out.push({ time: k, open: this.o[i], high: this.h[i], low: this.l[i], close: this.c[i] });
      else { if (this.h[i] > last.high) last.high = this.h[i]; if (this.l[i] < last.low) last.low = this.l[i]; last.close = this.c[i]; }
    }
    this.tfCache.set(key, out);
    return out;
  }
}
