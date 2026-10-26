import React, { useState } from "react";
import AccountDialog from "./components/AccountDialog";
import Chart from "./components/Chart";
import Header from "./components/Header";
import { Icon } from "./icons";
import Journal from "./panels/Journal";
import Settings from "./panels/Settings";
import Signals from "./panels/Signals";
import Stats from "./panels/Stats";
import Strategies from "./panels/Strategies";
import Trade from "./panels/Trade";
import CommandCenter from "./panels/CommandCenter";
import PremiumLab from "./panels/PremiumLab";
import { useSmartAlerts } from "./premium/useSmartAlerts";
import "./premium.css";
import { tstr, useApp } from "./store";
import { useUI } from "./uiState";

const NAV: [string, string, string][] = [
  ["centro", "Centro", "home"],
  ["operar", "Operar", "trade"],
  ["mercado", "Mercado", "market"],
  ["diario", "Diario", "journal"],
  ["stats", "Estadísticas", "stats"],
  ["estrategias", "Estrategias", "strategies"],
  ["lab", "Lab", "lab"],
  ["ajustes", "Ajustes", "settings"],
];
const CHART_VIEWS = new Set(["operar", "mercado"]);

export default function App({ signedIn, onExitSim }: { signedIn: boolean; onExitSim?: () => void }) {
  const { s, toasts } = useApp();
  const ui = useUI();
  const alerts = useSmartAlerts(s);
  const [logOpen, setLogOpen] = useState(false);
  const view = NAV.some(([k]) => k === ui.tab) ? ui.tab : "operar";
  const withChart = CHART_VIEWS.has(view);
  const page = { centro: <CommandCenter alerts={alerts} />, lab: <PremiumLab />, diario: <Journal />, stats: <Stats />, estrategias: <Strategies />, ajustes: <Settings /> }[view as "centro" | "lab" | "diario" | "stats" | "estrategias" | "ajustes"];
  return (
    <div className={`app ${withChart ? "v-chart" : "v-page"}`}>
      <Header onExitSim={onExitSim} />
      <nav className="rail" aria-label="Secciones">
        {NAV.map(([k, label, icon]) => (
          <button key={k} className={`rail-btn ${view === k ? "on" : ""}`} aria-current={view === k ? "page" : undefined} aria-label={label} title={label} onClick={() => ui.setTab(k)}>
            <span className="rail-ic"><Icon name={icon} size={20} />{k === "operar" && s.positions.length ? <b className="badge">{s.positions.length}</b> : null}</span>
            <span className="rail-t">{label}</span>
          </button>
        ))}
      </nav>
      {withChart ? (
        <main className="work">
          <Chart />
          <aside className="side" aria-label={view === "operar" ? "Operar" : "Mercado"}>
            {view === "operar" ? <Trade /> : <Signals />}
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
