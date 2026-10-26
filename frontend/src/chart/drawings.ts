// Dibujos del usuario sobre el gráfico (líneas, rayos, rectángulos, Fibonacci, texto y medición).
// Los puntos se guardan en hora del servidor del bróker y precio, así que valen para cualquier temporalidad.
import type { IChartApi, ISeriesApi, ISeriesPrimitive, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView, ITimeScaleApi, Logical, SeriesAttachedParameter, Time } from "lightweight-charts";
import { alpha, ChartTheme } from "./themes";

export type Kind = "hline" | "hray" | "vline" | "trend" | "ray" | "rect" | "profile" | "fib" | "text";
export type Tool = "cursor" | Kind | "measure";
export type Pt = { t: number; p: number };
export type Drawing = { id: string; kind: Kind; a: Pt; b?: Pt; text?: string; color: string; width: number; dash?: boolean };
export type Handle = "a" | "b" | "ab" | "ba" | "body";

export const TWO_POINTS: Tool[] = ["trend", "ray", "rect", "profile", "fib", "measure"];
export const COLORS = ["#e0b04f", "#4c8dff", "#22b07d", "#e5534b", "#b07cff", "#8a93a6"];
export const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

// ---------------------------------------------------------------- tiempo <-> índice de vela <-> coordenada
export function tToIdx(T: number[], tf: number, t: number): number {
  const n = T.length;
  if (!n) return 0;
  if (t <= T[0]) return (t - T[0]) / tf;
  if (t >= T[n - 1]) return n - 1 + (t - T[n - 1]) / tf;
  let lo = 0, hi = n - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] < t) lo = m + 1; else hi = m; }
  return T[lo] === t ? lo : lo - 1 + (t - T[lo - 1]) / (T[lo] - T[lo - 1]);
}
export function idxToT(T: number[], tf: number, idx: number): number {
  const n = T.length;
  if (!n) return 0;
  if (idx <= 0) return T[0] + idx * tf;
  if (idx >= n - 1) return T[n - 1] + (idx - (n - 1)) * tf;
  const i0 = Math.floor(idx), f = idx - i0;
  return T[i0] + (T[i0 + 1] - T[i0]) * f;
}
export function idxToX(ts: ITimeScaleApi<Time>, idx: number): number | null {
  // logicalToCoordinate solo admite posiciones enteras: interpolar entre dos velas
  const i0 = Math.floor(idx), f = idx - i0;
  const c0 = ts.logicalToCoordinate(i0 as Logical);
  if (c0 == null) return null;
  if (f < 1e-9) return c0;
  const c1 = ts.logicalToCoordinate((i0 + 1) as Logical);
  return c1 == null ? c0 : c0 + (c1 - c0) * f;
}
export function xToIdx(ts: ITimeScaleApi<Time>, x: number): number | null {
  const l = ts.coordinateToLogical(x);
  return l == null ? null : Number(l);
}

