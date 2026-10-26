import assert from "node:assert/strict";
import { build } from "esbuild";
const bundle = await build({entryPoints:["src/flow/engine.ts","src/ai/bars.ts"],
  bundle:true, platform:"node",format:"esm",write:false,outdir:"/virtual",logLevel:"silent"});
async function loadPart(part) {
  const code = bundle.outputFiles.find(x=>x.path.endsWith("/"+part+".js"));
  assert.ok(code,"transpiled module "+part);
  return import("data:text/javascript;base64,"+Buffer.from(code.text).toString("base64"));
}
const {BarStore} = await loadPart("bars");
const {volumeProfile,fairValueGaps,buildFlow} = await loadPart("engine");
const base=Date.UTC(2026,9,26,8,0)/1000;
const raw={ts:[],o:[],h:[],l:[],c:[],sp:[],v:[]};
function push({o=100,h=102,l=98,c=100,v=20}={}) {
  raw.ts.push(base+raw.ts.length*60);
  raw.o.push(o);raw.h.push(h);raw.l.push(l);raw.c.push(c);
  raw.sp.push(.12);raw.v.push(v);
}
for(let i=0;i<60;i++)push();
const st=new BarStore(raw,0,14);
assert.equal(st.tf(5).length,12,"M1 bars aggregated to 5 minute candles");
assert.equal(st.tf(5).reduce((sum,b)=>sum+b.volume,0),1200,
  "aggregated histogram retains every observed tick of M1 volume");
const full=volumeProfile(st,base,base+3600,base+3599,64);
assert.ok(full,"profile must exist");
assert.equal(full.bars,60);
assert.equal(full.coverage,1);
assert.equal(full.total,1200);
assert.equal(full.bins.length,64);
assert.equal(full.method,"MT5_TICK_VOLUME_OHLC_UNIFORM");
assert.ok(Math.abs(full.bins.reduce((s,x)=>s+x.volume,0)-full.total)<1e-8,"volume preserved across bins");
assert.ok(full.poc >= full.val && full.poc <= full.vah,"POC lies inside Value Area");
assert.ok(full.val <= full.vah,"value area order");
assert.ok(full.vwap >= full.min && full.vwap <= full.max,"VWAP within range");
assert.ok(full.bins.every(b=>b.volume>=0&&b.share>=0),"valid bin data");
assert.ok(full.bins.every((b,i)=>i===0 || b.price>full.bins[i-1].price),"ascending bins");
assert.ok(full.bins.every(b=>["HVN","LVN",null].includes(b.node)),"node names");
assert.equal(volumeProfile(st,base,base+3600,base+3599,3)?.bins.length,24,"min bins");
assert.equal(volumeProfile(st,base,base+3600,base+3599,1000)?.bins.length,128,"max bins");
assert.equal(volumeProfile(st,base+3600,base,base+3599),null,"invalid reverse interval");
assert.equal(volumeProfile(st,NaN,base+3600,base+3599),null,"invalid numerical range");
assert.equal(volumeProfile(st,base,base+3600,base+59),null,"not enough candles at cutoff");
assert.equal(volumeProfile(st,base,base+3600,base+119)?.bars,2,"cutoff cannot see future bars");
const none={...raw,v:raw.v.map(()=>0)};
assert.equal(volumeProfile(new BarStore(none),base,base+3600,base+3599),null,"no fake zero volume");
const flat={...raw,o:raw.o.map(()=>100),h:raw.h.map(()=>100),l:raw.l.map(()=>100),c:raw.c.map(()=>100)};
const flatP=volumeProfile(new BarStore(flat),base,base+3600,base+3599);
assert.ok(flatP?.total===1200,"flat candles supported");
assert.ok(flatP.bins.filter(x=>x.volume>0).length===1,"flat ticks placed in a single bucket");
const partial={...raw,v:raw.v.map((v,i)=>i%2?v:0)};
assert.equal(volumeProfile(new BarStore(partial),base,base+3600,base+3599)?.coverage,.5,"missing ticks visible");
// Append baseline candles then an artificial bullish displacement + three-bar gap.
const g={ts:[],o:[],h:[],l:[],c:[],sp:[],v:[]};
const b2=base+24*3600;
const candle5=(o,h,l,c,volume=20)=> {
  for(let i=0;i<5;i++) {
    g.ts.push(b2+g.ts.length*60);
    g.o.push(o);g.h.push(h);g.l.push(l);g.c.push(c);g.sp.push(.1);g.v.push(volume);
  }
};
for(let i=0;i<22;i++)candle5(100,100.55,99.45,100);
candle5(100,100.8,99.4,100.2);      // left
candle5(100.3,103.4,100.2,103.2);   // displacement
candle5(102.3,104.1,102.05,103.5); // right: FVG [100.8,102.05]
candle5(103.1,104.2,102.4,103.5);  // does not fill
candle5(102.2,104,100.3,101.0);    // future mitigation closes gap
const gs=new BarStore(g);
const before=b2+(25*5)*60-1;
const after=b2+(27*5)*60-1;
const openG=fairValueGaps(gs,before,5,20);
assert.ok(openG.some(x=>x.side===1&&x.state==="open"),"future mitigation cannot leak backward");
const closedG=fairValueGaps(gs,after,5,20);
assert.ok(!closedG.some(x=>x.side===1&&x.start===b2+24*5*60),"mitigated gap excluded from live zones");
assert.ok(openG.every(x=>x.lo<x.hi),"FVG bounds valid");
assert.ok(openG.every(x=>x.start<=before),"FVG timestamp respects cutoff");
assert.deepEqual(fairValueGaps(st,base-60),[],"no gaps before bar data");
const flow=buildFlow(st,base+3599,{mode:"recent",scope:"day",cutoff:base+3599});
assert.equal(flow.ok,true);
assert.equal(flow.quality.coveragePct,100);
assert.equal(flow.profile.method,"MT5_TICK_VOLUME_OHLC_UNIFORM");
assert.ok(flow.evidence.some(x=>x.includes("POC")),"describes relevant evidence");
assert.ok(flow.levels.some(x=>x.key==="POC"),"POC levels");
assert.ok(flow.levels.some(x=>x.key==="VAH"),"VAH levels");
assert.ok(flow.levels.some(x=>x.key==="VAL"),"VAL levels");
assert.ok(flow.levels.some(x=>x.key==="VWAP"),"VWAP levels");
assert.equal(flow.quality.cutoff,base+3599,"cutoff kept");
assert.equal(buildFlow(st,base+3599,{mode:"fixed",start:base,end:base-1}).ok,false,"bad fixed range rejects");
assert.equal(buildFlow(st,base+3599,{mode:"fixed",start:base,end:base+21*86400}).ok,false,"20 day cap");
const first=buildFlow(st,base+3599,{mode:"fixed",start:base,end:base+20*60,cutoff:base+19*60+59});
assert.equal(first.profile?.bars,20,"fixed selector includes only selected candles");
console.log("✓ Institutional Flow: 35+ numerical, conservation, gap, no-lookahead and data quality assertions");
