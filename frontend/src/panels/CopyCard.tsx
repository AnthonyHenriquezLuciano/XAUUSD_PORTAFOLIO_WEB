import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useApp } from "../store";
import { Card, Field, Num, Seg, Tip, Toggle } from "../ui";

type Acc = { id: string; name: string; login: number | null; server: string | null };
type Link = { id: number; master_id: string; follower_id: string; enabled: boolean; lot_mode: string; lot_value: number; max_lots: number;
  copy_portfolio: boolean; copy_manual: boolean; copy_other: boolean; max_delay_s: number };
type MapRow = { id: number; link_id: number; master_ticket: number; follower_ticket: number | null; status: string; msg: string | null; created_at: string; master_id: string; follower_id: string };

const MODES: [string, string][] = [["balance", "Según balance"], ["mult", "Multiplicador"], ["fixed", "Lote fijo"], ["risk", "Riesgo %"]];
const VALUE_LABEL: Record<string, string> = { balance: "Ajuste (× proporción)", mult: "Multiplicador", fixed: "Lotes", risk: "Riesgo por operación (%)" };
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
    <div className="cols-2">
      <Card title="Copiador entre cuentas" tip="Esta cuenta repite las operaciones de otra cuenta tuya (o compartida contigo): aperturas, cambios de SL/TP, parciales y cierres. Las ejecuta el EA de esta cuenta con sus propias guardas, filtro de noticias y regla de no cobertura. Necesita los dos EA conectados (v6.20 en esta). Las copias nunca se vuelven a copiar."
        right={can && !form ? <button className="btn sm primary" onClick={() => setForm({ ...NEW })}>Copiar otra cuenta</button> : null}>
        {mine.length ? mine.map((l) => (
          <div key={l.id} className="copy-row">
            <div className="grow">
              <div><b>Copia de {accName(byId(l.master_id))}</b>{!l.enabled ? <span className="tag">en pausa</span> : null}</div>
              <div className="muted">Lote {modeText(l)} · máx. {l.max_lots} · {what(l)}</div>
            </div>
            {can ? <>
              <Toggle on={l.enabled} onChange={(v) => toggle(l, v)} title={l.enabled ? "Pausar" : "Reanudar"} />
              <button className="btn xs" onClick={() => setForm({ ...l })}>Editar</button>
              <button className="btn xs danger" onClick={() => remove(l)} aria-label="Quitar copiador">✕</button>
            </> : null}
          </div>
        )) : !form ? <div className="empty-s">Esta cuenta no copia ninguna otra.</div> : null}

        {form ? (
          <div className="mg-block stack">
            <Field label="Cuenta que se copia">
              <select value={form.master_id} disabled={!!form.id} onChange={(e) => setForm({ ...form, master_id: e.target.value })}>
                <option value="">Elige una cuenta</option>
                {choices.map((a) => <option key={a.id} value={a.id}>{accName(a)}</option>)}
              </select>
            </Field>
            {!choices.length && !form.id ? <div className="note warn">No tienes otra cuenta. Créala en Cuentas (cada una necesita su propio MT5 con el EA).</div> : null}
            <div className="field"><span className="field-l">Tamaño del lote<Tip text={MODE_HINT[form.lot_mode]} size={13} /></span><Seg full value={form.lot_mode} options={MODES as any} onChange={(v) => setForm({ ...form, lot_mode: v, lot_value: v === "fixed" ? 0.1 : v === "risk" ? 0.3 : 1 })} /></div>
            <div className="grid2">
              <Field label={VALUE_LABEL[form.lot_mode]}><Num value={form.lot_value} step={form.lot_mode === "fixed" ? 0.01 : 0.1} min={0.01} max={form.lot_mode === "risk" ? 3 : 100} onChange={(v) => setForm({ ...form, lot_value: v })} /></Field>
              <Field label="Lote máximo"><Num value={form.max_lots} step={0.1} min={0.01} max={100} onChange={(v) => setForm({ ...form, max_lots: v })} /></Field>
            </div>
            <div className="checks">
              <label><input type="checkbox" checked={form.copy_portfolio} onChange={(e) => setForm({ ...form, copy_portfolio: e.target.checked })} />Portafolio</label>
              <label><input type="checkbox" checked={form.copy_manual} onChange={(e) => setForm({ ...form, copy_manual: e.target.checked })} />Manuales</label>
              <label><input type="checkbox" checked={form.copy_other} onChange={(e) => setForm({ ...form, copy_other: e.target.checked })} />Otros EA</label>
            </div>
            <Field label="Retraso máximo" tip="Si el EA de esta cuenta estaba desconectado al abrirse la operación, solo se copia si no ha pasado este tiempo."><Num value={form.max_delay_s} step={10} min={10} max={3600} onChange={(v) => setForm({ ...form, max_delay_s: Math.round(v) })} suffix="s" /></Field>
            {dupWarn ? <div className="note warn">Esta cuenta tiene el portafolio automático en ON: el portafolio se abriría dos veces. Desmarca «Portafolio» o apaga el automático aquí.</div> : null}
            <div className="card-save">
              <button className="btn sm ghost" onClick={() => setForm(null)}>Cancelar</button>
              <button className="btn sm primary" disabled={busy} onClick={save}>{form.id ? "Guardar cambios" : "Empezar a copiar"}</button>
            </div>
          </div>
        ) : null}

        {copiers.length ? (
          <div className="mg-block">
            <div className="field-l">Cuentas que copian esta</div>
            {copiers.map((l) => <div key={l.id} className="line"><span>{accName(byId(l.follower_id))}</span><span className="muted">lote {modeText(l)}{!l.enabled ? " · en pausa" : ""}</span></div>)}
          </div>
        ) : null}
      </Card>

      <Card title="Últimas copias">
        {rows.length ? (
          <table className="t">
            <thead><tr><th>Hora</th><th>Original</th><th>Copia</th><th>Estado</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} title={r.msg || undefined}>
                <td className="muted">{new Date(r.created_at).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                <td>#{r.master_ticket}{r.follower_id === me ? "" : " (esta)"}</td>
                <td>{r.follower_ticket ? `#${r.follower_ticket}` : "–"}</td>
                <td className={r.status === "fallida" ? "sell" : r.status === "abierta" ? "buy" : ""}>{ST[r.status] || r.status}{r.msg ? `: ${r.msg}` : ""}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <div className="empty-s">Todavía no hay copias.</div>}
      </Card>
    </div>
  );
}
