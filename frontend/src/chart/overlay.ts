// Capa de dibujo sobre las velas (primitiva de Lightweight Charts): rangos como cajas sombreadas, niveles con
// etiquetas compactas, órdenes pendientes de las estrategias, trazos entrada→salida de las operaciones,
// zonas de riesgo/beneficio de las posiciones y de la orden en preparación, y el cono de predicción relleno.
import type { IChartApi, ISeriesApi, ISeriesPrimitive, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView, Logical, SeriesAttachedParameter, Time } from "lightweight-charts";
import { alpha, ChartTheme } from "./themes";

export type OverlayData = {
  tf: number;
  times: () => number[];
  nowT: number;
  atr?: number;
  theme: ChartTheme;
  layers: { rangos: boolean; sesionesReales: boolean; niveles: boolean; estrategias: boolean; operaciones: boolean; rr: boolean };
  realSessions?: { id: string; name: string; t0: number; t1: number; color: string }[];
  zones: { name: string; t0: number; t1: number; hi: number; lo: number }[];
  levels: { name: string; price: number; kind: string }[];
  strategies: { name: string; levels?: { buy?: number | null; sell?: number | null } | null }[];
  trades: { side: number; entry: number; exit?: number | null; t_open: number; t_close?: number | null; R?: number | null; pnl?: number | null; strategy?: string; status?: string }[];
  positions: { side: number; price_open: number; sl: number; tp: number; time: number }[];
  preview: { side: number; entry: number; sl: number; tp: number } | null;
  forecast: { points: { t: number; p10: number; p50: number; p90: number }[] } | null;
  news: { t: number; title: string; impact: string }[];
  newsWindow: { before: number; after: number } | null;
};

const FONT = "600 10.5px Inter, system-ui, -apple-system, Segoe UI, sans-serif";
const FONT_S = "500 10px Inter, system-ui, -apple-system, Segoe UI, sans-serif";

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function pill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg: string, align: "left" | "right" | "center" = "left", border?: string) {
  ctx.font = FONT;
  const w = Math.ceil(ctx.measureText(text).width) + 10, h = 16;
  const x0 = align === "left" ? x : align === "right" ? x - w : x - w / 2;
  rr(ctx, x0, y - h / 2, w, h, 3);
  ctx.fillStyle = bg; ctx.fill();
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.stroke(); }
  ctx.fillStyle = fg; ctx.textBaseline = "middle"; ctx.textAlign = "left";
  ctx.fillText(text, x0 + 5, y + 0.5);
  return w;
}
const shortLevel = (name: string) =>
  name === "Máximo de ayer" ? "PDH" : name === "Mínimo de ayer" ? "PDL" : name === "Apertura del día" ? "Apertura" : name === "Apertura 01:05" ? "01:05" : name.replace("Nivel redondo ", "");
const fmt = (v: number) => v.toFixed(2);

