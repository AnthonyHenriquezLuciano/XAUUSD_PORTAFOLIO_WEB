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

// Gestión automática: sin activar no cambia nada; con ella, comparación orientativa.
const base = runBacktest(st, DEFAULT_STRATS, { ...DEFAULT_CFG, funding: false, mg: null });
const variants: [string, any][] = [
  ["BE 1R", { be: true, be_r: 1, be_off: 0.1, tr: false, tr_start: 1.5, tr_dist: 1, pt: false, pt_r: 1, pt_pct: 50 }],
  ["Trailing 1.5R/1R", { be: false, be_r: 1, be_off: 0.1, tr: true, tr_start: 1.5, tr_dist: 1, pt: false, pt_r: 1, pt_pct: 50 }],
  ["Parcial 50% a 1R", { be: false, be_r: 1, be_off: 0.1, tr: false, tr_start: 1.5, tr_dist: 1, pt: true, pt_r: 1, pt_pct: 50 }],
];
const sb = summarize(base);
console.log(`gestión: sin gestión ret ${sb.ret_pct}% dd ${sb.max_dd_pct}% ops ${base.trades.length}`);
for (const [name, mg] of variants) {
  const r = runBacktest(st, DEFAULT_STRATS, { ...DEFAULT_CFG, funding: false, mg });
  const sm = summarize(r);
  const reasons: Record<string, number> = {};
  for (const t of r.trades) reasons[t.reason] = (reasons[t.reason] || 0) + 1;
  console.log(`gestión: ${name} ret ${sm.ret_pct}% dd ${sm.max_dd_pct}% ops ${r.trades.length} ${JSON.stringify(reasons)}`);
  for (const t of r.trades) if (t.lots <= 0 || !Number.isFinite(t.pnl)) throw new Error("operación inválida");
}
