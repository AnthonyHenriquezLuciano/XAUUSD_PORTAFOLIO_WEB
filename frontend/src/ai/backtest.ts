// Backtest vela a vela (M1) del portafolio en el navegador: port de backend/xauai/backtest.py y strategies/builtin.py.
// Supuestos: velas Bid (Ask = Bid + spread); mercado en la apertura; stops dentro de la vela con max(nivel, apertura);
// OCO con ambos lados en la misma vela = se descarta; SL y TP en la misma vela = SL; costes por lote ida y vuelta.
import { emit } from "../api";
import { BarStore, DAY, DailyBars, hm, lowerBound, RawBars } from "./bars";
import { supabase } from "../lib/supabase";

export type Order = { kind: "market" | "stop" | "limit" | "oco"; sl: number; side?: number; price?: number; buy_price?: number; sell_price?: number; tp_r: number; valid_until?: number | null; exit_at?: number | null; comment?: string };
type Ctx = { st: BarStore; i: number; day: number; atr: number; bid: number; ask: number; t: number; tn: number; mod: number };
export type StratDef = { name: string; kind: "LM" | "RANGE" | "R50"; params: Record<string, any>; needInside?: boolean };

export const DEFAULT_STRATS: StratDef[] = [
  { name: "LM", kind: "LM", params: { open_time: "01:05", entry_time: "09:30", window_min: 5, sl_atr: 0.5, tp_r: 3.0, exit_time: "21:00" } },
  { name: "AORB", kind: "RANGE", params: { range_start: "03:30", range_end: "04:30", sl_atr: 0.25, tp_r: 3.0, exit_time: "23:30" } },
  { name: "TOK", kind: "RANGE", params: { range_start: "03:00", range_end: "03:30", sl_atr: 0.25, tp_r: 2.0, exit_time: "23:30" } },
  { name: "R50", kind: "R50", params: { ref_time: "01:05", step: 50.0, buf_atr: 0.03, fill_end: "20:00", sl_atr: 0.15, tp_r: 0.0, exit_time: "23:30" } },
  { name: "ALB", kind: "RANGE", needInside: true, params: { range_start: "01:05", range_end: "09:00", fill_end: "18:00", sl_atr: 0.25, tp_r: 2.0, exit_time: "23:30" } },
];

function openAt(c: Ctx, minute: number, tol = 5) {
  const j = c.st.barAt(c.day, minute, tol);
  if (j < 0 || j > c.i) return null;
  return c.st.o[j];
}
function rangeOf(c: Ctx, s: number, e: number) {
  if (e * 60 + c.day > c.tn) return null;
  return c.st.rangeHL(c.day, s, e, c.i);
}

class Strat {
  done = false;
  constructor(public d: StratDef) {}
  get name() { return this.d.name; }
  reset() { this.done = false; }
  onBar(c: Ctx): Order[] | null {
    const p = this.d.params;
    if (this.d.kind === "LM") {
      const e = hm(p.entry_time);
      if (this.done || c.mod < e) return null;
      this.done = true;
      if (c.mod > e + Number(p.window_min) || Number.isNaN(c.atr)) return null;
      const ref = openAt(c, hm(p.open_time));
      if (ref == null) return null;
      const side = c.bid > ref ? 1 : c.bid < ref ? -1 : 0;
      if (!side) return null;
      return [{ kind: "market", sl: Number(p.sl_atr) * c.atr, side, tp_r: Number(p.tp_r), exit_at: hm(p.exit_time), comment: this.name }];
    }
    if (this.d.kind === "R50") {
      const r = hm(p.ref_time);
      if (this.done || c.mod < r) return null;
      this.done = true;
      if (c.mod > r + 10 || Number.isNaN(c.atr)) return null;
      const p0 = openAt(c, r);
      if (p0 == null) return null;
      const stp = Number(p.step);
      const up = Math.ceil(p0 / stp) * stp, dn = Math.floor(p0 / stp) * stp;
      if (up - p0 <= 0.1 || p0 - dn <= 0.1) return null;
      const buf = Number(p.buf_atr) * c.atr;
      return [{ kind: "oco", sl: Math.max(Number(p.sl_atr) * c.atr, 0.5), buy_price: up + buf, sell_price: dn - buf, tp_r: Number(p.tp_r), valid_until: hm(p.fill_end), exit_at: hm(p.exit_time), comment: this.name }];
    }
    const s = hm(p.range_start), e = hm(p.range_end), fe = hm(p.fill_end || p.exit_time);
    if (this.done || c.mod < e) return null;
    this.done = true;
    if (c.mod >= fe || c.mod > e + 10 || Number.isNaN(c.atr)) return null;
    const rg = rangeOf(c, s, e);
    if (!rg) return null;
    const [hi, lo] = rg;
    if (hi <= lo) return null;
    if (this.d.needInside && !(lo < c.bid && c.bid < hi)) return null;
    return [{ kind: "oco", sl: Math.max(Number(p.sl_atr) * c.atr, 0.5), buy_price: hi, sell_price: lo, tp_r: Number(p.tp_r), valid_until: fe, exit_at: hm(p.exit_time), comment: this.name }];
  }
}