export class ChartOverlay implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<"Candlestick"> | null = null;
  private request: (() => void) | null = null;
  data: OverlayData | null = null;
  private views: ISeriesPrimitivePaneView[];

  constructor() {
    const self = this;
    const bottom: ISeriesPrimitivePaneRenderer = { draw: (t: any) => t.useMediaCoordinateSpace((s: any) => self.drawBottom(s.context, s.mediaSize.width, s.mediaSize.height)) };
    const top: ISeriesPrimitivePaneRenderer = { draw: (t: any) => t.useMediaCoordinateSpace((s: any) => self.drawTop(s.context, s.mediaSize.width, s.mediaSize.height)) };
    this.views = [{ zOrder: () => "bottom", renderer: () => bottom }, { zOrder: () => "top", renderer: () => top }];
  }
  attached(p: SeriesAttachedParameter<Time>) { this.chart = p.chart as IChartApi; this.series = p.series as ISeriesApi<"Candlestick">; this.request = p.requestUpdate; }
  detached() { this.chart = null; this.series = null; this.request = null; }
  paneViews() { return this.views; }
  updateAllViews() { /* los datos se leen al dibujar */ }
  setData(d: OverlayData) { this.data = d; this.request?.(); }

  // ---------------------------------------------------------------- coordenadas
  private x(t: number): number | null {
    const d = this.data, ts = this.chart?.timeScale();
    const T = d ? d.times() : [];
    if (!d || !ts || !T.length) return null;
    const n = T.length, tf = d.tf;
    let idx: number;
    if (t <= T[0]) idx = (t - T[0]) / tf;
    else if (t >= T[n - 1]) idx = n - 1 + (t - T[n - 1]) / tf;
    else {
      let lo = 0, hi = n - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] < t) lo = m + 1; else hi = m; }
      idx = T[lo] === t ? lo : lo - 1 + (t - T[lo - 1]) / (T[lo] - T[lo - 1]);
    }
    // logicalToCoordinate solo admite posiciones enteras: interpolar entre dos velas
    const i0 = Math.floor(idx), f = idx - i0;
    const c0 = ts.logicalToCoordinate(i0 as Logical);
    if (c0 == null) return null;
    if (f < 1e-9) return c0;
    const c1 = ts.logicalToCoordinate((i0 + 1) as Logical);
    return c1 == null ? c0 : c0 + (c1 - c0) * f;
  }
  private y(p: number): number | null { return this.series ? this.series.priceToCoordinate(p) : null; }

  // ---------------------------------------------------------------- fondo: cajas y zonas
  private drawBottom(ctx: CanvasRenderingContext2D, W: number, _H: number) {
    const d = this.data;
    if (!d) return;
    const th = d.theme, fillA = th.light ? 0.07 : 0.09;
    // Banda vertical por franja horaria del centro financiero (sin rangos de precio).
    if (d.layers.sesionesReales) {
      for (const z of d.realSessions || []) {
        const x0 = this.x(z.t0), x1 = this.x(z.t1);
        if (x0 == null || x1 == null || x1 <= 0 || x0 >= W) continue;
        const a = Math.max(0, x0), b = Math.min(W, x1);
        ctx.fillStyle = alpha(z.color, th.light ? .055 : .05);
        ctx.fillRect(a, 0, Math.max(1, b - a), _H);
        ctx.setLineDash([3, 7]);
        ctx.strokeStyle = alpha(z.color, .21);
        ctx.beginPath();
        if (x0 >= 0) { ctx.moveTo(Math.round(x0) + .5, 0); ctx.lineTo(Math.round(x0) + .5, _H); }
        if (x1 <= W) { ctx.moveTo(Math.round(x1) + .5, 0); ctx.lineTo(Math.round(x1) + .5, _H); }
        ctx.stroke(); ctx.setLineDash([]);
      }
    }
    if (d.layers.rangos) {
      for (const z of d.zones) {
        const c = /^Asia/.test(z.name) ? th.zone.asia : /^Tokio/.test(z.name) ? th.zone.tokyo : th.zone.aorb;
        const x0 = this.x(z.t0), x1 = this.x(z.t1), y0 = this.y(z.hi), y1 = this.y(z.lo);
        if (x0 == null || x1 == null || y0 == null || y1 == null || x1 < 0 || x0 > W) continue;
        ctx.fillStyle = alpha(c, fillA);
        ctx.fillRect(x0, y0, Math.max(1, x1 - x0), y1 - y0);
        // prolongación del máximo y el mínimo (referencia de ruptura)
        ctx.strokeStyle = alpha(c, 0.35); ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(x1, Math.round(y0) + 0.5); ctx.lineTo(W, Math.round(y0) + 0.5); ctx.moveTo(x1, Math.round(y1) + 0.5); ctx.lineTo(W, Math.round(y1) + 0.5); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (d.layers.rr) {
      for (const p of d.positions) {
        const xp = this.x(p.time) ?? this.x(d.nowT);
        if (xp == null) continue;
        const x0 = Math.max(0, Math.min(xp, W)), ye = this.y(p.price_open);
        if (ye == null) continue;
        if (p.tp) { const yt = this.y(p.tp); if (yt != null) { ctx.fillStyle = alpha(th.tp, 0.08); ctx.fillRect(x0, Math.min(ye, yt), W - x0, Math.abs(yt - ye)); } }
        if (p.sl) { const ys = this.y(p.sl); if (ys != null) { ctx.fillStyle = alpha(th.sl, 0.08); ctx.fillRect(x0, Math.min(ye, ys), W - x0, Math.abs(ys - ye)); } }
      }
    }
    if (d.preview) {
      const pv = d.preview, xn = this.x(d.nowT) ?? W * 0.7;
      const bw = Math.min(W - 8, Math.max(190, W * 0.24));
      const x0 = Math.max(4, Math.min(xn, W - bw - 4)), x1 = x0 + bw;
      const ye = this.y(pv.entry), ys = this.y(pv.sl), yt = pv.tp ? this.y(pv.tp) : null;
      if (ye != null && ys != null) {
        ctx.fillStyle = alpha(th.sl, 0.16); ctx.fillRect(x0, Math.min(ye, ys), x1 - x0, Math.abs(ys - ye));
        if (yt != null) { ctx.fillStyle = alpha(th.tp, 0.16); ctx.fillRect(x0, Math.min(ye, yt), x1 - x0, Math.abs(yt - ye)); }
      }
    }
    if (d.newsWindow) {
      for (const n of d.news) {
        const xa = this.x(n.t - d.newsWindow.before * 60), xb = this.x(n.t + d.newsWindow.after * 60);
        if (xa == null || xb == null || xb < 0 || xa > W) continue;
        ctx.fillStyle = alpha(th.sl, th.light ? 0.07 : 0.1);
        ctx.fillRect(xa, 0, Math.max(2, xb - xa), _H);
      }
    }
    const fc = d.forecast?.points;
    if (fc && fc.length > 1) {
      const pts = fc.map((p, i) => ({ x: this.x(i === 0 ? d.nowT : p.t), hi: this.y(p.p90), lo: this.y(p.p10) }));
      if (pts.every((p) => p.x != null && p.hi != null && p.lo != null)) {
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x!, p.hi!) : ctx.moveTo(p.x!, p.hi!)));
        for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i].x!, pts[i].lo!);
        ctx.closePath(); ctx.fillStyle = alpha(th.forecast, th.light ? 0.1 : 0.12); ctx.fill();
      }
    }
  }

  // ---------------------------------------------------------------- encima: líneas, marcas y etiquetas
  private drawTop(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const d = this.data;
    if (!d) return;
    const th = d.theme;
    const tags: { y: number; draw: (y: number) => void }[] = [];

    if (d.layers.sesionesReales) {
      for (const z of d.realSessions || []) {
        const x0 = this.x(z.t0), x1 = this.x(z.t1);
        if (x0 == null || x1 == null || x1 <= 0 || x0 >= W || x1 - x0 < 65) continue;
        // Etiqueta independiente en la parte superior; nunca la confundimos con una zona de SL/TP.
        const left = Math.max(4, x0 + 6);
        if (left + 88 > W) continue;
        ctx.font = "600 10px Inter, system-ui, sans-serif";
        ctx.textBaseline = "top"; ctx.textAlign = "left";
        ctx.fillStyle = alpha(z.color, .95);
        ctx.fillText(z.name.replace(" · Asia", ""), left, 12);
      }
    }

    if (d.layers.rangos) {
      for (const z of d.zones) {
        const c = /^Asia/.test(z.name) ? th.zone.asia : /^Tokio/.test(z.name) ? th.zone.tokyo : th.zone.aorb;
        const x0 = this.x(z.t0), x1 = this.x(z.t1), y0 = this.y(z.hi), y1 = this.y(z.lo);
        if (x0 == null || x1 == null || y0 == null || y1 == null || x1 < 0 || x0 > W) continue;
        ctx.strokeStyle = alpha(c, 0.7); ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.max(1, Math.round(x1 - x0)), Math.round(y1 - y0));
        const label = z.name.split(" ")[0] === "Rango" ? "AORB" : z.name.split(" ")[0];
        const size = z.hi - z.lo;
        const txt = `${label} · ${fmt(size)}${d.atr ? ` (${(size / d.atr).toFixed(2)} ATR)` : ""}`;
        if (x1 - x0 > 50) {
          ctx.font = FONT_S; ctx.fillStyle = alpha(c, 0.95); ctx.textBaseline = "bottom"; ctx.textAlign = "left";
          ctx.fillText(txt, Math.max(2, x0 + 4), y0 - 3);
        }
      }
    }

    if (d.layers.niveles) {
      for (const l of d.levels) {
        if (l.kind === "asia") continue;                    // ya los muestra la caja de Asia
        const y = this.y(l.price);
        if (y == null || y < -10 || y > H + 10) continue;
        const c = l.kind === "pd" ? th.level.pd : l.kind === "r50" ? th.level.r50 : th.level.open;
        const a = l.kind === "r50" ? 0.32 : 0.55;
        ctx.strokeStyle = alpha(c, a); ctx.lineWidth = 1; ctx.setLineDash(l.kind === "r50" ? [1, 4] : [2, 3]);
        ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(W, Math.round(y) + 0.5); ctx.stroke(); ctx.setLineDash([]);
        const txt = l.kind === "r50" ? fmt(l.price) : `${shortLevel(l.name)}  ${fmt(l.price)}`;
        tags.push({ y, draw: (yy) => pill(ctx, 6, yy, txt, th.tagBg, alpha(c, l.kind === "r50" ? 0.8 : 1), "left", alpha(c, 0.35)) });
      }
    }

    if (d.layers.estrategias) {
      const xs = Math.max(0, this.x(d.nowT) ?? W * 0.75);
      for (const s of d.strategies) {
        for (const [k, side] of [["buy", 1], ["sell", -1]] as const) {
          const p = s.levels?.[k];
          if (!p) continue;
          const y = this.y(p);
          if (y == null || y < -10 || y > H + 10) continue;
          const c = side > 0 ? th.buy : th.sell;
          ctx.strokeStyle = alpha(c, 0.85); ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
          ctx.beginPath(); ctx.moveTo(xs, Math.round(y) + 0.5); ctx.lineTo(W, Math.round(y) + 0.5); ctx.stroke(); ctx.setLineDash([]);
          pill(ctx, W - 4, y, `${s.name} ${side > 0 ? "▲ compra" : "▼ venta"}  ${fmt(p)}`, alpha(c, 0.92), "#ffffff", "right");
        }
      }
    }

    if (d.layers.operaciones) {
      for (const t of d.trades) {
        if (!t.t_open || !t.entry) continue;
        const xe = this.x(t.t_open), ye = this.y(t.entry);
        if (xe == null || ye == null) continue;
        const closed = !!(t.t_close && t.exit);
        const xx = closed ? this.x(t.t_close!) : null, yx = closed ? this.y(t.exit!) : null;
        if (xe > W + 20 && (xx == null || xx > W + 20)) continue;
        if ((xx ?? xe) < -20) continue;
        const res = (t.pnl ?? 0) >= 0 ? th.win : th.loss;
        if (closed && xx != null && yx != null) {
          ctx.strokeStyle = alpha(res, 0.75); ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(xe, ye); ctx.lineTo(xx, yx); ctx.stroke(); ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(xx, yx, 3.5, 0, Math.PI * 2); ctx.fillStyle = res; ctx.fill();
          ctx.strokeStyle = th.bg; ctx.lineWidth = 1; ctx.stroke();
          const lab = t.R != null ? `${t.R >= 0 ? "+" : ""}${Number(t.R).toFixed(1)}R` : t.pnl != null ? `${t.pnl >= 0 ? "+" : ""}${Number(t.pnl).toFixed(0)}` : "";
          if (lab) pill(ctx, xx + 6, yx, lab, alpha(res, 0.9), "#ffffff", "left");
        }
        // triángulo de entrada en la dirección de la operación
        const c = t.side > 0 ? th.buy : th.sell, s = 6;
        ctx.beginPath();
        if (t.side > 0) { ctx.moveTo(xe, ye - 1); ctx.lineTo(xe - s, ye + s + 2); ctx.lineTo(xe + s, ye + s + 2); }
        else { ctx.moveTo(xe, ye + 1); ctx.lineTo(xe - s, ye - s - 2); ctx.lineTo(xe + s, ye - s - 2); }
        ctx.closePath(); ctx.fillStyle = c; ctx.fill(); ctx.strokeStyle = th.bg; ctx.lineWidth = 1; ctx.stroke();
        const code = !t.strategy || t.strategy === "MANUAL" ? "M" : t.strategy.startsWith("EA ") ? "EA" : t.strategy;
        ctx.font = FONT_S; ctx.fillStyle = alpha(c, 0.95); ctx.textAlign = "center"; ctx.textBaseline = t.side > 0 ? "top" : "bottom";
        ctx.fillText(code, xe, t.side > 0 ? ye + s + 4 : ye - s - 4);
      }
    }

    if (d.preview) {
      const pv = d.preview, xn = this.x(d.nowT) ?? W * 0.7;
      const bw = Math.min(W - 8, Math.max(190, W * 0.24));
      const x0 = Math.max(4, Math.min(xn, W - bw - 4)), x1 = x0 + bw;
      const ye = this.y(pv.entry), ys = this.y(pv.sl), yt = pv.tp ? this.y(pv.tp) : null;
      if (ye != null && ys != null) {
        const risk = Math.abs(pv.entry - pv.sl), rew = pv.tp ? Math.abs(pv.tp - pv.entry) : 0;
        ctx.strokeStyle = alpha(th.sl, 0.6); ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, Math.min(ye, ys) + 0.5, x1 - x0, Math.abs(ys - ye));
        if (yt != null) { ctx.strokeStyle = alpha(th.tp, 0.6); ctx.strokeRect(x0 + 0.5, Math.min(ye, yt) + 0.5, x1 - x0, Math.abs(yt - ye)); }
        const xm = (x0 + x1) / 2;
        pill(ctx, xm, (ye + ys) / 2, `Riesgo ${fmt(risk)}`, alpha(th.sl, 0.9), "#ffffff", "center");
        if (yt != null) pill(ctx, xm, (ye + yt) / 2, `Beneficio ${fmt(rew)} · 1 : ${(rew / risk).toFixed(2)}`, alpha(th.tp, 0.9), "#ffffff", "center");
      }
    }

    // noticias: línea vertical con etiqueta arriba
    let lastX = -Infinity, row = 0;
    for (const n of [...d.news].sort((a, b) => a.t - b.t)) {
      const x = this.x(n.t);
      if (x == null || x < -5 || x > W + 5) continue;
      const c = n.impact === "High" ? th.sl : th.forecast;
      ctx.strokeStyle = alpha(c, 0.75); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, H); ctx.stroke(); ctx.setLineDash([]);
      row = x - lastX < 130 ? row + 1 : 0;
      lastX = x;
      const label = n.title.length > 22 ? n.title.slice(0, 21) + "…" : n.title;
      pill(ctx, x + 3, 30 + row * 18, `⚑ ${label}`, alpha(c, 0.9), "#ffffff", "left");
    }

    // etiquetas de niveles sin solaparse
    tags.sort((a, b) => a.y - b.y);
    let last = -Infinity;
    for (const t of tags) { const yy = Math.max(t.y, last + 17); t.draw(yy); last = yy; }
  }
}
