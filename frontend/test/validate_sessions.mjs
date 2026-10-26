import assert from "node:assert/strict";
import { build } from "esbuild";

// Importamos el módulo TypeScript real: no duplicamos el algoritmo en las pruebas.
const bundle = await build({ entryPoints: ["src/sessions/marketSessions.ts"],
  bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent" });
const url = "data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64");
const { sessionWindows, sessionStatus, wallTimeToUtc, formatSessionTime, chartSessionWindows } = await import(url);
const stamp = (y, m, d) => Date.UTC(y, m - 1, d, 0);
const one = (id, y, m, d) => sessionWindows(stamp(y, m, d), stamp(y, m, d) + 86400000)
  .find(w => w.id === id && w.openUtcMs >= stamp(y, m, d));
const iso = ms => new Date(ms).toISOString().slice(0, 16);
const checks = [
  ["Tokio sin DST", iso(one("tokyo", 2026, 10, 26).openUtcMs), "2026-10-26T00:00"],
  ["Londres antes del cambio", iso(one("london", 2026, 10, 23).openUtcMs), "2026-10-23T07:00"],
  ["Londres después del cambio", iso(one("london", 2026, 10, 26).openUtcMs), "2026-10-26T08:00"],
  ["NY antes del cambio US", iso(one("newyork", 2026, 10, 26).openUtcMs), "2026-10-26T12:00"],
  ["NY después del cambio US", iso(one("newyork", 2026, 11, 2).openUtcMs), "2026-11-02T13:00"],
  ["NY cambio primavera", iso(one("newyork", 2026, 3, 9).openUtcMs), "2026-03-09T12:00"],
  ["Londres cambio primavera", iso(one("london", 2026, 3, 30).openUtcMs), "2026-03-30T07:00"],
];
for (const [name, actual, expected] of checks) assert.equal(actual, expected, name);
const monday = Date.UTC(2026, 9, 26, 13);
const status = sessionStatus(monday);
assert.deepEqual(status.filter(x => x.active).map(x => x.spec.id).sort(), ["london", "newyork"],
  "overlap Londres/NY");
const sunday = sessionStatus(Date.UTC(2026, 9, 25, 11));
assert.ok(sunday.every(x => !x.active), "domingo sin ventanas locales abiertas");
assert.ok(formatSessionTime(one("tokyo", 2026, 10, 26).openUtcMs, "rd", null).includes("20:00"),
  "Tokio lunes inicia domingo 20:00 RD");
assert.ok(formatSessionTime(one("london", 2026, 10, 26).openUtcMs, "broker", null) === "No disponible",
  "no inventar hora del bróker");
const chartZones = chartSessionWindows(stamp(2026, 10, 26) / 1000 + 7200,
  stamp(2026, 10, 27) / 1000 + 7200, 7200);
const london = chartZones.find(z => z.id === "london");
assert.equal(iso(london.t0 * 1000), "2026-10-26T10:00", "conversión UTC a timestamp MT5 naive");
assert.equal(wallTimeToUtc(2026, 10, 26, 8, "Europe/London"), Date.UTC(2026, 9, 26, 8), "wallTime");
console.log("✓ " + (checks.length + 6) + " validaciones de sesiones, DST y conversión");
