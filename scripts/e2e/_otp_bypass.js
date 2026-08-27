// Shared by e2e scripts written before the OTP-gated sign-up flow existed.
// Those scripts assume account creation is instant; now it waits on a real
// emailed code. Rather than flip the project's mailer_autoconfirm setting
// (a global, security-relevant toggle), this marks just the one test email
// confirmed via direct SQL. The caller then submits any 6-digit code — it
// will fail verifyOtp, but verifySignUpCode's password-sign-in fallback
// (added 2026-08-27) picks it up because the email is now confirmed.
//
// Requires SUPABASE_ACCESS_TOKEN in the environment (see
// reference_supabase_cli_access.md — export it from ~/Projects/sage/.env).
const PROJECT_REF = 'qwsrnatikftyhlmyzwtg';

async function bypassSignupEmailConfirmation(email) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set in the environment');

  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `update auth.users set email_confirmed_at = now() where email = '${email}';`,
    }),
  });
  if (!res.ok) throw new Error(`Could not bypass email confirmation for ${email}: ${await res.text()}`);
}

module.exports = { bypassSignupEmailConfirmation };
