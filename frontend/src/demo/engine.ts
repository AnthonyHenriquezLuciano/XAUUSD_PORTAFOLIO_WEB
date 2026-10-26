// @ts-nocheck
/* Motor de la DEMO en el navegador: el mismo comportamiento que el backend Python (simulador, portafolio,
   riesgo y reglas de fondeo, diario, evaluación, señales), con datos reales de XAUUSD M1 incrustados y
   tablas precalculadas por los modelos de IA. El chat usa Claude desde la propia página (capacidad "sample"). */

import { emit as busEmit } from "../api";
import { extractNotes, streamChat } from "../lib/chat";

const D = (window as any).DEMO_DATA;
const DAY = 86400;

// ------------------------------------------------------------------ datos
const N = D ? D.dt.length + 1 : 0;
const TS = new Float64Array(N), O = new Float64Array(N), H = new Float64Array(N), L = new Float64Array(N), C = new Float64Array(N), SP = new Float64Array(N);
if (D) {
  let t = D.t0;
  for (let i = 0; i < N; i++) {
    if (i > 0) t += D.dt[i - 1];
    TS[i] = t; O[i] = D.base + D.o[i] / 100; H[i] = D.base + D.h[i] / 100; L[i] = D.base + D.l[i] / 100; C[i] = D.base + D.c[i] / 100; SP[i] = Math.max(D.sp[i], 1) / 100;
  }
}
const lb = (arr: ArrayLike<number>, v: number) => { let a = 0, b = arr.length; while (a < b) { const m = (a + b) >> 1; if (arr[m] < v) a = m + 1; else b = m; } return a; };
const dayOf = (t: number) => t - (t % DAY);
const modOf = (t: number) => Math.floor((t % DAY) / 60);
const dowOf = (t: number) => (Math.floor(t / DAY) + 3) % 7;
const hm = (s: string) => { const [a, b] = s.split(":"); return +a * 60 + +b; };
const fhm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const r2 = (v: number) => Math.round(v * 100) / 100;
const atrFor = (day: number) => (D.atr[String(day)] ?? NaN);

// agregados diarios (para niveles)
const DAYS: any[] = [];
for (let i = 0; i < N; i++) {
  const d = dayOf(TS[i]);
  const last = DAYS[DAYS.length - 1];
  if (!last || last.day !== d) DAYS.push({ day: d, open: O[i], high: H[i], low: L[i], close: C[i], first: i });
  else { last.high = Math.max(last.high, H[i]); last.low = Math.min(last.low, L[i]); last.close = C[i]; }
}

// ------------------------------------------------------------------ bus (sustituye al WebSocket)
let muted = false;
const emit = (m: any) => { if (!muted) busEmit(m); };

// ------------------------------------------------------------------ ajustes (mismos valores por defecto que la app)
const settings: any = {
  symbol: "XAUUSD", magic: 2610200, server_shift_min: 0, hist_shift: false, hist_shift_end: "2025-03-09", hist_shift_min: 60,
  contract_size: 100, cost_per_lot: 10, lot_step: 0.01, lot_min: 0.01, atr_period: 14, autotrade: false, account_login: 1,
  account_server: "Simulación", terminal_path: "",
  risk: { risk_pct: 0.3, min_lot_tol: 2, compound: true, compound_up_pct: 2, compound_dn_pct: 1, max_open_trades: 4, use_time_exit: true,
    no_time_exit_tp_r: 3, dd_throttle: true, throttle_min: 0.3, max_spread: 0.8, ml_filter: false, ml_min_prob_tp: 0, ml_min_exp_r: 0 },
  funding: { enabled: true, preset: "FundingPips 2 fases", phase: 1, target_phase1_pct: 8, target_phase2_pct: 5, daily_loss_pct: 3, max_loss_pct: 10,
    daily_base: "max_balance_equity", daily_guard_pct: 2.5, max_guard_pct: 9, no_hedge: true, stop_at_target: true, initial_balance: 100000, min_trading_days: 3 },
  strategies: { LM: { enabled: true, params: {} }, AORB: { enabled: true, params: {} }, TOK: { enabled: true, params: {} }, R50: { enabled: true, params: {} }, ALB: { enabled: true, params: {} } },
  chat_model: "claude-sonnet-5-5", forecast_hours: 8, retrain_daily: true, history_days: 900,
};
const targetPct = () => settings.funding.phase === 1 ? settings.funding.target_phase1_pct : settings.funding.phase === 2 ? settings.funding.target_phase2_pct : 0;

// ------------------------------------------------------------------ estrategias (mismas reglas que builtin.py)
const DEFS: any = {
  LM: { off: 1, desc: "Momentum Asia -> Londres: a las 09:30 entra a favor del movimiento desde la apertura de las 01:05.", params: { open_time: "01:05", entry_time: "09:30", window_min: 5, sl_atr: 0.5, tp_r: 3.0, exit_time: "21:00" } },
  AORB: { off: 2, desc: "Ruptura del rango asiático 03:30-04:30.", params: { range_start: "03:30", range_end: "04:30", sl_atr: 0.25, tp_r: 3.0, exit_time: "23:30" } },
  TOK: { off: 3, desc: "Ruptura del rango de Tokio 03:00-03:30.", params: { range_start: "03:00", range_end: "03:30", sl_atr: 0.25, tp_r: 2.0, exit_time: "23:30" } },
  R50: { off: 4, desc: "Ruptura de los números redondos de $50 alrededor del precio de las 01:05.", params: { ref_time: "01:05", step: 50.0, buf_atr: 0.03, fill_end: "20:00", sl_atr: 0.15, tp_r: 0.0, exit_time: "23:30" } },
  ALB: { off: 5, desc: "Ruptura en Londres del rango de Asia (01:05-09:00); el precio debe estar dentro del rango a las 09:00.", inside: true, params: { range_start: "01:05", range_end: "09:00", fill_end: "18:00", sl_atr: 0.25, tp_r: 2.0, exit_time: "23:30" } },
};
const ORDER = ["R50", "TOK", "AORB", "ALB", "LM"];
const paramsOf = (name: string) => ({ ...DEFS[name].params, ...(settings.strategies[name]?.params || {}) });

function openAt(day: number, minute: number, cur: number, tol = 5) {
  const t = day + minute * 60;
  const j = lb(TS, t);
  if (j < N && TS[j] - t <= tol * 60 && dayOf(TS[j]) === day && j <= cur) return O[j];
  return null;
}
function rangeHL(day: number, s: number, e: number, upto: number) {
  const a = lb(TS, day + s * 60);
  const b = Math.min(lb(TS, day + e * 60), upto);
  if (b - a < Math.max(1, Math.floor((e - s) / 2))) return null;
  let hi = -Infinity, lo = Infinity;
  for (let k = a; k < b; k++) { if (H[k] > hi) hi = H[k]; if (L[k] < lo) lo = L[k]; }
  return [hi, lo];
}

function stratBar(name: string, st: any, ctx: any) {
  const p = paramsOf(name);
  if (name === "LM") {
    const e = hm(p.entry_time);
    if (st.done || ctx.mod < e) return null;
    st.done = true;
    if (ctx.mod > e + p.window_min) return null;
    const ref = openAt(ctx.day, hm(p.open_time), ctx.i);
    if (ref == null || isNaN(ctx.atr)) return null;
    const side = ctx.bid > ref ? 1 : ctx.bid < ref ? -1 : 0;
    if (!side) return null;
    return [{ kind: "market", sl: p.sl_atr * ctx.atr, side, tp_r: p.tp_r, exit_at: hm(p.exit_time), comment: name }];
  }
  if (name === "R50") {
    const r = hm(p.ref_time);
    if (st.done || ctx.mod < r) return null;
    st.done = true;
    if (ctx.mod > r + 10 || isNaN(ctx.atr)) return null;
    const p0 = openAt(ctx.day, r, ctx.i);
    if (p0 == null) return null;
    const up = Math.ceil(p0 / p.step) * p.step, dn = Math.floor(p0 / p.step) * p.step;
    if (up - p0 <= 0.1 || p0 - dn <= 0.1) return null;
    const buf = p.buf_atr * ctx.atr;
    return [{ kind: "oco", sl: Math.max(p.sl_atr * ctx.atr, 0.5), buy_price: up + buf, sell_price: dn - buf, tp_r: p.tp_r, valid_until: hm(p.fill_end), exit_at: hm(p.exit_time), comment: name }];
  }
  // rupturas de rango
  const s = hm(p.range_start), e = hm(p.range_end), fe = hm(p.fill_end || p.exit_time);
  if (st.done || ctx.mod < e) return null;
  st.done = true;
  if (ctx.mod >= fe || ctx.mod > e + 10 || isNaN(ctx.atr)) return null;
  if (e * 60 + ctx.day > ctx.tn) return null;
  const rg = rangeHL(ctx.day, s, e, ctx.i);
  if (!rg) return null;
  const [hi, lo] = rg;
  if (hi <= lo) return null;
  if (DEFS[name].inside && !(lo < ctx.bid && ctx.bid < hi)) return null;
  return [{ kind: "oco", sl: Math.max(p.sl_atr * ctx.atr, 0.5), buy_price: hi, sell_price: lo, tp_r: p.tp_r, valid_until: fe, exit_at: hm(p.exit_time), comment: name }];
}

