-- ====================================================================
-- CampusAttend — Migration: 20261028_widen_attendance_challenges_device_id.sql
--
-- PURPOSE:
-- Resolve schema mismatch between public.devices.id / public.devices.key_id
-- (which are VARCHAR(128)) and public.attendance_challenges.device_id (which
-- was previously limited to VARCHAR(64)).
--
-- SAFETY & IMPACT ANALYSIS:
-- 1. In PostgreSQL (>= 9.2), widening a VARCHAR column (e.g. VARCHAR(64) to VARCHAR(128))
--    is a pure metadata catalog update (O(1) operation).
-- 2. It does NOT rewrite the table, does NOT acquire long-running exclusive locks,
--    and does NOT cause table downtime.
-- 3. It is 100% backward-compatible: existing VARCHAR(64) device identifiers continue
--    to function with zero modifications.
-- 4. Replaces atomic_verify_and_consume_attendance_challenge to explicitly accept
--    device IDs up to VARCHAR(128) and preserve the 4-argument signature with operation binding.
-- ====================================================================

-- 1. Widen device_id column on attendance_challenges
ALTER TABLE public.attendance_challenges 
    ALTER COLUMN device_id TYPE VARCHAR(128);

-- 2. Recreate atomic_verify_and_consume_attendance_challenge to explicitly support VARCHAR(128)
DROP FUNCTION IF EXISTS public.atomic_verify_and_consume_attendance_challenge(character varying, character varying, character varying);
DROP FUNCTION IF EXISTS public.atomic_verify_and_consume_attendance_challenge(character varying, character varying, character varying, character varying);
DROP FUNCTION IF EXISTS public.atomic_verify_and_consume_attendance_challenge(text, text, text);
DROP FUNCTION IF EXISTS public.atomic_verify_and_consume_attendance_challenge(text, text, text, text);

CREATE OR REPLACE FUNCTION public.atomic_verify_and_consume_attendance_challenge(
    p_challenge VARCHAR,
    p_staff_code VARCHAR,
    p_device_id VARCHAR,
    p_operation VARCHAR DEFAULT 'ATTENDANCE_PUNCH'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_row public.attendance_challenges%ROWTYPE;
    v_now TIMESTAMPTZ := pg_catalog.now();
BEGIN
    -- 1. Input sanitization: non-empty exact values required
    IF p_challenge IS NULL OR pg_catalog.btrim(p_challenge) = '' THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'CHALLENGE_MISSING', 'message', 'Challenge nonce is required.');
    END IF;

    IF p_staff_code IS NULL OR pg_catalog.btrim(p_staff_code) = '' THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'STAFF_CODE_MISSING', 'message', 'Staff identifier is required.');
    END IF;

    IF p_device_id IS NULL OR pg_catalog.btrim(p_device_id) = '' THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'DEVICE_ID_MISSING', 'message', 'Exact registered device ID is required.');
    END IF;

    IF p_operation IS NULL OR pg_catalog.btrim(p_operation) = '' THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'OPERATION_MISSING', 'message', 'Operation type is required.');
    END IF;

    -- 2. Row-level lock FOR UPDATE serializes concurrent submissions on the exact nonce
    SELECT * INTO v_row
    FROM public.attendance_challenges
    WHERE challenge = pg_catalog.btrim(p_challenge)
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'CHALLENGE_NOT_FOUND', 'message', 'Challenge nonce was not found or was forged.');
    END IF;

    -- 3. Verify single-use state
    IF v_row.status = 'CONSUMED' OR v_row.consumed_at IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'CHALLENGE_ALREADY_CONSUMED', 'message', 'Challenge nonce has already been consumed.');
    END IF;

    -- 4. Verify expiry
    IF v_now > v_row.expires_at THEN
        UPDATE public.attendance_challenges SET status = 'EXPIRED' WHERE challenge = pg_catalog.btrim(p_challenge);
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'CHALLENGE_EXPIRED', 'message', 'Challenge has expired. Fresh challenge required.');
    END IF;

    -- 5. Verify operation binding (NULL-safe comparison)
    IF v_row.operation IS DISTINCT FROM pg_catalog.btrim(p_operation) THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'CHALLENGE_OPERATION_MISMATCH', 'message', 'Challenge was issued for a different operation.');
    END IF;

    -- 6. Verify staff binding (case-insensitive, NULL-safe comparison)
    IF pg_catalog.upper(v_row.staff_code) IS DISTINCT FROM pg_catalog.upper(pg_catalog.btrim(p_staff_code)) THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'CHALLENGE_STAFF_MISMATCH', 'message', 'Challenge is bound to a different faculty account.');
    END IF;

    -- 7. Verify exact registered device binding (NULL-safe comparison)
    IF v_row.device_id IS DISTINCT FROM pg_catalog.btrim(p_device_id) THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'CHALLENGE_DEVICE_MISMATCH', 'message', 'Challenge is bound to a different registered device.');
    END IF;

    -- 8. Atomically consume challenge
    UPDATE public.attendance_challenges
    SET status = 'CONSUMED',
        consumed_at = v_now
    WHERE challenge = pg_catalog.btrim(p_challenge);

    RETURN pg_catalog.jsonb_build_object('valid', true, 'consumed_at', v_now);
END;
$$;
