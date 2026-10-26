-- 007a: dibujos del gráfico (por usuario y cuenta) y copiador de operaciones entre cuentas.

-- ---------------------------------------------------------------- dibujos
create table if not exists public.drawings (
  id uuid primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('hline', 'hray', 'vline', 'trend', 'ray', 'rect', 'fib', 'text')),
  data jsonb not null check (pg_column_size(data) < 4000),
  updated_at timestamptz not null default now()
);
create index if not exists drawings_acc_user on public.drawings (account_id, user_id);
alter table public.drawings enable row level security;
create policy "mis dibujos: ver" on public.drawings for select to authenticated
  using (user_id = (select auth.uid()) and (select private.has_role(account_id, 'viewer')));
create policy "mis dibujos: crear" on public.drawings for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.has_role(account_id, 'viewer')));
create policy "mis dibujos: cambiar" on public.drawings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and (select private.has_role(account_id, 'viewer')));
create policy "mis dibujos: borrar" on public.drawings for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.drawings from anon;
grant select, insert, update, delete on public.drawings to authenticated;

-- como mucho 300 dibujos por persona y cuenta
create or replace function private.drawings_cap() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.drawings d where d.account_id = new.account_id and d.user_id = new.user_id) >= 300 then
    raise exception 'Has llegado al máximo de 300 dibujos en esta cuenta: borra algunos';
  end if;
  return new;
end $$;
drop trigger if exists drawings_cap on public.drawings;
create trigger drawings_cap before insert on public.drawings for each row execute function private.drawings_cap();

