import assert from "node:assert/strict";
import {build} from "esbuild";
const b=await build({entryPoints:["src/premium/portfolioDependence.ts"],bundle:true,platform:"node",format:"esm",write:false,logLevel:"silent"});
const m=await import("data:text/javascript;base64,"+Buffer.from(b.outputFiles[0].text).toString("base64"));
const now=new Date().toISOString();
const entry=(id,side,currency="USD",updated_at=now,stop=2300)=>({
  acc:{id,name:id,symbol:"XAUUSD",server:"MT5"},
  live:{account_id:id,bid:2320,ask:2320.3,updated_at},
  state:{account_id:id,account:{currency},ea:{contract:100},positions:[{symbol:"XAUUSD",side,volume:.1,sl:stop}]}
});
const rows=m.exposureBySymbol([entry("A",1),entry("B",-1)]);
assert.equal(rows.length,1);
assert.equal(rows[0].accountCount,2);
assert.equal(rows[0].positionCount,2);
assert.equal(rows[0].buyLots,.1);
assert.equal(rows[0].sellLots,.1);
assert.equal(rows[0].missingData,0);
assert.ok(rows[0].grossNotionalUsd>46000);
assert.ok(Math.abs(rows[0].netNotionalUsd)<100);
const stale=m.exposureBySymbol([entry("A",1,"USD","2020-01-01T00:00:00Z")]);
assert.equal(stale[0].grossNotionalUsd,null);
assert.equal(stale[0].missingData,1);
const otherCurrency=m.exposureBySymbol([entry("A",1,"EUR")]);
assert.equal(otherCurrency[0].grossNotionalUsd,null);
const missingCurrency=m.exposureBySymbol([entry("A",1,null)]);
assert.equal(missingCurrency[0].grossNotionalUsd,null);
const trade=(id,strategy,day,pnl)=>({id,account_id:"a",t_close:1700000000+day*86400,pnl,strategy});
const few=[trade(1,"AORB",0,10),trade(2,"TOK",0,-15),trade(3,"TOK",1,25)];
assert.equal(m.strategyDependence(few)[0].r,null,"insufficient shared days => no correlation");
const trades=[];
for(let day=0;day<25;day++){
 trades.push(trade(day*2+1,"AORB",day,day%2?10:-10));
 trades.push(trade(day*2+2,"TOK",day,day%2?20:-20));
}
const dependency=m.strategyDependence(trades);
assert.equal(dependency[0].sharedActiveDays,25);
assert.equal(dependency[0].r,1);
assert.equal(dependency[0].status,"observed");
assert.deepEqual(m.strategyDependence([]),[]);
console.log("✓ Portfolio dependence: broker contract provenance, FX isolation, stale feed, and conditional common-day correlation");
