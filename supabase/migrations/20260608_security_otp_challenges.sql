CREATE TABLE IF NOT EXISTS public.security_otp_challenges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('change_pin', 'change_signature', 'change_password')),
  recipient_email TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_otp_challenges_user_action
  ON public.security_otp_challenges(user_id, action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_otp_challenges_expires
  ON public.security_otp_challenges(expires_at);

ALTER TABLE public.security_otp_challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "security_otp_challenges deny all" ON public.security_otp_challenges;
CREATE POLICY "security_otp_challenges deny all"
ON public.security_otp_challenges
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);
