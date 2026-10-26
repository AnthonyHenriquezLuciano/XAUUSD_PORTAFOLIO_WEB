import React from "react";
import { api } from "../api";
import { Icon, Logo } from "../icons";
import { fmt, useApp } from "../store";
import { useUI } from "../uiState";
import { Toggle } from "../ui";

function Meter({ label, used, limit, goal }: { label: string; used: number; limit: number; goal?: boolean }) {
  const frac = limit > 0 ? Math.max(0, Math.min(1, used / limit)) : 0;
  const cls = goal ? "goal" : frac > 0.8 ? "bad" : frac > 0.5 ? "warn" : "";
  return (
    <div className="meter" title={`${label}: ${fmt(used)} % de ${fmt(limit, 1)} %`}>
      <span className="meter-l">{label}<b>{fmt(used)}%</b><span className="dim">/{fmt(limit, 0)}</span></span>
      <span className="meter-bar"><i className={cls} style={{ width: `${frac * 100}%` }} /></span>
    </div>
  );
}

const agoTxt = (t?: number | null) => {
  if (!t) return "nunca";
  const s = Math.max(0, Date.now() / 1000 - t);
  return s < 90 ? `hace ${Math.round(s)} s` : s < 5400 ? `hace ${Math.round(s / 60)} min` : s < 129600 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.round(s / 86400)} d`;
};
const hhmm = (t: number) => new Date(t * 1000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

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
  const t = s.tick;
  const dayOpen = (s.signals?.levels || []).find((l: any) => l.name === "Apertura del día")?.price;
  const chg = t && dayOpen ? t.bid - dayOpen : null;
  const off = s.news_offset ?? 7200;

  const setAuto = async (on: boolean) => {
    if (on && !(await ask(`¿Activar el portafolio automático en ${a.login ?? "esta cuenta"}?\n\nEl EA abrirá y cerrará operaciones solo, con ${s.settings?.risk?.risk_pct}% de riesgo por operación.${!sim && !online ? "\n\nEl EA está desconectado: se aplicará al conectarse." : ""}`, "Activar"))) return;
    try { await api("/api/autotrade", "POST", { on }); } catch (e: any) { toast(e.message, "error"); }
  };
  const panic = async () => {
    if (!(await ask("¿Cerrar todas las posiciones de XAUUSD ahora?", "Cerrar todo", true))) return;
    try { await api("/api/close_all", "POST"); toast("Posiciones cerradas", "ok"); } catch (e: any) { toast(e.message, "error"); }
  };

  const alerts: { k: string; text: string }[] = [];
  if (loaded && r.blocked) alerts.push({ k: "block", text: `Cuenta bloqueada: ${r.blocked}` });
  if (loaded && s.market?.discipline?.why) alerts.push({ k: "dp", text: `Disciplina · ${s.market.discipline.why}${s.market.discipline.until ? ` · hasta ${hhmm(s.market.discipline.until - off)}` : ""}` });
  if (loaded && s.market?.news) alerts.push({ k: "news", text: `Pausa por noticia · ${s.market.news.title} · hasta ${hhmm(s.market.news.until)}` });
  if (loaded && !sim && s.accountInfo && !online) alerts.push({ k: "ea", text: `EA desconectado (${agoTxt(s.ea?.last_seen)}). Abre MT5 con el EA para operar.` });

  return (
    <header className="top">
      <div className="top-row">
        <div className="brand"><Logo /><span className="brand-t">XAU <b>Portfolio</b></span>{sim ? <span className="tag gold">Simulador</span> : null}</div>
        <button className="acct" onClick={() => ui.setAccountOpen(true)} title="Cambiar de cuenta" aria-label="Cuentas">
          <span className={`dot ${online ? "ok" : loaded ? "" : "wait"}`} title={online ? "EA conectado" : "EA desconectado"} />
          <span className="acct-t">
            <span className="acct-n">{sim ? "Cuenta de demostración" : s.accountInfo ? s.accountInfo.name : "Elegir cuenta"}</span>
            {!sim && a.login ? <span className="acct-s">{a.login} · {online ? "EA conectado" : "EA desconectado"}</span> : null}
          </span>
          <Icon name="chevron" size={14} />
        </button>

        {loaded && t ? (
          <div className="quote" aria-label="Precio XAU/USD">
            <span className="quote-s">XAU/USD</span>
            <span className={`quote-p ${chg == null ? "" : chg >= 0 ? "up" : "down"}`}>{fmt(t.bid)}</span>
            {chg != null ? <span className={`quote-c ${chg >= 0 ? "buy" : "sell"}`}>{chg >= 0 ? "▲" : "▼"} {fmt(Math.abs(chg))}<span className="quote-pc"> · {fmt(Math.abs(chg / dayOpen) * 100)}%</span></span> : null}
            <span className="quote-sp">spread {fmt(t.ask - t.bid)}</span>
          </div>
        ) : null}

        <div className="spacer" />

        {loaded && a.balance != null ? (
          <div className="kpis">
            <div className="kpi"><span>Balance</span><b>{fmt(a.balance)}</b></div>
            <div className="kpi"><span>Equity</span><b>{fmt(a.equity)}</b></div>
            <div className="kpi"><span>Flotante</span><b className={pnl >= 0 ? "buy" : "sell"}>{pnl >= 0 ? "+" : ""}{fmt(pnl)}</b></div>
          </div>
        ) : null}
        {loaded && r.funding ? (
          <div className="meters">
            <Meter label="DD día" used={r.daily_dd_pct ?? 0} limit={f.daily_loss_pct ?? 3} />
            <Meter label="DD máx" used={r.max_dd_pct ?? 0} limit={f.max_loss_pct ?? 10} />
            {target ? <Meter label="Objetivo" used={Math.max(0, r.progress_pct ?? 0)} limit={target} goal /> : null}
          </div>
        ) : null}

        <div className="top-actions">
          {onExitSim ? <button className="btn sm primary" onClick={onExitSim}>Entrar<span className="hide-s"> con mi cuenta</span></button> : null}
          {loaded && canTrade ? (
            <>
              <label className={`auto ${autotrade ? "on" : ""}`} title="El EA opera solo con las 5 estrategias del portafolio">
                <Toggle on={autotrade} onChange={setAuto} label="Automático" />
                <span className="auto-t">{autotrade ? "Automático ON" : "Automático OFF"}</span>
                {s.settings?.pending?.includes("autotrade") ? <span className="pending" title="El EA aún no lo ha aplicado">pendiente</span> : null}
              </label>
              <button className="btn danger sm close-all" onClick={panic} disabled={!sim && !online} title="Cierra todas las posiciones de XAUUSD">Cerrar todo</button>
            </>
          ) : null}
        </div>
      </div>
      {alerts.length ? <div className="alerts">{alerts.map((x) => <span key={x.k} className={`alert ${x.k}`}>{x.text}</span>)}</div> : null}
    </header>
  );
}
