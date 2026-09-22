-- NOT YET APPLIED (2026-09-22). Keep notifications working over time.
-- Apple retires a subscription when the web app is reinstalled or sits unused,
-- and then answers 410 Gone (or 404). Without pruning we would keep pushing to
-- a dead address forever and that person would silently stop being notified.
-- The app re-registers itself whenever it is opened, so removing a dead row
-- simply lets the live one take its place.

create or replace function public.prune_dead_push_subscriptions()
returns int language plpgsql security definer set search_path = public as $$
declare r record; v_removed int := 0;
begin
  for r in
    select (res ->> 'endpoint') as endpoint, (res ->> 'status')::int as status
      from net._http_response resp
      cross join lateral jsonb_array_elements((resp.content::jsonb) -> 'results') as res
     where resp.created > now() - interval '2 days'
       and resp.content is not null
       and jsonb_typeof((resp.content::jsonb) -> 'results') = 'array'
  loop
    if r.status in (404, 410) and r.endpoint is not null then
      delete from public.web_push_subscriptions where endpoint = r.endpoint;
      if found then v_removed := v_removed + 1; end if;
    end if;
  end loop;
  return v_removed;
end; $$;