-- ---------------------------------------------------------------- copiador
create table if not exists public.copy_links (
  id bigint generated always as identity primary key,
  master_id uuid not null references public.accounts(id) on delete cascade,
  follower_id uuid not null references public.accounts(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  lot_mode text not null default 'balance' check (lot_mode in ('balance', 'mult', 'fixed', 'risk')),
  lot_value double precision not null default 1 check (lot_value > 0 and lot_value <= 100),
  max_lots double precision not null default 5 check (max_lots >= 0.01 and max_lots <= 100),
  copy_portfolio boolean not null default true,
  copy_manual boolean not null default true,
  copy_other boolean not null default false,
  max_delay_s int not null default 120 check (max_delay_s between 10 and 3600),
  created_at timestamptz not null default now(),
  unique (master_id, follower_id),
  check (master_id <> follower_id)
);
create index if not exists copy_links_follower on public.copy_links (follower_id) where enabled;

create table if not exists public.copy_map (
  id bigint generated always as identity primary key,
  link_id bigint not null references public.copy_links(id) on delete cascade,
  master_id uuid not null,
  follower_id uuid not null,
  master_ticket bigint not null,
  follower_ticket bigint,
  cmd_id bigint,
  m_lots0 double precision,
  f_lots0 double precision,
  status text not null default 'enviada' check (status in ('enviada', 'abierta', 'cerrada', 'fallida')),
  msg text,
  last_cmd_id bigint,
  last_cmd_at timestamptz,
  last_try jsonb,
  fails int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (link_id, master_ticket)
);
create index if not exists copy_map_follower on public.copy_map (follower_id, status);

alter table public.copy_links enable row level security;
alter table public.copy_map enable row level security;
create policy "ver copiadores" on public.copy_links for select to authenticated
  using ((select private.has_role(follower_id, 'viewer')) or (select private.has_role(master_id, 'owner')));
create policy "ver copias" on public.copy_map for select to authenticated
  using ((select private.has_role(follower_id, 'viewer')) or (select private.has_role(master_id, 'owner')));
revoke all on public.copy_links, public.copy_map from anon;
revoke insert, update, delete on public.copy_links, public.copy_map from authenticated;
grant select on public.copy_links, public.copy_map to authenticated;

-- crear o cambiar un copiador: hay que poder operar en la cuenta que copia y ver la cuenta copiada
create or replace function public.copy_link_save(p jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  m uuid := (p->>'master_id')::uuid;
  f uuid := (p->>'follower_id')::uuid;
  mode text := coalesce(p->>'lot_mode', 'balance');
  v float8 := coalesce((p->>'lot_value')::float8, 1);
  rid bigint;
begin
  if m is null or f is null or m = f then raise exception 'Elige otra cuenta para copiar'; end if;
  if not private.has_role(f, 'trader') then raise exception 'No puedes operar en la cuenta que copia'; end if;
  if not private.has_role(m, 'viewer') then raise exception 'No tienes acceso a la cuenta que quieres copiar'; end if;
  if mode = 'risk' and v > 3 then raise exception 'El riesgo por operación no puede pasar del 3 %%'; end if;
  if exists (select 1 from public.copy_links x where x.master_id = f and x.follower_id = m) then
    raise exception 'Esa cuenta ya copia a esta: no se pueden copiar la una a la otra';
  end if;
  insert into public.copy_links (master_id, follower_id, created_by, enabled, lot_mode, lot_value, max_lots,
                                 copy_portfolio, copy_manual, copy_other, max_delay_s)
  values (m, f, (select auth.uid()), coalesce((p->>'enabled')::boolean, true), mode, v,
          coalesce((p->>'max_lots')::float8, 5), coalesce((p->>'copy_portfolio')::boolean, true),
          coalesce((p->>'copy_manual')::boolean, true), coalesce((p->>'copy_other')::boolean, false),
          coalesce((p->>'max_delay_s')::int, 120))
  on conflict (master_id, follower_id) do update set
    enabled = excluded.enabled, lot_mode = excluded.lot_mode, lot_value = excluded.lot_value, max_lots = excluded.max_lots,
    copy_portfolio = excluded.copy_portfolio, copy_manual = excluded.copy_manual, copy_other = excluded.copy_other,
    max_delay_s = excluded.max_delay_s, created_by = excluded.created_by
  returning id into rid;
  return rid;
end $$;

create or replace function public.copy_link_delete(p_id bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.copy_links x where x.id = p_id
     and (private.has_role(x.follower_id, 'trader') or private.has_role(x.master_id, 'owner'));
  return found;
end $$;
revoke all on function public.copy_link_save(jsonb), public.copy_link_delete(bigint) from public, anon;
grant execute on function public.copy_link_save(jsonb), public.copy_link_delete(bigint) to authenticated;

-- Réplica: se ejecuta en cada sincronización del EA de la cuenta que COPIA (así solo actúa cuando ese EA está en
-- línea). Compara las operaciones abiertas de la cuenta copiada con las copias y envía las órdenes que falten:
-- abrir, mover SL/TP (misma distancia a la entrada), cierre parcial proporcional y cierre.
create or replace function private.copy_sync(acc uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  lk record; m record; mp record; f record; fl record; ml record;
  lots float8; px float8; sld float8; tpd float8; cid bigint; pl jsonb; typ text; target jsonb;
  exp_sl float8; exp_tp float8; exp_lots float8; last_st text;
  step constant float8 := 0.01;
begin
  if not exists (select 1 from public.copy_links x where x.follower_id = acc and x.enabled)
     and not exists (select 1 from public.copy_map x where x.follower_id = acc and x.status in ('enviada', 'abierta')) then
    return;
  end if;
  select * into fl from public.live where account_id = acc;
  if fl is null or fl.bid is null then return; end if;

  -- 1) resultado de las aperturas enviadas
  update public.copy_map x set
      follower_ticket = nullif(c.result->>'ticket', '')::bigint,
      f_lots0 = nullif(c.result->>'lots', '')::float8,
      status = case when c.status = 'done' and nullif(c.result->>'ticket', '') is not null then 'abierta' else 'fallida' end,
      msg = case when c.status = 'done' then null
                 when c.status = 'expired' then 'caducada: el EA de esta cuenta no respondió a tiempo'
                 else left(coalesce(c.result->>'msg', 'rechazada'), 200) end,
      updated_at = now()
    from public.commands c
   where x.follower_id = acc and x.status = 'enviada' and c.id = x.cmd_id and c.status in ('done', 'error', 'expired');

  -- 2) operaciones nuevas en las cuentas copiadas
  for lk in select * from public.copy_links x where x.follower_id = acc and x.enabled loop
    select * into ml from public.live where account_id = lk.master_id;
    continue when ml is null or ml.t is null;
    for m in
      select t.* from public.trades t
       where t.account_id = lk.master_id and t.status = 'abierta'
         and coalesce(t.strategy, '') <> 'COPIA'                       -- nunca copias de copias (evita bucles)
         and ((t.source = 'estrategia' and lk.copy_portfolio) or (t.source = 'manual' and lk.copy_manual)
              or (t.source = 'otro EA' and lk.copy_other))
         and ml.t - t.t_open between -120 and lk.max_delay_s             -- solo operaciones recién abiertas
         and not exists (select 1 from public.copy_map x where x.link_id = lk.id and x.master_ticket = t.ticket)
    loop
      if coalesce(m.sl, 0) <= 0 then
        insert into public.copy_map (link_id, master_id, follower_id, master_ticket, m_lots0, status, msg)
        values (lk.id, lk.master_id, acc, m.ticket, m.lots, 'fallida', 'la operación copiada no tiene stop loss');
        continue;
      end if;
      px := case when m.side > 0 then fl.ask else fl.bid end;
      sld := abs(m.entry - m.sl);
      tpd := case when coalesce(m.tp, 0) > 0 then abs(m.tp - m.entry) else 0 end;
      lots := case lk.lot_mode
                when 'balance' then m.lots * coalesce(fl.balance, 0) / nullif(ml.balance, 0) * lk.lot_value
                when 'mult' then m.lots * lk.lot_value
                when 'fixed' then lk.lot_value
                else 0 end;
      if lk.lot_mode <> 'risk' then
        lots := greatest(step, least(lk.max_lots, floor(coalesce(lots, 0) / step + 1e-6) * step));
      end if;
      pl := jsonb_build_object('side', m.side, 'kind', 'market',
              'sl', round((px - m.side * sld)::numeric, 2), 'tp', case when tpd > 0 then round((px + m.side * tpd)::numeric, 2) else 0 end,
              'sl_dist', round(sld::numeric, 2), 'tp_dist', round(tpd::numeric, 2),
              'lots', round(lots::numeric, 2), 'max_lots', lk.max_lots,
              'comment', 'COPIA ' || m.ticket, 'copy', true);
      if lk.lot_mode = 'risk' then pl := pl || jsonb_build_object('risk_pct', lk.lot_value); end if;
      insert into public.commands (account_id, created_by, type, payload) values (acc, lk.created_by, 'open', pl) returning id into cid;
      insert into public.copy_map (link_id, master_id, follower_id, master_ticket, cmd_id, m_lots0, status, last_cmd_id, last_cmd_at)
      values (lk.id, lk.master_id, acc, m.ticket, cid, m.lots, 'enviada', cid, now());
    end loop;
  end loop;

  -- 3) seguir a la operación copiada: cierre, parcial, SL/TP
  for mp in
    select x.* from public.copy_map x
     where x.follower_id = acc and x.status = 'abierta' and x.follower_ticket is not null
       and (x.last_cmd_at is null or x.last_cmd_at < now() - interval '6 seconds')
  loop
    select * into f from public.trades t where t.account_id = acc and t.ticket = mp.follower_ticket;
    continue when f is null;                                             -- el EA aún no la ha enviado
    if f.status = 'cerrada' then
      update public.copy_map set status = 'cerrada', updated_at = now() where id = mp.id;
      continue;
    end if;
    select * into m from public.trades t where t.account_id = mp.master_id and t.ticket = mp.master_ticket;
    continue when m is null;

    -- resultado de la última orden de seguimiento
    if mp.last_cmd_id is not null then
      select c.status into last_st from public.commands c where c.id = mp.last_cmd_id;
      if last_st in ('error', 'expired') then mp.fails := mp.fails + 1;
      elsif last_st = 'done' then mp.fails := 0; end if;
    end if;

    typ := null; pl := null;
    if m.status = 'cerrada' then
      typ := 'close'; pl := jsonb_build_object('ticket', f.ticket);
    elsif coalesce(mp.m_lots0, 0) > 0 and m.lots < mp.m_lots0 - 1e-9 then
      exp_lots := floor(coalesce(mp.f_lots0, f.lots) * m.lots / mp.m_lots0 / step + 1e-6) * step;
      if f.lots - exp_lots >= step - 1e-9 then
        typ := 'close';
        pl := case when exp_lots < step then jsonb_build_object('ticket', f.ticket)
                   else jsonb_build_object('ticket', f.ticket, 'volume', round((f.lots - exp_lots)::numeric, 2)) end;
      end if;
    end if;
    if typ is null then
      exp_sl := case when coalesce(m.sl, 0) > 0 then round((f.entry + (m.sl - m.entry))::numeric, 2) else 0 end;
      exp_tp := case when coalesce(m.tp, 0) > 0 then round((f.entry + (m.tp - m.entry))::numeric, 2) else 0 end;
      if abs(coalesce(f.sl, 0) - exp_sl) > 0.05 or abs(coalesce(f.tp, 0) - exp_tp) > 0.05 then
        -- un SL o TP que ya quedó atrás del precio actual lo rechazaría el bróker: se espera al cierre de la copiada
        if not ((f.side > 0 and ((exp_sl > 0 and exp_sl >= fl.bid) or (exp_tp > 0 and exp_tp <= fl.bid)))
             or (f.side < 0 and ((exp_sl > 0 and exp_sl <= fl.ask) or (exp_tp > 0 and exp_tp >= fl.ask)))) then
          typ := 'modify'; pl := jsonb_build_object('ticket', f.ticket, 'sl', exp_sl, 'tp', exp_tp);
        end if;
      end if;
    end if;

    if typ is null then
      if mp.fails <> 0 then update public.copy_map set fails = 0 where id = mp.id; end if;
      continue;
    end if;
    target := jsonb_build_object('type', typ, 'payload', pl);
    if mp.fails >= 3 and mp.last_try = target then
      -- tres intentos fallidos con la misma orden: no se insiste hasta que cambie algo
      update public.copy_map set msg = 'no se pudo replicar el último cambio', updated_at = now()
       where id = mp.id and msg is distinct from 'no se pudo replicar el último cambio';
      continue;
    end if;
    cid := null;
    insert into public.commands (account_id, created_by, type, payload)
      select acc, l.created_by, typ, pl from public.copy_links l where l.id = mp.link_id
      returning id into cid;
    continue when cid is null;
    update public.copy_map set last_cmd_id = cid, last_cmd_at = now(), last_try = target,
           fails = case when mp.last_try is distinct from target then 0 else mp.fails end, updated_at = now()
     where id = mp.id;
  end loop;
end $$;
revoke all on function private.copy_sync(uuid) from public, anon, authenticated;
