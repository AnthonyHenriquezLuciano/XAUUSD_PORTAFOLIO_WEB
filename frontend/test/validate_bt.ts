import { readFileSync } from "fs";
import { BarStore } from "../src/ai/bars";
import { DEFAULT_CFG, DEFAULT_STRATS, runBacktest, summarize } from "../src/ai/backtest";
const dir = process.argv[2];
const fx = JSON.parse(readFileSync(dir + "/fixture.json", "utf8"));
const st = new BarStore(fx.bars, 0);
for (const fund of [false, true]) {
  const py = JSON.parse(readFileSync(`${dir}/bt_py_${fund ? 1 : 0}.json`, "utf8"));
  const t0 = Date.now();
  const res = runBacktest(st, DEFAULT_STRATS, { ...DEFAULT_CFG, funding: fund, target_pct: fund ? 8 : 0 });
  const sm = summarize(res);
  let same = 0, diff: any[] = [];
  const key = (t: any) => `${t.strategy}|${t.t_open}`;
  const pm = new Map(py.trades.map((t: any) => [key(t), t]));
  for (const t of res.trades) { const p: any = pm.get(key(t)); if (p && Math.abs(p.pnl - t.pnl) < 0.01 && p.reason === t.reason) same++; else if (diff.length < 5) diff.push({ js: t, py: p }); }
  console.log(`funding=${fund}: JS ${res.trades.length} ops, final ${res.final.toFixed(2)} | Python ${py.trades.length} ops, final ${py.final.toFixed(2)} | idénticas ${same} | ${Date.now() - t0} ms | ret ${sm.ret_pct}% dd ${sm.max_dd_pct}%`);
  if (diff.length) console.log(JSON.stringify(diff.slice(0, 2)));
}
