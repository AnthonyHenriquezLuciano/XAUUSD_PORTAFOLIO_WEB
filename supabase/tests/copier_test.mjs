// Prueba local del copiador (PGlite) con un esquema mínimo equivalente al de Supabase.
// Uso: node supabase/tests/copier_test.mjs <carpeta con @electric-sql/pglite instalado> supabase/migrations/007a_drawings_copier.sql supabase/migrations/007b_bridge_sync_copier.sql
import { createRequire } from "module";
import { readFileSync } from "fs";
const require = createRequire(process.argv[2] + "/package.json");
const { PGlite } = await import(require.resolve("@electric-sql/pglite"));
const [, , , m007a, m007b] = process.argv;
const db = new PGlite();
const q = async (sql, p) => (await db.query(sql, p)).rows;
await db.exec(`
create role anon; create role authenticated;
create schema auth; create schema private; create schema extensions;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function extensions.digest(t text, alg text) returns bytea language sql as $$ select sha256(convert_to(t, 'UTF8')) $$;
create table public.accounts (id uuid primary key, owner uuid, name text, login bigint, server text, symbol text, created_at timestamptz default now());
create table public.account_members (account_id uuid, user_id uuid, role text, primary key (account_id, user_id));
create function private.role_rank(r text) returns int language sql immutable as $$ select case r when 'owner' then 3 when 'trader' then 2 when 'viewer' then 1 else 0 end $$;
create function private.has_role(acc uuid, min_role text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.account_members m where m.account_id = acc and m.user_id = (select auth.uid()) and private.role_rank(m.role) >= private.role_rank(min_role)) $$;
create table public.bridge_keys (account_id uuid primary key, key_hash text unique);
create table public.account_state (account_id uuid primary key, updated_at timestamptz, tick jsonb, account jsonb, positions jsonb, orders jsonb, strategies jsonb, risk jsonb, market jsonb, ea jsonb);
create table public.live (account_id uuid primary key, bid float8, ask float8, t bigint, equity float8, balance float8, margin float8, free_margin float8, profit jsonb default '{}', open boolean, updated_at timestamptz default now());
create table public.bars (account_id uuid, ts bigint, o float8, h float8, l float8, c float8, sp real, v real, primary key (account_id, ts));
create table public.events (id bigint generated always as identity primary key, account_id uuid, t timestamptz default now(), level text, msg text);
create table public.trades (id bigint generated always as identity primary key, account_id uuid not null, ticket bigint not null, source text, strategy text, magic bigint, side int, lots float8,
  entry float8, sl0 float8, tp0 float8, sl float8, tp float8, t_open bigint, exit float8, t_close bigint, pnl float8, r float8, reason text, status text, prediction jsonb, evaluation jsonb, note text,
  updated_at timestamptz default now(), unique (account_id, ticket));
create table public.commands (id bigint generated always as identity primary key, account_id uuid not null, created_by uuid not null default auth.uid(), type text not null, payload jsonb not null default '{}',
  status text not null default 'pending', result jsonb, created_at timestamptz not null default now(), done_at timestamptz);
create table public.settings (account_id uuid primary key, data jsonb default '{}', updated_at timestamptz default now(), updated_by uuid);
create table public.news (id text primary key, ts bigint, country text, title text, impact text, updated_at timestamptz default now());
`);
await db.exec(readFileSync(m007a, "utf8"));
await db.exec(readFileSync(m007b, "utf8"));

const U = "11111111-1111-4111-8111-111111111111", M = "aaaaaaaa-0000-4000-8000-00000000000a", F = "bbbbbbbb-0000-4000-8000-00000000000b";
await db.exec(`insert into auth.users values ('${U}');
insert into public.accounts (id, owner, name) values ('${M}', '${U}', 'Maestra'), ('${F}', '${U}', 'Seguidora');
insert into public.account_members values ('${M}', '${U}', 'owner'), ('${F}', '${U}', 'owner');
insert into public.bridge_keys values ('${F}', encode(sha256(convert_to('KEYF', 'UTF8')), 'hex')), ('${M}', encode(sha256(convert_to('KEYM', 'UTF8')), 'hex'));
insert into public.account_state (account_id) values ('${M}'), ('${F}');
insert into public.settings (account_id) values ('${M}'), ('${F}');
insert into public.live (account_id, bid, ask, t, balance) values ('${M}', 1990, 1990.2, 1000, 10000), ('${F}', 2000, 2000.2, 5000, 5000);`);

