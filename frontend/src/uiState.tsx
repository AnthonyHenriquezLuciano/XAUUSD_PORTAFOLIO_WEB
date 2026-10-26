import React, { createContext, useContext, useState } from "react";

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
};

const C = createContext<UI | null>(null);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [preview, setPreview] = useState<Preview>(null);
  const [showForecast, setShowForecast] = useState(false);
  const [tab, setTab] = useState("operar");
  const [accountOpen, setAccountOpen] = useState(false);
  const [layers, setLayers] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("xauai.layers") || "") ; } catch { return { niveles: true, rangos: true, estrategias: true, operaciones: true }; }
  });
  const setLayer = (k: string, v: boolean) => setLayers((l) => {
    const n = { ...l, [k]: v };
    try { localStorage.setItem("xauai.layers", JSON.stringify(n)); } catch { /* sin almacenamiento */ }
    return n;
  });
  return <C.Provider value={{ preview, setPreview, showForecast, setShowForecast, tab, setTab, accountOpen, setAccountOpen, layers, setLayer }}>{children}</C.Provider>;
}

export function useUI() {
  const c = useContext(C);
  if (!c) throw new Error("sin UI");
  return c;
}
