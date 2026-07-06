ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS theme_pref text NOT NULL DEFAULT 'system'
  CHECK (theme_pref IN ('system', 'light', 'dark'));