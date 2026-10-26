import React, { useEffect, useMemo, useRef, useState } from "react";
import { createChart, UTCTimestamp } from "lightweight-charts";
import { api } from "../api";
import { fmt, pct, useApp } from "../store";
import { Card, Empty, Num, PageHead, Seg, Stat, Tip } from "../ui";

type T = { ticket: number; source: string; strategy: string; side: number; lots: number; entry: number; exit: number; t_open: number; t_close: number; pnl: number; R: number | null; reason: string; status: string };

const DOW = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const dayOfSrv = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);     // fecha del servidor del bróker
const LS = "xauai.stats";
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function summary(list: T[]) {
  const n = list.length;
  const wins = list.filter((t) => t.pnl > 0), losses = list.filter((t) => t.pnl < 0);
  const gw = wins.reduce((a, t) => a + t.pnl, 0), gl = -losses.reduce((a, t) => a + t.pnl, 0);
  const net = gw - gl;
  const rs = list.map((t) => t.R).filter((r): r is number => r != null && Number.isFinite(r));
  let run = 0, maxRun = 0, eq = 0, peak = 0, mdd = 0;
  for (const t of [...list].sort((a, b) => a.t_close - b.t_close)) {
    run = t.pnl < 0 ? run + 1 : 0; maxRun = Math.max(maxRun, run);
    eq += t.pnl; peak = Math.max(peak, eq); mdd = Math.max(mdd, peak - eq);
  }
  return {
    n, win: n ? wins.length / n : 0, pf: gl > 0 ? gw / gl : null, net, expUsd: n ? net / n : 0, expR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    avgW: wins.length ? gw / wins.length : 0, avgL: losses.length ? -gl / losses.length : 0, best: n ? Math.max(...list.map((t) => t.pnl)) : 0, worst: n ? Math.min(...list.map((t) => t.pnl)) : 0,
    maxRun, mdd,
  };
}
function group(list: T[], key: (t: T) => string | number) {
  const m = new Map<string | number, T[]>();
  for (const t of list) { const k = key(t); m.set(k, [...(m.get(k) || []), t]); }
  return [...m.entries()].map(([k, v]) => ({ k, ...summary(v) }));
}

function Curve({ list }: { list: T[] }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current || !list.length) return;
    const gold = css("--gold") || "#d8a23c", line = css("--line") || "#232d3b", muted = css("--muted") || "#8d98aa";
    const c = createChart(el.current, { autoSize: true, layout: { background: { color: "transparent" }, textColor: muted, fontFamily: css("--font") }, grid: { vertLines: { visible: false }, horzLines: { color: line } }, timeScale: { borderColor: line, timeVisible: true }, rightPriceScale: { borderColor: line }, localization: { locale: "es-ES" }, handleScroll: false, handleScale: false });
    const a = c.addAreaSeries({ lineColor: gold, topColor: "rgba(216,162,60,.22)", bottomColor: "rgba(216,162,60,0)", lineWidth: 2 });
    const sorted = [...list].sort((x, y) => x.t_close - y.t_close);
    let eq = 0, lastT = Math.min(sorted[0].t_open, sorted[0].t_close) - 1;
    const pts = [{ time: lastT as UTCTimestamp, value: 0 }, ...sorted.map((t) => { eq += t.pnl; const tt = Math.max(t.t_close, lastT + 1); lastT = tt; return { time: tt as UTCTimestamp, value: Math.round(eq * 100) / 100 }; })];
    a.setData(pts);
    c.timeScale().fitContent();
    return () => c.remove();
  }, [list]);
  return <div ref={el} className="eq-chart" />;
}

