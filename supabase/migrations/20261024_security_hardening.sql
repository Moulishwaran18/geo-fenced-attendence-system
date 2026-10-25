-- ====================================================================
-- CampusAttend — Production Database Security Hardening Migration
-- File: supabase/migrations/20261024_security_hardening.sql
-- Revision: 2.0 (Hardened Least-Privilege & Zero-Data-Loss Architecture)
--
-- Security Controls Enforced:
-- 1. Complete PostgREST public read/write lockout on sensitive biometric,
--    device, attendance, and audit records (least privilege).
-- 2. Immutable append-only database triggers (row-level UPDATE/DELETE prevention
--    and statement-level TRUNCATE rejection at PostgreSQL engine level).
-- 3. Atomic single-use attendance challenge nonces (row-locked FOR UPDATE,
--    with strict staff binding, exact device ID binding, and expiry checks).
-- 4. Cryptographic record hash storage with accurate historical row auditing
--    (legacy records flagged as 'UNVERIFIED_HISTORICAL', new punches 'VERIFIED').
-- 5. Non-destructive attendance corrections audit trail (original records preserved).
-- 6. One faculty–one active device partial unique constraint enforcement.
-- ====================================================================

BEGIN;

-- 1. EXTENSIONS & ROLES (Idempotent for both Supabase Cloud and local PostgreSQL)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN;
    END IF;
END
$$;

-- 2. ENSURE ALL TABLES EXIST WITH REQUISITE COLUMNS
CREATE TABLE IF NOT EXISTS public.staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_code VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    department VARCHAR(255) NOT NULL,
    designation VARCHAR(255) NOT NULL,
    phone VARCHAR(32) DEFAULT '',
    device VARCHAR(255) DEFAULT '',
    device_status VARCHAR(32) DEFAULT 'Active' CHECK (device_status IN ('Active', 'Pending', 'Blocked')),
    status VARCHAR(32) DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
    active BOOLEAN DEFAULT true NOT NULL,
    inside_campus BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Ensure columns exist if staff table pre-existed
