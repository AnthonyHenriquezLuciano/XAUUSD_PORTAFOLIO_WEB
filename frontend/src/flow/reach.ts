/** Point-in-time, NON-PREDICTIVE frequency of touching profile/day/week levels.
 * Each event uses a level calculated only from data known at the event candle.
 * Events are non-overlapping by horizon; the reserved 30% is chronological.
 * This must never be presented as calibrated model probability or a trade signal.
 */
import { BarStore, dayOf, dowOf, lowerBound } from "../ai/bars";
import { volumeProfile, type FlowMode, type FlowScope, type FlowLevel } from "./engine";
import { chartSessionWindows } from "../sessions/marketSessions";
const KEYS=["POC","VAH","VAL","VWAP","PDH","PDL","PWH","PWL"] as const;
export type ReachKey=typeof KEYS[number];
export type ReachEvidence = {key:ReachKey; percent:number|null; n:number; holdoutN:number;
  hit:number; lower:number|null; upper:number|null; horizonMin:number;
  basis:string; reason:string};
const rounded=(n:number)=>Math.round(n*1000)/1000;
function wilson(hit:number,n:number):[number,number]|null {
  if(n<1)return null;
  const z=1.96,p=hit/n,den=1+z*z/n,center=p+z*z/(2*n),rad=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n));
  return [rounded(Math.max(0,(center-rad)/den)),rounded(Math.min(1,(center+rad)/den))];
}
function pastDaily(st:BarStore,t:number) {
  const today=dayOf(st.toNorm(t)),weekStart=today-dowOf(today)*86400;
  let prev=-1,weekHigh=-Infinity,weekLow=Infinity;
  for(let j=0;j<st.days.length;j++){
    if(st.days[j]<today&&dowOf(st.days[j])<5)prev=j;
    if(st.days[j]>=weekStart-7*86400&&st.days[j]<weekStart){
      weekHigh=Math.max(weekHigh,st.dHigh[j]);weekLow=Math.min(weekLow,st.dLow[j]);
    }
  }
  return {PDH:prev>=0?st.dHigh[prev]:null,PDL:prev>=0?st.dLow[prev]:null,
    PWH:weekHigh>-Infinity?weekHigh:null,PWL:weekLow<Infinity?weekLow:null};
}
export function levelReachEvidence(st:BarStore,levels:FlowLevel[],cutoff:number,opts:{
  mode:FlowMode;scope:FlowScope;brokerOffsetSec?:number|null;
  horizonMin?:number;bins?:number;minimumTrain?:number;minimumHoldout?:number;
}):ReachEvidence[] {
  const horizonMin=opts.horizonMin??120,basis=opts.mode==="recent"?"Perfil 6h":
    opts.mode==="fixed"?"Rango dibujado":opts.scope==="day"?"Día EA":"Sesión "+opts.scope;
  const inactive=(key:ReachKey,reason:string):ReachEvidence=>({key,percent:null,n:0,holdoutN:0,hit:0,
    lower:null,upper:null,horizonMin,basis,reason});
  if(opts.mode==="fixed")return KEYS.map(k=>inactive(k,"El rango dibujado no tiene muestra histórica comparable."));
  if(horizonMin<30||horizonMin>480||st.length<1000)return KEYS.map(k=>inactive(k,"Histórico M1 insuficiente."));
  const hi=Math.min(st.length-1,lowerBound(st.ts,cutoff+1)-1);
  if(hi<800)return KEYS.map(k=>inactive(k,"Histórico M1 insuficiente."));
  const current=new Map(levels.map(x=>[x.key,x.price]));
  const rangeAt=(i:number)=>{
    let high=-Infinity,low=Infinity;
    for(let j=Math.max(0,i-59);j<=i;j++){high=Math.max(high,st.h[j]);low=Math.min(low,st.l[j]);}
    return Math.max(0.05,high-low);
  };
  const currentRange=rangeAt(hi),cur=st.c[hi];
  const currentDist=new Map(KEYS.map(k=>[k,current.has(k)?Math.abs(current.get(k)!-cur)/currentRange:null] as const));
  const buffers=new Map(KEYS.map(k=>[k,[] as number[]]));
  const interval=horizonMin*60,step=Math.max(horizonMin,60);
  const windows=opts.mode==="session"&&opts.scope!=="day"&&opts.brokerOffsetSec!=null&&Number.isFinite(opts.brokerOffsetSec)
    ?chartSessionWindows(st.ts[0]-86400,st.ts[hi]+86400,opts.brokerOffsetSec):[];
  // Keep the complete forward horizon strictly in the already-observed history.
  for(let i=360;i<hi-horizonMin;i+=step){
    const t=st.ts[i];
    if(t+interval>cutoff)continue;
    const w=opts.mode==="session"&&opts.scope!=="day"?
      windows.find(x=>x.id===opts.scope&&x.t0<=t&&x.t1>t):null;
    if(opts.mode==="session"&&opts.scope!=="day"&&!w)continue;
    const from=opts.mode==="recent"?t-6*3600:opts.scope==="day"?
      st.toSrv(dayOf(st.toNorm(t))):(w?.t0??t-6*3600);
    const p=volumeProfile(st,from,t+1,t,opts.bins??48);
    // Avoid profile leakage if enough minutes of the historical session are not yet available.
    if(!p||p.coverage<.85||p.bars<25)continue;
    const daily=pastDaily(st,t);
    const previous:Record<ReachKey,number|null>={POC:p.poc,VAH:p.vah,VAL:p.val,VWAP:p.vwap,
      PDH:daily.PDH,PDL:daily.PDL,PWH:daily.PWH,PWL:daily.PWL};
    const available: {key:ReachKey;price:number;up:boolean}[]=[];
    for(const k of KEYS){
      const tgt=previous[k],wanted=currentDist.get(k);
      if(tgt==null||wanted==null||wanted<.035||wanted>7)continue;
      const dist=Math.abs(tgt-st.c[i]),similar=dist/rangeAt(i);
      // Comparable distance and same direction relative to the level.
      if(similar<Math.max(.035,wanted*.5)||similar>Math.min(9,wanted*2)||dist<=.02)continue;
      if(Math.sign(tgt-st.c[i])!==Math.sign(current.get(k)!-cur))continue;
      available.push({key:k,price:tgt,up:tgt>st.c[i]});
    }
    if(!available.length)continue;
    let j=i+1,broken=false;const outcomes=new Map<ReachKey,number>();
    for(;j<st.length&&st.ts[j]<=t+interval;j++){
      if(st.ts[j]-st.ts[j-1]>600||st.ts[j]-st.ts[j-1]<=0){broken=true;break;}
      for(const x of available){
        if(outcomes.has(x.key))continue;
        if(x.up?st.h[j]>=x.price:st.l[j]<=x.price)outcomes.set(x.key,1);
      }
    }
    // Do not count an unobserved window as a miss.
    if(broken||j>=st.length||st.ts[Math.max(i+1,j-1)]<t+interval-600)continue;
    for(const x of available)buffers.get(x.key)!.push(outcomes.get(x.key)??0);
  }
  return KEYS.map(k=>{
    const events=buffers.get(k)!;
    const n=events.length,train=Math.floor(n*.7),val=events.slice(train),hit=val.reduce((s,x)=>s+x,0);
    const minTrain=opts.minimumTrain??25,minHoldout=opts.minimumHoldout??12;
    const enough=train>=minTrain&&val.length>=minHoldout;
    const bounds=enough?wilson(hit,val.length):null;
    return {key:k,percent:enough?rounded(hit/val.length*100):null,n,holdoutN:val.length,
      hit,lower:bounds?rounded(bounds[0]*100):null,upper:bounds?rounded(bounds[1]*100):null,
      horizonMin,basis,reason:!enough?"Muestra insuficiente de ventanas comparables sin solapamiento.":
      "Frecuencia descriptiva en el 30% más reciente (reserva cronológica); no es predicción calibrada. IC 95% Wilson."};
  });
}
