-- 003: lecturas compactas para la web (velas en columnas, tabla diaria) y clave de Anthropic sin lectura desde el navegador.

-- velas M1 en columnas (máx. 45 días por llamada); respeta RLS (security invoker)
create or replace function public.get_bars(acc uuid, p_from bigint, p_to bigint default null) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with b as (
    select ts, o, h, l, c, sp, v from public.bars
     where account_id = acc and ts >= p_from
       and ts <= least(coalesce(p_to, 9223372036854775807), p_from + 45 * 86400)
  )
  select jsonb_build_object(
    'ts', coalesce(jsonb_agg(ts order by ts), '[]'::jsonb), 'o', coalesce(jsonb_agg(o order by ts), '[]'::jsonb),
    'h', coalesce(jsonb_agg(h order by ts), '[]'::jsonb), 'l', coalesce(jsonb_agg(l order by ts), '[]'::jsonb),
    'c', coalesce(jsonb_agg(c order by ts), '[]'::jsonb), 'sp', coalesce(jsonb_agg(sp order by ts), '[]'::jsonb),
    'v', coalesce(jsonb_agg(v order by ts), '[]'::jsonb)) from b;
$$;
revoke all on function public.get_bars(uuid, bigint, bigint) from public, anon;
grant execute on function public.get_bars(uuid, bigint, bigint) to authenticated;

-- tabla diaria (día de estrategia = hora del servidor menos el desplazamiento) anterior a p_before
create or replace function public.get_daily(acc uuid, p_shift_min int, p_before bigint) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with b as (
    select (ts - p_shift_min * 60) - ((ts - p_shift_min * 60) % 86400) as d, ts, o, h, l, c
      from public.bars where account_id = acc and ts < p_before and ts >= p_before - 400 * 86400
  ), g as (
    select d, (array_agg(o order by ts))[1] as o, max(h) as h, min(l) as l, (array_agg(c order by ts desc))[1] as c
      from b group by d
  )
  select jsonb_build_object('d', coalesce(jsonb_agg(d order by d), '[]'::jsonb), 'o', coalesce(jsonb_agg(o order by d), '[]'::jsonb),
    'h', coalesce(jsonb_agg(h order by d), '[]'::jsonb), 'l', coalesce(jsonb_agg(l order by d), '[]'::jsonb),
    'c', coalesce(jsonb_agg(c order by d), '[]'::jsonb)) from g;
$$;
revoke all on function public.get_daily(uuid, int, bigint) from public, anon;
grant execute on function public.get_daily(uuid, int, bigint) to authenticated;

-- la clave de Anthropic se guarda pero el navegador no puede leerla (solo la función del chat, con service role)
revoke select, insert, update on public.user_secrets from authenticated;
grant select (user_id, chat_model, updated_at) on public.user_secrets to authenticated;

create or replace function public.set_anthropic_key(p_key text, p_model text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  insert into public.user_secrets (user_id, anthropic_key, chat_model, updated_at)
  values (auth.uid(), nullif(trim(p_key), ''), coalesce(nullif(p_model, ''), 'claude-sonnet-5-5'), now())
  on conflict (user_id) do update set
    anthropic_key = case when p_key is null then public.user_secrets.anthropic_key else nullif(trim(p_key), '') end,
    chat_model = coalesce(nullif(p_model, ''), public.user_secrets.chat_model), updated_at = now();
  return true;
end $$;
revoke all on function public.set_anthropic_key(text, text) from public, anon;
grant execute on function public.set_anthropic_key(text, text) to authenticated;

create or replace function public.my_secrets() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('anthropic', coalesce((select anthropic_key is not null and anthropic_key <> '' from public.user_secrets where user_id = auth.uid()), false),
                            'chat_model', coalesce((select chat_model from public.user_secrets where user_id = auth.uid()), 'claude-sonnet-5-5'));
$$;
revoke all on function public.my_secrets() from public, anon;
grant execute on function public.my_secrets() to authenticated;