let ok = 0, bad = 0;
const check = (name, cond, extra = "") => { if (cond) { ok++; console.log("✓", name); } else { bad++; console.log("✗", name, extra); } };
const cmds = () => q(`select id, type, payload, status from public.commands where account_id = $1 order by id`, [F]);
const map = async () => (await q(`select * from public.copy_map order by id`))[0];
const sync = (acc = F) => db.exec(`select private.copy_sync('${acc}')`);
const age = () => db.exec(`update public.copy_map set last_cmd_at = now() - interval '10 seconds'`);

// permisos del alta
await db.exec(`set test.uid = '${U}'`);
const r = await q(`select public.copy_link_save($1::jsonb) as id`, [JSON.stringify({ master_id: M, follower_id: F, lot_mode: "balance", lot_value: 1, max_lots: 2 })]);
check("crear copiador", r[0].id > 0);
let loopErr = "";
try { await q(`select public.copy_link_save($1::jsonb)`, [JSON.stringify({ master_id: F, follower_id: M })]); } catch (e) { loopErr = e.message; }
check("impide copiarse la una a la otra", /no se pueden copiar/.test(loopErr), loopErr);
await db.exec(`set test.uid = '22222222-2222-4222-8222-222222222222'`);
let permErr = "";
try { await q(`select public.copy_link_save($1::jsonb)`, [JSON.stringify({ master_id: M, follower_id: F })]); } catch (e) { permErr = e.message; }
check("otra persona no puede crear copiadores en mis cuentas", /No puedes operar/.test(permErr), permErr);
await db.exec(`reset test.uid`);

// 1) operación nueva en la maestra -> orden de apertura en la seguidora
await db.exec(`insert into public.trades (account_id, ticket, source, strategy, side, lots, entry, sl, tp, t_open, status) values ('${M}', 111, 'manual', 'MANUAL', 1, 0.5, 1990, 1985, 2000, 990, 'abierta')`);
await sync();
let c = await cmds();
check("abre la copia", c.length === 1 && c[0].type === "open", JSON.stringify(c));
const pl = c[0]?.payload || {};
check("lote según balance (0,5 × 5000/10000 = 0,25)", Number(pl.lots) === 0.25, JSON.stringify(pl));
check("SL y TP a la misma distancia", Number(pl.sl_dist) === 5 && Number(pl.tp_dist) === 10 && Number(pl.sl) === 1995.2 && Number(pl.tp) === 2010.2, JSON.stringify(pl));
check("marca de copia", pl.copy === true && pl.comment === "COPIA 111");
await sync();
check("no duplica la apertura", (await cmds()).length === 1);

// 2) el EA confirma
await db.exec(`update public.commands set status = 'done', result = '{"msg":"","ticket":222,"price":2000.2,"lots":0.25}' where id = ${c[0].id}`);
await sync();
let mp = await map();
check("enlaza la copia con su ticket", mp.status === "abierta" && Number(mp.follower_ticket) === 222, JSON.stringify(mp));
await db.exec(`insert into public.trades (account_id, ticket, source, strategy, side, lots, entry, sl, tp, t_open, status) values ('${F}', 222, 'copia', 'COPIA', 1, 0.25, 2000.2, 1995.2, 2010.2, 4990, 'abierta')`);
await age(); await sync();
check("sin cambios no envía nada", (await cmds()).length === 1);

// 3) break-even en la maestra (todavía por encima del precio de la seguidora -> espera)
await db.exec(`update public.trades set sl = 1990.1 where account_id = '${M}' and ticket = 111`);
await age(); await sync();
check("no manda un SL que el bróker rechazaría", (await cmds()).length === 1);
await db.exec(`update public.live set bid = 2005, ask = 2005.2 where account_id = '${F}'`);
await age(); await sync();
c = await cmds();
check("mueve el SL a la misma distancia de su entrada (2000,3)", c.length === 2 && c[1].type === "modify" && Number(c[1].payload.sl) === 2000.3 && Number(c[1].payload.tp) === 2010.2, JSON.stringify(c[1]));
await db.exec(`update public.commands set status = 'done' where id = ${c[1].id}; update public.trades set sl = 2000.3 where account_id = '${F}' and ticket = 222`);

// 4) cierre parcial de la mitad
await db.exec(`update public.trades set lots = 0.25 where account_id = '${M}' and ticket = 111`);
await age(); await sync();
c = await cmds();
check("cierre parcial proporcional (cierra 0,13 de 0,25)", c.length === 3 && c[2].type === "close" && Number(c[2].payload.volume) === 0.13, JSON.stringify(c[2]));
await db.exec(`update public.commands set status = 'done' where id = ${c[2].id}; update public.trades set lots = 0.12 where account_id = '${F}' and ticket = 222`);
await age(); await sync();
check("tras el parcial no repite", (await cmds()).length === 3);

