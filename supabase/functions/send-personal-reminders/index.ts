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

  const { data: dueTasks, error: tasksError } = await supabase
    .from('personal_tasks')
    .select('id, owner_id, title')
    .eq('completed', false)
    .is('reminder_sent_at', null)
    .not('due', 'is', null)
    .lte('due', windowEnd.toISOString())
    .gte('due', now.toISOString());

  if (tasksError) {
    return new Response(JSON.stringify({ error: tasksError.message }), { status: 500 });
  }
  if (!dueTasks || dueTasks.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
  }

  let sent = 0;
  for (const task of dueTasks) {
    const { data: tokens } = await supabase.from('push_tokens').select('expo_push_token').eq('owner_id', task.owner_id);

    if (tokens && tokens.length > 0) {
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
      sent += tokens.length;
    }

    await supabase.from('personal_tasks').update({ reminder_sent_at: now.toISOString() }).eq('id', task.id);
  }

  return new Response(JSON.stringify({ sent, tasksNotified: dueTasks.length }), { status: 200 });
});
