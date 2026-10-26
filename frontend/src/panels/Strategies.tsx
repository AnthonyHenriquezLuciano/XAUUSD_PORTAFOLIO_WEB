import React, { useEffect, useRef, useState } from "react";
import { createChart, UTCTimestamp } from "lightweight-charts";
import { api } from "../api";
import { fmt, pct, useApp } from "../store";
import { useUI } from "../uiState";
import { Card, Field, Toggle } from "../ui";
import { DEFAULT_STRATS, StratDef } from "../ai/backtest";

export default function Strategies() {
  const { s, toast, refresh } = useApp();
  const st = s.settings;
  const cloud = s.broker === "cloud";
  const canEdit = !cloud || s.role === "owner" || s.role === "trader";
  const save = async (strategies: any) => {
    try { await api("/api/settings", "PUT", { strategies }); if (!cloud) await refresh(); toast(cloud ? (s.ea?.online ? "Enviado al EA" : "Guardado: el EA lo aplicará al conectarse") : "Portafolio actualizado", "ok"); } catch (e: any) { toast(e.message, "error"); }
  };
  if (!st) return null;
  const scen = new Map((s.signals?.strategies || []).map((x: any) => [x.name, x.scenario]));
  return (
    <div className="col">
      <Card title="Portafolio">
        {s.strategies.map((x) => {
          const cfg = st.strategies[x.name] || { enabled: true, params: {} };
          const sc: any = scen.get(x.name);
          return (
            <details key={x.name} style={{ borderBottom: "1px solid #1e2534", padding: "6px 0" }}>
              <summary className="row between" style={{ cursor: "pointer", listStyle: "none" }}>
                <div className="row">
                  <Toggle on={cfg.enabled !== false} onChange={(v) => canEdit && save({ ...st.strategies, [x.name]: { ...cfg, enabled: v } })} />
                  <div><b>{x.name}</b>{st.pending?.includes(x.name) ? <span className="pending"> · pendiente</span> : null}<div className="small muted">{x.description}</div></div>
                </div>
                <span className="small muted" style={{ textAlign: "right" }}>{x.state}{sc ? <><br /><span className={sc.expR >= 0 ? "buy" : "sell"}>{sc.expR >= 0 ? "+" : ""}{sc.expR.toFixed(2)} R</span> en este escenario</> : null}</span>
              </summary>
              {cloud ? (
                <div className="small muted" style={{ padding: "6px 0" }}>
                  Parámetros del EA (valores por defecto): {Object.entries(x.params).map(([k, v]) => `${k} ${v}`).join(" · ")}.<br />
                  Se cambian en las entradas del EA en MT5. Puedes probar otros valores en el backtest de abajo.
                </div>
              ) : <ParamEditor params={x.params} onSave={(p) => save({ ...st.strategies, [x.name]: { ...cfg, params: p } })} />}
            </details>
          );
        })}
        <div className="hint" style={{ marginTop: 6 }}>Riesgo, límite de operaciones, cierre por tiempo y reglas de FundingPips son globales (Ajustes). Las estrategias las ejecuta el EA aunque cierres la web.</div>
      </Card>
      <Backtest />
    </div>
  );
}

function ParamEditor({ params, onSave, label = "Guardar parámetros" }: { params: Record<string, any>; onSave: (p: any) => void; label?: string }) {
  const [p, setP] = useState<Record<string, any>>(params);
  useEffect(() => setP(params), [JSON.stringify(params)]);
  return (
    <div style={{ padding: "8px 0 4px" }}>
      <div className="grid3">
        {Object.entries(p).map(([k, v]) => (
          <Field key={k} label={k}>
            <input value={String(v)} className="mono" onChange={(e) => setP({ ...p, [k]: typeof params[k] === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value })} />
          </Field>
        ))}
      </div>
      <button className="btn sm" style={{ marginTop: 6 }} onClick={() => onSave(p)}>{label}</button>
    </div>
  );
}

function EquityChart({ data }: { data: [number, number][] }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current || !data?.length) return;
    const c = createChart(el.current, { autoSize: true, layout: { background: { color: "transparent" }, textColor: "#8a93a6" }, grid: { vertLines: { visible: false }, horzLines: { color: "#1e2534" } }, timeScale: { borderColor: "#262e3f" }, rightPriceScale: { borderColor: "#262e3f" }, localization: { locale: "es-ES" } });
    const a = c.addAreaSeries({ lineColor: "#e0b04f", topColor: "rgba(224,176,79,.25)", bottomColor: "rgba(224,176,79,0)", lineWidth: 2 });
    const seen = new Set<number>();
    a.setData(data.filter(([t]) => !seen.has(t) && seen.add(t)).map(([t, v]) => ({ time: t as UTCTimestamp, value: v })));
    c.timeScale().fitContent();
    return () => c.remove();
  }, [data]);
  return <div ref={el} className="eq-chart" />;
}

