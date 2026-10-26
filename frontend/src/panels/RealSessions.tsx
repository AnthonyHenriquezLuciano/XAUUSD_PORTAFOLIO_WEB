import React, { useEffect, useMemo, useState } from "react";
import { useApp } from "../store";
import { useUI } from "../uiState";
import { SESSIONS, countdown, formatSessionTime, sessionStatus, sessionWindows, type DisplayZone } from "../sessions/marketSessions";

const ZONES: { value: DisplayZone; label: string }[] = [
  { value: "rd", label: "República Dominicana (UTC−4)" },
  { value: "utc", label: "UTC" },
  { value: "broker", label: "Servidor MT5 (estimado)" }
];
const zoneKey = "xauai.sessions.zone";
const getZone = (): DisplayZone => {
  try {
    const saved = localStorage.getItem(zoneKey);
    return saved === "broker" || saved === "utc" ? saved : "rd";
  } catch { return "rd"; }
};

export default function RealSessions() {
  const { s } = useApp();
  const ui = useUI();
  const [now, setNow] = useState(() => Date.now());
  const [zone, setZone] = useState<DisplayZone>(getZone);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const brokerOffset = s.broker === "cloud" && s.news_offset != null ? Number(s.news_offset) : null;
  const selectedZone = zone === "broker" && brokerOffset == null ? "rd" : zone;
  const status = useMemo(() => sessionStatus(now), [Math.floor(now / 60000)]);
  const active = status.filter(x => x.active);
  const next = status.filter(x => !x.active && x.window).sort((a, b) => (a.window?.openUtcMs || 0) - (b.window?.openUtcMs || 0))[0];
  const fmt = (ms: number, date = false) => formatSessionTime(ms, selectedZone, brokerOffset, date);
  const hasBrokerTime = brokerOffset != null && Number.isFinite(brokerOffset) && Math.abs(brokerOffset) <= 15 * 3600;

  const horizon = useMemo(() => sessionWindows(now, now + 24 * 3600000), [Math.floor(now / 60000)]);
  const changeZone = (value: DisplayZone) => {
    setZone(value);
    try { localStorage.setItem(zoneKey, value); } catch { /* modo privado */ }
  };

  return <div className="premium-center sessions-page">
    <div className="premium-hero">
      <div>
        <div className="premium-eyebrow">CALENDARIO DE MERCADO / SESIONES</div>
        <h1>Sesiones del mercado</h1>
        <p>Los horarios de los centros financieros, separados de las ventanas del EA.</p>
      </div>
      <div className="premium-actions">
        <button className="btn sm primary" onClick={() => ui.setTab("mercado")}>Ver gráfico XAUUSD</button>
      </div>
    </div>
    <div className="sessions-settings">
      <label>Mostrar horarios en
        <select value={selectedZone} onChange={e => changeZone(e.target.value as DisplayZone)} aria-label="Zona horaria de sesiones">
          {ZONES.map(z => <option key={z.value} value={z.value} disabled={z.value === "broker" && !hasBrokerTime}>{z.label}</option>)}
        </select>
      </label>
      <label className="sessions-switch">
        <input type="checkbox" checked={ui.layers.sesionesReales !== false}
          onChange={e => ui.setLayer("sesionesReales", e.target.checked)} />
        Mostrar sesiones reales en el gráfico
      </label>
      <div className="sessions-status-line">
        <span className={active.length ? "buy" : "dim"}>{active.length ? "● " + active.length + " sesión(es) activa(s)" : "○ Ninguna sesión de referencia activa"}</span>
        {active.length >= 2 && <span className="sessions-overlap">Solapamiento: {active.map(x => x.spec.name.split(" · ")[0]).join(" + ")}</span>}
      </div>
    </div>
    <div className="sessions-grid">
      {status.map(item => {
        const spec = item.spec;
        const w = item.window;
        const nextLabel = item.active ? "Cierra en" : "Abre en";
        return <section className={"session-card " + (item.active ? "is-active" : "")}
          key={spec.id} style={{ borderTopColor: spec.color }}>
          <div className="session-card-top">
            <span className="session-mark" style={{ color: spec.color }}>◈</span>
            <span className={"session-chip " + (item.active ? "is-active" : "")}>{item.active ? "EN SESIÓN" : "FUERA DE SESIÓN"}</span>
          </div>
          <h2>{spec.name}</h2>
          <p>{spec.description}</p>
          <div className="session-hours">
            <div><span>Horario local de referencia</span><strong>{String(spec.opens).padStart(2, "0")}:00 — {String(spec.closes).padStart(2, "0")}:00</strong></div>
            <div><span>{item.active ? "Apertura de hoy" : "Próxima apertura"}</span><strong>{w ? fmt(w.openUtcMs, true) : "—"}</strong></div>
            <div><span>{item.active ? "Cierre de hoy" : "Próximo cierre"}</span><strong>{w ? fmt(w.closeUtcMs, true) : "—"}</strong></div>
          </div>
          <div className="session-countdown">
            <span>{nextLabel}</span>
            <strong>{countdown(item.nextChangeMs, now)}</strong>
          </div>
          <div className="session-card-foot"><span>{spec.cityZone}</span><span>{selectedZone === "broker" ? "MT5 estimado" : selectedZone === "rd" ? "Hora RD" : "UTC"}</span></div>
        </section>;
      })}
    </div>
    <section className="session-section">
      <div className="session-section-head">
        <div><h2>Actividad de las próximas 24 horas</h2><p>Ventanas de referencia, incluyendo los solapamientos y cambios horarios.</p></div>
        <span>{next ? "Siguiente: " + next.spec.name + " en " + countdown(next.nextChangeMs, now) : active.length ? "Sesiones activas" : "Fin de semana"}</span>
      </div>
      <div className="session-timeline">
        <div className="session-axis">
          {[0, 6, 12, 18, 24].map(h => <span key={h}>{h === 24 ? "+24h" : h === 0 ? "Ahora" : "+" + h + "h"}</span>)}
        </div>
        {SESSIONS.map(spec => <div key={spec.id} className="session-lane">
          <b>{spec.name}</b><div className="session-lane-track">
            {[6, 12, 18].map(h => <i className="session-guide" style={{ left: (h / 24 * 100) + "%" }} key={h} />)}
            {horizon.filter(x => x.id === spec.id).map((w, i) => {
              const start = Math.max(0, (w.openUtcMs - now) / 86400000 * 100);
              const end = Math.min(100, (w.closeUtcMs - now) / 86400000 * 100);
              return end > start ? <div key={i} className="session-interval"
                style={{ left: start + "%", width: (end - start) + "%", backgroundColor: spec.color }}
                title={fmt(w.openUtcMs, true) + " — " + fmt(w.closeUtcMs, true)} /> : null;
            })}
          </div></div>)}
      </div>
    </section>
    <section className="session-section session-guidance">
      <h2>Sesiones reales vs. rangos de estrategias</h2>
      <div className="sessions-comparison">
        <div><b>Sesiones reales</b><p>Tokio, Londres y Nueva York calculadas por ciudad con horario de verano automático. Son franjas convencionales del mercado Forex, no señales para comprar o vender.</p></div>
        <div><b>Rangos del EA</b><p>Asia ALB (01:05–09:00), TOK (03:00–03:30) y AORB (03:30–04:30) permanecen tal cual; sus horas son del reloj normalizado que utiliza el EA.</p></div>
      </div>
      <p className="premium-note">Los horarios del mercado Forex son orientativos: el oro CFD puede tener pausas diarias, diferencias de liquidez, festividades y horarios específicos según tu bróker. Que una sesión aparezca activa no confirma que MT5 permita operar. La vista del servidor utiliza el desplazamiento inferido de la sincronización y no cambia el reloj del EA.</p>
      {!hasBrokerTime && <p className="premium-note">Conecta una cuenta real con el puente MT5 para habilitar la conversión estimada al horario del bróker y dibujar las bandas sobre sus velas.</p>}
    </section>
  </div>;
}
