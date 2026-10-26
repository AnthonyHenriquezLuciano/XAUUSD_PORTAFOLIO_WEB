import React, { useEffect, useMemo, useRef, useState } from "react";
import { createChart, UTCTimestamp } from "lightweight-charts";
import { api } from "../api";
import { fmt, pct, useApp } from "../store";
import { Card, Num, Seg } from "../ui";

type T = { ticket: number; source: string; strategy: string; side: number; lots: number; entry: number; exit: number; t_open: number; t_close: number; pnl: number; R: number | null; reason: string; status: string };

const DOW = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const dayOfSrv = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);     // fecha del servidor del bróker
const LS = "xauai.stats";

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
    maxRun, mdd, days: new Set(list.map((t) => dayOfSrv(t.t_open))).size,
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
    const c = createChart(el.current, { autoSize: true, layout: { background: { color: "transparent" }, textColor: "#8a93a6" }, grid: { vertLines: { visible: false }, horzLines: { color: "#1e2534" } }, timeScale: { borderColor: "#262e3f", timeVisible: true }, rightPriceScale: { borderColor: "#262e3f" }, localization: { locale: "es-ES" } });
    const a = c.addAreaSeries({ lineColor: "#e0b04f", topColor: "rgba(224,176,79,.25)", bottomColor: "rgba(224,176,79,0)", lineWidth: 2 });
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
  const maxAbs = Math.max(1, ...[...byDay.entries()].filter(([d]) => d.startsWith(ym)).map(([, v]) => Math.abs(v.pnl)));
  const monthPnl = [...byDay.entries()].filter(([d]) => d.startsWith(ym)).reduce((a, [, v]) => a + v.pnl, 0);
  const shift = (k: number) => { const d = new Date(Date.UTC(y, m - 1 + k, 1)); setYm(d.toISOString().slice(0, 7)); };
  return (
    <div>
      <div className="row between" style={{ marginBottom: 6 }}>
        <button className="btn sm ghost" onClick={() => shift(-1)} aria-label="Mes anterior">‹</button>
        <b>{(() => { const t = first.toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" }); return t[0].toUpperCase() + t.slice(1); })()} · <span className={monthPnl >= 0 ? "buy" : "sell"}>{monthPnl >= 0 ? "+" : ""}{fmt(monthPnl)}</span></b>
        <button className="btn sm ghost" onClick={() => shift(1)} aria-label="Mes siguiente">›</button>
      </div>
      <div className="cal">
        {DOW.map((d) => <div key={d} className="cal-h">{d}</div>)}
        {Array.from({ length: lead }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: days }).map((_, i) => {
          const d = `${ym}-${String(i + 1).padStart(2, "0")}`;
          const v = byDay.get(d);
          const a = v ? 0.15 + 0.6 * Math.min(1, Math.abs(v.pnl) / maxAbs) : 0;
          return (
            <div key={d} className="cal-d" style={v ? { background: v.pnl >= 0 ? `rgba(34,176,125,${a})` : `rgba(229,83,75,${a})` } : undefined} title={v ? `${d}: ${v.n} operaciones, ${fmt(v.pnl)}` : d}>
              <span className="cal-n">{i + 1}</span>
              {v ? <span className="cal-v mono">{v.pnl >= 0 ? "+" : ""}{Math.abs(v.pnl) >= 1000 ? `${(v.pnl / 1000).toFixed(1)}k` : v.pnl.toFixed(0)}</span> : null}
            </div>
          );
        })}
      </div>
      <div className="hint" style={{ marginTop: 4 }}>Por día de cierre (hora del servidor del bróker).</div>
    </div>
  );
}

function Table({ rows, label }: { rows: any[]; label: string }) {
  return (
    <table className="t">
      <thead><tr><th>{label}</th><th className="n">Ops</th><th className="n">Acierto</th><th className="n">R medio</th><th className="n">Resultado</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={String(r.k)}><td>{r.k}</td><td className="n">{r.n}</td><td className="n">{pct(r.win)}</td><td className={`n ${(r.expR ?? 0) >= 0 ? "buy" : "sell"}`}>{r.expR == null ? "–" : r.expR.toFixed(2)}</td><td className={`n ${r.net >= 0 ? "buy" : "sell"}`}>{r.net >= 0 ? "+" : ""}{fmt(r.net)}</td></tr>)}</tbody>
    </table>
  );
}