export type BTConfig = {
  balance: number; funding: boolean; risk_pct: number; compound: boolean; compound_up_pct: number; compound_dn_pct: number; max_open_trades: number;
  use_time_exit: boolean; no_time_exit_tp_r: number; dd_throttle: boolean; throttle_min: number; max_spread: number; min_lot_tol: number;
  contract: number; cost_per_lot: number; lot_step: number; lot_min: number; daily_guard_pct: number; max_guard_pct: number; max_loss_pct: number; target_pct: number;
  start?: number; end?: number;
};
export const DEFAULT_CFG: BTConfig = {
  balance: 100000, funding: false, risk_pct: 0.3, compound: true, compound_up_pct: 2, compound_dn_pct: 1, max_open_trades: 4, use_time_exit: true, no_time_exit_tp_r: 3,
  dd_throttle: true, throttle_min: 0.3, max_spread: 0.8, min_lot_tol: 2, contract: 100, cost_per_lot: 10, lot_step: 0.01, lot_min: 0.01,
  daily_guard_pct: 2.5, max_guard_pct: 9, max_loss_pct: 10, target_pct: 0,
};

export function runBacktest(st: BarStore, defs: StratDef[], cfg: BTConfig) {
  const strategies = defs.map((d) => new Strat(d));
  const { ts, tn, o, h, l, c, sp, dayn, mod: modA } = st;
  const n = st.length;
  const i0 = cfg.start ? lowerBound(ts, cfg.start) : 0;
  const i1 = cfg.end ? lowerBound(ts, cfg.end + 1) : n;
  const contract = cfg.contract, cpl = cfg.cost_per_lot;
  // riesgo
  const rs = { init: cfg.balance, base: cfg.balance, srvDay: 0, dayRef: 0, daily: false, perm: false, target: false };
  const floors = () => cfg.funding ? [rs.dayRef * (1 - cfg.daily_guard_pct / 100), rs.init * (1 - cfg.max_guard_pct / 100)] : [-Infinity, -Infinity];
  const factor = (eq: number) => { if (!cfg.dd_throttle || !cfg.funding) return 1; const fl = rs.init * (1 - cfg.max_loss_pct / 100); return Math.max(cfg.throttle_min, Math.min(1, (eq - fl) / (rs.init * cfg.max_loss_pct / 100))); };
  const blocked = () => rs.perm ? "bloqueado por DD máximo" : rs.target ? "objetivo de fase alcanzado" : rs.daily ? "pausa diaria" : null;
  const checkGuards = (eq: number) => {
    if (!cfg.funding) return null;
    const [fd, fs] = floors();
    let why: string | null = null;
    if (!rs.daily && eq <= fd) { rs.daily = true; why = "GUARDA DIARIA"; }
    if (!rs.perm && eq <= fs) { rs.perm = true; why = "GUARDA DD MÁXIMO"; }
    if (cfg.target_pct > 0 && !rs.target && eq >= rs.init * (1 + cfg.target_pct / 100)) { rs.target = true; why = "OBJETIVO ALCANZADO"; }
    return why;
  };
  const normLots = (x: number) => { x = Math.floor(x / cfg.lot_step + 1e-9) * cfg.lot_step; return x < cfg.lot_min - 1e-12 ? 0 : Math.round(Math.min(x, 100) * 1e8) / 1e8; };
  const size = (slD: number, eq: number, worst: number, bal: number): [number, number, string] => {
    if (slD <= 0) return [0, 0, "SL no válido"];
    if (cfg.compound && (bal >= rs.base * (1 + cfg.compound_up_pct / 100) || bal <= rs.base * (1 - cfg.compound_dn_pct / 100))) rs.base = bal;
    const base = cfg.compound ? rs.base : rs.init;
    let risk = base * cfg.risk_pct / 100 * factor(eq);
    let room = Infinity;
    if (cfg.funding) { room = worst - Math.max(...floors()); if (room <= 0) return [0, 0, "sin margen hasta las guardas"]; risk = Math.min(risk, room * 0.9); }
    const lpl = slD * contract + cpl;
    const lots = normLots(risk / lpl);
    if (lots <= 0) {
      const rmin = lpl * cfg.lot_min;
      if (cfg.min_lot_tol > 1 && rmin <= risk * cfg.min_lot_tol && rmin <= room * 0.9) return [cfg.lot_min, rmin, "lote mínimo"];
      return [0, 0, `el lote mínimo arriesgaría ${rmin.toFixed(2)} (previsto ${risk.toFixed(2)})`];
    }
    return [lots, lots * lpl, ""];
  };

  let balance = cfg.balance;
  type Pos = { strategy: string; side: number; lots: number; entry: number; sl: number; tp: number; t_open: number; i_open: number; exit_at: number | null; day: number; sl_dist: number; risk_money: number; from_stop: boolean; mfe: number; mae: number };
  let positions: Pos[] = [];
  let pending: { strategy: string; order: Order }[] = [];
  const trades: any[] = [], skipped: any[] = [], daily: { day: number; balance: number; equity: number }[] = [];
  let traded = new Set<string>();
  let curDay: number | null = null, curSrv: number | null = null, atr = NaN, weekday = false;

  const equityAt = (b: number, a: number) => { let e = balance; for (const p of positions) e += ((p.side > 0 ? b : a) - p.entry) * p.side * contract * p.lots; return e; };
  const worstEq = () => { let e = balance; for (const p of positions) e += (p.sl - p.entry) * p.side * contract * p.lots; return e; };
  const close = (p: Pos, i: number, xp: number, reason: string) => {
    const pnl = (xp - p.entry) * p.side * contract * p.lots - cpl * p.lots;
    balance += pnl;
    trades.push({ strategy: p.strategy, side: p.side, t_open: p.t_open, t_close: ts[i], entry: p.entry, exit: xp, sl: p.sl, tp: p.tp, lots: p.lots, pnl,
      R: ((xp - p.entry) * p.side - cpl / contract) / p.sl_dist, reason, mfe_R: p.mfe / p.sl_dist, mae_R: p.mae / p.sl_dist, balance });
    positions = positions.filter((x) => x !== p);
  };
  const tryOpen = (name: string, od: Order, side: number, px: number, i: number, fromStop: boolean) => {
    if (traded.has(name)) return false;
    traded.add(name);
    if (cfg.max_open_trades > 0 && positions.length >= cfg.max_open_trades) { skipped.push([ts[i], name, "límite de operaciones simultáneas"]); return false; }
    if (positions.some((p) => p.side === -side)) { skipped.push([ts[i], name, "posición contraria abierta (sin cobertura)"]); return false; }
    if (sp[i] > cfg.max_spread) { skipped.push([ts[i], name, "spread alto"]); return false; }
    const slD = od.sl;
    let tpR = od.tp_r;
    if (tpR <= 0 && !cfg.use_time_exit) tpR = cfg.no_time_exit_tp_r;
    const bid = o[i], ask = o[i] + sp[i];
    const [lots, riskMoney, why] = size(slD, equityAt(bid, ask), worstEq(), balance);
    if (lots <= 0) { skipped.push([ts[i], name, why]); return false; }
    positions.push({ strategy: name, side, lots, entry: px, sl: px - side * slD, tp: tpR > 0 ? px + side * tpR * slD : 0, t_open: ts[i], i_open: i,
      exit_at: cfg.use_time_exit ? (od.exit_at ?? null) : null, day: curDay!, sl_dist: slD, risk_money: riskMoney, from_stop: fromStop, mfe: 0, mae: 0 });
    return true;
  };

  for (let i = i0; i < i1; i++) {
    const t = ts[i], dn = dayn[i], mod = modA[i];
    const bidO = o[i], askO = o[i] + sp[i];
    const sday = t - (t % DAY);
    if (sday !== curSrv) {
      if (curSrv != null) daily.push({ day: curSrv, balance, equity: equityAt(c[i - 1], c[i - 1] + sp[i - 1]) });
      curSrv = sday;
      if (sday !== rs.srvDay) { rs.srvDay = sday; rs.dayRef = Math.max(balance, equityAt(bidO, askO)); rs.daily = false; }
    }
    if (dn !== curDay) {
      curDay = dn; traded = new Set(); pending = [];
      const k = st.dayIdx(dn);
      atr = k >= 0 ? st.dAtr[k] : NaN;
      weekday = (Math.floor(dn / DAY) + 3) % 7 < 5;
      if (weekday) for (const s of strategies) s.reset();
    }
    if (cfg.use_time_exit) for (const p of [...positions]) if ((p.exit_at != null && mod >= p.exit_at && p.day === dn) || p.day !== dn) close(p, i, p.side > 0 ? bidO : askO, "TIEMPO");
    let why = checkGuards(equityAt(bidO, askO));
    if (why) { for (const p of [...positions]) close(p, i, p.side > 0 ? bidO : askO, why); pending = []; }
    const isBlocked = blocked() != null;
    if (pending.length) pending = pending.filter((q) => q.order.valid_until == null || mod < q.order.valid_until);
    if (weekday && !isBlocked && !Number.isNaN(atr)) {
      const ctx: Ctx = { st, i, day: dn, atr, bid: bidO, ask: askO, t, tn: tn[i], mod };
      for (const s of strategies) {
        if (traded.has(s.name)) continue;
        if (pending.some((q) => q.strategy === s.name)) continue;
        const ods = s.onBar(ctx);
        if (!ods) continue;
        for (const od of ods) {
          if (od.kind === "market") tryOpen(s.name, od, od.side!, od.side! > 0 ? askO : bidO, i, false);
          else pending.push({ strategy: s.name, order: od });
        }
      }
    }
    if (pending.length && !isBlocked) {
      const hiA = h[i] + sp[i], loA = l[i] + sp[i];
      const keep: typeof pending = [];
      for (const q of pending) {
        const od = q.order;
        let fs = 0, px = 0;
        if (od.kind === "oco") {
          const b = hiA >= od.buy_price!, s_ = l[i] <= od.sell_price!;
          if (b && s_) { traded.add(q.strategy); skipped.push([t, q.strategy, "ambos lados en la misma vela"]); continue; }
          if (b) { fs = 1; px = Math.max(od.buy_price!, askO); } else if (s_) { fs = -1; px = Math.min(od.sell_price!, bidO); }
        } else if (od.kind === "stop") {
          if (od.side! > 0 && hiA >= od.price!) { fs = 1; px = Math.max(od.price!, askO); } else if (od.side! < 0 && l[i] <= od.price!) { fs = -1; px = Math.min(od.price!, bidO); }
        } else if (od.kind === "limit") {
          if (od.side! > 0 && loA <= od.price!) { fs = 1; px = Math.min(od.price!, askO); } else if (od.side! < 0 && h[i] >= od.price!) { fs = -1; px = Math.max(od.price!, bidO); }
        }
        if (!fs) { keep.push(q); continue; }
        tryOpen(q.strategy, od, fs, px, i, true);
      }
      pending = keep;
    }
    for (const p of [...positions]) {
      let fav: number, adv: number;
      if (p.side > 0) { fav = h[i] - p.entry; adv = p.entry - l[i]; } else { fav = p.entry - (l[i] + sp[i]); adv = h[i] + sp[i] - p.entry; }
      if (p.i_open === i && p.from_stop) {
        p.mae = Math.max(p.mae, adv);
        if ((p.side > 0 && l[i] <= p.sl) || (p.side < 0 && h[i] + sp[i] >= p.sl)) close(p, i, p.sl, "SL");
        continue;
      }
      p.mfe = Math.max(p.mfe, fav); p.mae = Math.max(p.mae, adv);
      if (p.side > 0) {
        if (l[i] <= p.sl) close(p, i, o[i] < p.sl ? Math.min(p.sl, o[i]) : p.sl, "SL");
        else if (p.tp > 0 && h[i] >= p.tp) close(p, i, o[i] > p.tp ? Math.max(p.tp, o[i]) : p.tp, "TP");
      } else {
        const ah = h[i] + sp[i], al = l[i] + sp[i], ao = o[i] + sp[i];
        if (ah >= p.sl) close(p, i, ao > p.sl ? Math.max(p.sl, ao) : p.sl, "SL");
        else if (p.tp > 0 && al <= p.tp) close(p, i, ao < p.tp ? Math.min(p.tp, ao) : p.tp, "TP");
      }
    }
    if (positions.length || cfg.funding) {
      why = checkGuards(equityAt(c[i], c[i] + sp[i]));
      if (why) { for (const p of [...positions]) close(p, i, p.side > 0 ? c[i] : c[i] + sp[i], why); pending = []; }
    }
  }
  if (i1 > i0) {
    const last = i1 - 1;
    for (const p of [...positions]) close(p, last, p.side > 0 ? c[last] : c[last] + sp[last], "FIN");
    daily.push({ day: curSrv!, balance, equity: balance });
  }
  return { trades, daily, skipped, final: balance, initial: cfg.balance };
}

