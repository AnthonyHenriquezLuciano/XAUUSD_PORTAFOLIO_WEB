/** Broker tick-volume suite and PRICE-CONFLUENCE map.
 * Never present these calculations as executed volume, aggressor delta,
 * actual resting institutional liquidity, or calibrated probabilities.
 */
import {BarStore,lowerBound} from "../ai/bars";
import {volumeProfile,type FlowLevel,type Gap,type Sweep,type FlowProfile} from "./engine";
export type DevelopingPoint={fraction:number;time:number;poc:number;vwap:number|null;vah:number;val:number};
export type VolumeSuite={
  anchoredVwap:number|null;anchorTime:number|null;developing:DevelopingPoint[];
  timeOfDayRvol:number|null;baselineDays:number;effortResult:number|null;
  momentum:"rising"|"falling"|"mixed"|"unavailable";quality:string[];
};
export type LiquidityCluster={
  id:string;price:number;lo:number;hi:number;intensity:number;sourceCount:number;
  sources:string[];interpretation:"high_confluence"|"moderate_confluence";
};
const round=(x:number,n=2)=>Number(x.toFixed(n));
const DAY=86400;
export function buildVolumeSuite(st:BarStore,p:FlowProfile|null,cutoff:number):VolumeSuite{
 const empty:VolumeSuite={anchoredVwap:null,anchorTime:null,developing:[],
   timeOfDayRvol:null,baselineDays:0,effortResult:null,momentum:"unavailable",quality:[]};
 if(!p||!st.length)return {...empty,quality:["Histórico M1 o perfil no disponible."]};
 const lo=lowerBound(st.ts,p.start),hi=Math.min(st.length,lowerBound(st.ts,Math.min(p.end,cutoff+1)));
 const developing:DevelopingPoint[]=[];
 // Each developing profile is computed strictly up to its then-known cutoff.
 if(hi-lo>=40){
   for(const fraction of [.25,.5,.75,1]){
     const stop=lo+Math.max(1,Math.floor((hi-lo)*fraction));
     const t=st.ts[Math.min(stop-1,hi-1)];
     const partial=volumeProfile(st,p.start,t+1,t,p.bins.length);
     if(partial)developing.push({fraction,time:t,poc:partial.poc,vwap:partial.vwap,vah:partial.vah,val:partial.val});
   }
 }
 // Relative tick activity at SAME broker-server clock time on previous days.
 const current=st.ts[Math.max(0,hi-1)],window=15*60;
 const sumWindow=(end:number)=>{
   const a=lowerBound(st.ts,end-window),b=lowerBound(st.ts,end);
   if(b-a<10)return null;
   let sum=0,valid=0;
   for(let i=a;i<b;i++)if(st.vol[i]>0&&Number.isFinite(st.vol[i])){valid++;sum+=st.vol[i];}
   return valid>=10?sum:null;
 };
 const latest=sumWindow(current+60);
 const prior:number[]=[];
 for(let d=1;d<=21;d++){
   const v=sumWindow(current+60-d*DAY);
   if(v!=null&&v>0)prior.push(v);
 }
 const rv=latest!=null&&prior.length>=5?latest/(prior.slice().sort((a,b)=>a-b)[Math.floor(prior.length/2)]||1):null;
 // Effort vs result is an exploratory market-state proxy, not proof of absorption.
 const n=Math.min(30,hi),from=hi-n,first=st.c[from],last=st.c[hi-1];
 let tr=0,ticks=0;
 for(let i=from;i<hi;i++){tr+=Math.max(0,st.h[i]-st.l[i]);ticks+=Math.max(0,st.vol[i]);}
 const move=Math.abs(last-first),effort=n>=20&&tr>0&&ticks>0?move/(tr/n):null;
 const quality=["Anclaje al inicio del perfil seleccionado. VWAP aproximado: precio típico × ticks M1."];
 if(prior.length<5)quality.push("No hay 5 días comparables: RVOL por hora del bróker N/D.");
 if(p.coverage<.85)quality.push("Cobertura de volumen incompleta: interpretar señales con cautela.");
 const lastPoints=developing.slice(-2);
 const momentum=lastPoints.length<2?"unavailable":
  lastPoints[1].poc>lastPoints[0].poc+.02?"rising":
  lastPoints[1].poc<lastPoints[0].poc-.02?"falling":"mixed";
 return {anchoredVwap:p.vwap,anchorTime:p.start,developing,
  timeOfDayRvol:rv!=null?round(rv):null,baselineDays:prior.length,
  effortResult:effort!=null?round(effort):null,momentum,quality};
}
export function buildLiquidityMap(
 levels:readonly FlowLevel[],gaps:readonly Gap[],sweeps:readonly Sweep[],
 profile:FlowProfile|null,cutoff:number
):LiquidityCluster[]{
 if(!profile||profile.bars<25||profile.coverage<.6)return [];
 type Hit={price:number;source:string;weight:number};
 const hits:Hit[]=[];
 const bases=new Set(["POC","VAH","VAL","PDH","PDL","PWH","PWL","VWAP"]);
 for(const l of levels){
   if(!Number.isFinite(l.price))continue;
   if(bases.has(l.key))hits.push({price:l.price,source:l.key,weight:l.key==="POC"||l.key==="VWAP"?2:1});
 }
 for(const price of profile.hvn.slice(0,5))hits.push({price,source:"HVN",weight:1.3});
 // LVNs are traversal corridors rather than assumed resting liquidity;
 // retain as context but do not use as concentration evidence.
 for(const gap of gaps.filter(x=>x.state!=="filled").slice(-10)){
   if(Number.isFinite(gap.lo)&&Number.isFinite(gap.hi))
    hits.push({price:(gap.lo+gap.hi)/2,source:gap.side>0?"FVG↑":"FVG↓",weight:1});
 }
 for(const sweep of sweeps.slice(-8)){
   if(Number.isFinite(sweep.level))hits.push({price:sweep.level,source:"Sweep",weight:1});
 }
 const radius=Math.max(.15,Math.min(4,(profile.max-profile.min)/profile.bins.length*1.7));
 const sorted=hits.sort((a,b)=>a.price-b.price);
 const groups:Hit[][]=[];
 for(const item of sorted){
   const last=groups[groups.length-1];
   if(last&&Math.abs(item.price-last.reduce((s,b)=>s+b.price,0)/last.length)<=radius)
      last.push(item);
   else groups.push([item]);
 }
 return groups.map((g,i)=>{
   const unique=[...new Set(g.map(x=>x.source))],avg=g.reduce((s,x)=>s+x.price*x.weight,0)/g.reduce((s,x)=>s+x.weight,0);
   const score=unique.length, intensity=Math.min(100,Math.round(20+Math.min(5,score)*14));
   return {id:"lc-"+i,price:round(avg),lo:round(Math.min(...g.map(x=>x.price))-radius*.55),
    hi:round(Math.max(...g.map(x=>x.price))+radius*.55),
    intensity,sourceCount:score,sources:unique,
    interpretation:score>=3?"high_confluence":"moderate_confluence"} as LiquidityCluster;
 }).filter(g=>g.sourceCount>=2).sort((a,b)=>b.sourceCount-a.sourceCount||b.intensity-a.intensity).slice(0,10);
}
