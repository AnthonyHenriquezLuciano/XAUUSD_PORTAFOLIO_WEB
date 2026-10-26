import React, { useEffect, useState } from "react";
import { api } from "../api";
import { CloudSettings } from "./CloudSettings";
import { ChartSettings } from "./ChartSettings";
import { fmt, pct, tstr, useApp } from "../store";
import { Card, Field, Num, PageHead, SetRow, Toggle } from "../ui";

export default function Settings() {
  const { s } = useApp();
  if (s.broker === "cloud") return <CloudSettings />;
  return <SimSettings />;
}

/** Pestañas de una página de ajustes */
export function SubNav({ value, items, onChange }: { value: string; items: [string, string][]; onChange: (k: string) => void }) {
  return (
    <div className="subnav" role="tablist">
      {items.map(([k, l]) => <button key={k} role="tab" aria-selected={value === k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}

export function SaveBar({ dirty, onSave, onReset, disabled }: { dirty: boolean; onSave: () => void; onReset: () => void; disabled?: boolean }) {
  if (!dirty) return null;
  return (
    <div className="savebar" role="region" aria-label="Cambios sin guardar">
      <span>Cambios sin guardar</span>
      <button className="btn sm ghost" onClick={onReset}>Descartar</button>
      <button className="btn sm primary" onClick={onSave} disabled={disabled}>Guardar</button>
    </div>
  );
}

function SimSettings() {
  const { s, toast, refresh, ask } = useApp();
  const [st, setSt] = useState<any>(s.settings);
  const [tab, setTab] = useState("riesgo");
  useEffect(() => setSt(s.settings), [s.settings]);
  if (!st) return null;
  const r = st.risk, f = st.funding;
  const setR = (k: string, v: any) => setSt({ ...st, risk: { ...r, [k]: v } });
  const setF = (k: string, v: any) => setSt({ ...st, funding: { ...f, [k]: v } });
  const dirty = JSON.stringify(st) !== JSON.stringify(s.settings);
  const save = async () => {
    try { await api("/api/settings", "PUT", { ...st, strategies: undefined }); toast("Ajustes guardados", "ok"); refresh(); } catch (e: any) { toast(e.message, "error"); }
  };
  return (
    <div className="stack">
      <PageHead title="Configuración" sub="Preferencias, parámetros y protecciones de tu espacio de trabajo." />
      <SubNav value={tab} onChange={setTab} items={[["riesgo", "Riesgo y fondeo"], ["grafico", "Gráfico"], ["modelos", "Modelos"]]} />
      {tab === "riesgo" ? (
        <div className="cols-2">
          <Card title="Riesgo">
            <SetRow label="Riesgo por operación" tip="Porcentaje del balance base."><Num value={r.risk_pct} step={0.05} onChange={(v) => setR("risk_pct", v)} suffix="%" /></SetRow>
            <SetRow label="Interés compuesto" tip={`Nuevo balance base cada +${r.compound_up_pct} % / −${r.compound_dn_pct} %.`}><Toggle on={r.compound} onChange={(v) => setR("compound", v)} label="Interés compuesto" /></SetRow>
            {r.compound ? <div className="grid2"><Field label="Paso al ganar (%)"><Num value={r.compound_up_pct} step={0.5} onChange={(v) => setR("compound_up_pct", v)} /></Field><Field label="Paso al perder (%)"><Num value={r.compound_dn_pct} step={0.5} onChange={(v) => setR("compound_dn_pct", v)} /></Field></div> : null}
            <SetRow label="Máx. operaciones a la vez" tip="0 = sin límite."><Num value={r.max_open_trades} step={1} onChange={(v) => setR("max_open_trades", Math.round(v))} /></SetRow>
            <SetRow label="Cierre por tiempo" tip="Cada estrategia cierra a su hora."><Toggle on={r.use_time_exit} onChange={(v) => setR("use_time_exit", v)} label="Cierre por tiempo" /></SetRow>
            {!r.use_time_exit ? <SetRow label="TP para estrategias sin TP"><Num value={r.no_time_exit_tp_r} step={0.5} onChange={(v) => setR("no_time_exit_tp_r", v)} suffix="R" /></SetRow> : null}
            <SetRow label="Freno de DD" tip="Reduce el riesgo al acercarse al DD máximo."><Toggle on={r.dd_throttle} onChange={(v) => setR("dd_throttle", v)} label="Freno de DD" /></SetRow>
            <SetRow label="Tolerancia del lote mínimo" tip="Cuentas pequeñas: usar el lote mínimo si su riesgo no pasa de x veces el previsto."><Num value={r.min_lot_tol} step={0.5} onChange={(v) => setR("min_lot_tol", v)} suffix="×" /></SetRow>
            <SetRow label="Spread máximo"><Num value={r.max_spread} step={0.05} onChange={(v) => setR("max_spread", v)} suffix="$" /></SetRow>
            <SetRow label="Filtro IA por escenario" tip="Omite entradas con historial negativo en el escenario actual. En la validación apenas cambió el resultado."><Toggle on={r.ml_filter} onChange={(v) => setR("ml_filter", v)} label="Filtro IA" /></SetRow>
          </Card>
          <Card title="Reglas de fondeo" right={<Toggle on={f.enabled} onChange={(v) => setF("enabled", v)} label="Reglas de fondeo" />}>
            <div className="grid2">
              <Field label="Plantilla"><select value={f.preset} onChange={(e) => {
                const p = e.target.value;
                const presets: any = { "FundingPips 2 fases": { target_phase1_pct: 8, target_phase2_pct: 5, daily_loss_pct: 3, max_loss_pct: 10 }, Personalizada: {} };
                setSt({ ...st, funding: { ...f, preset: p, ...presets[p] } });
              }}><option>FundingPips 2 fases</option><option>Personalizada</option></select></Field>
              <Field label="Fase"><select value={f.phase} onChange={(e) => setF("phase", Number(e.target.value))}><option value={1}>Fase 1</option><option value={2}>Fase 2</option><option value={3}>Fondeada</option></select></Field>
              <Field label="Objetivo fase 1 (%)"><Num value={f.target_phase1_pct} step={0.5} onChange={(v) => setF("target_phase1_pct", v)} /></Field>
              <Field label="Objetivo fase 2 (%)"><Num value={f.target_phase2_pct} step={0.5} onChange={(v) => setF("target_phase2_pct", v)} /></Field>
              <Field label="Pérdida diaria máx. (%)"><Num value={f.daily_loss_pct} step={0.5} onChange={(v) => setF("daily_loss_pct", v)} /></Field>
              <Field label="Pérdida máx. total (%)"><Num value={f.max_loss_pct} step={0.5} onChange={(v) => setF("max_loss_pct", v)} /></Field>
              <Field label="Corte diario (%)" tip="La app para el día antes del límite real."><Num value={f.daily_guard_pct} step={0.1} onChange={(v) => setF("daily_guard_pct", v)} /></Field>
              <Field label="Bloqueo total (%)"><Num value={f.max_guard_pct} step={0.1} onChange={(v) => setF("max_guard_pct", v)} /></Field>
              <Field label="Base del límite diario"><select value={f.daily_base} onChange={(e) => setF("daily_base", e.target.value)}><option value="max_balance_equity">Mayor de balance y equity</option><option value="balance">Balance</option><option value="equity">Equity</option></select></Field>
              <Field label="Balance inicial"><Num value={f.initial_balance} step={1000} onChange={(v) => setF("initial_balance", v)} /></Field>
            </div>
            <SetRow label="Prohibir cobertura" tip="FundingPips no permite posiciones contrarias."><Toggle on={f.no_hedge} onChange={(v) => setF("no_hedge", v)} label="Prohibir cobertura" /></SetRow>
            <SetRow label="Parar al alcanzar el objetivo"><Toggle on={f.stop_at_target} onChange={(v) => setF("stop_at_target", v)} label="Parar al objetivo" /></SetRow>
            <div className="actions">
              <button className="btn sm" disabled={s.status !== "conectado"} onClick={async () => { if (await ask("¿Reiniciar bloqueos y balance base? (nueva cuenta o fase)", "Reiniciar")) { await api("/api/risk/reset", "POST"); toast("Bloqueos reiniciados", "ok"); } }}>Reiniciar bloqueos</button>
            </div>
          </Card>
        </div>
      ) : tab === "grafico" ? <ChartSettings /> : <AISettings />}
      <SaveBar dirty={dirty} onSave={save} onReset={() => setSt(s.settings)} />
    </div>
  );
}

export function AISettings() {
  const { s } = useApp();
  const m = s.models || {};
  const em = m.entry_meta?.metrics || {};
  const fm = m.forecast_meta?.metrics || {};
  return (
    <Card title="Modelos de la app" tip="Se calculan en tu navegador con las velas de la cuenta. No necesitan clave ni servicio externo.">
      <div className="kpi-row tight">
        <Stat2 label="Modelo de entradas" value={m.entry ? `${m.entry_meta?.n?.toLocaleString("es-ES")} entradas` : "Cargando…"} sub={m.entry ? `entrenado ${tstr(m.entry_meta?.t)}` : undefined} />
        {em.logloss ? <Stat2 label="Mejora sobre la base" value={em.mejora_pct > 0 ? `${em.mejora_pct} %` : "—"} sub={`AUC dirección ${em.auc_ganancia}`} /> : null}
        {Object.entries(fm).map(([h, v]: any) => <Stat2 key={h} label={`Rango 80 % a ${h}`} value={pct(v.cobertura_80)} sub={`dirección ${pct(v.acierto_direccion)}`} />)}
      </div>
      <div className="hint">Fuera de muestra (últimos 6 meses). El modelo separa bien SL, TP y cierre por tiempo según la volatilidad, pero no adivina la dirección.</div>
    </Card>
  );
}
function Stat2({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return <div className="stat"><span className="stat-l">{label}</span><span className="stat-v">{value}</span>{sub ? <span className="stat-s">{sub}</span> : null}</div>;
}
