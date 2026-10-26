import type { AppState, Position } from "../store";

/** Estimaciones para visualización. La decisión final de lotaje y órdenes corresponde al EA. */
export function stopExposure(positions: Position[], bid: number | null, ask: number | null, contract = 100) {
  let atStop = 0;
  let grossLots = 0;
  let buyLots = 0;
  let sellLots = 0;
  let withoutStop = 0;
  let invalidStops = 0;
  let unpricedStops = 0;
  for (const p of positions) {
    const lots = Number(p.volume);
    const side = Number(p.side);
    const stop = Number(p.sl);
    const price = side > 0 ? bid : ask;
    if (!(lots > 0) || (side !== 1 && side !== -1)) continue;
    grossLots += lots;
    if (side > 0) buyLots += lots; else sellLots += lots;
    if (!(stop > 0)) { withoutStop++; continue; }
    if (price == null || !(price > 0)) { unpricedStops++; continue; }
    const distance = (price - stop) * side;
    if (distance < 0) { invalidStops++; continue; }
    atStop += distance * lots * contract;
  }
  return { atStop, grossLots, buyLots, sellLots, withoutStop, invalidStops, unpricedStops };
}

export function riskSnapshot(s: AppState) {
  const account = s.account || {};
  const risk = s.risk || {};
  const funding = s.settings?.funding || {};
  const equity = Number(account.equity ?? account.balance ?? 0);
  const init = Number(risk.init_bal ?? funding.initial_balance ?? account.balance ?? 0);
  const dailyFloor = Number(risk.daily_floor ?? NaN);
  const maxFloor = Number(risk.max_floor ?? NaN);
  const maxLossPct = Number(funding.max_loss_pct ?? 10);
  const dailyLossPct = Number(funding.daily_loss_pct ?? 3);
  const dailyRemaining = Number.isFinite(dailyFloor) ? Math.max(0, equity - dailyFloor) : null;
  const totalRemaining = Number.isFinite(maxFloor) ? Math.max(0, equity - maxFloor) : null;
  const tradeContract = Number(s.settings?.contract_size ?? s.ea?.contract ?? 100);
  const exposure = stopExposure(
    s.positions || [], s.tick?.bid ?? null, s.tick?.ask ?? null,
    Number.isFinite(tradeContract) && tradeContract > 0 ? tradeContract : 100
  );
  const pendingLots = (s.orders || []).reduce((sum, o) => sum + Math.max(0, Number(o.volume) || 0), 0);
  const budget = dailyRemaining !== null && totalRemaining !== null
    ? Math.min(dailyRemaining, totalRemaining) : dailyRemaining ?? totalRemaining;
  return {
    equity, init, dailyFloor, maxFloor, dailyLossPct, maxLossPct,
    dailyRemaining, totalRemaining, budget,
    exposure, pendingLots,
    headroomAfterStops: budget == null || exposure.withoutStop || exposure.unpricedStops || exposure.invalidStops ? null : budget - exposure.atStop,
    isFunding: !!risk.funding || !!funding.enabled
  };
}

export function ticketSafety(s: AppState, entry: number, sl: number, side: number, lots: number) {
  const risk = riskSnapshot(s);
  const tick = s.tick;
  const contract = Number(s.settings?.contract_size ?? s.ea?.contract ?? 100);
  const value = Math.abs(entry - sl) * lots * (contract > 0 ? contract : 100);
  const existing = risk.exposure.atStop;
  const notes: string[] = [];
  let blocked = false;
  if (!Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(lots) || !(lots > 0)) {
    notes.push("Falta confirmar el lote, precio o stop loss."); blocked = true;
  }
  if (!(sl > 0) || (entry - sl) * side <= 0) {
    notes.push("El stop loss debe proteger el lado contrario de la entrada."); blocked = true;
  }
  if (risk.exposure.withoutStop) notes.push("Hay posiciones abiertas sin stop loss: la exposición no está acotada.");
  if (risk.exposure.invalidStops) notes.push("Hay stops que no son válidos respecto al precio de mercado.");
  if (risk.exposure.unpricedStops) notes.push("Faltan cotizaciones para estimar parte de la exposición.");
  if (tick) {
    const spread = tick.ask - tick.bid;
    if (spread > 0) notes.push("Spread actual: $" + spread.toFixed(2) + " por onza; confirma costes con el bróker.");
  }
  if (risk.isFunding && risk.budget != null && Number.isFinite(value) && value + existing >= risk.budget) {
    notes.push("El riesgo agregado estimado al stop alcanza el margen disponible hasta el límite de fondeo.");
    blocked = true;
  }
  return { ...risk, orderRisk: value, combinedRisk: value + existing, notes, blocked };
}
