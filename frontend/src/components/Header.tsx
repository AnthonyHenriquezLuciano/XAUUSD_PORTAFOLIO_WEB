import React from "react";
import { api } from "../api";
import { fmt, useApp } from "../store";
import { useUI } from "../uiState";
import { Toggle } from "../ui";

function Meter({ label, used, limit, invert }: { label: string; used: number; limit: number; invert?: boolean }) {
  const frac = limit > 0 ? Math.max(0, Math.min(1, used / limit)) : 0;
  const cls = invert ? "" : frac > 0.8 ? "bad" : frac > 0.5 ? "warn" : "";
  return (
    <div className="kpi meter" title={`${fmt(used)} % de ${fmt(limit)} %`}>
      <span className="l">{label}</span>
      <span className="v small">{fmt(used)} % <span className="dim">/ {fmt(limit, 1)} %</span></span>
      <div className="bar"><i className={cls} style={{ width: `${frac * 100}%` }} /></div>
    </div>
  );
}

const agoTxt = (t?: number | null) => {
  if (!t) return "nunca";
  const s = Math.max(0, Date.now() / 1000 - t);
  return s < 90 ? `hace ${Math.round(s)} s` : s < 5400 ? `hace ${Math.round(s / 60)} min` : s < 129600 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.round(s / 86400)} días`;
};

export default function Header({ onExitSim }: { onExitSim?: () => void }) {
  const { s, toast, ask } = useApp();
  const ui = useUI();
  const a = s.account || {};
  const r = s.risk || {};
  const f = s.settings?.funding || {};
  const sim = s.broker === "sim";
  const loaded = s.status === "conectado";
  const online = !!s.ea?.online;
  const canTrade = sim || (s.role === "owner" || s.role === "trader");
  const pnl = (a.equity ?? 0) - (a.balance ?? 0);
  const target = sim ? (f.phase === 1 ? f.target_phase1_pct : f.phase === 2 ? f.target_phase2_pct : 0) : Number(r.target_pct || f.target_pct || 0);
  const autotrade = !!s.settings?.autotrade;

  const setAuto = async (on: boolean) => {
    if (on && !(await ask(`¿Activar la operación automática en la cuenta ${a.login ?? ""} (${a.server ?? ""})?\n\nEl EA abrirá y cerrará operaciones del portafolio por sí solo con un riesgo de ${s.settings?.risk?.risk_pct}% por operación.${!sim && !online ? "\n\nEl EA no está conectado ahora: se aplicará cuando se conecte." : ""}`, "Activar"))) return;
    try { await api("/api/autotrade", "POST", { on }); } catch (e: any) { toast(e.message, "error"); }
  };
  const panic = async () => {
    if (!(await ask("¿Cerrar TODAS las posiciones del símbolo ahora?", "Cerrar todo", true))) return;
    try { await api("/api/close_all", "POST"); toast("Posiciones cerradas", "ok"); } catch (e: any) { toast(e.message, "error"); }
  };

  return (
    <div className="header">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#1a2030" /><path d="M7 22l6-8 5 5 7-10" stroke="#e0b04f" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        XAU <b>Portfolio AI</b>{sim ? <span className="chip gold" title="Repite días reales de oro en una cuenta simulada">SIMULADOR</span> : null}
      </div>
      <button className="pill" onClick={() => ui.setAccountOpen(true)} title="Cambiar de cuenta">
        <span className={`dot ${online ? "ok" : loaded ? "" : "wait"}`} />
        {sim ? <>Simulación · cuenta de demostración</> : s.accountInfo ? <>{s.accountInfo.name}{a.login ? <span className="dim"> · {a.login} · {a.server}</span> : null}</> : "Elegir cuenta"}
      </button>
      {!sim && s.accountInfo ? <span className="ea-pill" title="El EA puente envía los datos y ejecuta las órdenes">{online ? "EA conectado" : `EA desconectado (${agoTxt(s.ea?.last_seen)})`}</span> : null}
      {loaded && a.balance != null ? (
        <>
          <div className="kpi"><span className="l">Balance</span><span className="v">{fmt(a.balance)}</span></div>
          <div className="kpi"><span className="l">Equity</span><span className="v">{fmt(a.equity)}</span></div>
          <div className="kpi"><span className="l">Flotante</span><span className={`v ${pnl >= 0 ? "buy" : "sell"}`}>{pnl >= 0 ? "+" : ""}{fmt(pnl)}</span></div>
          {r.funding ? (
            <>
              <Meter label="DD diario" used={r.daily_dd_pct ?? 0} limit={f.daily_loss_pct ?? 3} />
              <Meter label="DD máximo" used={r.max_dd_pct ?? 0} limit={f.max_loss_pct ?? 10} />
              {target ? <Meter label="Objetivo" used={Math.max(0, r.progress_pct ?? 0)} limit={target} invert /> : null}
            </>
          ) : null}
          {r.blocked ? <span className="chip down">Bloqueado: {r.blocked}</span> : null}
          {s.market?.discipline?.why ? <span className="chip down" title="Protector de disciplina: no se abren operaciones">Disciplina · {s.market.discipline.why}{s.market.discipline.until ? ` · hasta ${new Date((s.market.discipline.until - (s.news_offset ?? 7200)) * 1000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : ""}</span> : null}
          {s.market?.news ? <span className="chip down" title="Filtro de noticias: el EA no abre operaciones">Pausa por noticia · {s.market.news.title} · hasta {new Date(s.market.news.until * 1000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span> : null}
        </>
      ) : null}
      <div className="spacer" />
      {onExitSim ? <button className="btn sm primary" onClick={onExitSim}>Entrar con mi cuenta</button> : null}
      {loaded && canTrade ? (
        <>
          <div className={`auto ${autotrade ? "on" : ""}`} title="El portafolio opera solo con las 5 estrategias">
            <Toggle on={autotrade} onChange={setAuto} />
            <span style={{ fontWeight: 600 }}>{autotrade ? "Automático ON" : "Automático OFF"}</span>
            {s.settings?.pending?.includes("autotrade") ? <span className="pending" title="El EA aún no lo ha aplicado">pendiente</span> : null}
          </div>
          <button className="btn danger sm" onClick={panic} disabled={!sim && !online} title="Cierra todas las posiciones del símbolo">Cerrar todo</button>
        </>
      ) : null}
    </div>
  );
}
