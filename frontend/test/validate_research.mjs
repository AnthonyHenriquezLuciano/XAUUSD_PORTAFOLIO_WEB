import assert from "node:assert/strict";
import { build } from "esbuild";
const b=await build({entryPoints:["src/research/engine.ts","src/ai/bars.ts"],bundle:true,
  platform:"node",format:"esm",write:false,outdir:"/virtual",logLevel:"silent"});
const get=async (name)=>{
  const f=b.outputFiles.find(x=>x.path.endsWith("/"+name+".js"));
  assert.ok(f,"module exists: "+name);
  return import("data:text/javascript;base64,"+Buffer.from(f.text).toString("base64"));
};
const {BarStore}=await get("bars");
const {inspectBars,studyTargets}=await get("engine");
const base=Date.UTC(2026,8,14,1)/1000;
const raw={ts:[],o:[],h:[],l:[],c:[],sp:[],v:[]};
for(let i=0;i<14000;i++){
  const price=2400+10*Math.sin(i/22)+4*Math.sin(i/7)+2*Math.sin(i/190);
  raw.ts.push(base+i*60);raw.o.push(price-.11);raw.h.push(price+.6);
  raw.l.push(price-.7);raw.c.push(price);raw.sp.push(.15);raw.v.push(50+i%12);
}
const st=new BarStore(raw);
const q=inspectBars(st);
assert.equal(q.bars,14000);assert.equal(q.invalidOhlc,0);
assert.equal(q.missingVolume,0);assert.equal(q.duplicates,0);
assert.equal(q.missingMinutes,0);assert.equal(q.largeGaps,0);
assert.equal(q.volumePct,100);assert.equal(q.spreadPct,100);
assert.ok(q.meanSpread>.14);
const study=studyTargets(st,"POC",120,1.5);
assert.ok(study.events>=30,"historical non-overlapping event count "+study.events);
assert.equal(study.training+study.validation,study.events);
assert.ok(study.training>=study.validation);
assert.ok(study.confidence===null || (study.confidence[0]<=study.confidence[1] && study.confidence[1]<=1));
assert.ok(study.brierModel===null||study.brierModel>=0);
assert.ok(study.brierHalf===null||study.brierHalf===0.25);
assert.ok(study.latestLevel!=null);
assert.equal(study.horizonMin,120);assert.equal(study.stopMultiple,1.5);
assert.ok(study.methods.some(x=>x.includes("anteriores")));
const insufficient=studyTargets(new BarStore({...raw,ts:raw.ts.slice(0,900),o:raw.o.slice(0,900),h:raw.h.slice(0,900),l:raw.l.slice(0,900),c:raw.c.slice(0,900),sp:raw.sp.slice(0,900),v:raw.v.slice(0,900)}),"POC",60,1.5);
assert.equal(insufficient.sufficient,false);assert.equal(insufficient.forecast,null);
const qInvalid=inspectBars(new BarStore({...raw,h:raw.h.map((v,i)=>i===100?-2:v)}));
assert.ok(qInvalid.invalidOhlc>=1);
const r2={...raw,ts:raw.ts.slice(0,150).concat(raw.ts.slice(151)),o:raw.o.slice(0,150).concat(raw.o.slice(151)),
  h:raw.h.slice(0,150).concat(raw.h.slice(151)),l:raw.l.slice(0,150).concat(raw.l.slice(151)),
  c:raw.c.slice(0,150).concat(raw.c.slice(151)),sp:raw.sp.slice(0,150).concat(raw.sp.slice(151)),
  v:raw.v.slice(0,150).concat(raw.v.slice(151))};
assert.equal(inspectBars(new BarStore(r2)).shortGaps,1);
const vZero={...raw,v:raw.v.map(()=>0)};
assert.equal(inspectBars(new BarStore(vZero)).volumePct,0);
assert.equal(studyTargets(new BarStore(vZero),"POC").forecast,null,"never invent missing volume");
console.log("✓ Research: data anomalies, chronological 70/30 study, intervals, no fake probabilities, volume provenance");