// ------------------------------------------------------------------ riesgo (risk.py)
const rs: any = { init_bal: 0, risk_base: 0, srv_day: 0, day_ref: 0, daily_blocked: false, perm_blocked: false, target_hit: false, trading_days: 0 };
function rmStart(bal: number) { if (rs.init_bal <= 0) rs.init_bal = settings.funding.enabled && settings.funding.initial_balance > 0 ? settings.funding.initial_balance : bal; if (rs.risk_base <= 0) rs.risk_base = rs.init_bal; }
function rmNewDay(day: number, bal: number, eq: number) {
  if (day === rs.srv_day) return false;
  rs.srv_day = day;
  const b = settings.funding.daily_base;
  rs.day_ref = b === "balance" ? bal : b === "equity" ? eq : Math.max(bal, eq);
  rs.daily_blocked = false;
  return true;
}
function rmUpdateBase(bal: number) {
  const r = settings.risk;
  if (rs.risk_base <= 0) rs.risk_base = rs.init_bal;
  if (!r.compound) return;
  if (bal >= rs.risk_base * (1 + r.compound_up_pct / 100) || bal <= rs.risk_base * (1 - r.compound_dn_pct / 100)) rs.risk_base = bal;
}
function rmFactor(eq: number) {
  const f = settings.funding, r = settings.risk;
  if (!r.dd_throttle || rs.init_bal <= 0 || !f.enabled) return 1;
  const floor = rs.init_bal * (1 - f.max_loss_pct / 100);
  return Math.max(r.throttle_min, Math.min(1, (eq - floor) / (rs.init_bal * f.max_loss_pct / 100)));
}
function rmFloors() {
  const f = settings.funding;
  return [f.enabled ? rs.day_ref * (1 - f.daily_guard_pct / 100) : -Infinity, f.enabled ? rs.init_bal * (1 - f.max_guard_pct / 100) : -Infinity];
}
function rmCheck(eq: number) {
  const f = settings.funding;
  if (!f.enabled) return null;
  const [fd, fs] = rmFloors();
  let why = null;
  if (!rs.daily_blocked && eq <= fd) { rs.daily_blocked = true; why = "GUARDA DIARIA"; }
  if (!rs.perm_blocked && eq <= fs) { rs.perm_blocked = true; why = "GUARDA DD MÁXIMO"; }
  const tgt = targetPct();
  if (f.stop_at_target && tgt > 0 && !rs.target_hit && eq >= rs.init_bal * (1 + tgt / 100)) { rs.target_hit = true; why = "OBJETIVO ALCANZADO"; }
  return why;
}
const rmBlocked = () => rs.perm_blocked ? "bloqueado por DD máximo" : rs.target_hit ? "objetivo de fase alcanzado" : rs.daily_blocked ? "pausa diaria" : null;
const normLots = (l: number) => { l = Math.floor(l / 0.01 + 1e-9) * 0.01; return l < 0.01 - 1e-12 ? 0 : Math.round(Math.min(l, 100) * 100) / 100; };
function rmSize(slDist: number, eq: number, worst: number, bal: number) {
  if (slDist <= 0) return [0, 0, "SL no válido"];
  rmUpdateBase(bal);
  const r = settings.risk, f = settings.funding;
  const base = r.compound ? rs.risk_base : rs.init_bal;
  let risk = base * r.risk_pct / 100 * rmFactor(eq);
  let room = Infinity;
  if (f.enabled) { room = worst - Math.max(...rmFloors()); if (room <= 0) return [0, 0, "sin margen hasta las guardas"]; risk = Math.min(risk, room * 0.9); }
  const lpl = slDist * settings.contract_size + settings.cost_per_lot;
  const lots = normLots(risk / lpl);
  if (lots <= 0) {
    const rmin = lpl * 0.01;
    if (r.min_lot_tol > 1 && rmin <= risk * r.min_lot_tol && rmin <= room * 0.9) return [0.01, rmin, `lote mínimo (${(rmin / risk).toFixed(1)}x el riesgo previsto)`];
    return [0, 0, `el lote mínimo arriesgaría ${rmin.toFixed(2)} (previsto ${risk.toFixed(2)})`];
  }
  return [lots, lots * lpl, ""];
}

// ------------------------------------------------------------------ estado del simulador y del bróker
const sim: any = { i: 0, step: 0, speed: 60, paused: true, acc: 0, wall: 0, timer: 0, connected: false };
let balance = 100000;
let ids = 1000 + Math.floor(Math.random() * 1e5);
let positions: any[] = [], orders: any[] = [], deals: any[] = [];
const journal: any[] = [];
const events: any[] = [];
const notes: any[] = [];
const chat: any[] = [];
let vpend: Record<string, any> = {};
let traded = new Set<string>();
let stState: Record<string, any> = {};
let curDay: number | null = null;
let exitAt: Record<number, number> = {};
let lastMinute = -1;
let signals: any = {};
const jobs: any = {};

const path = (i: number) => (C[i] >= O[i] ? [O[i], L[i], H[i], C[i]] : [O[i], H[i], L[i], C[i]]);
function cur() { const bid = path(sim.i)[sim.step]; return { time: TS[sim.i] + sim.step * 15, bid, ask: bid + SP[sim.i] }; }
const nameOfMagic = (m: number) => m === settings.magic ? "MANUAL" : (Object.keys(DEFS).find((k) => settings.magic + DEFS[k].off === m) || null);
const magicOf = (name: string) => name === "MANUAL" ? settings.magic : settings.magic + DEFS[name].off;

function log(msg: string, level = "info") {
  const e = { t: Math.floor(Date.now() / 1000), level, msg };
  events.unshift(e); if (events.length > 300) events.pop();
  emit({ type: "event", ...e });
}
function equity() {
  const k = cur(); let e = balance;
  for (const p of positions) e += ((p.side > 0 ? k.bid : k.ask) - p.price_open) * p.side * settings.contract_size * p.volume;
  return e;
}
function account() {
  const eq = equity();
  return { login: 1, server: "Simulación", name: "Cuenta de demostración", company: "XAU Portfolio AI", currency: "USD", balance: r2(balance), equity: r2(eq), margin: 0, free_margin: r2(eq), leverage: 100, mode: "demo", hedging: true, trade_allowed: true };
}
function posView() {
  const k = cur();
  return positions.map((p) => ({ ...p, profit: r2(((p.side > 0 ? k.bid : k.ask) - p.price_open) * p.side * settings.contract_size * p.volume) }));
}
function worstEquity() {
  let w = balance;
  for (const p of positions) w += p.sl ? (p.sl - p.price_open) * p.side * settings.contract_size * p.volume : 0;
  return w;
}

