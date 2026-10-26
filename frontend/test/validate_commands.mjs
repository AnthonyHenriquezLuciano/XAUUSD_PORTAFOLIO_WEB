import assert from "node:assert/strict";
import { build } from "esbuild";
const b=await build({entryPoints:["src/premium/commandGuard.ts"],bundle:true,platform:"node",format:"esm",write:false,logLevel:"silent"});
const { outstandingCommands,commandAudit,commandNotice }=await import("data:text/javascript;base64,"+Buffer.from(b.outputFiles[0].text).toString("base64"));
const t="2026-10-26T12:00:00.000Z";const time=Date.parse(t)+31*1000;
const rows=[
 {id:10,type:"open",status:"sent",created_at:t},
 {id:11,type:"open",status:"done",created_at:t},
 {id:12,type:"modify",status:"error",created_at:t},
 {id:13,type:"history",status:"pending",created_at:t},
 {id:14,type:"close_all",status:"pending",created_at:t}
];
assert.deepEqual(outstandingCommands(rows).map(x=>x.id),[10,14]);
const a=commandAudit(rows,time);
assert.equal(a.blocked,true);
assert.equal(a.pending.length,2);
assert.equal(a.oldestAgeSec,31);
assert.equal(a.recentFailures,1);
assert.match(a.explained,/no ha sido confirmado/);
assert.match(commandNotice(rows[0],time),/#10.*31 s/);
const clean=commandAudit(rows.filter(x=>x.status==="done"||x.status==="error"));
assert.equal(clean.blocked,false);
assert.deepEqual(outstandingCommands([]),[]);
assert.equal(commandAudit([{id:1,type:"open",status:"expired"}]).blocked,false);
console.log("✓ Command audit: unknown ACK, fail-closed status and safe history separation");
