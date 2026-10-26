-- 007b: bridge_sync llama al copiador en cada sincronización (antes de entregar las órdenes pendientes).
create or replace function public.bridge_sync(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  acc uuid;
  cmds jsonb;
  last_ts bigint;
  st jsonb;
  st_ts timestamptz;
  a jsonb;
  s jsonb;
  pos jsonb;
  prof jsonb;
  nv bigint;
  nws jsonb;
  res jsonb;
begin
  select k.account_id into acc from public.bridge_keys k
   where k.key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex');
  if acc is null then raise exception 'Clave del EA no válida' using errcode = '28000'; end if;

  -- resultados de órdenes ejecutadas
  if jsonb_typeof(p->'acks') = 'array' then
    update public.commands c set status = case when (x->>'ok')::boolean then 'done' else 'error' end,
           result = x->'result', done_at = now()
      from jsonb_array_elements(p->'acks') x
     where c.account_id = acc and c.id = (x->>'id')::bigint and c.status = 'sent';
  end if;

  if p ? 'state' then
    s := p->'state';
    a := s->'account';

    -- parte rápida: precio, equity y flotante de cada posición
    select coalesce(jsonb_object_agg(x->>'ticket', jsonb_build_object('profit', x->'profit', 'swap', x->'swap')), '{}'::jsonb),
           coalesce(jsonb_agg(x - 'profit' - 'swap'), '[]'::jsonb)
      into prof, pos
      from jsonb_array_elements(case when jsonb_typeof(s->'positions') = 'array' then s->'positions' else '[]'::jsonb end) x;

    insert into public.live (account_id, bid, ask, t, equity, balance, margin, free_margin, profit, open, updated_at)
    values (acc, (s->'tick'->>'bid')::float8, (s->'tick'->>'ask')::float8, (s->'tick'->>'time')::bigint,
            (a->>'equity')::float8, (a->>'balance')::float8, (a->>'margin')::float8, (a->>'free_margin')::float8,
            prof, (s->'market'->>'open')::boolean, now())
    on conflict (account_id) do update set bid = excluded.bid, ask = excluded.ask, t = excluded.t,
      equity = excluded.equity, balance = excluded.balance, margin = excluded.margin, free_margin = excluded.free_margin,
      profit = excluded.profit, open = excluded.open, updated_at = now();

    -- parte lenta: solo se escribe (y se emite por tiempo real) cuando cambia
    update public.account_state x set updated_at = now(),
      tick = s->'tick',
      account = a - 'equity' - 'margin' - 'free_margin',
      positions = pos,
      orders = s->'orders',
      strategies = s->'strategies',
      risk = (s->'risk') - 'daily_dd_pct' - 'max_dd_pct' - 'progress_pct' - 'factor',
      market = (s->'market') - 'last_tick',
      ea = (s->'ea') - 'server_time'
     where x.account_id = acc
       and (x.account, x.positions, x.orders, x.strategies, x.risk, x.market, x.ea) is distinct from
           (a - 'equity' - 'margin' - 'free_margin', pos, s->'orders', s->'strategies',
            (s->'risk') - 'daily_dd_pct' - 'max_dd_pct' - 'progress_pct' - 'factor',
            (s->'market') - 'last_tick', (s->'ea') - 'server_time');

    if a is not null then
      update public.accounts set login = (a->>'login')::bigint, server = a->>'server', symbol = s->'ea'->>'symbol'
       where id = acc and (login is distinct from (a->>'login')::bigint or server is distinct from a->>'server'
                           or symbol is distinct from s->'ea'->>'symbol');
    end if;
  end if;

  -- velas M1 cerradas: [[ts, o, h, l, c, sp, v], ...]
  if jsonb_typeof(p->'bars') = 'array' and jsonb_array_length(p->'bars') > 0 then
    insert into public.bars (account_id, ts, o, h, l, c, sp, v)
      select acc, (b->>0)::bigint, (b->>1)::float8, (b->>2)::float8, (b->>3)::float8, (b->>4)::float8,
             coalesce((b->>5)::float4, 0.1), coalesce((b->>6)::float4, 0)
        from jsonb_array_elements(p->'bars') b
      on conflict (account_id, ts) do update set o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c,
        sp = excluded.sp, v = excluded.v;
  end if;

  -- operaciones (abiertas o cerradas)
  if jsonb_typeof(p->'trades') = 'array' then
    insert into public.trades (account_id, ticket, source, strategy, magic, side, lots, entry, sl0, tp0, sl, tp,
                               t_open, exit, t_close, pnl, r, reason, status, updated_at)
      select distinct on ((t->>'ticket')::bigint)
             acc, (t->>'ticket')::bigint, t->>'source', t->>'strategy', (t->>'magic')::bigint, (t->>'side')::int,
             (t->>'lots')::float8, (t->>'entry')::float8, (t->>'sl0')::float8, (t->>'tp0')::float8,
             (t->>'sl')::float8, (t->>'tp')::float8, (t->>'t_open')::bigint, (t->>'exit')::float8,
             (t->>'t_close')::bigint, (t->>'pnl')::float8, (t->>'r')::float8, t->>'reason', t->>'status', now()
        from jsonb_array_elements(p->'trades') t
       order by (t->>'ticket')::bigint, (t->>'status' = 'cerrada') desc
      on conflict (account_id, ticket) do update set
        lots = excluded.lots,
        sl = coalesce(excluded.sl, case when excluded.status = 'cerrada' then public.trades.sl end),
        tp = coalesce(excluded.tp, case when excluded.status = 'cerrada' then public.trades.tp end),
        sl0 = coalesce(public.trades.sl0, excluded.sl0), tp0 = coalesce(public.trades.tp0, excluded.tp0),
        exit = excluded.exit, t_close = excluded.t_close, pnl = excluded.pnl, r = excluded.r,
        reason = excluded.reason, status = excluded.status, updated_at = now()
      where not (public.trades.status = 'cerrada' and excluded.status = 'abierta')
        and (public.trades.status, public.trades.sl, public.trades.tp, public.trades.lots, public.trades.pnl)
            is distinct from (excluded.status, excluded.sl, excluded.tp, excluded.lots, excluded.pnl);
  end if;

  -- registro
  if jsonb_typeof(p->'events') = 'array' then
    insert into public.events (account_id, level, msg)
      select acc, coalesce(e->>'level', 'info'), left(e->>'msg', 1000) from jsonb_array_elements(p->'events') e
       where coalesce(e->>'msg', '') <> '';
    delete from public.events where account_id = acc and t < now() - interval '30 days';
  end if;

  -- copiador: órdenes para seguir a las cuentas que copia esta cuenta (si las hay)
  if p ? 'state' then
    perform private.copy_sync(acc);
  end if;

  -- órdenes caducadas y pendientes
  update public.commands set status = 'expired', done_at = now()
   where account_id = acc and status = 'pending' and created_at < now() - interval '20 seconds';
  -- limpieza ocasional de órdenes antiguas
  if random() < 0.002 then
    delete from public.commands where account_id = acc and created_at < now() - interval '30 days';
  end if;
  with picked as (
    update public.commands set status = 'sent'
     where account_id = acc and status = 'pending'
    returning id, type, payload, created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'type', type, 'payload', payload) order by id), '[]'::jsonb)
    into cmds from picked;

  select max(ts) into last_ts from public.bars where account_id = acc;
  select x.data, x.updated_at into st, st_ts from public.settings x where x.account_id = acc;

  res := jsonb_build_object('commands', cmds, 'last_bar', coalesce(last_ts, 0),
                            'settings', st, 'settings_ts', (extract(epoch from st_ts) * 1000)::bigint);

  -- calendario económico (USD, impacto alto y medio) solo cuando cambia
  select coalesce((extract(epoch from max(n.updated_at)) * 1000)::bigint, 0) into nv from public.news n;
  if p ? 'news_ver' and nv > coalesce((p->>'news_ver')::bigint, 0) then
    select coalesce(jsonb_agg(jsonb_build_array(n.ts, case n.impact when 'High' then 3 when 'Medium' then 2 else 1 end, left(n.title, 60)) order by n.ts), '[]'::jsonb)
      into nws from public.news n
     where n.country = 'USD' and n.impact in ('High', 'Medium')
       and n.ts between extract(epoch from now())::bigint - 7200 and extract(epoch from now())::bigint + 8 * 86400;
    res := res || jsonb_build_object('news', nws, 'news_ver', nv);
  end if;
  return res;
end $$;
revoke all on function public.bridge_sync(text, jsonb) from public, authenticated;
grant execute on function public.bridge_sync(text, jsonb) to anon;

