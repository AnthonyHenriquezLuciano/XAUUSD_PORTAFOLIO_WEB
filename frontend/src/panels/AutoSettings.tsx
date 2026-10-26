import React, { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import { Card, Num, Seg, Toggle } from "../ui";

function Row({ label, hint, children, pending }: { label: string; hint?: string; children: React.ReactNode; pending?: boolean }) {
  return (
    <div className="row between" style={{ padding: "5px 0" }}>
      <div><div>{label}{pending ? <span className="pending"> · pendiente</span> : null}</div>{hint ? <div className="hint">{hint}</div> : null}</div>
      <div style={{ width: 120, flex: "none", display: "flex", justifyContent: "flex-end" }}>{children}</div>
    </div>
  );
}

/** Ajustes que ejecuta el EA: filtro de noticias y gestión automática de posiciones. */
export function useExtra() {
  const { s, toast } = useApp();
  const base = s.settings?.extra || {};
  const [x, setX] = useState<any>(base);
  useEffect(() => setX(base), [JSON.stringify(base)]);
  const dirty = JSON.stringify(x) !== JSON.stringify(base);
  const save = async () => {
    try {
      await api("/api/settings", "PUT", { extra: x });
      toast(s.ea?.online ? "Enviado al EA" : "Guardado: el EA lo aplicará al conectarse", "ok");
    } catch (e: any) { toast(e.message, "error"); }
  };
  return { x, set: (k: string, v: any) => setX({ ...x, [k]: v }), dirty, save, reset: () => setX(base) };
}

function SaveBar({ dirty, save, reset }: { dirty: boolean; save: () => void; reset: () => void }) {
  if (!dirty) return null;
  return <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}><button className="btn sm ghost" onClick={reset}>Descartar</button><button className="btn sm primary" onClick={save}>Guardar</button></div>;
}

