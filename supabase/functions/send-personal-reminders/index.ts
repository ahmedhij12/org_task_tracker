// Runs on a schedule (set up manually in the Supabase dashboard — see the
// deployment instructions below). Finds personal tasks due in the next few
// minutes that haven't been reminded about yet, and pushes a notification
// to every device registered for that task's owner.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const REMINDER_WINDOW_MINUTES = 5;

Deno.serve(async () => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MINUTES * 60 * 1000);
  // A lookback, not a lookahead. A task's due time can pass before the run
  // that should have caught it (e.g. due at 10:03, checked by the 10:05 run
  // whose window is [10:05, 10:10]) — without a lookback, `reminder_sent_at
  // IS NULL` combined with a `due >= now` lower bound would exclude that
  // task forever, since `due` never moves and `now` only advances. The 24h
  // bound exists only so a fresh deploy doesn't dig up and blast every
  // ancient overdue task at once.
  const lookback = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const { data: dueTasks, error: tasksError } = await supabase
    .from('personal_tasks')
    .select('id, owner_id, title')
    .eq('completed', false)
    .is('reminder_sent_at', null)
    .not('due', 'is', null)
    .lte('due', windowEnd.toISOString())
    .gte('due', lookback.toISOString());

  if (tasksError) {
    return new Response(JSON.stringify({ error: tasksError.message }), { status: 500 });
  }
  if (!dueTasks || dueTasks.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
  }

  let sent = 0;
  for (const task of dueTasks) {
    const { data: tokens, error: tokensError } = await supabase
      .from('push_tokens')
      .select('expo_push_token')
      .eq('owner_id', task.owner_id);

    if (tokensError) {
      // Leave reminder_sent_at unset so this task is retried on the next run.
      continue;
    }

    if (!tokens || tokens.length === 0) {
      // No devices registered yet for this owner. Leave reminder_sent_at
      // unset so this task is picked up once they do register one, instead
      // of being permanently marked "reminded" despite never being pushed.
      continue;
    }

    try {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          tokens.map((t) => ({
            to: t.expo_push_token,
            title: 'OrgTasks reminder',
            body: task.title,
            sound: 'default',
          }))
        ),
      });
    } catch (fetchError) {
      // Expo's push endpoint is unreachable. Don't mark reminder_sent_at —
      // this task is retried next run — and don't let one bad task abort
      // the rest of the batch.
      console.error(`Push send failed for task ${task.id}:`, fetchError);
      continue;
    }

    sent += tokens.length;
    await supabase.from('personal_tasks').update({ reminder_sent_at: now.toISOString() }).eq('id', task.id);
  }

  return new Response(JSON.stringify({ sent, tasksNotified: dueTasks.length }), { status: 200 });
});
