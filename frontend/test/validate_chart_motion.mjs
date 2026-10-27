import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {build} from "esbuild";
const built=await build({entryPoints:["src/chart/historySync.ts","src/chart/viewport.ts"],
 bundle:true,format:"esm",platform:"node",write:false,outdir:"/virtual",logLevel:"silent"});
async function read(name){const output=built.outputFiles.find(x=>x.path.endsWith("/"+name+".js"));assert.ok(output);
 return import("data:text/javascript;base64,"+Buffer.from(output.text).toString("base64"));}
const {historyChange,mergeCurrentTick}=await read("historySync");
const {captureViewport,restoreViewport}=await read("viewport");
const candle=(time,close=2500,volume=12)=>({time,open:close-1,high:close+1,low:close-2,close,volume});
const old=Array.from({length:3000},(_,i)=>candle(1700000040+i*60,2500+i*.01));
assert.equal(historyChange([],old).kind,"replace","first load only");
assert.equal(historyChange(old,old).kind,"unchanged","identical polling should not repaint 3000 candles");
const revise=[...old];revise[2999]=candle(old[2999].time,2600);
assert.equal(historyChange(old,revise).kind,"incremental");
assert.equal(historyChange(old,revise).updates.length,1,"last candle updated without setData");
const next=[...old,candle(old.at(-1).time+60)];
assert.equal(historyChange(old,next).kind,"incremental");
assert.equal(historyChange(old,next).updates.length,1,"one new bar => one update");
const multiple=[...revise,candle(old.at(-1).time+60),candle(old.at(-1).time+120)];
assert.equal(historyChange(old,multiple).kind,"incremental");
assert.equal(historyChange(old,multiple).updates.length,3,"tail correction + two new bars");
const correction=[...old];correction[30]=candle(old[30].time,2400);
assert.equal(historyChange(old,correction).kind,"replace","real historical correction is accepted");
const rolling=[...old.slice(1),candle(old.at(-1).time+60)];
assert.equal(historyChange(old,rolling).kind,"replace","rolled historical window only");
const latest={...old.at(-1),close:2700,high:2701,low:2450};
const merge=[...old];mergeCurrentTick(merge,latest,latest.time+25,60);
assert.equal(merge.length,old.length);
assert.equal(merge.at(-1).close,2700);
const stale=[...old];mergeCurrentTick(stale,latest,latest.time-60,60);
assert.equal(stale.at(-1).close,old.at(-1).close,"old tick never overwrites historical candle");
const added=[...old];mergeCurrentTick(added,candle(old.at(-1).time+60,2701),old.at(-1).time+65,60);
assert.equal(added.length,old.length+1,"append provisional live candle when bridge has not sent it yet");
const actions=[];
const chart={timeScale:()=>({
 getVisibleLogicalRange:()=>({from:2950,to:3007}),
 getVisibleRange:()=>({from:old[2950].time,to:old[2999].time}),
 setVisibleLogicalRange:(v)=>actions.push(["logical",v]),
 setVisibleRange:(v)=>actions.push(["time",v]),
})};
const manuallyPanned=captureViewport(chart,3000,false);
assert.equal(manuallyPanned.follow,false,"even near the newest candle, manual exploration must persist");
restoreViewport(chart,manuallyPanned,3000,false);
assert.equal(actions[0][0],"time","manual historical time range remains unchanged");
actions.length=0;
const follow=captureViewport(chart,3000,true);
restoreViewport(chart,follow,3001,false);
assert.equal(actions[0][0],"logical","only explicit following mode moves viewport");
const code=readFileSync("src/components/Chart.tsx","utf8");
assert.ok(code.includes("historyChange("),"use delta synchronization");
assert.ok(code.includes("shiftVisibleRangeOnNewBar:false"),"manual interaction blocks library auto-shift");
assert.ok(code.includes('setFollowing(false)'),"manual interaction activates exploration");
assert.ok(code.includes('setFollowing(true)'),"explicit button restores following");
assert.ok(!code.includes("timeScale().fitContent()"),"never zoom to entire history on refresh");
assert.ok(code.includes("kineticScroll:"),"enable native inertial touch/mouse panning");
console.log("✓ Chart motion: 3000-candle no-op polling, incremental updates, explicit navigation, history corrections and stale-tick safety");
