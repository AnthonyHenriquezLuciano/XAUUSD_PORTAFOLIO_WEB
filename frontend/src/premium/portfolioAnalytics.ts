/** Auditable portfolio statistics over CLOSED deals reported by the existing MT5 bridge.
 * Never infer cash deposits/withdrawals from changes in account balance or equity.
 * No financial transactions are created and none of these numbers authorise trading.
 */
export type PortfolioTrade = {
  id:number;account_id:string;ticket:number|null;strategy:string|null;source:string|null;
  t_close:number|null;status:string|null;pnl:number|null; r:number|null;lots:number|null;side:number|null
};
export type AccountPerformance = {
  accountId:string;trades:number;net:number;wins:number;losses:number;breakeven:number;
  winRate:number|null;grossWins:number;grossLosses:number;profitFactor:number|null;
  expectancy:number|null;maxClosedTradeDrawdown:number;firstClose:number|null;lastClose:number|null;
};
export type StrategyPerformance = {
  strategy:string;trades:number;net:number;wins:number;winRate:number|null;
  profitFactor:number|null;avgPerTrade:number|null;accountCount:number;meanR:number|null;
};
const finite=(x:unknown):x is number=>typeof x==="number"&&Number.isFinite(x);
const closed=(t:PortfolioTrade)=>finite(t.t_close)&&t.t_close>0&&finite(t.pnl);
const r2=(v:number)=>Math.round(v*100)/100;
const valid=(trades:readonly PortfolioTrade[])=>trades.filter(closed);
export function byAccountPerformance(trades:readonly PortfolioTrade[],accountIds:string[]):AccountPerformance[]{
 return accountIds.map(accountId=>{
   const rows=valid(trades).filter(t=>t.account_id===accountId).sort((a,b)=>(a.t_close!)-(b.t_close!));
   let net=0,grossWins=0,grossLosses=0,wins=0,losses=0,peak=0,drawdown=0;
   for(const t of rows){
      net+=t.pnl!;
      if(t.pnl!>0){wins++;grossWins+=t.pnl!;}else if(t.pnl!<0){losses++;grossLosses-=t.pnl!;}
      peak=Math.max(0,peak,net);
      drawdown=Math.max(drawdown,peak-net);
   }
   return {accountId,trades:rows.length,net:r2(net),wins,losses,breakeven:rows.length-wins-losses,
     winRate:rows.length?wins/rows.length:null,grossWins:r2(grossWins),grossLosses:r2(grossLosses),
     profitFactor:grossLosses>0?grossWins/grossLosses:null,
     expectancy:rows.length?r2(net/rows.length):null,maxClosedTradeDrawdown:r2(drawdown),
     firstClose:rows.length?rows[0].t_close:null,lastClose:rows.length?rows[rows.length-1].t_close:null};
 });
}
export function byStrategyPerformance(trades:readonly PortfolioTrade[]):StrategyPerformance[]{
 const groups=new Map<string,PortfolioTrade[]>();
 for(const t of valid(trades)){
   const name=(t.strategy||t.source||"Sin estrategia").trim()||"Sin estrategia";
   groups.set(name,[...(groups.get(name)||[]),t]);
 }
 return [...groups.entries()].map(([strategy,rows])=>{
   const wins=rows.filter(t=>t.pnl!>0);
   const losses=rows.filter(t=>t.pnl!<0);
   const grossWins=wins.reduce((s,t)=>s+t.pnl!,0);
   const grossLosses=-losses.reduce((s,t)=>s+t.pnl!,0);
   const net=rows.reduce((s,t)=>s+t.pnl!,0);
   const rs=rows.map(t=>t.r).filter(finite);
   return {strategy,trades:rows.length,net:r2(net),wins:wins.length,winRate:rows.length?wins.length/rows.length:null,
     profitFactor:grossLosses>0?grossWins/grossLosses:null,avgPerTrade:rows.length?r2(net/rows.length):null,
     meanR:rs.length?r2(rs.reduce((s,v)=>s+v,0)/rs.length):null,
     accountCount:new Set(rows.map(t=>t.account_id)).size};
 }).sort((a,b)=>b.trades-a.trades||a.strategy.localeCompare(b.strategy));
}
export type PortfolioInsight={level:"critical"|"warning"|"info";key:string;title:string;detail:string};
export function portfolioInsights(accounts:Array<{
  id:string;connected:boolean;unknown:boolean;unprotected:number;blocked:string|null;
  dailyBuffer:number|null;equity:number|null;stopRisk:number|null;positions:number;
}>,performance:AccountPerformance[]):PortfolioInsight[]{
 const out:PortfolioInsight[]=[];
 for(const a of accounts) {
   if(a.unprotected>0)out.push({level:"critical",key:a.id+":noSL",title:"Posición sin riesgo acotado",
     detail:a.unprotected+" posición(es) sin SL válido en esta cuenta. Verificar directamente en MT5."});
   if(a.blocked)out.push({level:"critical",key:a.id+":blocked",title:"Guarda de fondeo activada",
     detail:"El EA reporta una restricción activa. Consulta el terminal antes de operar."});
   if(!a.connected||a.unknown)out.push({level:"warning",key:a.id+":stale",title:"Telemetría no confiable",
     detail:"Esta cuenta está desconectada, desactualizada o sin equity válida."});
   if(a.connected&&a.dailyBuffer!=null&&a.stopRisk!=null&&a.positions>0&&a.dailyBuffer<=a.stopRisk)
     out.push({level:"warning",key:a.id+":buffer",title:"Riesgo estimado consume el margen",
       detail:"La exposición hasta SL iguala o supera la distancia al límite diario configurado."});
 }
 if(performance.reduce((n,p)=>n+p.trades,0)<30)out.push({level:"info",key:"smallSample",title:"Estadística aún exploratoria",
   detail:"Hay menos de 30 cierres completos: no se recomienda inferir ventaja ni optimizar asignaciones."});
 if(!accounts.length)out.push({level:"info",key:"noAccounts",title:"Sin cuentas vinculadas",
   detail:"Vincula una cuenta MT5 autorizada para visualizar exposición y resultados."});
 return out.sort((a,b)=>({critical:0,warning:1,info:2}[a.level]-{critical:0,warning:1,info:2}[b.level]));
}
export type CurvePoint={time:number;net:number;count:number};
export function portfolioClosedCurve(trades:readonly PortfolioTrade[]):CurvePoint[]{
 const sorted=valid(trades).slice().sort((a,b)=>(a.t_close!)-(b.t_close!)||a.id-b.id);
 const points:CurvePoint[]=[];let sum=0;
 for(const t of sorted){
   sum+=t.pnl!;
   const last=points[points.length-1];
   if(last?.time===t.t_close){last.net=r2(sum);last.count++;}
   else points.push({time:t.t_close!,net:r2(sum),count:1});
 }
 return points;
}
