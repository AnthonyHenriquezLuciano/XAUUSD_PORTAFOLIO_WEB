import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { fmt, useApp } from "../store";
import { ticketSafety } from "../premium/risk";
import CandleReplay from "../premium/CandleReplay";
import { useUI } from "../uiState";

type Historic = { ticket: number; t_open: number; t_close: number; status: string; side: number; strategy?: string; source?: string; entry: number; exit?: number; pnl?: number; R?: number | null; reason?: string };
type Virtual = { id: number; side: number; entry: number; sl: number; tp: number; lots: number; opened: number; closed?: number; exit?: number; pnl?: number };
const safe = (x: number, lo: number, hi: number) => Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : lo;
const money = (x: number) => (x >= 0 ? "+" : "−") + "$" + fmt(Math.abs(x));
const round = (n: number) => Math.round(n * 100) / 100;
const date = (n: number) => n ? new Date(n * 1000).toLocaleString("es-DO") : "—";
const saved = (key: string): Virtual[] => {
  try { const v = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(v) ? v.filter(x => Number.isFinite(x.id) && Number.isFinite(x.entry)) : []; }
  catch { return []; }
};

type Mc = { p10: number; median: number; p90: number; dd90: number; passed: number };
function bootstrap(returns: number[], riskPct: number, iterations = 1000, seed = 42719): Mc {
  let z = seed | 0;
  const random = () => { z ^= z << 13; z ^= z >>> 17; z ^= z << 5; return (z >>> 0) / 4294967296; };
  const final: number[] = [], dd: number[] = [];
  let pass = 0;
  for (let k = 0; k < iterations; k++) {
    let equity = 100, peak = 100, maxDD = 0, target = false;
    for (let i = 0; i < returns.length;) {
      const begin = Math.floor(random() * returns.length);
      for (let j = 0; j < 3 && i < returns.length; j++, i++) {
        const r = returns[(begin + j) % returns.length];
        equity = Math.max(0, equity * (1 + r * riskPct / 100));
        peak = Math.max(peak, equity);
        maxDD = Math.max(maxDD, peak ? (peak - equity) / peak * 100 : 100);
        if (equity >= 108) target = true;
      }
    }
    final.push(equity - 100); dd.push(maxDD);
    if (target) pass++;
  }
  final.sort((a, b) => a - b); dd.sort((a, b) => a - b);
  const q = (a: number[], p: number) => a[Math.floor(p * (a.length - 1))];
  return { p10: q(final, .1), median: q(final, .5), p90: q(final, .9), dd90: q(dd, .9), passed: pass / iterations * 100 };
}

