-- ==============================================================================
-- Migration: 20261010_admin_token_revocation.sql
-- Title: Administrator Session Token Revocation Registry
-- Purpose: Provides persistent, cluster-wide revocation tracking for stateless
--          HMAC-signed administrator session tokens upon logout.
--
-- DO NOT EXECUTE AGAINST PRODUCTION WITHOUT REVIEW AND APPROVAL.
-- ==============================================================================

-- 1. Create admin_token_revocations table
CREATE TABLE IF NOT EXISTS public.admin_token_revocations (
    token_id VARCHAR(64) PRIMARY KEY, -- Unique token nonce or SHA-256 hash of signature
    username VARCHAR(64) NOT NULL,
    revoked_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    reason VARCHAR(255) DEFAULT 'User logout' NOT NULL
);

-- 2. Index for efficient expiry cleanup and lookups
CREATE INDEX IF NOT EXISTS idx_admin_token_revocations_expires_at 
ON public.admin_token_revocations(expires_at);

CREATE INDEX IF NOT EXISTS idx_admin_token_revocations_username 
ON public.admin_token_revocations(username);

-- 3. Enable Row-Level Security (RLS)
ALTER TABLE public.admin_token_revocations ENABLE ROW LEVEL SECURITY;

-- 4. Permissions & Policies
REVOKE ALL ON public.admin_token_revocations FROM PUBLIC;
REVOKE ALL ON public.admin_token_revocations FROM anon;
REVOKE ALL ON public.admin_token_revocations FROM authenticated;

-- Allow trusted service_role full management
DROP POLICY IF EXISTS "Allow service role full access admin_token_revocations" ON public.admin_token_revocations;
CREATE POLICY "Allow service role full access admin_token_revocations" 
ON public.admin_token_revocations FOR ALL USING (true);

-- Grant privileges strictly to trusted backend service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_token_revocations TO service_role;

-- 5. Automatic cleanup function for expired revocation records
CREATE OR REPLACE FUNCTION public.clean_expired_admin_revocations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.admin_token_revocations
    WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.clean_expired_admin_revocations() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.clean_expired_admin_revocations() FROM anon;
GRANT EXECUTE ON FUNCTION public.clean_expired_admin_revocations() TO service_role;
