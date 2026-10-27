import React,{useEffect,useMemo,useState} from "react";
import {supabase} from "../lib/supabase";
import {useApp,fmt} from "../store";
import {useUI} from "../uiState";
import {MetricCard} from "../components/DashboardPrimitives";
import LoadingState from "../components/LoadingState";
import {summarizeAccount,portfolioTotals,type OwnedAccount,type LiveRow,type StateRow} from "../premium/portfolioRisk";
import {exposureBySymbol,strategyDependence} from "../premium/portfolioDependence";
import {byAccountPerformance,byStrategyPerformance,portfolioInsights,portfolioClosedCurve,
  type PortfolioTrade} from "../premium/portfolioAnalytics";
type Entry={acc:OwnedAccount;live?:LiveRow;state?:StateRow};
const money=(n:number|null)=>n==null||!Number.isFinite(n)?"No disponible":"$"+fmt(n);
const tradeMoney=(n:number)=> (n>=0?"+":"−")+"$"+fmt(Math.abs(n));
const percentage=(v:number|null)=>v==null?"N/D":(v*100).toFixed(1)+"%";
function EquityCurve({points}:{points:{time:number;net:number}[]}) {
 if(!points.length)return <p className="premium-note">Sin operaciones cerradas para construir la curva.</p>;
 const values=[0,...points.map(x=>x.net)],min=Math.min(...values),max=Math.max(...values);
 const span=Math.max(1,max-min),w=1000,h=190;
 const draw=values.map((v,i)=>[32+(i/Math.max(1,values.length-1))*946,18+(1-(v-min)/span)*145]);
 const d=draw.map(([x,y],i)=>(i?"L":"M")+x.toFixed(1)+" "+y.toFixed(1)).join(" ");
 return <div className="pi-curve">
   <svg role="img" aria-label={"Curva acumulada de "+points.length+" cierres MT5, no ajustada por retiros ni depósitos"}
     viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
     <line x1="32" y1={18+(1-(0-min)/span)*145} x2="978" y2={18+(1-(0-min)/span)*145} stroke="#46535e" strokeDasharray="5 7"/>
     <path d={d} fill="none" stroke="#d6b77f" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinejoin="round"/>
     {draw.length>1&&<circle cx={draw[draw.length-1][0]} cy={draw[draw.length-1][1]} r="4" fill="#d6b77f"/>}
   </svg>
   <div><span>Primer cierre: {new Date(points[0].time*1000).toLocaleDateString("es-DO",{timeZone:"UTC"})}</span>
     <b className={points[points.length-1].net>=0?"buy":"sell"}>{tradeMoney(points[points.length-1].net)}</b>
     <span>Último: {new Date(points[points.length-1].time*1000).toLocaleDateString("es-DO",{timeZone:"UTC"})}</span></div>
 </div>;
}
export default function PortfolioCockpit(){
 const {s}=useApp(),ui=useUI();
 const [entries,setEntries]=useState<Entry[]>([]);
 const [trades,setTrades]=useState<PortfolioTrade[]>([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState("");
 const [now,setNow]=useState(Date.now()),[reload,setReload]=useState(0);
 const [activeId,setActiveId]=useState("all");
 const [panel,setPanel]=useState<"overview"|"strategies"|"risk"|"dependence">("overview");
 const [capped,setCapped]=useState(false);
 useEffect(()=>{
   let cancelled=false;
   async function refresh(){
     try{
       const {data:user,error:authError}=await supabase.auth.getUser();
       if(authError||!user.user)throw new Error("Inicia sesión para consultar tus cuentas autorizadas.");
       const {data:members,error:memberError}=await supabase.from("account_members").select("account_id").eq("user_id",user.user.id);
       if(memberError)throw new Error(memberError.message);
       const ids=(members||[]).map(x=>x.account_id);
       if(!ids.length){if(!cancelled){setEntries([]);setTrades([]);setError("");setLoading(false);}return;}
       const [accounts,states,lives,closed]=await Promise.all([
         supabase.from("accounts").select("id,name,server,login,symbol").in("id",ids),
         supabase.from("account_state").select("account_id,account,risk,ea,positions,orders").in("account_id",ids),
         supabase.from("live").select("account_id,balance,equity,bid,ask,updated_at,open").in("account_id",ids),
         supabase.from("trades").select("id,account_id,ticket,strategy,source,t_close,status,pnl,r,lots,side")
           .in("account_id",ids).not("t_close","is",null).order("t_close",{ascending:false}).limit(1000),
       ]);
       const failure=accounts.error||states.error||lives.error||closed.error;
       if(failure)throw new Error(failure.message);
       const byState=new Map((states.data||[]).map(x=>[x.account_id,x]));
       const byLive=new Map((lives.data||[]).map(x=>[x.account_id,x]));
       if(!cancelled){
         setEntries((accounts.data||[]).map(acc=>({acc,state:byState.get(acc.id),live:byLive.get(acc.id)})));
         setTrades((closed.data||[]) as PortfolioTrade[]);
         setCapped((closed.data||[]).length===1000);
         setError("");setNow(Date.now());setLoading(false);
       }
     }catch(e:any){if(!cancelled){setError(e?.message||"No se pudo consultar el portafolio");setLoading(false);}}
   }
   if(reload)setLoading(true);
   void refresh();const timer=window.setInterval(refresh,30000);
   return ()=>{cancelled=true;window.clearInterval(timer);};
 },[s.me,reload]);
 const allRows=useMemo(()=>entries.map(x=>summarizeAccount(x.acc,x.live,x.state,now)),[entries,now]);
 const visible=useMemo(()=>activeId==="all"?allRows:allRows.filter(x=>x.id===activeId),[allRows,activeId]);
 const totals=useMemo(()=>portfolioTotals(visible),[visible]);
 const visibleTrades=useMemo(()=>activeId==="all"?trades:trades.filter(x=>x.account_id===activeId),[trades,activeId]);
 const perf=useMemo(()=>byAccountPerformance(visibleTrades,visible.map(x=>x.id)),[visibleTrades,visible]);
 const strategies=useMemo(()=>byStrategyPerformance(visibleTrades),[visibleTrades]);
 const insights=useMemo(()=>portfolioInsights(visible,perf),[visible,perf]);
 const curve=useMemo(()=>portfolioClosedCurve(visibleTrades),[visibleTrades]);
 const filteredEntries=useMemo(()=>activeId==="all"?entries:entries.filter(x=>x.acc.id===activeId),[entries,activeId]);
 const exposures=useMemo(()=>exposureBySymbol(filteredEntries),[filteredEntries,now]);
 const correlations=useMemo(()=>strategyDependence(visibleTrades),[visibleTrades]);
 const nTrades=perf.reduce((a,b)=>a+b.trades,0),realized=perf.reduce((a,b)=>a+b.net,0);
 const winners=perf.reduce((a,b)=>a+b.wins,0),wins=nTrades?winners/nTrades:null;
 const displayEquity=totals.usdAccounts&&visible.every(x=>x.connected&&!x.unknown)&&totals.excluded===0?totals.equityUsd:null;
 return <div className="premium-center portfolio-page pi-workspace" aria-busy={loading}>
   <div className="premium-hero"><div><div className="premium-eyebrow">PORTFOLIO INTELLIGENCE / CAPITAL COMMAND</div>
     <h1>Inteligencia de portafolio</h1><p>Capital, estrategias y riesgo consolidado, con evidencias verificables de MT5.</p></div>
     <button className="btn sm" disabled={loading} onClick={()=>setReload(x=>x+1)}>{loading?"Sincronizando…":"Actualizar datos"}</button>
   </div>
   {error&&<div className="premium-warn" role="alert">{error} · No se actualizarán los datos hasta restablecer la conexión.</div>}
   {loading&&<LoadingState label="Cargando cartera y cierres registrados…"/>}
   <div className="pi-topbar">
     <div className="pi-tabs" role="tablist" aria-label="Secciones del portafolio">
       {([["overview","Capital"],["strategies","Estrategias"],["risk","Riesgo"],["dependence","Dependencia"] ] as const).map(([key,label])=>
         <button key={key} role="tab" aria-selected={panel===key} className={panel===key?"on":""} onClick={()=>setPanel(key)}>{label}</button>)}
     </div>
     <label className="pi-account-filter">Cuenta
       <select aria-label="Seleccionar cuenta del portafolio" value={activeId} onChange={e=>setActiveId(e.target.value)}>
         <option value="all">Todas las cuentas</option>
         {entries.map(x=><option value={x.acc.id} key={x.acc.id}>{x.acc.name}</option>)}
       </select>
     </label>
   </div>
   <div className="institutional-metric-grid">
     <MetricCard label="Equity sincronizada · USD" value={money(displayEquity)}
       evidence={displayEquity===null?"unverified":"direct"} detail={totals.excluded?"Sólo divisa USD, sin conversiones":"Requiere cuentas sincronizadas"}/>
     <MetricCard label="P&L de cierres registrados" value={nTrades?tradeMoney(realized):"Sin cierres"}
       tone={realized>0?"positive":realized<0?"negative":"neutral"} evidence={nTrades?"historical":"unverified"}
       detail={nTrades+" operaciones · no incluye movimientos de capital"}/>
     <MetricCard label="Riesgo hasta SL · USD" value={totals.stopRiskUsd===null?"No acotado":money(totals.stopRiskUsd)}
       evidence="estimated" tone={totals.unprotected?"caution":"neutral"} detail={totals.unprotected?totals.unprotected+" sin SL válido":"Estimación de posiciones abiertas"}/>
     <MetricCard label="Salud de cuentas" value={totals.connected+" / "+totals.accounts}
       evidence="direct" tone={totals.connected===totals.accounts?"positive":"caution"} detail="Puentes con datos recientes"/>
   </div>
   {capped&&<div className="premium-warn">El histórico alcanzó el límite de 1,000 cierres consultados. Los resultados representan únicamente los últimos registros disponibles.</div>}
   {panel==="overview"&&<>
     <section className="portfolio-list">
       <header className="pi-section-head"><div><span>RENDIMIENTO REGISTRADO</span><h2>Curva de operaciones cerradas</h2></div>
         <small>Sin depósitos, retiros ni beneficios flotantes</small></header>
       <EquityCurve points={curve}/>
       <div className="pi-smallmetrics">
         <div><span>Operaciones cerradas</span><b>{nTrades}</b></div>
         <div><span>Frecuencia ganadora</span><b>{percentage(wins)}</b></div>
         <div><span>Promedio por cierre</span><b>{nTrades?tradeMoney(realized/nTrades):"N/D"}</b></div>
         <div><span>Drawdown de P&L</span><b>{nTrades?money(perf.reduce((a,x)=>a+x.maxClosedTradeDrawdown,0)):"N/D"}</b></div>
       </div>
       <p className="premium-note">El drawdown mostrado es la suma de drawdowns individuales por cuenta sobre operaciones cerradas; no equivale al máximo drawdown simultáneo del portafolio ni al de equity intradía.</p>
     </section>
     <section className="portfolio-list">
       <header className="pi-section-head"><div><span>CAPITAL BAJO SUPERVISIÓN</span><h2>Cuentas conectadas</h2></div><small>{visible.length} cuenta(s)</small></header>
       {!visible.length&&!loading&&<p className="premium-note">No se encontraron cuentas vinculadas. Usa Ajustes para conectar una cuenta autorizada.</p>}
       {visible.map(x=>{
         const p=perf.find(v=>v.accountId===x.id);
         return <div className="portfolio-item" key={x.id}>
           <div className="portfolio-item-head"><div><strong>{x.name}</strong><small>{x.server} · {x.currency}</small></div>
             <span className={"portfolio-status "+(!x.connected?"stale":x.blocked?"blocked":"ok")}>
               {!x.connected?"Sin sincronizar":x.blocked?"Protección activa":"Conectada"}</span></div>
           <div className="portfolio-item-grid">
             <div><span>Equity</span><b>{x.connected?money(x.equity):"Dato desactualizado"}</b></div>
             <div><span>Margen diario*</span><b>{x.connected?money(x.dailyBuffer):"N/D"}</b></div>
             <div><span>Riesgo al SL*</span><b>{money(x.stopRisk)}</b></div>
             <div><span>P&L registrado</span><b>{p?.trades?tradeMoney(p.net):"Sin cierres"}</b></div>
             <div><span>Cierres</span><b>{p?.trades||0}</b></div>
             <div><span>Posiciones / pendientes</span><b>{x.positions} / {x.pending}</b></div>
           </div>
           {(x.unknown||x.unprotected>0)&&<div className="premium-warn">
             {x.unprotected>0?x.unprotected+" posición(es) sin stop válido. ":""}
             {x.unknown?"Datos desconectados u obsoletos. Confirma en MT5.":""}</div>}
         </div>;
       })}
     </section>
   </>}
   {panel==="strategies"&&<section className="portfolio-list">
     <header className="pi-section-head"><div><span>RENDIMIENTO POR SISTEMA</span><h2>Contribución de estrategias</h2></div>
       <small>Solo cierres MT5 registrados</small></header>
     {!strategies.length?<p className="premium-note">Sin operaciones cerradas con estrategia identificable.</p>:
     <div className="pi-table-scroll"><table className="pi-table"><thead><tr><th>Estrategia</th><th>Cierres</th><th>P&L</th><th>Win rate</th><th>Profit factor</th><th>Expectativa</th></tr></thead>
       <tbody>{strategies.map(x=><tr key={x.strategy}>
         <td><strong>{x.strategy}</strong><small>{x.accountCount} cuenta(s)</small></td>
         <td>{x.trades}</td><td className={x.net>=0?"buy":"sell"}>{tradeMoney(x.net)}</td>
         <td>{percentage(x.winRate)}</td>
         <td>{x.profitFactor==null?"N/D":x.profitFactor.toFixed(2)}</td>
         <td>{x.avgPerTrade==null?"N/D":tradeMoney(x.avgPerTrade)}</td>
       </tr>)}</tbody></table></div>}
     <p className="premium-note">La muestra actual es limitada. El profit factor N/D indica que no hay pérdidas registradas para calcular el denominador; no significa rendimiento infinito. No se modifica el riesgo de ninguna estrategia.</p>
   </section>}
   {panel==="risk"&&<>
     <section className="portfolio-list">
       <header className="pi-section-head"><div><span>RISK GUARDIAN</span><h2>Alertas del portafolio</h2></div>
         <small>{insights.length} observaciones</small></header>
       {insights.length?insights.map(x=><div className={"pi-alert "+x.level} key={x.key}>
         <strong>{x.title}</strong><span>{x.detail}</span></div>):
         <p className="premium-note">No se detectaron alertas en la última telemetría consultada. Esto no garantiza ausencia de riesgo.</p>}
     </section>
     <section className="portfolio-list">
       <header className="pi-section-head"><div><span>EXPOSICIÓN POR CUENTA</span><h2>Margen disponible estimado</h2></div>
         <small>Controles del bróker siguen siendo definitivos</small></header>
       <div className="pi-table-scroll"><table className="pi-table"><thead><tr><th>Cuenta</th><th>Saldo</th><th>Colchón diario*</th><th>Colchón máximo*</th><th>SL*</th><th>Sin SL</th></tr></thead>
         <tbody>{visible.map(x=><tr key={x.id}><td>{x.name}</td><td>{money(x.balance)}</td>
           <td>{money(x.dailyBuffer)}</td><td>{money(x.maxBuffer)}</td>
           <td>{money(x.stopRisk)}</td><td className={x.unprotected?"sell":""}>{x.unprotected}</td></tr>)}</tbody></table></div>
       <button className="btn sm" onClick={()=>ui.setTab("seguridad")}>Ver conciliación de operaciones</button>
     </section>
   </>}
   {panel==="dependence"&&<>
      <section className="portfolio-list">
        <header className="pi-section-head"><div><span>GLOBAL RISK ENGINE</span><h2>Exposición simultánea por instrumento</h2></div>
          <small>Solo posiciones MT5 abiertas, sin ejecutar órdenes</small></header>
        {!exposures.length&&<p className="premium-note">No hay posiciones abiertas que permitan evaluar exposición simultánea.</p>}
        {exposures.map(x=><div className="pi-exposure" key={x.symbol}>
          <div className="pi-exposure-head"><strong>{x.symbol}</strong><span>{x.positionCount} posición(es) · {x.accountCount} cuenta(s)</span></div>
          <div className="pi-exposure-sides"><div><span>Lotes en compra</span><b className="buy">{x.buyLots.toFixed(2)}</b></div>
            <div><span>Lotes en venta</span><b className="sell">{x.sellLots.toFixed(2)}</b></div>
            <div><span>Exposición bruta (USD)*</span><b>{money(x.grossNotionalUsd)}</b></div>
            <div><span>Exposición neta (USD)*</span><b>{money(x.netNotionalUsd)}</b></div></div>
          {x.accountCount>1&&<div className="pi-alert warning"><strong>Posible concentración multicuenta</strong>
            <span>{x.notice} Verifica las configuraciones del copiador y los stops individuales.</span></div>}
          {x.missingData>0&&<p className="premium-note">Hay {x.missingData} posición(es) con divisa, contrato, cotización o actualización no verificable. Se oculta el nominal total.</p>}
          <p className="premium-note">Cuentas: {x.accountNames.join(", ")}. Una compra y una venta en cuentas distintas no eliminan las restricciones de pérdida de cada una.</p>
        </div>)}
        <p className="premium-note">*Valor nocional aproximado = precio Bid/Ask × volumen × contrato del bróker. No equivale a la pérdida posible al SL. No se convierte entre divisas ni se calcula cuando la telemetría es obsoleta.</p>
      </section>
      <section className="portfolio-list">
        <header className="pi-section-head"><div><span>STRATEGY DEPENDENCY</span><h2>Dependencia histórica entre estrategias</h2></div>
          <small>Mínimo 20 días con cierres de ambos sistemas</small></header>
        {!correlations.length?<p className="premium-note">Aún no existen dos estrategias con cierres registrados para comparar.</p>:
         <div className="pi-table-scroll"><table className="pi-table"><thead><tr><th>Estrategias</th><th>Días compartidos</th><th>Correlación</th><th>Lectura</th></tr></thead>
           <tbody>{correlations.map(x=><tr key={x.a+"-"+x.b}><td>{x.a} / {x.b}</td>
             <td>{x.sharedActiveDays}</td>
             <td>{x.r==null?"N/D":x.r.toFixed(2)}</td><td>{x.status==="observed"?"Estimación descriptiva":"Muestra insuficiente"}</td>
           </tr>)}</tbody></table></div>}
        <p className="premium-note">Solo se comparan los días en que ambas estrategias tuvieron cierres. Esto no prueba correlación de entradas intradía ni independencia futura. Con muestras insuficientes no se muestra una correlación fabricada.</p>
      </section>
   </>}
   <section className="portfolio-list pi-disclaimer">
     <h2>Integridad financiera y alcance</h2>
     <p>Las cifras de posiciones y márgenes son estimaciones de la web; no sustituyen los límites del bróker ni de la firma. P&L histórico procede de cierres MT5 disponibles y puede omitir comisiones, swaps o movimientos no sincronizados.</p>
     <p><strong>Depósitos, retiros y comisiones de evaluaciones:</strong> aún no están registrados en un libro de movimientos. No se calculan retiradas ni rentabilidad sobre capital invertido a partir de cambios de equity.</p>
   </section>
 </div>;
}
