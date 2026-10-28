-- ====================================================================
-- CampusAttend — Production Database Migration
-- File: supabase/migrations/20261028_production_device_registration_and_challenges.sql
--
-- PURPOSE:
-- 1. Create public.attendance_challenges table for serverless durable single-use
--    challenge nonce issuance, expiry, and atomic replay protection.
-- 2. Add missing cryptographic identity and attestation columns to public.devices:
--    - public_key (TEXT)
--    - key_id (VARCHAR(128))
--    - key_algorithm (VARCHAR(64) DEFAULT 'ECDSA_P256')
--    - platform (VARCHAR(32) DEFAULT 'android')
--    - attestation_status (VARCHAR(64) DEFAULT 'Pending') -- Conservative: never assume 'Verified'
--    - attestation_type (VARCHAR(64) DEFAULT 'unknown')   -- Conservative: never assume 'hardware'
--    - attestation_evidence (JSONB DEFAULT '{}'::jsonb for native object storage)
--    - last_verified_at (TIMESTAMPTZ DEFAULT NOW())
--    - revoked_at (TIMESTAMPTZ)
--    - revocation_reason (TEXT)
--    - revoked_by (VARCHAR(64))
--    - audit_metadata (JSONB DEFAULT '{}'::jsonb)
-- 3. Update public.devices status constraint to include 'Revoked'.
-- 4. Explicitly and narrowly resolve the known test fixture duplicate:
--    - 'TEST-STAFF-RACE-MVNM04CFZ9NV' (DEV_ANDROID_82a39674b6c8a08e set to 'Revoked',
--      while keeping DEV_ANDROID_5fde1a5faaf83575 'Active').
--    - Enforce fail-closed safety assertion: strictly abort if any OTHER active device
--      duplicates exist for staff_code, public_key, or key_id.
-- 5. Enforce two-way device uniqueness:
--    - Rule 1: One faculty account <-> At most ONE active registered device
--    - Rule 2: One physical device <-> At most ONE active faculty account
-- 6. Deploy atomic_verify_and_consume_attendance_challenge stored procedure:
--    - Explicitly rejects challenges whose status is NOT ACTIVE before consumption.
--    - Returns CHALLENGE_EXPIRED if status is EXPIRED (even if expires_at is in future).
--    - Serializes concurrent punches with row-level locking (FOR UPDATE).
-- 7. Configure strict Row Level Security (RLS) and grant permissions only to service_role.
--
-- IDEMPOTENCY:
-- This script is safe to execute once or multiple times. On a second run:
-- - Extensions, tables, columns, indexes, and RPC functions are skipped or cleanly replaced.
-- - The test fixture duplicate is already 'Revoked', so 0 rows are updated.
-- - The duplicate safety assertion verifies 0 duplicates and passes cleanly.
-- ====================================================================

