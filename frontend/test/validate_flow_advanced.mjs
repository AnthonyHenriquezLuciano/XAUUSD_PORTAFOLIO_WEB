import assert from "node:assert/strict";
import { build } from "esbuild";
const b=await build({entryPoints:["src/flow/engine.ts","src/flow/reach.ts","src/flow/volumeSignals.ts",
    "src/ai/bars.ts","src/chart/viewport.ts"],
  bundle:true,format:"esm",platform:"node",write:false,outdir:"/virtual",logLevel:"silent"});
async function use(name){
  const file=b.outputFiles.find(x=>x.path.endsWith("/"+name+".js"));
  assert.ok(file,"bundle "+name);
  return import("data:text/javascript;base64,"+Buffer.from(file.text).toString("base64"));
}
const {BarStore}=await use("bars");
const {buildFlow}=await use("engine");
const {volumePressure}=await use("volumeSignals");
const {levelReachEvidence}=await use("reach");
const {captureViewport,restoreViewport}=await use("viewport");
const ts=Date.UTC(2026,8,10,0,0)/1000;
const raw={ts:[],o:[],h:[],l:[],c:[],sp:[],v:[]};
for(let i=0;i<12*1440;i++){
  const price=2400+8*Math.sin(i/45)+2*Math.sin(i/11)+.15*Math.sin(i/3);
  raw.ts.push(ts+i*60);raw.o.push(price-.12);raw.h.push(price+.65);
  raw.l.push(price-.65);raw.c.push(price+.14);
  raw.v.push(i>12*1440-16?80:20+i%8);raw.sp.push(.16);
}
const st=new BarStore(raw),end=raw.ts[raw.ts.length-1]+59;
const pressure=volumePressure(st,end-6*3600,end+1,end);
assert.ok(pressure.bars>100);
assert.ok(pressure.buyingProxyPct>=0&&pressure.buyingProxyPct<=100);
assert.ok(Math.abs(pressure.buyingProxyPct+pressure.sellingProxyPct-100)<.2);
assert.ok(pressure.cmf20!==null&&Math.abs(pressure.cmf20)<=1.001);
assert.ok(pressure.mfi14!==null&&pressure.mfi14<=100&&pressure.mfi14>=0);
assert.ok(pressure.obvRecent!==null&&Math.abs(pressure.obvRecent)<=1);
assert.ok(pressure.relativeVolume!==null&&pressure.relativeVolume>1);
assert.ok(pressure.recentTicks>0);
const empty=volumePressure(new BarStore({...raw,v:raw.v.map(()=>0)}),end-6*3600,end+1,end);
assert.equal(empty.state,"insufficient");assert.equal(empty.score,null);
const bullishRaw={...raw,o:raw.o.map((_,i)=>100+i*.05),h:raw.h.map((_,i)=>101+i*.05),
  l:raw.l.map((_,i)=>99+i*.05),c:raw.c.map((_,i)=>101+i*.05)};
const up=volumePressure(new BarStore(bullishRaw),end-3600,end+1,end);
assert.ok(up.buyingProxyPct>90,"CLV bullish sample");
assert.ok(up.cmf20>.8,"positive Chaikin Money Flow");
assert.ok(up.obvRecent>0,"positive on-balance volume");
const flow=buildFlow(st,end,{mode:"recent",scope:"day",cutoff:end});
assert.ok(flow.pressure?.buyingProxyPct!=null,"buildFlow exposes activity");
const reach=levelReachEvidence(st,flow.levels,end,{mode:"recent",scope:"day",horizonMin:120,minimumTrain:8,minimumHoldout:3});
assert.equal(reach.length,8);
assert.deepEqual(reach.map(x=>x.key),["POC","VAH","VAL","VWAP","PDH","PDL","PWH","PWL"]);
for(const x of reach){
  assert.ok(x.percent===null||(x.percent>=0&&x.percent<=100));
  assert.ok(x.lower===null||(x.lower>=0&&x.lower<=100));
  assert.ok(x.upper===null||(x.upper>=0&&x.upper<=100));
  if(x.percent!==null)assert.ok(x.lower<=x.percent&&x.percent<=x.upper);
  assert.ok(x.n>=x.holdoutN&&x.hit<=x.holdoutN);
}
const fixed=levelReachEvidence(st,flow.levels,end,{mode:"fixed",scope:"day"});
assert.ok(fixed.every(x=>x.percent===null),"fixed drawn ranges cannot invent analog probabilities");
const noData=levelReachEvidence(new BarStore({...raw,ts:raw.ts.slice(0,500),o:raw.o.slice(0,500),h:raw.h.slice(0,500),
 l:raw.l.slice(0,500),c:raw.c.slice(0,500),sp:raw.sp.slice(0,500),v:raw.v.slice(0,500)}),flow.levels,ts+499*60,{mode:"recent",scope:"day"});
assert.ok(noData.every(x=>x.percent===null));
const view={getVisibleLogicalRange:()=>({from:30,to:50}),getVisibleRange:()=>({from:ts,to:ts+1000}),
  setVisibleLogicalRange:(v)=>changes.push(["logical",v]),setVisibleRange:(v)=>changes.push(["time",v])};
const chart={timeScale:()=>view};let changes=[];
const snap=captureViewport(chart,200);
restoreViewport(chart,snap,210,false);
assert.equal(changes[0][0],"time","panned view stays at same historical dates");
changes=[];
restoreViewport(chart,snap,210,true);
assert.equal(changes[0][0],"logical","timeframe change starts in recent 160 candles");
assert.ok(changes[0][1].from>=45,"does not fit entire 30-day history");
view.getVisibleLogicalRange=()=>({from:150,to:200});
const following=captureViewport(chart,200);changes=[];
restoreViewport(chart,following,220,false);
assert.equal(changes[0][0],"logical");
assert.ok(changes[0][1].from>100,"follow recent data without full reset");
console.log("✓ Flow V2: pressure indicators, no fake delta, chronological reach studies and stable chart viewport");
