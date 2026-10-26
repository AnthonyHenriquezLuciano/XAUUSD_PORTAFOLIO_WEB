// Motor de una cuenta real en la nube: lee lo que envía el EA puente (Supabase), calcula la IA en el navegador
// y manda las órdenes al EA a través de la tabla "commands". Implementa las mismas rutas que usaba la app.
import { emit, type Backend } from "../api";
import { BarStore, dayOf, DailyBars, RawBars } from "../ai/bars";
import { buildFlow } from "../flow/engine";
import { computeFeatures, FeatTable } from "../ai/features";
import { loadModels, Models, predictEntry, scenGet, labelRegime, labelVol } from "../ai/model";
import { evaluateTrade, featAt, marketState, zonesAt } from "../ai/analytics";
import { supabase } from "../lib/supabase";
import { commandAudit, outstandingCommands } from "../premium/commandGuard";

const WINDOW_DAYS = 30;
const TFM: Record<string, number> = { M1: 1, M5: 5, M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440 };
const r2 = (v: number) => Math.round(v * 100) / 100;
const nowS = () => Math.floor(Date.now() / 1000);

export const STRAT_INFO: Record<string, { desc: string; params: Record<string, any> }> = {
  R50: { desc: "Ruptura de los números redondos de $50 alrededor del precio de las 01:05.", params: { ref_time: "01:05", step: 50, buf_atr: 0.03, fill_end: "20:00", sl_atr: 0.15, tp_r: 0, exit_time: "23:30" } },
  TOK: { desc: "Ruptura del rango de Tokio 03:00-03:30.", params: { range_start: "03:00", range_end: "03:30", sl_atr: 0.25, tp_r: 2, exit_time: "23:30" } },
  AORB: { desc: "Ruptura del rango asiático 03:30-04:30.", params: { range_start: "03:30", range_end: "04:30", sl_atr: 0.25, tp_r: 3, exit_time: "23:30" } },
  ALB: { desc: "Ruptura en Londres del rango de Asia (01:05-09:00); el precio debe estar dentro del rango a las 09:00.", params: { range_start: "01:05", range_end: "09:00", fill_end: "18:00", sl_atr: 0.25, tp_r: 2, exit_time: "23:30" } },
  LM: { desc: "Momentum Asia -> Londres: a las 09:30 entra a favor del movimiento desde la apertura de las 01:05.", params: { open_time: "01:05", entry_time: "09:30", window_min: 5, sl_atr: 0.5, tp_r: 3, exit_time: "21:00" } },
};
// Ajustes de noticias, gestión automática y reglas de fondeo (los dos últimos solo los usa la web)
export const EXTRA_DEFAULTS: Record<string, any> = {
  news_enabled: false, news_before: 5, news_after: 5, news_impact: "high", news_close: false, news_close_min: 10,
  mg_scope: "todas", be_enabled: false, be_r: 1, be_offset: 0.1, tr_enabled: false, tr_start_r: 1.5, tr_dist_r: 1,
  pt_enabled: false, pt_r: 1, pt_pct: 50, min_days: 3, consistency_pct: 0,
  dp_enabled: false, dp_scope: "manuales", dp_max_losses: 0, dp_max_trades: 0, dp_profit_pct: 0, dp_loss_pct: 0, dp_cooldown_min: 0, dp_windows: "", dp_close_mt5: false,
};
const WEB_ONLY = new Set(["min_days", "consistency_pct"]);
const START: Record<string, string> = { R50: "01:05", TOK: "03:30", AORB: "04:30", ALB: "09:00", LM: "09:30" };

const CMD_MSG: Record<string, string> = {
  expired: "El EA no recogió la orden a tiempo (más de 20 s). ¿Está el EA conectado y MT5 abierto?",
};

