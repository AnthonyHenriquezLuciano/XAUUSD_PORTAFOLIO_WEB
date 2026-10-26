import React, { useState } from "react";
import AccountDialog from "./components/AccountDialog";
import Chart from "./components/Chart";
import Header from "./components/Header";
import { Icon } from "./icons";
import Journal from "./panels/Journal";
import Settings from "./panels/Settings";
import Signals from "./panels/Signals";
import FlowStudio from "./panels/FlowStudio";
import RealSessions from "./panels/RealSessions";
import Stats from "./panels/Stats";
import Strategies from "./panels/Strategies";
import Trade from "./panels/Trade";
import CommandCenter from "./panels/CommandCenter";
import ExecutionSafety from "./panels/ExecutionSafety";
import PortfolioCockpit from "./panels/PortfolioCockpit";
import ResearchConsole from "./panels/ResearchConsole";
import PremiumLab from "./panels/PremiumLab";
import { useSmartAlerts } from "./premium/useSmartAlerts";
import "./premium.css";
import "./flow/flow.css";
import "./design-system.css";
import "./navigation.css";
import "./workspace.css";
import "./dashboard.css";
import { tstr, useApp } from "./store";
import { useUI } from "./uiState";

type NavItem = { key: string; label: string; icon: string };
const NAV_GROUPS: { id: string; name: string; items: NavItem[] }[] = [
  { id: "principal", name: "PRINCIPAL", items: [{ key: "centro", label: "Vista general", icon: "home" }] },
  { id: "operativa", name: "OPERATIVA", items: [
    { key: "operar", label: "Trading", icon: "trade" },
    { key: "mercado", label: "Mercado", icon: "market" },
    { key: "flujo", label: "Order Flow", icon: "flow" },
    { key: "sesiones", label: "Sesiones", icon: "clock" },
  ] },
  { id: "investigacion", name: "INVESTIGACIÓN", items: [
    { key: "estrategias", label: "Estrategias", icon: "strategies" },
    { key: "lab", label: "Laboratorio", icon: "lab" },
    { key: "stats", label: "Estadísticas", icon: "stats" },
    { key: "diario", label: "Diario", icon: "journal" },
    { key: "ciencia", label: "Ciencia", icon: "science" },
  ] },
  { id: "gestion", name: "GESTIÓN", items: [
    { key: "portafolio", label: "Portafolio", icon: "portfolio" },
    { key: "seguridad", label: "Seguridad", icon: "shield-check" },
    { key: "ajustes", label: "Ajustes", icon: "settings" },
  ] },
];
const NAV = NAV_GROUPS.flatMap(group => group.items);
const QUICK_NAV = ["centro", "operar", "mercado", "flujo"];
const CHART_VIEWS = new Set(["operar", "mercado", "flujo"]);

export default function App({ signedIn, onExitSim }: { signedIn: boolean; onExitSim?: () => void }) {
  const { s, toasts } = useApp();
  const ui = useUI();
  const alerts = useSmartAlerts(s);
  const [logOpen, setLogOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const view = NAV.some(x => x.key === ui.tab) ? ui.tab : "operar";
  const withChart = CHART_VIEWS.has(view);
  const page = { centro: <CommandCenter alerts={alerts} />, sesiones: <RealSessions />, lab: <PremiumLab />, seguridad: <ExecutionSafety />, ciencia: <ResearchConsole />, portafolio: <PortfolioCockpit />, diario: <Journal />, stats: <Stats />, estrategias: <Strategies />, ajustes: <Settings /> }[view as "centro" | "sesiones" | "lab" | "seguridad" | "ciencia" | "portafolio" | "diario" | "stats" | "estrategias" | "ajustes"];
  return (
    <div className={`app ${withChart ? "v-chart" : "v-page"}`}>
      <Header onExitSim={onExitSim} />
      <nav className="rail" aria-label="Navegación principal">
        <div className="rail-groups">
          {NAV_GROUPS.map(group => (
            <div className="rail-group" key={group.id} aria-label={group.name}>
              <span className="rail-group-title">{group.name}</span>
              {group.items.map(({key,label,icon}) => (
                <button key={key} className={`rail-btn ${view === key ? "on" : ""}`}
                  aria-current={view === key ? "page" : undefined} aria-label={label} title={label}
                  onClick={() => { ui.setTab(key); setMoreOpen(false); }}>
                  <span className="rail-ic"><Icon name={icon} size={19} />{key==="operar" && s.positions.length ? <b className="badge">{s.positions.length}</b> : null}</span>
                  <span className="rail-t">{label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="rail-mobile">
          {NAV.filter(x => QUICK_NAV.includes(x.key)).map(({key,label,icon}) => (
            <button key={key} className={`rail-btn ${view===key?"on":""}`} aria-current={view===key?"page":undefined} aria-label={label}
              onClick={() => { ui.setTab(key); setMoreOpen(false); }}>
              <span className="rail-ic"><Icon name={icon} size={20} /></span><span className="rail-t">{label}</span>
            </button>
          ))}
          <button className={`rail-btn ${moreOpen||!QUICK_NAV.includes(view)?"on":""}`} aria-label="Más secciones"
            aria-controls="mobile-navigation" aria-expanded={moreOpen} onClick={()=>setMoreOpen(v=>!v)}>
            <span className="rail-ic"><Icon name={moreOpen?"close":"menu"} size={20} /></span><span className="rail-t">Más</span>
          </button>
        </div>
        {moreOpen && <div className="rail-overflow" id="mobile-navigation">
          <div className="rail-overflow-header"><strong>Explorar secciones</strong><button aria-label="Cerrar menú" className="btn sm" onClick={()=>setMoreOpen(false)}>Cerrar</button></div>
          {NAV_GROUPS.map(group=><div className="rail-overflow-group" key={group.id}>
            <span>{group.name}</span>
            <div>{group.items.map(item=><button key={item.key} className={view===item.key?"on":""}
              aria-current={view===item.key?"page":undefined} onClick={()=>{ui.setTab(item.key);setMoreOpen(false);}}>
              <Icon name={item.icon} size={17}/>{item.label}</button>)}</div>
          </div>)}
        </div>}
      </nav>
      {withChart ? (
        <main className="work">
          <Chart />
          <aside className="side" aria-label={view === "operar" ? "Operar" : view === "flujo" ? "Flujo" : "Mercado"}>
            {view === "operar" ? <Trade /> : view === "flujo" ? <FlowStudio /> : <Signals />}
          </aside>
        </main>
      ) : (
        <main className="page"><div className="page-in">{page}</div></main>
      )}
      <footer className="log">
        <button className="log-head" onClick={() => setLogOpen(!logOpen)} aria-expanded={logOpen}>
          <span className={`dot ${s.ea?.online ? "ok" : ""}`} title={s.ea?.online ? "EA conectado" : "EA sin conexión"} />
          <span className="grow log-last">{s.events[0] ? s.events[0].msg : "Sin actividad"}</span>
          <span className="log-tg">Registro <Icon name="chevron" size={14} className={logOpen ? "flip" : ""} /></span>
        </button>
        {logOpen ? <div className="log-body">{s.events.map((e, i) => <div key={i} className={e.level}><span className="dim">{tstr(e.t)}</span> {e.msg}</div>)}</div> : null}
      </footer>
      <AccountDialog signedIn={signedIn} />
      <div className="toasts" role="status" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}</div>
    </div>
  );
}
