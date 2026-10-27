/** Portfolio research and funded account scenario planning.
 * Block bootstrap is an EXPLORATORY historical scenario tool, not a guaranteed
 * future pass rate. Disabled if data is sparse, because copied trades are dependent.
 */
import type {PortfolioTrade} from "./portfolioAnalytics";
const finite=(n:unknown):n is number=>typeof n==="number"&&Number.isFinite(n);
const pctl=(arr:number[],p:number)=>{const v=arr.slice().sort((a,b)=>a-b);return v.length?v[Math.min(v.length-1,Math.max(0,Math.floor((v.length-1)*p)))]:null;};
const round=(n:number)=>Math.round(n*100)/100;
export type BootstrapStudy={
  eligible:boolean;closings:number;activeDays:number;trainingDays:number;holdoutDays:number;
  horizonDays:number;paths:number;p05:number|null;p50:number|null;p95:number|null;
  maxDrawdownP95:number|null;breachFrequency:number|null;
  targetFrequency:number|null;holdoutAvgPerDay:number|null;
  reason:string;method:string;
};
export function portfolioBootstrap(trades:readonly PortfolioTrade[],{
 balance=5000,horizonDays=20,lossPct=10,targetPct=8,paths=750,seed=20261026,
}:{balance?:number;horizonDays?:number;lossPct?:number;targetPct?:number;paths?:number;seed?:number}={}):BootstrapStudy{
 const rows=trades.filter(t=>finite(t.t_close)&&t.t_close>0&&finite(t.pnl)).slice()
   .sort((a,b)=>(a.t_close!)-(b.t_close!));
 const days=new Map<number,number>();
 for(const t of rows){
   const day=Math.floor(t.t_close!/86400);
   days.set(day,(days.get(day)||0)+t.pnl!);
 }
 const daily=[...days.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
 const trainN=Math.floor(daily.length*.7),valN=daily.length-trainN;
 const base:BootstrapStudy={eligible:false,closings:rows.length,activeDays:daily.length,
   trainingDays:trainN,holdoutDays:valN,horizonDays,paths:0,p05:null,p50:null,p95:null,
   maxDrawdownP95:null,breachFrequency:null,targetFrequency:null,holdoutAvgPerDay:null,
   reason:"No hay suficiente historial para un escenario por bloques: mínimo 80 cierres y 40 días activos.",
   method:"Bootstrap circular de bloques de cinco días sobre el 70% más antiguo; 30% reciente reservado. P&L nominal en USD, sin escalar lotes ni modelar comisiones/funding."};
 if(rows.length<80||daily.length<40||!finite(balance)||balance<=0||lossPct<=0||lossPct>=100||targetPct<=0||horizonDays<5||horizonDays>250||paths<100||paths>2000)return base;
 const train=daily.slice(0,trainN),val=daily.slice(trainN);
 if(train.length<25||val.length<10)return base;
 let state=(seed>>>0)||1;
 const rng=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
 const results:number[]=[],drawdowns:number[]=[];
 let breached=0,targets=0;
 for(let k=0;k<paths;k++){
   let equity=balance,high=balance,dd=0,failed=false,passed=false;
   for(let i=0;i<horizonDays;){
     const start=Math.floor(rng()*train.length);
     for(let z=0;z<5&&i<horizonDays;z++,i++){
       equity+=train[(start+z)%train.length];
       high=Math.max(high,equity);
       dd=Math.max(dd,high-equity);
       if(equity<=balance*(1-lossPct/100))failed=true;
       if(equity>=balance*(1+targetPct/100))passed=true;
     }
   }
   results.push(equity-balance);drawdowns.push(dd);
   if(failed)breached++;
   if(passed)targets++;
 }
 return {...base,eligible:true,paths,p05:round(pctl(results,.05)!),p50:round(pctl(results,.5)!),
   p95:round(pctl(results,.95)!),maxDrawdownP95:round(pctl(drawdowns,.95)!),
   breachFrequency:round(breached/paths),targetFrequency:round(targets/paths),
   holdoutAvgPerDay:round(val.reduce((s,v)=>s+v,0)/val.length),
   reason:"Escenarios descriptivos de resultados pasados, NO probabilidades de aprobar cuentas. Faltan drawdown intradía, costes y reglas completas de cada firma."};
}
export type ScalingPlan={
 nominalFunded:number;newNominal:number;monthlyGross:number;monthlyWithdrawEstimate:number;
 perAccountMonthly:number;monthlyRate:number;months:number;
 cost:number|null;grossWithdrawHorizon:number;afterPurchaseFees:number|null;
 breakEvenMonths:number|null;valid:boolean;reason:string;
};
export function scalingScenario({
 existing=5000,accounts25=2,accounts50=0,fee25=null,fee50=null,ratePct=5,splitPct=80,months=12
}:{existing?:number;accounts25?:number;accounts50?:number;fee25?:number|null;fee50?:number|null;ratePct?:number;splitPct?:number;months?:number}={}):ScalingPlan{
 const valid=Number.isFinite(existing)&&existing>=0&&Number.isInteger(accounts25)&&accounts25>=0&&accounts25<=30
   &&Number.isInteger(accounts50)&&accounts50>=0&&accounts50<=30&&Number.isFinite(ratePct)&&ratePct>=-20&&ratePct<=30
   &&Number.isFinite(splitPct)&&splitPct>=0&&splitPct<=100&&Number.isInteger(months)&&months>=1&&months<=60;
 const nominalFunded=valid?existing+25000*accounts25+50000*accounts50:0;
 const costProvided=(accounts25===0||(fee25!==null&&finite(fee25)&&fee25>=0))
  &&(accounts50===0||(fee50!==null&&finite(fee50)&&fee50>=0));
 const cost=valid&&costProvided?(fee25??0)*accounts25+(fee50??0)*accounts50:null;
 const monthlyGross=nominalFunded*ratePct/100;
 const monthlyWithdraw=monthlyGross*splitPct/100;
 const grossWithdraw=monthlyWithdraw*months;
 return {nominalFunded,newNominal:valid?25000*accounts25+50000*accounts50:0,monthlyGross:valid?round(monthlyGross):0,
   monthlyWithdrawEstimate:valid?round(monthlyWithdraw):0,
   perAccountMonthly:valid?round(25000*ratePct/100*splitPct/100):0,
   monthlyRate:ratePct,months,cost:cost!=null?round(cost):null,
   grossWithdrawHorizon:valid?round(grossWithdraw):0,
   afterPurchaseFees:cost!=null?round(grossWithdraw-cost):null,
   breakEvenMonths:cost!=null&&monthlyWithdraw>0?Math.ceil(cost/monthlyWithdraw):null,
   valid,reason:"Escenario aritmético, no rentabilidad esperada. No incorpora probabilidades de aprobar evaluaciones, cuotas mensuales, tiempo sin cuenta fondeada, impuestos ni límites de retiro."};
}
