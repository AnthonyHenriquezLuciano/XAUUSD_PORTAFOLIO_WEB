import React, { useEffect, useRef, useState } from "react";
import { createChart, UTCTimestamp } from "lightweight-charts";
import { api } from "../api";
import { fmt, pct, useApp } from "../store";
import { Card, Empty, Field, PageHead, Stat, Toggle } from "../ui";
import { DEFAULT_STRATS, StratDef } from "../ai/backtest";

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export default function Strategies() {
  const { s, toast, refresh } = useApp();
  const st = s.settings;
  const cloud = s.broker === "cloud";
  const canEdit = !cloud || s.role === "owner" || s.role === "trader";
  const [open, setOpen] = useState<string | null>(null);
  const save = async (strategies: any) => {
    try { await api("/api/settings", "PUT", { strategies }); if (!cloud) await refresh(); toast(cloud ? (s.ea?.online ? "Enviado al EA" : "Guardado: se aplicará al conectar el EA") : "Portafolio actualizado", "ok"); } catch (e: any) { toast(e.message, "error"); }
  };
  if (!st) return null;
  const scen = new Map((s.signals?.strategies || []).map((x: any) => [x.name, x.scenario]));
  return (
    <div className="stack">
      <PageHead title="Estrategias" />
      <div className="cols-side">
        <Card title="Portafolio" tip="Las ejecuta el EA aunque cierres la web. Riesgo, límite de operaciones y reglas de fondeo están en Ajustes.">
          <div className="strat-list">
            {s.strategies.map((x) => {
              const cfg = st.strategies[x.name] || { enabled: true, params: {} };
              const sc: any = scen.get(x.name);
              const on = cfg.enabled !== false;
              return (
                <div key={x.name} className={`strat ${on ? "" : "off"}`}>
                  <div className="strat-h">
                    <Toggle on={on} label={`${x.name} activa`} onChange={(v) => canEdit && save({ ...st.strategies, [x.name]: { ...cfg, enabled: v } })} />
                    <button className="strat-n" onClick={() => setOpen(open === x.name ? null : x.name)} aria-expanded={open === x.name}>
                      <b>{x.name}</b>{st.pending?.includes(x.name) ? <span className="pending">pendiente</span> : null}
                      <span className="muted">{x.state}</span>
                    </button>
                    {sc ? <span className={`strat-r ${sc.expR >= 0 ? "buy" : "sell"}`} title="R medio histórico en el escenario actual">{sc.expR >= 0 ? "+" : ""}{sc.expR.toFixed(2)} R</span> : null}
                  </div>
                  {open === x.name ? (
                    <div className="strat-d">
                      <p>{x.description}</p>
                      {cloud ? (
                        <div className="params">{Object.entries(x.params).map(([k, v]) => <span key={k}><span className="dim">{k}</span> {String(v)}</span>)}</div>
                      ) : <ParamEditor params={x.params} onSave={(p) => save({ ...st.strategies, [x.name]: { ...cfg, params: p } })} />}
                      {cloud ? <div className="hint">Los parámetros son entradas del EA en MT5. Prueba otros valores en el backtest.</div> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Card>
        <Backtest />
      </div>
    </div>
  );
}

function ParamEditor({ params, onSave, label = "Guardar parámetros" }: { params: Record<string, any>; onSave: (p: any) => void; label?: string }) {
  const [p, setP] = useState<Record<string, any>>(params);
  useEffect(() => setP(params), [JSON.stringify(params)]);
  return (
    <div className="param-ed">
      <div className="grid3">
        {Object.entries(p).map(([k, v]) => (
          <Field key={k} label={k}>
            <input value={String(v)} onChange={(e) => setP({ ...p, [k]: typeof params[k] === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value })} />
          </Field>
        ))}
      </div>
      <button className="btn sm" onClick={() => onSave(p)}>{label}</button>
    </div>
  );
}

function EquityChart({ data }: { data: [number, number][] }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current || !data?.length) return;
    const gold = css("--gold") || "#d8a23c", line = css("--line") || "#232d3b";
    const c = createChart(el.current, { autoSize: true, layout: { background: { color: "transparent" }, textColor: css("--muted") || "#8d98aa", fontFamily: css("--font") }, grid: { vertLines: { visible: false }, horzLines: { color: line } }, timeScale: { borderColor: line }, rightPriceScale: { borderColor: line }, localization: { locale: "es-ES" }, handleScroll: false, handleScale: false });
    const a = c.addAreaSeries({ lineColor: gold, topColor: "rgba(216,162,60,.22)", bottomColor: "rgba(216,162,60,0)", lineWidth: 2 });
    const seen = new Set<number>();
    a.setData(data.filter(([t]) => !seen.has(t) && seen.add(t)).map(([t, v]) => ({ time: t as UTCTimestamp, value: v })));
    c.timeScale().fitContent();
    return () => c.remove();
  }, [data]);
  return <div ref={el} className="eq-chart" />;
}

export function BtStats({ sm }: { sm: any }) {
  if (!sm || !sm.trades) return <Empty>Sin operaciones en el periodo.</Empty>;
  return (
    <div className="stack">
      <div className="kpi-row tight">
        <Stat label="Resultado" value={`${sm.ret_pct >= 0 ? "+" : ""}${fmt(sm.ret_pct)} %`} tone={sm.ret_pct >= 0 ? "buy" : "sell"} />
        <Stat label="DD máximo" value={`${fmt(sm.max_dd_pct)} %`} />
        <Stat label="Peor día" value={`${fmt(sm.worst_day_pct)} %`} />
        <Stat label="Operaciones" value={sm.trades} />
        <Stat label="R medio" value={sm.total.expR} />
        <Stat label="Factor beneficio" value={sm.total.pf ?? "–"} />
      </div>
      <table className="t">
        <thead><tr><th>Estrategia</th><th className="n">Ops</th><th className="n">Acierto</th><th className="n">R medio</th><th className="n">R total</th></tr></thead>
        <tbody>{Object.entries(sm.by_strategy || {}).map(([k, v]: any) => <tr key={k}><td>{k}</td><td className="n">{v.n}</td><td className="n">{pct(v.win)}</td><td className={`n ${v.expR >= 0 ? "buy" : "sell"}`}>{v.expR}</td><td className="n">{v.sumR}</td></tr>)}</tbody>
      </table>
      {sm.exit_reasons ? <div className="chips">{Object.entries(sm.exit_reasons).map(([k, v]) => <span key={k} className="chip">{k} <b>{String(v)}</b></span>)}</div> : null}
    </div>
  );
}

const KIND_TXT: Record<string, string> = { RANGE: "Ruptura de rango (OCO)", LM: "Momentum a una hora", R50: "Ruptura de niveles redondos" };
const TEMPLATE: Record<string, Record<string, any>> = {
  RANGE: { range_start: "02:00", range_end: "04:00", fill_end: "20:00", sl_atr: 0.25, tp_r: 2.0, exit_time: "23:30" },
  LM: { open_time: "01:05", entry_time: "10:00", window_min: 5, sl_atr: 0.5, tp_r: 2.0, exit_time: "21:00" },
  R50: { ref_time: "01:05", step: 25.0, buf_atr: 0.03, fill_end: "20:00", sl_atr: 0.15, tp_r: 0.0, exit_time: "23:30" },
};

function Backtest() {
  const { s, toast } = useApp();
  const cloud = s.broker === "cloud";
  const [cfg, setCfg] = useState({ start: "", end: "", balance: 100000, funding: false, management: false });
  const [custom, setCustom] = useState<Record<string, any>>({});
  const [extra, setExtra] = useState<StratDef | null>(null);
  const [lab, setLab] = useState(false);
  const job = s.jobs.backtest;
  const defs = (): StratDef[] => {
    const base = DEFAULT_STRATS.filter((d) => s.settings?.strategies?.[d.name]?.enabled !== false).map((d) => ({ ...d, params: { ...d.params, ...(custom[d.name] || {}) } }));
    return extra ? [...base, extra] : base;
  };
  const run = async () => { try { await api("/api/backtest", "POST", cloud ? { ...cfg, strategies: defs() } : cfg); } catch (e: any) { toast(e.message, "error"); } };
  const res = job?.status === "listo" ? job.result : null;
  return (
    <Card title="Backtest" tip={cloud ? "Velas M1 reales de tu bróker, el riesgo de Ajustes, spread real y 10 $ por lote de costes. Mismo motor que la investigación." : "En el simulador se muestra el resultado precalculado 2024-2026."}
      right={<button className="btn sm primary" disabled={job?.status === "en curso" || s.status !== "conectado"} onClick={run}>{job?.status === "en curso" ? "Calculando…" : "Ejecutar"}</button>}>
      <div className="grid3">
        <Field label="Desde" tip="Vacío = últimos 6 meses."><input placeholder="2026-05-01" value={cfg.start} onChange={(e) => setCfg({ ...cfg, start: e.target.value })} /></Field>
        <Field label="Hasta" tip="Vacío = hoy."><input placeholder="2026-10-15" value={cfg.end} onChange={(e) => setCfg({ ...cfg, end: e.target.value })} /></Field>
        <Field label="Balance"><input type="number" value={cfg.balance} onChange={(e) => setCfg({ ...cfg, balance: Number(e.target.value) })} /></Field>
      </div>
      <div className="checks">
        <label><input type="checkbox" checked={cfg.funding} onChange={(e) => setCfg({ ...cfg, funding: e.target.checked })} />Aplicar reglas de fondeo</label>
        {cloud ? <label><input type="checkbox" checked={cfg.management} onChange={(e) => setCfg({ ...cfg, management: e.target.checked })} />Aplicar gestión automática (Ajustes)</label> : null}
        {cloud ? <button type="button" className={`linkbtn ${lab ? "on" : ""}`} onClick={() => setLab(!lab)}>Probar otros parámetros{Object.keys(custom).length || extra ? ` (${Object.keys(custom).length + (extra ? 1 : 0)})` : ""}</button> : null}
      </div>
      {cloud && lab ? (
        <div className="lab">
          {DEFAULT_STRATS.filter((d) => s.settings?.strategies?.[d.name]?.enabled !== false).map((d) => (
            <details key={d.name}><summary>{d.name}{custom[d.name] ? <span className="pending">modificada</span> : null}</summary>
              <ParamEditor params={{ ...d.params, ...(custom[d.name] || {}) }} label="Usar en el backtest" onSave={(p) => { setCustom({ ...custom, [d.name]: p }); toast(`${d.name}: parámetros de prueba listos`, "ok"); }} />
            </details>
          ))}
          <details open={!!extra}><summary>Estrategia nueva{extra ? <span className="pending">{KIND_TXT[extra.kind]}</span> : null}</summary>
            <div className="param-ed">
              <Field label="Tipo"><select value={extra?.kind || ""} onChange={(e) => { const k = e.target.value as any; setExtra(k ? { name: "PRUEBA", kind: k, params: { ...TEMPLATE[k] }, needInside: false } : null); }}><option value="">Ninguna</option>{Object.entries(KIND_TXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              {extra ? <>
                <ParamEditor params={extra.params} label="Usar en el backtest" onSave={(p) => { setExtra({ ...extra, params: p }); toast("Estrategia de prueba lista", "ok"); }} />
                {extra.kind === "RANGE" ? <label className="checks"><input type="checkbox" checked={!!extra.needInside} onChange={(e) => setExtra({ ...extra, needInside: e.target.checked })} />Solo si el precio está dentro del rango al terminar</label> : null}
              </> : null}
            </div>
          </details>
        </div>
      ) : null}
      {job?.status === "error" ? <div className="note bad">{job.error}</div> : null}
      {res ? <div className="stack" style={{ marginTop: 12 }}>{res.note ? <div className="hint">{res.note}</div> : null}<EquityChart data={res.equity} /><BtStats sm={res.summary} /></div>
        : job?.status !== "en curso" ? <Empty>Ejecuta el backtest para ver el resultado.</Empty> : <Empty>Calculando…</Empty>}
    </Card>
  );
}
