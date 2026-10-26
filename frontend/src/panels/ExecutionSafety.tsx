import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import { riskSnapshot } from "../premium/risk";
import { MetricCard } from "../components/DashboardPrimitives";
import type { CommandRow } from "../premium/commandGuard";
type Audit = { rows: CommandRow[]; pending: CommandRow[]; blocked: boolean; explained: string; oldestAgeSec: number; recentFailures: number; advisory: string };
const date = (v?:string|null) => v ? new Date(v).toLocaleString("es-DO") : "—";
export default function ExecutionSafety() {
  const { s } = useApp();
  const [audit,setAudit] = useState<Audit|null>(null);
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const authorised = s.broker==="cloud" && (s.role==="owner" || s.role==="trader");
  const account = s.accountInfo?.id;
  const load = async () => {
    if (!authorised) return;
    setBusy(true);
    try { setAudit(await api("/api/command_audit")); setError(""); }
    catch(e:any) {setAudit(null);setError(e?.message || "No se pudo consultar el historial de comandos");}
    finally {setBusy(false);}
  };
  useEffect(()=>{
    setAudit(null); setError("");
    if (!authorised) return;
    let cancelled=false;
    const fetchIt=()=>api("/api/command_audit")
      .then(x=>{if(!cancelled){setAudit(x);setError("");}})
      .catch(e=>{if(!cancelled){setAudit(null);setError(e?.message || "Sin acceso al ledger");}});
    void fetchIt();
    const timer=window.setInterval(fetchIt,12000);
    return ()=>{cancelled=true;window.clearInterval(timer);};
  },[account,s.broker,s.role]);
  const risk = useMemo(()=>riskSnapshot(s),[s]);
  const known = audit?.rows || [];
  const stat = (label:string,val:React.ReactNode)=> <div className="safety-metric"><span>{label}</span><b>{val}</b></div>;
  return <div className="premium-center">
    <div className="premium-hero">
      <div><div className="premium-eyebrow">CONTROL OPERATIVO / EJECUCIÓN MT5</div><h1>Control de ejecución</h1>
        <p>Órdenes remotas, comunicación con MT5 y límites de exposición de la cuenta.</p></div>
      <button className="btn sm" onClick={load} disabled={!authorised || busy}>{busy?"Consultando…":"Actualizar ledger"}</button>
    </div>
    {s.broker!=="cloud" && <div className="premium-warn">La conciliación del EA remoto se consulta exclusivamente en cuentas conectadas a Supabase. La simulación no ejecuta órdenes reales.</div>}
    {s.broker==="cloud" && !authorised && <div className="premium-warn">Necesitas el permiso de propietario u operador para consultar los comandos de esta cuenta.</div>}
    <div className="institutional-metric-grid">
      <MetricCard label="Puente MT5" value={s.ea?.online?"Conectado":"Sin conexión"}
        tone={s.ea?.online?"positive":"caution"} evidence="direct" />
      <MetricCard label="Órdenes sin confirmar" value={audit?audit.pending.length:"—"}
        tone={audit?.blocked||!audit?"caution":"positive"} evidence={audit?"direct":"unverified"} />
      <MetricCard label="Exposición al SL*" value={risk.exposure.withoutStop?"No acotada":risk.exposure.atStop.toFixed(2)+" USD"}
        tone={risk.exposure.withoutStop?"negative":"neutral"} evidence="estimated" />
      <MetricCard label="Margen estimado*" value={risk.budget==null?"No disponible":risk.budget.toFixed(2)+" USD"}
        evidence="estimated" />
    </div>
    {error && <div className="premium-warn">No es posible comprobar órdenes pendientes. Considera cualquier entrada anterior como potencialmente ejecutada. {error}</div>}
    {audit && <section className="safety-ledger">
      <h2>Estado de las órdenes</h2>
      <p className={audit.blocked?"premium-warn":"premium-note"}>{audit.explained}</p>
      {audit.blocked && <p className="premium-warn">La web bloquea nuevas aperturas si detecta comandos pendientes o enviados. Comprueba MT5 directamente y no repitas operaciones cuyo resultado desconozcas.</p>}
      <div className="safety-table-wrap"><table className="safety-table">
        <thead><tr><th>ID</th><th>Acción</th><th>Estado servidor</th><th>Solicitada</th><th>Confirmación</th></tr></thead>
        <tbody>{known.slice(0,30).map(c=><tr key={c.id}><td>#{c.id}</td><td>{c.type}</td><td><span className={c.status==="sent"||c.status==="pending"?"sell":c.status==="done"?"buy":"dim"}>{c.status}</span></td><td>{date(c.created_at)}</td><td>{date(c.done_at)}</td></tr>)}</tbody>
      </table></div>
      {!known.length && <p className="premium-note">Todavía no existen órdenes remotas registradas.</p>}
      <p className="premium-note">{audit.advisory}</p>
    </section>}
    <section className="safety-ledger">
      <h2>Protección de la cuenta</h2>
      <div className="safety-metrics">
        {stat("Posiciones abiertas",(s.positions||[]).length)}
        {stat("Sin stop loss",risk.exposure.withoutStop)}
        {stat("Stop no válido",risk.exposure.invalidStops)}
        {stat("Lotes pendientes",risk.pendingLots.toFixed(2))}
      </div>
      {risk.exposure.withoutStop>0 && <div className="premium-warn">Hay posiciones sin SL. El riesgo extremo no puede estimarse sólo con los precios del gráfico.</div>}
      <p className="premium-note">*Las cifras del navegador son orientativas y omiten gaps, swaps, slippage y órdenes pendientes en el presupuesto. La protección final depende del EA y las reglas vigentes de tu cuenta de fondeo.</p>
    </section>
    <section className="safety-ledger">
      <h2>Protecciones pendientes</h2>
      <p className="premium-note">Pendiente: deduplicación transaccional en Supabase, reconocimiento persistente de comandos en MT5, conciliación con el historial de deals y separación del HTTP síncrono. Requieren MT5 demo para validar sin exponer una cuenta real.</p>
    </section>
  </div>;
}
