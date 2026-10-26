import React, { useEffect, useRef, useState } from "react";
import { createChart, IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { api } from "../api";
import { fmt } from "../store";

type Candle = { time: number; open: number; high: number; low: number; close: number };
const tfOptions = ["M1", "M5", "M15", "H1"] as const;
type TF = typeof tfOptions[number];

export default function CandleReplay() {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candle = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [tf, setTf] = useState<TF>("M5");
  const [bars, setBars] = useState<Candle[]>([]);
  const [index, setIndex] = useState(120);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(300);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    const c = createChart(host.current, {
      autoSize: true,
      layout: { background: { color: "#111418" }, textColor: "#aaa49b", fontFamily: "IBM Plex Sans" },
      grid: { vertLines: { color: "#202328" }, horzLines: { color: "#202328" } },
      timeScale: { timeVisible: true, borderColor: "#383b41" },
      rightPriceScale: { borderColor: "#383b41" },
      localization: { locale: "es-ES" }
    });
    chart.current = c;
    candle.current = c.addCandlestickSeries({
      upColor: "#21a67c", downColor: "#c75050", borderVisible: false,
      wickUpColor: "#21a67c", wickDownColor: "#c75050",
      priceFormat: { type: "price", precision: 2, minMove: .01 }
    });
    return () => { c.remove(); chart.current = null; candle.current = null; };
  }, []);

  useEffect(() => {
    let alive = true;
    setPlaying(false);
    setLoading(true);
    setError("");
    api("/api/bars?tf=" + tf + "&limit=3000")
      .then((result: any) => {
        if (!alive) return;
        const d: Candle[] = Array.isArray(result.bars) ? result.bars.filter((x: any) =>
          Number.isFinite(Number(x.time)) && Number.isFinite(Number(x.close))) : [];
        setBars(d);
        setIndex(Math.min(d.length - 1, 120));
      }).catch((e: Error) => { if (alive) { setBars([]); setError(e.message); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tf]);

  useEffect(() => {
    if (!candle.current) return;
    const subset = bars.slice(Math.max(0, index - 199), Math.max(0, index + 1)).map(b => ({ ...b, time: b.time as UTCTimestamp }));
    candle.current.setData(subset);
    if (subset.length) chart.current?.timeScale().fitContent();
  }, [bars, index]);

  useEffect(() => {
    if (bars.length && index >= bars.length - 1) setPlaying(false);
  }, [index, bars.length]);

  useEffect(() => {
    if (!playing || !bars.length) return;
    const timer = setInterval(() => setIndex(i => Math.min(bars.length - 1, i + 1)), speed);
    return () => clearInterval(timer);
  }, [playing, speed, bars.length]);

  const last = bars[index];
  return <div className="premium-candle">
    <div className="premium-actions">
      <span className="premium-note">Velas históricas cargadas del bróker (sin futuro visible)</span>
      <div className="spacer" />
      <label className="premium-inline-label">Temporalidad<select value={tf} onChange={e => setTf(e.target.value as TF)}>
        {tfOptions.map(x => <option value={x} key={x}>{x}</option>)}
      </select></label>
      <label className="premium-inline-label">Velocidad<select value={speed} onChange={e => setSpeed(Number(e.target.value))}>
        <option value={700}>Lenta</option><option value={300}>Normal</option><option value={100}>Rápida</option>
      </select></label>
    </div>
    <div className="premium-candle-chart" ref={host} aria-label="Gráfico de velas históricas reproducidas paso a paso" />
    {loading && <p className="premium-note">Cargando histórico…</p>}
    {error && <div className="premium-warn">{error}</div>}
    {!!bars.length && <>
      <div className="premium-row"><span>Vela visible</span><b>{index + 1} / {bars.length} · cierre {fmt(last?.close)}</b></div>
      <input type="range" aria-label="Avanzar a una vela histórica" min={0} max={bars.length - 1} value={Math.max(0, index)} onChange={e => { setPlaying(false); setIndex(Number(e.target.value)); }} />
      <div className="premium-actions">
        <button className="btn sm" disabled={index <= 0} onClick={() => { setPlaying(false); setIndex(i => Math.max(0, i - 1)); }}>◀ Anterior</button>
        <button className="btn sm primary" disabled={index >= bars.length - 1 && !playing} onClick={() => setPlaying(x => !x)}>{playing ? "Pausar" : "Reproducir"}</button>
        <button className="btn sm" disabled={index >= bars.length - 1} onClick={() => { setPlaying(false); setIndex(i => Math.min(bars.length - 1, i + 1)); }}>Siguiente ▶</button>
      </div>
    </>}
    <p className="premium-note">Replay M1/M5/M15/H1 para análisis visual. No ejecuta órdenes, no incluye ticks intrabar y no puede simular fielmente slippage ni backtest a nivel tick.</p>
  </div>;
}
