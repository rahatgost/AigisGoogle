-- Phase 9.2 — Sign-in history
-- One row per successful sign-in. 90-day rolling window enforced by a
-- purge helper. Users can read only their own rows; inserts happen
-- server-side via the service-role client from recordDeviceSeen.

CREATE TABLE public.user_login_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID,
  device_label TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  coarse_country TEXT,
  coarse_region TEXT,
  event_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.user_login_events TO authenticated;
GRANT ALL ON public.user_login_events TO service_role;

ALTER TABLE public.user_login_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own login events"
  ON public.user_login_events
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_user_login_events_user_time
  ON public.user_login_events (user_id, event_at DESC);

-- Log new sign-in events to admin_audit so security-relevant activity
-- is retained beyond the 90-day user-facing window.
CREATE OR REPLACE FUNCTION public.log_user_login_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.admin_audit (actor_user_id, action, target, metadata)
  VALUES (
    NEW.user_id,
    'auth.sign_in',
    COALESCE(NEW.session_id::text, NEW.id::text),
    jsonb_build_object(
      'device_label', NEW.device_label,
      'coarse_country', NEW.coarse_country,
      'coarse_region', NEW.coarse_region,
      'event_at', NEW.event_at
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_login_events_audit
  AFTER INSERT ON public.user_login_events
  FOR EACH ROW EXECUTE FUNCTION public.log_user_login_event();

-- Rolling 90-day purge helper. Called opportunistically from the
-- heartbeat server function; can also be scheduled via pg_cron.
CREATE OR REPLACE FUNCTION public.purge_old_login_events(days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted integer;
BEGIN
  DELETE FROM public.user_login_events
   WHERE event_at < now() - make_interval(days => days);
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;