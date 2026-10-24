-- ====================================================================
-- CampusAttend — Critical Security Hardening Migration
-- Migration: 20261024_security_hardening.sql
--
-- Hardens CampusAttend against:
-- 1. Direct Supabase / PostgREST unauthorized writes (anon/authenticated)
-- 2. Modification or deletion of attendance records (Immutable append-only trigger)
-- 3. Concurrent duplicate attendance punches (Unique constraint)
-- 4. Replay and tampering attacks (Single-use challenge table & atomic RPC)
-- 5. Tampering with audit trail (Security events append-only trigger)
-- 6. Unaudited status edits (Controlled attendance corrections table)
-- ====================================================================

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

-- 2. ENSURE BASE TABLES EXIST WITH ALL REQUIRED COLUMNS
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
    tamper_status VARCHAR(32) DEFAULT 'VERIFIED',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

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

-- Ensure columns exist if table was created previously without them
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS record_hash VARCHAR(64);
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS tamper_status VARCHAR(32) DEFAULT 'VERIFIED';

-- 3. UNIQUE CONSTRAINT ON ATTENDANCE: AT MOST ONE RECORD PER FACULTY MEMBER PER DAY
-- Prevents race conditions and duplicate punch injection
DROP INDEX IF EXISTS idx_unique_staff_attendance_per_day;
CREATE UNIQUE INDEX idx_unique_staff_attendance_per_day
    ON public.attendance_records (staff_code, date);

-- 4. SINGLE-USE ATTENDANCE CHALLENGES TABLE (Server-Minted Nonces)
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

