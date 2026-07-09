
-- Plan tier enum
DO $$ BEGIN
  CREATE TYPE public.plan_tier AS ENUM ('free', 'pro', 'family');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.subscription_status AS ENUM ('active','trialing','past_due','canceled','incomplete','incomplete_expired','unpaid','paused');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Subscriptions table
CREATE TABLE IF NOT EXISTS public.subscriptions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  tier public.plan_tier NOT NULL DEFAULT 'free',
  status public.subscription_status NOT NULL DEFAULT 'active',
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  price_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own subscription" ON public.subscriptions;
CREATE POLICY "Users read own subscription"
  ON public.subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Writes are service-role only (webhook / server functions with admin).
-- No INSERT/UPDATE/DELETE policies for authenticated → blocked by RLS.

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Helper: does the user have an active paid subscription?
CREATE OR REPLACE FUNCTION public.has_active_subscription(_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = _user_id
      AND tier IN ('pro','family')
      AND status IN ('active','trialing')
      AND (current_period_end IS NULL OR current_period_end > now())
  );
$$;

-- Update vault_accounts per-user limit to be tier-aware.
CREATE OR REPLACE FUNCTION public.enforce_vault_accounts_per_user_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cnt integer;
  cap integer;
BEGIN
  SELECT count(*) INTO cnt FROM public.vault_accounts WHERE user_id = NEW.user_id;
  IF public.has_active_subscription(NEW.user_id) THEN
    cap := 500;
  ELSE
    cap := 25;
  END IF;
  IF cnt >= cap THEN
    RAISE EXCEPTION 'Vault account limit reached (% per user on current plan). Upgrade to Pro for 500.', cap
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