-- ====================================================================
-- PRE-MIGRATION VALIDATION QUERIES (Run these queries prior to execution)
-- ====================================================================
-- Validation Query 1: Check if attendance_challenges table already exists
-- SELECT to_regclass('public.attendance_challenges') AS challenges_table_exists;
--
-- Validation Query 2: Check current columns on devices table
-- SELECT column_name, data_type, is_nullable, column_default 
-- FROM information_schema.columns 
-- WHERE table_schema = 'public' AND table_name = 'devices'
-- ORDER BY ordinal_position;
--
-- Validation Query 3: Check for duplicate active devices per faculty account (Rule 1)
-- SELECT staff_code, COUNT(*) AS active_count, array_agg(id ORDER BY registered_at DESC) AS device_ids
-- FROM public.devices
-- WHERE status = 'Active' AND staff_code IS NOT NULL
-- GROUP BY staff_code
-- HAVING COUNT(*) > 1;
--
-- Validation Query 4: Check for duplicate active devices sharing the same public key (Rule 2)
-- SELECT public_key, COUNT(*) AS active_count, array_agg(id) AS device_ids, array_agg(staff_code) AS staff_codes
-- FROM public.devices
-- WHERE status = 'Active' AND public_key IS NOT NULL
-- GROUP BY public_key
-- HAVING COUNT(*) > 1;
--
-- Validation Query 5: Check for duplicate active devices sharing the same key_id (Rule 2)
-- SELECT key_id, COUNT(*) AS active_count, array_agg(id) AS device_ids, array_agg(staff_code) AS staff_codes
-- FROM public.devices
-- WHERE status = 'Active' AND key_id IS NOT NULL
-- GROUP BY key_id
-- HAVING COUNT(*) > 1;
-- ====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. EXTENSIONS (Idempotent)
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------
-- 2. CREATE public.attendance_challenges TABLE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_challenges (
    challenge VARCHAR(64) PRIMARY KEY,
    staff_code VARCHAR(64) NOT NULL,
    device_id VARCHAR(128) NOT NULL,
    operation VARCHAR(32) DEFAULT 'device_registration' NOT NULL,
    issued_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    status VARCHAR(32) DEFAULT 'ACTIVE' NOT NULL CHECK (status IN ('ACTIVE', 'CONSUMED', 'EXPIRED')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Ensure device_id is VARCHAR(128) if table already existed with VARCHAR(64)
ALTER TABLE public.attendance_challenges 
    ALTER COLUMN device_id TYPE VARCHAR(128);

-- Indices for rapid lookup and automated TTL cleanup
CREATE INDEX IF NOT EXISTS idx_attendance_challenges_staff ON public.attendance_challenges(staff_code);
CREATE INDEX IF NOT EXISTS idx_attendance_challenges_expires ON public.attendance_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_attendance_challenges_status ON public.attendance_challenges(status);

-- ---------------------------------------------------------------------
-- 3. EXTEND public.devices WITH CRYPTOGRAPHIC & ATTESTATION COLUMNS
-- ---------------------------------------------------------------------
-- Base columns existing in production:
-- (id VARCHAR PRIMARY KEY, staff_id UUID, staff_code VARCHAR, staff_name VARCHAR, model VARCHAR, os VARCHAR, status VARCHAR, registered_at TIMESTAMPTZ)

ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS public_key TEXT;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS key_id VARCHAR(128);
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS key_algorithm VARCHAR(64) DEFAULT 'ECDSA_P256';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS platform VARCHAR(32) DEFAULT 'android';

-- Conservative defaults: never assume 'Verified' or 'hardware' without cryptographic attestation proof
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS attestation_status VARCHAR(64) DEFAULT 'Pending';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS attestation_type VARCHAR(64) DEFAULT 'unknown';

-- attestation_evidence: JSONB type matches API payload objects directly (e.g. { cryptoSystem: '...', timestamp: ... })
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'devices' AND column_name = 'attestation_evidence'
    ) THEN
        ALTER TABLE public.devices ADD COLUMN attestation_evidence JSONB DEFAULT '{}'::jsonb;
    ELSE
        IF (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'devices' AND column_name = 'attestation_evidence') = 'text' THEN
            ALTER TABLE public.devices ALTER COLUMN attestation_evidence TYPE JSONB USING (
                CASE 
                    WHEN attestation_evidence IS NULL OR btrim(attestation_evidence) = '' THEN '{}'::jsonb
                    WHEN attestation_evidence ~ '^\s*[\{\[]' THEN attestation_evidence::jsonb
                    ELSE to_jsonb(attestation_evidence)
                END
            );
        END IF;
    END IF;
END $$;

ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS revocation_reason TEXT;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS revoked_by VARCHAR(64);
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS audit_metadata JSONB DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------
-- 4. UPDATE DEVICE STATUS CONSTRAINT (Support 'Revoked' State)
-- ---------------------------------------------------------------------
ALTER TABLE public.devices DROP CONSTRAINT IF EXISTS devices_status_check;
ALTER TABLE public.devices ADD CONSTRAINT devices_status_check 
    CHECK (status IN ('Active', 'Pending', 'Blocked', 'Revoked'));

-- ---------------------------------------------------------------------
-- 5. EXPLICIT NARROW RESOLUTION OF KNOWN TEST FIXTURE DUPLICATE
-- ---------------------------------------------------------------------
-- Resolves the exact historical race test duplicate for 'TEST-STAFF-RACE-MVNM04CFZ9NV'
-- by revoking the older entry DEV_ANDROID_82a39674b6c8a08e (09:12:26.589 UTC) and
-- retaining DEV_ANDROID_5fde1a5faaf83575 (09:12:26.627 UTC) as Active.
-- Strictly scoped by exact staff_code and id: ZERO legitimate faculty records are touched.
UPDATE public.devices
SET status = 'Revoked',
    revoked_at = NOW(),
    revocation_reason = 'Pre-migration resolution: superseded by DEV_ANDROID_5fde1a5faaf83575 from race test fixture',
    revoked_by = 'migration_script'
WHERE staff_code = 'TEST-STAFF-RACE-MVNM04CFZ9NV'
  AND id = 'DEV_ANDROID_82a39674b6c8a08e'
  AND status = 'Active';

-- ---------------------------------------------------------------------
-- 6. PRE-INDEX SAFETY ASSERTION (FAIL CLOSED ON ANY UNRESOLVED DUPLICATES)
-- ---------------------------------------------------------------------
-- Verifies that NO active device duplicates exist across the entire table
-- before index creation. If any duplicate exists, the transaction halts and rolls back.
DO $$
DECLARE
    v_staff_dup_count INT;
    v_staff_dup_list TEXT;
    v_pubkey_dup_count INT;
    v_pubkey_dup_list TEXT;
    v_keyid_dup_count INT;
    v_keyid_dup_list TEXT;
BEGIN
    -- 1. Check duplicate active staff_code (Rule 1)
    SELECT count(*), string_agg(staff_code || ' (' || cnt || ' active devices: ' || dev_ids || ')', E'\n  - ')
    INTO v_staff_dup_count, v_staff_dup_list
    FROM (
        SELECT staff_code, count(*) AS cnt, string_agg(id, ', ') AS dev_ids
        FROM public.devices
        WHERE status = 'Active' AND staff_code IS NOT NULL
        GROUP BY staff_code
        HAVING count(*) > 1
    ) t;

    IF v_staff_dup_count > 0 THEN
        RAISE EXCEPTION E'MIGRATION_HALTED: Found % staff account(s) with multiple active registered devices:\n  - %\n\nManual review required: resolve duplicate active devices before creating unique index idx_one_active_device_per_faculty.', v_staff_dup_count, v_staff_dup_list;
    END IF;

    -- 2. Check duplicate active public_key (Rule 2)
    SELECT count(*), string_agg(substr(public_key, 1, 32) || '... (' || cnt || ' devices: ' || dev_ids || ')', E'\n  - ')
    INTO v_pubkey_dup_count, v_pubkey_dup_list
    FROM (
        SELECT public_key, count(*) AS cnt, string_agg(id, ', ') AS dev_ids
        FROM public.devices
        WHERE status = 'Active' AND public_key IS NOT NULL
        GROUP BY public_key
        HAVING count(*) > 1
    ) t;

    IF v_pubkey_dup_count > 0 THEN
        RAISE EXCEPTION E'MIGRATION_HALTED: Found % public_key value(s) bound to multiple active devices:\n  - %\n\nManual review required: resolve duplicate active public keys before creating unique index idx_one_active_staff_per_device.', v_pubkey_dup_count, v_pubkey_dup_list;
    END IF;

    -- 3. Check duplicate active key_id (Rule 2)
    SELECT count(*), string_agg(key_id || ' (' || cnt || ' devices: ' || dev_ids || ')', E'\n  - ')
    INTO v_keyid_dup_count, v_keyid_dup_list
    FROM (
        SELECT key_id, count(*) AS cnt, string_agg(id, ', ') AS dev_ids
        FROM public.devices
        WHERE status = 'Active' AND key_id IS NOT NULL
        GROUP BY key_id
        HAVING count(*) > 1
    ) t;

    IF v_keyid_dup_count > 0 THEN
        RAISE EXCEPTION E'MIGRATION_HALTED: Found % key_id value(s) bound to multiple active devices:\n  - %\n\nManual review required: resolve duplicate active key IDs before creating unique index idx_one_active_staff_per_key_id.', v_keyid_dup_count, v_keyid_dup_list;
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- 7. ENFORCE TWO-WAY DEVICE UNIQUENESS (ONE FACULTY <-> ONE PHONE)
-- ---------------------------------------------------------------------
-- RULE 1: AT MOST ONE ACTIVE REGISTERED DEVICE PER FACULTY MEMBER
DROP INDEX IF EXISTS idx_one_active_device_per_faculty;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_device_per_faculty 
    ON public.devices (staff_code) 
    WHERE (status = 'Active');

-- RULE 2: AT MOST ONE FACULTY MEMBER PER PHYSICAL REGISTERED DEVICE
DROP INDEX IF EXISTS idx_one_active_staff_per_device;
CREATE UNIQUE INDEX idx_one_active_staff_per_device 
    ON public.devices (public_key) 
    WHERE (status = 'Active' AND public_key IS NOT NULL);

DROP INDEX IF EXISTS idx_one_active_staff_per_key_id;
CREATE UNIQUE INDEX idx_one_active_staff_per_key_id 
    ON public.devices (key_id) 
    WHERE (status = 'Active' AND key_id IS NOT NULL);

-- Performance indices
CREATE INDEX IF NOT EXISTS idx_devices_staff_code ON public.devices (staff_code);
CREATE INDEX IF NOT EXISTS idx_devices_key_id ON public.devices (key_id);
CREATE INDEX IF NOT EXISTS idx_devices_status ON public.devices (status);
CREATE INDEX IF NOT EXISTS idx_devices_registered_at ON public.devices (registered_at DESC);

-- ---------------------------------------------------------------------
-- 8. ATOMIC CHALLENGE VERIFICATION & CONSUMPTION RPC FUNCTION
-- ---------------------------------------------------------------------
-- Drops any older variations with different signatures
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
    -- 1. Input sanitization
    IF p_challenge IS NULL OR pg_catalog.btrim(p_challenge) = '' THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'CHALLENGE_MISSING', 'message', 'Challenge nonce is required.');
    END IF;

    IF p_staff_code IS NULL OR pg_catalog.btrim(p_staff_code) = '' THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'STAFF_CODE_MISSING', 'message', 'Staff identifier is required.');
    END IF;

    IF p_device_id IS NULL OR pg_catalog.btrim(p_device_id) = '' THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'DEVICE_ID_MISSING', 'message', 'Device identifier is required.');
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

    -- 3. Explicit Status Check: Reject any challenge whose status is not ACTIVE before consuming it
    IF v_row.status = 'CONSUMED' OR v_row.consumed_at IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'CHALLENGE_ALREADY_CONSUMED', 'message', 'Challenge nonce has already been consumed.');
    END IF;

    IF v_row.status = 'EXPIRED' THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'CHALLENGE_EXPIRED', 'message', 'Challenge has expired. Fresh challenge required.');
    END IF;

    IF v_row.status IS DISTINCT FROM 'ACTIVE' THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'CHALLENGE_INVALID_STATUS', 'message', 'Challenge status is not ACTIVE.');
    END IF;

    -- 4. Verify wall-clock expiry against now()
    IF v_now > v_row.expires_at THEN
        UPDATE public.attendance_challenges SET status = 'EXPIRED' WHERE challenge = pg_catalog.btrim(p_challenge);
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'CHALLENGE_EXPIRED', 'message', 'Challenge has expired. Fresh challenge required.');
    END IF;

    -- 5. Verify operation binding (case-insensitive)
    -- Registration challenges cannot be consumed for attendance punch; punch challenges cannot be consumed for registration.
    IF pg_catalog.upper(pg_catalog.btrim(v_row.operation)) IS DISTINCT FROM pg_catalog.upper(pg_catalog.btrim(p_operation)) THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'CHALLENGE_OPERATION_MISMATCH', 'message', 'Challenge was issued for a different operation.');
    END IF;

    -- 6. Verify staff binding (case-insensitive)
    IF pg_catalog.upper(v_row.staff_code) IS DISTINCT FROM pg_catalog.upper(pg_catalog.btrim(p_staff_code)) THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'CHALLENGE_STAFF_MISMATCH', 'message', 'Challenge is bound to a different faculty account.');
    END IF;

    -- 7. Verify device binding
    -- If issued for initial device registration, challenge has device_id = 'PENDING_REGISTRATION'.
    -- If issued for attendance punch, challenge is strictly bound to registered device ID.
    IF v_row.device_id IS DISTINCT FROM 'PENDING_REGISTRATION' AND v_row.device_id IS DISTINCT FROM pg_catalog.btrim(p_device_id) THEN
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