function openPos(side: number, vol: number, price: number, sl: number, tp: number, magic: number, comment: string, t: number) {
  const ticket = ids++;
  const p = { ticket, symbol: "XAUUSD", side, volume: r2(vol), price_open: r2(price), sl: r2(sl || 0), tp: r2(tp || 0), profit: 0, swap: 0, magic, comment, time: t };
  positions.push(p);
  deals.push({ position: ticket, entry: 0, time: t, price, magic, volume: vol });
  onOpened(p);
  return p;
}
function closePos(p: any, price: number, t: number, reason: string, vol?: number) {
  const v = vol && vol < p.volume ? r2(vol) : p.volume;
  const pnl = (price - p.price_open) * p.side * settings.contract_size * v - settings.cost_per_lot * v;
  balance += pnl;
  deals.push({ position: p.ticket, entry: 1, time: t, price, magic: p.magic, volume: v, profit: pnl, comment: reason });
  if (v >= p.volume) { positions = positions.filter((x) => x !== p); onClosed(p, price, t, reason); }
  else { p.volume = r2(p.volume - v); addPartial(p, pnl); }
  return pnl;
}
function brokerTick() {
  const k = cur();
  for (const o of [...orders]) {
    const hit = (o.kind === "buy_stop" && k.ask >= o.price) || (o.kind === "sell_stop" && k.bid <= o.price) || (o.kind === "buy_limit" && k.ask <= o.price) || (o.kind === "sell_limit" && k.bid >= o.price);
    if (hit) { orders = orders.filter((x) => x !== o); const side = o.kind.startsWith("buy") ? 1 : -1; openPos(side, o.volume, side > 0 ? k.ask : k.bid, o.sl, o.tp, o.magic, o.comment, k.time); }
  }
  for (const p of [...positions]) {
    if (p.side > 0) { if (p.sl && k.bid <= p.sl) closePos(p, k.bid, k.time, "SL"); else if (p.tp && k.bid >= p.tp) closePos(p, k.bid, k.time, "TP"); }
    else { if (p.sl && k.ask >= p.sl) closePos(p, k.ask, k.time, "SL"); else if (p.tp && k.ask <= p.tp) closePos(p, k.ask, k.time, "TP"); }
  }
}

// ------------------------------------------------------------------ IA: tablas precalculadas
function featAt(t: number) {
  const F = D.feat; const j = lb(F.t, t + 1) - 1;
  if (j < 0) return null;
  const o: any = {}; for (const k of Object.keys(F)) o[k] = F[k][j];
  return o;
}
function gridProbs(j: number, side: number, slAtr: number, tpR: number) {
  const M = D.model, nS = M.sl.length, nT = M.tp.length, si = side > 0 ? 0 : 1;
  const pos = (g: number[], v: number) => { if (v <= g[0]) return [0, 0, 0]; if (v >= g[g.length - 1]) return [g.length - 1, g.length - 1, 0]; let k = 0; while (g[k + 1] < v) k++; return [k, k + 1, (v - g[k]) / (g[k + 1] - g[k])]; };
  const [s0, s1, ws] = pos(M.sl, slAtr), [t0, t1, wt] = pos(M.tp, tpR);
  const at = (s: number, t: number, c: number) => M.p[((((j * 2 + si) * nS + s) * nT + t) * 3) + c] / 1000;
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = at(s0, t0, c) * (1 - wt) + at(s0, t1, c) * wt, b = at(s1, t0, c) * (1 - wt) + at(s1, t1, c) * wt;
    out[c] = a * (1 - ws) + b * ws;
  }
  return out;
}
export function predictEntry(t: number, side: number, slDist: number, tpR: number) {
  const M = D?.model; if (!M) return null;
  const atr = atrFor(dayOf(t)); if (!isFinite(atr) || slDist <= 0) return null;
  const j = Math.max(0, lb(M.t, t + 1) - 1), j2 = Math.min(M.t.length - 1, j + 1);
  const w = j2 > j && M.t[j2] - M.t[j] <= 3600 ? Math.max(0, Math.min(1, (t - M.t[j]) / (M.t[j2] - M.t[j]))) : 0;
  const a = gridProbs(j, side, slDist / atr, tpR), b = gridProbs(j2, side, slDist / atr, tpR);
  const p = a.map((v, k) => v * (1 - w) + b[k] * w);
  const pT = Math.max(0, p[0]), pS = Math.max(0, p[1]), pP = Math.max(0, p[2]), pM = Math.max(0, 1 - pT - pS - pP);
  const cr = M.class_r;
  const er = pT * tpR - pS + pP * (cr["2"] ?? 0.3) + pM * (cr["3"] ?? -0.3);
  const probs = { TP: r3(pT), SL: r3(pS), "TIEMPO+": r3(pP), "TIEMPO-": r3(pM) };
  return { probs, p_ganancia: r3(pT + pP), exp_R: r3(er) };
}
const r3 = (v: number) => Math.round(v * 1000) / 1000;
function scenGet(name: string, regime: string, vol: string) {
  const base = D.scen.overall[name]; if (!base) return null;
  const cell = D.scen.table[`${name}|${regime}|${vol}`];
  if (!cell) return { ...base, n_cell: 0, shrunk: true };
  const w = cell.n / (cell.n + 30);
  const p: any = {}; for (const k of Object.keys(base.p)) p[k] = w * cell.p[k] + (1 - w) * base.p[k];
  return { n: base.n, n_cell: cell.n, expR: w * cell.expR + (1 - w) * base.expR, win: w * cell.win + (1 - w) * base.win, p, raw_expR: cell.expR };
}
function forecast(t: number, price: number, f: any) {
  if (!f || !isFinite(f.atr)) return null;
  const sig = Math.max(isFinite(f.rv240) ? f.rv240 : 0.2, 0.05) * f.atr;
  const hb = Math.floor(modOf(t) / 240);
  const pts = [{ h: 0, t, p10: price, p50: price, p90: price, p_up: 0.5 }];
  for (const Hh of [1, 2, 4, 8]) {
    const tb = D.forecast.tables[String(Hh)] || {};
    const d = tb[String(hb)] || Object.values(tb)[0];
    if (!d) continue;
    const k = sig * Math.sqrt(Hh / 4);
    pts.push({ h: Hh, t: t + Hh * 3600, p10: price + d.q[0] * k, p50: price + d.q[1] * k, p90: price + d.q[2] * k, p_up: r3(d.up) });
  }
  return { points: pts, atr: f.atr, sigma4h: sig, metrics: D.forecast.metrics };
}

