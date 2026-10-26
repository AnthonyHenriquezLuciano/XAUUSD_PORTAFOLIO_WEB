import React, { useEffect, useState } from "react";
import { api } from "../api";
import { CloudSettings } from "./CloudSettings";
import { fmt, pct, tstr, useApp } from "../store";
import { Card, Field, Num, Toggle } from "../ui";

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="row between" style={{ padding: "5px 0" }}><div><div>{label}</div>{hint ? <div className="hint">{hint}</div> : null}</div><div style={{ width: 120, flex: "none", display: "flex", justifyContent: "flex-end" }}>{children}</div></div>
  );
}

export default function Settings() {
  const { s } = useApp();
  if (s.broker === "cloud") return <CloudSettings />;
  return <SimSettings />;
}

function SimSettings() {
  const { s, toast, refresh, ask } = useApp();
  const [st, setSt] = useState<any>(s.settings);
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
    <div className="col">
      {dirty ? <div className="row" style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--panel)", padding: "4px 0" }}><div className="warnbox grow">Cambios sin guardar</div><button className="btn primary" onClick={save}>Guardar</button></div> : null}

      <Card title="Riesgo (global para todas las estrategias)">
        <Row label="Riesgo por operación (%)" hint="Del balance base"><Num value={r.risk_pct} step={0.05} onChange={(v) => setR("risk_pct", v)} /></Row>
        <Row label="Interés compuesto escalonado" hint={`Nuevo balance base cada +${r.compound_up_pct}% / -${r.compound_dn_pct}%`}><Toggle on={r.compound} onChange={(v) => setR("compound", v)} /></Row>
        {r.compound ? <div className="grid2"><Field label="Paso de ganancia (%)"><Num value={r.compound_up_pct} step={0.5} onChange={(v) => setR("compound_up_pct", v)} /></Field><Field label="Paso de pérdida (%)"><Num value={r.compound_dn_pct} step={0.5} onChange={(v) => setR("compound_dn_pct", v)} /></Field></div> : null}
        <Row label="Máx. operaciones simultáneas" hint="0 = sin límite"><Num value={r.max_open_trades} step={1} onChange={(v) => setR("max_open_trades", Math.round(v))} /></Row>
        <Row label="Cierre por tiempo" hint="Cada estrategia cierra a su hora"><Toggle on={r.use_time_exit} onChange={(v) => setR("use_time_exit", v)} /></Row>
        {!r.use_time_exit ? <Row label="TP para estrategias sin TP (R)"><Num value={r.no_time_exit_tp_r} step={0.5} onChange={(v) => setR("no_time_exit_tp_r", v)} /></Row> : null}
        <Row label="Freno de DD" hint="Reduce el riesgo al acercarse al DD máximo"><Toggle on={r.dd_throttle} onChange={(v) => setR("dd_throttle", v)} /></Row>
        <Row label="Tolerancia lote mínimo (x)" hint="Cuentas pequeñas"><Num value={r.min_lot_tol} step={0.5} onChange={(v) => setR("min_lot_tol", v)} /></Row>
        <Row label="Spread máximo ($/oz)"><Num value={r.max_spread} step={0.05} onChange={(v) => setR("max_spread", v)} /></Row>
        <Row label="Filtro IA por escenario" hint="Omite entradas con historial negativo en el escenario actual. En la validación apenas cambió el resultado: por defecto apagado."><Toggle on={r.ml_filter} onChange={(v) => setR("ml_filter", v)} /></Row>
      </Card>

      <Card title="Reglas de fondeo" right={<Toggle on={f.enabled} onChange={(v) => setF("enabled", v)} />}>
        <div className="grid2">
          <Field label="Plantilla"><select value={f.preset} onChange={(e) => {
            const p = e.target.value;
            const presets: any = { "FundingPips 2 fases": { target_phase1_pct: 8, target_phase2_pct: 5, daily_loss_pct: 3, max_loss_pct: 10 }, Personalizada: {} };
            setSt({ ...st, funding: { ...f, preset: p, ...presets[p] } });
          }}><option>FundingPips 2 fases</option><option>Personalizada</option></select></Field>
          <Field label="Fase actual"><select value={f.phase} onChange={(e) => setF("phase", Number(e.target.value))}><option value={1}>Fase 1</option><option value={2}>Fase 2</option><option value={3}>Fondeada</option></select></Field>
          <Field label="Objetivo fase 1 (%)"><Num value={f.target_phase1_pct} step={0.5} onChange={(v) => setF("target_phase1_pct", v)} /></Field>
          <Field label="Objetivo fase 2 (%)"><Num value={f.target_phase2_pct} step={0.5} onChange={(v) => setF("target_phase2_pct", v)} /></Field>
          <Field label="Pérdida diaria máx. (%)"><Num value={f.daily_loss_pct} step={0.5} onChange={(v) => setF("daily_loss_pct", v)} /></Field>
          <Field label="Pérdida máx. estática (%)"><Num value={f.max_loss_pct} step={0.5} onChange={(v) => setF("max_loss_pct", v)} /></Field>
          <Field label="La app corta al perder en el día (%)" hint="Margen antes del límite real"><Num value={f.daily_guard_pct} step={0.1} onChange={(v) => setF("daily_guard_pct", v)} /></Field>
          <Field label="La app bloquea al perder en total (%)"><Num value={f.max_guard_pct} step={0.1} onChange={(v) => setF("max_guard_pct", v)} /></Field>
          <Field label="Base del límite diario"><select value={f.daily_base} onChange={(e) => setF("daily_base", e.target.value)}><option value="max_balance_equity">Mayor entre balance y equity al inicio del día</option><option value="balance">Balance al inicio del día</option><option value="equity">Equity al inicio del día</option></select></Field>
          <Field label="Balance inicial de la cuenta" hint="Obligatorio en cuentas de fondeo"><Num value={f.initial_balance} step={1000} onChange={(v) => setF("initial_balance", v)} /></Field>
        </div>
        <Row label="Prohibir cobertura" hint="FundingPips no permite posiciones contrarias"><Toggle on={f.no_hedge} onChange={(v) => setF("no_hedge", v)} /></Row>
        <Row label="Parar al alcanzar el objetivo"><Toggle on={f.stop_at_target} onChange={(v) => setF("stop_at_target", v)} /></Row>
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn sm" disabled={s.status !== "conectado"} onClick={async () => { if (await ask("¿Reiniciar bloqueos y balance base? (nueva cuenta o nueva fase)", "Reiniciar")) { await api("/api/risk/reset", "POST"); toast("Reiniciado", "ok"); } }}>Reiniciar bloqueos (nueva fase)</button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>Comprueba las reglas vigentes en la web de FundingPips: pueden cambiar (noticias, días mínimos, consistencia).</div>
      </Card>

      <AISettings />

    </div>
  );
}

