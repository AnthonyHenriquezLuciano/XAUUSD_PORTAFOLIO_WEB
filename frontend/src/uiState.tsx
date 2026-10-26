import React, { createContext, useContext, useState } from "react";
import { ChartPrefs, DEFAULT_PREFS } from "./chart/themes";

export type Preview = { side: number; kind: "market" | "limit" | "stop"; entry: number; sl: number; tp: number } | null;

type UI = {
  preview: Preview;
  setPreview: (p: Preview | ((p: Preview) => Preview)) => void;
  showForecast: boolean;
  setShowForecast: (v: boolean) => void;
  tab: string;
  setTab: (t: string) => void;
  accountOpen: boolean;
  setAccountOpen: (v: boolean) => void;
  layers: Record<string, boolean>;
  setLayer: (k: string, v: boolean) => void;
  chart: ChartPrefs;
  setChart: (p: Partial<ChartPrefs>) => void;
};

const C = createContext<UI | null>(null);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [preview, setPreview] = useState<Preview>(null);
  const [showForecast, setShowForecast] = useState(false);
  const [tab, setTab] = useState("operar");
  const [accountOpen, setAccountOpen] = useState(false);
  const [layers, setLayers] = useState<Record<string, boolean>>(() => {
    const def = { niveles: true, rangos: true, estrategias: true, operaciones: true };
    try { return { ...def, ...JSON.parse(localStorage.getItem("xauai.layers") || "{}") }; } catch { return def; }
  });
  const setLayer = (k: string, v: boolean) => setLayers((l) => {
    const n = { ...l, [k]: v };
    try { localStorage.setItem("xauai.layers", JSON.stringify(n)); } catch { /* sin almacenamiento */ }
    return n;
  });
  const [chart, setChartState] = useState<ChartPrefs>(() => {
    try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem("xauai.chart") || "{}") }; } catch { return DEFAULT_PREFS; }
  });
  const setChart = (p: Partial<ChartPrefs>) => setChartState((c) => {
    const n = { ...c, ...p };
    try { localStorage.setItem("xauai.chart", JSON.stringify(n)); } catch { /* sin almacenamiento */ }
    return n;
  });
  return <C.Provider value={{ preview, setPreview, showForecast, setShowForecast, tab, setTab, accountOpen, setAccountOpen, layers, setLayer, chart, setChart }}>{children}</C.Provider>;
}

export function useUI() {
  const c = useContext(C);
  if (!c) throw new Error("sin UI");
  return c;
}
