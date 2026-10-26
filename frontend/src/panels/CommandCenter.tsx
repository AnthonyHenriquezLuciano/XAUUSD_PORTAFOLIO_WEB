import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { supabase } from "../lib/supabase";
import { fmt, useApp } from "../store";
import { useUI } from "../uiState";
import { riskSnapshot } from "../premium/risk";
import type { SmartAlerts } from "../premium/useSmartAlerts";

type ModuleKey = "mission" | "radar" | "timeline" | "assistant" | "accounts" | "decisions" | "autopilot" | "events";
type AccountRow = { id: string; name: string; login: number | null; server: string | null; equity: number | null; updated_at: string | null };
const MODULES: { id: ModuleKey; title: string; desc: string }[] = [
  { id: "mission", title: "Funding Mission Control", desc: "Objetivo y límites" },
  { id: "radar", title: "Portfolio Risk Radar", desc: "Riesgo hasta los stops" },
  { id: "timeline", title: "Strategy Timeline", desc: "Agenda de estrategias" },
  { id: "assistant", title: "AI Decision Assistant", desc: "Lectura de escenarios" },
  { id: "accounts", title: "Multi-Account Cockpit", desc: "Cuentas conectadas" },
  { id: "decisions", title: "¿Por qué no operó el EA?", desc: "Estado y bloqueos" },
  { id: "autopilot", title: "Autopiloto supervisado", desc: "Modo de ejecución" },
  { id: "events", title: "Actividad y notificaciones", desc: "Alertas y registro" }
];
const TIME: Record<string, string> = { R50: "01:05", TOK: "03:30", AORB: "04:30", ALB: "09:00", LM: "09:30" };
const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* private mode */ } };
const usd = (v: number | null | undefined) => v == null || !Number.isFinite(v) ? "—" : "$" + fmt(v);
const Percent = ({ value, danger = false }: { value: number; danger?: boolean }) => (
  <div className="premium-meter"><div style={{ width: Math.max(0, Math.min(100, value)) + "%", background: danger ? "var(--sell)" : "var(--gold)" }} /></div>
);

