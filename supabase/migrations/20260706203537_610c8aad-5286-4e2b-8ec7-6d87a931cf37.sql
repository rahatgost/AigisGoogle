CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Nightly at 03:15 UTC — trim login events older than 90 days.
-- Idempotent: unschedule any prior version first.
DO $$
BEGIN
  PERFORM cron.unschedule('purge-user-login-events-nightly');
EXCEPTION WHEN OTHERS THEN
  -- job didn't exist yet; ignore
  NULL;
END $$;

SELECT cron.schedule(
  'purge-user-login-events-nightly',
  '15 3 * * *',
  $$SELECT public.purge_old_login_events(90);$$
);