ALTER TABLE public.staff
    ADD COLUMN IF NOT EXISTS phone VARCHAR(32) DEFAULT '',
    ADD COLUMN IF NOT EXISTS device VARCHAR(255) DEFAULT '',
    ADD COLUMN IF NOT EXISTS device_status VARCHAR(32) DEFAULT 'Active',
    ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'Active',
    ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS inside_campus BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.devices (
    id VARCHAR(64) PRIMARY KEY,
    staff_id UUID REFERENCES public.staff(id) ON DELETE SET NULL,
    staff_code VARCHAR(64),
    staff_name VARCHAR(255),
    model VARCHAR(255) NOT NULL,
    os VARCHAR(64) NOT NULL,
    status VARCHAR(32) DEFAULT 'Active' NOT NULL CHECK (status IN ('Active', 'Pending', 'Blocked', 'Revoked')),
    public_key TEXT,
    key_id VARCHAR(128),
    key_algorithm VARCHAR(64) DEFAULT 'ECDSA_P256',
    platform VARCHAR(32) DEFAULT 'android',
    attestation_status VARCHAR(64) DEFAULT 'Verified',
    attestation_type VARCHAR(64) DEFAULT 'hardware',
    attestation_evidence TEXT,
    last_verified_at TIMESTAMPTZ DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    revocation_reason TEXT,
    revoked_by VARCHAR(64),
    audit_metadata JSONB DEFAULT '{}'::jsonb,
    registered_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Ensure columns exist if devices table was previously created with base columns only
ALTER TABLE public.devices 
    ADD COLUMN IF NOT EXISTS public_key TEXT,
    ADD COLUMN IF NOT EXISTS key_id VARCHAR(128),
    ADD COLUMN IF NOT EXISTS key_algorithm VARCHAR(64) DEFAULT 'ECDSA_P256',
    ADD COLUMN IF NOT EXISTS platform VARCHAR(32) DEFAULT 'android',
    ADD COLUMN IF NOT EXISTS attestation_status VARCHAR(64) DEFAULT 'Verified',
    ADD COLUMN IF NOT EXISTS attestation_type VARCHAR(64) DEFAULT 'hardware',
    ADD COLUMN IF NOT EXISTS attestation_evidence TEXT,
    ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS revocation_reason TEXT,
    ADD COLUMN IF NOT EXISTS revoked_by VARCHAR(64),
    ADD COLUMN IF NOT EXISTS audit_metadata JSONB DEFAULT '{}'::jsonb;

-- Update devices status check constraint to include 'Revoked'
ALTER TABLE public.devices DROP CONSTRAINT IF EXISTS devices_status_check;
ALTER TABLE public.devices ADD CONSTRAINT devices_status_check 
    CHECK (status IN ('Active', 'Pending', 'Blocked', 'Revoked'));

CREATE TABLE IF NOT EXISTS public.attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_code VARCHAR(64) NOT NULL,
    staff_name VARCHAR(255) NOT NULL,
    department VARCHAR(255) NOT NULL,
    date DATE DEFAULT CURRENT_DATE NOT NULL,
    day VARCHAR(32) NOT NULL,
    time VARCHAR(32) NOT NULL,
    status VARCHAR(32) DEFAULT 'Present' NOT NULL CHECK (status IN ('Present', 'Late', 'Absent')),
    location VARCHAR(255) DEFAULT 'Main Campus',
    verification VARCHAR(32) DEFAULT 'Verified' NOT NULL CHECK (verification IN ('Verified', 'Failed', 'Manual')),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    device_id VARCHAR(64),
    record_hash VARCHAR(64),
    tamper_status VARCHAR(32) DEFAULT 'UNVERIFIED_HISTORICAL' NOT NULL CHECK (tamper_status IN ('VERIFIED', 'UNVERIFIED_HISTORICAL', 'TAMPERED')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Add integrity auditing columns to attendance_records if not present
ALTER TABLE public.attendance_records 
    ADD COLUMN IF NOT EXISTS record_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS tamper_status VARCHAR(32) DEFAULT 'UNVERIFIED_HISTORICAL';

-- Backfill any existing NULL values before enforcing NOT NULL
UPDATE public.attendance_records 
    SET tamper_status = 'UNVERIFIED_HISTORICAL' 
    WHERE tamper_status IS NULL;

ALTER TABLE public.attendance_records 
    ALTER COLUMN tamper_status SET NOT NULL;

-- Re-enforce check constraint on tamper_status
ALTER TABLE public.attendance_records DROP CONSTRAINT IF EXISTS attendance_records_tamper_status_check;
ALTER TABLE public.attendance_records ADD CONSTRAINT attendance_records_tamper_status_check 
    CHECK (tamper_status IN ('VERIFIED', 'UNVERIFIED_HISTORICAL', 'TAMPERED'));

CREATE TABLE IF NOT EXISTS public.security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    time VARCHAR(64) NOT NULL,
    staff VARCHAR(255) NOT NULL,
    event VARCHAR(255) NOT NULL,
    device VARCHAR(255) NOT NULL,
    location VARCHAR(255) NOT NULL,
    result VARCHAR(32) DEFAULT 'Blocked' NOT NULL CHECK (result IN ('Blocked', 'Allowed', 'Flagged')),
    severity VARCHAR(32) DEFAULT 'Medium' NOT NULL CHECK (severity IN ('Low', 'Medium', 'High')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Ensure columns exist if security_events table pre-existed
ALTER TABLE public.security_events
    ADD COLUMN IF NOT EXISTS time VARCHAR(64),
    ADD COLUMN IF NOT EXISTS staff VARCHAR(255),
    ADD COLUMN IF NOT EXISTS event VARCHAR(255),
    ADD COLUMN IF NOT EXISTS device VARCHAR(255),
    ADD COLUMN IF NOT EXISTS location VARCHAR(255),
    ADD COLUMN IF NOT EXISTS result VARCHAR(32) DEFAULT 'Blocked',
    ADD COLUMN IF NOT EXISTS severity VARCHAR(32) DEFAULT 'Medium',
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.attendance_challenges (
    challenge VARCHAR(64) PRIMARY KEY,
    staff_code VARCHAR(64) NOT NULL,
    device_id VARCHAR(64) NOT NULL,
    operation VARCHAR(32) DEFAULT 'ATTENDANCE_PUNCH' NOT NULL,
    issued_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    status VARCHAR(32) DEFAULT 'ACTIVE' NOT NULL CHECK (status IN ('ACTIVE', 'CONSUMED', 'EXPIRED')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attendance_challenges_staff ON public.attendance_challenges(staff_code);
CREATE INDEX IF NOT EXISTS idx_attendance_challenges_expires ON public.attendance_challenges(expires_at);

CREATE TABLE IF NOT EXISTS public.attendance_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attendance_id UUID NOT NULL REFERENCES public.attendance_records(id) ON DELETE RESTRICT,
    original_status VARCHAR(32) NOT NULL,
    corrected_status VARCHAR(32) NOT NULL CHECK (corrected_status IN ('Present', 'Late', 'Absent')),
    reason TEXT NOT NULL,
    authorized_by VARCHAR(64) NOT NULL,
    authorized_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    audit_hash VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attendance_corrections_att_id ON public.attendance_corrections(attendance_id);
CREATE INDEX IF NOT EXISTS idx_attendance_corrections_created ON public.attendance_corrections(created_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_token_revocations (
    token_id VARCHAR(64) PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    revoked_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    reason VARCHAR(255) DEFAULT 'User logout' NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_token_revocations_expires_at ON public.admin_token_revocations(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_token_revocations_username ON public.admin_token_revocations(username);

-- 3. UNIQUE CONSTRAINTS (IDEMPOTENT & PRE-CHECKED)
-- Prevents duplicate attendance punch injection per staff per day
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_staff_attendance_per_day
    ON public.attendance_records (staff_code, date);

-- Enforces at most one active registered device per faculty account
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_device_per_faculty 
    ON public.devices (staff_code) 
    WHERE (status = 'Active');

-- 4. ATOMIC CHALLENGE VERIFICATION & CONSUMPTION RPC
-- Restrict to trusted server-side execution. Strict device ID and operation binding.
-- Drop legacy 3-parameter or overloaded signatures to prevent ambiguous function resolution
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

-- Restrict RPC execution: revoke from public/client roles, grant strictly to service_role
REVOKE ALL ON FUNCTION public.atomic_verify_and_consume_attendance_challenge(VARCHAR, VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.atomic_verify_and_consume_attendance_challenge(VARCHAR, VARCHAR, VARCHAR, VARCHAR) FROM anon;
REVOKE ALL ON FUNCTION public.atomic_verify_and_consume_attendance_challenge(VARCHAR, VARCHAR, VARCHAR, VARCHAR) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_verify_and_consume_attendance_challenge(VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO service_role;

-- 5. IMMUTABLE APPEND-ONLY DATABASE TRIGGER FUNCTIONS
-- Rejects ANY UPDATE, DELETE, or TRUNCATE operations at PostgreSQL engine level.
-- NOTE ON PRIVILEGE BOUNDARIES:
-- In PostgreSQL, triggers protect tables against all standard DML queries executed
-- by application roles (including service_role, authenticated, and anon).
-- Superusers (e.g. postgres root role) retain the architectural capability to
-- execute ALTER TABLE ... DISABLE TRIGGER; this is a PostgreSQL engine-level invariant.
CREATE OR REPLACE FUNCTION public.enforce_attendance_records_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'CRITICAL_SECURITY_VIOLATION: attendance_records is immutable and append-only. UPDATE operations are strictly prohibited.';
    ELSIF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'CRITICAL_SECURITY_VIOLATION: attendance_records is immutable and append-only. DELETE operations are strictly prohibited.';
    ELSIF TG_OP = 'TRUNCATE' THEN
        RAISE EXCEPTION 'CRITICAL_SECURITY_VIOLATION: attendance_records cannot be truncated.';
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_attendance_records_append_only() FROM PUBLIC;

-- Apply Row-Level Trigger for UPDATE and DELETE
-- Drop legacy trigger names if present from prior revisions
DROP TRIGGER IF EXISTS trg_attendance_records_immutable ON public.attendance_records;
DROP TRIGGER IF EXISTS trg_attendance_records_immutable_row ON public.attendance_records;
CREATE TRIGGER trg_attendance_records_immutable_row
    BEFORE UPDATE OR DELETE ON public.attendance_records
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_attendance_records_append_only();

-- Apply Statement-Level Trigger for TRUNCATE (PostgreSQL requires FOR EACH STATEMENT for TRUNCATE)
DROP TRIGGER IF EXISTS trg_attendance_records_immutable_stmt ON public.attendance_records;
CREATE TRIGGER trg_attendance_records_immutable_stmt
    BEFORE TRUNCATE ON public.attendance_records
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.enforce_attendance_records_append_only();

-- Apply Row-Level and Statement-Level Triggers to attendance_corrections
DROP TRIGGER IF EXISTS trg_attendance_corrections_immutable ON public.attendance_corrections;
DROP TRIGGER IF EXISTS trg_attendance_corrections_immutable_row ON public.attendance_corrections;
CREATE TRIGGER trg_attendance_corrections_immutable_row
    BEFORE UPDATE OR DELETE ON public.attendance_corrections
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_attendance_records_append_only();

DROP TRIGGER IF EXISTS trg_attendance_corrections_immutable_stmt ON public.attendance_corrections;
CREATE TRIGGER trg_attendance_corrections_immutable_stmt
    BEFORE TRUNCATE ON public.attendance_corrections
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.enforce_attendance_records_append_only();

-- Apply Immutability Trigger to security_events audit trail
CREATE OR REPLACE FUNCTION public.enforce_security_events_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'CRITICAL_SECURITY_VIOLATION: security_events audit trail is append-only and cannot be modified.';
    ELSIF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'CRITICAL_SECURITY_VIOLATION: security_events audit trail entries cannot be deleted.';
    ELSIF TG_OP = 'TRUNCATE' THEN
        RAISE EXCEPTION 'CRITICAL_SECURITY_VIOLATION: security_events audit trail cannot be truncated.';
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_security_events_immutable() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_security_events_immutable ON public.security_events;
DROP TRIGGER IF EXISTS trg_security_events_immutable_row ON public.security_events;
CREATE TRIGGER trg_security_events_immutable_row
    BEFORE UPDATE OR DELETE ON public.security_events
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_security_events_immutable();

DROP TRIGGER IF EXISTS trg_security_events_immutable_stmt ON public.security_events;
CREATE TRIGGER trg_security_events_immutable_stmt
    BEFORE TRUNCATE ON public.security_events
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.enforce_security_events_immutable();

-- 6. ROW-LEVEL SECURITY & PRINCIPLE OF LEAST PRIVILEGE
-- Enable RLS across all application and security tables
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_token_revocations ENABLE ROW LEVEL SECURITY;

-- Drop legacy permissive policies (cleaning historical configurations)
DROP POLICY IF EXISTS "Allow public write staff" ON public.staff;
DROP POLICY IF EXISTS "Allow public write devices" ON public.devices;
DROP POLICY IF EXISTS "Allow public write attendance_records" ON public.attendance_records;
DROP POLICY IF EXISTS "Allow public write security_events" ON public.security_events;
DROP POLICY IF EXISTS "Allow public write geofence_zones" ON public.geofence_zones;
DROP POLICY IF EXISTS "Allow public write face_embeddings" ON public.face_embeddings;
DROP POLICY IF EXISTS "Allow public read attendance_records" ON public.attendance_records;
DROP POLICY IF EXISTS "Allow public read security_events" ON public.security_events;
DROP POLICY IF EXISTS "Allow public read devices" ON public.devices;
DROP POLICY IF EXISTS "Allow read attendance_records" ON public.attendance_records;
DROP POLICY IF EXISTS "Allow read security_events" ON public.security_events;
DROP POLICY IF EXISTS "Allow read devices" ON public.devices;
DROP POLICY IF EXISTS "Allow read staff" ON public.staff;
DROP POLICY IF EXISTS "Disallow direct insert attendance_records" ON public.attendance_records;

-- REVOKE ALL PRIVILEGES ON SENSITIVE TABLES FROM PUBLIC, ANON, AND AUTHENTICATED
-- Removes unrestricted public SELECT from attendance, challenges, audit logs, devices, revocations, and staff
REVOKE ALL ON public.attendance_records FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.attendance_corrections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.attendance_challenges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.security_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.devices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.admin_token_revocations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.staff FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Deny client access attendance_records" ON public.attendance_records;
DROP POLICY IF EXISTS "Deny client access attendance_corrections" ON public.attendance_corrections;
DROP POLICY IF EXISTS "Deny client access attendance_challenges" ON public.attendance_challenges;
DROP POLICY IF EXISTS "Deny client access security_events" ON public.security_events;
DROP POLICY IF EXISTS "Deny client access devices" ON public.devices;
DROP POLICY IF EXISTS "Deny client access admin_token_revocations" ON public.admin_token_revocations;
DROP POLICY IF EXISTS "Deny client access staff" ON public.staff;
DROP POLICY IF EXISTS "Allow scoped read active staff" ON public.staff;
DROP POLICY IF EXISTS "Service role full access attendance_records" ON public.attendance_records;
DROP POLICY IF EXISTS "Service role full access attendance_corrections" ON public.attendance_corrections;
DROP POLICY IF EXISTS "Service role full access attendance_challenges" ON public.attendance_challenges;
DROP POLICY IF EXISTS "Service role full access security_events" ON public.security_events;
DROP POLICY IF EXISTS "Service role full access devices" ON public.devices;
DROP POLICY IF EXISTS "Service role full access staff" ON public.staff;
DROP POLICY IF EXISTS "Service role full access admin_token_revocations" ON public.admin_token_revocations;

-- Explicit RLS Deny Policies for client roles on sensitive tables
CREATE POLICY "Deny client access attendance_records" ON public.attendance_records 
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE POLICY "Deny client access attendance_corrections" ON public.attendance_corrections 
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE POLICY "Deny client access attendance_challenges" ON public.attendance_challenges 
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE POLICY "Deny client access security_events" ON public.security_events 
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE POLICY "Deny client access devices" ON public.devices 
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE POLICY "Deny client access admin_token_revocations" ON public.admin_token_revocations 
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE POLICY "Deny client access staff" ON public.staff 
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- Narrowly scoped directory view: exposes ONLY non-sensitive public directory fields
-- (Strictly excludes PBKDF2 password hashes stored in 'device', personal phone, email, and UUIDs)
CREATE OR REPLACE VIEW public.staff_directory AS
SELECT staff_code, name, department, designation
FROM public.staff
WHERE active = true;

REVOKE ALL ON public.staff_directory FROM PUBLIC;
REVOKE ALL ON public.staff_directory FROM anon;
REVOKE ALL ON public.staff_directory FROM authenticated;
GRANT SELECT ON public.staff_directory TO service_role;

-- 7. GRANT LEAST-PRIVILEGE PERMISSIONS TO TRUSTED SERVICE_ROLE
-- The server-side Vercel backend authenticates via SUPABASE_SERVICE_ROLE_KEY
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.devices TO service_role;
GRANT SELECT, INSERT ON public.attendance_records TO service_role;
GRANT SELECT, INSERT ON public.attendance_corrections TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_challenges TO service_role;
GRANT SELECT, INSERT ON public.security_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_token_revocations TO service_role;

-- Service role bypass policies for RLS
CREATE POLICY "Service role full access attendance_records" ON public.attendance_records 
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access attendance_corrections" ON public.attendance_corrections 
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access attendance_challenges" ON public.attendance_challenges 
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access security_events" ON public.security_events 
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access devices" ON public.devices 
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access staff" ON public.staff 
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access admin_token_revocations" ON public.admin_token_revocations 
    FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
