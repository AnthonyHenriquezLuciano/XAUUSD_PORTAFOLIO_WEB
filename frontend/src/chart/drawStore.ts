// Guardado de los dibujos: en la cuenta real, en Supabase (por usuario y cuenta, se ven en cualquier dispositivo);
// en el simulador, en este navegador.
import { supabase } from "../lib/supabase";
import type { Drawing } from "./drawings";

export type DrawKey = { cloud: boolean; account: string };
const LS = (k: DrawKey) => `xauai.draw.${k.cloud ? k.account : "sim"}`;

function readLocal(k: DrawKey): Drawing[] {
  try { return JSON.parse(localStorage.getItem(LS(k)) || "[]"); } catch { return []; }
}
function writeLocal(k: DrawKey, list: Drawing[]) {
  try { localStorage.setItem(LS(k), JSON.stringify(list)); } catch { /* sin almacenamiento */ }
}
// The installed schema validates drawing.kind against a legacy set. Persist a profile as
// an allowed rectangle with subtype in data; loading already spreads data over row.kind.
const toRow = (k: DrawKey, d: Drawing) => ({ id: d.id, account_id: k.account, kind: d.kind === "profile" ? "rect" : d.kind, data: { kind: d.kind, a: d.a, b: d.b, text: d.text, color: d.color, width: d.width, dash: !!d.dash }, updated_at: new Date().toISOString() });

export async function loadDrawings(k: DrawKey): Promise<Drawing[]> {
  if (!k.cloud) return readLocal(k);
  const { data, error } = await supabase.from("drawings").select("id, kind, data").eq("account_id", k.account).order("updated_at");
  if (error) throw new Error(error.message);
  return (data || []).map((r: any) => ({ id: r.id, kind: r.kind, ...r.data }));
}
export async function saveDrawing(k: DrawKey, d: Drawing, all: Drawing[]) {
  if (!k.cloud) return writeLocal(k, all);
  const { error } = await supabase.from("drawings").upsert(toRow(k, d), { onConflict: "id" });
  if (error) throw new Error(error.message);
}
export async function deleteDrawings(k: DrawKey, ids: string[], all: Drawing[]) {
  if (!k.cloud) return writeLocal(k, all);
  if (!ids.length) return;
  const { error } = await supabase.from("drawings").delete().in("id", ids);
  if (error) throw new Error(error.message);
}
export const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c: any) => (c ^ (Math.random() * 16) >> (c / 4)).toString(16)));
