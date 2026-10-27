/** Explainable, read-only portfolio Guardian: no predictive AI, no trade permission.
 * Every warning exposes its observed evidence and proposed MANUAL check.
 */
import type {PortfolioRow} from "./portfolioRisk";
import type {PositionGroup,PairDependence} from "./portfolioDependence";
import type {AccountPerformance} from "./portfolioAnalytics";
export type GuardianFinding={
 id:string;severity:"critical"|"warning"|"review"|"info";heading:string;evidence:string;action:string;
 source:"mt5_live"|"closed_trades"|"derived"|"incomplete";
};
export function guardianFindings(
 accounts:readonly PortfolioRow[],exposures:readonly PositionGroup[],
 correlations:readonly PairDependence[],perf:readonly AccountPerformance[]
):GuardianFinding[]{
 const found:GuardianFinding[]=[];
 const add=(x:GuardianFinding)=>found.push(x);
 for(const a of accounts){
   if(a.unprotected>0)add({id:"stop:"+a.id,severity:"critical",
     heading:"Exposición sin stop válido",
     evidence:a.name+": "+a.unprotected+" posición(es) no tienen pérdida acotable con los datos MT5 actuales.",
     action:"Revisar las posiciones en MT5 y las protecciones efectivas antes de asumir nuevo riesgo.",
     source:"mt5_live"});
   if(a.blocked)add({id:"guard:"+a.id,severity:"critical",heading:"Control de fondeo activo",
     evidence:a.name+": el puente ha reportado un bloqueo.",action:"Revisar el motivo directamente en el EA; no reactivar automáticamente.",
     source:"mt5_live"});
   if(!a.connected||a.unknown)add({id:"stale:"+a.id,severity:"warning",
     heading:"Datos no actualizados",
     evidence:a.name+": la cuenta no tiene sincronización reciente o falta información indispensable.",
     action:"Comprobar la conexión MT5 antes de utilizar los márgenes mostrados.",source:"incomplete"});
   if(a.connected&&a.stopRisk!==null&&a.dailyBuffer!==null&&a.stopRisk>a.dailyBuffer&&a.stopRisk>0)
     add({id:"limit:"+a.id,severity:"critical",heading:"Exposición supera colchón diario",
       evidence:a.name+": pérdida hasta SL estimada de "+a.stopRisk.toFixed(2)+" USD frente a colchón de "+a.dailyBuffer.toFixed(2)+" USD.",
       action:"Revisar el riesgo autorizado por el bróker y la firma. La cifra web es orientativa.",source:"derived"});
 }
 for(const p of exposures){
   if(p.accountCount>1&&p.positionCount>1)
     add({id:"cluster:"+p.symbol,severity:"warning",heading:"Concentración en "+p.symbol,
       evidence:p.positionCount+" posiciones de "+p.accountCount+" cuentas comparten instrumento; riesgo de impacto simultáneo.",
       action:"Comprobar replicación, direcciones y stops en cada cuenta, aunque haya posiciones opuestas.",source:"mt5_live"});
   if(p.missingData>0)add({id:"incomplete:"+p.symbol,severity:"review",
     heading:"Nocional no verificable en "+p.symbol,evidence:p.missingData+" posición(es) con datos de contrato, precio o divisa incompletos.",
     action:"No estimar exposición nominal consolidada hasta restablecer información del bróker.",source:"incomplete"});
 }
 for(const pair of correlations){
   if(pair.r!==null&&Math.abs(pair.r)>=.7)
     add({id:"corr:"+pair.a+":"+pair.b,severity:"review",
       heading:"Dependencia histórica elevada",
       evidence:pair.a+" / "+pair.b+" muestran r="+pair.r.toFixed(2)+" en "+pair.sharedActiveDays+" días con cierres de ambos sistemas.",
       action:"Evaluar en walk-forward; no reducir ni aumentar riesgo automáticamente a partir de una correlación de cierres.",source:"closed_trades"});
 }
 const tradeCount=perf.reduce((s,p)=>s+p.trades,0);
 if(tradeCount<80)add({id:"sample",severity:"info",heading:"Validación estadística limitada",
   evidence:tradeCount+" cierres completos disponibles en el filtro actual; debajo de 80 para escenarios por bloques.",
   action:"Recolectar más operaciones y sesiones antes de elegir pesos óptimos de estrategias.",source:"closed_trades"});
 if(!accounts.length)add({id:"empty",severity:"info",heading:"Ninguna cuenta visible",
   evidence:"No existen cuentas autorizadas en esta selección.",
   action:"Conectar una cuenta o seleccionar todas las cuentas.",source:"incomplete"});
 return found.sort((a,b)=>({critical:0,warning:1,review:2,info:3}[a.severity]-{critical:0,warning:1,review:2,info:3}[b.severity]));
}