// ------------------------------------------------------------------ evaluación (review.py)
function evaluate(tr: any) {
  const side = tr.side, entry = tr.entry, sl = tr.sl || 0, tp = tr.tp || 0, t0 = tr.t_open, t1 = tr.t_close || 0;
  const i0 = lb(TS, t0 - (t0 % 60));
  if (i0 >= sim.i) return { ok: false, msg: "Todavía no hay velas posteriores a la entrada para evaluarla." };
  const atr = atrFor(dayOf(t0));
  const f = featAt(t0) || {};
  const slD = sl ? Math.abs(entry - sl) : 0.5 * atr;
  const R = slD > 0 ? slD : atr * 0.5;
  const endT = t1 || t0 + 4 * 3600;
  let i1 = Math.min(lb(TS, endT + 1), sim.i); i1 = Math.max(i1, i0 + 1);
  let mfe = -Infinity, kM = i0, mae = 0, worstBefore = 0;
  const fav: number[] = [], adv: number[] = [];
  for (let k = i0; k < i1; k++) {
    const fv = side > 0 ? H[k] - entry : entry - (L[k] + SP[k]);
    const av = side > 0 ? entry - L[k] : H[k] + SP[k] - entry;
    fav.push(fv); adv.push(av);
    if (fv > mfe) { mfe = fv; kM = k; }
    if (av > mae) mae = av;
  }
  let kBest = i0, better = 0;
  for (let k = i0; k <= kM; k++) {
    worstBefore = Math.max(worstBefore, adv[k - i0]);
    const imp = side > 0 ? entry - (L[k] + SP[k]) : H[k] - entry;
    if (imp > better) { better = imp; kBest = k; }
  }
  const waitMin = Math.round((TS[kBest] - t0) / 60);
  const a = Math.max(0, i0 - 30);
  const run30 = atr > 0 ? (entry - O[a]) * side / atr : 0;
  const resultR = tr.exit ? (tr.exit - entry) * side / R : null;
  const regime = f.regime || "transicion", vol = f.vol || "normal";
  const aligned = (regime === "alcista" && side > 0) || (regime === "bajista" && side < 0) ? "a favor" : (regime === "alcista" && side < 0) || (regime === "bajista" && side > 0) ? "en contra" : "neutral";
  const tpR = tp && slD > 0 ? Math.abs(tp - entry) / slD : 0;
  const model = predictEntry(t0, side, slD, tpR);
  const alts: any[] = [];
  for (const w of [15, 30, 60]) { const j = lb(TS, t0 + w * 60); if (j < sim.i) { const pj = predictEntry(TS[j], side, slD, tpR); if (pj) alts.push({ wait_min: w, price: O[j], ...pj }); } }
  const riskPct = balance && tr.lots && sl ? tr.lots * slD * settings.contract_size / balance * 100 : null;
  let score = 60; const notesOut: string[] = []; let timing = "Entrada aceptable";
  if (!sl) { score -= 25; notesOut.push("Sin stop loss: la pérdida no estaba limitada."); }
  else { const sa = slD / atr; if (sa < 0.08) { score -= 10; notesOut.push(`SL muy ajustado (${sa.toFixed(2)} ATR): el ruido normal del oro lo toca con facilidad.`); } else if (sa > 1.2) { score -= 5; notesOut.push(`SL muy amplio (${sa.toFixed(2)} ATR).`); } }
  if (tpR && tpR < 1) { score -= 5; notesOut.push(`Relación beneficio/riesgo baja (1:${tpR.toFixed(1)}).`); }
  if (riskPct != null) { if (riskPct > 2) { score -= 15; notesOut.push(`Riesgo alto: ${riskPct.toFixed(2)} % de la cuenta en una operación.`); } else if (riskPct <= 1) score += 5; }
  if (aligned === "a favor") { score += 8; notesOut.push("A favor del régimen de tendencia."); } else if (aligned === "en contra") { score -= 10; notesOut.push("En contra del régimen de tendencia."); }
  if (run30 > 0.4) { score -= 8; notesOut.push(`Entrada tras un tirón de ${run30.toFixed(2)} ATR en 30 min: riesgo de perseguir el precio.`); }
  const mbm = worstBefore / R;
  if (mbm <= 0.3) { score += 12; timing = "Buena entrada"; notesOut.push(`El precio apenas fue en contra (${mbm.toFixed(2)} R) antes de avanzar.`); }
  else if (mbm > 0.7) { score -= 10; timing = "Debiste esperar"; notesOut.push(`Antes de avanzar, el precio fue ${mbm.toFixed(2)} R en contra; esperando unos ${waitMin} min habrías entrado ${(better / R).toFixed(2)} R mejor.`); }
  if (model) {
    if (model.exp_R > 0.05) score += 5; else if (model.exp_R < -0.15) score -= 5;
    const best = alts.reduce((x, y) => (!x || y.exp_R > x.exp_R ? y : x), null);
    if (best && best.exp_R > model.exp_R + 0.1) notesOut.push(`Según el modelo, esperar ${best.wait_min} min daba más R esperado (${best.exp_R >= 0 ? "+" : ""}${best.exp_R.toFixed(2)} frente a ${model.exp_R >= 0 ? "+" : ""}${model.exp_R.toFixed(2)}).`);
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const verdict = score >= 80 ? "Excelente" : score >= 65 ? "Buena" : score >= 45 ? "Mejorable" : "Mala";
  return { ok: true, score, verdict, timing, notes: notesOut, result_R: resultR == null ? null : r2(resultR), mfe_R: r2(Math.max(0, mfe) / R), mae_R: r2(mae / R), mae_before_mfe_R: r2(mbm), better_entry_R: r2(better / R), wait_min: waitMin, best_price: r2(side > 0 ? entry - better : entry + better), regime, vol, aligned, session: session(modOf(t0)), atr: r2(atr), sl_atr: r2(slD / atr), tp_r: r2(tpR), risk_pct: riskPct == null ? null : r2(riskPct), chase_atr: r2(run30), model, alternatives: alts };
}
const session = (m: number) => m < 60 ? "Cierre diario" : m < 540 ? "Asia" : m < 930 ? "Londres" : m < 1140 ? "Londres + Nueva York" : "Nueva York tarde";

// ------------------------------------------------------------------ diario
function onOpened(p: any) {
  if (journal.some((j) => j.ticket === p.ticket)) return;
  const nm = nameOfMagic(p.magic);
  const slD = p.sl ? Math.abs(p.price_open - p.sl) : 0;
  const pred = slD ? predictEntry(p.time, p.side, slD, p.tp ? Math.abs(p.tp - p.price_open) / slD : 0) : null;
  journal.unshift({ id: p.ticket, account: "Simulación:1", ticket: p.ticket, source: nm === "MANUAL" || !nm ? "manual" : "estrategia", strategy: nm || "MT5", side: p.side, lots: p.volume, entry: p.price_open, sl: p.sl, tp: p.tp, sl0: p.sl, tp0: p.tp, t_open: p.time, exit: null, t_close: null, pnl: null, R: null, reason: null, status: "abierta", prediction: { model: pred, scenario: nm && nm !== "MANUAL" ? scenGet(nm, signals.regime || "", signals.vol || "") : null }, evaluation: null, note: "" });
}
function addPartial(p: any, pnl: number) { const j = journal.find((x) => x.ticket === p.ticket); if (j) { j.pnl = (j.pnl || 0) + pnl; j.lots = p.volume; } }
function onClosed(p: any, price: number, t: number, reason: string) {
  const j = journal.find((x) => x.ticket === p.ticket);
  delete exitAt[p.ticket];
  if (!j) return;
  const pnl = deals.filter((d) => d.position === p.ticket && d.entry === 1).reduce((a, d) => a + d.profit, 0);
  const slD = j.sl0 ? Math.abs(j.entry - j.sl0) : 0;
  Object.assign(j, { exit: r2(price), t_close: t, pnl: r2(pnl), R: slD ? (price - j.entry) * j.side / slD : null, reason, status: "cerrada", sl: p.sl, tp: p.tp });
  setTimeout(() => {
    j.evaluation = evaluate({ side: j.side, entry: j.entry, sl: j.sl0, tp: j.tp0, t_open: j.t_open, t_close: t, exit: price, lots: j.lots });
    log(`Operación #${p.ticket} cerrada: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} (${j.R == null ? "" : `${j.R >= 0 ? "+" : ""}${j.R.toFixed(2)} R`}) · evaluación ${j.evaluation.score ?? "-"}/100 ${j.evaluation.timing ?? ""}`);
    emit({ type: "trade_closed", ticket: p.ticket });
  }, 50);
}

// ------------------------------------------------------------------ motor (live.py)
function tradedToday(name: string) { return traded.has(name); }
function strategyStatus() {
  const k = cur(); const mod = modOf(k.time);
  const openNames = new Set(positions.map((p) => nameOfMagic(p.magic)));
  return Object.keys(DEFS).map((name) => {
    const cfg = settings.strategies[name] || { enabled: true };
    const p = paramsOf(name);
    const start = p.entry_time || p.range_end || p.ref_time;
    const od = vpend[name];
    const state = cfg.enabled === false ? "desactivada" : openNames.has(name) ? "en operación" : od ? "orden pendiente" : traded.has(name) ? "hecha hoy" : mod < hm(start) ? "pendiente" : "sin señal hoy";
    const levels = od ? { buy: od.buy_price || null, sell: od.sell_price || null, sl: od.sl, tp_r: od.tp_r } : null;
    return { name, description: DEFS[name].desc, state, start, levels, params: p, enabled: cfg.enabled !== false, builtin: true };
  });
}
function riskView() {
  const f = settings.funding; const eq = equity(); const [fd, fs] = rmFloors(); const tgt = targetPct();
  return { state: { ...rs }, blocked: rmBlocked(), funding: f.enabled, phase: f.phase, daily_floor: isFinite(fd) ? r2(fd) : null, max_floor: isFinite(fs) ? r2(fs) : null,
    daily_limit: r2(rs.day_ref * (1 - f.daily_loss_pct / 100)), max_limit: r2(rs.init_bal * (1 - f.max_loss_pct / 100)), target: tgt ? r2(rs.init_bal * (1 + tgt / 100)) : null,
    progress_pct: rs.init_bal ? r2((eq / rs.init_bal - 1) * 100) : 0, daily_dd_pct: rs.day_ref ? r2(Math.max(0, (rs.day_ref - eq) / rs.day_ref * 100)) : 0,
    max_dd_pct: rs.init_bal ? r2(Math.max(0, (rs.init_bal - eq) / rs.init_bal * 100)) : 0, risk_base: r2(rs.risk_base), factor: r2(rmFactor(eq)), autotrade: settings.autotrade };
}

function place(source: string, side: number, slDist: number, tpR = 0, comment = "", lots: number | null = null, ex: number | null = null, slPrice: number | null = null, tpPrice: number | null = null, kind = "market", price: number | null = null) {
  const k = cur(); const r = settings.risk; const f = settings.funding;
  const appPos = positions.filter((p) => { const n = nameOfMagic(p.magic); return n && n !== "MANUAL"; });
  if (source !== "MANUAL" && r.max_open_trades > 0 && appPos.length >= r.max_open_trades) return { ok: false, msg: `omitido (límite de ${r.max_open_trades} operaciones simultáneas)` };
  if (f.enabled && f.no_hedge && positions.some((p) => p.side === -side)) return { ok: false, msg: "omitido: hay una posición contraria abierta (FundingPips prohíbe cobertura)" };
  if (rmBlocked()) return { ok: false, msg: `bloqueado: ${rmBlocked()}` };
  if (kind === "market" && k.ask - k.bid > r.max_spread) return { ok: false, msg: `spread alto (${(k.ask - k.bid).toFixed(2)})` };
  const entry = kind !== "market" && price ? price : side > 0 ? k.ask : k.bid;
  if (slPrice) slDist = Math.abs(entry - slPrice);
  if (!slDist || slDist <= 0) return { ok: false, msg: "falta el stop loss" };
  const sl = slPrice || entry - side * slDist;
  const tp = tpPrice != null ? tpPrice : tpR > 0 ? entry + side * tpR * slDist : 0;
  if (source !== "MANUAL" && r.ml_filter) {
    const sc = scenGet(source, signals.regime || "", signals.vol || "");
    if (sc && sc.expR < r.ml_min_exp_r) return { ok: false, msg: `filtro IA: historial en este escenario ${sc.expR >= 0 ? "+" : ""}${sc.expR.toFixed(2)} R` };
  }
  let riskMoney = null;
  if (lots == null) {
    const [l, rm, why] = rmSize(slDist, equity(), worstEquity(), balance);
    if (l <= 0) return { ok: false, msg: `omitido: ${why}` };
    if (why) log(`${source}: ${why}`);
    lots = l; riskMoney = rm;
  }
  const magic = magicOf(source);
  let ticket;
  if (kind === "market") ticket = openPos(side, lots, entry, sl, tp, magic, comment || source, k.time).ticket;
  else { ticket = ids++; orders.push({ ticket, symbol: "XAUUSD", kind: (side > 0 ? "buy_" : "sell_") + kind, volume: lots, price: r2(entry), sl: r2(sl), tp: r2(tp), magic, comment: comment || source, time: k.time }); }
  if (ex != null) exitAt[ticket] = ex;
  log(`${source}: ${side > 0 ? "COMPRA" : "VENTA"} ${lots.toFixed(2)} lotes @ ${entry.toFixed(2)} SL ${sl.toFixed(2)} TP ${tp.toFixed(2)}${riskMoney ? ` · riesgo ${riskMoney.toFixed(2)}` : ""}`);
  pushAccount();
  return { ok: true, ticket, lots, price: entry, sl, tp };
}
function openStrategy(name: string, od: any, side: number) {
  traded.add(name);
  if (!settings.autotrade) { log(`${name}: señal de ${side > 0 ? "COMPRA" : "VENTA"} (operación automática desactivada, no se ejecuta)`); return; }
  const tpR = od.tp_r > 0 || settings.risk.use_time_exit ? od.tp_r : settings.risk.no_time_exit_tp_r;
  const res = place(name, side, od.sl, tpR, od.comment || name, null, settings.risk.use_time_exit ? od.exit_at : null);
  if (!res.ok) log(`${name}: ${res.msg}`, "warn");
}
function onBar(minute: number) {
  const k = cur(); const tn = minute; const day = dayOf(tn); const weekday = dowOf(day) < 5; const atr = atrFor(day);
  const ctx = { i: sim.i, day, atr, bid: k.bid, ask: k.ask, t: minute, tn, mod: modOf(tn) };
  if (day !== curDay) {
    curDay = day; traded = new Set(); vpend = {}; stState = {};
    for (const n of ORDER) stState[n] = { done: false };
  }
  for (const n of Object.keys(vpend)) { const od = vpend[n]; if (od.valid_until != null && ctx.mod >= od.valid_until) delete vpend[n]; }
  if (!weekday || isNaN(atr) || rmBlocked()) return;
  for (const n of ORDER) {
    if (settings.strategies[n]?.enabled === false) continue;
    if (vpend[n] || tradedToday(n)) continue;
    const ods = stratBar(n, stState[n], ctx) || [];
    for (const od of ods) {
      if (od.kind === "market") openStrategy(n, od, od.side);
      else { vpend[n] = od; log(`${n}: orden virtual compra ≥ ${od.buy_price.toFixed(2)} / venta ≤ ${od.sell_price.toFixed(2)} (hasta ${od.valid_until != null ? fhm(od.valid_until) : "fin del día"})`); }
    }
  }
}
function manage() {
  const k = cur();
  const eq = equity();
  rmNewDay(dayOf(k.time), balance, eq);
  const why = rmCheck(eq);
  if (why) log(`${why}: equity ${eq.toFixed(2)}. Se cierran todas las posiciones de XAUUSD para proteger la cuenta.`, "warn");
  if (rmBlocked()) { for (const p of [...positions]) closePos(p, p.side > 0 ? k.bid : k.ask, k.time, `Cierre (${rmBlocked()})`); vpend = {}; }
  const mod = modOf(k.time), day = dayOf(k.time);
  if (settings.risk.use_time_exit) {
    for (const p of [...positions]) {
      const nm = nameOfMagic(p.magic); if (!nm || nm === "MANUAL") continue;
      let ex = exitAt[p.ticket]; if (ex == null) { ex = hm(paramsOf(nm).exit_time); exitAt[p.ticket] = ex; }
      if (mod >= ex || dayOf(p.time) < day) { closePos(p, p.side > 0 ? k.bid : k.ask, k.time, "TIEMPO"); log(`${nm}: cierre por tiempo (#${p.ticket})`); }
    }
  }
  if (rmBlocked()) return;
  for (const n of Object.keys(vpend)) {
    const od = vpend[n]; let side = 0;
    if (k.ask >= od.buy_price) side = 1; else if (k.bid <= od.sell_price) side = -1;
    if (side) { delete vpend[n]; openStrategy(n, od, side); }
  }
}
function step() {
  brokerTick();
  const k = cur();
  const minute = k.time - (k.time % 60);
  if (minute !== lastMinute) { lastMinute = minute; onBar(minute); }
  manage();
}
let lastAcc = 0, lastSig = 0;
function loop() {
  const now = performance.now();
  if (!sim.paused && sim.connected) {
    sim.acc += ((now - sim.wall) / 1000) * sim.speed / 15;
    let n = 0;
    while (sim.acc >= 1 && sim.i < N - 1 && n < 400) {
      sim.acc -= 1; n++;
      sim.step++;
      if (sim.step > 3) { sim.step = 0; sim.i++; }
      step();
    }
    if (sim.i >= N - 1 && !sim.ended) { sim.ended = true; sim.paused = true; log("Fin del histórico de la demo (15 oct 2026). Vuelve a conectar el simulador para empezar otro día.", "warn"); }
  }
  sim.wall = now;
  if (sim.connected) {
    const k = cur();
    emit({ type: "tick", t: k.time, bid: k.bid, ask: k.ask });
    if (now - lastAcc > 900) { lastAcc = now; pushAccount(); }
    if (now - lastSig > 8000) { lastSig = now; updateSignals(); }
  }
}
function pushAccount() { emit({ type: "account", account: account(), positions: posView(), orders: orders.map((o) => ({ ...o })), risk: riskView() }); }

// ------------------------------------------------------------------ señales (signals.py)
function updateSignals() {
  const k = cur(); const f = featAt(k.time); if (!f) return;
  const t = k.time, mod = modOf(t), day = dayOf(t), bid = k.bid, atr = f.atr;
  const lv: any[] = [];
  const rg = mod > 66 ? rangeHL(day, 65, Math.min(mod, 540), sim.i) : null;
  if (rg) { lv.push({ name: "Máximo Asia", price: rg[0], kind: "asia" }, { name: "Mínimo Asia", price: rg[1], kind: "asia" }); }
  const prev = DAYS.filter((d) => d.day < day && dowOf(d.day) < 5).pop();
  if (prev) lv.push({ name: "Máximo de ayer", price: prev.high, kind: "pd" }, { name: "Mínimo de ayer", price: prev.low, kind: "pd" });
  const today = DAYS.find((d) => d.day === day);
  if (today) lv.push({ name: "Apertura del día", price: today.open, kind: "open" });
  const o105 = openAt(day, 65, sim.i); if (o105 != null) lv.push({ name: "Apertura 01:05", price: o105, kind: "open" });
  for (const m of [Math.floor(bid / 50) * 50, Math.ceil(bid / 50) * 50]) lv.push({ name: `Nivel redondo ${m.toFixed(0)}`, price: m, kind: "r50" });
  const fc = forecast(t, bid, f);
  const regime = f.regime, vol = f.vol, ts_ = f.trend, retDay = f.ret_day ?? 0;
  const strat = strategyStatus().map((s) => ({ ...s, scenario: scenGet(s.name, regime, vol) }));
  const regTxt = { alcista: "Tendencia alcista", bajista: "Tendencia bajista", rango: "Rango lateral", transicion: "Transición (sin tendencia clara)" }[regime];
  const volTxt = { baja: "volatilidad baja", normal: "volatilidad normal", alta: "volatilidad alta", extrema: "volatilidad extrema" }[vol];
  const bias = retDay > 0.15 && ts_ > 0 ? "comprador" : retDay < -0.15 && ts_ < 0 ? "vendedor" : "neutral";
  const tips: string[] = [];
  if (regime === "alcista" || regime === "bajista") tips.push(`Prioriza entradas a favor de la tendencia (${regime === "alcista" ? "compras" : "ventas"}); las rupturas del portafolio suelen rendir mejor así.`);
  else if (regime === "rango") tips.push("Mercado lateral: las rupturas fallan más a menudo; espera confirmación o reduce tamaño.");
  if (vol === "alta" || vol === "extrema") tips.push("Volatilidad alta: el SL en ATR ya se amplía; mantén el riesgo en % y evita entrar en plena vela de noticia.");
  else if (vol === "baja") tips.push("Volatilidad baja: los objetivos tardan más; el cierre por tiempo cobra importancia.");
  if (rg && mod >= 540) { const [hi, lo] = rg; tips.push(bid > hi ? "El precio está por encima del rango de Asia (ruptura alcista en curso)." : bid < lo ? "El precio está por debajo del rango de Asia (ruptura bajista en curso)." : "El precio sigue dentro del rango de Asia: ALB puede activarse en cualquiera de los dos lados."); }
  const best = strat.filter((s) => s.scenario && s.state === "pendiente").sort((a, b) => b.scenario.expR - a.scenario.expR)[0];
  if (best) tips.push(`En escenarios como este, la estrategia pendiente con mejor historial es ${best.name} (${best.scenario.expR >= 0 ? "+" : ""}${best.scenario.expR.toFixed(2)} R por operación, ${best.scenario.n_cell} casos).`);
  const p4 = fc?.points.find((p: any) => p.h === 4);
  if (p4) tips.push(`Rango probable a 4 h (80 %): ${p4.p10.toFixed(2)} – ${p4.p90.toFixed(2)}. La dirección no es predecible con fiabilidad (acierto histórico ~50 %).`);
  signals = { ok: true, time: t, hour: fhm(mod), session: session(mod), regime, regime_text: regTxt, vol, vol_text: volTxt, trend_score: r2(ts_), atr: r2(atr), atr_rank: f.atr_rank != null ? r2(f.atr_rank) : null, rv60: f.rv60 != null ? Math.round(f.rv60 * 1000) / 1000 : null, bias, ret_day_atr: r2(retDay), day_range_atr: f.day_rng != null ? r2(f.day_rng) : null, levels: lv, forecast: fc, strategies: strat, summary: `${regTxt} con ${volTxt} en sesión ${session(mod)}. Sesgo del día: ${bias}.`, tips };
  emit({ type: "signals", signals });
}

// ------------------------------------------------------------------ conexión del simulador
function connect(body: any) {
  const startT = body?.start ? Date.parse(body.start.replace(" ", "T") + ":00Z") / 1000 : Date.parse("2026-10-13T08:40:00Z") / 1000;
  sim.i = Math.max(1, lb(TS, startT)); sim.step = 0; sim.speed = Number(body?.speed ?? 60); sim.acc = 0; sim.wall = performance.now(); sim.ended = false;
  balance = Number(body?.balance ?? 100000);
  settings.funding.initial_balance = balance;
  positions = []; orders = []; deals = []; journal.length = 0; vpend = {}; traded = new Set(); exitAt = {}; curDay = null;
  Object.assign(rs, { init_bal: 0, risk_base: 0, srv_day: 0, day_ref: 0, daily_blocked: false, perm_blocked: false, target_hit: false });
  rmStart(balance);
  // reconstruir el estado del día (qué estrategias ya habrían actuado antes de la hora de inicio)
  const k0 = cur(); lastMinute = k0.time - (k0.time % 60);
  const dayStart = dayOf(k0.time);
  curDay = dayStart; stState = {}; for (const n of ORDER) stState[n] = { done: false };
  const saveI = sim.i, saveAuto = settings.autotrade;
  settings.autotrade = false;
  const quiet = (fn: () => void) => { muted = true; try { fn(); } finally { muted = false; } };
  quiet(() => {
    for (let j = lb(TS, dayStart); j < saveI; j++) { sim.i = j; sim.step = 0; onBar(TS[j]); const pend = { ...vpend }; for (const n of Object.keys(pend)) { if (H[j] + SP[j] >= pend[n].buy_price || L[j] <= pend[n].sell_price) { traded.add(n); delete vpend[n]; } } }
  });
  events.length = 0;
  sim.i = saveI; sim.step = 0; settings.autotrade = saveAuto;
  rmNewDay(dayOf(cur().time), balance, balance);
  sim.connected = true; sim.paused = false;
  log(`Simulador · cuenta de demostración. Histórico: ${N.toLocaleString("es-ES")} velas M1 reales de XAUUSD (14 sep – 15 oct 2026).`);
  updateSignals(); pushAccount();
  emit({ type: "hello", state: state() });
  return account();
}
export function stopDemo() {
  if (sim.timer) { clearInterval(sim.timer); sim.timer = 0; }
  sim.connected = false; sim.paused = true;
}
export function startDemo() {
  if (!D) return;
  if (!sim.timer) sim.timer = window.setInterval(loop, 250);
  connect({ start: "2026-10-13 08:40", speed: 60, balance: 100000 });
}

function state() {
  return { status: sim.connected ? "conectado" : "desconectado", broker: "sim", ea: { online: sim.connected, sim: true }, account: sim.connected ? account() : {}, positions: posView(), orders, risk: sim.connected ? riskView() : {}, signals, strategies: strategyStatus(), settings,
    models: { entry: true, forecast: true, entry_meta: { t: Date.parse("2026-10-24T14:00:00Z") / 1000, n: D.model.n, metrics: D.model.metrics }, forecast_meta: { t: Date.parse("2026-10-24T14:00:00Z") / 1000, metrics: D.forecast.metrics } },
    training: null, mt5_available: false, secrets: { anthropic: true, backend: "demo" }, tick: sim.connected ? cur() : null, history: sim.i,
    sim: sim.connected ? { speed: sim.speed, paused: sim.paused } : null, local_history: [{ file: "demo", bars: N, start: "2026-09-14 01:00", end: "2026-10-15 19:37" }], demo: true };
}

// ------------------------------------------------------------------ velas para el gráfico
const TFM: any = { M1: 1, M5: 5, M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440 };
function bars(tf: string, limit: number) {
  const m = TFM[tf] || 5; const out: any[] = [];
  const end = sim.i; // velas cerradas
  for (let k = 0; k < end; k++) {
    const key = m === 1440 ? dayOf(TS[k]) : TS[k] - (TS[k] % (m * 60));
    const last = out[out.length - 1];
    if (!last || last.time !== key) out.push({ time: key, open: O[k], high: H[k], low: L[k], close: C[k] });
    else { last.high = Math.max(last.high, H[k]); last.low = Math.min(last.low, L[k]); last.close = C[k]; }
  }
  return out.slice(-limit);
}

// ------------------------------------------------------------------ chat con Claude (función de la nube con la API key del usuario)
const RULES = `Eres el copiloto de trading de la app XAU Portfolio AI (oro, XAUUSD, MetaTrader 5), en su MODO DEMOSTRACIÓN: el mercado es una repetición de velas reales de octubre de 2026 en una cuenta simulada de 100.000 USD.
Hablas en español, claro y directo. Ayudas a entender el mercado, evalúas las operaciones manuales del usuario y su estrategia manual, y explicas el portafolio automático (5 estrategias: LM, AORB, TOK, R50, ALB).
Reglas:
- Usa las herramientas para mirar datos reales de la app antes de opinar sobre el mercado o sobre una operación concreta.
- Sé honesto: el modelo de dirección acierta ~50 % (no hay ventaja direccional demostrada); el cono de predicción es un rango de volatilidad calibrado, no una promesa. No inventes probabilidades ni resultados.
- Al evaluar operaciones sé concreto: entrada, SL, gestión, momento, tamaño, alineación con el régimen; di qué harías distinto.
- Si el usuario describe reglas de su estrategia manual, guárdalas con save_strategy_note.
- No eres asesor financiero y no puedes ejecutar órdenes. Respuestas breves salvo que pidan detalle.`;
const TOOLS = () => [
  { name: "get_market_state", description: "Estado actual del mercado: régimen, volatilidad, sesión, niveles clave, cono de predicción, estrategias del portafolio y consejos.", execute: () => { updateSignals(); const s = { ...signals }; if (s.forecast) s.forecast = { points: s.forecast.points }; return s; } },
  { name: "get_account", description: "Cuenta, posiciones abiertas, órdenes y estado de las reglas de fondeo (DD diario/máximo, objetivo).", execute: () => ({ account: account(), positions: posView(), orders, risk: riskView(), hora_servidor: new Date(cur().time * 1000).toISOString().slice(0, 16) }) },
  { name: "get_trades", description: "Operaciones del diario con su evaluación automática. Devuelve las más recientes primero.", inputSchema: { type: "object", properties: { n: { type: "integer" }, source: { type: "string", enum: ["manual", "estrategia", "todas"] } } },
    execute: (i: any) => journal.filter((t) => !i.source || i.source === "todas" || t.source === i.source).slice(0, Math.min(Number(i.n) || 15, 50)).map((t) => ({ ticket: t.ticket, source: t.source, strategy: t.strategy, side: t.side, lots: t.lots, entry: t.entry, sl: t.sl0, tp: t.tp0, apertura: new Date(t.t_open * 1000).toISOString().slice(0, 16), exit: t.exit, pnl: t.pnl, R: t.R, reason: t.reason, status: t.status, evaluacion: t.evaluation?.ok ? { score: t.evaluation.score, verdict: t.evaluation.verdict, timing: t.evaluation.timing, notes: t.evaluation.notes, regime: t.evaluation.regime, aligned: t.evaluation.aligned } : null })) },
  { name: "evaluate_trade", description: "Evaluación detallada de una operación del diario por su ticket.", inputSchema: { type: "object", properties: { ticket: { type: "integer" } }, required: ["ticket"] },
    execute: (i: any) => { const t = journal.find((x) => x.ticket === Number(i.ticket)); if (!t) throw new Error("no encontrada"); return evaluate({ side: t.side, entry: t.entry, sl: t.sl0, tp: t.tp0, t_open: t.t_open, t_close: t.t_close, exit: t.exit, lots: t.lots }); } },
  { name: "get_strategy_notes", description: "Notas guardadas sobre la estrategia manual del usuario.", execute: () => notes.map((n) => n.text) },
  { name: "save_strategy_note", description: "Guarda una regla o nota de la estrategia manual del usuario (cuando la explique).", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    execute: (i: any) => { notes.push({ id: Date.now(), t: Math.floor(Date.now() / 1000), text: String(i.text) }); return { ok: true }; } },
  { name: "get_portfolio_stats", description: "Resultados históricos (2024-2026) del portafolio por estrategia y por escenario (régimen|volatilidad).", execute: () => ({ por_estrategia: D.scen.overall, por_escenario: Object.fromEntries(Object.entries(D.scen.table).filter(([, v]: any) => v.n >= 15)) }) },
];
async function runChat(text: string, id: number) {
  chat.push({ id: Date.now(), role: "user", content: text });
  emit({ type: "chat_start", id });
  const notesTxt = notes.length ? `\n\nNotas de la estrategia manual del usuario:\n- ${notes.map((n) => n.text).join("\n- ")}` : "";
  updateSignals();
  const ctx = JSON.stringify({ mercado: { ...signals, forecast: signals.forecast?.points }, cuenta: account(), posiciones: posView(), riesgo: riskView(), diario: TOOLS()[2].execute({ n: 15 }) }).slice(0, 30000);
  const system = RULES + "\n- Si el usuario explica una regla de su estrategia manual, añade al final una línea <nota>regla resumida</nota> para guardarla." + notesTxt + `\n\nDatos actuales de la app (JSON):\n${ctx}`;
  const hist = chat.slice(-20).map((m) => ({ role: m.role, content: m.content }));
  try {
    const full = await streamChat(system, hist, (d) => emit({ type: "chat_delta", id, text: d }), settings.chat_model);
    const { notes: nn } = extractNotes(full);
    for (const t of nn) notes.push({ id: Date.now() + Math.random(), t: Math.floor(Date.now() / 1000), text: t });
    chat.push({ id: Date.now(), role: "assistant", content: full });
    emit({ type: "chat_end", id, text: full });
  } catch (e: any) {
    emit({ type: "chat_error", id, error: e?.message || "No se pudo obtener respuesta." });
  }
}

// ------------------------------------------------------------------ API simulada (mismas rutas que server.py)
const err = (m: string) => { const e = new Error(m); throw e; };
const DESKTOP = "No disponible en el simulador: abre una cuenta conectada a tu MT5.";
export async function demoApi(path: string, method: string, body: any): Promise<any> {
  const [p, q] = path.split("?");
  const qs = new URLSearchParams(q || "");
  const k = sim.connected ? cur() : null;
  switch (`${method} ${p}`) {
    case "GET /api/state": return state();
    case "GET /api/events": return { events };
    case "PUT /api/settings": {
      for (const key of Object.keys(body)) { if (body[key] === undefined) continue; if (key === "risk" || key === "funding") Object.assign(settings[key], body[key]); else settings[key] = body[key]; }
      emit({ type: "settings", settings }); pushAccount(); return { ok: true, settings };
    }
    case "POST /api/autotrade": settings.autotrade = !!body.on; log(`Operación automática ${settings.autotrade ? "ACTIVADA" : "desactivada"}`, settings.autotrade ? "warn" : "info"); emit({ type: "settings", settings }); return { ok: true };
    case "POST /api/secret": return { ok: true, has: true, backend: "demo" };
    case "POST /api/risk/reset": Object.assign(rs, { init_bal: 0, risk_base: 0, srv_day: 0, daily_blocked: false, perm_blocked: false, target_hit: false }); rmStart(balance); rmNewDay(dayOf(cur().time), balance, equity()); log("Bloqueos y balance base reiniciados (nueva cuenta o nueva fase)."); return { ok: true, risk: riskView() };
    case "GET /api/accounts": return { accounts: [], mt5_available: false, local_history: state().local_history };
    case "POST /api/connect": if (body.mode !== "sim") err("En la demo solo funciona el simulador. " + DESKTOP); return { ok: true, account: connect(body) };
    case "POST /api/disconnect": sim.connected = false; sim.paused = true; emit({ type: "hello", state: state() }); return { ok: true };
    case "POST /api/sim": if ("speed" in body) sim.speed = Number(body.speed); if ("paused" in body) sim.paused = !!body.paused; emit({ type: "state", state: { sim: { speed: sim.speed, paused: sim.paused } } }); return { ok: true };
    case "GET /api/bars": if (!sim.connected) err("Conecta primero"); return { tf: qs.get("tf"), bars: bars(qs.get("tf") || "M5", Number(qs.get("limit") || 1500)) };
    case "GET /api/overlays": {
      const day = dayOf(k.time); const zones: any[] = [];
      for (const [name, a, b] of [["Asia 01:05-09:00", 65, 540], ["Tokio 03:00-03:30", 180, 210], ["Rango AORB 03:30-04:30", 210, 270]] as any) {
        const rg = rangeHL(day, a, b, sim.i); if (rg) zones.push({ name, t0: day + a * 60, t1: day + b * 60, hi: rg[0], lo: rg[1] });
      }
      return { zones, strategies: strategyStatus(), levels: signals.levels || [] };
    }
    case "POST /api/order": {
      const side = body.side === 1 || body.side === "buy" ? 1 : -1;
      if (!body.sl) err("Pon un stop loss");
      const old = settings.risk.risk_pct;
      if (!body.lots && body.risk_pct) settings.risk.risk_pct = Number(body.risk_pct);
      try { const r = place("MANUAL", side, 0, 0, body.comment || "manual", body.lots ? Number(body.lots) : null, null, Number(body.sl), Number(body.tp || 0), body.kind || "market", body.price ? Number(body.price) : null); if (!r.ok) err(r.msg); return r; }
      finally { settings.risk.risk_pct = old; }
    }
    case "POST /api/position/modify": { const ps = positions.find((x) => x.ticket === Number(body.ticket)); if (!ps) err("posición no encontrada"); ps.sl = r2(Number(body.sl || 0)); ps.tp = r2(Number(body.tp || 0)); const j = journal.find((x) => x.ticket === ps.ticket); if (j) { j.sl = ps.sl; j.tp = ps.tp; } log(`#${ps.ticket}: SL ${ps.sl.toFixed(2)} TP ${ps.tp.toFixed(2)}`); pushAccount(); return { ok: true }; }
    case "POST /api/position/close": { const ps = positions.find((x) => x.ticket === Number(body.ticket)); if (!ps) err("posición no encontrada"); const px = ps.side > 0 ? k.bid : k.ask; closePos(ps, px, k.time, "cierre app", body.volume ? Number(body.volume) : undefined); log(`#${ps.ticket} cerrada manualmente @ ${px.toFixed(2)}`); pushAccount(); return { ok: true }; }
    case "POST /api/position/breakeven": { const ps = positions.find((x) => x.ticket === Number(body.ticket)); if (!ps) err("posición no encontrada"); ps.sl = ps.price_open; pushAccount(); return { ok: true }; }
    case "POST /api/order/modify": { const o = orders.find((x) => x.ticket === Number(body.ticket)); if (!o) err("orden no encontrada"); o.price = r2(Number(body.price || o.price)); o.sl = r2(Number(body.sl || 0)); o.tp = r2(Number(body.tp || 0)); pushAccount(); return { ok: true }; }
    case "POST /api/order/cancel": orders = orders.filter((x) => x.ticket !== Number(body.ticket)); pushAccount(); return { ok: true };
    case "POST /api/close_all": for (const ps of [...positions]) closePos(ps, ps.side > 0 ? k.bid : k.ask, k.time, "cierre app"); log("Cerradas todas las posiciones del símbolo (botón de pánico)", "warn"); pushAccount(); return { ok: true };
    case "POST /api/predict": {
      const side = body.side === 1 || body.side === "buy" ? 1 : -1; const entry = Number(body.entry), sl = Number(body.sl || 0), tp = Number(body.tp || 0);
      if (!sl) return { ok: false };
      const slD = Math.abs(entry - sl); const tpR = tp && slD ? Math.abs(tp - entry) / slD : 0;
      const [lots, rm, why] = rmSize(slD, equity(), worstEquity(), balance);
      return { ok: true, pred: predictEntry(k.time, side, slD, tpR), tp_r: r2(tpR), sl_dist: r2(slD), lots, risk_money: r2(rm), risk_note: why, reward_money: tp ? r2(lots * Math.abs(tp - entry) * 100) : null };
    }
    case "GET /api/signals": updateSignals(); return signals;
    case "POST /api/train": err("En la demo los modelos vienen ya entrenados (XAUUSD 2024–2026). El reentrenamiento diario funciona en la app de escritorio.");
    case "GET /api/models": return { ready: state().models, history: [], training: null };
    case "GET /api/trades": { const src = qs.get("source"); return { trades: journal.filter((t) => !src || t.source === src).map((t) => ({ ...t, sl: t.sl0 ?? t.sl, tp: t.tp0 ?? t.tp })) }; }
    case "POST /api/trades/evaluate": {
      if (body.ticket) { const t = journal.find((x) => x.ticket === Number(body.ticket)); if (!t) err("operación no encontrada"); const ev = evaluate({ side: t.side, entry: t.entry, sl: t.sl0, tp: t.tp0, t_open: t.t_open, t_close: t.t_close, exit: t.exit, lots: t.lots }); if (ev.ok) t.evaluation = ev; return ev; }
      const toT = (s: any) => typeof s === "string" ? Date.parse(s.trim().replace(" ", "T") + ":00Z") / 1000 : Number(s);
      return evaluate({ side: body.side === 1 || body.side === "buy" ? 1 : -1, entry: Number(body.entry), sl: Number(body.sl || 0), tp: Number(body.tp || 0), t_open: toT(body.t_open), t_close: body.t_close ? toT(body.t_close) : 0, exit: body.exit ? Number(body.exit) : null, lots: body.lots });
    }
    case "POST /api/trades/note": { const t = journal.find((x) => x.id === Number(body.id)); if (t) t.note = body.note || ""; return { ok: true }; }
    case "POST /api/backtest": {
      jobs.backtest = { status: "en curso" }; emit({ type: "job", name: "backtest", status: "en curso" });
      setTimeout(() => { jobs.backtest = { status: "listo", result: { summary: D.backtest.summary, equity: D.backtest.equity, trades: [], skipped: [], note: "Resultado precalculado del portafolio 2024-2026 con los ajustes por defecto." } }; emit({ type: "job", name: "backtest", ...jobs.backtest }); }, 900);
      return { ok: true };
    }
    case "GET /api/mq5": return { items: [] };
    case "POST /api/mq5/translate": case "POST /api/mq5/test": case "POST /api/mq5/check": err("Importar estrategias MQ5: " + DESKTOP);
    case "POST /api/import_csv": err(DESKTOP);
    case "GET /api/chat": return { messages: chat.map((m) => ({ id: m.id, role: m.role, content: m.content })) };
    case "DELETE /api/chat": chat.length = 0; return { ok: true };
    case "POST /api/chat": { const text = String(body.text || "").trim(); if (!text) err("mensaje vacío"); const id = Date.now() * 10 + Math.floor(Math.random() * 10); runChat(text, id); return { ok: true, id }; }
    case "GET /api/notes": return { notes };
    case "POST /api/notes": notes.push({ id: Date.now(), t: Math.floor(Date.now() / 1000), text: body.text }); return { ok: true };
  }
  if (method === "DELETE" && p.startsWith("/api/notes/")) { const id = Number(p.split("/").pop()); const ix = notes.findIndex((n) => n.id === id); if (ix >= 0) notes.splice(ix, 1); return { ok: true }; }
  if (p.startsWith("/api/job/")) return jobs[p.split("/").pop()] || { status: "sin datos" };
  if (p.startsWith("/api/mq5")) err("Importar estrategias MQ5: " + DESKTOP);
  err(`Ruta no disponible en la demo: ${method} ${p}`);
}
export const IS_DEMO = !!D;
