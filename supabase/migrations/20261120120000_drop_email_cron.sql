-- The Supabase email sender (edge function `send-emails`, scheduled by
-- 20261012150000) was removed; email is being rebuilt on a Cloudflare Worker
-- Cron Trigger. Drop the hourly job if it exists so nothing calls the deleted
-- function. The email_* schema from 20261012140000 stays: the Worker reuses it.

select cron.unschedule(jobid)
from cron.job
where jobname = 'send-emails';