function Calendar({ list }: { list: T[] }) {
  const byDay = useMemo(() => {
    const m = new Map<string, { pnl: number; n: number }>();
    for (const t of list) { const d = dayOfSrv(t.t_close); const c = m.get(d) || { pnl: 0, n: 0 }; c.pnl += t.pnl; c.n++; m.set(d, c); }
    return m;
  }, [list]);
  const lastDay = list.length ? dayOfSrv(Math.max(...list.map((t) => t.t_close))) : new Date().toISOString().slice(0, 10);
  const [ym, setYm] = useState(lastDay.slice(0, 7));
  useEffect(() => setYm(lastDay.slice(0, 7)), [lastDay.slice(0, 7)]);
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const inMonth = [...byDay.entries()].filter(([d]) => d.startsWith(ym));
  const maxAbs = Math.max(1, ...inMonth.map(([, v]) => Math.abs(v.pnl)));
  const monthPnl = inMonth.reduce((a, [, v]) => a + v.pnl, 0);
  const shift = (k: number) => { const d = new Date(Date.UTC(y, m - 1 + k, 1)); setYm(d.toISOString().slice(0, 7)); };
  const title = first.toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <Card title="Calendario" tip="Resultado por día de cierre, en hora del servidor del bróker." right={
      <div className="cal-nav">
        <button className="iconbtn" onClick={() => shift(-1)} aria-label="Mes anterior">‹</button>
        <span>{title[0].toUpperCase() + title.slice(1)} <b className={monthPnl >= 0 ? "buy" : "sell"}>{monthPnl >= 0 ? "+" : ""}{fmt(monthPnl, 0)}</b></span>
        <button className="iconbtn" onClick={() => shift(1)} aria-label="Mes siguiente">›</button>
      </div>}>
      <div className="cal">
        {DOW.map((d) => <div key={d} className="cal-h">{d}</div>)}
        {Array.from({ length: lead }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: days }).map((_, i) => {
          const d = `${ym}-${String(i + 1).padStart(2, "0")}`;
          const v = byDay.get(d);
          const a = v ? 0.16 + 0.6 * Math.min(1, Math.abs(v.pnl) / maxAbs) : 0;
          return (
            <div key={d} className={`cal-d ${v ? "has" : ""}`} style={v ? { background: v.pnl >= 0 ? `rgba(22,176,122,${a})` : `rgba(229,72,77,${a})` } : undefined} title={v ? `${d}: ${v.n} operaciones, ${fmt(v.pnl)}` : d}>
              <span className="cal-n">{i + 1}</span>
              {v ? <span className="cal-v">{v.pnl >= 0 ? "+" : ""}{Math.abs(v.pnl) >= 1000 ? `${(v.pnl / 1000).toFixed(1)}k` : v.pnl.toFixed(0)}</span> : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Rule({ label, value, tone, frac, bad, sub }: { label: React.ReactNode; value: React.ReactNode; tone?: string; frac?: number; bad?: boolean; sub?: React.ReactNode }) {
  return (
    <div className="rule">
      <span className="stat-l">{label}</span>
      <span className={`stat-v ${tone || ""}`}>{value}</span>
      {frac != null ? <span className="meter-bar"><i className={bad ? "bad" : tone === "gold" ? "goal" : ""} style={{ width: `${Math.max(0, Math.min(100, frac * 100))}%` }} /></span> : null}
      {sub ? <span className="stat-s">{sub}</span> : null}
    </div>
  );
}

export default function Stats() {
  const { s, toast } = useApp();
  const [all, setAll] = useState<T[]>([]);
  const saved = useMemo(() => { try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch { return {}; } }, []);
  const [src, setSrc] = useState<string>(saved.src || "todas");
  const [from, setFrom] = useState<string>(saved.from || "");
  const [by, setBy] = useState<"estrategia" | "hora" | "dia" | "lado" | "salida">("estrategia");
  useEffect(() => { try { localStorage.setItem(LS, JSON.stringify({ src, from })); } catch { /* sin almacenamiento */ } }, [src, from]);
  useEffect(() => {
    if (s.status !== "conectado") return;
    api("/api/trades").then((d) => setAll((d.trades || []).filter((t: any) => t.status === "cerrada" && t.t_close && t.pnl != null).map((t: any) => ({ ...t, pnl: Number(t.pnl), t_open: Number(t.t_open), t_close: Number(t.t_close), R: t.R == null ? null : Number(t.R) })))).catch(() => {});
  }, [s.status, s.tradeClosed, s.accountInfo?.id]);

  const fromT = from ? Date.parse(from + "T00:00:00Z") / 1000 : 0;
  const list = useMemo(() => all.filter((t) => t.t_close >= fromT && (src === "todas" || (src === "manual" ? t.source === "manual" : src === "estrategia" ? t.source === "estrategia" : t.source === "otro EA"))), [all, fromT, src]);
  const sm = summary(list);
  const rows = by === "estrategia" ? group(list, (t) => t.strategy || "–")
    : by === "hora" ? group(list, (t) => `${String(new Date(t.t_open * 1000).getUTCHours()).padStart(2, "0")}:00`).sort((a, b) => String(a.k).localeCompare(String(b.k)))
    : by === "dia" ? group(list, (t) => (new Date(t.t_open * 1000).getUTCDay() + 6) % 7).sort((a, b) => Number(a.k) - Number(b.k)).map((r) => ({ ...r, k: DOW[Number(r.k)] }))
    : by === "lado" ? group(list, (t) => (t.side > 0 ? "Compras" : "Ventas"))
    : group(list, (t) => t.reason || "–");

  // reglas de fondeo
  const r = s.risk || {}, a = s.account || {}, ex = s.settings?.extra || {}, fu = s.settings?.funding || {};
  const init = Number(r.init_bal || fu.initial_balance || 0);
  const eq = Number(a.equity ?? a.balance ?? 0);
  const target = Number(r.target_pct ?? fu.target_pct ?? 0);
  const dLim = Number(fu.daily_loss_pct ?? 3), mLim = Number(fu.max_loss_pct ?? 10);
  const [minDays, setMinDays] = useState<number>(Number(ex.min_days ?? 3));
  const [cons, setCons] = useState<number>(Number(ex.consistency_pct ?? 0));
  const [editRules, setEditRules] = useState(false);
  useEffect(() => { setMinDays(Number(ex.min_days ?? 3)); setCons(Number(ex.consistency_pct ?? 0)); }, [ex.min_days, ex.consistency_pct]);
  const phaseList = all.filter((t) => t.t_close >= fromT);
  const tradingDays = new Set(phaseList.map((t) => dayOfSrv(t.t_open))).size;
  const daily = new Map<string, number>();
  for (const t of phaseList) daily.set(dayOfSrv(t.t_close), (daily.get(dayOfSrv(t.t_close)) || 0) + t.pnl);
  const totalProfit = [...daily.values()].reduce((x, y) => x + y, 0);
  const bestDay = daily.size ? Math.max(...daily.values()) : 0;
  const consPct = totalProfit > 0 ? (bestDay / totalProfit) * 100 : null;
  const prog = init ? (Math.abs(eq / init - 1) < 5e-5 ? 0 : (eq / init - 1) * 100) : null;
  const saveRules = async () => {
    if (s.broker !== "cloud") { setEditRules(false); return toast("En el simulador estas reglas no se guardan", "info"); }
    try { await api("/api/settings", "PUT", { extra: { min_days: minDays, consistency_pct: cons } }); toast("Reglas guardadas", "ok"); setEditRules(false); } catch (e: any) { toast(e.message, "error"); }
  };

  return (
    <div className="stack">
      <PageHead title="Rendimiento y estadísticas" sub="Resultados, riesgo y consistencia según los registros de operaciones de la cuenta.">
        <Seg value={src} options={[["todas", "Todas"], ["estrategia", "Portafolio"], ["manual", "Manuales"], ["otro", "Otros EA"]]} onChange={setSrc} />
        <label className="date-f"><span>Desde</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />{from ? <button className="iconbtn" onClick={() => setFrom("")} aria-label="Quitar fecha">✕</button> : null}</label>
      </PageHead>

      <Card title="Reglas de fondeo" tip="Pon en «Desde» el día en que empezó la fase. FundingPips 2 Step: 3 días mínimos (0 con el complemento del 3 %); consistencia del 35 % solo en el cobro On Demand. Confírmalas en tu panel."
        right={<button className={`btn xs ${editRules ? "on" : ""}`} onClick={() => setEditRules(!editRules)}>Editar reglas</button>}>
        <div className="rules">
          <Rule label={`Objetivo ${target ? `${fmt(target, 1)} %` : ""}`} value={prog == null ? "–" : `${fmt(prog)} %`} tone="gold" frac={target && prog != null ? prog / target : 0} />
          <Rule label={`DD diario · límite ${fmt(dLim, 1)} %`} value={`${fmt(r.daily_dd_pct ?? 0)} %`} tone={(r.daily_dd_pct ?? 0) / dLim > 0.7 ? "sell" : ""} frac={(r.daily_dd_pct ?? 0) / dLim} bad={(r.daily_dd_pct ?? 0) / dLim > 0.7} />
          <Rule label={`DD máximo · límite ${fmt(mLim, 1)} %`} value={`${fmt(r.max_dd_pct ?? 0)} %`} frac={(r.max_dd_pct ?? 0) / mLim} bad={(r.max_dd_pct ?? 0) / mLim > 0.7} />
          <Rule label={`Días operados (mínimo ${minDays})`} value={<>{tradingDays}{tradingDays >= minDays ? " ✓" : ""}</>} tone={tradingDays >= minDays ? "buy" : ""} sub={tradingDays < minDays ? `faltan ${minDays - tradingDays}` : undefined} />
          <Rule label={cons > 0 ? `Consistencia ≤ ${cons} %` : "Consistencia"} value={consPct == null ? "–" : `${fmt(consPct, 1)} %${cons > 0 ? (consPct <= cons ? " ✓" : " ✗") : ""}`} tone={cons > 0 && consPct != null ? (consPct <= cons ? "buy" : "sell") : ""} sub={cons > 0 ? `mejor día ${fmt(bestDay, 0)}` : "desactivada"} />
        </div>
        {editRules ? (
          <div className="inline-form">
            <label>Días mínimos <Num value={minDays} step={1} min={0} max={30} onChange={(v) => setMinDays(Math.round(v))} /></label>
            <label>Consistencia % <Tip text="0 = sin regla de consistencia." size={13} /><Num value={cons} step={5} min={0} max={100} onChange={(v) => setCons(Math.round(v))} /></label>
            <button className="btn sm primary" onClick={saveRules}>Guardar</button>
          </div>
        ) : null}
      </Card>

      {!sm.n ? <section className="card"><Empty>Sin operaciones cerradas con este filtro.</Empty></section> : (
        <>
          <div className="kpi-row">
            <Stat label="Operaciones" value={sm.n} />
            <Stat label="Acierto" value={pct(sm.win)} />
            <Stat label="Factor beneficio" value={sm.pf == null ? "–" : sm.pf.toFixed(2)} />
            <Stat label="Resultado neto" value={`${sm.net >= 0 ? "+" : ""}${fmt(sm.net)}`} tone={sm.net >= 0 ? "buy" : "sell"} />
            <Stat label="Por operación" value={fmt(sm.expUsd)} sub={sm.expR != null ? `${sm.expR.toFixed(2)} R` : undefined} />
            <Stat label="Ganancia / pérdida media" value={<><span className="buy">{fmt(sm.avgW, 0)}</span> / <span className="sell">{fmt(sm.avgL, 0)}</span></>} />
            <Stat label="Racha de pérdidas" value={sm.maxRun} />
            <Stat label="DD máximo" value={fmt(sm.mdd)} sub={init ? `${fmt(sm.mdd / init * 100)} %` : undefined} tip="Mayor caída de la curva de operaciones cerradas." />
          </div>
          <div className="cols-2">
            <Card title="Curva de resultados"><Curve list={list} /></Card>
            <Calendar list={list} />
          </div>
          <Card title="Análisis por segmento" right={<select value={by} onChange={(e) => setBy(e.target.value as any)} aria-label="Agrupar por"><option value="estrategia">Por estrategia</option><option value="hora">Por hora</option><option value="dia">Por día</option><option value="lado">Compras / ventas</option><option value="salida">Por salida</option></select>}>
            <table className="t">
              <thead><tr><th>{by === "estrategia" ? "Estrategia" : by === "hora" ? "Hora (servidor)" : by === "dia" ? "Día" : by === "lado" ? "Lado" : "Salida"}</th><th className="n">Ops</th><th className="n">Acierto</th><th className="n">R medio</th><th className="n">Resultado</th></tr></thead>
              <tbody>{rows.map((x) => <tr key={String(x.k)}><td>{x.k}</td><td className="n">{x.n}</td><td className="n">{pct(x.win)}</td><td className={`n ${(x.expR ?? 0) >= 0 ? "buy" : "sell"}`}>{x.expR == null ? "–" : x.expR.toFixed(2)}</td><td className={`n ${x.net >= 0 ? "buy" : "sell"}`}>{x.net >= 0 ? "+" : ""}{fmt(x.net)}</td></tr>)}</tbody>
            </table>
          </Card>
        </>
      )}
      {!sm.n ? <Calendar list={list} /> : null}
    </div>
  );
}
