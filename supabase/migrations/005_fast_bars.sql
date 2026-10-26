-- 005: las velas se leen con una sola comprobación de acceso por consulta.
-- Antes la regla RLS de "bars" se evaluaba en cada fila (175.000 filas = 24 s y el servidor cortaba la consulta).
create or replace function public.get_bars(acc uuid, p_from bigint, p_to bigint default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  if not private.has_role(acc, 'viewer') then raise exception 'Sin acceso a esta cuenta' using errcode = '42501'; end if;
  with b as (
    select ts, o, h, l, c, sp, v from public.bars
     where account_id = acc and ts >= p_from
       and ts <= least(coalesce(p_to, 9223372036854775807), p_from + 45 * 86400)
  )
  select jsonb_build_object(
    'ts', coalesce(jsonb_agg(ts order by ts), '[]'::jsonb), 'o', coalesce(jsonb_agg(o order by ts), '[]'::jsonb),
    'h', coalesce(jsonb_agg(h order by ts), '[]'::jsonb), 'l', coalesce(jsonb_agg(l order by ts), '[]'::jsonb),
    'c', coalesce(jsonb_agg(c order by ts), '[]'::jsonb), 'sp', coalesce(jsonb_agg(sp order by ts), '[]'::jsonb),
    'v', coalesce(jsonb_agg(v order by ts), '[]'::jsonb)) into r from b;
  return r;
end $$;
revoke all on function public.get_bars(uuid, bigint, bigint) from public, anon;
grant execute on function public.get_bars(uuid, bigint, bigint) to authenticated;

create or replace function public.get_daily(acc uuid, p_shift_min int, p_before bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  if not private.has_role(acc, 'viewer') then raise exception 'Sin acceso a esta cuenta' using errcode = '42501'; end if;
  with b as (
    select (ts - p_shift_min * 60) - ((ts - p_shift_min * 60) % 86400) as d, ts, o, h, l, c
      from public.bars where account_id = acc and ts < p_before and ts >= p_before - 400 * 86400
  ), g as (
    select d, (array_agg(o order by ts))[1] as o, max(h) as h, min(l) as l, (array_agg(c order by ts desc))[1] as c
      from b group by d
  )
  select jsonb_build_object('d', coalesce(jsonb_agg(d order by d), '[]'::jsonb), 'o', coalesce(jsonb_agg(o order by d), '[]'::jsonb),
    'h', coalesce(jsonb_agg(h order by d), '[]'::jsonb), 'l', coalesce(jsonb_agg(l order by d), '[]'::jsonb),
    'c', coalesce(jsonb_agg(c order by d), '[]'::jsonb)) into r from g;
  return r;
end $$;
revoke all on function public.get_daily(uuid, int, bigint) from public, anon;
grant execute on function public.get_daily(uuid, int, bigint) to authenticated;
