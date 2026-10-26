import React, { useEffect, useState } from "react";
import { api } from "../api";
import { fmt, useApp } from "../store";
import { useUI } from "../uiState";
import { Card, Field, Num, PageHead, SetRow, Toggle } from "../ui";
import { AISettings, SaveBar, SubNav } from "./Settings";
import { ChartSettings } from "./ChartSettings";
import { DisciplineCard, ManagementCard, NewsFilterCard } from "./AutoSettings";
import CopyCard from "./CopyCard";

const TABS: [string, string][] = [["cuenta", "Cuenta y riesgo"], ["auto", "Automatización"], ["copiador", "Copiador"], ["grafico", "Gráfico"], ["modelos", "Modelos y datos"]];

export function CloudSettings() {
  const { s, toast, ask } = useApp();
  const ui = useUI();
  const base = s.settings;
  const [st, setSt] = useState<any>(base);
  const [tab, setTab] = useState<string>(() => { try { return sessionStorage.getItem("xauai.settab") || "cuenta"; } catch { return "cuenta"; } });
  useEffect(() => { try { sessionStorage.setItem("xauai.settab", tab); } catch { /* sin almacenamiento */ } }, [tab]);
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
    if (f.daily_guard_pct <= 0 || f.daily_guard_pct >= f.daily_loss_pct) return toast(`El corte diario debe ser menor que el límite real (${f.daily_loss_pct} %)`, "warn");
    if (f.max_guard_pct <= 0 || f.max_guard_pct > f.max_loss_pct) return toast(`El bloqueo total no puede pasar del ${f.max_loss_pct} %`, "warn");
    try {
      await api("/api/settings", "PUT", { risk: r, funding: { daily_guard_pct: f.daily_guard_pct, max_guard_pct: f.max_guard_pct, target_pct: f.target_pct, phase: f.phase } });
      toast(online ? "Ajustes enviados al EA" : "Ajustes guardados: se aplicarán al conectar el EA", "ok");
    } catch (err: any) { toast(err.message, "error"); }
  };
  const phaseTarget = (p: number) => (p === 1 ? 8 : p === 2 ? 5 : 0);
  const warnings = [s.ea?.trade_allowed === false ? "Algo Trading desactivado en MT5" : "", s.ea?.hedging === false ? "Cuenta netting: el EA necesita hedging" : ""].filter(Boolean);

  return (
    <div className="stack">
      <PageHead title="Ajustes" sub={!canEdit ? "Acceso de solo lectura" : undefined} />
      <SubNav value={tab} onChange={setTab} items={TABS} />

      {tab === "cuenta" ? (
        <div className="cols-2">
          <div className="stack">
            <Card title="Cuenta" right={<button className="btn xs" onClick={() => ui.setAccountOpen(true)}>Cambiar</button>}
              tip="Los cambios se guardan en la web y el EA los aplica en el siguiente segundo (o al volver a conectarse). Los parámetros de cada estrategia y el balance inicial son entradas del EA en MT5.">
              <div className="acct-card">
                <div><b>{s.accountInfo?.name}</b><div className="muted">{s.account?.login ? `${s.account.login} · ${s.account.server}` : "EA sin conectar"}</div></div>
                <span className={`tag ${online ? "ok" : ""}`}>{online ? "EA conectado" : "EA desconectado"}</span>
              </div>
              <div className="kv">
                <span>Versión del EA</span><b>{s.ea?.version || "–"}</b>
                <span>Símbolo</span><b>{s.settings.symbol}</b>
                <span>Magic</span><b>{s.settings.magic ?? "–"}</b>
                <span>Balance inicial</span><b>{fmt(e.initial_balance)}</b>
              </div>
              {warnings.map((w) => <div key={w} className="note warn">{w}</div>)}
            </Card>
            <Card title="Riesgo">
              <SetRow label="Riesgo por operación" tip="Del balance base. Máximo 3 %." pending={pend.includes("risk_pct")}><Num value={r.risk_pct} step={0.05} min={0.01} max={3} disabled={!canEdit} onChange={(v) => setR("risk_pct", v)} suffix="%" /></SetRow>
              <SetRow label="Interés compuesto" tip="Nuevo balance base cada +2 % / −1 %." pending={pend.includes("compound")}><Toggle on={r.compound} onChange={(v) => canEdit && setR("compound", v)} label="Interés compuesto" /></SetRow>
              <SetRow label="Máx. operaciones a la vez" tip="0 = sin límite." pending={pend.includes("max_open_trades")}><Num value={r.max_open_trades} step={1} min={0} max={20} disabled={!canEdit} onChange={(v) => setR("max_open_trades", Math.round(v))} /></SetRow>
              <SetRow label="Cierre por tiempo" tip="Cada estrategia cierra a su hora (así se validó el portafolio)." pending={pend.includes("use_time_exit")}><Toggle on={r.use_time_exit} onChange={(v) => canEdit && setR("use_time_exit", v)} label="Cierre por tiempo" /></SetRow>
            </Card>
          </div>
          <Card title="Reglas de fondeo" tip="FundingPips cambia sus reglas a menudo: compruébalas en tu panel.">
            <div className="grid2">
              <Field label="Fase"><select value={f.phase} disabled={!canEdit} onChange={(ev) => { const p = Number(ev.target.value); setSt({ ...st, funding: { ...f, phase: p, target_pct: phaseTarget(p) } }); }}><option value={1}>Fase 1 · 8 %</option><option value={2}>Fase 2 · 5 %</option><option value={0}>Fondeada</option></select></Field>
              <Field label={`Objetivo (%)${pend.includes("target_pct") ? " · pendiente" : ""}`} tip="El EA se detiene al alcanzarlo."><Num value={f.target_pct} step={0.5} min={0} max={50} disabled={!canEdit} onChange={(v) => setF("target_pct", v)} /></Field>
              <Field label={`Corte diario (%)${pend.includes("daily_guard_pct") ? " · pendiente" : ""}`} tip={`El EA cierra todo y para el día al perder esto. Límite real: ${f.daily_loss_pct} %.`}><Num value={f.daily_guard_pct} step={0.1} min={0.1} disabled={!canEdit} onChange={(v) => setF("daily_guard_pct", v)} /></Field>
              <Field label={`Bloqueo total (%)${pend.includes("max_guard_pct") ? " · pendiente" : ""}`} tip={`El EA se bloquea al perder esto del balance inicial. Límite real: ${f.max_loss_pct} %.`}><Num value={f.max_guard_pct} step={0.1} min={0.1} disabled={!canEdit} onChange={(v) => setF("max_guard_pct", v)} /></Field>
            </div>
            <div className="kv">
              <span>Suelo diario</span><b>{fmt(s.risk?.daily_floor)}</b>
              <span>Suelo máximo</span><b>{fmt(s.risk?.max_floor)}</b>
              {s.risk?.target ? <><span>Objetivo</span><b>{fmt(s.risk.target)}</b></> : null}
            </div>
            <div className="actions">
              <button className="btn sm" disabled={!canEdit || !online} onClick={async () => { if (await ask("¿Reiniciar los bloqueos y el balance base del EA? Úsalo al empezar una fase o cuenta nueva.", "Reiniciar")) { try { await api("/api/risk/reset", "POST"); toast("Bloqueos reiniciados", "ok"); } catch (err: any) { toast(err.message, "error"); } } }}>Reiniciar bloqueos</button>
              <button className="btn sm" disabled={!canEdit || !online} onClick={async () => { try { await api("/api/history", "POST", { days: 365 }); toast("El EA reenviará las operaciones del último año", "ok"); } catch (err: any) { toast(err.message, "error"); } }}>Reenviar historial</button>
            </div>
          </Card>
        </div>
      ) : tab === "auto" ? (
        <div className="cols-2">
          <DisciplineCard />
          <div className="stack">
            <NewsFilterCard />
            <ManagementCard />
          </div>
        </div>
      ) : tab === "copiador" ? <CopyCard />
        : tab === "grafico" ? <ChartSettings />
        : (
          <div className="cols-2">
            <AISettings />
            <Card title="Datos" tip="El EA sube hasta 180 días de velas al conectarse (entrada InpWebHistoryDays). Si tu MT5 guarda menos, sube «Máx. barras en el gráfico» en Herramientas → Opciones → Gráficos.">
              <div className="kpi-row tight">
                <div className="stat"><span className="stat-l">Velas M1 en esta página</span><span className="stat-v">{fmt(s.history, 0)}</span><span className="stat-s">últimos 15 días</span></div>
              </div>
            </Card>
          </div>
        )}
      <SaveBar dirty={dirty} onSave={save} onReset={() => setSt(base)} disabled={!canEdit} />
    </div>
  );
}