export function NewsFilterCard() {
  const { s } = useApp();
  const { x, set, dirty, save, reset } = useExtra();
  const pend: string[] = s.settings?.pending || [];
  const can = s.role === "owner" || s.role === "trader";
  const old = s.settings && !s.settings.ea_supports_extra && s.ea?.version;
  return (
    <Card title="Filtro de noticias" right={<Toggle on={!!x.news_enabled} onChange={(v) => can && set("news_enabled", v)} />}>
      {old ? <div className="warnbox small" style={{ marginBottom: 8 }}>Tu EA es la versión {s.ea.version}: instala la v6.20 (Cuentas → Conectar EA) para que aplique el filtro.</div> : null}
      <div className="hint" style={{ marginBottom: 6 }}>Usa el calendario económico (USD) que el servidor descarga cada hora. El EA no abre operaciones —ni del portafolio ni manuales desde la web— dentro de la ventana de cada noticia.</div>
      <Row label="Impacto" pending={pend.includes("news_impact")}><Seg value={x.news_impact || "high"} options={[["high", "Alto"], ["medium", "Alto y medio"]]} onChange={(v) => can && set("news_impact", v)} /></Row>
      <Row label="Minutos antes" hint="FundingPips: 5 en cuentas fondeadas" pending={pend.includes("news_before")}><Num value={x.news_before} step={1} min={0} max={120} disabled={!can} onChange={(v) => set("news_before", Math.round(v))} /></Row>
      <Row label="Minutos después" pending={pend.includes("news_after")}><Num value={x.news_after} step={1} min={0} max={120} disabled={!can} onChange={(v) => set("news_after", Math.round(v))} /></Row>
      <Row label="Cerrar posiciones antes de la noticia" hint="Solo las abiertas hace menos de 5 h (las más antiguas están exentas en FundingPips)" pending={pend.includes("news_close")}><Toggle on={!!x.news_close} onChange={(v) => can && set("news_close", v)} /></Row>
      {x.news_close ? <Row label="… minutos antes" pending={pend.includes("news_close_min")}><Num value={x.news_close_min} step={1} min={1} max={120} disabled={!can} onChange={(v) => set("news_close_min", Math.round(v))} /></Row> : null}
      <SaveBar dirty={dirty} save={save} reset={reset} />
      <div className="hint" style={{ marginTop: 6 }}>En evaluación FundingPips no restringe las noticias; en la cuenta fondeada (Master) los beneficios de operaciones abiertas o cerradas 5 min antes o después de una noticia restringida no cuentan. Comprueba el calendario de tu panel de FundingPips.</div>
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
    <Card title="Gestión automática de posiciones">
      {old ? <div className="warnbox small" style={{ marginBottom: 8 }}>Tu EA es la versión {s.ea.version}: instala la v6.20 (Cuentas → Conectar EA) para que aplique la gestión.</div> : null}
      <Row label="Posiciones que gestiona" pending={pend.includes("mg_scope")}><select value={x.mg_scope || "todas"} disabled={!can} onChange={(e) => set("mg_scope", e.target.value)}><option value="todas">Portafolio y manuales</option><option value="portafolio">Solo portafolio</option><option value="manuales">Solo manuales</option></select></Row>
      <div className="hint" style={{ marginBottom: 4 }}>Nunca toca operaciones de otros EA. R = distancia del SL inicial.</div>

      <div className="mg-block">
        <Row label="Break-even" hint="Mueve el SL a la entrada (+ un margen para cubrir costes)" pending={pend.includes("be_enabled")}><Toggle on={!!x.be_enabled} onChange={(v) => can && set("be_enabled", v)} /></Row>
        {x.be_enabled ? <div className="grid2">
          <label className="field"><span className="flabel">Al llegar a (R)</span><Num value={x.be_r} step={0.1} min={0.2} max={10} disabled={!can} onChange={(v) => set("be_r", v)} /></label>
          <label className="field"><span className="flabel">Margen sobre la entrada ($/oz)</span><Num value={x.be_offset} step={0.05} min={0} max={20} disabled={!can} onChange={(v) => set("be_offset", v)} /></label>
        </div> : null}
      </div>

      <div className="mg-block">
        <Row label="Trailing stop" hint="El SL sigue al precio y solo se mueve a favor" pending={pend.includes("tr_enabled")}><Toggle on={!!x.tr_enabled} onChange={(v) => can && set("tr_enabled", v)} /></Row>
        {x.tr_enabled ? <div className="grid2">
          <label className="field"><span className="flabel">Empieza a (R)</span><Num value={x.tr_start_r} step={0.1} min={0.2} max={20} disabled={!can} onChange={(v) => set("tr_start_r", v)} /></label>
          <label className="field"><span className="flabel">Distancia al precio (R)</span><Num value={x.tr_dist_r} step={0.1} min={0.1} max={10} disabled={!can} onChange={(v) => set("tr_dist_r", v)} /></label>
        </div> : null}
      </div>

      <div className="mg-block">
        <Row label="Cierre parcial" hint="Una vez por posición" pending={pend.includes("pt_enabled")}><Toggle on={!!x.pt_enabled} onChange={(v) => can && set("pt_enabled", v)} /></Row>
        {x.pt_enabled ? <div className="grid2">
          <label className="field"><span className="flabel">Al llegar a (R)</span><Num value={x.pt_r} step={0.1} min={0.2} max={20} disabled={!can} onChange={(v) => set("pt_r", v)} /></label>
          <label className="field"><span className="flabel">Porcentaje a cerrar (%)</span><Num value={x.pt_pct} step={5} min={5} max={95} disabled={!can} onChange={(v) => set("pt_pct", Math.round(v))} /></label>
        </div> : null}
      </div>
      <SaveBar dirty={dirty} save={save} reset={reset} />
      <div className="warnbox small" style={{ marginTop: 8 }}>El portafolio se validó sin esta gestión. Antes de activarla, compara en Estrategias → Backtest con «Aplicar gestión automática»: puede mejorar o empeorar el resultado.</div>
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
  return (
    <Card title="Protector de disciplina" right={<Toggle on={!!x.dp_enabled} onChange={(v) => can && set("dp_enabled", v)} />}>
      {old ? <div className="warnbox small" style={{ marginBottom: 8 }}>Tu EA es la versión {s.ea.version}: instala la v6.20 (Cuentas → Conectar EA) para que aplique el protector.</div> : null}
      <div className="hint" style={{ marginBottom: 6 }}>Reglas que el EA aplica solo, aunque la web esté cerrada. Cuando se cumple una, no se abren más operaciones hasta que termine el bloqueo (las abiertas siguen con su SL y TP).</div>
      {x.dp_enabled && dp ? (
        <div className={dp.why ? "errbox small" : "okbox small"} style={{ marginBottom: 8 }}>
          {dp.why ? <>Bloqueado: <b>{dp.why}</b>{dp.until ? ` · hasta las ${new Date((dp.until - (s.news_offset ?? 7200)) * 1000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : ""}</> : "Sin bloqueo."}
          {dp.why ? " · " : " "}Hoy: {dp.losses} pérdidas seguidas · {dp.trades} operaciones.
        </div>
      ) : null}
      <Row label="Se aplica a" pending={pend.includes("dp_scope")}><Seg value={x.dp_scope || "manuales"} options={[["manuales", "Manuales"], ["todas", "Todas"]]} onChange={(v) => can && set("dp_scope", v)} /></Row>
      <div className="hint" style={{ marginBottom: 4 }}>«Manuales»: las de la web y las que abras a mano en MT5. «Todas»: también el portafolio y las copias de otra cuenta.</div>
      <div className="mg-block">
        <div className="grid2">
          <label className="field"><span className="flabel">Pérdidas seguidas para parar el día{off(x.dp_max_losses)}</span><Num value={x.dp_max_losses} step={1} min={0} max={20} disabled={!can} onChange={(v) => set("dp_max_losses", Math.round(v))} /></label>
          <label className="field"><span className="flabel">Máximo de operaciones al día{off(x.dp_max_trades)}</span><Num value={x.dp_max_trades} step={1} min={0} max={50} disabled={!can} onChange={(v) => set("dp_max_trades", Math.round(v))} /></label>
          <label className="field"><span className="flabel">Parar al ganar en el día (%){off(x.dp_profit_pct)}</span><Num value={x.dp_profit_pct} step={0.1} min={0} max={20} disabled={!can} onChange={(v) => set("dp_profit_pct", v)} /></label>
          <label className="field"><span className="flabel">Parar al perder en el día (%){off(x.dp_loss_pct)}</span><Num value={x.dp_loss_pct} step={0.1} min={0} max={10} disabled={!can} onChange={(v) => set("dp_loss_pct", v)} /></label>
          <label className="field"><span className="flabel">Pausa tras una pérdida (min){off(x.dp_cooldown_min)}</span><Num value={x.dp_cooldown_min} step={5} min={0} max={600} disabled={!can} onChange={(v) => set("dp_cooldown_min", Math.round(v))} /></label>
          <label className="field"><span className="flabel">Horas sin operar (hora del servidor)</span><input value={x.dp_windows || ""} placeholder="23:45-01:15" disabled={!can} onChange={(e) => set("dp_windows", e.target.value)} style={winOk ? undefined : { borderColor: "var(--sell)" }} /></label>
        </div>
        {!winOk ? <div className="hint sell">Formato: HH:MM-HH:MM, separa varias con comas (por ejemplo 23:45-01:15, 15:25-15:40).</div> : null}
        <div className="hint">Los límites del día se cuentan desde la medianoche del servidor del bróker, igual que la pérdida diaria de FundingPips. «Parar al perder» sirve para un límite tuyo más estricto que la guarda de fondeo.</div>
      </div>
      <Row label="Cerrar lo que abras a mano en MT5 durante un bloqueo" hint="El EA no puede impedir una orden hecha en MT5, pero sí cerrarla al instante" pending={pend.includes("dp_close_mt5")}><Toggle on={!!x.dp_close_mt5} onChange={(v) => can && set("dp_close_mt5", v)} /></Row>
      {winOk ? <SaveBar dirty={dirty} save={save} reset={reset} /> : null}
    </Card>
  );
}
