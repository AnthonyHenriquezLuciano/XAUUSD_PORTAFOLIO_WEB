import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useApp } from "../store";
import { Card, Num, Seg, Toggle } from "../ui";

type Acc = { id: string; name: string; login: number | null; server: string | null };
type Link = { id: number; master_id: string; follower_id: string; enabled: boolean; lot_mode: string; lot_value: number; max_lots: number;
  copy_portfolio: boolean; copy_manual: boolean; copy_other: boolean; max_delay_s: number };
type MapRow = { id: number; link_id: number; master_ticket: number; follower_ticket: number | null; status: string; msg: string | null; created_at: string; master_id: string; follower_id: string };

const MODES: [string, string][] = [["balance", "Según balance"], ["mult", "Multiplicador"], ["fixed", "Lote fijo"], ["risk", "Riesgo %"]];
const VALUE_LABEL: Record<string, string> = { balance: "Ajuste (× proporción)", mult: "Multiplicador del lote", fixed: "Lotes por operación", risk: "Riesgo por operación (%)" };
const MODE_HINT: Record<string, string> = {
  balance: "Lote copiado × (balance de esta cuenta ÷ balance de la copiada). Con 1 se arriesga el mismo % que en la otra cuenta.",
  mult: "Lote copiado × el multiplicador, sin mirar el balance.",
  fixed: "Siempre el mismo lote.",
  risk: "Esta cuenta calcula el lote con su riesgo % y la distancia del SL, como sus operaciones manuales.",
};
const NEW: Omit<Link, "id" | "follower_id"> = { master_id: "", enabled: true, lot_mode: "balance", lot_value: 1, max_lots: 5, copy_portfolio: true, copy_manual: true, copy_other: false, max_delay_s: 120 };
const accName = (a?: Acc) => (a ? `${a.name}${a.login ? ` · ${a.login}` : ""}` : "cuenta sin acceso");
const ST: Record<string, string> = { enviada: "enviada", abierta: "abierta", cerrada: "cerrada", fallida: "no copiada" };