export default function CommandCenter({ alerts }: { alerts: SmartAlerts }) {
  const { s, toast, ask } = useApp();
  const ui = useUI();
  const [edit, setEdit] = useState(false);
  const [compact, setCompact] = useState(false);
  const [order, setOrder] = useState<ModuleKey[]>(MODULES.map(x => x.id));
  const [hidden, setHidden] = useState<ModuleKey[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [autoBusy, setAutoBusy] = useState(false);
  const scope = s.me || "guest";
  const account = s.accountInfo?.id || "demo";
  const prefKey = "xauai.premium." + scope + "." + account;
  const risk = riskSnapshot(s);
  const settings = s.settings || {};
  const a = s.account || {}, r = s.risk || {};
  const target = Number(r.target_pct ?? settings.funding?.target_pct ?? 0);
  const progress = risk.init > 0 ? (risk.equity / risk.init - 1) * 100 : 0;
  const dailyUsed = Number(r.daily_dd_pct ?? 0);
  const maxUsed = Number(r.max_dd_pct ?? 0);
  const strategyNames = s.strategies || [];
  const arr = useMemo(() => order.filter(x => !hidden.includes(x)), [order, hidden]);

  useEffect(() => {
    const v = read(prefKey);
    if (!v) { setOrder(MODULES.map(x => x.id)); setHidden([]); setCompact(false); return; }
    try {
      const prefs = JSON.parse(v);
      const valid = (x: unknown): x is ModuleKey => typeof x === "string" && MODULES.some(m => m.id === x);
      const o = Array.isArray(prefs.order) ? prefs.order.filter(valid) : [];
      setOrder([...new Set<ModuleKey>(o), ...MODULES.map(x => x.id).filter(x => !o.includes(x))]);
      setHidden(Array.isArray(prefs.hidden) ? prefs.hidden.filter(valid) : []);
      setCompact(!!prefs.compact);
    } catch { setOrder(MODULES.map(x => x.id)); setHidden([]); setCompact(false); }
  }, [prefKey]);
  const persist = (o: ModuleKey[], h: ModuleKey[], c = compact) => write(prefKey, JSON.stringify({ order: o, hidden: h, compact: c }));
  const move = (id: ModuleKey, delta: number) => {
    const i = order.indexOf(id), j = i + delta;
    if (j < 0 || j >= order.length) return;
    const o = [...order]; [o[i], o[j]] = [o[j], o[i]]; setOrder(o); persist(o, hidden);
  };
  const toggle = (id: ModuleKey) => {
    const h = hidden.includes(id) ? hidden.filter(k => k !== id) : [...hidden, id];
    setHidden(h); persist(order, h);
  };

  useEffect(() => {
    if (s.broker !== "cloud" || !s.me) { setAccounts([]); return; }
    let active = true;
    const load = async () => {
      setLoading(true);
      const [ac, live] = await Promise.all([
        supabase.from("accounts").select("id,name,login,server").order("name"),
        supabase.from("live").select("account_id,updated_at,equity")
      ]);
      if (!active) return;
      setLoading(false);
      if (ac.error || live.error) { setAccountError(ac.error?.message || live.error?.message || "Error de cuentas"); return; }
      setAccountError("");
      const states = new Map<string, any>((live.data || []).map((x: any): [string, any] => [x.account_id, x]));
      setAccounts((ac.data || []).map((x: any) => ({ ...x, equity: states.get(x.id)?.equity ?? null, updated_at: states.get(x.id)?.updated_at ?? null })));
    };
    void load();
    const interval = setInterval(() => { void load(); }, 30000);
    return () => { active = false; clearInterval(interval); };
  }, [s.broker, s.me]);

  const activeReasons = [
    r.blocked ? "Guardia de riesgo: " + r.blocked : "",
    s.market?.discipline?.why ? "Disciplina: " + s.market.discipline.why : "",
    s.market?.news?.title ? "Noticias: " + s.market.news.title : "",
    s.broker === "cloud" && !s.ea?.online ? "Puente MT5 sin conexión" : "",
    !settings.autotrade ? "Operativa automática desactivada" : ""
  ].filter(Boolean);
  const recent = (s.events || []).slice(0, 6);
  const activeStrategies = (s.signals?.strategies || []).filter((x: any) => x.enabled);

  const setAuto = async (on: boolean) => {
    if (s.broker === "cloud" && s.role !== "owner" && s.role !== "trader") return;
    if (on && !(await ask("¿Activar el EA automático con el riesgo global configurado? Las protecciones de MT5 seguirán siendo obligatorias.", "Activar"))) return;
    setAutoBusy(true);
    try { await api("/api/autotrade", "POST", { on }); toast(on ? "Solicitud de activación enviada al EA" : "Solicitud de pausa de entradas enviada", "ok"); }
    catch (e: any) { toast(e.message || "No se pudo cambiar la modalidad", "error"); }
    finally { setAutoBusy(false); }
  };

  const body = (id: ModuleKey) => {
    switch (id) {
      case "mission": return (
        <>
          <div className="premium-kpis">
            <div><span>Equity</span><strong>{usd(risk.equity)}</strong></div>
            <div><span>Objetivo</span><strong>{target > 0 ? target.toFixed(1) + "%" : "Fondeada"}</strong></div>
            <div><span>Progreso desde inicio</span><strong className={progress >= 0 ? "buy" : "sell"}>{progress >= 0 ? "+" : ""}{fmt(progress)}%</strong></div>
          </div>
          {target > 0 && <><div className="premium-row"><span>Progreso hacia objetivo</span><b>{fmt(progress)} / {fmt(target)}%</b></div><Percent value={progress / target * 100} /></>}
          <div className="premium-row"><span>DD diario</span><b>{fmt(dailyUsed)} / {fmt(risk.dailyLossPct)}%</b></div>
          <Percent value={dailyUsed / (risk.dailyLossPct || 1) * 100} danger={dailyUsed / (risk.dailyLossPct || 1) > .7} />
          <div className="premium-row"><span>DD total</span><b>{fmt(maxUsed)} / {fmt(risk.maxLossPct)}%</b></div>
          <Percent value={maxUsed / (risk.maxLossPct || 1) * 100} danger={maxUsed / (risk.maxLossPct || 1) > .7} />
          <div className="premium-row"><span>Margen restante hasta guardas</span><b>{usd(risk.budget)}</b></div>
          <p className="premium-note">Los límites visibles provienen de la configuración de la cuenta; comprueba las reglas vigentes del proveedor.</p>
        </>
      );
      case "radar": return (
        <>
          <div className="premium-kpis">
            <div><span>Stop agregado*</span><strong className="sell">{usd(risk.exposure.atStop)}</strong></div>
            <div><span>Lotes abiertos</span><strong>{fmt(risk.exposure.grossLots)}</strong></div>
            <div><span>Lotes pendientes</span><strong>{fmt(risk.pendingLots)}</strong></div>
          </div>
          <div className="premium-row"><span>Compras / ventas</span><b>{fmt(risk.exposure.buyLots)} / {fmt(risk.exposure.sellLots)}</b></div>
          <div className="premium-row"><span>Margen tras stops estimados</span><b className={risk.headroomAfterStops != null && risk.headroomAfterStops < 0 ? "sell" : ""}>{usd(risk.headroomAfterStops)}</b></div>
          {!!risk.exposure.withoutStop && <div className="premium-warn">{risk.exposure.withoutStop} posición(es) sin SL: riesgo no acotado.</div>}
          {!!risk.exposure.invalidStops && <div className="premium-warn">{risk.exposure.invalidStops} stops requieren revisión.</div>}
          <p className="premium-note">*Estimación desde los precios actuales hasta los SL, sin gaps, slippage, swaps ni riesgo de órdenes pendientes. El EA decide el riesgo efectivo.</p>
          <button className="btn sm" onClick={() => ui.setTab("operar")}>Ver posiciones y ticket</button>
        </>
      );
      case "timeline": return (
        <>
          <p className="premium-note">Horarios nominales del portafolio según el servidor MT5, no hora de República Dominicana. Las órdenes pueden activarse después.</p>
          <div className="premium-time">
            {[...strategyNames].sort((x: any, y: any) => (TIME[x.name] || "99:99").localeCompare(TIME[y.name] || "99:99")).map((st: any) => (
              <div className="premium-time-row" key={st.name}>
                <b>{TIME[st.name] || "—"}</b><span>{st.name}</span>
                <small>{st.state || "Sin estado"}</small>
              </div>
            ))}
            {!strategyNames.length && <p className="premium-note">Sin estrategias sincronizadas.</p>}
          </div>
          <button className="btn sm" onClick={() => ui.setTab("estrategias")}>Ajustar estrategias</button>
        </>
      );
      case "assistant": return (
        <>
          <div className="premium-row"><span>Sesión</span><b>{s.signals?.session || "—"}</b></div>
          <div className="premium-row"><span>Régimen</span><b>{s.signals?.regime || "—"}</b></div>
          <div className="premium-row"><span>Volatilidad</span><b>{s.signals?.vol || "—"}</b></div>
          <div className="premium-row"><span>Sesgo histórico</span><b>{s.signals?.bias || "—"}</b></div>
          {activeStrategies.map((st: any) => (
            <div className="premium-row" key={st.name}><span>{st.name} · R histórico escenario</span><b className={st.scenario?.expR >= 0 ? "buy" : "sell"}>{st.scenario?.expR == null ? "Sin datos" : fmt(st.scenario.expR) + "R"}</b></div>
          ))}
          <p className="premium-note">Son asociaciones históricas, no una predicción fiable de dirección. La IA actual no valida por sí sola la ejecución de una orden.</p>
          <button className="btn sm" onClick={() => ui.setTab("mercado")}>Explorar señales y pronóstico</button>
        </>
      );
      case "accounts": return (
        <>
          {accountError && <div className="premium-warn">{accountError}</div>}
          {s.broker !== "cloud" ? <p className="premium-note">Inicia sesión y conecta cuentas reales para ver el consolidado.</p> :
          loading && !accounts.length ? <p className="premium-note">Cargando cuentas autorizadas…</p> :
          accounts.map(ac => {
            const on = !!ac.updated_at && Date.now() - Date.parse(ac.updated_at) < 15000;
            return <div className="premium-account" key={ac.id}>
              <div><b>{ac.name}</b><small>{ac.login || "Sin login"} · {ac.server || "Servidor desconocido"}</small></div>
              <div className="premium-account-right"><b>{usd(ac.equity)}</b><span className={on ? "buy" : "dim"}>{on ? "Conectada" : "No sincroniza"}</span></div>
            </div>;
          })}
          {s.broker === "cloud" && !loading && !accounts.length && !accountError && <p className="premium-note">No hay cuentas disponibles.</p>}
          <p className="premium-note">Equity de la última actualización. No suma riesgo de cuentas con distinto tamaño o reglas.</p>
          <button className="btn sm" onClick={() => ui.setAccountOpen(true)}>Gestionar cuentas</button>
        </>
      );
      case "decisions": return (
        <>
          {activeReasons.length ? activeReasons.map((reason, i) => <div className="premium-reason" key={i}>● {reason}</div>) :
          <div className="premium-good">Sin bloqueos generales comunicados.</div>}
          {strategyNames.map((st: any) => <div className="premium-row" key={st.name}><span>{st.name}</span><b>{st.state || "Sin estado"}</b></div>)}
          <p className="premium-note">Diagnóstico basado en bloqueos y estados existentes. Aún no incluye motivos exhaustivos de cada entrada descartada; eso requerirá telemetría por candidato desde el EA.</p>
        </>
      );
      case "autopilot": return (
        <>
          <div className="premium-kpis">
            <div><span>Modo actual</span><strong>{settings.autotrade ? "Automático" : "Asistido / Manual"}</strong></div>
            <div><span>EA</span><strong>{s.ea?.online ? "Online" : "Offline"}</strong></div>
          </div>
          <p className="premium-note">Modo asistido: señales y confirmación manual. Modo automático: entradas según las estrategias y guardas existentes. El análisis IA no sustituye las guardas.</p>
          <div className="premium-actions">
            <button className="btn sm" disabled={autoBusy || !settings.autotrade} onClick={() => void setAuto(false)}>Pausar nuevas entradas</button>
            <button className="btn sm primary" disabled={autoBusy || !!settings.autotrade || (s.broker === "cloud" && s.role !== "owner" && s.role !== "trader")} onClick={() => void setAuto(true)}>Activar automático</button>
          </div>
          <p className="premium-note">Desactivar no cierra posiciones abiertas. Confirma siempre el estado aplicado por MT5.</p>
        </>
      );
      case "events": return (
        <>
          <div className="premium-row"><span>Notificaciones de escritorio</span>
            <button className={alerts.enabled ? "btn sm on" : "btn sm"} disabled={!alerts.supported} onClick={() => void alerts.setEnabled(!alerts.enabled)}>{alerts.enabled ? "Activadas" : "Activar"}</button>
          </div>
          <p className="premium-note">Con la web abierta: avisa de desconexión, límites diarios al 75% y bloqueos. Requiere permiso del navegador. No son notificaciones push con la web cerrada.</p>
          {recent.map((ev, idx) => <div className="premium-event" key={String(ev.t) + "-" + idx}><span className={ev.level === "error" ? "sell" : ev.level === "warn" ? "gold" : "dim"}>{ev.level}</span><span>{ev.msg}</span></div>)}
          {!recent.length && <p className="premium-note">Sin actividad reciente.</p>}
        </>
      );
    }
  };

  return (
    <div className={"premium-center" + (compact ? " compact" : "")}>
      <div className="premium-hero">
        <div>
          <div className="premium-eyebrow">XAU PORTFOLIO · OBSIDIAN GOLD</div>
          <h1>Centro de comando</h1>
          <p>Tu operación, tu portafolio y tu protección, en un solo espacio.</p>
        </div>
        <div className="premium-actions">
          <button className="btn sm" onClick={() => { const v = !compact; setCompact(v); persist(order, hidden, v); }}>{compact ? "Vista amplia" : "Vista compacta"}</button>
          <button className="btn sm" onClick={() => setEdit(!edit)}>{edit ? "Terminar personalización" : "Personalizar"}</button>
          <button className="btn sm primary" onClick={() => ui.setTab("operar")}>Abrir terminal</button>
        </div>
      </div>
      {edit && <div className="premium-config">
        <b>Personaliza tus módulos</b><span>Oculta, muestra o reordena. Se guarda para esta cuenta en este dispositivo.</span>
        <div className="premium-options">{order.map((id, i) => {
          const x = MODULES.find(m => m.id === id)!;
          return <div key={id}><label><input type="checkbox" checked={!hidden.includes(id)} onChange={() => toggle(id)} />{x.title}</label>
            <button disabled={!i} onClick={() => move(id, -1)} aria-label={"Subir " + x.title}>↑</button>
            <button disabled={i === order.length - 1} onClick={() => move(id, 1)} aria-label={"Bajar " + x.title}>↓</button>
          </div>;
        })}</div>
      </div>}
      <div className="premium-overview">
        <div><span>Cuenta activa</span><b>{s.accountInfo?.name || "Simulación"}</b></div>
        <div><span>Precio XAUUSD</span><b>{usd(s.tick?.bid)}</b></div>
        <div><span>Balance</span><b>{usd(a.balance)}</b></div>
        <div><span>Flotante</span><b className={Number(a.equity || 0) >= Number(a.balance || 0) ? "buy" : "sell"}>{usd(Number(a.equity || 0) - Number(a.balance || 0))}</b></div>
      </div>
      <div className="premium-grid">
        {arr.map(id => {
          const mod = MODULES.find(x => x.id === id)!;
          return <section key={id} className="premium-module" aria-label={mod.title}>
            <div className="premium-module-head"><div><h2>{mod.title}</h2><small>{mod.desc}</small></div><span className="premium-spark" aria-hidden="true">✧</span></div>
            <div className="premium-module-body">{body(id)}</div>
          </section>;
        })}
      </div>
      {!arr.length && <div className="premium-config">No hay módulos visibles. Pulsa Personalizar para volver a mostrarlos.</div>}
    </div>
  );
}
