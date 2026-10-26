import React,{useEffect,useMemo,useState} from "react";
import { supabase } from "../lib/supabase";
import { useApp,fmt } from "../store";
import { useUI } from "../uiState";
import { MetricCard } from "../components/DashboardPrimitives";
import { summarizeAccount,portfolioTotals, type OwnedAccount,type LiveRow,type StateRow } from "../premium/portfolioRisk";
const show=(n:number|null) => n==null?"Sin confirmar":"$"+fmt(n);
export default function PortfolioCockpit(){
 const {s}=useApp();const ui=useUI();
 const [entries,setEntries]=useState<{acc:OwnedAccount; live?:LiveRow; state?:StateRow}[]>([]);
 const [error,setError]=useState("");const [loading,setLoading]=useState(true);
 const [now,setNow]=useState(Date.now());const [version,setVersion]=useState(0);
 useEffect(()=>{
  let cancel=false;
  async function refresh(){
    try{
      const {data:user,error:ue}=await supabase.auth.getUser();
      if(ue||!user.user)throw new Error("Inicia sesión para consultar tus cuentas.");
      const {data:members,error:me}=await supabase.from("account_members").select("account_id").eq("user_id",user.user.id);
      if(me)throw new Error(me.message);
      const ids=(members||[]).map((x:any)=>x.account_id);
      if(!ids.length){if(!cancel){setEntries([]);setError("");setLoading(false);}return;}
      const [accounts,states,lives]=await Promise.all([
        supabase.from("accounts").select("id,name,server,login").in("id",ids),
        supabase.from("account_state").select("account_id,account,risk,ea,positions,orders").in("account_id",ids),
        supabase.from("live").select("account_id,balance,equity,bid,ask,updated_at,open").in("account_id",ids)
      ]);
      const err=accounts.error||states.error||lives.error;
      if(err)throw new Error(err.message);
      const stateMap=new Map((states.data||[]).map((x:any)=>[x.account_id,x]));
      const liveMap=new Map((lives.data||[]).map((x:any)=>[x.account_id,x]));
      if(!cancel){setEntries((accounts.data||[]).map((acc:any)=>({acc,state:stateMap.get(acc.id),live:liveMap.get(acc.id)})));setError("");setNow(Date.now());setLoading(false);}
    }catch(e:any){if(!cancel){setError(e?.message||"No se pudieron sincronizar cuentas");setLoading(false);}}
  }
  setLoading(true);void refresh();
  const timer=window.setInterval(refresh,15000);
  return ()=>{cancel=true;window.clearInterval(timer);};
 },[s.me,version]);
 const rows=useMemo(()=>entries.map(x=>summarizeAccount(x.acc,x.live,x.state,now)),[entries,now]);
 const all=useMemo(()=>portfolioTotals(rows),[rows]);
 const badge=(connected:boolean,blocked:boolean)=><span className={"portfolio-status "+(blocked?"blocked":connected?"ok":"stale")}>{blocked?"Bloqueada":connected?"En línea":"Sin sincronización"}</span>;
 return <div className="premium-center portfolio-page">
   <div className="premium-hero"><div><div className="premium-eyebrow">GESTIÓN DE CAPITAL / VISIÓN CONSOLIDADA</div><h1>Gestión de portafolio</h1>
     <p>Exposición agregada y salud del fondeo de todas tus cuentas autorizadas, sin emitir órdenes.</p></div>
     <button className="btn sm" onClick={()=>setVersion(x=>x+1)} disabled={loading}>{loading?"Cargando…":"Sincronizar"}</button>
   </div>
   {error&&<div className="premium-warn">{error}</div>}
   <div className="institutional-metric-grid">
     <MetricCard label="Cuentas vinculadas" value={all.accounts} detail={all.connected+" conectadas recientemente"} evidence="direct"/>
     <MetricCard label="Equity consolidada · USD" value={show(all.equityUsd)} evidence={all.excluded?"estimated":"direct"}
       detail={all.excluded?all.excluded+" cuenta(s) fuera de la suma USD":"Sólo cuentas en USD"}/>
     <MetricCard label="Margen diario*" value={show(all.dailyBufferUsd)} evidence="estimated" detail="Hasta los límites configurados"/>
     <MetricCard label="Riesgo adicional estimado*" value={show(all.estimatedAvailableUsd)}
       tone={all.unprotected||all.estimatedAvailableUsd===null?"caution":"neutral"}
       evidence="estimated" detail={all.unprotected?all.unprotected+" posición(es) sin SL válido":"No incluye gaps ni slippage"}/>
   </div>
   <section className="portfolio-list">
     <div className="portfolio-list-title"><h2>Cuentas vinculadas</h2><span>{rows.length} cuenta(s)</span></div>
     {!rows.length&&!loading&&<p className="premium-note">Todavía no tienes cuentas vinculadas con permisos para consultarlas.</p>}
     {rows.map(x=><div className="portfolio-item" key={x.id}>
       <div className="portfolio-item-head"><div><strong>{x.name}</strong><small>{x.server} · {x.currency}</small></div>{badge(x.connected,!!x.blocked)}</div>
       <div className="portfolio-item-grid">
         <div><span>Equity</span><b>{show(x.equity)}</b></div>
         <div><span>Margen diario*</span><b>{show(x.dailyBuffer)}</b></div>
         <div><span>Margen máximo*</span><b>{show(x.maxBuffer)}</b></div>
         <div><span>Riesgo hasta SL*</span><b className={x.stopRisk===null?"sell":""}>{show(x.stopRisk)}</b></div>
         <div><span>Posiciones / pendientes</span><b>{x.positions} / {x.pending}</b></div>
         <div><span>Sin SL / inválidas</span><b className={x.unprotected?"sell":""}>{x.unprotected}</b></div>
       </div>
       {x.unknown&&<div className="premium-warn">La sincronización está ausente o atrasada; no se debe considerar la cuenta segura sólo por su último saldo.</div>}
       {x.blocked&&<div className="premium-warn">Protección MT5: {x.blocked}</div>}
     </div>)}
   </section>
   <section className="portfolio-list">
     <h2>Alcance de las estimaciones</h2>
     <p className="premium-note">*Son estimaciones de la web, no validaciones del bróker. El patrimonio se agrega sólo si la divisa consta como USD; no se convierte entre monedas. Los stops no contemplan spread futuro, gaps, comisiones ni deslizamiento. Si faltan cotizaciones o hay posiciones no acotadas, el margen neto consolidado se oculta.</p>
     <p className="premium-note">Esta fase habilita supervisión multicuenta. Copiador transaccional, límites de riesgo cruzados e IA autorizadora permanecen bloqueados hasta validar idempotencia de órdenes, ejecución y reglas particulares de cada firma de fondeo.</p>
     <button className="btn sm" onClick={()=>ui.setTab("seguridad")}>Ver conciliación de la cuenta activa</button>
   </section>
 </div>;
}