// 5) fallos repetidos: el TP de la maestra cambia y la seguidora lo rechaza 3 veces
await db.exec(`update public.trades set tp = 2003 where account_id = '${M}' and ticket = 111`);
for (let i = 0; i < 5; i++) {
  await age(); await sync();
  c = await cmds();
  const last = c[c.length - 1];
  if (last.status === "pending") await db.exec(`update public.commands set status = 'error', result = '{"msg":"invalid stops"}' where id = ${last.id}`);
}
c = await cmds();
const mods = c.filter((x) => x.type === "modify" && Number(x.payload.tp) === 2013.2);
check("deja de insistir tras 3 fallos", mods.length === 3, `intentos ${mods.length}`);

// 6) cierre de la maestra
await db.exec(`update public.trades set status = 'cerrada', exit = 2001 where account_id = '${M}' and ticket = 111`);
await age(); await sync();
c = await cmds();
check("cierra la copia", c[c.length - 1].type === "close" && !c[c.length - 1].payload.volume && Number(c[c.length - 1].payload.ticket) === 222, JSON.stringify(c[c.length - 1]));
await db.exec(`update public.trades set status = 'cerrada' where account_id = '${F}' and ticket = 222`);
await age(); await sync();
mp = await map();
check("la copia queda cerrada", mp.status === "cerrada");

// 7) operaciones antiguas, sin SL o de otra copia no se copian
await db.exec(`insert into public.trades (account_id, ticket, source, strategy, side, lots, entry, sl, tp, t_open, status) values
  ('${M}', 300, 'manual', 'MANUAL', -1, 0.1, 1990, 1995, 0, 500, 'abierta'),
  ('${M}', 301, 'manual', 'MANUAL', -1, 0.1, 1990, null, 0, 995, 'abierta'),
  ('${M}', 302, 'copia', 'COPIA', -1, 0.1, 1990, 1995, 0, 995, 'abierta'),
  ('${M}', 303, 'otro EA', 'EA 5', -1, 0.1, 1990, 1995, 0, 995, 'abierta')`);
const before = (await cmds()).length;
await sync();
const after = (await cmds()).length;
const m301 = (await q(`select status, msg from public.copy_map where master_ticket = 301`))[0];
check("no copia antiguas, copias ni otros EA (desmarcado)", after === before, `${before} -> ${after}`);
check("sin SL: queda registrada como no copiada", m301?.status === "fallida" && /stop loss/.test(m301.msg), JSON.stringify(m301));

// 8) riesgo %: el lote lo calcula el EA
await db.exec(`update public.copy_links set lot_mode = 'risk', lot_value = 0.5`);
await db.exec(`insert into public.trades (account_id, ticket, source, strategy, side, lots, entry, sl, tp, t_open, status) values ('${M}', 400, 'estrategia', 'AORB', -1, 1.0, 1990, 1996, 1978, 1000, 'abierta')`);
await sync();
c = await cmds();
const o4 = c[c.length - 1].payload;
check("riesgo %: lote 0 y risk_pct", c[c.length - 1].type === "open" && Number(o4.lots) === 0 && Number(o4.risk_pct) === 0.5 && Number(o4.sl) === 2011 && Number(o4.tp) === 1993, JSON.stringify(o4));

// 9) bridge_sync completo: el EA de la seguidora sincroniza y recibe la orden
await db.exec(`update public.commands set status = 'expired' where status = 'pending'`);
await db.exec(`insert into public.trades (account_id, ticket, source, strategy, side, lots, entry, sl, tp, t_open, status) values ('${M}', 500, 'manual', 'MANUAL', 1, 0.2, 1990, 1980, 0, 1000, 'abierta')`);
const res = (await q(`select public.bridge_sync('KEYF', $1::jsonb) as r`, [JSON.stringify({ state: { tick: { bid: 2005, ask: 2005.2, time: 5100 }, account: { balance: 5000, equity: 5000 }, positions: [], market: { open: true }, ea: { symbol: "XAUUSD" } } })]))[0].r;
const got = res.commands.filter((x) => x.type === "open");
check("bridge_sync entrega la orden de copia en la misma sincronización", got.length === 1 && got[0].payload.comment === "COPIA 500", JSON.stringify(res.commands));
const t0 = Date.now();
for (let i = 0; i < 50; i++) await q(`select public.bridge_sync('KEYM', $1::jsonb)`, [JSON.stringify({ state: { tick: { bid: 1990, ask: 1990.2, time: 1001 }, account: { balance: 10000 }, positions: [], market: { open: true }, ea: {} } })]);
console.log(`(50 sincronizaciones de una cuenta sin copiador: ${Date.now() - t0} ms)`);
console.log(`\n${ok} correctas, ${bad} fallidas`);
process.exit(bad ? 1 : 0);
