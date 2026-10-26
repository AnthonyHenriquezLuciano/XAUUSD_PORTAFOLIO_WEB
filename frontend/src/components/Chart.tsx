import React, { useEffect, useRef, useState } from "react";
import { createChart, CrosshairMode, IChartApi, IPriceLine, ISeriesApi, LineStyle, UTCTimestamp } from "lightweight-charts";
import { ChartOverlay } from "../chart/overlay";
import { alpha, themeById } from "../chart/themes";
import { api } from "../api";
import { fmt, useApp } from "../store";
import { useUI } from "../uiState";

const TF_SEC: Record<string, number> = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };

type LineDef = {
  id: string; price: number; color: string; title: string; style?: LineStyle; width?: number;
  drag?: { kind: "pos-sl" | "pos-tp" | "ord-price" | "ord-sl" | "ord-tp" | "pv-entry" | "pv-sl" | "pv-tp"; ticket?: number };
};

export default function Chart() {
  const { s, toast } = useApp();
  const ui = useUI();
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const fcRef = useRef<ISeriesApi<"Line">[]>([]);
  const overlayRef = useRef<ChartOverlay | null>(null);
  const timesRef = useRef<number[]>([]);
  const linesRef = useRef<Map<string, { line: IPriceLine; def: LineDef }>>(new Map());
  const lastRef = useRef<{ time: number; open: number; high: number; low: number; close: number } | null>(null);
  const dragRef = useRef<{ id: string; def: LineDef } | null>(null);
  const [tf, setTf] = useState<string>(() => { try { return localStorage.getItem("xauai.tf") || "M5"; } catch { return "M5"; } });
  const [dragTip, setDragTip] = useState<{ y: number; text: string } | null>(null);
  const [overlays, setOverlays] = useState<any>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [hover, setHover] = useState<{ o: number; h: number; l: number; c: number; t: number } | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const th = themeById(ui.chart.theme);
  const connected = s.status === "conectado";
  const extraRef = useRef<number[]>([]);
  const reloadRef = useRef(false);
  const stateRef = useRef({ s, ui });
  stateRef.current = { s, ui };

  // ------------------------------------------------------------------ creación
  useEffect(() => {
    if (!el.current) return;
    const chart = createChart(el.current, {
      layout: { background: { color: "#0d1016" }, textColor: "#8a93a6", fontFamily: "Inter, system-ui, sans-serif" },
      grid: { vertLines: { color: "#161c27" }, horzLines: { color: "#161c27" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#262e3f", scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: "#262e3f", timeVisible: true, secondsVisible: false, rightOffset: 12 },
      autoSize: true,
      localization: { locale: "es-ES", priceFormatter: (p: number) => p.toFixed(2) },
    });
    const candle = chart.addCandlestickSeries({
      upColor: "#22b07d", downColor: "#e5534b", borderUpColor: "#22b07d", borderDownColor: "#e5534b",
      wickUpColor: "#22b07d", wickDownColor: "#e5534b", priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      // la escala incluye SL/TP de la orden en preparación y de las posiciones
      autoscaleInfoProvider: (orig: () => any) => {
        const r = orig();
        const ex = extraRef.current;
        if (!r || !ex.length) return r;
        return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, ...ex), maxValue: Math.max(r.priceRange.maxValue, ...ex) } };
      },
    });
    chartRef.current = chart;
    candleRef.current = candle;
    const ov = new ChartOverlay();
    candle.attachPrimitive(ov);
    overlayRef.current = ov;
    chart.subscribeCrosshairMove((p: any) => {
      const d = p?.seriesData?.get(candle);
      if (!d || d.open == null) { setHover(null); return; }
      setHover({ o: d.open, h: d.high, l: d.low, c: d.close, t: Number(p.time) });
    });
    const mk = (color: string, style: LineStyle, width: 1 | 2) => chart.addLineSeries({ color, lineStyle: style, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    fcRef.current = [mk("rgba(224,176,79,.7)", LineStyle.Solid, 1), mk("rgba(243,205,122,.95)", LineStyle.Dashed, 2), mk("rgba(224,176,79,.7)", LineStyle.Solid, 1)];
    return () => { chart.remove(); chartRef.current = null; candleRef.current = null; linesRef.current.clear(); };
  }, []);

  // ------------------------------------------------------------------ datos
  useEffect(() => {
    try { localStorage.setItem("xauai.tf", tf); } catch { /* sin almacenamiento */ }
    if (!connected || !candleRef.current) return;
    let cancel = false;
    api(`/api/bars?tf=${tf}&limit=3000`).then((d) => {
      if (cancel || !candleRef.current) return;
      const bars = d.bars.map((b: any) => ({ ...b, time: b.time as UTCTimestamp }));
      candleRef.current.setData(bars);
      timesRef.current = bars.map((b: any) => Number(b.time));
      lastRef.current = bars.length ? { ...bars[bars.length - 1] } : null;
      chartRef.current?.timeScale().scrollToRealTime();
    }).catch((e) => toast(e.message, "error"));
    return () => { cancel = true; };
  }, [tf, connected, s.broker, s.accountInfo?.id, s.barsVersion]);

  // ticks -> última vela
  useEffect(() => {
    const t = s.tick;
    const c = candleRef.current;
    if (!t || !c || !lastRef.current) return;
    const sec = TF_SEC[tf];
    const bucket = t.time - (t.time % sec);
    const last = lastRef.current;
    if (bucket > last.time) {
      lastRef.current = { time: bucket, open: t.bid, high: t.bid, low: t.bid, close: t.bid };
      timesRef.current = [...timesRef.current, bucket];
      // al cerrar una vela se recargan las velas cerradas (con el simulador acelerado pueden cerrarse varias a la vez)
      if (!reloadRef.current) {
        reloadRef.current = true;
        api(`/api/bars?tf=${tf}&limit=3000`).then((d) => {
          const bars = d.bars.map((b: any) => ({ ...b, time: b.time as UTCTimestamp }));
          const cur = lastRef.current;
          if (cur && bars.length && bars[bars.length - 1].time < cur.time) bars.push({ ...cur, time: cur.time as UTCTimestamp });
          candleRef.current?.setData(bars);
          timesRef.current = bars.map((b: any) => Number(b.time));
        }).catch(() => {}).finally(() => { reloadRef.current = false; });
      }
    } else if (bucket === last.time) {
      last.high = Math.max(last.high, t.bid); last.low = Math.min(last.low, t.bid); last.close = t.bid;
    } else return;
    c.update({ ...lastRef.current, time: lastRef.current.time as UTCTimestamp });
  }, [s.tick, tf]);

  // overlays (rangos, niveles de estrategias)
  useEffect(() => {
    if (!connected) return;
    const load = () => api("/api/overlays").then(setOverlays).catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [connected, s.strategies.map((x) => x.state).join()]);

  // operaciones del diario (trazos entrada → salida en la capa de dibujo)
  useEffect(() => {
    if (!connected) { setTrades([]); return; }
    api("/api/trades?n=300").then((d) => setTrades(d.trades || [])).catch(() => {});
  }, [connected, s.tradeClosed, s.positions.length, s.accountInfo?.id]);

  // cono de predicción
  useEffect(() => {
    const fc = s.signals?.forecast;
    const [lo, md, hi] = fcRef.current;
    if (!lo) return;
    if (!ui.showForecast || !fc?.points?.length) { lo.setData([]); md.setData([]); hi.setData([]); return; }
    const last = lastRef.current?.time ?? fc.points[0].t;
    const pts = fc.points.map((p: any, i: number) => ({ ...p, t: i === 0 ? last : last + p.h * 3600 }));
    lo.setData(pts.map((p: any) => ({ time: p.t as UTCTimestamp, value: p.p10 })));
    md.setData(pts.map((p: any) => ({ time: p.t as UTCTimestamp, value: p.p50 })));
    hi.setData(pts.map((p: any) => ({ time: p.t as UTCTimestamp, value: p.p90 })));
  }, [ui.showForecast, s.signals?.forecast, tf]);

  // ------------------------------------------------------------------ líneas de precio
  const contract = s.settings?.contract_size || 100;
  const defs: LineDef[] = [];
  for (const p of s.positions) {
    const sideTxt = p.side > 0 ? "Compra" : "Venta";
    defs.push({ id: `pe${p.ticket}`, price: p.price_open, color: p.side > 0 ? th.buy : th.sell, title: `${sideTxt} ${p.volume} · ${p.profit >= 0 ? "+" : ""}${fmt(p.profit)}`, width: 1 });
    if (p.sl) defs.push({ id: `ps${p.ticket}`, price: p.sl, color: th.sl, title: `SL ${fmt((p.sl - p.price_open) * p.side * contract * p.volume)}`, width: 2, drag: { kind: "pos-sl", ticket: p.ticket } });
    if (p.tp) defs.push({ id: `pt${p.ticket}`, price: p.tp, color: th.tp, title: `TP +${fmt((p.tp - p.price_open) * p.side * contract * p.volume)}`, width: 2, drag: { kind: "pos-tp", ticket: p.ticket } });
  }
  for (const o of s.orders) {
    const okind: Record<string, string> = { buy_limit: "Compra límite", sell_limit: "Venta límite", buy_stop: "Compra stop", sell_stop: "Venta stop" };
    defs.push({ id: `oe${o.ticket}`, price: o.price, color: o.kind.startsWith("buy") ? th.buy : th.sell, title: `${okind[o.kind] || o.kind} ${o.volume}`, width: 2, style: LineStyle.Dashed, drag: { kind: "ord-price", ticket: o.ticket } });
    if (o.sl) defs.push({ id: `os${o.ticket}`, price: o.sl, color: th.sl, title: "SL pend.", style: LineStyle.Dashed, drag: { kind: "ord-sl", ticket: o.ticket } });
    if (o.tp) defs.push({ id: `ot${o.ticket}`, price: o.tp, color: th.tp, title: "TP pend.", style: LineStyle.Dashed, drag: { kind: "ord-tp", ticket: o.ticket } });
  }
  const pv = ui.preview;
  if (pv) {
    const risk = Math.abs(pv.entry - pv.sl);
    const rr = risk > 0 && pv.tp ? Math.abs(pv.tp - pv.entry) / risk : 0;
    if (pv.kind !== "market") defs.push({ id: "pv-e", price: pv.entry, color: th.forecast, title: `Entrada ${pv.kind === "limit" ? "límite" : "stop"}`, width: 2, drag: { kind: "pv-entry" } });
    defs.push({ id: "pv-s", price: pv.sl, color: th.sl, title: `SL (${fmt(risk)} $/oz)`, width: 2, style: LineStyle.Dashed, drag: { kind: "pv-sl" } });
    if (pv.tp) defs.push({ id: "pv-t", price: pv.tp, color: th.tp, title: `TP (${rr.toFixed(1)} R)`, width: 2, style: LineStyle.Dashed, drag: { kind: "pv-tp" } });
  }
  extraRef.current = defs.filter((d) => d.drag).map((d) => d.price);
  const sig = JSON.stringify(defs.map((d) => [d.id, d.price.toFixed(2), d.title, d.color]));

  // ------------------------------------------------------------------ tema del gráfico
  useEffect(() => {
    const chart = chartRef.current, c = candleRef.current;
    if (!chart || !c) return;
    const hollow = ui.chart.candles === "huecas";
    chart.applyOptions({
      layout: { background: { color: th.bg }, textColor: th.text },
      grid: { vertLines: { color: th.grid, visible: ui.chart.grid }, horzLines: { color: th.grid, visible: ui.chart.grid } },
      crosshair: { vertLine: { color: th.crosshair, labelBackgroundColor: th.border }, horzLine: { color: th.crosshair, labelBackgroundColor: th.border } },
      rightPriceScale: { borderColor: th.border }, timeScale: { borderColor: th.border },
    });
    c.applyOptions({ upColor: hollow ? th.bg : th.up, downColor: th.down, borderUpColor: th.up, borderDownColor: th.down, wickUpColor: th.wickUp, wickDownColor: th.wickDown });
    const [lo, md, hi] = fcRef.current;
    lo?.applyOptions({ color: alpha(th.forecast, 0.7) }); hi?.applyOptions({ color: alpha(th.forecast, 0.7) }); md?.applyOptions({ color: th.forecast });
  }, [th.id, ui.chart.candles, ui.chart.grid]);

  // ------------------------------------------------------------------ capa de dibujo (rangos, niveles, estrategias, operaciones)
  useEffect(() => {
    const ov = overlayRef.current;
    if (!ov) return;
    const fc = ui.showForecast && s.signals?.forecast?.points?.length ? s.signals.forecast : null;
    const last = lastRef.current?.time ?? s.tick?.time ?? 0;
    ov.setData({
      tf: TF_SEC[tf], times: () => timesRef.current, nowT: last, atr: s.signals?.atr, theme: th,
      layers: { rangos: !!ui.layers.rangos, niveles: !!ui.layers.niveles, estrategias: !!ui.layers.estrategias, operaciones: !!ui.layers.operaciones, rr: ui.chart.rr },
      zones: overlays?.zones || [], levels: s.signals?.levels || [], strategies: s.strategies || [],
      trades: trades.filter((t) => t.status !== "abierta"), positions: s.positions,
      preview: ui.preview ? { side: ui.preview.side, entry: ui.preview.entry, sl: ui.preview.sl, tp: ui.preview.tp } : null,
      forecast: fc ? { points: fc.points.map((p: any, i: number) => ({ ...p, t: i === 0 ? last : last + p.h * 3600 })) } : null,
    });
  }, [th.id, tf, overlays, s.signals, s.strategies, trades, s.positions, ui.preview, ui.layers, ui.chart.rr, ui.showForecast, s.barsVersion, lastRef.current?.time, s.tick?.time ? Math.floor(s.tick.time / 30) : 0]);

  useEffect(() => {
    const c = candleRef.current;
    if (!c) return;
    const map = linesRef.current;
    const seen = new Set<string>();
    for (const d of defs) {
      seen.add(d.id);
      const cur = map.get(d.id);
      if (dragRef.current?.id === d.id) continue;            // no tocar la línea que se está arrastrando
      const opts = { price: d.price, color: d.color, title: d.title, lineWidth: (d.width || 1) as 1 | 2, lineStyle: d.style ?? LineStyle.Solid, axisLabelVisible: true };
      if (cur) { cur.line.applyOptions(opts); cur.def = d; }
      else map.set(d.id, { line: c.createPriceLine(opts), def: d });
    }
    for (const [id, v] of map) if (!seen.has(id) && dragRef.current?.id !== id) { c.removePriceLine(v.line); map.delete(id); }
  }, [sig]);

  // ------------------------------------------------------------------ arrastrar SL / TP / entrada
  useEffect(() => {
    const box = el.current;
    if (!box) return;
    let tol = 7;
    const near = (y: number) => {
      const c = candleRef.current;
      if (!c) return null;
      let best: { id: string; def: LineDef; d: number } | null = null;
      for (const [id, v] of linesRef.current) {
        if (!v.def.drag) continue;
        const ly = c.priceToCoordinate(v.def.price);
        if (ly === null) continue;
        const d = Math.abs(ly - y);
        if (d <= tol && (!best || d < best.d)) best = { id, def: v.def, d };
      }
      return best;
    };
    let pending: number | null = null;
    const tipFor = (def: LineDef, price: number, y: number) => {
      const { s: st, ui: u } = stateRef.current;
      const k = def.drag!.kind;
      let txt = `${fmt(price)}`;
      if (k.startsWith("pos")) {
        const p = st.positions.find((x) => x.ticket === def.drag!.ticket);
        if (p) {
          const pnl = (price - p.price_open) * p.side * contract * p.volume;
          const rsk = p.sl ? Math.abs(p.price_open - p.sl) : 0;
          txt += `  ·  ${pnl >= 0 ? "+" : ""}${fmt(pnl)} $` + (rsk && k === "pos-tp" ? `  ·  ${(Math.abs(price - p.price_open) / rsk).toFixed(2)} R` : "");
        }
      } else if (k.startsWith("pv") && u.preview) {
        const pvv = { ...u.preview, ...(k === "pv-sl" ? { sl: price } : k === "pv-tp" ? { tp: price } : { entry: price }) };
        const risk = Math.abs(pvv.entry - pvv.sl);
        txt += `  ·  riesgo ${fmt(risk)} $/oz` + (pvv.tp && risk ? `  ·  ${(Math.abs(pvv.tp - pvv.entry) / risk).toFixed(2)} R` : "");
      }
      setDragTip({ y, text: txt });
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const r = box.getBoundingClientRect();
      const hit = near(e.clientY - r.top);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { id: hit.id, def: hit.def };
      try { box.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
      chartRef.current?.applyOptions({ handleScroll: false, handleScale: false });
    };
    const move = (e: PointerEvent) => {
      const r = box.getBoundingClientRect();
      const y = e.clientY - r.top;
      const dr = dragRef.current;
      if (!dr) {
        box.style.cursor = near(y) ? "ns-resize" : "";
        return;
      }
      const price = candleRef.current?.coordinateToPrice(y);
      if (price === null || price === undefined) return;
      const v = linesRef.current.get(dr.id);
      if (v) { v.line.applyOptions({ price }); v.def = { ...v.def, price }; }
      if (pending) cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => tipFor(dr.def, price, y));
    };
    const up = async () => {
      const dr = dragRef.current;
      if (!dr) return;
      dragRef.current = null;
      setDragTip(null);
      chartRef.current?.applyOptions({ handleScroll: true, handleScale: true });
      const v = linesRef.current.get(dr.id);
      const price = Math.round((v?.def.price ?? dr.def.price) * 100) / 100;
      const { s: st, ui: u } = stateRef.current;
      const k = dr.def.drag!.kind;
      try {
        if (k === "pos-sl" || k === "pos-tp") {
          const p = st.positions.find((x) => x.ticket === dr.def.drag!.ticket);
          if (!p) return;
          await api("/api/position/modify", "POST", { ticket: p.ticket, sl: k === "pos-sl" ? price : p.sl, tp: k === "pos-tp" ? price : p.tp });
          toast(`${k === "pos-sl" ? "SL" : "TP"} movido a ${fmt(price)}`, "ok");
        } else if (k.startsWith("ord")) {
          const o = st.orders.find((x) => x.ticket === dr.def.drag!.ticket);
          if (!o) return;
          await api("/api/order/modify", "POST", { ticket: o.ticket, price: k === "ord-price" ? price : o.price, sl: k === "ord-sl" ? price : o.sl, tp: k === "ord-tp" ? price : o.tp });
          toast("Orden pendiente modificada", "ok");
        } else if (u.preview) {
          u.setPreview((pp) => pp ? { ...pp, ...(k === "pv-sl" ? { sl: price } : k === "pv-tp" ? { tp: price } : { entry: price }) } : pp);
        }
      } catch (err: any) {
        toast(err.message, "error");
      }
    };
    const downT = (e: PointerEvent) => { tol = e.pointerType === "touch" ? 16 : 7; down(e); };
    box.addEventListener("pointerdown", downT, true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => { box.removeEventListener("pointerdown", downT, true); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  }, [contract]);

  // ------------------------------------------------------------------ interfaz
  const fc = s.signals?.forecast;
  const p4 = fc?.points?.find((p: any) => p.h === 4);
  return (
    <div className="chartwrap">
      <div className="toolbar">
        <div className="seg">
          {Object.keys(TF_SEC).map((k) => <button key={k} className={tf === k ? "on" : ""} onClick={() => setTf(k)}>{k}</button>)}
        </div>
        <div className="layers-wrap">
          <button className={`btn sm ${layersOpen ? "primary" : ""}`} onClick={() => setLayersOpen(!layersOpen)} aria-expanded={layersOpen}>Capas ▾</button>
          {layersOpen ? (
            <div className="layers-menu" onMouseLeave={() => setLayersOpen(false)}>
              {([["rangos", "Rangos de sesión", th.zone.asia], ["niveles", "Niveles clave", th.level.pd], ["estrategias", "Órdenes de las estrategias", th.buy], ["operaciones", "Operaciones (entrada → salida)", th.win]] as [string, string, string][]).map(([k, l, c]) => (
                <label key={k} className="layer-item"><input type="checkbox" checked={!!ui.layers[k]} onChange={(e) => ui.setLayer(k, e.target.checked)} /><i style={{ background: c }} />{l}</label>
              ))}
              <label className="layer-item"><input type="checkbox" checked={ui.chart.rr} onChange={(e) => ui.setChart({ rr: e.target.checked })} /><i style={{ background: th.tp }} />Zonas de riesgo / beneficio</label>
              <div className="small muted" style={{ padding: "4px 6px 2px" }}>Colores y estilo: Ajustes → Gráfico</div>
            </div>
          ) : null}
        </div>
        <div className="spacer" />
        <button className={`btn sm ${ui.showForecast ? "primary" : ""}`} onClick={() => ui.setShowForecast(!ui.showForecast)} disabled={!fc}>
          {ui.showForecast ? "Ocultar predicción" : "Predecir próximas horas"}
        </button>
        {s.sim ? <SimControls /> : null}
      </div>
      <div className="chart">
        <div ref={el} style={{ position: "absolute", inset: 0 }} />
        <div className="chart-legend">
          {s.tick || hover ? (
            <div className="ohlc mono" style={{ color: th.text }}>
              <span style={{ color: th.light ? "#1f2633" : "#e6e9ef", fontWeight: 700 }}>{s.settings?.symbol || "XAUUSD"}</span>
              <span>· {tf}</span>
              {hover ? (() => {
                const ch = hover.c - hover.o, col = ch >= 0 ? th.up : th.down;
                return <>
                  <span>O <b style={{ color: col }}>{fmt(hover.o)}</b></span><span>H <b style={{ color: col }}>{fmt(hover.h)}</b></span>
                  <span>L <b style={{ color: col }}>{fmt(hover.l)}</b></span><span>C <b style={{ color: col }}>{fmt(hover.c)}</b></span>
                  <span style={{ color: col }}>{ch >= 0 ? "+" : ""}{fmt(ch)} ({((ch / hover.o) * 100).toFixed(2)} %)</span>
                </>;
              })() : s.tick ? <>
                <span>Bid <b style={{ color: th.down }}>{fmt(s.tick.bid)}</b></span><span>Ask <b style={{ color: th.up }}>{fmt(s.tick.ask)}</b></span>
                <span>Spread {fmt(s.tick.ask - s.tick.bid)}</span>
              </> : null}
            </div>
          ) : null}
          {connected && s.broker === "cloud" && !s.ea?.online ? (
            <div className="box small" style={{ borderColor: "var(--warn)" }}>
              <b style={{ color: "var(--warn)" }}>EA desconectado</b>. Se muestran las últimas velas guardadas{s.market?.last_tick ? ` (último precio ${new Date(s.market.last_tick * 1000).toISOString().slice(0, 16).replace("T", " ")} hora del servidor)` : ""}.<br />
              <span className="muted">Abre MT5 con el EA puente en el gráfico para ver el precio en vivo y operar. Las estrategias automáticas también necesitan el EA en marcha.</span>
            </div>
          ) : connected && s.market && s.market.open === false && !s.sim ? (
            <div className="box small" style={{ borderColor: "var(--warn)" }}>
              <b style={{ color: "var(--warn)" }}>Mercado cerrado</b> ({s.market.reason}). Se muestra el último precio{s.market.last_tick ? ` (${new Date(s.market.last_tick * 1000).toISOString().slice(0, 16).replace("T", " ")} hora del servidor)` : ""}.<br />
              <span className="muted">El oro reabre el lunes a la 01:00 hora del servidor (domingo por la noche en América). Mientras tanto puedes revisar señales, diario, backtests y ajustes.</span>
            </div>
          ) : null}
          {ui.showForecast && p4 ? (
            <div className="box small">
              <b className="gold">Cono 80 %</b> a 4 h: {fmt(p4.p10)} – {fmt(p4.p90)}<br />
              <span className="muted">Rango de volatilidad calibrado. La dirección no es predecible (acierto ~50 %).</span>
            </div>
          ) : null}
          {ui.preview ? <div className="box small gold">Arrastra las líneas SL / TP{ui.preview.kind !== "market" ? " / entrada" : ""} en el gráfico</div> : null}
        </div>
        {dragTip ? <div className="dragtip" style={{ top: dragTip.y }}>{dragTip.text}</div> : null}
        {!connected ? <ConnectOverlay /> : null}
      </div>
    </div>
  );
}

function SimControls() {
  const { s } = useApp();
  const set = (b: any) => api("/api/sim", "POST", b).catch(() => {});
  return (
    <div className="row small">
      <span className="chip gold">Simulación</span>
      <button className="btn sm" onClick={() => set({ paused: !s.sim?.paused })}>{s.sim?.paused ? "▶ Reanudar" : "❚❚ Pausa"}</button>
      <select value={s.sim?.speed} onChange={(e) => set({ speed: Number(e.target.value) })}>
        {[1, 10, 60, 300, 1200].map((v) => <option key={v} value={v}>{v === 1 ? "Tiempo real" : `x${v}`}</option>)}
      </select>
    </div>
  );
}

function ConnectOverlay() {
  const ui = useUI();
  const { s } = useApp();
  return (
    <div className="overlay-empty">
      <div className="col" style={{ alignItems: "center", textAlign: "center", maxWidth: 420 }}>
        <svg width="54" height="54" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#161a22" /><path d="M7 22l6-8 5 5 7-10" stroke="#e0b04f" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <h2 style={{ margin: "6px 0 0" }}>XAU Portfolio AI</h2>
        <div className="muted">{s.status === "conectando" ? "Cargando la cuenta y sus velas…" : "Elige una cuenta conectada a tu MT5 o prueba el simulador con días reales de oro."}</div>
        <button className="btn primary" onClick={() => ui.setAccountOpen(true)} disabled={s.status === "conectando"}>{s.status === "conectando" ? "Cargando…" : "Elegir cuenta"}</button>
      </div>
    </div>
  );
}
