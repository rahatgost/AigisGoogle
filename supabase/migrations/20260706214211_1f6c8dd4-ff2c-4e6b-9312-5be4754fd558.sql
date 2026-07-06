
-- Push subscriptions: one row per browser/extension endpoint the user has
-- opted into. Endpoint is globally unique so the same physical browser
-- upserts cleanly across sign-in sessions.
CREATE TABLE public.push_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user_id_idx ON public.push_subscriptions(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own push subscriptions"
  ON public.push_subscriptions FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Push nonces: short-lived, single-use approval tokens signed with the
-- server's PUSH_NONCE_SECRET (HMAC-SHA256). The signature travels IN
-- the row so we can detect tampering even without re-reading the secret
-- (defence-in-depth against a leaked service-role key that might
-- otherwise mint arbitrary approvals silently).
CREATE TABLE public.push_nonces (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  signature TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX push_nonces_user_id_idx ON public.push_nonces(user_id);
CREATE INDEX push_nonces_expires_idx ON public.push_nonces(expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_nonces TO authenticated;
GRANT ALL ON public.push_nonces TO service_role;

ALTER TABLE public.push_nonces ENABLE ROW LEVEL SECURITY;

-- Users can read/consume their own nonces (the /approve UI needs SELECT
-- + UPDATE to mark it consumed). Creation is minting-only via a
-- security-definer server function; no client INSERT/DELETE.
CREATE POLICY "Users read own push nonces"
  ON public.push_nonces FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users consume own push nonces"
  ON public.push_nonces FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND consumed_at IS NULL AND expires_at > now())
  WITH CHECK (auth.uid() = user_id);