// ---------------------------------------------------------------------- métricas
function stats(g: any[]) {
  const r = g.map((x) => x.R), n = r.length;
  const mean = r.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const sd = n > 1 ? Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const wins = g.filter((x) => x.pnl > 0).reduce((a, x) => a + x.pnl, 0), losses = -g.filter((x) => x.pnl < 0).reduce((a, x) => a + x.pnl, 0);
  const rd = (v: number, k: number) => Math.round(v * 10 ** k) / 10 ** k;
  return { n, win: rd(g.filter((x) => x.pnl > 0).length / Math.max(1, n), 3), expR: rd(mean, 3), sumR: rd(mean * n, 1), pf: losses > 0 ? rd(wins / losses, 2) : null,
    pnl: rd(g.reduce((a, x) => a + x.pnl, 0), 2), t: n > 2 && sd > 0 ? rd(mean / sd * Math.sqrt(n), 2) : 0 };
}
export function summarize(res: ReturnType<typeof runBacktest>) {
  const out: any = { initial: res.initial, final: Math.round(res.final * 100) / 100, ret_pct: Math.round((res.final / res.initial - 1) * 10000) / 100 };
  const tr = res.trades;
  if (!tr.length) { out.trades = 0; return out; }
  const eq = res.daily.map((d) => d.equity);
  let peak = res.initial, mdd = 0, worst = 0, prev = res.initial;
  const dr: number[] = [];
  for (const e of eq) { peak = Math.max(peak, e); mdd = Math.max(mdd, (peak - e) / peak); const r = (e - prev) / prev; dr.push(r); worst = Math.min(worst, r); prev = e; }
  const m = dr.reduce((a, b) => a + b, 0) / dr.length, sd = Math.sqrt(dr.reduce((a, b) => a + (b - m) ** 2, 0) / dr.length);
  out.max_dd_pct = Math.round(mdd * 10000) / 100; out.worst_day_pct = Math.round(worst * 10000) / 100; out.sharpe = sd > 0 ? Math.round(m / sd * Math.sqrt(252) * 100) / 100 : 0;
  out.trades = tr.length; out.total = stats(tr);
  out.by_strategy = {}; out.by_year = {}; out.exit_reasons = {};
  for (const t of tr) {
    (out.by_strategy[t.strategy] ||= []).push(t);
    (out.by_year[new Date(t.t_open * 1000).getUTCFullYear()] ||= []).push(t);
    out.exit_reasons[t.reason] = (out.exit_reasons[t.reason] || 0) + 1;
  }
  for (const k of Object.keys(out.by_strategy)) out.by_strategy[k] = stats(out.by_strategy[k]);
  for (const k of Object.keys(out.by_year)) out.by_year[k] = stats(out.by_year[k]);
  return out;
}

