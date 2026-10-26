// Señales del mercado y evaluación de operaciones (port de signals.py y review.py) sobre las velas de la cuenta.
import { BarStore, dayOf, dowOf, fhm, lowerBound, modOf } from "./bars";
import { featRow, FeatRow, FeatTable } from "./features";
import { forecast, labelRegime, labelVol, Models, predictEntry, scenGet, session, trendScore } from "./model";

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Variables de la vela en curso (la última vela cerrada describe el momento actual). */
export function featAt(st: BarStore, T: FeatTable | null, tSrv: number): FeatRow | null {
  if (!T || !st.length) return null;
  const i = Math.min(st.length - 1, Math.max(0, lowerBound(st.ts, tSrv + 1) - 1));
  const f = featRow(T, i);
  return f;
}

export function levelsAt(st: BarStore, tSrv: number, bid: number, upto = st.length) {
  const tn = st.toNorm(tSrv), mod = modOf(tn), day = dayOf(tn);
  const lv: { name: string; price: number; kind: string }[] = [];
  const rg = mod > 66 ? st.rangeHL(day, 65, Math.min(mod, 540), upto) : null;
  if (rg) lv.push({ name: "Máximo Asia", price: rg[0], kind: "asia" }, { name: "Mínimo Asia", price: rg[1], kind: "asia" });
  let prev = -1;
  for (let j = 0; j < st.days.length; j++) if (st.days[j] < day && dowOf(st.days[j]) < 5) prev = j;
  if (prev >= 0) lv.push({ name: "Máximo de ayer", price: st.dHigh[prev], kind: "pd" }, { name: "Mínimo de ayer", price: st.dLow[prev], kind: "pd" });
  const k = st.dayIdx(day);
  if (k >= 0) {
    lv.push({ name: "Apertura del día", price: st.dOpen[k], kind: "open" });
    const j = st.barAt(day, 65, 5, upto);
    if (j >= 0) lv.push({ name: "Apertura 01:05", price: st.o[j], kind: "open" });
  }
  if (bid > 0) for (const m of [Math.floor(bid / 50) * 50, Math.ceil(bid / 50) * 50]) lv.push({ name: `Nivel redondo ${m.toFixed(0)}`, price: m, kind: "r50" });
  return { levels: lv, asia: rg, mod, day };
}

export function zonesAt(st: BarStore, tSrv: number) {
  const day = dayOf(st.toNorm(tSrv));
  const zones: any[] = [];
  for (const [name, a, b] of [["Asia 01:05-09:00", 65, 540], ["Tokio 03:00-03:30", 180, 210], ["Rango AORB 03:30-04:30", 210, 270]] as [string, number, number][]) {
    const rg = st.rangeHL(day, a, b);
    if (rg) zones.push({ name, t0: st.toSrv(day + a * 60), t1: st.toSrv(day + b * 60), hi: rg[0], lo: rg[1] });
  }
  return zones;
}