-- ---------------------------------------------------------------------
-- 9. ROW-LEVEL SECURITY & PRINCIPLE OF LEAST PRIVILEGE
-- ---------------------------------------------------------------------
-- Enable RLS
ALTER TABLE public.attendance_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

-- Revoke all client/public permissions
REVOKE ALL ON public.attendance_challenges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.devices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.atomic_verify_and_consume_attendance_challenge(VARCHAR, VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon, authenticated;

-- Grant required permissions strictly to service_role (used by serverless Vercel API via SUPABASE_SERVICE_ROLE_KEY)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_challenges TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.devices TO service_role;
GRANT EXECUTE ON FUNCTION public.atomic_verify_and_consume_attendance_challenge(VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO service_role;

-- Explicit RLS Deny Policies for anon and authenticated client roles
DROP POLICY IF EXISTS "Deny client access attendance_challenges" ON public.attendance_challenges;
CREATE POLICY "Deny client access attendance_challenges" ON public.attendance_challenges 
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "Deny client access devices" ON public.devices;
CREATE POLICY "Deny client access devices" ON public.devices 
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- Explicit RLS Service Role Bypass Policies
DROP POLICY IF EXISTS "Service role full access attendance_challenges" ON public.attendance_challenges;
CREATE POLICY "Service role full access attendance_challenges" ON public.attendance_challenges 
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access devices" ON public.devices;
CREATE POLICY "Service role full access devices" ON public.devices 
    FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;

-- ====================================================================
-- POST-MIGRATION VERIFICATION QUERIES (Run to verify clean state)
-- ====================================================================
-- 1. Verify attendance_challenges table columns:
-- SELECT column_name, data_type, character_maximum_length, is_nullable, column_default 
-- FROM information_schema.columns 
-- WHERE table_schema = 'public' AND table_name = 'attendance_challenges'
-- ORDER BY ordinal_position;

-- 2. Verify devices table columns (checking conservative defaults and jsonb attestation_evidence):
-- SELECT column_name, data_type, udt_name, is_nullable, column_default 
-- FROM information_schema.columns 
-- WHERE table_schema = 'public' AND table_name = 'devices'
-- ORDER BY ordinal_position;

-- 3. Verify unique indexes on devices table:
-- SELECT indexname, indexdef 
-- FROM pg_indexes 
-- WHERE tablename = 'devices' AND indexname IN (
--     'idx_one_active_device_per_faculty',
--     'idx_one_active_staff_per_device',
--     'idx_one_active_staff_per_key_id'
-- );

-- 4. Verify no staff member has multiple active devices:
-- SELECT staff_code, COUNT(*) 
-- FROM public.devices 
-- WHERE status = 'Active' AND staff_code IS NOT NULL 
-- GROUP BY staff_code 
-- HAVING COUNT(*) > 1;

-- 5. Verify devices status check constraint allows 'Revoked':
-- SELECT conname, pg_get_constraintdef(oid) 
-- FROM pg_constraint 
-- WHERE conrelid = 'public.devices'::regclass AND conname = 'devices_status_check';

-- 6. Test RPC compilation:
-- SELECT public.atomic_verify_and_consume_attendance_challenge('test_probe_nonce_nonexistent', 'SCT-001', 'DEV_TEST', 'ATTENDANCE_PUNCH');
