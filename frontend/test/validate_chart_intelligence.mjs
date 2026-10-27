import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {build} from "esbuild";
const b=await build({entryPoints:[
  "src/chart/historyCache.ts","src/chart/workspaces.ts",
  "src/flow/institutionalSuite.ts","src/ai/bars.ts","src/flow/engine.ts"],
  bundle:true,format:"esm",platform:"node",write:false,outdir:"/virtual",logLevel:"silent"});
async function use(name){
  const x=b.outputFiles.find(f=>f.path.endsWith("/"+name+".js"));
  assert.ok(x,"built "+name);
  return import("data:text/javascript;base64,"+Buffer.from(x.text).toString("base64"));
}
const {cacheKey,cachePut,cacheGet,mergePages,INITIAL_SIZE,HISTORICAL_PAGE_SIZE}=await use("historyCache");
const w=await use("workspaces");
const {BarStore}=await use("bars");
const {volumeProfile,buildFlow}=await use("engine");
const {buildVolumeSuite,buildLiquidityMap}=await use("institutionalSuite");
const candle=time=>({time,open:2400,high:2402,low:2399,close:2401,volume:25});
const page1=Array.from({length:900},(_,i)=>candle(i*60+60));
const page0=Array.from({length:700},(_,i)=>candle(i*60-698*60));
const merged=mergePages(page0,page1);
assert.equal(merged.length,1599,"overlap timestamps are deduplicated");
assert.equal(merged[merged.length-1].time,page1.at(-1).time);
assert.ok(INITIAL_SIZE<1500&&HISTORICAL_PAGE_SIZE<1000);
const k=cacheKey("account-a","M5"),other=cacheKey("account-b","M5");
cachePut(k,page1);
assert.equal(cacheGet(k).length,900);
assert.equal(cacheGet(other),null,"account cache isolation");
const local=new Map();
globalThis.localStorage={getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)};
assert.deepEqual(w.readWorkspaces(),[]);
const ws={id:"my-m5",name:"Scalping M5",tf:"M5",theme:"grafito",
  layers:{volumen:true,heatmap:true},flow:{mode:"session",scope:"london",focus:"all",bins:64},
  forecast:false,createdAt:Date.now()};
w.writeWorkspace(ws);assert.equal(w.readWorkspaces().length,1);
w.removeWorkspace(ws.id);assert.equal(w.readWorkspaces().length,0);
const ts=Date.UTC(2026,7,1)/1000;
const raw={ts:[],o:[],h:[],l:[],c:[],v:[],sp:[]};
for(let i=0;i<18*1440;i++){
 const p=2400+Math.sin(i/30)*4+Math.sin(i/7);
 raw.ts.push(ts+i*60);raw.o.push(p-.2);raw.h.push(p+.6);raw.l.push(p-.65);raw.c.push(p+.3);
 raw.v.push(12+i%15);raw.sp.push(.2);
}
const st=new BarStore(raw);
const cutoff=raw.ts.at(-1)+59;
const p=volumeProfile(st,cutoff-4*3600,cutoff+1,cutoff,48);
assert.ok(p&&p.bars>100);
const suite=buildVolumeSuite(st,p,cutoff);
assert.ok(suite.developing.length===4);
assert.ok(suite.anchoredVwap>0);
assert.ok(suite.timeOfDayRvol!=null,"RVOL by broker-server clock with 5+ days");
assert.ok(suite.baselineDays>=5);
assert.ok(suite.effortResult!=null);
const levels=[
 {key:"POC",price:2400,label:"POC",source:"tick",side:"at"},
 {key:"VAH",price:2400.3,label:"VAH",source:"tick",side:"at"},
 {key:"PDH",price:2400.4,label:"PDH",source:"range",side:"at"},
 {key:"PDL",price:2380,label:"PDL",source:"range",side:"below"},
];
const map=buildLiquidityMap(levels,[],[],p,cutoff);
assert.ok(map.some(x=>x.sourceCount>=3),"cluster should count distinct evidence sources");
assert.ok(map.every(x=>x.intensity<=100),"intensity not a touch probability");
assert.ok(!map.some(x=>x.sources.includes("real orderbook")),"confluence is not executable depth");
assert.deepEqual(buildLiquidityMap([],[],[],null,cutoff),[]);
const flow=buildFlow(st,cutoff,{mode:"recent",scope:"day",cutoff,bins:48});
assert.ok(flow.suite?.developing.length===4);
assert.ok(Array.isArray(flow.heatmap));
const chart=readFileSync("src/components/Chart.tsx","utf8");
const cloud=readFileSync("src/cloud/engine.ts","utf8");
assert.ok(chart.includes("subscribeVisibleLogicalRangeChange"),"load older on left edge");
assert.ok(chart.includes("mergePages("),"progressively merge old and recent candles");
assert.ok(chart.includes("shiftVisibleRangeOnNewBar: false"),"never auto-pan by default");
assert.ok(chart.includes("readViewport(key)"),"restore user timeframe view");
assert.ok(chart.includes("setFollowing(false)"),"explicit free navigation");
assert.ok(chart.includes("cachePut("),"cache history by account");
assert.ok(chart.includes("writeWorkspace("),"save workspaces");
assert.ok(cloud.includes('p_to:Math.floor(before-1)'),"historical query is strictly before current window");
assert.ok(cloud.includes("acc:accountId"),"reuses scoped RLS-protected RPC");
console.log("✓ Chart Intelligence: cache isolation, historic merging, free viewport, volume suite, confluence and workspace saves");
