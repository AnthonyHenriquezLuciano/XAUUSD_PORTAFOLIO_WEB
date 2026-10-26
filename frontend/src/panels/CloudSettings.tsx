import React, { useEffect, useState } from "react";
import { api } from "../api";
import { fmt, useApp } from "../store";
import { useUI } from "../uiState";
import { Card, Field, Num, Toggle } from "../ui";
import { AISettings } from "./Settings";
import { ChartSettings } from "./ChartSettings";
import { DisciplineCard, ManagementCard, NewsFilterCard } from "./AutoSettings";
import CopyCard from "./CopyCard";

function Row({ label, children, hint, pending }: { label: string; children: React.ReactNode; hint?: string; pending?: boolean }) {
  return (
    <div className="row between" style={{ padding: "5px 0" }}>
      <div><div>{label}{pending ? <span className="pending" title="Guardado en la web; el EA lo aplicará al conectarse"> · pendiente</span> : null}</div>{hint ? <div className="hint">{hint}</div> : null}</div>
      <div style={{ width: 120, flex: "none", display: "flex", justifyContent: "flex-end" }}>{children}</div>
    </div>
  );
}

export function CloudSettings() {
  const { s, toast, ask } = useApp();
  const ui = useUI();
  const base = s.settings;
  const [st, setSt] = useState<any>(base);
  useEffect(() => setSt(base), [JSON.stringify(base?.web_settings), JSON.stringify(base?.ea_settings)]);
  if (!st) return null;
  const canEdit = s.role === "owner" || s.role === "trader";
  const r = st.risk, f = st.funding, pend: string[] = base.pending || [];
  const setR = (k: string, v: any) => setSt({ ...st, risk: { ...r, [k]: v } });
  const setF = (k: string, v: any) => setSt({ ...st, funding: { ...f, [k]: v } });
  const dirty = JSON.stringify({ r, f }) !== JSON.stringify({ r: base.risk, f: base.funding });
  const e = base.ea_settings || {};
  const online = !!s.ea?.online;

  const save = async () => {
    if (r.risk_pct <= 0 || r.risk_pct > 3) return toast("El riesgo por operación debe estar entre 0 y 3 %", "warn");
    if (f.daily_guard_pct <= 0 || f.daily_guard_pct >= f.daily_loss_pct) return toast(`La guarda diaria debe ser menor que el límite real (${f.daily_loss_pct} %)`, "warn");
    if (f.max_guard_pct <= 0 || f.max_guard_pct > f.max_loss_pct) return toast(`La guarda máxima no puede pasar del ${f.max_loss_pct} %`, "warn");
    try {
      await api("/api/settings", "PUT", { risk: r, funding: { daily_guard_pct: f.daily_guard_pct, max_guard_pct: f.max_guard_pct, target_pct: f.target_pct, phase: f.phase } });
      toast(online ? "Ajustes enviados al EA" : "Ajustes guardados: el EA los aplicará al conectarse", "ok");
    } catch (err: any) { toast(err.message, "error"); }
  };
  const phaseTarget = (p: number) => (p === 1 ? 8 : p === 2 ? 5 : 0);

  return (
    <div className="col">
      {dirty ? <div className="row" style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--panel)", padding: "4px 0" }}><div className="warnbox grow">Cambios sin guardar</div><button className="btn primary" onClick={save} disabled={!canEdit}>Guardar</button></div> : null}
      {!canEdit ? <div className="hint">Tu acceso a esta cuenta es de solo lectura.</div> : null}

      <Card title="Cuenta" right={<button className="btn sm" onClick={() => ui.setAccountOpen(true)}>Cuentas…</button>}>
        <div className="small">{s.accountInfo?.name} · <span className="muted">{s.account?.login ? `${s.account.login} · ${s.account.server} · ${s.account.company ?? ""}` : "EA aún sin conectar"}</span></div>
        <div className="small muted">EA {online ? "conectado" : "desconectado"}{s.ea?.version ? ` · versión ${s.ea.version}` : ""} · {s.settings.symbol} · magic {s.settings.magic ?? "–"}{s.ea?.trade_allowed === false ? " · ⚠ Algo Trading desactivado en MT5" : ""}{s.ea?.hedging === false ? " · ⚠ cuenta netting" : ""}</div>
        <div className="hint" style={{ marginTop: 4 }}>Los cambios de esta página se guardan en la web y el EA los aplica en el siguiente segundo (si está desconectado, al volver). Los parámetros de cada estrategia y el balance inicial son entradas del EA en MT5.</div>
      </Card>

      <Card title="Riesgo (global para todas las estrategias)">
        <Row label="Riesgo por operación (%)" hint="Del balance base · máx. 3 %" pending={pend.includes("risk_pct")}><Num value={r.risk_pct} step={0.05} min={0.01} max={3} disabled={!canEdit} onChange={(v) => setR("risk_pct", v)} /></Row>
        <Row label="Interés compuesto escalonado" hint="Nuevo balance base cada +2 % / −1 %" pending={pend.includes("compound")}><Toggle on={r.compound} onChange={(v) => canEdit && setR("compound", v)} /></Row>
        <Row label="Máx. operaciones simultáneas" hint="0 = sin límite" pending={pend.includes("max_open_trades")}><Num value={r.max_open_trades} step={1} min={0} max={20} disabled={!canEdit} onChange={(v) => setR("max_open_trades", Math.round(v))} /></Row>
        <Row label="Cierre por tiempo" hint="Cada estrategia cierra a su hora (así se validó)" pending={pend.includes("use_time_exit")}><Toggle on={r.use_time_exit} onChange={(v) => canEdit && setR("use_time_exit", v)} /></Row>
      </Card>

      <Card title="Reglas de fondeo (FundingPips)">
        <div className="grid2">
          <Field label="Fase"><select value={f.phase} disabled={!canEdit} onChange={(ev) => { const p = Number(ev.target.value); setSt({ ...st, funding: { ...f, phase: p, target_pct: phaseTarget(p) } }); }}><option value={1}>Fase 1 (objetivo 8 %)</option><option value={2}>Fase 2 (objetivo 5 %)</option><option value={0}>Fondeada (sin objetivo)</option></select></Field>
          <Field label={`Objetivo (%)${pend.includes("target_pct") ? " · pendiente" : ""}`} hint="El EA se detiene al alcanzarlo"><Num value={f.target_pct} step={0.5} min={0} max={50} disabled={!canEdit} onChange={(v) => setF("target_pct", v)} /></Field>
          <Field label={`El EA corta al perder en el día (%)${pend.includes("daily_guard_pct") ? " · pendiente" : ""}`} hint={`Límite real ${f.daily_loss_pct} %`}><Num value={f.daily_guard_pct} step={0.1} min={0.1} disabled={!canEdit} onChange={(v) => setF("daily_guard_pct", v)} /></Field>
          <Field label={`El EA bloquea al perder en total (%)${pend.includes("max_guard_pct") ? " · pendiente" : ""}`} hint={`Límite real ${f.max_loss_pct} % estático`}><Num value={f.max_guard_pct} step={0.1} min={0.1} disabled={!canEdit} onChange={(v) => setF("max_guard_pct", v)} /></Field>
        </div>
        <div className="small" style={{ marginTop: 6 }}>Balance inicial (entrada del EA): <b className="mono">{fmt(e.initial_balance)}</b> · suelo diario <span className="mono">{fmt(s.risk?.daily_floor)}</span> · suelo máximo <span className="mono">{fmt(s.risk?.max_floor)}</span>{s.risk?.target ? <> · objetivo <span className="mono">{fmt(s.risk.target)}</span></> : null}</div>
        <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
          <button className="btn sm" disabled={!canEdit || !online} onClick={async () => { if (await ask("¿Reiniciar los bloqueos del EA y el balance base? Úsalo al empezar una fase o cuenta nueva (pon también InpInitialBalance si cambió).", "Reiniciar")) { try { await api("/api/risk/reset", "POST"); toast("Bloqueos reiniciados", "ok"); } catch (err: any) { toast(err.message, "error"); } } }}>Reiniciar bloqueos (nueva fase)</button>
          <button className="btn sm" disabled={!canEdit || !online} onClick={async () => { try { await api("/api/history", "POST", { days: 365 }); toast("El EA reenviará las operaciones del último año", "ok"); } catch (err: any) { toast(err.message, "error"); } }}>Reenviar historial de operaciones</button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>Comprueba las reglas vigentes en la web de FundingPips: pueden cambiar (noticias, días mínimos, consistencia).</div>
      </Card>

      <DisciplineCard />
      <NewsFilterCard />

      <ManagementCard />

      <CopyCard />

      <ChartSettings />

      <AISettings />

      <Card title="Datos">
        <div className="small">Velas M1 cargadas en esta página: <b className="mono">{fmt(s.history, 0)}</b> (últimos 15 días; los días anteriores se usan agregados para el ATR y el régimen).</div>
        <div className="hint">El EA sube hasta 180 días de velas al conectarse (entrada InpWebHistoryDays). Si tu MT5 guarda menos, sube «Máx. barras en el gráfico» en Herramientas → Opciones → Gráficos.</div>
      </Card>
    </div>
  );
}
