-- XAU Portfolio AI (web): cuentas MT5, miembros e invitaciones, estado en vivo, velas, órdenes, diario, chat.
-- Todas las tablas expuestas tienen RLS. El EA puente solo escribe a través de public.bridge_sync (clave por cuenta).

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------- cuentas y permisos
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default 'Mi cuenta' check (length(name) between 1 and 80),
  login bigint,
  server text,
  symbol text,
  created_at timestamptz not null default now()
);

create table public.account_members (
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer', 'trader', 'owner')),
  email text,
  added_at timestamptz not null default now(),
  primary key (account_id, user_id)
);
create index on public.account_members (user_id);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  role text not null check (role in ('viewer', 'trader')),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index invites_account_email on public.invites (account_id, lower(email));

-- clave del EA puente (solo el hash; la tabla no tiene políticas: nadie la lee desde la API)
create table public.bridge_keys (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  key_hash text not null unique,
  created_at timestamptz not null default now()
);

create or replace function private.role_rank(r text) returns int language sql immutable as $$
  select case r when 'owner' then 3 when 'trader' then 2 when 'viewer' then 1 else 0 end
$$;

create or replace function private.has_role(acc uuid, min_role text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.account_members m
    where m.account_id = acc and m.user_id = (select auth.uid())
      and private.role_rank(m.role) >= private.role_rank(min_role)
  )
$$;
revoke all on function private.has_role(uuid, text) from public;
grant execute on function private.has_role(uuid, text) to authenticated;
grant execute on function private.role_rank(text) to authenticated;

-- al crear una cuenta, su creador queda como propietario
create or replace function private.account_owner_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.account_members (account_id, user_id, role, email)
  values (new.id, new.owner, 'owner', (select u.email from auth.users u where u.id = new.owner));
  insert into public.account_state (account_id) values (new.id);
  insert into public.settings (account_id, data) values (new.id, '{}'::jsonb);
  return new;
end $$;

-- ---------------------------------------------------------------- datos en vivo (los escribe el EA)
create table public.account_state (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  updated_at timestamptz,
  tick jsonb, account jsonb, positions jsonb, orders jsonb, strategies jsonb, risk jsonb, market jsonb, ea jsonb
);

create table public.bars (
  account_id uuid not null references public.accounts(id) on delete cascade,
  ts bigint not null,                 -- hora del servidor del bróker (epoch s)
  o double precision not null, h double precision not null, l double precision not null, c double precision not null,
  sp real not null default 0.1,       -- spread en precio
  v real not null default 0,
  primary key (account_id, ts)
);

create table public.events (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  t timestamptz not null default now(),
  level text not null default 'info',
  msg text not null
);
create index on public.events (account_id, t desc);

create table public.trades (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  ticket bigint not null,
  source text, strategy text, magic bigint, side int, lots double precision,
  entry double precision, sl0 double precision, tp0 double precision, sl double precision, tp double precision,
  t_open bigint, exit double precision, t_close bigint, pnl double precision, r double precision,
  reason text, status text, prediction jsonb, evaluation jsonb, note text,
  updated_at timestamptz not null default now(),
  unique (account_id, ticket)
);
create index on public.trades (account_id, t_open desc);

-- ---------------------------------------------------------------- órdenes y ajustes (los escribe la web)
create table public.commands (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null check (type in ('open', 'modify', 'close', 'cancel', 'modify_order', 'close_all', 'autotrade', 'settings', 'reset_guards', 'history')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'done', 'error', 'expired')),
  result jsonb,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index on public.commands (account_id, status, created_at);

create table public.settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create trigger account_owner_member after insert on public.accounts
  for each row execute function private.account_owner_member();

