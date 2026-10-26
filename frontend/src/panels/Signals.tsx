import React from "react";
import { api } from "../api";
import { fmt, pct, tstr, useApp } from "../store";
import { useUI } from "../uiState";
import { Card } from "../ui";

const REG: Record<string, [string, string]> = { alcista: ["Tendencia alcista", "up"], bajista: ["Tendencia bajista", "down"], rango: ["Rango", "gold"], transicion: ["Transición", ""] };
const VOL: Record<string, string> = { baja: "Volatilidad baja", normal: "Volatilidad normal", alta: "Volatilidad alta", extrema: "Volatilidad extrema" };

export default function Signals() {
  const { s } = useApp();
  const ui = useUI();
  const g = s.signals || {};
  if (!g.ok) return <div className="hint">{s.status === "conectado" ? "Calculando señales…" : "Conecta una cuenta para ver las señales."}</div>;
  const fc = g.forecast;
  const metrics = fc?.metrics || {};
  return (
    <div className="col">
      <Card title="Escenario actual" right={<span className="small muted">{g.hour} · {g.session}</span>}>
        <div className="row wrap" style={{ marginBottom: 8 }}>
          <span className={`chip ${REG[g.regime]?.[1]}`}>{REG[g.regime]?.[0]}</span>
          <span className="chip">{VOL[g.vol]}</span>
          <span className={`chip ${g.bias === "comprador" ? "up" : g.bias === "vendedor" ? "down" : ""}`}>Sesgo {g.bias}</span>
          <span className="chip">{g.session}</span>
        </div>
        <div className="grid3 small mono">
          <div><div className="muted">ATR diario</div>{fmt(g.atr)}</div>
          <div><div className="muted">Percentil ATR</div>{g.atr_rank != null ? pct(g.atr_rank) : "–"}</div>
          <div><div className="muted">Fuerza tendencia</div>{fmt(g.trend_score)}</div>
          <div><div className="muted">Mov. desde 01:05</div>{fmt(g.ret_day_atr)} ATR</div>
          <div><div className="muted">Rango del día</div>{fmt(g.day_range_atr)} ATR</div>
          <div><div className="muted">Vol. última hora</div>{fmt(g.rv60, 3)}</div>
        </div>
      </Card>

      <Card title="Qué te conviene hacer">
        <ul style={{ margin: 0, paddingLeft: 18 }} className="col">
          {(g.tips || []).map((t: string, i: number) => <li key={i}>{t}</li>)}
        </ul>
      </Card>

      <Card title="Estrategias del portafolio hoy">
        <table className="t">
          <thead><tr><th>Estrategia</th><th>Estado</th><th className="n">R esp.</th><th className="n">TP</th><th className="n">SL</th></tr></thead>
          <tbody>
            {(g.strategies || []).filter((x: any) => x.enabled).map((x: any) => (
              <tr key={x.name} title={x.description}>
                <td><b>{x.name}</b> <span className="dim small">{x.scenario ? `${x.scenario.n_cell} casos` : ""}</span>{x.levels ? <div className="small muted mono">{x.levels.buy ? `↑ ${fmt(x.levels.buy)} ` : ""}{x.levels.sell ? `↓ ${fmt(x.levels.sell)}` : ""}</div> : null}</td>
                <td className="small">{x.state}</td>
                <td className={`n ${x.scenario?.expR >= 0 ? "buy" : "sell"}`}>{x.scenario ? `${x.scenario.expR >= 0 ? "+" : ""}${x.scenario.expR.toFixed(2)}` : "–"}</td>
                <td className="n">{x.scenario ? pct(x.scenario.p.TP) : "–"}</td>
                <td className="n">{x.scenario ? pct(x.scenario.p.SL) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hint" style={{ marginTop: 6 }}>Resultados históricos de cada estrategia cuando el mercado estaba en este mismo escenario (régimen × volatilidad). Con pocos casos se acercan a la media de la estrategia. Se actualizan con cada operación nueva.</div>
      </Card>

      <Card title="Predicción próximas horas" right={<button className={`btn sm ${ui.showForecast ? "primary" : ""}`} onClick={() => ui.setShowForecast(!ui.showForecast)}>{ui.showForecast ? "Ocultar del gráfico" : "Ver en el gráfico"}</button>}>
        {fc?.points ? (
          <table className="t">
            <thead><tr><th>Horizonte</th><th className="n">Bajo (10 %)</th><th className="n">Medio</th><th className="n">Alto (90 %)</th><th className="n">Sube</th><th className="n">Fiab.</th></tr></thead>
            <tbody>
              {fc.points.filter((p: any) => p.h > 0).map((p: any) => (
                <tr key={p.h}>
                  <td>{p.h} h</td><td className="n sell">{fmt(p.p10)}</td><td className="n">{fmt(p.p50)}</td><td className="n buy">{fmt(p.p90)}</td>
                  <td className="n">{pct(p.p_up)}</td>
                  <td className="n" title="Cobertura real del rango del 80 % fuera de muestra">{metrics[`${p.h}h`] ? pct(metrics[`${p.h}h`].cobertura_80) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="hint">Entrena la IA en Ajustes → IA para ver la predicción.</div>}
        <div className="hint" style={{ marginTop: 6 }}>El rango (10–90 %) sale de cómo se movió el oro en situaciones de volatilidad parecida en los últimos 120 días; fuera de muestra contiene el precio ~79 % de las veces (objetivo 80 %). La columna «Sube» ronda el 50 %: la dirección no se puede predecir con fiabilidad y la app no lo finge.</div>
      </Card>

      <Card title="Niveles clave">
        <table className="t"><tbody>
          {(g.levels || []).slice().sort((a: any, b: any) => b.price - a.price).map((l: any) => (
            <tr key={l.name}><td>{l.name}</td><td className="n">{fmt(l.price)}</td><td className="n dim">{s.tick ? `${l.price - s.tick.bid >= 0 ? "+" : ""}${fmt(l.price - s.tick.bid)}` : ""}</td></tr>
          ))}
        </tbody></table>
      </Card>
      <div className="small dim">Actualizado {tstr(g.time)} (hora del servidor)</div>
    </div>
  );
}
