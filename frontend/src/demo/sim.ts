import type { Backend } from "../api";

/** Simulador: repite velas reales de XAUUSD (sep–oct 2026) con el mismo motor de estrategias, riesgo y evaluación. */
export async function createSim(): Promise<Backend> {
  const w = window as any;
  if (!w.DEMO_DATA) {
    const r = await fetch("/demo/demo_data.json");
    if (!r.ok) throw new Error("No se pudieron cargar los datos del simulador");
    w.DEMO_DATA = await r.json();
  }
  const eng = await import("./engine");
  return { kind: "sim", api: eng.demoApi, start: () => eng.startDemo(), stop: () => eng.stopDemo() };
}