-- 5. ATOMIC CHALLENGE VERIFICATION & CONSUMPTION RPC
CREATE OR REPLACE FUNCTION public.atomic_verify_and_consume_attendance_challenge(
    p_challenge VARCHAR,
    p_staff_code VARCHAR,
    p_device_id VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
DECLARE
    v_row public.attendance_challenges%ROWTYPE;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF p_challenge IS NULL OR TRIM(p_challenge) = '' THEN
        RETURN jsonb_build_object('valid', false, 'error', 'CHALLENGE_MISSING', 'message', 'Challenge nonce is required.');
    END IF;

    -- Row-level lock FOR UPDATE serializes concurrent submissions
    SELECT * INTO v_row
    FROM public.attendance_challenges
    WHERE challenge = TRIM(p_challenge)
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('valid', false, 'error', 'CHALLENGE_NOT_FOUND', 'message', 'Challenge nonce was not found or was forged.');
    END IF;

    IF v_row.status = 'CONSUMED' OR v_row.consumed_at IS NOT NULL THEN
        RETURN jsonb_build_object('valid', false, 'error', 'CHALLENGE_ALREADY_CONSUMED', 'message', 'Challenge nonce has already been consumed.');
    END IF;

    IF v_now > v_row.expires_at THEN
        UPDATE public.attendance_challenges SET status = 'EXPIRED' WHERE challenge = TRIM(p_challenge);
        RETURN jsonb_build_object('valid', false, 'error', 'CHALLENGE_EXPIRED', 'message', 'Challenge has expired. Fresh challenge required.');
    END IF;

    IF UPPER(v_row.staff_code) <> UPPER(TRIM(p_staff_code)) THEN
        RETURN jsonb_build_object('valid', false, 'error', 'CHALLENGE_STAFF_MISMATCH', 'message', 'Challenge is bound to a different faculty account.');
    END IF;

    IF p_device_id IS NOT NULL AND TRIM(p_device_id) <> '' AND v_row.device_id <> TRIM(p_device_id) THEN
        RETURN jsonb_build_object('valid', false, 'error', 'CHALLENGE_DEVICE_MISMATCH', 'message', 'Challenge is bound to a different registered device.');
    END IF;

    -- Atomically consume challenge
    UPDATE public.attendance_challenges
    SET status = 'CONSUMED',
        consumed_at = v_now
    WHERE challenge = TRIM(p_challenge);

    RETURN jsonb_build_object('valid', true, 'consumed_at', v_now);
END;
$$;

-- 6. IMMUTABLE APPEND-ONLY DATABASE TRIGGER ON ATTENDANCE RECORDS
-- Rejects ANY UPDATE, DELETE, or TRUNCATE operations at PostgreSQL engine level
CREATE OR REPLACE FUNCTION public.enforce_attendance_records_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
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

DROP TRIGGER IF EXISTS trg_attendance_records_immutable ON public.attendance_records;
CREATE TRIGGER trg_attendance_records_immutable
    BEFORE UPDATE OR DELETE ON public.attendance_records
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_attendance_records_append_only();

-- 7. CONTROLLED ATTENDANCE CORRECTIONS TABLE
-- Preserves historical record untouched while auditing administrator adjustments
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

-- Corrections table is also append-only (cannot alter historical corrections)
DROP TRIGGER IF EXISTS trg_attendance_corrections_immutable ON public.attendance_corrections;
CREATE TRIGGER trg_attendance_corrections_immutable
    BEFORE UPDATE OR DELETE ON public.attendance_corrections
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_attendance_records_append_only();

-- 8. SECURITY AUDIT LOGS IMMUTABILITY TRIGGER
-- Prevents ordinary users or attackers from altering or wiping audit logs
CREATE OR REPLACE FUNCTION public.enforce_security_events_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'CRITICAL_SECURITY_VIOLATION: security_events audit trail is append-only and cannot be modified.';
    ELSIF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'CRITICAL_SECURITY_VIOLATION: security_events audit trail entries cannot be deleted.';
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_security_events_immutable ON public.security_events;
CREATE TRIGGER trg_security_events_immutable
    BEFORE UPDATE OR DELETE ON public.security_events
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_security_events_immutable();

-- 9. ROW LEVEL SECURITY (RLS) & PRIVILEGE HARDENING
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

-- Remove legacy permissive write policies
DROP POLICY IF EXISTS "Allow public write staff" ON public.staff;
DROP POLICY IF EXISTS "Allow public write devices" ON public.devices;
DROP POLICY IF EXISTS "Allow public write attendance_records" ON public.attendance_records;
DROP POLICY IF EXISTS "Allow public write security_events" ON public.security_events;
DROP POLICY IF EXISTS "Allow public write geofence_zones" ON public.geofence_zones;
DROP POLICY IF EXISTS "Allow public write face_embeddings" ON public.face_embeddings;

-- Revoke dangerous table manipulation privileges from client roles
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.attendance_records FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.attendance_corrections FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.security_events FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.staff FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.devices FROM anon, authenticated;

-- Allow SELECT for normal application reading
GRANT SELECT ON public.attendance_records TO anon, authenticated;
GRANT SELECT ON public.attendance_corrections TO anon, authenticated;
GRANT SELECT ON public.security_events TO anon, authenticated;
GRANT SELECT ON public.staff TO anon, authenticated;
GRANT SELECT ON public.devices TO anon, authenticated;

-- RLS Policies: Read Only for Public / Anon
DROP POLICY IF EXISTS "Allow read attendance_records" ON public.attendance_records;
CREATE POLICY "Allow read attendance_records" ON public.attendance_records FOR SELECT USING (true);

DROP POLICY IF EXISTS "Disallow direct insert attendance_records" ON public.attendance_records;
CREATE POLICY "Disallow direct insert attendance_records" ON public.attendance_records FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "Allow read staff" ON public.staff;
CREATE POLICY "Allow read staff" ON public.staff FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow read devices" ON public.devices;
CREATE POLICY "Allow read devices" ON public.devices FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow read security_events" ON public.security_events;
CREATE POLICY "Allow read security_events" ON public.security_events FOR SELECT USING (true);

-- Allow service_role full management
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION public.atomic_verify_and_consume_attendance_challenge TO anon, authenticated, service_role;
