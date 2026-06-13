-- Upgrade ngans.trips from legacy uid tokens to stable dispatch_entry_id::row_id refs.
-- Keep already-normalized refs intact and only resolve legacy tokens within the ngan date range.

with expanded_ngans as (
  select
    n.id as ngan_id,
    n.factory_id,
    n.ngay_bd,
    coalesce(n.ngay_kt, n.ngay_bd) as ngay_kt,
    trip_tokens.token,
    trip_tokens.ordinality
  from public.ngans n
  cross join lateral jsonb_array_elements_text(coalesce(n.trips, '[]'::jsonb)) with ordinality as trip_tokens(token, ordinality)
),
resolved_tokens as (
  select
    e.ngan_id,
    e.ordinality,
    case
      when position('::' in e.token) > 0 then e.token
      else concat(dispatch_match.dispatch_entry_id::text, '::', dispatch_match.row_id)
    end as token
  from expanded_ngans e
  left join lateral (
    select
      d.id as dispatch_entry_id,
      coalesce(row_item.value->>'row_id', row_item.value->>'uid') as row_id
    from public.dispatch_entries d
    cross join lateral jsonb_array_elements(coalesce(d.rows, '[]'::jsonb)) as row_item(value)
    where position('::' in e.token) = 0
      and d.factory_id = e.factory_id
      and nullif(trim(e.token), '') is not null
      and (row_item.value->>'uid') = e.token
      and (
        case
          when d.ngay ~ '^\d{4}-\d{2}-\d{2}$' then d.ngay::date
          when d.ngay ~ '^\d{2}/\d{2}/\d{4}$' then to_date(d.ngay, 'DD/MM/YYYY')
          else null
        end
      ) between e.ngay_bd and e.ngay_kt
    order by d.ngay, coalesce(row_item.value->>'row_id', row_item.value->>'uid')
  ) as dispatch_match on true
  where nullif(trim(e.token), '') is not null
),
deduped_tokens as (
  select
    ngan_id,
    token,
    min(ordinality) as first_ordinality
  from resolved_tokens
  where token is not null
    and token <> ''
  group by ngan_id, token
),
normalized_ngans as (
  select
    n.id as ngan_id,
    coalesce(
      jsonb_agg(to_jsonb(r.token) order by r.first_ordinality, r.token),
      '[]'::jsonb
    ) as normalized_trips
  from public.ngans n
  left join deduped_tokens r on r.ngan_id = n.id
  group by n.id
)
update public.ngans n
set trips = normalized_ngans.normalized_trips
from normalized_ngans
where n.id = normalized_ngans.ngan_id
  and coalesce(n.trips, '[]'::jsonb) <> normalized_ngans.normalized_trips;
