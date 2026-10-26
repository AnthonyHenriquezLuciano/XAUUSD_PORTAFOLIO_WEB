import React, { useState } from "react";
import AccountDialog from "./components/AccountDialog";
import Chart from "./components/Chart";
import Header from "./components/Header";
import Journal from "./panels/Journal";
import Positions from "./panels/Positions";
import Settings from "./panels/Settings";
import Signals from "./panels/Signals";
import Strategies from "./panels/Strategies";
import Trade from "./panels/Trade";
import { tstr, useApp } from "./store";
import { useUI } from "./uiState";

const TABS: [string, string][] = [["operar", "Operar"], ["senales", "Señales"], ["posiciones", "Posiciones"], ["diario", "Diario"], ["estrategias", "Estrategias"], ["ajustes", "Ajustes"]];

export default function App({ signedIn, onExitSim }: { signedIn: boolean; onExitSim?: () => void }) {
  const { s, toasts } = useApp();
  const ui = useUI();
  const [logOpen, setLogOpen] = useState(false);
  const panel = { operar: <Trade />, senales: <Signals />, posiciones: <Positions />, diario: <Journal />, estrategias: <Strategies />, ajustes: <Settings /> }[ui.tab];
  return (
    <div className="app">
      <Header onExitSim={onExitSim} />
      <div className="main">
        <Chart />
        <div className="side">
          <div className="tabs">
            {TABS.map(([k, l]) => (
              <button key={k} className={`tab ${ui.tab === k ? "on" : ""}`} onClick={() => ui.setTab(k)}>
                {l}{k === "posiciones" && s.positions.length ? ` (${s.positions.length})` : ""}
              </button>
            ))}
          </div>
          <div className="panel">{panel}</div>
        </div>
      </div>
      <div className="log">
        <div className="head" onClick={() => setLogOpen(!logOpen)}>
          <span className={`dot ${s.ea?.online ? "ok" : ""}`} title={s.ea?.online ? "EA conectado" : "EA sin conexión"} />
          <span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.events[0] ? s.events[0].msg : "Registro de actividad"}</span>
          <span>{logOpen ? "▾" : "▸"} Registro</span>
        </div>
        {logOpen ? <div className="body">{s.events.map((e, i) => <div key={i} className={e.level}>{tstr(e.t)}  {e.msg}</div>)}</div> : null}
      </div>
      <AccountDialog signedIn={signedIn} />
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}</div>
    </div>
  );
}
