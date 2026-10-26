/** Research-grade descriptive statistics: no trained AI or promise of predictability.
 * Input is closed M1 bars from the connected MT5 account, in broker-local timestamps.
 * Training/holdout are chronological; event outcomes are independent by sampling
 * non-overlapping horizons. Barrier ties resolve against the trade (conservative).
 */
import { BarStore } from "../ai/bars";
import { volumeProfile } from "../flow/engine";
export type LevelKey = "POC" | "VAH" | "VAL" | "VWAP";
export type DataQuality = {
  bars: number; first: number|null; last: number|null; invalidOhlc: number;
  missingVolume: number; volumePct: number; duplicates: number;
  missingMinutes: number; shortGaps: number; largeGaps: number;
  meanSpread: number|null; spreadPct: number;
  note: string;
};
export type TargetStudy = {
  level: LevelKey; horizonMin: number; stopMultiple: number;
  sufficient: boolean; training: number; validation: number; events: number;
  forecast: number|null; holdoutRate: number|null; confidence: [number,number]|null;
  trainRate: number|null; brierModel: number|null; brierHalf: number|null;
  tieLosses: number; skippedMissing: number; medianHitMinutes: number|null;
  latestLevel: number|null; latestPrice: number|null; currentDistance: number|null;
  methods: string[]; narrative: string;
};
const num = (v:number) => Number.isFinite(v);
const round = (v:number,n=3)=>Math.round(v*10**n)/10**n;
export function inspectBars(st: BarStore): DataQuality {
  const n=st.length;
  if (!n) return {bars:0,first:null,last:null,invalidOhlc:0,missingVolume:0,volumePct:0,duplicates:0,
    missingMinutes:0,shortGaps:0,largeGaps:0,meanSpread:null,spreadPct:0,
    note:"No hay histórico M1 conectado; no se pueden calcular indicadores ni frecuencias."};
  let invalid=0,missingVolume=0,dup=0,miss=0,short=0,large=0,spread=0,goodSpread=0;
  for(let i=0;i<n;i++){
    const o=st.o[i],h=st.h[i],l=st.l[i],c=st.c[i];
    if(![o,h,l,c].every(num) || l<=0 || h<Math.max(o,c,l) || l>Math.min(o,c,h)) invalid++;
    if(!(st.vol[i]>0)&&num(st.vol[i])) missingVolume++;
    const sp=st.sp[i];if(sp>0&&num(sp)){spread+=sp;goodSpread++;}
    if(!i)continue;
    const delta=st.ts[i]-st.ts[i-1];
    if(delta===0)dup++;
    // Distinguish short market data gaps from normal off-market/weekend breaks.
    if(delta>60&&delta<1800){miss+=Math.floor(delta/60)-1;short++;}
    if(delta>=1800)large++;
  }
  return {bars:n,first:st.ts[0],last:st.ts[n-1],invalidOhlc:invalid,missingVolume,
    volumePct:round((n-missingVolume)/n*100,1),duplicates:dup,missingMinutes:miss,
    shortGaps:short,largeGaps:large,
    meanSpread:goodSpread?round(spread/goodSpread,3):null,
    spreadPct:round(goodSpread/n*100,1),
    note:"Reloj de velas MT5; huecos largos incluyen cierres de mercado, noticias o falta de descarga. Los ticks no son transacciones de futuros."};
}
function wilson(successes:number,n:number):[number,number]|null{
  if(n<=0)return null;
  const p=successes/n,z=1.96,den=1+z*z/n,center=(p+z*z/(2*n))/den;
  const rad=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;
  return [round(Math.max(0,center-rad)),round(Math.min(1,center+rad))];
}
export function studyTargets(st:BarStore, level:LevelKey="POC", horizonMin=120, stopMultiple=1.5, maxEvents=1000): TargetStudy {
  horizonMin=Math.min(480,Math.max(30,Math.round(horizonMin)));
  stopMultiple=Math.min(4,Math.max(.5,stopMultiple));
  const q=inspectBars(st),latestI=st.length-1;
  const lastPrice=latestI>=0?st.c[latestI]:null;
  const currentProfile=st.length>360?volumeProfile(st,st.ts[latestI]-6*3600,st.ts[latestI]+1,st.ts[latestI],48):null;
  const getLevel=(p:NonNullable<typeof currentProfile>) => level==="POC"?p.poc:level==="VAH"?p.vah:level==="VAL"?p.val:p.vwap;
  const latestLevel=currentProfile?getLevel(currentProfile):null;
  const reasons=["Muestra cada "+horizonMin+" velas disponibles como máximo, evitando solapar horizontes.",
    "Perfil calculado exclusivamente con las seis horas anteriores al cierre de observación.",
    "El objetivo es un nivel "+level+" calculado en esa fecha, no el POC actual aplicado retrospectivamente.",
    "Stop opuesto a "+round(stopMultiple,2)+" × distancia al objetivo; comisiones y slippage NO incluidos.",
    "Si una misma M1 toca SL y objetivo, se cuenta como SL (conservador).",
    "Horizontes incompletos y segmentos con huecos grandes se excluyen; se divide cronológicamente 70%/30%.",
    "La frecuencia descriptiva es un estimador condicionado a la muestra; no es una predicción validada de IA."];
  const base:TargetStudy={level,horizonMin,stopMultiple,sufficient:false,training:0,validation:0,events:0,
    forecast:null,holdoutRate:null,confidence:null,trainRate:null,brierModel:null,brierHalf:null,
    tieLosses:0,skippedMissing:0,medianHitMinutes:null,latestLevel,latestPrice:lastPrice,
    currentDistance:latestLevel!=null&&lastPrice!=null?round(Math.abs(latestLevel-lastPrice),2):null,
    methods:reasons,narrative:"No hay suficiente histórico para una estimación defendible."};
  if(q.bars<1400||q.invalidOhlc>0)return base;
  const outcomes:{hit:0|1,delay:number|null,time:number}[]=[];
  let ties=0,skipped=0;
  const step=Math.max(45,horizonMin);
  for(let i=360;i+3<st.length&&outcomes.length<maxEvents;i+=step){
    const start=st.ts[i]-6*3600;
    const p=volumeProfile(st,start,st.ts[i]+1,st.ts[i],48);
    if(!p || p.coverage<.80)continue;
    const target=getLevel(p), entry=st.c[i];
    if(target==null||!num(entry)||!num(target))continue;
    const side=target>entry?1:-1, dist=Math.abs(target-entry);
    if(dist<.5 || dist>200)continue;
    const stop=entry-side*dist*stopMultiple;
    const endTime=st.ts[i]+horizonMin*60;
    let outcome:0|1|null=null,invalidWindow=false,delay:number|null=null;
    let j=i+1;
    for(;j<st.length&&st.ts[j]<=endTime;j++){
      const gap=st.ts[j]-st.ts[j-1];
      if(gap>600||gap<=0){invalidWindow=true;break;}
      const take=side>0?st.h[j]>=target:st.l[j]<=target;
      const loss=side>0?st.l[j]<=stop:st.h[j]>=stop;
      if(take||loss){
        if(take&&loss)ties++;
        outcome=loss?0:1;delay=(st.ts[j]-st.ts[i])/60;break;
      }
    }
    if(invalidWindow){skipped++;continue;}
    if(outcome===null){
      // Only classify nonhits after observing the complete horizon.
      if(j>=st.length||st.ts[Math.max(i+1,j-1)]<endTime-600){skipped++;continue;}
      outcome=0;
    }
    outcomes.push({hit:outcome,delay:outcome===1?delay:null,time:st.ts[i]});
  }
  const trainN=Math.floor(outcomes.length*.7),valN=outcomes.length-trainN;
  const train=outcomes.slice(0,trainN),holdout=outcomes.slice(trainN);
  const w=train.reduce((a,x)=>a+x.hit,0),v=holdout.reduce((a,x)=>a+x.hit,0);
  const trainRate=trainN?w/trainN:null,holdoutRate=valN?v/valN:null;
  const p=trainN?(w+1)/(trainN+2):null; // beta(1,1) shrink
  const brier=p!=null&&valN?holdout.reduce((a,x)=>a+(p-x.hit)**2,0)/valN:null;
  const brierHalf=valN?holdout.reduce((a,x)=>a+(.5-x.hit)**2,0)/valN:null;
  const sortedDelays=outcomes.filter(x=>x.hit===1&&x.delay!=null).map(x=>x.delay!).sort((a,b)=>a-b);
  const median=sortedDelays.length?sortedDelays[Math.floor(sortedDelays.length/2)]:null;
  const sufficient=trainN>=40&&valN>=15&&q.volumePct>=85&&q.invalidOhlc===0;
  return {...base,events:outcomes.length,training:trainN,validation:valN,trainRate:trainRate==null?null:round(trainRate),
    holdoutRate:holdoutRate==null?null:round(holdoutRate),forecast:sufficient&&p!=null?round(p):null,
    confidence:wilson(v,valN),tieLosses:ties,skippedMissing:skipped,
    brierModel:brier==null?null:round(brier,4),brierHalf:brierHalf==null?null:round(brierHalf,4),
    medianHitMinutes:median==null?null:round(median,1),sufficient,
    narrative:!sufficient?"Muestra limitada o calidad insuficiente: sin estimación utilizable.":
      brier!=null&&brierHalf!=null&&brier>=brierHalf?
      "La frecuencia histórica no mejora el baseline 50% en Brier del tramo reservado. Uso experimental; no automatizar.":
      "Estimación histórica exploratoria. Aunque el Brier sea menor que 0.25, falta validación independiente, costes y estabilidad antes de usarla para ejecutar."};
}
