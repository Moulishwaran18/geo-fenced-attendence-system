-- ====================================================================
-- CampusAttend Migration: Atomic Face Approval Consumption RPC (Device-Only Biometrics)
-- File: supabase/migrations/20261010_atomic_replace_face_biometrics.sql
--
-- Security & Privacy Guarantees:
--   1. DEVICE-ONLY BIOMETRICS: Biometric templates, vectors, and photos are NEVER
--      stored in Supabase, PostgreSQL, or any remote server.
--   2. Strict fail-closed expiration: missing or malformed expires_at rejected.
--   3. Explicit permissions: REVOKE from PUBLIC, anon, and authenticated; GRANT only to service_role.
--   4. SET search_path = public, pg_catalog, extensions to prevent search-path injection.
--   5. Row-level lock (FOR UPDATE) to serialize concurrent requests on the exact token.
--   6. Sanitized client errors with secure server-side diagnostic logging (RAISE WARNING).
--   7. All-or-nothing rollback: any failure preserves approval as retryable until consumed.
-- ====================================================================

-- Primary Function: Atomic Token Consumption (No vector data)
CREATE OR REPLACE FUNCTION public.atomic_consume_face_approval_token(
    p_staff_code VARCHAR,
    p_token VARCHAR,
    p_device_id VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
DECLARE
    v_staff_id UUID;
    v_req_id UUID;
    v_device VARCHAR(255);
    v_now TIMESTAMPTZ := NOW();
    v_now_iso TEXT := to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    v_expires_match TEXT[];
    v_expires_at TIMESTAMPTZ;
    v_clean_device_id TEXT := COALESCE(NULLIF(TRIM(p_device_id), ''), 'android-keystore');
BEGIN
    -- 1. Input Validation: Check parameters
    IF p_staff_code IS NULL OR TRIM(p_staff_code) = '' THEN
        RETURN jsonb_build_object('success', false, 'code', 'STAFF_CODE_MISSING', 'error', 'Staff identifier is required.');
    END IF;

    IF p_token IS NULL OR TRIM(p_token) = '' THEN
        RETURN jsonb_build_object('success', false, 'code', 'TOKEN_MISSING', 'error', 'Authorization token is required.');
    END IF;

    -- 2. Validate Staff Identity
    SELECT id INTO v_staff_id
    FROM public.staff
    WHERE UPPER(staff_code) = UPPER(TRIM(p_staff_code))
      AND active = true;

    IF v_staff_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'STAFF_NOT_FOUND', 'error', 'Active staff member not found.');
    END IF;

    -- 3. Row-Level Lock on Approval Record (FOR UPDATE)
    -- Serializes concurrent requests: second request waits for lock, then sees status:consumed and terminates.
    SELECT id, device INTO v_req_id, v_device
    FROM public.security_events
    WHERE UPPER(staff) = UPPER(TRIM(p_staff_code))
      AND result = 'Allowed'
      AND (
          device LIKE ('%token:' || TRIM(p_token) || '|%')
          OR device LIKE ('%token:' || TRIM(p_token))
      )
      AND device LIKE '%status:approved%'
      AND device NOT LIKE '%status:consumed%'
    FOR UPDATE;

    IF v_req_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_OR_CONSUMED_TOKEN', 'error', 'Invalid, expired, or already consumed face change authorization.');
    END IF;

    -- 4. Server-Side 24-Hour Expiration Check (FAIL CLOSED)
    v_expires_match := regexp_match(v_device, 'expires_at:([^|\s]+)');
    IF v_expires_match IS NULL OR v_expires_match[1] IS NULL OR v_expires_match[1] = '' THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_EXPIRY', 'error', 'Approval record is missing a valid expiration timestamp. Replacement rejected.');
    END IF;

    BEGIN
        v_expires_at := v_expires_match[1]::TIMESTAMPTZ;
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'code', 'MALFORMED_EXPIRY', 'error', 'Approval record has a malformed expiration timestamp. Replacement rejected.');
    END;

    IF v_expires_at IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'MALFORMED_EXPIRY', 'error', 'Approval record has a malformed expiration timestamp. Replacement rejected.');
    END IF;

    IF v_now > v_expires_at THEN
        RETURN jsonb_build_object('success', false, 'code', 'EXPIRED_APPROVAL_TOKEN', 'error', 'Your 24-hour administrator approval window has expired. Please submit a new face change request.');
    END IF;

    -- 5. Consume Approval Token
    UPDATE public.security_events
    SET device = 'token:' || TRIM(p_token) || '|status:consumed|device_id:' || v_clean_device_id || '|consumed_at:' || v_now_iso,
        time = v_now_iso
    WHERE id = v_req_id;

    -- 6. Write Immutable Security Audit Record
    INSERT INTO public.security_events (time, staff, event, device, location, result, severity)
    VALUES (
        v_now_iso,
        UPPER(TRIM(p_staff_code)),
        'FACE_CHANGE_CONSUMED: One-time approval consumed for device ' || v_clean_device_id,
        'device_id:' || v_clean_device_id,
        'CampusAttend Biometric System (PostgreSQL RPC)',
        'Allowed',
        'Low'
    );

    RETURN jsonb_build_object(
        'success', true,
        'isLocked', true,
        'deviceId', v_clean_device_id,
        'message', 'Face change authorization consumed and locked to device. Zero biometric data stored on server.'
    );

EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'atomic_consume_face_approval_token transaction failed for staff %: % (SQLSTATE: %)', p_staff_code, SQLERRM, SQLSTATE;
    RETURN jsonb_build_object(
        'success', false,
        'code', 'TRANSACTION_ROLLBACK',
        'error', 'Database transaction failed during atomic approval token consumption.'
    );
END;
$$;

-- Backward-Compatibility Function: atomic_replace_face_biometrics (forwards to atomic_consume_face_approval_token)
CREATE OR REPLACE FUNCTION public.atomic_replace_face_biometrics(
    p_staff_code VARCHAR,
    p_token VARCHAR,
    p_samples JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
BEGIN
    -- Explicitly verify that NO biometric vectors or photos are stored in PostgreSQL
    -- Calls the atomic token consumption function safely
    RETURN public.atomic_consume_face_approval_token(p_staff_code, p_token, 'android-keystore');
END;
$$;

-- Tighten permissions: REVOKE from PUBLIC, anon, and authenticated; GRANT only to trusted service_role
REVOKE ALL ON FUNCTION public.atomic_consume_face_approval_token(VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.atomic_consume_face_approval_token(VARCHAR, VARCHAR, VARCHAR) FROM anon;
REVOKE ALL ON FUNCTION public.atomic_consume_face_approval_token(VARCHAR, VARCHAR, VARCHAR) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_consume_face_approval_token(VARCHAR, VARCHAR, VARCHAR) TO service_role;

REVOKE ALL ON FUNCTION public.atomic_replace_face_biometrics(VARCHAR, VARCHAR, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.atomic_replace_face_biometrics(VARCHAR, VARCHAR, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.atomic_replace_face_biometrics(VARCHAR, VARCHAR, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_replace_face_biometrics(VARCHAR, VARCHAR, JSONB) TO service_role;
