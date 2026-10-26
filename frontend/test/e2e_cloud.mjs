// Prueba de extremo a extremo de la web con un Supabase simulado (REST, RPC, auth, función del chat y tiempo real)
// y un "EA" simulado que ejecuta las órdenes. Uso: node test/e2e_cloud.mjs <fixture.json> <carpeta capturas>
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("/opt/npm-tools/node_modules/playwright/index.js");
import { readFileSync, mkdirSync } from "fs";

const [fxPath, shots] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const fx = JSON.parse(readFileSync(fxPath, "utf8"));
const B = fx.bars;
const N = B.ts.length;
const BASE = "https://neqfafcelxgcxroicmer.supabase.co";
const ACC = "d8e675d2-409a-43e8-b375-8c2e83f21b3f";
const UID = "11111111-2222-4333-8444-555555555555";
const lastTs = B.ts[N - 1];

// ------------------------------------------------------------------ base de datos simulada
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: UID, role: "authenticated", email: "e2e.bot@example.com", exp: Math.floor(Date.now() / 1000) + 7200, aud: "authenticated" })}.firma`;
const user = { id: UID, aud: "authenticated", role: "authenticated", email: "e2e.bot@example.com", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" };
let price = B.c[N - 1];
const nowIso = () => new Date().toISOString();
const db = {
  accounts: [{ id: ACC, owner: UID, name: "FundingPips 100k F1", login: 12345678, server: "FundingPips-Demo", symbol: "XAUUSD", created_at: "2026-10-20T00:00:00Z" }],
  account_members: [{ account_id: ACC, user_id: UID, role: "owner", email: "e2e.bot@example.com" }],
  invites: [],
  account_state: [{ account_id: ACC, updated_at: nowIso(), tick: null,
    account: { login: 12345678, server: "FundingPips-Demo", name: "E2E", company: "FundingPips", currency: "USD", balance: 100000, leverage: 100, mode: "demo", hedging: true, trade_allowed: true },
    positions: [], orders: [],
    strategies: [{ name: "R50", enabled: true, state: "hecha hoy", levels: null }, { name: "TOK", enabled: true, state: "sin señal hoy", levels: null }, { name: "AORB", enabled: true, state: "orden pendiente", levels: { buy: price + 12, sell: price - 9 } }, { name: "ALB", enabled: true, state: "pendiente", levels: null }, { name: "LM", enabled: false, state: "desactivada", levels: null }],
    risk: { init_bal: 100000, day_ref: 100000, risk_base: 100000, daily_floor: 97500, max_floor: 91000, daily_limit: 97000, max_limit: 90000, target: 108000, blocked: null, autotrade: false },
    market: { open: true },
    ea: { version: "6.00", symbol: "XAUUSD", magic: 2610200, digits: 2, contract: 100, vol_min: 0.01, vol_step: 0.01, server_shift_min: 0, atr: 60,
      settings: { autotrade: false, risk_pct: 0.3, max_open_trades: 4, use_time_exit: true, compound: true, daily_guard_pct: 2.5, max_guard_pct: 9, target_pct: 8, initial_balance: 100000, max_loss_pct: 10, strategies: { LM: false, AORB: true, TOK: true, R50: true, ALB: true } } } }],
  live: [{ account_id: ACC, bid: price, ask: price + 0.15, t: lastTs + 60, equity: 100000, balance: 100000, margin: 0, free_margin: 100000, profit: {}, open: true, updated_at: nowIso() }],
  settings: [{ account_id: ACC, data: {}, updated_at: nowIso() }],
  events: [{ id: 1, account_id: ACC, t: nowIso(), level: "info", msg: "XAU Portfolio Bridge v6 iniciado" }],
  trades: [{ id: 1, account_id: ACC, ticket: 4990, source: "manual", strategy: "MANUAL", magic: 2610200, side: -1, lots: 0.5, entry: B.o[N - 2000], sl0: B.o[N - 2000] + 6, tp0: B.o[N - 2000] - 12, sl: null, tp: null, t_open: B.ts[N - 2000], exit: B.c[N - 1900], t_close: B.ts[N - 1900], pnl: 100, r: 0.3, reason: "MANUAL", status: "cerrada", prediction: null, evaluation: null, note: "", updated_at: nowIso() }],
  commands: [], notes: [], chat_messages: [],
};
let ids = 100;
const log = [];

function match(row, params) {
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "columns", "on_conflict"].includes(k)) continue;
    const [op, ...rest] = v.split(".");
    const val = rest.join(".");
    const cell = row[k];
    if (op === "eq" && String(cell) !== val) return false;
    if (op === "gt" && !(Number(cell) > Number(val))) return false;
  }
  return true;
}
function project(row, select) {
  if (!select || select === "*") return row;
  const o = {};
  for (const c of select.split(",")) { const k = c.trim(); if (k in row) o[k] = row[k]; }
  return o;
}
const sseText = (t) => t;

function getBars(from, to) {
  const out = { ts: [], o: [], h: [], l: [], c: [], sp: [], v: [] };
  const hi = Math.min(to ?? Infinity, from + 45 * 86400);
  for (let i = 0; i < N; i++) if (B.ts[i] >= from && B.ts[i] <= hi) for (const k of Object.keys(out)) out[k].push(B[k][i]);
  return out;
}
function getDaily(shift, before) {
  const m = new Map();
  for (let i = 0; i < N; i++) {
    const t = B.ts[i];
    if (t >= before || t < before - 400 * 86400) continue;
    const n = t - shift * 60, d = n - (n % 86400);
    const r = m.get(d);
    if (!r) m.set(d, { o: B.o[i], h: B.h[i], l: B.l[i], c: B.c[i] });
    else { r.h = Math.max(r.h, B.h[i]); r.l = Math.min(r.l, B.l[i]); r.c = B.c[i]; }
  }
  const ds = [...m.keys()].sort((a, b) => a - b);
  return { d: ds, o: ds.map((d) => m.get(d).o), h: ds.map((d) => m.get(d).h), l: ds.map((d) => m.get(d).l), c: ds.map((d) => m.get(d).c) };
}

// ------------------------------------------------------------------ "EA" simulado + tiempo real
let ws = null;
const topics = new Map();      // topic -> [{id, table, event}]
function push(table, type, record) {
  if (!ws) return;
  for (const [topic, binds] of topics) for (const b of binds) {
    if (b.table !== table || (b.event !== "*" && b.event !== type)) continue;
    ws.send(JSON.stringify([null, null, topic, "postgres_changes", { ids: [b.id], data: { schema: "public", table, commit_timestamp: nowIso(), type, record, old_record: {}, columns: [], errors: null } }]));
  }
}
function eaTick() {
  price += (Math.random() - 0.5) * 0.6;
  const st = db.account_state[0], lv = db.live[0];
  const prof = {};
  let eq = lv.balance;
  for (const p of st.positions) { const pl = ((p.side > 0 ? price : price + 0.15) - p.price_open) * p.side * 100 * p.volume; prof[p.ticket] = { profit: Math.round(pl * 100) / 100, swap: 0 }; eq += pl; }
  Object.assign(lv, { bid: Math.round(price * 100) / 100, ask: Math.round((price + 0.15) * 100) / 100, t: lv.t + 1, equity: Math.round(eq * 100) / 100, profit: prof, updated_at: nowIso() });
  push("live", "UPDATE", { ...lv });
}
function eaRun(cmd) {
  const st = db.account_state[0];
  const p = cmd.payload;
  let ok = true, result = { msg: "" };
  if (cmd.type === "open") {
    const tk = 7000 + (ids++);
    const px = p.side > 0 ? price + 0.15 : price;
    const lots = p.lots || Math.floor((100000 * (p.risk_pct || 0.3) / 100) / (Math.abs(px - p.sl) * 100) * 100) / 100;
    st.positions.push({ ticket: tk, symbol: "XAUUSD", side: p.side, volume: lots, price_open: Math.round(px * 100) / 100, sl: p.sl, tp: p.tp, magic: 2610200, comment: "web", strategy: "MANUAL", time: db.live[0].t });
    const tr = { id: ids++, account_id: ACC, ticket: tk, source: "manual", strategy: "MANUAL", magic: 2610200, side: p.side, lots, entry: Math.round(px * 100) / 100, sl0: p.sl, tp0: p.tp, sl: p.sl, tp: p.tp, t_open: B.ts[N - 30], status: "abierta", prediction: null, evaluation: null, note: "", updated_at: nowIso() };
    db.trades.unshift(tr);
    push("trades", "INSERT", tr);
    result = { msg: "", ticket: tk, price: Math.round(px * 100) / 100, lots };
  } else if (cmd.type === "modify") {
    const ps = st.positions.find((x) => x.ticket === p.ticket);
    if (!ps) { ok = false; result = { msg: "posición no encontrada" }; } else { ps.sl = p.sl; ps.tp = p.tp; }
  } else if (cmd.type === "close") {
    st.positions = st.positions.filter((x) => x.ticket !== p.ticket);
  }
  st.updated_at = nowIso();
  push("account_state", "UPDATE", { ...st });
  Object.assign(cmd, { status: ok ? "done" : "error", result, done_at: nowIso() });
  push("commands", "UPDATE", { ...cmd });
}

// ------------------------------------------------------------------ navegador
const errors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-ES" });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

await page.routeWebSocket(/realtime\/v1\/websocket/, (sock) => {
  ws = sock;
  sock.onMessage((raw) => {
    const [jref, ref, topic, event, payload] = JSON.parse(String(raw));
    if (event === "heartbeat") return sock.send(JSON.stringify([null, ref, "phoenix", "phx_reply", { status: "ok", response: {} }]));
    if (event === "phx_join") {
      const pc = (payload.config?.postgres_changes || []).map((f, k) => ({ ...f, id: 1000 + topics.size * 10 + k }));
      topics.set(topic, pc.map((x) => ({ id: x.id, table: x.table, event: x.event })));
      return sock.send(JSON.stringify([jref, ref, topic, "phx_reply", { status: "ok", response: { postgres_changes: pc } }]));
    }
    if (event === "phx_leave") { topics.delete(topic); return sock.send(JSON.stringify([jref, ref, topic, "phx_reply", { status: "ok", response: {} }])); }
    if (ref) sock.send(JSON.stringify([jref, ref, topic, "phx_reply", { status: "ok", response: {} }]));
  });
});

await page.route(`${BASE}/**`, async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const path = url.pathname;
  const method = req.method();
  const json = (body, status = 200, headers = {}) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", ...headers }, body: JSON.stringify(body) });
  if (method === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (path === "/auth/v1/token") return json({ access_token: jwt, token_type: "bearer", expires_in: 7200, expires_at: Math.floor(Date.now() / 1000) + 7200, refresh_token: "r1", user });
  if (path === "/auth/v1/user") return json(user);
  if (path === "/auth/v1/logout") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
  if (path === "/functions/v1/chat") {
    const body = JSON.parse(req.postData() || "{}");
    log.push({ chat: body.messages.at(-1)?.content?.slice(0, 60), systemLen: body.system.length });
    return route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", headers: { "access-control-allow-origin": "*" }, body: "Con volatilidad normal y sin tendencia clara, tu venta fue razonable pero entraste tras un tirón. Espera a que el precio vuelva al rango.\n<nota>Solo vendo después de un retroceso al máximo de Asia</nota>" });
  }
  if (path.startsWith("/rest/v1/rpc/")) {
    const fn = path.split("/").pop();
    const a = JSON.parse(req.postData() || "{}");
    log.push({ rpc: fn });
    if (fn === "claim_invites") return json(0);
    if (fn === "my_secrets") return json({ anthropic: true, chat_model: "claude-sonnet-5-5" });
    if (fn === "get_bars") return json(getBars(a.p_from, a.p_to));
    if (fn === "get_daily") return json(getDaily(a.p_shift_min, a.p_before));
    if (fn === "set_anthropic_key") return json(true);
    if (fn === "rotate_bridge_key") return json("xau_" + "ab".repeat(24));
    return json(null);
  }
  if (path.startsWith("/rest/v1/")) {
    const table = path.split("/").pop();
    const rows = db[table];
    if (!rows) return json({ message: "no existe" }, 404);
    const params = [...url.searchParams.entries()];
    const sel = url.searchParams.get("select");
    const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
    if (method === "GET") {
      let out = rows.filter((r) => match(r, params));
      const ord = url.searchParams.get("order");
      if (ord) { const [k, dir] = ord.split("."); out = [...out].sort((x, y) => (x[k] > y[k] ? 1 : -1) * (dir === "desc" ? -1 : 1)); }
      const lim = url.searchParams.get("limit"); if (lim) out = out.slice(0, Number(lim));
      out = out.map((r) => project(r, sel));
      if (single) return out.length ? json(out[0]) : json({ code: "PGRST116", message: "no rows" }, 406);
      return json(out);
    }
    if (method === "POST") {
      const body = JSON.parse(req.postData() || "{}");
      const list = Array.isArray(body) ? body : [body];
      const made = list.map((r) => ({ id: ids++, created_at: nowIso(), user_id: UID, ...r, ...(table === "commands" ? { status: "pending", created_by: UID } : {}) }));
      rows.push(...made);
      log.push({ insert: table, row: made[0] });
      if (table === "commands") setTimeout(() => eaRun(made[0]), 700);
      const out = made.map((r) => project(r, sel));
      return json(single ? out[0] : out, 201);
    }
    if (method === "PATCH") {
      const body = JSON.parse(req.postData() || "{}");
      const hit = rows.filter((r) => match(r, params));
      for (const r of hit) Object.assign(r, body, table === "settings" ? { updated_at: nowIso() } : {});
      log.push({ update: table, body });
      if (table === "settings") {   // el EA aplica los ajustes
        setTimeout(() => { const e = db.account_state[0].ea.settings; Object.assign(e, { ...body.data, strategies: { ...e.strategies, ...(body.data.strategies || {}) } }); push("account_state", "UPDATE", { ...db.account_state[0] }); }, 900);
      }
      const out = hit.map((r) => project(r, sel));
      return json(single ? out[0] : out);
    }
    if (method === "DELETE") { const keep = rows.filter((r) => !match(r, params)); db[table] = keep; return json([]); }
  }
  return json({ message: "ruta simulada desconocida " + path }, 404);
});

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://neqfafcelxgcxroicmer.supabase.co wss://neqfafcelxgcxroicmer.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
await page.route("http://localhost:4173/**", async (r) => { const resp = await r.fetch(); r.fulfill({ response: resp, headers: { ...resp.headers(), "content-security-policy": CSP } }); });
page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) errors.push("CSP: " + m.text()); });
const shot = async (n) => page.screenshot({ path: `${shots}/${n}.png` });
const step = async (name, fn) => { const t0 = Date.now(); try { await fn(); console.log(`✓ ${name} (${Date.now() - t0} ms)`); } catch (e) { console.log(`✗ ${name}: ${e.message.split("\n")[0]}`); await shot("fallo_" + name.replace(/\W+/g, "_")); throw e; } };

const timer = setInterval(eaTick, 1000);
try {
  await page.goto("http://localhost:4173/");
  await step("pantalla de acceso", async () => { await page.getByRole("heading", { name: "Entrar" }).waitFor(); await shot("01_login"); });
  await step("iniciar sesión", async () => {
    await page.getByLabel("Correo").fill("e2e.bot@example.com");
    await page.getByLabel("Contraseña").fill("E2e-test-pass-91");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.getByRole("heading", { name: "Cuentas" }).waitFor({ timeout: 10000 });
    await shot("02_cuentas");
  });
  await step("abrir cuenta", async () => {
    await page.getByRole("button", { name: "Abrir" }).click();
    await page.getByText("EA conectado").first().waitFor({ timeout: 15000 });
    await page.getByText("Balance").first().waitFor();
    await page.waitForTimeout(2500);
    await shot("03_cuenta");
  });
  await step("señales con IA", async () => {
    await page.getByRole("button", { name: "Señales" }).click();
    await page.getByText("ESCENARIO ACTUAL", { exact: false }).first().waitFor({ timeout: 10000 });
    await page.getByText("QUÉ TE CONVIENE HACER", { exact: false }).first().waitFor();
    await page.getByRole("button", { name: "Predecir próximas horas" }).click();
    await page.waitForTimeout(800);
    await shot("04_senales");
  });
  await step("preparar compra con probabilidades", async () => {
    await page.getByRole("button", { name: "Operar" }).click();
    await page.locator("button.bigbtn.buy").click();
    await page.getByText("Termina en ganancia").waitFor({ timeout: 8000 });
    await shot("05_orden");
  });
  await step("enviar compra al EA", async () => {
    await page.getByRole("button", { name: /Confirmar COMPRA/ }).click();
    await page.getByText(/ejecutada en MT5/).waitFor({ timeout: 10000 });
    await page.getByText("Posiciones abiertas").waitFor({ timeout: 5000 });
    await page.waitForTimeout(1200);
    await shot("06_posicion");
  });
  await step("SL a break-even", async () => {
    await page.getByRole("button", { name: "BE" }).first().click();
    await page.getByText("SL a break-even").waitFor({ timeout: 10000 });
  });
  await step("arrastrar el TP en el gráfico", async () => {
    const st = db.account_state[0].positions[0];
    const box = await page.locator(".chart").boundingBox();
    // localizar la línea TP por su etiqueta de precio en el eje: probamos alturas hasta que el cursor cambie
    let y0 = null;
    for (let y = box.y + 10; y < box.y + box.height - 10; y += 2) {
      await page.mouse.move(box.x + box.width * 0.5, y);
      const cur = await page.locator(".chart > div").first().evaluate((el) => el.style.cursor);
      if (cur === "ns-resize") {
        const tipPrice = await page.evaluate(() => 0);
        y0 = y; break;
      }
    }
    if (y0 == null) throw new Error("no se encontró ninguna línea arrastrable");
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, y0 - 40, { steps: 6 });
    await page.mouse.up();
    await page.getByText(/(SL|TP) movido a/).waitFor({ timeout: 10000 });
    log.push({ dragged: db.account_state[0].positions[0] });
  });
  await step("diario y evaluación", async () => {
    await page.getByRole("button", { name: "Diario" }).click();
    await page.getByText("MANUAL").first().waitFor({ timeout: 5000 });
    await page.waitForTimeout(1500);
    await shot("07_diario");
  });
  await step("ajustes: riesgo", async () => {
    await page.getByRole("button", { name: "Ajustes" }).click();
    const inp = page.locator(".card", { hasText: "Riesgo (global" }).locator("input").first();
    await inp.fill("0.4");
    await page.getByRole("button", { name: "Guardar", exact: true }).first().click();
    await page.getByText(/Ajustes enviados al EA/).waitFor({ timeout: 8000 });
    await page.waitForTimeout(1500);
    await shot("08_ajustes");
  });
  await step("automático ON", async () => {
    await page.locator(".auto .toggle").click();
    await page.getByRole("button", { name: "Activar" }).click();
    await page.getByText("Automático ON").waitFor({ timeout: 5000 });
  });
  await step("chat", async () => {
    await page.getByRole("button", { name: "Chat" }).click();
    await page.locator(".chat textarea, .chat input").first().fill("¿Qué tal mi última venta?");
    await page.keyboard.press("Enter");
    await page.getByText(/retroceso al máximo de Asia/).first().waitFor({ timeout: 10000 });
    await shot("09_chat");
  });
  await step("backtest con velas del bróker", async () => {
    await page.getByRole("button", { name: "Estrategias" }).click();
    await page.getByRole("button", { name: "Ejecutar" }).click();
    await page.getByText("Factor beneficio").waitFor({ timeout: 30000 });
    await shot("10_backtest");
  });
  await step("vista de móvil", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    await shot("11_movil");
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    if (sw > 392) throw new Error("desbordamiento horizontal: " + sw);
  });
} finally {
  clearInterval(timer);
  console.log("comandos:", db.commands.map((c) => `${c.type}:${c.status}`).join(", "));
  console.log("ajustes guardados:", JSON.stringify(db.settings[0].data));
  console.log("evaluaciones guardadas:", db.trades.filter((t) => t.evaluation).map((t) => `#${t.ticket} ${t.evaluation.score}/100 ${t.evaluation.timing}`).join(" | ") || "ninguna");
  console.log("notas:", db.notes.map((n) => n.text).join(" | "));
  console.log("errores de consola:", errors.length ? errors.slice(0, 8) : "ninguno");
  await browser.close();
}