/** Estado completo del mercado para el panel de Señales. */
export function marketState(st: BarStore, T: FeatTable | null, m: Models | null, strategies: any[], bid: number, tSrv: number) {
  const f = featAt(st, T, tSrv);
  if (!f || !Number.isFinite(f.atr)) return { ok: false, msg: "Sin datos suficientes todavía: hacen falta unas semanas de velas M1 para el ATR y el régimen." };
  const regime = labelRegime(f), vol = labelVol(f), ts_ = trendScore(f);
  const { levels, asia: rg, mod } = levelsAt(st, tSrv, bid);
  const fc = forecast(m, f, bid, tSrv);
  const strat = strategies.map((s) => ({ ...s, scenario: scenGet(m, s.name, regime, vol) }));
  const regTxt = ({ alcista: "Tendencia alcista", bajista: "Tendencia bajista", rango: "Rango lateral", transicion: "Transición (sin tendencia clara)" } as any)[regime];
  const volTxt = ({ baja: "volatilidad baja", normal: "volatilidad normal", alta: "volatilidad alta", extrema: "volatilidad extrema" } as any)[vol];
  const retDay = Number.isFinite(f.ret_day) ? f.ret_day : 0;
  const bias = retDay > 0.15 && ts_ > 0 ? "comprador" : retDay < -0.15 && ts_ < 0 ? "vendedor" : "neutral";
  const tips: string[] = [];
  if (regime === "alcista" || regime === "bajista") tips.push(`Tendencia ${regime}: prioriza ${regime === "alcista" ? "compras" : "ventas"}.`);
  else if (regime === "rango") tips.push("Mercado lateral: las rupturas fallan más. Espera confirmación.");
  if (vol === "alta" || vol === "extrema") tips.push("Volatilidad alta: no entres en plena vela de noticia.");
  else if (vol === "baja") tips.push("Volatilidad baja: los objetivos tardan más en llegar.");
  if (rg && mod >= 540) {
    const [hi, lo] = rg;
    tips.push(bid > hi ? "Precio por encima del rango de Asia." : bid < lo ? "Precio por debajo del rango de Asia." : "Precio dentro del rango de Asia: ALB puede activarse a ambos lados.");
  }
  const best = strat.filter((s) => s.scenario && s.state === "pendiente").sort((a, b) => b.scenario.expR - a.scenario.expR)[0];
  if (best) tips.push(`Mejor historial en este escenario: ${best.name} (${best.scenario.expR >= 0 ? "+" : ""}${best.scenario.expR.toFixed(2)} R, ${best.scenario.n_cell} casos).`);
  const p4 = fc?.points.find((p: any) => p.h === 4);
  if (p4) tips.push(`Rango probable a 4 h: ${p4.p10.toFixed(2)} – ${p4.p90.toFixed(2)}.`);
  return {
    ok: true, time: tSrv, hour: fhm(mod), session: session(mod), regime, regime_text: regTxt, vol, vol_text: volTxt, trend_score: r2(ts_), atr: r2(f.atr),
    atr_rank: Number.isFinite(f.atr_rank) ? r2(f.atr_rank) : null, rv60: Number.isFinite(f.rv60) ? Math.round(f.rv60 * 1000) / 1000 : null, bias,
    ret_day_atr: r2(retDay), day_range_atr: Number.isFinite(f.day_rng) ? r2(f.day_rng) : null, levels, forecast: fc, strategies: strat,
    summary: `${regTxt} con ${volTxt} en sesión ${session(mod)}. Sesgo del día: ${bias}.`, tips,
  };
}

