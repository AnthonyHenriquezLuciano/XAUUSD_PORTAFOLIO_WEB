/** Descriptive cross-account XAU exposure and closed-P&L dependency.
 * No claims of "hedging" when instruments or account currencies are unknown.
 * This module never submits or mutates orders.
 */
import type {PortfolioTrade} from "./portfolioAnalytics";
import type {OwnedAccount,LiveRow,StateRow} from "./portfolioRisk";
export type PositionGroup={
 symbol:string;accountCount:number;positionCount:number;
 buyLots:number;sellLots:number;grossNotionalUsd:number|null;netNotionalUsd:number|null;
 missingData:number;accountNames:string[];notice:string;
};
const isNum=(x:unknown):x is number=>typeof x==="number"&&Number.isFinite(x);
const validNumber=(x:unknown)=>isNum(x)&&x>0;
const round=(v:number)=>Math.round(v*100)/100;
export function exposureBySymbol(entries:{acc:OwnedAccount;live?:LiveRow;state?:StateRow}[]):PositionGroup[]{
 const groups=new Map<string,{buy:number;sell:number;gross:number;net:number;unknown:number;n:number;accounts:Set<string>}>();
 for(const e of entries){
   const positions=Array.isArray(e.state?.positions)?e.state!.positions!:[];
   for(const p of positions){
     const symbol=String(p.symbol||e.acc.symbol||"SIN INSTRUMENTO").trim().toUpperCase();
     const g=groups.get(symbol)||{buy:0,sell:0,gross:0,net:0,unknown:0,n:0,accounts:new Set<string>()};
     g.n++;g.accounts.add(e.acc.name);
     const side=Number(p.side),lots=Number(p.volume),contract=Number(e.state?.ea?.contract),currency=e.state?.account?.currency;
     const quote=side===1?Number(e.live?.bid):side===-1?Number(e.live?.ask):NaN;
     const updated=e.live?.updated_at?Date.parse(e.live.updated_at):NaN;
     // Do not present an amount as "current" if feed is stale or denominator is unknown.
     const fresh=Number.isFinite(updated)&&Date.now()-updated<=15000;
     if(!validNumber(lots)||![1,-1].includes(side)){g.unknown++;groups.set(symbol,g);continue;}
     if(side===1)g.buy+=lots;else g.sell+=lots;
     if(!fresh||!validNumber(contract)||!validNumber(quote)||currency!=="USD"){
       g.unknown++;groups.set(symbol,g);continue;
     }
     const value=lots*contract*quote;
     g.gross+=value;g.net+=side*value;
     groups.set(symbol,g);
   }
 }
 return [...groups.entries()].map(([symbol,g])=>({
   symbol,accountCount:g.accounts.size,positionCount:g.n,buyLots:round(g.buy),
   sellLots:round(g.sell),grossNotionalUsd:g.unknown?null:round(g.gross),
   netNotionalUsd:g.unknown?null:round(g.net),missingData:g.unknown,
   accountNames:[...g.accounts],notice:g.accounts.size>1?
     "Múltiples cuentas sobre el mismo instrumento; una señal replicada amplifica pérdidas simultáneas.":
     "La exposición de la cuenta no equivale por sí sola al riesgo al stop."
 })).sort((a,b)=>b.positionCount-a.positionCount);
}
export type PairDependence={
 a:string;b:string;sharedActiveDays:number;r:number|null;status:"observed"|"insufficient";
 reason:string;
};
const day=(ts:number)=>Math.floor(ts/86400);
export function strategyDependence(trades:readonly PortfolioTrade[],minDays=20):PairDependence[]{
 const byName=new Map<string,Map<number,number>>();
 for(const t of trades){
   if(!isNum(t.t_close)||t.t_close<=0||!isNum(t.pnl))continue;
   const name=String(t.strategy||t.source||"Sin estrategia").trim();
   const daily=byName.get(name)||new Map<number,number>(),k=day(t.t_close);
   daily.set(k,(daily.get(k)||0)+t.pnl);byName.set(name,daily);
 }
 const names=[...byName.keys()].sort(),out:PairDependence[]=[];
 for(let i=0;i<names.length;i++)for(let j=i+1;j<names.length;j++){
   const a=byName.get(names[i])!,b=byName.get(names[j])!;
   const shared=[...a.keys()].filter(d=>b.has(d)),xs=shared.map(d=>a.get(d)!),ys=shared.map(d=>b.get(d)!);
   const n=shared.length;
   const mx=xs.reduce((s,v)=>s+v,0)/Math.max(1,n),my=ys.reduce((s,v)=>s+v,0)/Math.max(1,n);
   const dot=xs.reduce((s,v,k)=>s+(v-mx)*(ys[k]-my),0);
   const xx=xs.reduce((s,v)=>s+(v-mx)**2,0),yy=ys.reduce((s,v)=>s+(v-my)**2,0);
   const valid=n>=minDays&&xx>0&&yy>0;
   out.push({a:names[i],b:names[j],sharedActiveDays:n,
     r:valid?round(dot/Math.sqrt(xx*yy)):null,
     status:valid?"observed":"insufficient",
     reason:valid?"Correlación condicional del P&L diario cuando ambas estrategias tuvieron cierres; no mide independencia de señales intradía.":
       "No hay al menos "+minDays+" días compartidos con varianza suficiente; correlación no estimable."});
 }
 return out;
}
