import React from "react";
import { alpha, ChartTheme, THEMES } from "../chart/themes";
import { useUI } from "../uiState";
import { Card, Seg, SetRow, Toggle } from "../ui";

// Miniatura del tema: velas, una caja de rango, un nivel y una orden de estrategia
function Preview({ t, hollow }: { t: ChartTheme; hollow: boolean }) {
  const c = [[8, 40, 30, 46, 26, 1], [20, 30, 34, 38, 24, 0], [32, 34, 22, 38, 18, 1], [44, 22, 26, 30, 16, 0], [56, 26, 16, 30, 12, 1], [68, 16, 24, 28, 12, 0], [80, 24, 18, 28, 14, 1], [92, 18, 12, 22, 8, 1], [104, 12, 20, 24, 10, 0], [116, 20, 14, 24, 10, 1], [128, 14, 10, 18, 6, 1]];
  return (
    <svg viewBox="0 0 140 56" preserveAspectRatio="none" aria-hidden="true">
      <rect width="140" height="56" fill={t.bg} />
      {[14, 28, 42].map((y) => <line key={y} x1="0" x2="140" y1={y} y2={y} stroke={t.grid} strokeWidth="1" />)}
      <rect x="4" y="20" width="58" height="28" fill={alpha(t.zone.asia, t.light ? 0.08 : 0.12)} stroke={alpha(t.zone.asia, 0.7)} strokeWidth="0.8" />
      <line x1="0" x2="140" y1="9" y2="9" stroke={alpha(t.level.pd, 0.6)} strokeDasharray="2 2" strokeWidth="0.8" />
      <line x1="96" x2="140" y1="5" y2="5" stroke={t.buy} strokeDasharray="4 3" strokeWidth="1" />
      {c.map(([x, o, cl, lo, hi, up]) => {
        const col = up ? t.up : t.down;
        const top = Math.min(o, cl), h = Math.max(1.5, Math.abs(o - cl));
        return (
          <g key={x}>
            <line x1={x + 3} x2={x + 3} y1={hi} y2={lo} stroke={up ? t.wickUp : t.wickDown} strokeWidth="1" />
            <rect x={x} y={top} width="6" height={h} fill={up && hollow ? t.bg : col} stroke={col} strokeWidth="0.8" />
          </g>
        );
      })}
    </svg>
  );
}

export function ChartSettings() {
  const ui = useUI();
  const p = ui.chart;
  return (
    <div className="cols-side wide-left">
      <Card title="Tema del gráfico">
        <div className="theme-grid">
          {THEMES.map((t) => (
            <button key={t.id} className={`theme-card ${p.theme === t.id ? "on" : ""}`} onClick={() => ui.setChart({ theme: t.id })} aria-pressed={p.theme === t.id}>
              <Preview t={t} hollow={p.candles === "huecas"} />
              <span>{t.name}</span>
            </button>
          ))}
        </div>
      </Card>
      <Card title="Estilo" tip="Se guarda en este navegador. Rangos, niveles, estrategias y operaciones se activan en «Capas», en el propio gráfico.">
        <SetRow label="Velas"><Seg value={p.candles} options={[["rellenas", "Rellenas"], ["huecas", "Huecas"]]} onChange={(v) => ui.setChart({ candles: v })} /></SetRow>
        <SetRow label="Cuadrícula"><Toggle on={p.grid} onChange={(v) => ui.setChart({ grid: v })} label="Cuadrícula" /></SetRow>
        <SetRow label="Zonas de riesgo y beneficio" tip="Sombrea el SL y el TP de las posiciones abiertas."><Toggle on={p.rr} onChange={(v) => ui.setChart({ rr: v })} label="Zonas de riesgo y beneficio" /></SetRow>
      </Card>
    </div>
  );
}