export default function Stats() {
  const { s, toast } = useApp();
  const [all, setAll] = useState<T[]>([]);
  const saved = (() => { try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch { return {}; } })();
  const [src, setSrc] = useState<string>(saved.src || "todas");
  const [from, setFrom] = useState<string>(saved.from || "");
  const [by, setBy] = useState<"estrategia" | "hora" | "dia" | "lado" | "salida">("estrategia");
  useEffect(() => { try { localStorage.setItem(LS, JSON.stringify({ src, from })); } catch { /* sin almacenamiento */ } }, [src, from]);
  useEffect(() => {
    if (s.status !== "conectado") return;
    api("/api/trades").then((d) => setAll((d.trades || []).filter((t: any) => t.status === "cerrada" && t.t_close && t.pnl != null).map((t: any) => ({ ...t, pnl: Number(t.pnl), t_open: Number(t.t_open), t_close: Number(t.t_close), R: t.R == null ? null : Number(t.R) })))).catch(() => {});
  }, [s.status, s.tradeClosed, s.accountInfo?.id]);

  const fromT = from ? Date.parse(from + "T00:00:00Z") / 1000 : 0;
  const list = all.filter((t) => t.t_close >= fromT && (src === "todas" || (src === "manual" ? t.source === "manual" : src === "estrategia" ? t.source === "estrategia" : t.source === "otro EA")));
  const sm = summary(list);
  const rows = by === "estrategia" ? group(list, (t) => t.strategy || "–")
    : by === "hora" ? group(list, (t) => `${String(new Date(t.t_open * 1000).getUTCHours()).padStart(2, "0")}:00`).sort((a, b) => String(a.k).localeCompare(String(b.k)))
    : by === "dia" ? group(list, (t) => (new Date(t.t_open * 1000).getUTCDay() + 6) % 7).sort((a, b) => Number(a.k) - Number(b.k)).map((r) => ({ ...r, k: DOW[Number(r.k)] }))
    : by === "lado" ? group(list, (t) => (t.side > 0 ? "Compras" : "Ventas"))
    : group(list, (t) => t.reason || "–");

  // reglas de fondeo
  const r = s.risk || {}, a = s.account || {}, ex = s.settings?.extra || {};
  const init = Number(r.init_bal || s.settings?.funding?.initial_balance || 0);
  const eq = Number(a.equity ?? a.balance ?? 0);
  const target = Number(r.target_pct ?? s.settings?.funding?.target_pct ?? 0);
  const [minDays, setMinDays] = useState<number>(Number(ex.min_days ?? 3));
  const [cons, setCons] = useState<number>(Number(ex.consistency_pct ?? 0));
  useEffect(() => { setMinDays(Number(ex.min_days ?? 3)); setCons(Number(ex.consistency_pct ?? 0)); }, [ex.min_days, ex.consistency_pct]);
  const phaseList = all.filter((t) => t.t_close >= fromT);
  const tradingDays = new Set(phaseList.map((t) => dayOfSrv(t.t_open))).size;
  const daily = new Map<string, number>();
  for (const t of phaseList) daily.set(dayOfSrv(t.t_close), (daily.get(dayOfSrv(t.t_close)) || 0) + t.pnl);
  const totalProfit = [...daily.values()].reduce((x, y) => x + y, 0);
  const bestDay = daily.size ? Math.max(...daily.values()) : 0;
  const consPct = totalProfit > 0 ? (bestDay / totalProfit) * 100 : null;
  const saveRules = async () => {
    if (s.broker !== "cloud") return toast("En el simulador estas reglas no se guardan", "info");
    try { await api("/api/settings", "PUT", { extra: { min_days: minDays, consistency_pct: cons } }); toast("Reglas guardadas", "ok"); } catch (e: any) { toast(e.message, "error"); }
  };

  return (
    <div className="col">
      <div className="row wrap" style={{ gap: 8 }}>
        <Seg value={src} options={[["todas", "Todas"], ["estrategia", "Portafolio"], ["manual", "Manuales"], ["otro", "Otros EA"]]} onChange={setSrc} />
        <label className="row small" style={{ gap: 6 }}>Desde <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        {from ? <button className="btn sm ghost" onClick={() => setFrom("")}>Todo</button> : null}
      </div>

      <Card title="Reglas de fondeo" right={<span className="small muted">{from ? `desde ${from}` : "todo el historial"}</span>}>
        <div className="rules">
          <div className="rule"><div className="muted small">Objetivo {target ? `${fmt(target, 1)} %` : "(sin objetivo)"}</div>
            <div className="mono">{init ? `${fmt(Math.abs(eq / init - 1) < 5e-5 ? 0 : (eq / init - 1) * 100)} %` : "–"}</div>
            <div className="bar"><i style={{ width: `${target && init ? Math.max(0, Math.min(100, ((eq / init - 1) * 100) / target * 100)) : 0}%`, background: "var(--gold)" }} /></div></div>
          <div className="rule"><div className="muted small">DD diario (límite {fmt(s.settings?.funding?.daily_loss_pct ?? 3, 1)} %)</div>
            <div className={`mono ${(r.daily_dd_pct ?? 0) > 2 ? "sell" : ""}`}>{fmt(r.daily_dd_pct ?? 0)} %</div>
            <div className="bar"><i className={(r.daily_dd_pct ?? 0) / (s.settings?.funding?.daily_loss_pct ?? 3) > 0.7 ? "bad" : ""} style={{ width: `${Math.min(100, (r.daily_dd_pct ?? 0) / (s.settings?.funding?.daily_loss_pct ?? 3) * 100)}%` }} /></div></div>
          <div className="rule"><div className="muted small">DD máximo (límite {fmt(s.settings?.funding?.max_loss_pct ?? 10, 1)} %)</div>
            <div className="mono">{fmt(r.max_dd_pct ?? 0)} %</div>
            <div className="bar"><i className={(r.max_dd_pct ?? 0) / (s.settings?.funding?.max_loss_pct ?? 10) > 0.7 ? "bad" : ""} style={{ width: `${Math.min(100, (r.max_dd_pct ?? 0) / (s.settings?.funding?.max_loss_pct ?? 10) * 100)}%` }} /></div></div>
          <div className="rule"><div className="muted small">Días operados (mínimo {minDays})</div>
            <div className={`mono ${tradingDays >= minDays ? "buy" : ""}`}>{tradingDays} {tradingDays >= minDays ? "✓" : `· faltan ${minDays - tradingDays}`}</div></div>
          <div className="rule"><div className="muted small">Consistencia {cons > 0 ? `(mejor día ≤ ${cons} %)` : "(desactivada)"}</div>
            <div className={`mono ${cons > 0 && consPct != null ? (consPct <= cons ? "buy" : "sell") : ""}`}>{consPct == null ? "–" : `${fmt(consPct, 1)} %`}{cons > 0 && consPct != null ? (consPct <= cons ? " ✓" : " ✗") : ""}</div>
            <div className="hint">Mejor día {fmt(bestDay)} de {fmt(totalProfit)} de beneficio.</div></div>
        </div>
        <div className="row wrap" style={{ gap: 10, marginTop: 8 }}>
          <label className="row small" style={{ gap: 6 }}>Días mínimos <div style={{ width: 70 }}><Num value={minDays} step={1} min={0} max={30} onChange={(v) => setMinDays(Math.round(v))} /></div></label>
          <label className="row small" style={{ gap: 6 }}>Consistencia % (0 = no) <div style={{ width: 70 }}><Num value={cons} step={5} min={0} max={100} onChange={(v) => setCons(Math.round(v))} /></div></label>
          <button className="btn sm" onClick={saveRules}>Guardar</button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>Pon en «Desde» el día en que empezó la fase. FundingPips 2 Step: 3 días mínimos por fase (0 con el complemento de pérdida diaria del 3 %); consistencia del 35 % solo en el cobro On Demand. Las reglas cambian: confírmalas en tu panel.</div>
      </Card>

      <Card title="Resumen">
        {!sm.n ? <div className="hint">Sin operaciones cerradas con este filtro.</div> : (
          <div className="grid3 small mono">
            <div><div className="muted">Operaciones</div>{sm.n}</div>
            <div><div className="muted">Acierto</div>{pct(sm.win)}</div>
            <div><div className="muted">Factor beneficio</div>{sm.pf == null ? "–" : sm.pf.toFixed(2)}</div>
            <div><div className="muted">Resultado neto</div><b className={sm.net >= 0 ? "buy" : "sell"}>{sm.net >= 0 ? "+" : ""}{fmt(sm.net)}</b></div>
            <div><div className="muted">Por operación</div>{fmt(sm.expUsd)}{sm.expR != null ? ` · ${sm.expR.toFixed(2)} R` : ""}</div>
            <div><div className="muted">Media gan. / pérd.</div><span className="buy">{fmt(sm.avgW)}</span> / <span className="sell">{fmt(sm.avgL)}</span></div>
            <div><div className="muted">Mejor / peor</div><span className="buy">{fmt(sm.best)}</span> / <span className="sell">{fmt(sm.worst)}</span></div>
            <div><div className="muted">Racha máx. pérdidas</div>{sm.maxRun}</div>
            <div><div className="muted">DD máximo (cerradas)</div>{fmt(sm.mdd)}{init ? ` · ${fmt(sm.mdd / init * 100)} %` : ""}</div>
          </div>
        )}
      </Card>

      {sm.n ? <Card title="Curva de resultados"><Curve list={list} /></Card> : null}
      <Card title="Calendario"><Calendar list={list} /></Card>
      {sm.n ? (
        <Card title="Desglose" right={<select value={by} onChange={(e) => setBy(e.target.value as any)}><option value="estrategia">Por estrategia</option><option value="hora">Por hora de entrada</option><option value="dia">Por día de la semana</option><option value="lado">Compras / ventas</option><option value="salida">Por motivo de salida</option></select>}>
          <Table rows={rows} label={by === "estrategia" ? "Estrategia" : by === "hora" ? "Hora (servidor)" : by === "dia" ? "Día" : by === "lado" ? "Lado" : "Salida"} />
        </Card>
      ) : null}
    </div>
  );
}
