import React from "react";
import { fmt, pct, useApp } from "../store";
import { useUI } from "../uiState";
import { Card, Empty, Stat } from "../ui";
import NewsCard from "./NewsCard";

const REG: Record<string, [string, string]> = { alcista: ["Tendencia alcista", "up"], bajista: ["Tendencia bajista", "down"], rango: ["Rango", "gold"], transicion: ["Transición", ""] };
const VOL: Record<string, string> = { baja: "Vol. baja", normal: "Vol. normal", alta: "Vol. alta", extrema: "Vol. extrema" };

export default function Signals() {
  const { s } = useApp();
  const ui = useUI();
  const g = s.signals || {};
  if (!g.ok) return <Empty>{s.status === "conectado" ? "Calculando señales…" : "Abre una cuenta para ver el mercado."}</Empty>;
  const fc = g.forecast;
  const metrics = fc?.metrics || {};
  const strats = (g.strategies || []).filter((x: any) => x.enabled);
  return (
    <div className="stack">
      <Card title="Escenario" right={<span className="muted">{g.hour} · {g.session}</span>}>
        <div className="chips">
          <span className={`chip ${REG[g.regime]?.[1]}`}>{REG[g.regime]?.[0]}</span>
          <span className="chip">{VOL[g.vol]}</span>
          <span className={`chip ${g.bias === "comprador" ? "up" : g.bias === "vendedor" ? "down" : ""}`}>Sesgo {g.bias}</span>
        </div>
        <div className="stats3">
          <Stat label="ATR diario" value={fmt(g.atr)} sub={g.atr_rank != null ? `percentil ${pct(g.atr_rank)}` : undefined} />
          <Stat label="Desde 01:05" value={`${fmt(g.ret_day_atr)} ATR`} />
          <Stat label="Rango del día" value={`${fmt(g.day_range_atr)} ATR`} />
        </div>
        {g.tips?.length ? <ul className="tips">{g.tips.map((t: string, i: number) => <li key={i}>{t}</li>)}</ul> : null}
      </Card>

      <NewsCard />

      <Card title="Estrategias hoy" tip="Resultado histórico de cada estrategia en este mismo escenario (régimen × volatilidad).">
        <table className="t">
          <thead><tr><th>Estrategia</th><th>Estado</th><th className="n">R esp.</th><th className="n">TP</th></tr></thead>
          <tbody>
            {strats.map((x: any) => (
              <tr key={x.name} title={x.description}>
                <td><b>{x.name}</b>{x.levels ? <div className="dim">{x.levels.buy ? `▲ ${fmt(x.levels.buy)} ` : ""}{x.levels.sell ? `▼ ${fmt(x.levels.sell)}` : ""}</div> : null}</td>
                <td className="muted">{x.state}</td>
                <td className={`n ${x.scenario?.expR >= 0 ? "buy" : "sell"}`}>{x.scenario ? `${x.scenario.expR >= 0 ? "+" : ""}${x.scenario.expR.toFixed(2)}` : "–"}</td>
                <td className="n">{x.scenario ? pct(x.scenario.p.TP) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Próximas horas" tip="Rango donde el precio terminó el 80 % de las veces en situaciones de volatilidad parecida. La dirección no es predecible: «Sube» ronda el 50 %."
        right={fc?.points ? <button className={`btn xs ${ui.showForecast ? "on" : ""}`} onClick={() => ui.setShowForecast(!ui.showForecast)}>{ui.showForecast ? "Ocultar del gráfico" : "Ver en el gráfico"}</button> : null}>
        {fc?.points ? (
          <table className="t">
            <thead><tr><th>Plazo</th><th className="n">Bajo</th><th className="n">Alto</th><th className="n">Sube</th><th className="n" title="Cobertura real del rango fuera de muestra">Fiab.</th></tr></thead>
            <tbody>
              {fc.points.filter((p: any) => p.h > 0).map((p: any) => (
                <tr key={p.h}>
                  <td>{p.h} h</td><td className="n sell">{fmt(p.p10)}</td><td className="n buy">{fmt(p.p90)}</td>
                  <td className="n">{pct(p.p_up)}</td>
                  <td className="n dim">{metrics[`${p.h}h`] ? pct(metrics[`${p.h}h`].cobertura_80) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty-s">Sin predicción todavía.</div>}
      </Card>

      <Card title="Niveles">
        <table className="t"><tbody>
          {(g.levels || []).slice().sort((a: any, b: any) => b.price - a.price).map((l: any) => {
            const d = s.tick ? l.price - s.tick.bid : null;
            return <tr key={l.name}><td>{l.name}</td><td className="n">{fmt(l.price)}</td><td className={`n ${d == null ? "" : d >= 0 ? "buy" : "sell"}`}>{d == null ? "" : `${d >= 0 ? "+" : ""}${fmt(d)}`}</td></tr>;
          })}
        </tbody></table>
      </Card>
    </div>
  );
}