export function Stats({ sm }: { sm: any }) {
  if (!sm || !sm.trades) return <div className="hint">Sin operaciones en el periodo.</div>;
  return (
    <div className="col">
      <div className="grid3 small mono">
        <div><div className="muted">Resultado</div><b className={sm.ret_pct >= 0 ? "buy" : "sell"}>{sm.ret_pct >= 0 ? "+" : ""}{fmt(sm.ret_pct)} %</b></div>
        <div><div className="muted">DD máximo</div>{fmt(sm.max_dd_pct)} %</div>
        <div><div className="muted">Peor día</div>{fmt(sm.worst_day_pct)} %</div>
        <div><div className="muted">Operaciones</div>{sm.trades}</div>
        <div><div className="muted">R medio</div>{sm.total.expR}</div>
        <div><div className="muted">Factor beneficio</div>{sm.total.pf ?? "–"}</div>
      </div>
      <table className="t">
        <thead><tr><th>Estrategia</th><th className="n">Ops</th><th className="n">Acierto</th><th className="n">R medio</th><th className="n">R total</th><th className="n">t</th></tr></thead>
        <tbody>{Object.entries(sm.by_strategy || {}).map(([k, v]: any) => <tr key={k}><td>{k}</td><td className="n">{v.n}</td><td className="n">{pct(v.win)}</td><td className={`n ${v.expR >= 0 ? "buy" : "sell"}`}>{v.expR}</td><td className="n">{v.sumR}</td><td className="n">{v.t}</td></tr>)}</tbody>
      </table>
      {sm.exit_reasons ? <div className="small muted">Salidas: {Object.entries(sm.exit_reasons).map(([k, v]) => `${k} ${v}`).join(" · ")}</div> : null}
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
  const [cfg, setCfg] = useState({ start: "", end: "", balance: 100000, funding: false });
  const [custom, setCustom] = useState<Record<string, any>>({});
  const [extra, setExtra] = useState<StratDef | null>(null);
  const job = s.jobs.backtest;
  const defs = (): StratDef[] => {
    const base = DEFAULT_STRATS.filter((d) => s.settings?.strategies?.[d.name]?.enabled !== false).map((d) => ({ ...d, params: { ...d.params, ...(custom[d.name] || {}) } }));
    return extra ? [...base, extra] : base;
  };
  const run = async () => { try { await api("/api/backtest", "POST", cloud ? { ...cfg, strategies: defs() } : cfg); } catch (e: any) { toast(e.message, "error"); } };
  const res = job?.status === "listo" ? job.result : null;
  return (
    <Card title="Backtest del portafolio" right={<button className="btn sm primary" disabled={job?.status === "en curso" || s.status !== "conectado"} onClick={run}>{job?.status === "en curso" ? "Calculando…" : "Ejecutar"}</button>}>
      <div className="grid2">
        <Field label="Desde (vacío = últimos 6 meses)"><input placeholder="2026-05-01" value={cfg.start} onChange={(e) => setCfg({ ...cfg, start: e.target.value })} /></Field>
        <Field label="Hasta (vacío = hoy)"><input placeholder="2026-10-15" value={cfg.end} onChange={(e) => setCfg({ ...cfg, end: e.target.value })} /></Field>
        <Field label="Balance"><input type="number" value={cfg.balance} onChange={(e) => setCfg({ ...cfg, balance: Number(e.target.value) })} /></Field>
        <label className="row small" style={{ marginTop: 18 }}><input type="checkbox" checked={cfg.funding} onChange={(e) => setCfg({ ...cfg, funding: e.target.checked })} />Aplicar reglas de fondeo</label>
      </div>
      {cloud ? (
        <details style={{ marginTop: 8 }}>
          <summary className="small" style={{ cursor: "pointer" }}>Probar otros parámetros o una estrategia nueva</summary>
          {DEFAULT_STRATS.filter((d) => s.settings?.strategies?.[d.name]?.enabled !== false).map((d) => (
            <details key={d.name} style={{ marginTop: 4 }}><summary className="small">{d.name}{custom[d.name] ? " (modificada)" : ""}</summary>
              <ParamEditor params={{ ...d.params, ...(custom[d.name] || {}) }} label="Usar en el backtest" onSave={(p) => { setCustom({ ...custom, [d.name]: p }); toast(`${d.name}: parámetros de prueba listos`, "ok"); }} />
            </details>
          ))}
          <div className="card" style={{ marginTop: 8 }}>
            <div className="row between"><b className="small">Estrategia de prueba</b>{extra ? <button className="btn sm ghost" onClick={() => setExtra(null)}>Quitar</button> : null}</div>
            <Field label="Tipo"><select value={extra?.kind || ""} onChange={(e) => { const k = e.target.value as any; setExtra(k ? { name: "PRUEBA", kind: k, params: { ...TEMPLATE[k] }, needInside: false } : null); }}><option value="">— ninguna —</option>{Object.entries(KIND_TXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            {extra ? <>
              <ParamEditor params={extra.params} label="Usar en el backtest" onSave={(p) => { setExtra({ ...extra, params: p }); toast("Estrategia de prueba lista", "ok"); }} />
              {extra.kind === "RANGE" ? <label className="row small"><input type="checkbox" checked={!!extra.needInside} onChange={(e) => setExtra({ ...extra, needInside: e.target.checked })} />Solo si el precio está dentro del rango al terminar</label> : null}
            </> : <div className="hint">Prueba aquí una idea de estrategia (rupturas de rango, momentum a una hora o niveles redondos) antes de añadirla al EA.</div>}
          </div>
        </details>
      ) : null}
      {job?.status === "error" ? <div className="errbox" style={{ marginTop: 8 }}>{job.error}</div> : null}
      {res ? <div style={{ marginTop: 10 }}>{res.note ? <div className="hint">{res.note}</div> : null}<EquityChart data={res.equity} /><Stats sm={res.summary} /></div> : <div className="hint" style={{ marginTop: 6 }}>{cloud ? "Usa las velas M1 reales de tu bróker guardadas en la web, el riesgo de Ajustes, spread real y 10 $ por lote de costes. Mismo motor que la investigación (comprobado operación a operación)." : "En el simulador se muestra el resultado precalculado del portafolio 2024-2026."}</div>}
    </Card>
  );
}
