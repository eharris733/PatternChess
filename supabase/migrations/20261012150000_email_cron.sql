-- Hourly trigger for the `send-emails` edge function (see 20261012140000).
--
-- Apply this only once sending is set up — until then nothing calls the
-- function. Prerequisites:
--   1. Resend domain verified; `supabase secrets set RESEND_API_KEY=… CRON_SECRET=…`
--   2. `supabase functions deploy send-emails --no-verify-jwt`
--   3. The same CRON_SECRET stored in Vault:
--        select vault.create_secret('<CRON_SECRET>', 'email_cron_secret');
-- To pause sending: select cron.unschedule('send-emails');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'send-emails',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://ydfwppthwnlgxnntzrvg.supabase.co/functions/v1/send-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'email_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
