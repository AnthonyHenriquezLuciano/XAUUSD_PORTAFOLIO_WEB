/** XAUUSD broker tick-activity indicators.
 * M1 OHLC + tick_volume can measure relative activity, never aggressor trades
 * or actual centralized futures volume. CLV and CVD-like numbers are PROXIES.
 */
import { BarStore, lowerBound } from "../ai/bars";
export type PressureState = "buyer_proxy" | "seller_proxy" | "mixed" | "insufficient";
export type FlowPressure = {
  state: PressureState; score: number | null; agreement: number;
  relativeVolume: number|null; recentTicks: number; previousTicksMedian: number|null;
  buyingProxyPct: number|null; sellingProxyPct: number|null; signedTickProxy: number;
  obvRecent: number|null; cmf20: number|null; mfi14: number|null;
  mfiPeriod: "M1"; coveragePct: number; bars: number; activity: "expansion"|"normal"|"contraction"|"unknown";
  absorptionHint: "up"|"down"|null; reasons: string[];
};
const clamp=(x:number,a:number,b:number)=>Math.min(b,Math.max(a,x));
const r=(x:number,n=2)=>Math.round(x*10**n)/10**n;
const med=(xs:number[])=>{const v=xs.slice().sort((a,b)=>a-b);return v.length?v[Math.floor(v.length/2)]:null;};
export function volumePressure(st:BarStore,start:number,end:number,cutoff:number):FlowPressure {
  const empty:FlowPressure={state:"insufficient",score:null,agreement:0,relativeVolume:null,recentTicks:0,
    previousTicksMedian:null,buyingProxyPct:null,sellingProxyPct:null,signedTickProxy:0,
    obvRecent:null,cmf20:null,mfi14:null,mfiPeriod:"M1",coveragePct:0,bars:0,
    activity:"unknown",absorptionHint:null,reasons:["No existe actividad de ticks suficiente para evaluar presión relativa."]};
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||!st.length)return empty;
  const lo=lowerBound(st.ts,start),hi=Math.min(st.length,lowerBound(st.ts,Math.min(end,cutoff+1)));
  let n=0,valid=0,plus=0,minus=0,signed=0,sum=0;
  for(let i=lo;i<hi;i++){
    const vol=st.vol[i],h=st.h[i],l=st.l[i],c=st.c[i];
    if(![vol,h,l,c].every(Number.isFinite)||h<l)continue;
    n++;
    if(vol<=0)continue;
    valid++;sum+=vol;
    const clv=h>l?clamp((2*c-h-l)/(h-l),-1,1):0;
    signed+=clv*vol;plus+=vol*(1+clv)/2;minus+=vol*(1-clv)/2;
  }
  if(n<20||valid<20||sum<=0)return {...empty,bars:n,coveragePct:n?r(valid/n*100,1):0};
  const pct=r(plus/sum*100,1);
  // Independent short-horizon indicators: M1 OBV and Chaikin Money Flow 20 x M1
  // use only history up to cutoff; flat bodies are neutral, not invented trades.
  const last=hi-1,first=Math.max(1,last-29),cmfFirst=Math.max(0,last-19);
  let obv=0,obvVolume=0,cmfNumer=0,cmfDenom=0,mfiPlus=0,mfiMinus=0;
  for(let i=first;i<=last;i++){
    if(st.vol[i]>0&&Number.isFinite(st.vol[i])&&Number.isFinite(st.c[i-1])){
      const diff=Math.sign(st.c[i]-st.c[i-1]);
      obv+=diff*st.vol[i];obvVolume+=st.vol[i];
    }
  }
  for(let i=cmfFirst;i<=last;i++){
    const v=st.vol[i],h=st.h[i],l=st.l[i],c=st.c[i];
    if(v>0&&[h,l,c,v].every(Number.isFinite)&&h>=l){
      cmfNumer+=(h>l?(2*c-h-l)/(h-l):0)*v;cmfDenom+=v;
    }
  }
  const mfiStart=Math.max(1,last-13);
  for(let i=mfiStart;i<=last;i++){
    if(st.vol[i]<=0||st.vol[i-1]<=0)continue;
    const typical=(st.h[i]+st.l[i]+st.c[i])/3, prev=(st.h[i-1]+st.l[i-1]+st.c[i-1])/3;
    if(typical>prev)mfiPlus+=typical*st.vol[i];
    else if(typical<prev)mfiMinus+=typical*st.vol[i];
  }
  const mfi=mfiPlus+mfiMinus>0?100*mfiPlus/(mfiPlus+mfiMinus):null;
  const cmf=cmfDenom>0?cmfNumer/cmfDenom:null,obvRate=obvVolume>0?obv/obvVolume:null;
  // RVOL: last 15 minute activity vs previous consecutive full 15-minute windows.
  // Compare only same instrument + clock, never claim seasonality adjustment.
  const span=15,history=12;
  const sums:number[]=[];
  for(let w=0;w<=history;w++){
    const from=hi-(w+1)*span,to=hi-w*span;
    if(from<lo||from<0)break;
    let v=0,ok=0;
    for(let i=from;i<to;i++){if(st.vol[i]>0){v+=st.vol[i];ok++;}}
    if(ok>=span*.8 && st.ts[to-1]-st.ts[from] <= (span+2)*60)sums.push(v);
  }
  const median=med(sums.slice(1));
  const recent=sums.length?sums[0]:0;
  const rvol=median!=null&&median>0&&sums.length>=6?recent/median:null;
  const activity=rvol==null?"unknown":rvol>=1.6?"expansion":rvol<=.65?"contraction":"normal";
  // Composite is *not a probability*, but an agreement of independent OHLC proxies.
  const rawComponents=[(pct-50)/50,cmf,obvRate,mfi==null?null:(mfi-50)/50]
    .filter((x):x is number=>x!=null&&Number.isFinite(x));
  const score=rawComponents.length>=3?r(clamp(rawComponents.reduce((a,b)=>a+b,0)/rawComponents.length*100,-100,100),0):null;
  const signs=rawComponents.filter(x=>Math.abs(x)>.08).map(x=>Math.sign(x));
  const pos=signs.filter(x=>x>0).length,neg=signs.filter(x=>x<0).length,agreement=Math.max(pos,neg);
  const state:PressureState=score==null||valid/n<.75?"insufficient":
    score>=18&&pos>=3?"buyer_proxy":score<=-18&&neg>=3?"seller_proxy":"mixed";
  // Elevated activity near an unchanged price can indicate two-sided absorption,
  // but M1 OHLC cannot confirm resting orders; this is only an inspection hint.
  const k=hi-1,hiLo=Math.max(0,k-14),movement=Math.abs(st.c[k]-st.o[hiLo]);
  let typicalRange=0,nRange=0;
  for(let i=hiLo;i<=k;i++){const v=st.h[i]-st.l[i];if(v>0&&Number.isFinite(v)){typicalRange+=v;nRange++;}}
  const limited=nRange&&movement<(typicalRange/nRange)*1.4;
  const absorptionHint:FlowPressure["absorptionHint"]=rvol!=null&&rvol>=1.8&&limited?
    signed>sum*.12?"up":signed< -sum*.12?"down":null:null;
  const reasons=[
    "CLV: cierre dentro del rango de cada M1, ponderado por ticks; no son compras/ventas reales.",
    "CMF(20), MFI(14) y OBV(30) calculados con velas M1; no equivalen a delta Bid/Ask.",
    "RVOL(15): actividad reciente frente a la mediana de ventanas anteriores; no ajustado por hora.",
  ];
  if(coveragePctWarn(valid,n))reasons.push("Cobertura incompleta; interpretar las señales con cautela.");
  return {state,score,agreement,relativeVolume:rvol==null?null:r(rvol),
    recentTicks:recent,previousTicksMedian:median==null?null:r(median),
    buyingProxyPct:pct,sellingProxyPct:r(100-pct,1),signedTickProxy:r(signed),
    obvRecent:obvRate==null?null:r(obvRate,3),cmf20:cmf==null?null:r(cmf,3),
    mfi14:mfi==null?null:r(mfi,1),mfiPeriod:"M1",coveragePct:r(valid/n*100,1),
    bars:n,activity,absorptionHint,reasons};
}
function coveragePctWarn(valid:number,total:number){return total>0&&valid/total<.9;}