-- ---------------------------------------------------------------- por usuario
create table public.notes (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  text text not null check (length(text) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table public.chat_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index on public.chat_messages (user_id, id desc);

create table public.user_secrets (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  anthropic_key text,
  chat_model text default 'claude-sonnet-5-5',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- RLS
alter table public.accounts enable row level security;
alter table public.account_members enable row level security;
alter table public.invites enable row level security;
alter table public.bridge_keys enable row level security;
alter table public.account_state enable row level security;
alter table public.bars enable row level security;
alter table public.events enable row level security;
alter table public.trades enable row level security;
alter table public.commands enable row level security;
alter table public.settings enable row level security;
alter table public.notes enable row level security;
alter table public.chat_messages enable row level security;
alter table public.user_secrets enable row level security;

create policy "ver cuentas propias o compartidas" on public.accounts for select to authenticated
  using ((select private.has_role(id, 'viewer')));
create policy "crear cuenta propia" on public.accounts for insert to authenticated
  with check (owner = (select auth.uid()));
create policy "renombrar si es propietario" on public.accounts for update to authenticated
  using ((select private.has_role(id, 'owner'))) with check ((select private.has_role(id, 'owner')));
create policy "borrar si es propietario" on public.accounts for delete to authenticated
  using ((select private.has_role(id, 'owner')));

create policy "ver miembros" on public.account_members for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_role(account_id, 'owner')));
create policy "propietario cambia roles" on public.account_members for update to authenticated
  using ((select private.has_role(account_id, 'owner')) and role <> 'owner')
  with check ((select private.has_role(account_id, 'owner')) and role in ('viewer', 'trader'));
create policy "propietario quita miembros" on public.account_members for delete to authenticated
  using ((select private.has_role(account_id, 'owner')) and role <> 'owner');

create policy "propietario ve invitaciones" on public.invites for select to authenticated
  using ((select private.has_role(account_id, 'owner')));
create policy "propietario invita" on public.invites for insert to authenticated
  with check ((select private.has_role(account_id, 'owner')) and created_by = (select auth.uid()));
create policy "propietario borra invitaciones" on public.invites for delete to authenticated
  using ((select private.has_role(account_id, 'owner')));

create policy "ver estado" on public.account_state for select to authenticated
  using ((select private.has_role(account_id, 'viewer')));
create policy "ver velas" on public.bars for select to authenticated
  using ((select private.has_role(account_id, 'viewer')));
create policy "ver eventos" on public.events for select to authenticated
  using ((select private.has_role(account_id, 'viewer')));

create policy "ver diario" on public.trades for select to authenticated
  using ((select private.has_role(account_id, 'viewer')));
create policy "evaluar y anotar" on public.trades for update to authenticated
  using ((select private.has_role(account_id, 'trader'))) with check ((select private.has_role(account_id, 'trader')));

create policy "ver órdenes enviadas" on public.commands for select to authenticated
  using ((select private.has_role(account_id, 'viewer')));
create policy "enviar órdenes" on public.commands for insert to authenticated
  with check ((select private.has_role(account_id, 'trader')) and created_by = (select auth.uid()) and status = 'pending');

create policy "ver ajustes" on public.settings for select to authenticated
  using ((select private.has_role(account_id, 'viewer')));
create policy "cambiar ajustes" on public.settings for update to authenticated
  using ((select private.has_role(account_id, 'trader'))) with check ((select private.has_role(account_id, 'trader')));

create policy "mis notas" on public.notes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "mi chat" on public.chat_messages for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "mis claves" on public.user_secrets for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- solo lo necesario para cada rol de la API
revoke all on public.bridge_keys from anon, authenticated;
revoke insert, update, delete on public.account_state, public.bars, public.events from anon, authenticated;
revoke insert, delete on public.trades from anon, authenticated;
revoke update, delete on public.commands from anon, authenticated;
revoke insert, delete on public.settings from anon, authenticated;
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------- funciones para la web
-- reclama las invitaciones dirigidas al email del usuario (se llama al iniciar sesión)
create or replace function public.claim_invites() returns int
language plpgsql security definer set search_path = '' as $$
declare n int := 0; em text; uid uuid := auth.uid();
begin
  if uid is null then return 0; end if;
  select u.email into em from auth.users u where u.id = uid and u.email_confirmed_at is not null;
  if em is null then return 0; end if;
  insert into public.account_members (account_id, user_id, role, email)
    select i.account_id, uid, i.role, em from public.invites i where lower(i.email) = lower(em)
    on conflict (account_id, user_id) do nothing;
  get diagnostics n = row_count;
  delete from public.invites i where lower(i.email) = lower(em);
  return n;
end $$;
revoke all on function public.claim_invites() from public, anon;
grant execute on function public.claim_invites() to authenticated;

-- genera (o cambia) la clave del EA puente; se muestra una sola vez
create or replace function public.rotate_bridge_key(acc uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  if not private.has_role(acc, 'owner') then raise exception 'Solo el propietario puede generar la clave'; end if;
  k := 'xau_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.bridge_keys (account_id, key_hash) values (acc, encode(extensions.digest(k, 'sha256'), 'hex'))
    on conflict (account_id) do update set key_hash = excluded.key_hash, created_at = now();
  return k;
end $$;
revoke all on function public.rotate_bridge_key(uuid) from public, anon;
grant execute on function public.rotate_bridge_key(uuid) to authenticated;

-- ---------------------------------------------------------------- función del EA puente
-- El EA la llama cada 1-2 s con su clave. Guarda estado, velas, operaciones y eventos; devuelve las órdenes
-- pendientes (solo las de los últimos 20 s: una orden vieja nunca se ejecuta tarde).
create or replace function public.bridge_sync(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  acc uuid;
  cmds jsonb;
  last_ts bigint;
  st jsonb;
  st_ts timestamptz;
  a jsonb;
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

  -- estado en vivo
  if p ? 'state' then
    update public.account_state set updated_at = now(),
      tick = p->'state'->'tick', account = p->'state'->'account', positions = p->'state'->'positions',
      orders = p->'state'->'orders', strategies = p->'state'->'strategies', risk = p->'state'->'risk',
      market = p->'state'->'market', ea = p->'state'->'ea'
     where account_id = acc;
    a := p->'state'->'account';
    if a is not null then
      update public.accounts set login = (a->>'login')::bigint, server = a->>'server', symbol = p->'state'->'ea'->>'symbol'
       where id = acc and (login is distinct from (a->>'login')::bigint or server is distinct from a->>'server'
                           or symbol is distinct from p->'state'->'ea'->>'symbol');
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
      select acc, (t->>'ticket')::bigint, t->>'source', t->>'strategy', (t->>'magic')::bigint, (t->>'side')::int,
             (t->>'lots')::float8, (t->>'entry')::float8, (t->>'sl0')::float8, (t->>'tp0')::float8,
             (t->>'sl')::float8, (t->>'tp')::float8, (t->>'t_open')::bigint, (t->>'exit')::float8,
             (t->>'t_close')::bigint, (t->>'pnl')::float8, (t->>'r')::float8, t->>'reason', t->>'status', now()
        from jsonb_array_elements(p->'trades') t
      on conflict (account_id, ticket) do update set
        lots = excluded.lots, sl = excluded.sl, tp = excluded.tp,
        sl0 = coalesce(public.trades.sl0, excluded.sl0), tp0 = coalesce(public.trades.tp0, excluded.tp0),
        exit = excluded.exit, t_close = excluded.t_close, pnl = excluded.pnl, r = excluded.r,
        reason = excluded.reason, status = excluded.status, updated_at = now();
  end if;

  -- registro
  if jsonb_typeof(p->'events') = 'array' then
    insert into public.events (account_id, level, msg)
      select acc, coalesce(e->>'level', 'info'), left(e->>'msg', 1000) from jsonb_array_elements(p->'events') e
       where coalesce(e->>'msg', '') <> '';
    delete from public.events where account_id = acc and t < now() - interval '30 days';
  end if;

  -- órdenes caducadas y pendientes
  update public.commands set status = 'expired', done_at = now()
   where account_id = acc and status = 'pending' and created_at < now() - interval '20 seconds';
  with picked as (
    update public.commands set status = 'sent'
     where account_id = acc and status = 'pending'
    returning id, type, payload, created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'type', type, 'payload', payload) order by id), '[]'::jsonb)
    into cmds from picked;

  select max(ts) into last_ts from public.bars where account_id = acc;
  select s.data, s.updated_at into st, st_ts from public.settings s where s.account_id = acc;

  return jsonb_build_object('commands', cmds, 'last_bar', coalesce(last_ts, 0),
                            'settings', st, 'settings_ts', extract(epoch from st_ts)::bigint);
end $$;
revoke all on function public.bridge_sync(text, jsonb) from public;
grant execute on function public.bridge_sync(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- tiempo real
alter publication supabase_realtime add table public.account_state, public.commands, public.trades, public.events;

-- crear cuenta (devuelve su id); el disparador añade al creador como propietario
create or replace function public.create_account(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare acc uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  insert into public.accounts (owner, name) values (auth.uid(), coalesce(nullif(trim(p_name), ''), 'Mi cuenta'))
  returning id into acc;
  return acc;
end $$;
revoke all on function public.create_account(text) from public, anon;
grant execute on function public.create_account(text) to authenticated;
