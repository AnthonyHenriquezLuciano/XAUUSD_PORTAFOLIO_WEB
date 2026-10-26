import { readFileSync } from "fs";
import { BarStore } from "../src/ai/bars";
import { computeFeatures, FEATURES } from "../src/ai/features";
import { parseModels, predictProba } from "../src/ai/model";
const fx = JSON.parse(readFileSync(process.argv[2], "utf8"));
const models = parseModels(JSON.parse(readFileSync(process.argv[3], "utf8")));
const st = new BarStore(fx.bars, 0);
let t0 = Date.now();
const T = computeFeatures(st);
console.log("features ms", Date.now() - t0, "bars", st.length);
// ATR diario
let atrBad = 0;
fx.d_atr.forEach((v: number | null, k: number) => { const a = st.dAtr[k]; if ((v == null) !== Number.isNaN(a) || (v != null && Math.abs(v - a) > 1e-9)) atrBad++; });
console.log("d_atr distintos", atrBad, "de", fx.d_atr.length);
const worst: Record<string, number> = {};
let nanMismatch: Record<string, number> = {};
fx.idx.forEach((i: number, r: number) => {
  for (const f of FEATURES) {
    const py = fx.feat[f][r], js = T[f][i];
    if ((py == null) !== Number.isNaN(js)) { nanMismatch[f] = (nanMismatch[f] || 0) + 1; continue; }
    if (py == null) continue;
    const err = Math.abs(py - js) / Math.max(1, Math.abs(py));
    worst[f] = Math.max(worst[f] || 0, err);
  }
});
console.log("NaN distintos", nanMismatch);
console.log("error relativo máximo", Object.fromEntries(Object.entries(worst).filter(([, v]) => v > 1e-9).map(([k, v]) => [k, v.toExponential(2)])));
// modelo con la misma matriz X de Python
let pErr = 0;
t0 = Date.now();
fx.X.forEach((row: (number | null)[], r: number) => {
  const p = predictProba(models, row.map((v) => (v == null ? NaN : v)));
  p.forEach((v, k) => { pErr = Math.max(pErr, Math.abs(v - fx.proba[r][k])); });
});
console.log("modelo: error máximo de probabilidad", pErr.toExponential(2), "en", fx.X.length, "filas,", Date.now() - t0, "ms");
