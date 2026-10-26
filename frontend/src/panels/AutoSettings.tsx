import React, { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import { Card, Field, Num, Seg, SetRow, Toggle } from "../ui";

/** Ajustes que ejecuta el EA: protector de disciplina, filtro de noticias y gestión automática. */
export function useExtra() {
  const { s, toast } = useApp();
  const base = s.settings?.extra || {};
  const [x, setX] = useState<any>(base);
  useEffect(() => setX(base), [JSON.stringify(base)]);
  const dirty = JSON.stringify(x) !== JSON.stringify(base);
  const save = async () => {
    try {
      await api("/api/settings", "PUT", { extra: x });
      toast(s.ea?.online ? "Enviado al EA" : "Guardado: se aplicará al conectar el EA", "ok");
    } catch (e: any) { toast(e.message, "error"); }
  };
  return { x, set: (k: string, v: any) => setX({ ...x, [k]: v }), dirty, save, reset: () => setX(base) };
}

function CardSave({ dirty, save, reset }: { dirty: boolean; save: () => void; reset: () => void }) {
  if (!dirty) return null;
  return <div className="card-save"><button className="btn sm ghost" onClick={reset}>Descartar</button><button className="btn sm primary" onClick={save}>Guardar</button></div>;
}
const OldEa = ({ v }: { v: string }) => <div className="note warn">Tu EA es la v{v}: instala la v6.20 para usar esto.</div>;
const hm = (t: number) => new Date(t * 1000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

export function NewsFilterCard() {
  const { s } = useApp();
  const { x, set, dirty, save, reset } = useExtra();
  const pend: string[] = s.settings?.pending || [];
  const can = s.role === "owner" || s.role === "trader";
  const old = s.settings && !s.settings.ea_supports_extra && s.ea?.version;
  return (
    <Card title="Filtro de noticias" tip="Con el calendario USD que el servidor descarga cada hora. El EA no abre operaciones dentro de la ventana de cada noticia. FundingPips solo lo exige en cuentas fondeadas (5 min antes y después)."
      right={<Toggle on={!!x.news_enabled} onChange={(v) => can && set("news_enabled", v)} label="Filtro de noticias" />}>
      {old ? <OldEa v={s.ea.version} /> : null}
      <SetRow label="Impacto" pending={pend.includes("news_impact")}><Seg value={x.news_impact || "high"} options={[["high", "Alto"], ["medium", "Alto y medio"]]} onChange={(v) => can && set("news_impact", v)} /></SetRow>
      <div className="grid2">
        <Field label="Minutos antes"><Num value={x.news_before} step={1} min={0} max={120} disabled={!can} onChange={(v) => set("news_before", Math.round(v))} /></Field>
        <Field label="Minutos después"><Num value={x.news_after} step={1} min={0} max={120} disabled={!can} onChange={(v) => set("news_after", Math.round(v))} /></Field>
      </div>
      <SetRow label="Cerrar antes de la noticia" tip="Solo posiciones abiertas hace menos de 5 h (las más antiguas están exentas en FundingPips)." pending={pend.includes("news_close")}><Toggle on={!!x.news_close} onChange={(v) => can && set("news_close", v)} label="Cerrar antes de la noticia" /></SetRow>
      {x.news_close ? <SetRow label="Minutos antes del cierre"><Num value={x.news_close_min} step={1} min={1} max={120} disabled={!can} onChange={(v) => set("news_close_min", Math.round(v))} /></SetRow> : null}
      <CardSave dirty={dirty} save={save} reset={reset} />
    </Card>
  );
}

export function ManagementCard() {
  const { s } = useApp();
  const { x, set, dirty, save, reset } = useExtra();
  const pend: string[] = s.settings?.pending || [];
  const can = s.role === "owner" || s.role === "trader";
  const old = s.settings && !s.settings.ea_supports_extra && s.ea?.version;
  return (
    <Card title="Gestión automática de posiciones" tip="R = distancia del SL inicial. Nunca toca operaciones de otros EA ni las copias. El portafolio se validó sin gestión: compáralo antes en el backtest.">
      {old ? <OldEa v={s.ea.version} /> : null}
      <SetRow label="Gestiona" pending={pend.includes("mg_scope")}><select value={x.mg_scope || "todas"} disabled={!can} onChange={(e) => set("mg_scope", e.target.value)} aria-label="Posiciones que gestiona"><option value="todas">Portafolio y manuales</option><option value="portafolio">Solo portafolio</option><option value="manuales">Solo manuales</option></select></SetRow>
      <div className="mg-block">
        <SetRow label="Break-even" tip="Mueve el SL a la entrada más un margen." pending={pend.includes("be_enabled")}><Toggle on={!!x.be_enabled} onChange={(v) => can && set("be_enabled", v)} label="Break-even" /></SetRow>
        {x.be_enabled ? <div className="grid2">
          <Field label="Al llegar a"><Num value={x.be_r} step={0.1} min={0.2} max={10} disabled={!can} onChange={(v) => set("be_r", v)} suffix="R" /></Field>
          <Field label="Margen"><Num value={x.be_offset} step={0.05} min={0} max={20} disabled={!can} onChange={(v) => set("be_offset", v)} suffix="$" /></Field>
        </div> : null}
      </div>
      <div className="mg-block">
        <SetRow label="Trailing stop" tip="El SL sigue al precio y solo se mueve a favor." pending={pend.includes("tr_enabled")}><Toggle on={!!x.tr_enabled} onChange={(v) => can && set("tr_enabled", v)} label="Trailing stop" /></SetRow>
        {x.tr_enabled ? <div className="grid2">
          <Field label="Empieza a"><Num value={x.tr_start_r} step={0.1} min={0.2} max={20} disabled={!can} onChange={(v) => set("tr_start_r", v)} suffix="R" /></Field>
          <Field label="Distancia"><Num value={x.tr_dist_r} step={0.1} min={0.1} max={10} disabled={!can} onChange={(v) => set("tr_dist_r", v)} suffix="R" /></Field>
        </div> : null}
      </div>
      <div className="mg-block">
        <SetRow label="Cierre parcial" tip="Una vez por posición." pending={pend.includes("pt_enabled")}><Toggle on={!!x.pt_enabled} onChange={(v) => can && set("pt_enabled", v)} label="Cierre parcial" /></SetRow>
        {x.pt_enabled ? <div className="grid2">
          <Field label="Al llegar a"><Num value={x.pt_r} step={0.1} min={0.2} max={20} disabled={!can} onChange={(v) => set("pt_r", v)} suffix="R" /></Field>
          <Field label="Cerrar"><Num value={x.pt_pct} step={5} min={5} max={95} disabled={!can} onChange={(v) => set("pt_pct", Math.round(v))} suffix="%" /></Field>
        </div> : null}
      </div>
      <CardSave dirty={dirty} save={save} reset={reset} />
    </Card>
  );
}

const WIN_RE = /^\s*$|^\s*([01]?\d|2[0-3]):[0-5]\d\s*-\s*([01]?\d|2[0-3]):[0-5]\d\s*([,;]\s*([01]?\d|2[0-3]):[0-5]\d\s*-\s*([01]?\d|2[0-3]):[0-5]\d\s*)*$/;

export function DisciplineCard() {
  const { s } = useApp();
  const { x, set, dirty, save, reset } = useExtra();
  const pend: string[] = s.settings?.pending || [];
  const can = s.role === "owner" || s.role === "trader";
  const old = s.settings && !s.settings.ea_supports_dp && s.ea?.version;
  const dp = s.market?.discipline;
  const winOk = WIN_RE.test(x.dp_windows || "");
  const off = (v: number) => (v > 0 ? "" : " · desactivado");
  const off2 = s.news_offset ?? 7200;
  return (
    <Card title="Protector de disciplina" tip="El EA deja de abrir operaciones cuando se cumple una regla, aunque la web esté cerrada. Las abiertas siguen con su SL y TP. Los límites del día cuentan desde la medianoche del servidor."
      right={<Toggle on={!!x.dp_enabled} onChange={(v) => can && set("dp_enabled", v)} label="Protector de disciplina" />}>
      {old ? <OldEa v={s.ea.version} /> : null}
      {x.dp_enabled && dp ? (
        <div className={`note ${dp.why ? "bad" : "ok"}`}>
          {dp.why ? <>Bloqueado: <b>{dp.why}</b>{dp.until ? ` · hasta las ${hm(dp.until - off2)}` : ""} · </> : "Sin bloqueo · "}
          hoy {dp.losses} pérdidas seguidas, {dp.trades} operaciones
        </div>
      ) : null}
      <SetRow label="Se aplica a" tip="Manuales: las de la web y las que abras a mano en MT5. Todas: también el portafolio y las copias." pending={pend.includes("dp_scope")}><Seg value={x.dp_scope || "manuales"} options={[["manuales", "Manuales"], ["todas", "Todas"]]} onChange={(v) => can && set("dp_scope", v)} /></SetRow>
      <div className="grid2">
        <Field label={`Pérdidas seguidas para parar el día${off(x.dp_max_losses)}`}><Num value={x.dp_max_losses} step={1} min={0} max={20} disabled={!can} onChange={(v) => set("dp_max_losses", Math.round(v))} /></Field>
        <Field label={`Máximo de operaciones al día${off(x.dp_max_trades)}`}><Num value={x.dp_max_trades} step={1} min={0} max={50} disabled={!can} onChange={(v) => set("dp_max_trades", Math.round(v))} /></Field>
        <Field label={`Parar al ganar en el día${off(x.dp_profit_pct)}`}><Num value={x.dp_profit_pct} step={0.1} min={0} max={20} disabled={!can} onChange={(v) => set("dp_profit_pct", v)} suffix="%" /></Field>
        <Field label={`Parar al perder en el día${off(x.dp_loss_pct)}`} tip="Un límite tuyo, más estricto que la guarda de fondeo."><Num value={x.dp_loss_pct} step={0.1} min={0} max={10} disabled={!can} onChange={(v) => set("dp_loss_pct", v)} suffix="%" /></Field>
        <Field label={`Pausa tras una pérdida${off(x.dp_cooldown_min)}`}><Num value={x.dp_cooldown_min} step={5} min={0} max={600} disabled={!can} onChange={(v) => set("dp_cooldown_min", Math.round(v))} suffix="min" /></Field>
        <Field label="Horas sin operar (hora del servidor)" tip="HH:MM-HH:MM, varias separadas por comas. Ej.: 23:45-01:15, 15:25-15:40"><input value={x.dp_windows || ""} placeholder="23:45-01:15" disabled={!can} onChange={(e) => set("dp_windows", e.target.value)} className={winOk ? "" : "invalid"} /></Field>
      </div>
      {!winOk ? <div className="note bad">Formato de horas: HH:MM-HH:MM, separadas por comas.</div> : null}
      <SetRow label="Cerrar lo que abras en MT5 durante un bloqueo" tip="El EA no puede impedir una orden hecha en MT5, pero sí cerrarla al instante." pending={pend.includes("dp_close_mt5")}><Toggle on={!!x.dp_close_mt5} onChange={(v) => can && set("dp_close_mt5", v)} label="Cerrar operaciones de MT5" /></SetRow>
      {winOk ? <CardSave dirty={dirty} save={save} reset={reset} /> : null}
    </Card>
  );
}