export default function CopyCard() {
  const { s, toast, ask } = useApp();
  const me = s.accountInfo?.id as string | undefined;
  const can = s.role === "owner" || s.role === "trader";
  const [accs, setAccs] = useState<Acc[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [rows, setRows] = useState<MapRow[]>([]);
  const [form, setForm] = useState<(typeof NEW & { id?: number }) | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!me) return;
    const [a, l, m] = await Promise.all([
      supabase.from("accounts").select("id, name, login, server").order("created_at"),
      supabase.from("copy_links").select("*").or(`follower_id.eq.${me},master_id.eq.${me}`).order("id"),
      supabase.from("copy_map").select("id, link_id, master_ticket, follower_ticket, status, msg, created_at, master_id, follower_id").or(`follower_id.eq.${me},master_id.eq.${me}`).order("id", { ascending: false }).limit(15),
    ]);
    if (a.data) setAccs(a.data as Acc[]);
    if (l.data) setLinks(l.data as Link[]);
    if (m.data) setRows(m.data as MapRow[]);
  };
  useEffect(() => { load().catch(() => {}); const id = setInterval(() => load().catch(() => {}), 10000); return () => clearInterval(id); }, [me]);

  const mine = links.filter((l) => l.follower_id === me);
  const copiers = links.filter((l) => l.master_id === me);
  const byId = (id: string) => accs.find((a) => a.id === id);
  const choices = accs.filter((a) => a.id !== me && (form?.id || !mine.some((l) => l.master_id === a.id)));

  const save = async () => {
    if (!form || !me) return;
    if (!form.master_id) return toast("Elige la cuenta que quieres copiar", "error");
    setBusy(true);
    const { error } = await supabase.rpc("copy_link_save", { p: { ...form, follower_id: me } });
    setBusy(false);
    if (error) return toast(error.message, "error");
    toast("Copiador guardado", "ok");
    setForm(null);
    load();
  };
  const toggle = async (l: Link, enabled: boolean) => {
    const { error } = await supabase.rpc("copy_link_save", { p: { ...l, enabled } });
    if (error) toast(error.message, "error"); else load();
  };
  const remove = async (l: Link) => {
    if (!(await ask(`¿Dejar de copiar «${accName(byId(l.master_id))}»? Las copias que sigan abiertas dejarán de seguir a la original (quedan con su SL y TP).`, "Quitar"))) return;
    const { error } = await supabase.rpc("copy_link_delete", { p_id: l.id });
    if (error) toast(error.message, "error"); else { toast("Copiador quitado", "ok"); load(); }
  };
  const modeText = (l: Link) => l.lot_mode === "balance" ? `según balance${l.lot_value !== 1 ? ` × ${l.lot_value}` : ""}` : l.lot_mode === "mult" ? `lote × ${l.lot_value}` : l.lot_mode === "fixed" ? `${l.lot_value} lotes` : `riesgo ${l.lot_value} %`;
  const what = (l: Link) => [l.copy_portfolio && "portafolio", l.copy_manual && "manuales", l.copy_other && "otros EA"].filter(Boolean).join(", ") || "nada";
  const dupWarn = form && form.copy_portfolio && !!s.settings?.autotrade;

  return (
    <Card title="Copiador entre cuentas" right={can && !form ? <button className="btn sm" onClick={() => setForm({ ...NEW })}>Copiar otra cuenta</button> : null}>
      <div className="hint" style={{ marginBottom: 6 }}>Esta cuenta repite las operaciones de otra cuenta tuya (o compartida contigo): aperturas, cambios de SL/TP, cierres parciales y cierres. Las órdenes las ejecuta el EA de esta cuenta, con sus propias guardas de fondeo, filtro de noticias y regla de no cobertura.</div>

      {mine.length ? mine.map((l) => (
        <div key={l.id} className="copy-row">
          <div className="grow">
            <div><b>Copia de {accName(byId(l.master_id))}</b>{!l.enabled ? <span className="muted"> · en pausa</span> : null}</div>
            <div className="small muted">Lote {modeText(l)} · máx. {l.max_lots} · copia {what(l)}</div>
          </div>
          {can ? <>
            <Toggle on={l.enabled} onChange={(v) => toggle(l, v)} title={l.enabled ? "Pausar" : "Reanudar"} />
            <button className="btn sm ghost" onClick={() => setForm({ ...l })}>Editar</button>
            <button className="btn sm ghost" onClick={() => remove(l)} aria-label="Quitar copiador">✕</button>
          </> : null}
        </div>
      )) : !form ? <div className="small muted">Esta cuenta no copia ninguna otra.</div> : null}

      {form ? (
        <div className="mg-block">
          <label className="field"><span className="flabel">Cuenta que se copia</span>
            <select value={form.master_id} disabled={!!form.id} onChange={(e) => setForm({ ...form, master_id: e.target.value })}>
              <option value="">— elige —</option>
              {choices.map((a) => <option key={a.id} value={a.id}>{accName(a)}</option>)}
            </select>
          </label>
          {!choices.length && !form.id ? <div className="hint">No tienes otra cuenta: créala en Cuentas (cada cuenta necesita su propio MT5 con el EA puente).</div> : null}
          <div style={{ margin: "8px 0 4px" }}><Seg value={form.lot_mode} options={MODES as any} onChange={(v) => setForm({ ...form, lot_mode: v, lot_value: v === "fixed" ? 0.1 : v === "risk" ? 0.3 : 1 })} /></div>
          <div className="hint">{MODE_HINT[form.lot_mode]}</div>
          <div className="grid2" style={{ marginTop: 6 }}>
            <label className="field"><span className="flabel">{VALUE_LABEL[form.lot_mode]}</span><Num value={form.lot_value} step={form.lot_mode === "fixed" ? 0.01 : 0.1} min={0.01} max={form.lot_mode === "risk" ? 3 : 100} onChange={(v) => setForm({ ...form, lot_value: v })} /></label>
            <label className="field"><span className="flabel">Lote máximo por copia</span><Num value={form.max_lots} step={0.1} min={0.01} max={100} onChange={(v) => setForm({ ...form, max_lots: v })} /></label>
          </div>
          <div className="row wrap small" style={{ gap: 14, margin: "8px 0" }}>
            <label className="row" style={{ gap: 5 }}><input type="checkbox" checked={form.copy_portfolio} onChange={(e) => setForm({ ...form, copy_portfolio: e.target.checked })} />Portafolio</label>
            <label className="row" style={{ gap: 5 }}><input type="checkbox" checked={form.copy_manual} onChange={(e) => setForm({ ...form, copy_manual: e.target.checked })} />Manuales</label>
            <label className="row" style={{ gap: 5 }}><input type="checkbox" checked={form.copy_other} onChange={(e) => setForm({ ...form, copy_other: e.target.checked })} />Otros EA</label>
          </div>
          <label className="field"><span className="flabel">No copiar si han pasado más de (segundos)</span><Num value={form.max_delay_s} step={10} min={10} max={3600} onChange={(v) => setForm({ ...form, max_delay_s: Math.round(v) })} /></label>
          <div className="hint">Si el EA de esta cuenta estaba desconectado cuando se abrió la operación, solo se copia si no ha pasado este tiempo (el precio ya se habrá movido).</div>
          {dupWarn ? <div className="warnbox small" style={{ marginTop: 6 }}>Esta cuenta también tiene el portafolio automático en ON: las operaciones del portafolio se abrirían dos veces. Desmarca «Portafolio» o pon el automático en OFF en esta cuenta.</div> : null}
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn sm ghost" onClick={() => setForm(null)}>Cancelar</button>
            <button className="btn sm primary" disabled={busy} onClick={save}>{form.id ? "Guardar cambios" : "Empezar a copiar"}</button>
          </div>
        </div>
      ) : null}

      {copiers.length ? (
        <div style={{ marginTop: 10 }}>
          <div className="small"><b>Cuentas que copian esta</b></div>
          {copiers.map((l) => <div key={l.id} className="small muted">{accName(byId(l.follower_id))} · lote {modeText(l)}{!l.enabled ? " · en pausa" : ""}</div>)}
        </div>
      ) : null}

      {rows.length ? (
        <div style={{ marginTop: 10, overflowX: "auto" }}>
          <div className="small" style={{ marginBottom: 4 }}><b>Últimas copias</b></div>
          <table className="t">
            <thead><tr><th>Hora</th><th>Original</th><th>Copia</th><th>Estado</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} title={r.msg || undefined}>
                <td>{new Date(r.created_at).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                <td className="mono">#{r.master_ticket}{r.follower_id === me ? "" : " (esta)"}</td>
                <td className="mono">{r.follower_ticket ? `#${r.follower_ticket}` : "–"}</td>
                <td className={r.status === "fallida" ? "sell" : r.status === "abierta" ? "buy" : ""}>{ST[r.status] || r.status}{r.msg ? `: ${r.msg}` : ""}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
      <div className="hint" style={{ marginTop: 8 }}>Necesita los dos EA conectados y la v6.20 en esta cuenta (con versiones anteriores las copias se abren como manuales y el SL se calcula con el precio del servidor). Las copias nunca se vuelven a copiar, así que no se pueden crear bucles.</div>
    </Card>
  );
}
