import assert from "node:assert/strict";
import { build } from "esbuild";

const b = await build({
  entryPoints: ["src/premium/risk.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  logLevel: "silent",
});
const src = Buffer.from(b.outputFiles[0].text).toString("base64");
const { stopExposure, riskSnapshot, ticketSafety } = await import("data:text/javascript;base64," + src);
const at = (n, expected, msg) => assert.ok(Math.abs(n - expected) < 1e-6, msg + ": " + n + " vs " + expected);
const positions = [
  { ticket: 1, symbol: "XAUUSD", side: 1, volume: .1, sl: 2300 },
  { ticket: 2, symbol: "XAUUSD", side: -1, volume: .2, sl: 2350 },
];
const exp = stopExposure(positions, 2320, 2320.25, 100);
at(exp.atStop, 200 + 595, "open-position stop exposure");
at(exp.grossLots, .3, "gross lot exposure");
at(exp.buyLots, .1, "buy lots");
at(exp.sellLots, .2, "sell lots");
assert.equal(exp.withoutStop, 0, "all positions protected");
assert.equal(exp.invalidStops, 0, "valid stop sides");
assert.equal(stopExposure([{ ...positions[0], sl: 0 }], 2320, 2320.25).withoutStop, 1, "no SL");
assert.equal(stopExposure([{ ...positions[0], sl: 2400 }], 2320, 2320.25).invalidStops, 1, "wrong-way stop");
assert.equal(stopExposure(positions, null, null).unpricedStops, 2, "missing quotes");

const s = {
  account: { balance: 5000, equity: 4900 },
  risk: { init_bal: 5000, daily_floor: 4800, max_floor: 4500, funding: true },
  settings: { contract_size: 100, funding: { enabled: true, max_loss_pct: 10, daily_loss_pct: 3 } },
  tick: { bid: 2320, ask: 2320.25, time: 1 },
  positions: [],
  orders: [],
};
const r = riskSnapshot(s);
at(r.budget, 100, "daily buffer smaller than overall buffer");
at(r.totalRemaining, 400, "total buffer");
const t = ticketSafety(s, 2320.25, 2318.25, 1, .1);
at(t.orderRisk, 20, "ticket dollar stop risk");
assert.equal(t.blocked, false, "valid small ticket");
const big = ticketSafety(s, 2320.25, 2318.25, 1, .6);
assert.equal(big.blocked, true, "reject risk beyond headroom");
assert.equal(ticketSafety(s, 2320.25, 2350, 1, .1).blocked, true, "reject buy stop above entry");
assert.equal(ticketSafety(s, 2320.25, 2300, -1, .1).blocked, true, "reject sell stop below entry");
assert.equal(ticketSafety(s, 2320.25, 2300, 1, 0).blocked, true, "reject zero lots");
assert.equal(ticketSafety(s, 2320.25, 2300, 1, NaN).blocked, true, "reject invalid lots");
const withMissingStop = riskSnapshot({ ...s, positions: [{ ...positions[0], sl: 0 }] });
assert.equal(withMissingStop.headroomAfterStops, null, "don't report safe headroom when unbounded");
const withInvalidStop = riskSnapshot({ ...s, positions: [{ ...positions[0], sl: 2400 }] });
assert.equal(withInvalidStop.headroomAfterStops, null, "don't report safe headroom with wrong-way stop");
const withPending = riskSnapshot({ ...s, orders: [{ volume: .75 }] });
at(withPending.pendingLots, .75, "pending orders tracked separately");
console.log("✓ Risk guardrails: portfolio stop exposure, max headroom, buy/sell stops, no-SL and missing quotes validated");