export default function PremiumLab() {
  const { s, toast } = useApp();
  const ui = useUI();
  const [tab, setTab] = useState<"decisions" | "portfolio" | "shadow" | "replay">("decisions");
  const [trades, setTrades] = useState<Historic[]>([]);
  const [fetching, setFetching] = useState(false);
  const [err, setErr] = useState("");
  const [side, setSide] = useState(1);
  const [slATR, setSlATR] = useState(.25);
  const [tpR, setTpR] = useState(1);
  const [riskPct, setRiskPct] = useState(.5);
  const [pred, setPred] = useState<any>(null);
  const [predBusy, setPredBusy] = useState(false);
  const [seed, setSeed] = useState(42719);
  const [replayIndex, setReplayIndex] = useState(0);
  const [virtual, setVirtual] = useState<Virtual[]>([]);
  const key = "xauai.shadow." + (s.me || "guest") + "." + (s.accountInfo?.id || "sim");
  const mark = side > 0 ? s.tick?.ask : s.tick?.bid;
  const atr = Number(s.signals?.atr || 0);
  const entry = mark && mark > 0 ? mark : 0;
  const distance = slATR * atr;
  const sl = entry ? round(entry - side * distance) : 0;
  const tp = entry ? round(entry + side * distance * tpR) : 0;
  const balance = Number(s.account?.balance || 0);
  const sizePerLot = distance * Number(s.ea?.contract || s.settings?.contract_size || 100);
  const lots = sizePerLot > 0 ? Math.floor((balance * riskPct / 100 / sizePerLot) * 100) / 100 : 0;
  const preflight = ticketSafety(s, entry, sl, side, lots);
  const live = s.tick;
  const completed = trades.filter(t => t.status === "cerrada" && t.R != null && Number.isFinite(Number(t.R)));
  const rs = useMemo(() => trades.filter(t => t.status === "cerrada" && t.R != null).map(t => Number(t.R)).filter(Number.isFinite).slice(-500), [trades]);
  const mc = useMemo(() => rs.length >= 10 ? bootstrap(rs, safe(riskPct, .05, 3), 1000, seed) : null, [rs, riskPct, seed]);
  const ordered = useMemo(() => [...trades].filter(t => t.status === "cerrada").sort((a, b) => a.t_close - b.t_close), [trades]);
  const replay = ordered[Math.min(Math.max(0, replayIndex), ordered.length - 1)];

  useEffect(() => { setVirtual(saved(key)); }, [key]);
  const saveVirtual = (next: Virtual[]) => {
    setVirtual(next);
    try { localStorage.setItem(key, JSON.stringify(next.slice(-100))); } catch { toast("No se pudo conservar Shadow Trading en este navegador", "warn"); }
  };
  useEffect(() => {
    if (s.status !== "conectado") { setTrades([]); return; }
    let alive = true;
    setFetching(true);
    api("/api/trades").then((data: any) => {
      if (alive) { setTrades(Array.isArray(data.trades) ? data.trades : []); setErr(""); }
    }).catch((e: Error) => { if (alive) setErr(e.message); })
      .finally(() => { if (alive) setFetching(false); });
    return () => { alive = false; };
  }, [s.accountInfo?.id, s.status, s.tradeClosed]);

  const assess = async () => {
    if (!entry || !(sl > 0)) return;
    setPredBusy(true);
    setPred(null);
    try {
      const data = await api("/api/predict", "POST", { side, entry, sl, tp, risk_pct: riskPct });
      setPred(data);
    } catch (e: any) { toast(e.message, "error"); }
    finally { setPredBusy(false); }
  };
  const makeVirtual = (sdir: number) => {
    if (!live || !(atr > 0)) return toast("Sin precios o ATR para una entrada virtual", "warn");
    if (virtual.some(v => !v.closed)) return toast("Cierra la prueba anterior antes de abrir otra", "warn");
    const p = sdir > 0 ? live.ask : live.bid, d = atr * slATR;
    const v: Virtual = { id: Date.now(), side: sdir, entry: round(p), sl: round(p - sdir * d), tp: round(p + sdir * d * tpR), lots: Math.max(.01, lots), opened: Math.floor(Date.now() / 1000) };
    saveVirtual([...virtual, v].slice(-100));
  };
  const closeVirtual = (v: Virtual) => {
    if (!live) return;
    const exit = v.side > 0 ? live.bid : live.ask;
    const contract = Number(s.ea?.contract || s.settings?.contract_size || 100);
    saveVirtual(virtual.map(x => x.id === v.id ? { ...x, exit, closed: Math.floor(Date.now() / 1000), pnl: round((exit - x.entry) * x.side * contract * x.lots) } : x));
  };
  const pnlVirtual = (v: Virtual) => {
    if (v.closed) return Number(v.pnl || 0);
    if (!live) return null;
    return round(((v.side > 0 ? live.bid : live.ask) - v.entry) * v.side * (s.ea?.contract || s.settings?.contract_size || 100) * v.lots);
  };

  return <div className="premium-center">
    <div className="premium-hero">
      <div><div className="premium-eyebrow">INVESTIGACIÓN / SIMULACIÓN</div><h1>Laboratorio de estrategias</h1>
        <p>Decisiones, escenarios, ejecución virtual y revisión de operaciones.</p></div>
      <button className="btn sm" onClick={() => ui.setTab("estrategias")}>Backtest de estrategias</button>
    </div>
    <nav className="premium-lab-tabs" aria-label="Laboratorio">
      {([["decisions", "Simulador de decisiones"], ["portfolio", "Monte Carlo"], ["shadow", "Shadow Trading"], ["replay", "Replay de operaciones"]] as const).map(([id, title]) =>
        <button key={id} className={tab === id ? "on" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>{title}</button>)}
    </nav>
    {tab === "decisions" && <div className="premium-lab-card">
      <h2>Evaluar una operación sin ejecutarla</h2>
      <p className="premium-note">Usa el precio actual, ATR y configuración de la cuenta para estimar el lotaje y solicitar probabilidades al mismo modelo del ticket.</p>
      <div className="premium-lab-inputs">
        <label>Dirección<select value={side} onChange={e => { setSide(Number(e.target.value)); setPred(null); }}><option value={1}>Compra</option><option value={-1}>Venta</option></select></label>
        <label>SL (ATR)<input type="number" min=".05" max="5" step=".05" value={slATR} onChange={e => { setSlATR(safe(Number(e.target.value), .05, 5)); setPred(null); }} /></label>
        <label>TP (R)<input type="number" min=".1" max="8" step=".1" value={tpR} onChange={e => { setTpR(safe(Number(e.target.value), .1, 8)); setPred(null); }} /></label>
        <label>Riesgo (%)<input type="number" min=".05" max="3" step=".05" value={riskPct} onChange={e => { setRiskPct(safe(Number(e.target.value), .05, 3)); setPred(null); }} /></label>
      </div>
      <div className="premium-overview">
        <div><span>Entrada</span><b>{entry ? fmt(entry) : "—"}</b></div>
        <div><span>Stop / TP</span><b>{sl ? fmt(sl) + " / " + fmt(tp) : "—"}</b></div>
        <div><span>Lote teórico</span><b>{lots > 0 ? fmt(lots) : "Por confirmar"}</b></div>
        <div><span>Riesgo combinado al stop</span><b className="sell">{lots > 0 ? "$" + fmt(preflight.combinedRisk) : "—"}</b></div>
      </div>
      {preflight.notes.filter(n => !n.startsWith("Spread actual")).map((n, i) => <div className="premium-warn" key={i}>{n}</div>)}
      <button className="btn primary" disabled={!entry || !(atr > 0) || predBusy} onClick={() => void assess()}>{predBusy ? "Analizando…" : "Analizar escenario con IA"}</button>
      {pred?.pred && <div className="premium-research-result">
        <b>Modelo actual</b>
        <div className="premium-row"><span>Probabilidad de terminar en ganancia</span><strong>{fmt(pred.pred.p_ganancia * 100)}%</strong></div>
        <div className="premium-row"><span>Expectativa estimada</span><strong>{fmt(pred.pred.exp_R)}R</strong></div>
        <div className="premium-row"><span>Lote calculado por motor</span><strong>{pred.lots ?? "—"}</strong></div>
        <p className="premium-note">Las probabilidades tienen poder discriminativo limitado fuera de muestra. No constituyen una recomendación ni autorizan automáticamente la entrada.</p>
      </div>}
    </div>}
    {tab === "portfolio" && <div className="premium-lab-card">
      <h2>Simulación Monte Carlo</h2>
      <p className="premium-note">Remuestreo de bloques de 3 operaciones usando los R realizados de tu diario. 1,000 trayectorias, misma cantidad de operaciones, riesgo fijo sobre equity. No modela cambios de mercado, fechas de fondeo, slippage ni límite diario.</p>
      {fetching && <div className="premium-note">Cargando historial…</div>}
      {err && <div className="premium-warn">{err}</div>}
      <div className="premium-row"><span>Operaciones con R disponible</span><b>{rs.length}</b></div>
      <div className="premium-row"><span>Riesgo por operación (simulado)</span><b>{fmt(riskPct)}%</b></div>
      {mc ? <>
        <div className="premium-kpis">
          <div><span>Retorno P10</span><strong>{fmt(mc.p10)}%</strong></div>
          <div><span>Retorno mediano</span><strong>{fmt(mc.median)}%</strong></div>
          <div><span>Retorno P90</span><strong>{fmt(mc.p90)}%</strong></div>
        </div>
        <div className="premium-row"><span>DD máximo P90 de pico a valle</span><b>{fmt(mc.dd90)}%</b></div>
        <div className="premium-row"><span>Trayectorias que tocaron +8% (sin reglas de fondeo)</span><b>{fmt(mc.passed)}%</b></div>
        <button className="btn sm" onClick={() => setSeed(s => s + 197)}>Generar otra muestra</button>
      </> : <div className="premium-warn">Se necesitan al menos 10 operaciones cerradas con R para una exploración básica. Una muestra mayor aporta más estabilidad.</div>}
      <p className="premium-note">Esto NO es una tasa de aprobación de FundingPips: no contempla objetivos por fase, guardas intradía ni días mínimos. La prueba rigurosa requiere simulación de secuencias temporales completas.</p>
    </div>}
    {tab === "shadow" && <div className="premium-lab-card">
      <h2>Operaciones simuladas</h2>
      <p className="premium-note">Registra operaciones de práctica sin enviarlas a MT5. El PnL abierto se actualiza al visualizar la web; NO hay vigilancia, cierre automático por SL/TP ni sincronización entre dispositivos.</p>
      <div className="premium-actions"><button className="btn sm buy" disabled={!live || !atr} onClick={() => makeVirtual(1)}>Abrir compra virtual</button>
        <button className="btn sm sell" disabled={!live || !atr} onClick={() => makeVirtual(-1)}>Abrir venta virtual</button></div>
      {[...virtual].reverse().map(v => {
        const pl = pnlVirtual(v);
        const px = live ? (v.side > 0 ? live.bid : live.ask) : null;
        return <div className="premium-shadow" key={v.id}>
          <div><strong>{v.side > 0 ? "COMPRA" : "VENTA"} · {fmt(v.lots)} lot</strong><small>{date(v.opened)}</small></div>
          <div><span>Entrada {fmt(v.entry)} · SL {fmt(v.sl)} · TP {fmt(v.tp)}</span><span>Precio {v.closed ? fmt(v.exit) : px == null ? "—" : fmt(px)}</span></div>
          <div><b className={pl != null && pl >= 0 ? "buy" : "sell"}>{pl == null ? "—" : money(pl)}</b>{!v.closed && <button className="btn sm" onClick={() => closeVirtual(v)} disabled={!live}>Cerrar virtual</button>}</div>
        </div>;
      })}
      {!virtual.length && <p className="premium-note">Todavía no hay operaciones virtuales.</p>}
    </div>}
    {tab === "replay" && <div className="premium-lab-card">
      <h2>Reproducción histórica</h2>
      <p className="premium-note">Reproduce velas reales del bróker progresivamente y revisa el historial de ejecuciones. No incluye ticks intrabar ni garantiza que las fechas del servidor y el registro de operaciones coincidan sin verificar la zona horaria.</p>
      <CandleReplay />
      {err && <div className="premium-warn">{err}</div>}
      {ordered.length ? <>
        <input aria-label="Operación histórica" type="range" min={0} max={ordered.length - 1} value={Math.min(replayIndex, ordered.length - 1)} onChange={e => setReplayIndex(Number(e.target.value))} />
        <div className="premium-row"><span>Operación</span><strong>{Math.min(replayIndex + 1, ordered.length)} de {ordered.length}</strong></div>
        <div className="premium-overview">
          <div><span>Estrategia</span><b>{replay?.strategy || replay?.source || "Manual"}</b></div>
          <div><span>Dirección</span><b>{replay?.side > 0 ? "Compra" : "Venta"}</b></div>
          <div><span>Resultado</span><b>{replay?.pnl == null ? "—" : money(replay.pnl)}</b></div>
          <div><span>R realizado</span><b>{replay?.R == null ? "—" : fmt(replay.R) + "R"}</b></div>
        </div>
        <div className="premium-row"><span>Entrada</span><b>{fmt(replay?.entry)} · {date(replay?.t_open)}</b></div>
        <div className="premium-row"><span>Cierre</span><b>{fmt(replay?.exit)} · {date(replay?.t_close)}</b></div>
        <div className="premium-row"><span>Motivo</span><b>{replay?.reason || "—"}</b></div>
        <div className="premium-actions"><button className="btn sm" disabled={replayIndex === 0} onClick={() => setReplayIndex(i => Math.max(0, i - 1))}>Anterior</button>
          <button className="btn sm" disabled={replayIndex >= ordered.length - 1} onClick={() => setReplayIndex(i => Math.min(ordered.length - 1, i + 1))}>Siguiente</button></div>
      </> : <p className="premium-note">No hay operaciones históricas cerradas para reproducir.</p>}
    </div>}
  </div>;
}