export async function createCloud(accountId: string): Promise<Backend> {
  let alive = true;
  let acc: any = null, role = "viewer", me: any = null;
  let st: any = {}, live: any = {}, setRow: any = { data: {} };
  let store: BarStore | null = null, T: FeatTable | null = null, models: Models | null = null;
  let trades: any[] = [];
  let events: any[] = [];
  let news: any[] = [];
  let signals: any = {};
  let lastLiveAt = 0;
  let status = "conectando";
  let channel: any = null;
  const timers: number[] = [];
  const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: number }>();
  let barBusy = false, lastTickMin = 0;

  const fail = (m: string): never => { throw new Error(m); };
  const can = (r: string) => ({ viewer: 0, trader: 1, owner: 2 } as any)[role] >= ({ viewer: 0, trader: 1, owner: 2 } as any)[r];
  const needTrader = () => { if (!can("trader")) fail("Tu acceso a esta cuenta es de solo lectura."); };

  // ------------------------------------------------------------------ vistas
  const ea = () => st.ea || {};
  const eaSet = () => ea().settings || {};
  const shift = () => Number(ea().server_shift_min || 0);
  const contract = () => Number(ea().contract || 100);
  const symbol = () => ea().symbol || acc?.symbol || "XAUUSD";
  const eaOnline = () => Date.now() - lastLiveAt < 12000;

  function tick() {
    if (!live?.bid) return st.tick || null;
    return { time: Number(live.t), bid: Number(live.bid), ask: Number(live.ask) };
  }
  function account() {
    const a = st.account || {};
    return { ...a, equity: live.equity ?? a.balance, balance: live.balance ?? a.balance, margin: live.margin ?? 0, free_margin: live.free_margin ?? 0 };
  }
  function positions() {
    const prof = live.profit || {};
    return (st.positions || []).filter((p: any) => !p.symbol || p.symbol === symbol()).map((p: any) => ({ ...p, profit: prof[p.ticket]?.profit ?? 0, swap: prof[p.ticket]?.swap ?? 0 }));
  }
  function orders() { return (st.orders || []).filter((o: any) => !o.symbol || o.symbol === symbol()); }
  function risk() {
    const r = st.risk || {}, s = eaSet();
    const eq = Number(live.equity ?? st.account?.balance ?? 0);
    const init = Number(r.init_bal || 0), dayRef = Number(r.day_ref || 0), maxLoss = Number(s.max_loss_pct ?? 10);
    const factor = init > 0 ? Math.max(0.3, Math.min(1, (eq - init * (1 - maxLoss / 100)) / (init * maxLoss / 100))) : 1;
    return {
      ...r, funding: true, autotrade: !!s.autotrade, target_pct: Number(s.target_pct || 0),
      daily_dd_pct: dayRef > 0 ? r2(Math.max(0, (dayRef - eq) / dayRef * 100)) : 0,
      max_dd_pct: init > 0 ? r2(Math.max(0, (init - eq) / init * 100)) : 0,
      progress_pct: init > 0 ? r2((eq / init - 1) * 100) : 0, factor: r2(factor),
    };
  }
  function strategies() {
    const list = st.strategies || [];
    const names = list.length ? list.map((x: any) => x.name) : Object.keys(STRAT_INFO);
    return names.map((n: string) => {
      const x = list.find((y: any) => y.name === n) || {};
      return { name: n, description: STRAT_INFO[n]?.desc || "", state: x.state || "sin datos del EA", start: START[n], levels: x.levels || null, params: STRAT_INFO[n]?.params || {}, enabled: x.enabled ?? (eaSet().strategies?.[n] ?? true), builtin: true };
    });
  }
  /** Ajustes en el formato de la interfaz: lo que pide la web (data) sobre lo que aplica el EA. */
  function settings() {
    const e = eaSet(), d = setRow.data || {};
    const v = (k: string, def: any) => (d[k] !== undefined ? d[k] : e[k] !== undefined ? e[k] : def);
    const strat: Record<string, any> = {};
    for (const n of Object.keys(STRAT_INFO)) strat[n] = { enabled: d.strategies?.[n] ?? e.strategies?.[n] ?? true, params: {} };
    const pending: string[] = [];
    for (const k of ["autotrade", "risk_pct", "max_open_trades", "use_time_exit", "compound", "daily_guard_pct", "max_guard_pct", "target_pct"]) {
      if (d[k] !== undefined && e[k] !== undefined && String(d[k]) !== String(e[k]) && !(typeof d[k] === "number" && Math.abs(d[k] - e[k]) < 1e-6)) pending.push(k);
    }
    for (const n of Object.keys(STRAT_INFO)) if (d.strategies?.[n] !== undefined && e.strategies?.[n] !== undefined && d.strategies[n] !== e.strategies[n]) pending.push(n);
    const extra: Record<string, any> = {};
    for (const k of Object.keys(EXTRA_DEFAULTS)) {
      extra[k] = v(k, EXTRA_DEFAULTS[k]);
      if (!WEB_ONLY.has(k) && d[k] !== undefined && e[k] !== undefined && String(d[k]) !== String(e[k]) && !(typeof d[k] === "number" && Math.abs(d[k] - e[k]) < 1e-6)) pending.push(k);
    }
    // un EA antiguo no conoce estos ajustes
    const eaSupports = e.news_enabled !== undefined;
    const eaDiscipline = e.dp_enabled !== undefined;
    return {
      symbol: symbol(), contract_size: contract(), magic: ea().magic, server_shift_min: shift(), autotrade: !!v("autotrade", false),
      risk: { risk_pct: Number(v("risk_pct", 0.3)), max_open_trades: Number(v("max_open_trades", 4)), use_time_exit: !!v("use_time_exit", true), compound: !!v("compound", true) },
      funding: { enabled: true, phase: Number(d.phase ?? (Number(e.target_pct) === 8 ? 1 : Number(e.target_pct) === 5 ? 2 : 0)), daily_loss_pct: 3, max_loss_pct: Number(e.max_loss_pct ?? 10),
        daily_guard_pct: Number(v("daily_guard_pct", 2.5)), max_guard_pct: Number(v("max_guard_pct", 9)), target_pct: Number(v("target_pct", 0)), initial_balance: Number(e.initial_balance || 0) },
      strategies: strat, pending, ea_settings: e, web_settings: d, extra, ea_supports_extra: eaSupports, ea_supports_dp: eaDiscipline,
    };
  }
  function eaInfo() {
    return { online: eaOnline(), last_seen: lastLiveAt ? Math.floor(lastLiveAt / 1000) : (live.updated_at ? Math.floor(Date.parse(live.updated_at) / 1000) : null),
      version: ea().version, trade_allowed: st.account?.trade_allowed, hedging: st.account?.hedging, digits: ea().digits, vol_min: ea().vol_min, vol_step: ea().vol_step };
  }
  function market() {
    const m = st.market || {};
    if (!eaOnline()) return { open: false, reason: "el EA no está conectado", last_tick: live.t || null };
    return { open: live.open ?? m.open ?? true, reason: "sin precios recientes del bróker", last_tick: live.t || null, news: m.news || null, discipline: m.discipline || null };
  }
  const journalRow = (t: any) => ({ id: t.id, ticket: Number(t.ticket), source: t.source, strategy: t.strategy, side: t.side, lots: t.lots, entry: t.entry,
    sl: t.sl0 ?? t.sl, tp: t.tp0 ?? t.tp, sl0: t.sl0, tp0: t.tp0, sl_now: t.sl, tp_now: t.tp, t_open: Number(t.t_open), exit: t.exit, t_close: t.t_close ? Number(t.t_close) : null,
    pnl: t.pnl, R: t.r, reason: t.reason, status: t.status, prediction: t.prediction, evaluation: t.evaluation, note: t.note || "" });

  /** Segundos que el servidor del bróker va por delante de UTC (del último precio y la hora en que llegó). */
  function srvOffset() {
    if (live.t && live.updated_at) {
      const o = Number(live.t) - Date.parse(live.updated_at) / 1000;
      if (Math.abs(o) < 15 * 3600) return Math.round(o / 900) * 900;
    }
    return 2 * 3600;
  }
  async function loadNews() {
    const now = nowS();
    const { data } = await supabase.from("news").select("ts, country, title, impact, forecast, previous").gte("ts", now - 3 * 86400).lte("ts", now + 9 * 86400).order("ts");
    news = data || [];
    emit({ type: "state", state: { news, news_offset: srvOffset() } });
  }
  function fullState() {
    return {
      status, broker: "cloud", role, me: me?.email, accountInfo: acc ? { id: acc.id, name: acc.name, login: acc.login, server: acc.server } : null,
      ea: eaInfo(), account: account(), positions: positions(), orders: orders(), risk: risk(), signals, strategies: strategies(), settings: settings(),
      tick: tick(), market: market(), models: models ? { entry: true, forecast: true, entry_meta: models.entry.meta, forecast_meta: models.forecast.meta } : {},
      history: store?.length || 0, sim: null, news, news_offset: srvOffset(),
    };
  }
  const pushAccount = () => emit({ type: "account", account: account(), positions: positions(), orders: orders(), risk: risk(), market: market() });
  const pushState = (extra: any = {}) => emit({ type: "state", state: { ea: eaInfo(), strategies: strategies(), settings: settings(), market: market(), ...extra } });

  // ------------------------------------------------------------------ velas e IA
  async function rpc(name: string, args: any) {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
  }
  async function loadBars() {
    const tEnd = Number(live.t || st.tick?.time || 0) || nowS();
    const dN = dayOf(tEnd - shift() * 60 - WINDOW_DAYS * 86400);
    const from = dN + shift() * 60;
    const [m1, daily] = await Promise.all([rpc("get_bars", { acc: accountId, p_from: from, p_to: null }), rpc("get_daily", { acc: accountId, p_shift_min: shift(), p_before: from })]);
    store = new BarStore(m1 as RawBars, shift(), 14, daily as DailyBars);
    T = store.length ? computeFeatures(store) : null;
  }
  async function pollBars(force = false) {
    if (!store || barBusy || !alive) return;
    const last = store.length ? store.ts[store.length - 1] : 0;
    const t = Number(live.t || 0);
    if (!force && t && t < last + 120) return;
    barBusy = true;
    try {
      if (!store.length) {
        // la cuenta aún no tenía velas al abrirla: volver a cargar la ventana completa cuando lleguen
        await loadBars();
        if (store && store.length) {
          emit({ type: "bars", n: store.length });
          if (status !== "conectado") { status = "conectado"; emit({ type: "status", status }); }
          updateSignals();
          autoEvaluate();
        }
        return;
      }
      const d = await rpc("get_bars", { acc: accountId, p_from: last + 60, p_to: null }) as RawBars;
      if (d.ts.length) {
        if (!store.length) await loadBars(); else store.append(d);
        T = computeFeatures(store);
        emit({ type: "bars", n: store.length });
        updateSignals();
        autoEvaluate();
      }
    } catch (e) { console.warn(e); } finally { barBusy = false; }
  }
  function updateSignals() {
    if (!store) return;
    const k = tick();
    const t = k?.time || (store.length ? store.ts[store.length - 1] + 60 : nowS());
    signals = marketState(store, T, models, strategies(), k?.bid || (store.length ? store.c[store.length - 1] : 0), t);
    emit({ type: "signals", signals });
  }

  // ------------------------------------------------------------------ diario: predicción al abrir y evaluación al cerrar
  async function saveTrade(id: number, patch: any) {
    if (!can("trader")) return;
    const { error } = await supabase.from("trades").update(patch).eq("id", id);
    if (error) console.warn(error.message);
  }
  function predictionFor(t: any) {
    if (!store || !models) return null;
    const slD = t.sl0 ? Math.abs(t.entry - t.sl0) : 0;
    if (!slD) return null;
    const f = featAt(store, T, Number(t.t_open));
    if (!f) return null;
    const pred = predictEntry(models, f, t.side, slD, t.tp0 ? Math.abs(t.tp0 - t.entry) / slD : 0);
    const scen = t.source === "estrategia" ? scenGet(models, t.strategy, labelRegime(f), labelVol(f)) : null;
    return { model: pred, scenario: scen, regime: labelRegime(f), vol: labelVol(f) };
  }
  const evaluating = new Set<number>();
  function autoEvaluate() {
    if (!store || !models || !can("trader")) return;
    const lastTs = store.length ? store.ts[store.length - 1] : 0;
    const first = store.length ? store.ts[0] + 3 * 86400 : Infinity;
    for (const t of trades) {
      if (evaluating.has(t.id)) continue;
      if (!t.prediction && t.t_open >= first && t.t_open <= lastTs) {
        const p = predictionFor(t);
        if (p) { t.prediction = p; evaluating.add(t.id); saveTrade(t.id, { prediction: p }).finally(() => evaluating.delete(t.id)); }
      }
      if (t.status === "cerrada" && !t.evaluation?.complete && t.t_open >= first && t.t_close && Number(t.t_close) <= lastTs) {
        const ev = evaluateTrade(store, T, models, { side: t.side, entry: t.entry, sl: t.sl0, tp: t.tp0, t_open: Number(t.t_open), t_close: Number(t.t_close), exit: t.exit, lots: t.lots }, Number(live.balance || st.account?.balance || 0), contract());
        if (ev.ok) {
          t.evaluation = ev; evaluating.add(t.id);
          saveTrade(t.id, { evaluation: ev }).finally(() => evaluating.delete(t.id));
          emit({ type: "event", t: nowS(), level: "info", msg: `Operación #${t.ticket} evaluada: ${ev.score}/100 · ${ev.timing}` });
          emit({ type: "trade_closed", ticket: t.ticket });
        }
      }
    }
  }
  /** Evaluación de una operación antigua (fuera de las velas cargadas): pide sus velas y las anteriores. */
  async function evaluateOld(tr: any) {
    const sh = shift();
    const t0 = Number(tr.t_open), t1 = Number(tr.t_close || t0 + 4 * 3600);
    const dN = dayOf(t0 - sh * 60 - 6 * 86400);
    const from = dN + sh * 60;
    const [m1, daily] = await Promise.all([rpc("get_bars", { acc: accountId, p_from: from, p_to: Math.min(t1 + 5 * 3600, from + 44 * 86400) }), rpc("get_daily", { acc: accountId, p_shift_min: sh, p_before: from })]);
    if (!(m1 as RawBars).ts.length) fail("No hay velas guardadas de esa fecha (el EA envía hasta 180 días hacia atrás al conectar).");
    const s2 = new BarStore(m1 as RawBars, sh, 14, daily as DailyBars);
    const T2 = computeFeatures(s2);
    return evaluateTrade(s2, T2, models, tr, Number(live.balance || st.account?.balance || 0), contract());
  }

  // Guard against knowingly resubmitting a second remote trade while an
  // earlier command may have executed but lost its acknowledgement.
  // This is advisory on the web only. Exactly-once still requires MQL5/DB reconciliation.
  async function commandRows(outstandingOnly = false) {
    let q = supabase.from("commands")
      .select("id,type,status,created_at,done_at,result")
      .eq("account_id", accountId).order("id", {ascending:false});
    if (outstandingOnly) q = q.in("status",["pending","sent"])
       .in("type",["open","close","close_all","modify","modify_order","cancel"]).limit(100);
    else q = q.limit(80);
    const {data,error} = await q;
    if (error) fail("No se pudo verificar el estado de los comandos MT5. Por seguridad no se enviará otra orden: "+error.message);
    return data || [];
  }

  // ------------------------------------------------------------------ órdenes al EA
  async function command(type: string, payload: any, label?: string): Promise<any> {
    needTrader();
    if (!eaOnline()) fail("El EA no está conectado ahora mismo: abre MT5 con el EA puente en el gráfico de " + symbol() + ".");
    if (type === "open") {
      const unresolved = outstandingCommands(await commandRows(true));
      if (unresolved.length) fail(
        "Hay "+unresolved.length+" comando(s) MT5 sin confirmación. Revisa las órdenes e historial en MT5 y el nuevo panel de conciliación antes de abrir otra operación. No repitas la entrada."
      );
    }
    const { data, error } = await supabase.from("commands").insert({ account_id: accountId, type, payload }).select("id").single();
    if (error) fail(error.message.includes("row-level") ? "No tienes permiso para operar esta cuenta." : error.message);
    const id = Number(data!.id);
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(async () => {
        waiting.delete(id);
        const { data: c } = await supabase.from("commands").select("status,result").eq("id", id).maybeSingle();
        if (c && (c.status === "done" || c.status === "error" || c.status === "expired")) finish(id, c.status, c.result, resolve, reject, label);
        else reject(new Error("Comando MT5 #"+id+" sin respuesta definitiva tras 25 s. El resultado es DESCONOCIDO, no fallido: comprueba posiciones, órdenes y operaciones de MT5 antes de intentar otra orden."));
      }, 25000);
      waiting.set(id, { resolve, reject, timer });
      // respaldo por si el tiempo real se pierde un aviso
      const poll = async (n: number) => {
        if (!waiting.has(id) || n > 12) return;
        const { data: c } = await supabase.from("commands").select("status,result").eq("id", id).maybeSingle();
        if (c && c.status !== "pending" && c.status !== "sent") onCommandUpdate({ id, status: c.status, result: c.result });
        else window.setTimeout(() => poll(n + 1), 2000);
      };
      window.setTimeout(() => poll(0), 2500);
    });
  }
  function finish(id: number, status: string, result: any, resolve: (v: any) => void, reject: (e: Error) => void, _label?: string) {
    if (status === "done") resolve({ ok: true, ...(result || {}) });
    else reject(new Error(status === "expired" ? CMD_MSG.expired : (result?.msg || "El EA rechazó la orden")));
  }
  function onCommandUpdate(c: any) {
    const w = waiting.get(Number(c.id));
    if (!w || c.status === "pending" || c.status === "sent") return;
    waiting.delete(Number(c.id));
    clearTimeout(w.timer);
    finish(Number(c.id), c.status, c.result, w.resolve, w.reject);
  }

  // ------------------------------------------------------------------ tamaño de la operación (igual que el EA)
  function sizeFor(side: number, entry: number, sl: number, riskPct?: number) {
    const s = eaSet(), r = st.risk || {};
    const slD = Math.abs(entry - sl);
    if (!slD) return { lots: 0, risk: 0, note: "SL no válido" };
    const lpl = slD * contract();
    const base = s.compound ? Number(r.risk_base || r.init_bal || 0) : Number(r.init_bal || 0);
    let risk = base * Math.min(3, riskPct || Number(setRow.data?.risk_pct ?? s.risk_pct ?? 0.3)) / 100;
    const floorD = Number(r.day_ref || 0) * (1 - Number(s.daily_guard_pct ?? 2.5) / 100);
    const floorS = Number(r.init_bal || 0) * (1 - Number(s.max_guard_pct ?? 9) / 100);
    let worst = Number(live.balance ?? st.account?.balance ?? 0);
    for (const p of positions()) worst += p.sl ? (p.sl - p.price_open) * p.side * contract() * p.volume : p.profit;
    const room = worst - Math.max(floorD, floorS);
    if (room <= 0) return { lots: 0, risk: 0, note: "Sin margen de riesgo hasta las guardas de fondeo." };
    let note = "";
    if (risk > room * 0.9) { risk = room * 0.9; note = "Riesgo recortado para no cruzar las guardas de fondeo."; }
    const step = Number(ea().vol_step || 0.01), vmin = Number(ea().vol_min || 0.01);
    const lots = Math.floor(risk / lpl / step + 1e-9) * step;
    if (lots < vmin - 1e-9) return { lots: 0, risk: 0, note: `El lote mínimo (${vmin}) arriesgaría ${(lpl * vmin).toFixed(2)}, más de lo permitido.` };
    return { lots: Math.round(lots * 100) / 100, risk: lots * lpl, note };
  }

  // ------------------------------------------------------------------ ajustes
  async function patchSettings(patch: any) {
    needTrader();
    const data = { ...(setRow.data || {}) };
    for (const k of Object.keys(patch)) {
      if (patch[k] === undefined) continue;
      if (k === "strategies") data.strategies = { ...(data.strategies || {}), ...patch.strategies };
      else data[k] = patch[k];
    }
    const { data: row, error } = await supabase.from("settings").update({ data }).eq("account_id", accountId).select("data, updated_at").single();
    if (error) fail(error.message);
    setRow = row;
    emit({ type: "settings", settings: settings() });
    return { ok: true, settings: settings(), applied: eaOnline() };
  }

  // ------------------------------------------------------------------ tiempo real
  function onLive(row: any) {
    live = row;
    lastLiveAt = Date.now();
    const k = tick();
    if (k) emit({ type: "tick", t: k.time, bid: k.bid, ask: k.ask });
    pushAccount();
    if (status !== "conectado" && store) { status = "conectado"; emit({ type: "status", status }); }
    // vela M1 cerrada: el EA la manda en la siguiente sincronización
    const m = k ? Math.floor(k.time / 60) : 0;
    if (m && lastTickMin && m > lastTickMin) { window.setTimeout(() => pollBars(true), 2500); window.setTimeout(() => pollBars(), 9000); }
    if (m) lastTickMin = m;
  }
  function onState(row: any) {
    const prevStrat = JSON.stringify(st.strategies), prevSet = JSON.stringify(st.ea?.settings);
    st = row;
    pushAccount();
    if (JSON.stringify(row.strategies) !== prevStrat || JSON.stringify(row.ea?.settings) !== prevSet) pushState();
  }
  function onTrade(row: any) {
    const i = trades.findIndex((t) => t.ticket === row.ticket);
    const was = i >= 0 ? trades[i].status : null;
    if (i >= 0) trades[i] = { ...trades[i], ...row }; else trades.unshift(row);
    trades.sort((a, b) => Number(b.t_open) - Number(a.t_open));
    if (row.status === "cerrada" && was !== "cerrada") {
      emit({ type: "event", t: nowS(), level: "info", msg: `Operación #${row.ticket} (${row.strategy}) cerrada: ${Number(row.pnl ?? 0) >= 0 ? "+" : ""}${Number(row.pnl ?? 0).toFixed(2)}${row.r != null ? ` (${Number(row.r) >= 0 ? "+" : ""}${Number(row.r).toFixed(2)} R)` : ""} · ${row.reason || ""}` });
      emit({ type: "trade_closed", ticket: row.ticket });
      window.setTimeout(() => pollBars(true).then(autoEvaluate), 3000);
    } else if (!was) { emit({ type: "trade_closed", ticket: row.ticket }); autoEvaluate(); }
  }
  function subscribeRealtime() {
    const f = `account_id=eq.${accountId}`;
    channel = supabase.channel(`acc-${accountId}-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "live", filter: f }, (p: any) => p.new && onLive(p.new))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "account_state", filter: f }, (p: any) => onState(p.new))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "commands", filter: f }, (p: any) => onCommandUpdate(p.new))
      .on("postgres_changes", { event: "*", schema: "public", table: "trades", filter: f }, (p: any) => p.new && onTrade(p.new))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "events", filter: f }, (p: any) => {
        const e = { t: Math.floor(Date.parse(p.new.t) / 1000), level: p.new.level, msg: p.new.msg };
        events.unshift(e); events = events.slice(0, 300);
        emit({ type: "event", ...e });
      })
      .subscribe((s: string) => { if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") console.warn("tiempo real:", s); });
  }

  // ------------------------------------------------------------------ arranque
  async function start() {
    emit({ type: "status", status: "conectando" });
    const { data: ses } = await supabase.auth.getUser();
    me = ses.user;
    const [a, mem, s, l, sr, ev, tr] = await Promise.all([
      supabase.from("accounts").select("*").eq("id", accountId).single(),
      supabase.from("account_members").select("role").eq("account_id", accountId).eq("user_id", me?.id).maybeSingle(),
      supabase.from("account_state").select("*").eq("account_id", accountId).single(),
      supabase.from("live").select("*").eq("account_id", accountId).maybeSingle(),
      supabase.from("settings").select("data, updated_at").eq("account_id", accountId).single(),
      supabase.from("events").select("t, level, msg").eq("account_id", accountId).order("t", { ascending: false }).limit(300),
      supabase.from("trades").select("*").eq("account_id", accountId).order("t_open", { ascending: false }).limit(500),
    ]);
    if (a.error) fail("No tienes acceso a esta cuenta o ya no existe.");
    acc = a.data; role = mem.data?.role || "viewer"; st = s.data || {}; live = l.data || {}; setRow = sr.data || { data: {} };
    events = (ev.data || []).map((e: any) => ({ t: Math.floor(Date.parse(e.t) / 1000), level: e.level, msg: e.msg }));
    trades = tr.data || [];
    if (live.updated_at && Date.now() - Date.parse(live.updated_at) < 12000) lastLiveAt = Date.parse(live.updated_at);
    subscribeRealtime();
    emit({ type: "hello", state: { ...fullState(), status: "conectando" } });
    emit({ type: "events", events });
    try {
      [models] = await Promise.all([loadModels().catch(() => null), loadBars()]);
    } catch (e: any) {
      emit({ type: "event", t: nowS(), level: "error", msg: "No se pudieron cargar las velas: " + e.message });
      store = new BarStore({ ts: [], o: [], h: [], l: [], c: [], sp: [], v: [] }, shift());
    }
    if (!alive) return;
    status = "conectado";
    updateSignals();
    emit({ type: "hello", state: fullState() });
    if (!store!.length) emit({ type: "event", t: nowS(), level: "warn", msg: "Esta cuenta aún no tiene velas: conecta el EA puente en MT5 (Cuenta → Conectar EA) y en unos minutos se cargará el histórico." });
    autoEvaluate();
    timers.push(window.setInterval(() => { if (alive) pushState(); }, 4000));
    timers.push(window.setInterval(() => { if (alive) pollBars(); }, 20000));
    timers.push(window.setInterval(() => { if (alive) updateSignals(); }, 30000));
    loadNews().catch(() => {});
    timers.push(window.setInterval(() => { if (alive) loadNews().catch(() => {}); }, 20 * 60000));
  }
  function stop() {
    alive = false;
    timers.forEach((t) => clearInterval(t));
    if (channel) supabase.removeChannel(channel);
    waiting.forEach((w) => { clearTimeout(w.timer); w.reject(new Error("Cuenta cerrada")); });
    waiting.clear();
  }

  // ------------------------------------------------------------------ rutas
  async function api(path: string, method: string, body: any): Promise<any> {
    const [p, q] = path.split("?");
    const qs = new URLSearchParams(q || "");
    const k = tick();
    switch (`${method} ${p}`) {
      case "GET /api/state": return fullState();
      case "GET /api/events": return { events };
      case "PUT /api/settings": {
        const b = body || {};
        const patch: any = {};
        if (b.risk) for (const key of ["risk_pct", "max_open_trades", "use_time_exit", "compound"]) if (b.risk[key] !== undefined) patch[key] = b.risk[key];
        if (b.funding) { for (const key of ["daily_guard_pct", "max_guard_pct", "target_pct"]) if (b.funding[key] !== undefined) patch[key] = b.funding[key]; if (b.funding.phase !== undefined) patch.phase = b.funding.phase; }
        for (const key of ["autotrade", "risk_pct", "max_open_trades", "use_time_exit", "compound", "daily_guard_pct", "max_guard_pct", "target_pct", "phase"]) if (b[key] !== undefined) patch[key] = b[key];
        if (b.extra) for (const k of Object.keys(EXTRA_DEFAULTS)) if (b.extra[k] !== undefined) patch[k] = b.extra[k];
        if (b.strategies) { patch.strategies = {}; for (const n of Object.keys(b.strategies)) patch.strategies[n] = typeof b.strategies[n] === "object" ? b.strategies[n].enabled !== false : !!b.strategies[n]; }
        if (!Object.keys(patch).length) { emit({ type: "settings", settings: settings() }); return { ok: true, settings: settings() }; }
        return patchSettings(patch);
      }
      case "POST /api/autotrade": {
        const r = await patchSettings({ autotrade: !!body.on });
        emit({ type: "event", t: nowS(), level: body.on ? "warn" : "info", msg: `Operación automática ${body.on ? "ACTIVADA" : "desactivada"} desde la web${eaOnline() ? "" : " (se aplicará cuando el EA se conecte)"}` });
        return r;
      }
      case "POST /api/risk/reset": return command("reset_guards", {});
      case "POST /api/order": {
        const side = body.side === 1 || body.side === "buy" ? 1 : -1;
        if (!body.sl) fail("Pon un stop loss");
        const payload: any = { side, kind: body.kind || "market", sl: Number(body.sl), tp: Number(body.tp || 0), comment: "web" };
        if (payload.kind !== "market") payload.price = Number(body.price);
        if (body.lots) payload.lots = Number(body.lots); else payload.risk_pct = Number(body.risk_pct || settings().risk.risk_pct);
        const r = await command("open", payload);
        return { ok: true, ticket: r.ticket, lots: r.lots, price: r.price };
      }
      case "POST /api/position/modify": return command("modify", { ticket: Number(body.ticket), sl: Number(body.sl || 0), tp: Number(body.tp || 0) });
      case "POST /api/position/close": return command("close", { ticket: Number(body.ticket), ...(body.volume ? { volume: Number(body.volume) } : {}) });
      case "POST /api/position/breakeven": {
        const ps = positions().find((x: any) => x.ticket === Number(body.ticket));
        if (!ps) fail("posición no encontrada");
        return command("modify", { ticket: ps.ticket, sl: ps.price_open, tp: ps.tp || 0 });
      }
      case "POST /api/order/modify": return command("modify_order", { ticket: Number(body.ticket), price: Number(body.price), sl: Number(body.sl || 0), tp: Number(body.tp || 0) });
      case "POST /api/order/cancel": return command("cancel", { ticket: Number(body.ticket) });
      case "POST /api/close_all": return command("close_all", {});
      case "POST /api/history": return command("history", { days: Number(body.days || 90) });
      case "POST /api/predict": {
        const side = body.side === 1 || body.side === "buy" ? 1 : -1;
        const entry = Number(body.entry), sl = Number(body.sl || 0), tp = Number(body.tp || 0);
        if (!sl) return { ok: false };
        const slD = Math.abs(entry - sl), tpR = tp && slD ? Math.abs(tp - entry) / slD : 0;
        const f = store ? featAt(store, T, k?.time || nowS()) : null;
        const sz = sizeFor(side, entry, sl, body.risk_pct);
        return { ok: true, pred: predictEntry(models, f, side, slD, tpR), tp_r: r2(tpR), sl_dist: r2(slD), lots: sz.lots, risk_money: r2(sz.risk), risk_note: sz.note, reward_money: tp ? r2(sz.lots * Math.abs(tp - entry) * contract()) : null };
      }
      case "GET /api/signals": updateSignals(); return signals;
      case "GET /api/news": return { news, offset: srvOffset() };
      case "GET /api/bars": {
        if (!store) fail("Cargando velas…");
        const m = TFM[qs.get("tf") || "M5"] || 5;
        const lim = Number(qs.get("limit") || 3000);
        return { tf: qs.get("tf"), bars: store!.tf(m).slice(-lim) };
      }
      case "GET /api/flow": {
        const flowStore = store;
        if (!flowStore || !flowStore.length) throw new Error("Sin velas M1 para análisis de volumen.");
        const scope = qs.get("scope") || "london";
        const mode = qs.get("mode") || "session";
        if (!["tokyo", "london", "newyork", "day"].includes(scope) ||
            !["session", "fixed", "recent"].includes(mode)) fail("Selección de perfil no válida.");
        const last = flowStore.ts[flowStore.length - 1] + 59;
        // El corte jamás puede superar la última vela disponible.
        const cutoff = Math.min(last, k?.time || last, Number(qs.get("cutoff") || last));
        return buildFlow(flowStore, last, {
          mode: mode as "session" | "fixed" | "recent",
          scope: scope as "tokyo" | "london" | "newyork" | "day",
          start: qs.has("start") ? Number(qs.get("start")) : undefined,
          end: qs.has("end") ? Number(qs.get("end")) : undefined,
          bins: qs.has("bins") ? Number(qs.get("bins")) : 64,
          cutoff, brokerOffsetSec: srvOffset()
        });
      }
      case "GET /api/overlays": return { zones: store && k ? zonesAt(store, k.time) : [], strategies: strategies(), levels: signals.levels || [] };
      case "GET /api/command_audit": {
        needTrader();
        const rows = await commandRows(false);
        const unresolved = await commandRows(true);
        return { ...commandAudit(unresolved), rows, account_id: accountId,
          advisory: "La verificación web no es idempotencia garantizada entre terminales o pestañas; sólo un ledger transaccional y ACK de MT5 pueden cerrar esa condición." };
      }
      case "GET /api/trades": {
        const src = qs.get("source");
        return { trades: trades.filter((t) => !src || t.source === src).map(journalRow) };
      }
      case "POST /api/trades/evaluate": {
        if (body.ticket) {
          const t = trades.find((x) => Number(x.ticket) === Number(body.ticket));
          if (!t) fail("operación no encontrada");
          const tr = { side: t.side, entry: t.entry, sl: t.sl0, tp: t.tp0, t_open: Number(t.t_open), t_close: t.t_close ? Number(t.t_close) : 0, exit: t.exit, lots: t.lots };
          const inWin = store && store.length && tr.t_open >= store.ts[0] + 3 * 86400;
          const ev = inWin ? evaluateTrade(store!, T, models, tr, Number(live.balance || 0), contract()) : await evaluateOld(tr);
          if (ev.ok) { t.evaluation = ev; await saveTrade(t.id, { evaluation: ev }); }
          return ev;
        }
        const toT = (s: any) => typeof s === "string" ? Date.parse(s.trim().replace(" ", "T") + ":00Z") / 1000 : Number(s);
        const tr = { side: body.side === 1 || body.side === "buy" ? 1 : -1, entry: Number(body.entry), sl: Number(body.sl || 0), tp: Number(body.tp || 0), t_open: toT(body.t_open), t_close: body.t_close ? toT(body.t_close) : 0, exit: body.exit ? Number(body.exit) : null, lots: body.lots };
        const inWin = store && store.length && tr.t_open >= store.ts[0] + 3 * 86400;
        return inWin ? evaluateTrade(store!, T, models, tr, Number(live.balance || 0), contract()) : evaluateOld(tr);
      }
      case "POST /api/trades/note": {
        needTrader();
        const t = trades.find((x) => x.id === Number(body.id));
        if (t) { t.note = body.note || ""; await saveTrade(t.id, { note: t.note }); }
        return { ok: true };
      }
      case "GET /api/models": return { ready: fullState().models, history: [], training: null };
      case "POST /api/backtest": {
        if (!store) fail("Cargando velas…");
        const { runBacktestJob } = await import("../ai/backtest");
        runBacktestJob(accountId, shift(), body || {}, settings());
        return { ok: true };
      }
    }
    if (p.startsWith("/api/job/")) { const { jobState } = await import("../ai/backtest"); return jobState(p.split("/").pop() || ""); }
    if (p.startsWith("/api/mq5")) fail("Las estrategias nuevas se añaden al EA: pruébalas antes en el backtest («Estrategia de prueba»).");
    fail(`Ruta no disponible: ${method} ${p}`);
  }

  return { kind: "cloud", api, start, stop };
}