export function AISettings() {
  const { s, toast, refresh } = useApp();
  const [key, setKey] = useState("");
  const m = s.models || {};
  const em = m.entry_meta?.metrics || {};
  const fm = m.forecast_meta?.metrics || {};
  const saveKey = async () => {
    try { await api("/api/secret", "POST", { name: "anthropic_api_key", value: key }); setKey(""); toast("API key guardada", "ok"); refresh(); } catch (e: any) { toast(e.message, "error"); }
  };
  const setModel = async (v: string) => { await api("/api/settings", "PUT", { chat_model: v }); refresh(); };
  return (
    <Card title="IA">
      {s.broker === "sim" ? <div className="okbox">En el simulador el chat usa la API key que guardes al entrar con tu cuenta (Ajustes → IA de cualquier cuenta).</div> : <Field label={`API key de Anthropic ${s.secrets?.anthropic ? "(guardada ✓)" : "(no guardada)"}`} hint="Se guarda cifrada en el servidor y el navegador no puede leerla: solo la usa la función del chat. Pago por uso en console.anthropic.com.">
        <div className="row"><input className="grow" type="password" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} /><button className="btn" onClick={saveKey} disabled={!key}>Guardar</button>
          {s.secrets?.anthropic ? <button className="btn ghost" onClick={async () => { await api("/api/secret", "POST", { name: "anthropic_api_key", value: "" }); refresh(); }}>Borrar</button> : null}</div>
      </Field>}
      <Field label="Modelo del chat">
        <select value={s.settings?.chat_model} onChange={(e) => setModel(e.target.value)}>
          <option value="claude-sonnet-5-5">Claude Sonnet 5.5 (equilibrado)</option>
          <option value="claude-opus-5-5">Claude Opus 5.5 (más capaz, más caro)</option>
          <option value="claude-haiku-5-5">Claude Haiku 5.5 (rápido y barato)</option>
          <option value="claude-fable-5-1">Claude Fable 5.1 (el más capaz)</option>
        </select>
      </Field>
      <div style={{ marginTop: 10 }}>
        <b>Modelos de la app</b>
        <div className="small muted">{m.entry ? `Entradas: entrenado ${tstr(m.entry_meta?.t)} con ${m.entry_meta?.n?.toLocaleString("es-ES")} entradas simuladas de XAUUSD 2024-2026` : "Cargando modelos…"}. Se calculan en tu navegador con las velas de la cuenta.</div>
      </div>
      {em.logloss ? (
        <div className="small" style={{ marginTop: 8 }}>
          <b>Fiabilidad fuera de muestra (últimos 6 meses)</b>
          <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
            <li>Modelo de entradas: {em.mejora_pct > 0 ? `${em.mejora_pct} % mejor` : "no mejor"} que usar solo SL/TP/horizonte (log-loss {em.logloss} frente a {em.logloss_base}). Separa bien SL/TP/cierre por tiempo según la volatilidad; no tiene ventaja de dirección (AUC {em.auc_ganancia}).</li>
            {Object.entries(fm).map(([h, v]: any) => <li key={h}>Predicción {h}: el rango del 80 % contuvo el precio el {pct(v.cobertura_80)} de las veces; acierto de dirección {pct(v.acierto_direccion)}.</li>)}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

