-- NOT YET APPLIED (2026-09-22). Lets a signed-in person send themselves a test
-- notification, so "did it work?" has a one-tap answer instead of guesswork.
create or replace function public.send_test_push()
returns int language plpgsql security definer set search_path = public as $$
declare v_token text; v_subs jsonb; v_count int;
begin
  select value into v_token from public.app_secrets where key = 'push_token';
  if v_token is null then raise exception 'push is not configured'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth)), '[]'::jsonb),
         count(*)
    into v_subs, v_count
  from public.web_push_subscriptions where profile_id = auth.uid();

  if v_count = 0 then return 0; end if;

  perform net.http_post(
    url := 'https://bd-push.ahmedhijazi09.workers.dev',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_token),
    body := jsonb_build_object(
      'subscriptions', v_subs,
      'title', 'BD Audit',
      'body', 'Test notification — notifications are working.',
      'url', 'https://bdaudit.hijazionline.com/',
      'tag', 'test'
    )
  );
  return v_count;
end; $$;

grant execute on function public.send_test_push() to authenticated;