/** Evaluación de una operación: nota, si fue buena entrada o convenía esperar, riesgo, alineación y qué daba el modelo. */
export function evaluateTrade(st: BarStore, T: FeatTable | null, m: Models | null, tr: any, balance: number, contract = 100) {
  const side = tr.side, entry = Number(tr.entry), sl = Number(tr.sl || 0), tp = Number(tr.tp || 0), t0 = Number(tr.t_open), t1 = Number(tr.t_close || 0);
  const n = st.length;
  const i0 = lowerBound(st.ts, t0 - (t0 % 60));
  if (i0 >= n - 1) return { ok: false, msg: "Todavía no hay velas posteriores a la entrada para evaluarla." };
  const f = featAt(st, T, t0);
  const atr = f && Number.isFinite(f.atr) ? f.atr : st.atrForDay(dayOf(st.toNorm(t0)));
  if (!Number.isFinite(atr)) return { ok: false, msg: "Faltan velas anteriores a la entrada para calcular el ATR (se necesitan unas semanas de histórico)." };
  const slD = sl ? Math.abs(entry - sl) : 0.5 * atr;
  const R = slD > 0 ? slD : atr * 0.5;
  const endT = t1 || t0 + 4 * 3600;
  let i1 = Math.min(lowerBound(st.ts, endT + 1), n);
  i1 = Math.max(i1, i0 + 1);
  const { o: O, h: H, l: L, sp: SP } = st;
  let mfe = -Infinity, kM = i0, mae = 0, worstBefore = 0;
  const adv: number[] = [];
  for (let k = i0; k < i1; k++) {
    const fv = side > 0 ? H[k] - entry : entry - (L[k] + SP[k]);
    const av = side > 0 ? entry - L[k] : H[k] + SP[k] - entry;
    adv.push(av);
    if (fv > mfe) { mfe = fv; kM = k; }
    if (av > mae) mae = av;
  }
  let kBest = i0, better = 0;
  for (let k = i0; k <= kM; k++) {
    worstBefore = Math.max(worstBefore, adv[k - i0]);
    const imp = side > 0 ? entry - (L[k] + SP[k]) : H[k] - entry;
    if (imp > better) { better = imp; kBest = k; }
  }
  const waitMin = Math.round((st.ts[kBest] - t0) / 60);
  const a = Math.max(0, i0 - 30);
  const run30 = atr > 0 ? (entry - O[a]) * side / atr : 0;
  const resultR = tr.exit ? (Number(tr.exit) - entry) * side / R : null;
  const regime = f ? labelRegime(f) : "transicion", vol = f ? labelVol(f) : "normal";
  const aligned = (regime === "alcista" && side > 0) || (regime === "bajista" && side < 0) ? "a favor" : (regime === "alcista" && side < 0) || (regime === "bajista" && side > 0) ? "en contra" : "neutral";
  const tpR = tp && slD > 0 ? Math.abs(tp - entry) / slD : 0;
  const model = predictEntry(m, f, side, slD, tpR);
  const alts: any[] = [];
  for (const w of [15, 30, 60]) {
    const j = lowerBound(st.ts, t0 + w * 60);
    if (j < n) { const pj = predictEntry(m, featAt(st, T, st.ts[j]), side, slD, tpR); if (pj) alts.push({ wait_min: w, price: O[j], ...pj }); }
  }
  const riskPct = balance && tr.lots && sl ? tr.lots * slD * contract / balance * 100 : null;
  let score = 60;
  const notes: string[] = [];
  let timing = "Entrada aceptable";
  if (!sl) { score -= 25; notes.push("Sin stop loss: la pérdida no estaba limitada."); }
  else { const sa = slD / atr; if (sa < 0.08) { score -= 10; notes.push(`SL muy ajustado (${sa.toFixed(2)} ATR): el ruido normal del oro lo toca con facilidad.`); } else if (sa > 1.2) { score -= 5; notes.push(`SL muy amplio (${sa.toFixed(2)} ATR).`); } }
  if (tpR && tpR < 1) { score -= 5; notes.push(`Relación beneficio/riesgo baja (1:${tpR.toFixed(1)}).`); }
  if (riskPct != null) { if (riskPct > 2) { score -= 15; notes.push(`Riesgo alto: ${riskPct.toFixed(2)} % de la cuenta en una operación.`); } else if (riskPct <= 1) score += 5; }
  if (aligned === "a favor") { score += 8; notes.push("A favor del régimen de tendencia."); } else if (aligned === "en contra") { score -= 10; notes.push("En contra del régimen de tendencia."); }
  if (run30 > 0.4) { score -= 8; notes.push(`Entrada tras un tirón de ${run30.toFixed(2)} ATR en 30 min: riesgo de perseguir el precio.`); }
  const mbm = worstBefore / R;
  if (mbm <= 0.3) { score += 12; timing = "Buena entrada"; notes.push(`El precio apenas fue en contra (${mbm.toFixed(2)} R) antes de avanzar.`); }
  else if (mbm > 0.7) { score -= 10; timing = "Debiste esperar"; notes.push(`Antes de avanzar, el precio fue ${mbm.toFixed(2)} R en contra; esperando unos ${waitMin} min habrías entrado ${(better / R).toFixed(2)} R mejor.`); }
  if (model) {
    if (model.exp_R > 0.05) score += 5; else if (model.exp_R < -0.15) score -= 5;
    const best = alts.reduce((x: any, y: any) => (!x || y.exp_R > x.exp_R ? y : x), null);
    if (best && best.exp_R > model.exp_R + 0.1) notes.push(`Según el modelo, esperar ${best.wait_min} min daba más R esperado (${best.exp_R >= 0 ? "+" : ""}${best.exp_R.toFixed(2)} frente a ${model.exp_R >= 0 ? "+" : ""}${model.exp_R.toFixed(2)}).`);
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const verdict = score >= 80 ? "Excelente" : score >= 65 ? "Buena" : score >= 45 ? "Mejorable" : "Mala";
  const complete = !t1 ? i1 >= lowerBound(st.ts, t0 + 4 * 3600) : st.ts[n - 1] >= t1 - 60;
  return {
    ok: true, complete, score, verdict, timing, notes, result_R: resultR == null ? null : r2(resultR), mfe_R: r2(Math.max(0, mfe) / R), mae_R: r2(mae / R),
    mae_before_mfe_R: r2(mbm), better_entry_R: r2(better / R), wait_min: waitMin, best_price: r2(side > 0 ? entry - better : entry + better),
    regime, vol, aligned, session: session(modOf(st.toNorm(t0))), atr: r2(atr), sl_atr: r2(slD / atr), tp_r: r2(tpR),
    risk_pct: riskPct == null ? null : r2(riskPct), chase_atr: r2(run30), model, alternatives: alts,
  };
}