const FONT = "600 10.5px Inter, system-ui, -apple-system, Segoe UI, sans-serif";
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function pill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg: string, align: "left" | "right" | "center" = "left") {
  ctx.font = FONT;
  const w = Math.ceil(ctx.measureText(text).width) + 10, h = 16;
  const x0 = align === "left" ? x : align === "right" ? x - w : x - w / 2;
  rr(ctx, x0, y - h / 2, w, h, 3);
  ctx.fillStyle = bg; ctx.fill();
  ctx.fillStyle = fg; ctx.textBaseline = "middle"; ctx.textAlign = "left";
  ctx.fillText(text, x0 + 5, y + 0.5);
}
function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
  const u = L ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L)) : 0;
  return Math.hypot(px - (x1 + u * dx), py - (y1 + u * dy));
}
const dur = (s: number) => { s = Math.abs(s); const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.round((s % 3600) / 60); return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`; };

export type DrawState = {
  drawings: Drawing[];
  draft: Drawing | null;            // dibujo a medio hacer
  measure: { a: Pt; b: Pt } | null;
  selected: string | null;
  hidden: boolean;
  theme: ChartTheme;
  tf: number;
  times: () => number[];
};

export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<"Candlestick"> | null = null;
  private request: (() => void) | null = null;
  st: DrawState | null = null;
  private W = 0; private H = 0;
  private textBox = new Map<string, { x: number; y: number; w: number; h: number }>();
  private views: ISeriesPrimitivePaneView[];

  constructor() {
    const r: ISeriesPrimitivePaneRenderer = { draw: (t: any) => t.useMediaCoordinateSpace((s: any) => this.draw(s.context, s.mediaSize.width, s.mediaSize.height)) };
    this.views = [{ zOrder: () => "top", renderer: () => r }];
  }
  attached(p: SeriesAttachedParameter<Time>) { this.chart = p.chart as IChartApi; this.series = p.series as ISeriesApi<"Candlestick">; this.request = p.requestUpdate; }
  detached() { this.chart = null; this.series = null; this.request = null; }
  paneViews() { return this.views; }
  updateAllViews() { /* se lee al dibujar */ }
  set(st: DrawState) { this.st = st; this.request?.(); }
  redraw() { this.request?.(); }

  x(t: number): number | null {
    const ts = this.chart?.timeScale(), st = this.st;
    if (!ts || !st) return null;
    const T = st.times();
    if (!T.length) return null;
    return idxToX(ts, tToIdx(T, st.tf, t));
  }
  y(p: number): number | null { return this.series ? this.series.priceToCoordinate(p) : null; }

  /** Puntos de agarre de un dibujo en pantalla */
  handles(d: Drawing): { h: Handle; x: number; y: number }[] {
    const out: { h: Handle; x: number; y: number }[] = [];
    const xa = this.x(d.a.t), ya = this.y(d.a.p);
    if (xa == null || ya == null) return out;
    if (d.kind === "hline") return [{ h: "a", x: Math.min(Math.max(40, xa), this.W - 40), y: ya }];
    if (d.kind === "vline") return [{ h: "a", x: xa, y: this.H / 2 }];
    out.push({ h: "a", x: xa, y: ya });
    if (d.b) {
      const xb = this.x(d.b.t), yb = this.y(d.b.p);
      if (xb != null && yb != null) {
        out.push({ h: "b", x: xb, y: yb });
        if (d.kind === "rect" || d.kind === "profile") { out.push({ h: "ab", x: xa, y: yb }); out.push({ h: "ba", x: xb, y: ya }); }
      }
    }
    return out;
  }

  /** Dibujo (y agarre) más cercano a un punto de la pantalla */
  hit(px: number, py: number, tol: number): { id: string; handle: Handle } | null {
    const st = this.st;
    if (!st || st.hidden) return null;
    const sel = st.drawings.find((d) => d.id === st.selected);
    if (sel) for (const h of this.handles(sel)) if (Math.hypot(px - h.x, py - h.y) <= tol + 2) return { id: sel.id, handle: h.h };
    let best: { id: string; handle: Handle; d: number } | null = null;
    for (const d of st.drawings) {
      const dist = this.distance(d, px, py);
      if (dist != null && dist <= tol && (!best || dist < best.d)) best = { id: d.id, handle: "body", d: dist };
    }
    return best ? { id: best.id, handle: best.handle } : null;
  }

  private distance(d: Drawing, px: number, py: number): number | null {
    const W = this.W;
    const xa = this.x(d.a.t), ya = this.y(d.a.p);
    if (d.kind === "hline") return ya == null ? null : Math.abs(py - ya);
    if (d.kind === "vline") return xa == null ? null : Math.abs(px - xa);
    if (xa == null || ya == null) return null;
    if (d.kind === "hray") return px >= xa - 4 ? Math.abs(py - ya) : null;
    if (d.kind === "text") {
      const b = this.textBox.get(d.id);
      if (!b) return Math.hypot(px - xa, py - ya);
      return px >= b.x - 3 && px <= b.x + b.w + 3 && py >= b.y - 3 && py <= b.y + b.h + 3 ? 0 : null;
    }
    if (!d.b) return null;
    const xb = this.x(d.b.t), yb = this.y(d.b.p);
    if (xb == null || yb == null) return null;
    if (d.kind === "trend") return segDist(px, py, xa, ya, xb, yb);
    if (d.kind === "ray") { const [x2, y2] = this.extend(xa, ya, xb, yb); return segDist(px, py, xa, ya, x2, y2); }
    if (d.kind === "rect" || d.kind === "profile") {
      const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), y0 = Math.min(ya, yb), y1 = Math.max(ya, yb);
      if (px >= x0 && px <= x1 && py >= y0 && py <= y1) return Math.min(4, px - x0, x1 - px, py - y0, y1 - py);
      return Math.min(segDist(px, py, x0, y0, x1, y0), segDist(px, py, x0, y1, x1, y1), segDist(px, py, x0, y0, x0, y1), segDist(px, py, x1, y0, x1, y1));
    }
    if (d.kind === "fib") {
      const x0 = Math.min(xa, xb);
      if (px < x0 - 4 || px > W) return null;
      let m = Infinity;
      for (const l of FIB) { const y = this.y(d.b.p + (d.a.p - d.b.p) * l); if (y != null) m = Math.min(m, Math.abs(py - y)); }
      return m;
    }
    return null;
  }

  /** Prolonga el segmento a-b hasta el borde del panel (rayo) */
  private extend(xa: number, ya: number, xb: number, yb: number): [number, number] {
    const dx = xb - xa, dy = yb - ya;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return [xb, yb];
    const k = 4000 / Math.max(1e-6, Math.hypot(dx, dy));
    return [xa + dx * k, ya + dy * k];
  }

  private draw(ctx: CanvasRenderingContext2D, W: number, H: number) {
    this.W = W; this.H = H;
    const st = this.st;
    if (!st) return;
    const list = st.hidden ? [] : [...st.drawings];
    if (st.draft) list.push(st.draft);
    for (const d of list) this.drawOne(ctx, d, W, H, d.id === st.selected || d === st.draft);
    if (st.measure) this.drawMeasure(ctx, st.measure.a, st.measure.b);
  }

  private drawOne(ctx: CanvasRenderingContext2D, d: Drawing, W: number, H: number, sel: boolean) {
    const th = this.st!.theme;
    const c = d.color, lw = d.width || 1;
    const xa = this.x(d.a.t), ya = this.y(d.a.p);
    ctx.save();
    ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.setLineDash(d.dash ? [6, 4] : []);
    const line = (x1: number, y1: number, x2: number, y2: number) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    const tag = (txt: string, x: number, y: number, align: "left" | "right" | "center") => pill(ctx, x, y, txt, alpha(c, 0.92), th.light && c === COLORS[5] ? "#ffffff" : "#0d1016", align);
    if (d.kind === "hline" && ya != null) {
      const y = Math.round(ya) + 0.5;
      line(0, y, W, y);
      tag((d.text ? d.text + "  " : "") + d.a.p.toFixed(2), W - 4, ya, "right");
    } else if (d.kind === "vline" && xa != null) {
      const x = Math.round(xa) + 0.5;
      line(x, 0, x, H);
      if (d.text) tag(d.text, x + 4, 14, "left");
    } else if (xa != null && ya != null) {
      const xb = d.b ? this.x(d.b.t) : null, yb = d.b ? this.y(d.b.p) : null;
      if (d.kind === "hray") {
        line(xa, Math.round(ya) + 0.5, W, Math.round(ya) + 0.5);
        tag((d.text ? d.text + "  " : "") + d.a.p.toFixed(2), W - 4, ya, "right");
      } else if (d.kind === "text") {
        ctx.font = `600 ${11 + lw}px Inter, system-ui, sans-serif`;
        const txt = d.text || "Texto";
        const w = ctx.measureText(txt).width, h = 13 + lw;
        ctx.fillStyle = c; ctx.textBaseline = "middle"; ctx.textAlign = "left";
        ctx.fillText(txt, xa, ya);
        this.textBox.set(d.id, { x: xa, y: ya - h / 2, w, h });
        if (sel) { ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.strokeRect(xa - 3, ya - h / 2 - 3, w + 6, h + 6); }
      } else if (xb != null && yb != null) {
        if (d.kind === "trend") line(xa, ya, xb, yb);
        else if (d.kind === "ray") { const [x2, y2] = this.extend(xa, ya, xb, yb); line(xa, ya, x2, y2); }
        else if (d.kind === "rect" || d.kind === "profile") {
          const x0 = Math.min(xa, xb), y0 = Math.min(ya, yb), w = Math.abs(xb - xa), h = Math.abs(yb - ya);
          ctx.fillStyle = alpha(c, d.kind === "profile" ? .06 : .13); ctx.fillRect(x0, y0, w, h);
          ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(w), Math.round(h));
          if (d.kind === "profile") { ctx.font = FONT; ctx.fillStyle = c; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText("VP · Rango fijo", x0 + 5, y0 + 4); }
          if (d.text) { ctx.font = FONT; ctx.fillStyle = c; ctx.textBaseline = "top"; ctx.textAlign = "left"; ctx.fillText(d.text, x0 + 4, y0 + 3); }
        } else if (d.kind === "fib" && d.b) {
          const x0 = Math.min(xa, xb);
          const ys = FIB.map((l) => this.y(d.b!.p + (d.a.p - d.b!.p) * l));
          const y382 = ys[2], y618 = ys[4];
          if (y382 != null && y618 != null) { ctx.fillStyle = alpha(c, 0.1); ctx.fillRect(x0, Math.min(y382, y618), W - x0, Math.abs(y618 - y382)); }
          ctx.setLineDash([]);
          FIB.forEach((l, i) => {
            const y = ys[i];
            if (y == null) return;
            ctx.strokeStyle = alpha(c, l === 0 || l === 1 ? 0.95 : 0.7); ctx.lineWidth = l === 0.5 || l === 0.618 ? lw + 0.5 : lw;
            line(x0, Math.round(y) + 0.5, W, Math.round(y) + 0.5);
            ctx.font = FONT; ctx.fillStyle = c; ctx.textBaseline = "bottom"; ctx.textAlign = "left";
            ctx.fillText(`${l}  (${(d.b!.p + (d.a.p - d.b!.p) * l).toFixed(2)})`, x0 + 4, y - 2);
          });
          ctx.strokeStyle = alpha(c, 0.5); ctx.lineWidth = 1; ctx.setLineDash([3, 3]); line(xa, ya, xb, yb);
        }
      }
    }
    if (sel) {
      ctx.setLineDash([]);
      for (const h of this.handles(d)) {
        ctx.beginPath(); ctx.arc(h.x, h.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = th.bg; ctx.fill(); ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawMeasure(ctx: CanvasRenderingContext2D, a: Pt, b: Pt) {
    const th = this.st!.theme;
    const xa = this.x(a.t), ya = this.y(a.p), xb = this.x(b.t), yb = this.y(b.p);
    if (xa == null || ya == null || xb == null || yb == null) return;
    const up = b.p >= a.p, c = up ? th.buy : th.sell;
    const x0 = Math.min(xa, xb), y0 = Math.min(ya, yb), w = Math.abs(xb - xa), h = Math.abs(yb - ya);
    ctx.save();
    ctx.fillStyle = alpha(c, 0.16); ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = alpha(c, 0.8); ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xb, yb); ctx.stroke();
    const st = this.st!, T = st.times();
    const bars = Math.round(tToIdx(T, st.tf, b.t) - tToIdx(T, st.tf, a.t));
    const dp = b.p - a.p;
    const txt = `${dp >= 0 ? "+" : ""}${dp.toFixed(2)} (${(dp / a.p * 100).toFixed(2)} %) · ${Math.abs(bars)} velas · ${dur(b.t - a.t)}`;
    pill(ctx, x0 + w / 2, up ? y0 - 12 : y0 + h + 12, txt, alpha(c, 0.95), "#ffffff", "center");
    ctx.restore();
  }
}
