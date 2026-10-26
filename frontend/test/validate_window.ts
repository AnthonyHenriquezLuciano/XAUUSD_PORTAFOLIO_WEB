import { readFileSync } from "fs";
import { BarStore } from "../src/ai/bars";
import { computeFeatures, FEATURES } from "../src/ai/features";
const fx = JSON.parse(readFileSync(process.argv[2], "utf8"));
const full = new BarStore(fx.bars, 0);
const TF = computeFeatures(full);
// ventana: últimas 21600 velas M1 (~15 días) + tabla diaria anterior
const n = full.length, a = n - 21600;
const firstDay = full.dayn[a];
const k0 = full.days.findIndex((d) => d === firstDay);
const a2 = full.dayFirst[k0];   // empezar en el inicio de ese día
const sl = (x: number[]) => x.slice(a2);
const win = new BarStore({ ts: sl(fx.bars.ts), o: sl(fx.bars.o), h: sl(fx.bars.h), l: sl(fx.bars.l), c: sl(fx.bars.c), sp: sl(fx.bars.sp), v: sl(fx.bars.v) }, 0, 14,
  { d: Array.from(full.days.subarray(0, k0)), o: Array.from(full.dOpen.subarray(0, k0)), h: Array.from(full.dHigh.subarray(0, k0)), l: Array.from(full.dLow.subarray(0, k0)), c: Array.from(full.dClose.subarray(0, k0)) });
const TW = computeFeatures(win);
const worst: Record<string, number> = {};
for (let i = n - 3000; i < n; i++) {
  const j = i - a2;
  for (const f of FEATURES) {
    const x = TF[f][i], y = TW[f][j];
    if (Number.isNaN(x) !== Number.isNaN(y)) { worst[f] = Infinity; continue; }
    if (!Number.isNaN(x)) worst[f] = Math.max(worst[f] || 0, Math.abs(x - y) / Math.max(1, Math.abs(x)));
  }
}
console.log(Object.fromEntries(Object.entries(worst).filter(([, v]) => v > 1e-6).map(([k, v]) => [k, v])));
console.log("ventana", win.length, "días", win.days.length, "de", full.days.length);