// ---------------------------------------------------------------------- trabajo en la web
const jobs: Record<string, any> = {};
export const jobState = (name: string) => jobs[name] || { status: "sin datos" };
const setJob = (name: string, j: any) => { jobs[name] = j; emit({ type: "job", name, ...j }); };

async function fetchRange(accountId: string, from: number, to: number) {
  const parts: RawBars[] = [];
  for (let a = from; a <= to; a += 44 * 86400) {
    const { data, error } = await supabase.rpc("get_bars", { acc: accountId, p_from: a, p_to: Math.min(to, a + 44 * 86400 - 60) });
    if (error) throw new Error(error.message);
    parts.push(data as RawBars);
  }
  const out: RawBars = { ts: [], o: [], h: [], l: [], c: [], sp: [], v: [] };
  for (const p of parts) for (const k of Object.keys(out) as (keyof RawBars)[]) out[k].push(...(p[k] as number[]));
  return out;
}

/** Backtest con las velas guardadas de la cuenta (hasta ~6 meses). */
export async function runBacktestJob(accountId: string, shift: number, body: any, settings: any, name = "backtest") {
  setJob(name, { status: "en curso" });
  try {
    const toT = (s: string) => Date.parse(s.trim() + "T00:00:00Z") / 1000;
    const end = body.end ? toT(body.end) + 86400 - 60 : Math.floor(Date.now() / 1000) + 86400;
    const start = body.start ? toT(body.start) : end - 182 * 86400;
    const warm = start - 30 * 86400;
    const raw = await fetchRange(accountId, warm, end);
    if (raw.ts.length < 5000) throw new Error("Hay pocas velas guardadas para un backtest. El EA envía hasta 180 días al conectar (InpWebHistoryDays).");
    const { data: daily } = await supabase.rpc("get_daily", { acc: accountId, p_shift_min: shift, p_before: raw.ts[0] });
    const st = new BarStore(raw, shift, 14, daily as DailyBars);
    const s = settings || {};
    const cfg: BTConfig = { ...DEFAULT_CFG, balance: Number(body.balance || 100000), funding: !!body.funding, start, end,
      risk_pct: s.risk?.risk_pct ?? 0.3, compound: s.risk?.compound ?? true, max_open_trades: s.risk?.max_open_trades ?? 4, use_time_exit: s.risk?.use_time_exit ?? true,
      daily_guard_pct: s.funding?.daily_guard_pct ?? 2.5, max_guard_pct: s.funding?.max_guard_pct ?? 9, max_loss_pct: s.funding?.max_loss_pct ?? 10, target_pct: body.funding ? (s.funding?.target_pct ?? 0) : 0 };
    const defs = (body.strategies as StratDef[] | undefined) || DEFAULT_STRATS.filter((d) => s.strategies?.[d.name]?.enabled !== false);
    await new Promise((r) => setTimeout(r, 30));
    const res = runBacktest(st, defs, cfg);
    const result = { summary: summarize(res), equity: res.daily.map((d) => [d.day, Math.round(d.equity * 100) / 100]), trades: res.trades.slice(-300), skipped: res.skipped.slice(-200),
      note: `Periodo ${new Date(start * 1000).toISOString().slice(0, 10)} – ${new Date(Math.min(end, raw.ts[raw.ts.length - 1]) * 1000).toISOString().slice(0, 10)} con ${raw.ts.length.toLocaleString("es-ES")} velas M1 de tu bróker.` };
    setJob(name, { status: "listo", result });
    return result;
  } catch (e: any) {
    setJob(name, { status: "error", error: e?.message || String(e) });
    throw e;
  }
}
