-- ====================================================================
-- CampusAttend Fresh — Final Production Initial SQL Migration
-- Project: https://gcpuuvhydtgmcpiumpfa.supabase.co
-- File: supabase/migrations/20261028_campusattend_fresh_initial_setup.sql
-- ====================================================================
-- ARCHITECTURE & SECURITY GUARANTEES:
--   1. Clean Bootstrap: Designed for a brand-new, empty Supabase project.
--   2. Device-Only Biometrics: Biometric templates, vectors, and face photos
--      are processed and stored strictly on user devices (Android Keystore /
--      WebCrypto). Zero cloud vector storage or face tables are created.
--   3. Zero Real Data: Zero real staff data or default admin credentials
--      are inserted.
--   4. One Faculty–One Phone: Enforces physical hardware uniqueness on
--      registered active devices (Rules 1 & 2).
--   5. Replay & Tamper Protection: Single-use serverless attendance challenges
--      and cryptographic SHA-256 HMAC record hashing.
--   6. Least Privilege & Strict RLS: All base tables and views restricted to
--      service_role. public.staff_directory view access revoked from PUBLIC,
--      anon, and authenticated (no Supabase Auth dependency); queried
--      exclusively by backend serverless APIs (/api/admin/staff) via service_role.
-- ====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- EXTENSIONS
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================================
-- SECTION 1: CORE APPLICATION TABLES
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1.1 TABLE: public.staff (Faculty Identity & Hardware Hash Binding)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_code VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    department VARCHAR(128) NOT NULL,
    designation VARCHAR(128) NOT NULL,
    phone VARCHAR(32),
    device TEXT, -- Salted PBKDF2 hash of registered hardware binding
    device_status VARCHAR(32) DEFAULT 'Pending',
    active BOOLEAN DEFAULT true NOT NULL,
    inside_campus BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_staff_staff_code ON public.staff(staff_code);
CREATE INDEX IF NOT EXISTS idx_staff_active ON public.staff(active);

-- ---------------------------------------------------------------------
-- 1.2 TABLE: public.devices (Hardware Cryptographic Identity & Attestation)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.devices (
    id VARCHAR(128) PRIMARY KEY,
    staff_id UUID REFERENCES public.staff(id) ON DELETE CASCADE,
    staff_code VARCHAR(64) NOT NULL,
    staff_name VARCHAR(255),
    model VARCHAR(128) NOT NULL,
    os VARCHAR(64) NOT NULL,
    status VARCHAR(32) DEFAULT 'Pending' NOT NULL CHECK (status IN ('Active', 'Pending', 'Blocked', 'Revoked')),
    registered_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    public_key TEXT,
    key_id VARCHAR(128),
    key_algorithm VARCHAR(64) DEFAULT 'ECDSA_P256',
    platform VARCHAR(32) DEFAULT 'android',
    attestation_status VARCHAR(64) DEFAULT 'Pending',
    attestation_type VARCHAR(64) DEFAULT 'unknown',
    attestation_evidence JSONB DEFAULT '{}'::jsonb,
    last_verified_at TIMESTAMPTZ DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    revocation_reason TEXT,
    revoked_by VARCHAR(64),
    audit_metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Enforce Two-Way Device Uniqueness (One Faculty Account <-> One Hardware Device)
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_one_active_per_staff
ON public.devices (staff_code)
WHERE status = 'Active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_unique_active_public_key
ON public.devices (public_key)
WHERE status = 'Active' AND public_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_unique_active_key_id
ON public.devices (key_id)
WHERE status = 'Active' AND key_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_devices_status ON public.devices(status);
CREATE INDEX IF NOT EXISTS idx_devices_staff_code ON public.devices(staff_code);

-- ---------------------------------------------------------------------
-- 1.3 TABLE: public.registered_devices (Staff Hardware Bindings)
-- Stores staff ID, name, department, and registered device ID
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.registered_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_code VARCHAR(64) UNIQUE NOT NULL,
    staff_name VARCHAR(255) NOT NULL,
    department VARCHAR(128) NOT NULL,
    device_id VARCHAR(128) UNIQUE NOT NULL,
    device_locked BOOLEAN NOT NULL DEFAULT true,
    is_active BOOLEAN NOT NULL DEFAULT true,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_registered_devices_staff_code ON public.registered_devices(staff_code);
CREATE INDEX IF NOT EXISTS idx_registered_devices_device_id ON public.registered_devices(device_id);
CREATE INDEX IF NOT EXISTS idx_registered_devices_is_active ON public.registered_devices(is_active);
CREATE INDEX IF NOT EXISTS idx_registered_devices_device_locked ON public.registered_devices(device_locked);

-- ---------------------------------------------------------------------
-- 1.3 TABLE: public.attendance_records (Punch Logs & Tamper Verification)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_code VARCHAR(64) NOT NULL,
    staff_name VARCHAR(255) NOT NULL,
    department VARCHAR(255) NOT NULL,
    date DATE DEFAULT CURRENT_DATE NOT NULL,
    day VARCHAR(32) NOT NULL,
    time VARCHAR(32) NOT NULL,
    status VARCHAR(32) DEFAULT 'Present' NOT NULL CHECK (status IN ('Present', 'Late', 'Absent')),
    location VARCHAR(255) DEFAULT 'Main Campus, Sona College',
    verification VARCHAR(32) DEFAULT 'Verified' NOT NULL CHECK (verification IN ('Verified', 'Failed', 'Manual')),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    device_id VARCHAR(128),
    record_hash VARCHAR(64),
    tamper_status VARCHAR(32) DEFAULT 'UNVERIFIED_HISTORICAL' NOT NULL CHECK (tamper_status IN ('VERIFIED', 'UNVERIFIED_HISTORICAL', 'TAMPERED')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uq_attendance_records_staff_date UNIQUE (staff_code, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_staff_date ON public.attendance_records(staff_code, date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_created_at ON public.attendance_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_records_date ON public.attendance_records(date DESC);

-- =====================================================================
-- SECTION 2: AUXILIARY APPLICATION TABLES
-- =====================================================================

-- ---------------------------------------------------------------------
-- 2.1 TABLE: public.attendance_challenges (Serverless Replay Protection)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_challenges (
    challenge VARCHAR(128) PRIMARY KEY,
    staff_code VARCHAR(64) NOT NULL,
    device_id VARCHAR(128) NOT NULL,
    operation VARCHAR(64) DEFAULT 'device_registration' NOT NULL,
    issued_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    status VARCHAR(32) DEFAULT 'ACTIVE' NOT NULL CHECK (status IN ('ACTIVE', 'CONSUMED', 'EXPIRED')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attendance_challenges_staff ON public.attendance_challenges(staff_code, status);
CREATE INDEX IF NOT EXISTS idx_attendance_challenges_lookup ON public.attendance_challenges(challenge, status, expires_at);

-- ---------------------------------------------------------------------
-- 2.2 TABLE: public.attendance_corrections (Discrepancy Correction Requests)
-- Matches api/attendance.ts insert payload:
-- { attendance_id, original_status, corrected_status, reason, authorized_by, audit_hash }
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attendance_id UUID REFERENCES public.attendance_records(id) ON DELETE CASCADE,
    staff_code VARCHAR(64),
    original_status VARCHAR(32) NOT NULL,
    corrected_status VARCHAR(32) NOT NULL,
    requested_status VARCHAR(32),
    reason TEXT NOT NULL,
    authorized_by VARCHAR(64),
    audit_hash VARCHAR(128),
    status VARCHAR(32) DEFAULT 'APPROVED' NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    admin_notes TEXT,
    reviewed_by VARCHAR(64),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attendance_corrections_attendance_id ON public.attendance_corrections(attendance_id);
CREATE INDEX IF NOT EXISTS idx_attendance_corrections_staff ON public.attendance_corrections(staff_code);
CREATE INDEX IF NOT EXISTS idx_attendance_corrections_status ON public.attendance_corrections(status);

-- ---------------------------------------------------------------------
-- 2.3 TABLE: public.security_events (Immutable Audit & Face Approval Log)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    time TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    staff VARCHAR(64) NOT NULL,
    event TEXT NOT NULL,
    device TEXT NOT NULL,
    location VARCHAR(255) NOT NULL,
    result VARCHAR(32) DEFAULT 'Allowed' NOT NULL CHECK (result IN ('Allowed', 'Blocked', 'Flagged', 'Pending')),
    severity VARCHAR(32) DEFAULT 'Low' NOT NULL CHECK (severity IN ('Low', 'Medium', 'High')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_security_events_staff_time ON public.security_events(staff, time DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_event ON public.security_events(event);

-- ---------------------------------------------------------------------
-- 2.4 TABLE: public.admin_users (Empty Schema — Zero Hardcoded Accounts)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_users (
    id VARCHAR(64) PRIMARY KEY,
    username VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    role VARCHAR(64) DEFAULT 'admin' NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    active BOOLEAN DEFAULT true NOT NULL,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_users_username ON public.admin_users(username);

-- ---------------------------------------------------------------------
-- 2.5 TABLE: public.admin_token_revocations (Immediate Session Revocation)
-- Matches src/server/admin-auth.ts and api/admin/staff/index.ts:
-- { token_id, username, expires_at, revoked_at, reason }
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_token_revocations (
    token_id VARCHAR(128) PRIMARY KEY, -- Unique token nonce or SHA-256 hash of signature
    token_hash VARCHAR(128),
    username VARCHAR(64) NOT NULL,
    admin_username VARCHAR(64),
    revoked_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    reason TEXT DEFAULT 'User logout' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_token_revocations_lookup ON public.admin_token_revocations(token_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_token_revocations_expires_at ON public.admin_token_revocations(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_token_revocations_username ON public.admin_token_revocations(username);

-- =====================================================================
-- SECTION 3: VIEWS
-- =====================================================================

-- ---------------------------------------------------------------------
-- 3.1 VIEW: public.staff_directory (Strict Least-Privilege Exposure)
-- Used by src/routes/admin.index.tsx for dashboard counters.
-- Explicitly excludes device hash, email, phone, and campus location.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.staff_directory WITH (security_barrier = true) AS
SELECT
    staff_code,
    name,
    department,
    designation,
    active
FROM public.staff;

-- =====================================================================
-- SECTION 4: TRIGGERS & STORED PROCEDURES
-- =====================================================================

-- ---------------------------------------------------------------------
-- 4.1 SECURITY TRIGGER: enforce_security_events_immutability
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_security_events_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_old_device_id TEXT;
    v_new_device_id TEXT;
    v_old_token TEXT;
    v_new_token TEXT;
    v_old_status_matches TEXT[];
    v_new_status_matches TEXT[];
    v_old_status TEXT;
    v_new_status TEXT;
BEGIN
    -- =========================================================================
    -- DELETE ENFORCEMENT
    -- =========================================================================
    IF TG_OP = 'DELETE' THEN
        -- Explicitly block any deletion of cancellation audit records
        IF OLD.event LIKE 'FACE_REQUEST_CANCELLED%' THEN
            RAISE EXCEPTION 'security_events cancellation audit records are permanently immutable: DELETE prohibited.';
        END IF;

        -- Allow staff cancellation ONLY for active unreviewed pending face requests (api/staff/face/index.ts /cancel-request)
        IF OLD.result = 'Flagged'
           AND OLD.event ~* '^FACE_(PERMISSION|IMAGE_APPROVAL|CHANGE|ENROLLMENT)_REQUEST'
           AND OLD.device ~ '(^|\|)status:pending(\||$)'
           AND OLD.device !~ '(^|\|)status:(approved|consumed|rejected)(\||$)' THEN

            -- Preserve permanent, immutable audit trail of the cancellation event before row removal
            INSERT INTO public.security_events (time, staff, event, device, location, result, severity)
            VALUES (
                NOW(),
                OLD.staff,
                'FACE_REQUEST_CANCELLED: Pending request (' || OLD.id || ') cancelled by staff before review',
                'status:cancelled|cancelled_request_id:' || OLD.id || '|' || OLD.device,
                OLD.location,
                'Blocked',
                'Low'
            );

            RETURN OLD;
        END IF;

        RAISE EXCEPTION 'security_events is an immutable audit log: DELETE operations are prohibited.';
    END IF;

    -- =========================================================================
    -- UPDATE ENFORCEMENT
    -- =========================================================================
    IF TG_OP = 'UPDATE' THEN
        -- 1. Invariant audit identifiers must NEVER change under any circumstances
        IF NEW.id <> OLD.id THEN
            RAISE EXCEPTION 'security_events identifier (id) cannot be modified.';
        END IF;
        IF UPPER(TRIM(NEW.staff)) <> UPPER(TRIM(OLD.staff)) THEN
            RAISE EXCEPTION 'security_events staff ownership cannot be modified.';
        END IF;
        IF NEW.event <> OLD.event THEN
            RAISE EXCEPTION 'security_events event description cannot be modified.';
        END IF;
        IF NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION 'security_events creation timestamp cannot be modified.';
        END IF;

        -- 2. Cancellation audit records are permanently immutable
        IF OLD.event LIKE 'FACE_REQUEST_CANCELLED%' THEN
            RAISE EXCEPTION 'security_events cancellation audit records are permanently immutable: UPDATE prohibited.';
        END IF;

        -- 3. Finalized requests can never be updated
        IF OLD.device ~ '(^|\|)status:consumed(\||$)' THEN
            RAISE EXCEPTION 'security_events approval token has already been consumed and is sealed against modification.';
        END IF;
        IF OLD.device ~ '(^|\|)status:rejected(\||$)' OR OLD.result = 'Blocked' THEN
            RAISE EXCEPTION 'security_events rejected request is finalized and permanently sealed against modification.';
        END IF;

        -- 4. Only active face-request records can undergo state transitions
        IF OLD.event ~* '^FACE_(PERMISSION|IMAGE_APPROVAL|CHANGE|ENROLLMENT)_REQUEST' THEN

            -- Enforce exactly one valid status marker in both OLD and NEW payloads
            SELECT ARRAY(
                SELECT m[1]
                FROM regexp_matches(OLD.device, '(?:^|\|)status:([^|]+)', 'g') AS m
            ) INTO v_old_status_matches;

            SELECT ARRAY(
                SELECT m[1]
                FROM regexp_matches(NEW.device, '(?:^|\|)status:([^|]+)', 'g') AS m
            ) INTO v_new_status_matches;

            IF cardinality(v_old_status_matches) IS NULL OR cardinality(v_old_status_matches) <> 1 THEN
                RAISE EXCEPTION 'security_events original face request contains invalid, missing, or multiple status markers.';
            END IF;

            IF cardinality(v_new_status_matches) IS NULL OR cardinality(v_new_status_matches) <> 1 THEN
                RAISE EXCEPTION 'security_events device payload must contain exactly one valid status marker.';
            END IF;

            v_old_status := v_old_status_matches[1];
            v_new_status := v_new_status_matches[1];

            -- Transition A: Admin Approval (Flagged/pending -> Allowed/approved)
            IF OLD.result = 'Flagged' AND v_old_status = 'pending'
               AND NEW.result = 'Allowed' AND v_new_status = 'approved' THEN

                -- Severity must be valid for approved request (Low or Medium)
                IF NEW.severity NOT IN ('Low', 'Medium') THEN
                    RAISE EXCEPTION 'security_events invalid severity for approved face request.';
                END IF;

                -- Extract and validate authorization token
                v_new_token := (regexp_match(NEW.device, '(?:^|\|)token:([^|]+)'))[1];
                IF v_new_token IS NULL OR TRIM(v_new_token) = '' THEN
                    RAISE EXCEPTION 'security_events approval requires non-empty authorization token.';
                END IF;
                IF v_new_token !~ '^ftok_[0-9a-zA-Z_-]{16,64}$' THEN
                    RAISE EXCEPTION 'security_events approval requires valid ftok_ authorization token format.';
                END IF;

                -- Extract and validate device binding identifier
                v_old_device_id := (regexp_match(OLD.device, '(?:^|\|)device_id:([^|]+)'))[1];
                v_new_device_id := (regexp_match(NEW.device, '(?:^|\|)device_id:([^|]+)'))[1];

                IF v_old_device_id IS NOT NULL AND TRIM(v_old_device_id) <> '' THEN
                    IF v_new_device_id IS NULL OR TRIM(v_new_device_id) = '' THEN
                        RAISE EXCEPTION 'security_events approval payload is missing required device_id.';
                    END IF;
                    IF TRIM(v_new_device_id) <> TRIM(v_old_device_id) THEN
                        RAISE EXCEPTION 'security_events device identifier mismatch: cannot swap device binding during approval.';
                    END IF;
                END IF;

                -- Location must provide non-empty admin authorization record
                IF NEW.location IS NULL OR TRIM(NEW.location) = '' THEN
                    RAISE EXCEPTION 'security_events approval requires valid administrator notes in location.';
                END IF;

                RETURN NEW;
            END IF;

            -- Transition B: Admin Rejection (Flagged/pending -> Blocked/rejected)
            IF OLD.result = 'Flagged' AND v_old_status = 'pending'
               AND NEW.result = 'Blocked' AND v_new_status = 'rejected' THEN

                -- Severity must remain unchanged
                IF NEW.severity <> OLD.severity THEN
                    RAISE EXCEPTION 'security_events severity cannot be altered during rejection.';
                END IF;

                -- Location must provide non-empty admin rejection justification
                IF NEW.location IS NULL OR TRIM(NEW.location) = '' THEN
                    RAISE EXCEPTION 'security_events rejection requires administrator justification in location.';
                END IF;

                RETURN NEW;
            END IF;

            -- Transition C: Token Consumption (Allowed/approved -> Allowed/consumed)
            IF OLD.result = 'Allowed' AND v_old_status = 'approved'
               AND NEW.result = 'Allowed' AND v_new_status = 'consumed' THEN

                -- Result must remain Allowed
                IF NEW.result <> OLD.result THEN
                    RAISE EXCEPTION 'security_events result cannot be altered during token consumption.';
                END IF;

                -- Location must remain strictly identical to original approval note
                IF NEW.location <> OLD.location THEN
                    RAISE EXCEPTION 'security_events location cannot be altered during token consumption.';
                END IF;

                -- Severity must remain strictly identical
                IF NEW.severity <> OLD.severity THEN
                    RAISE EXCEPTION 'security_events severity cannot be altered during token consumption.';
                END IF;

                -- Extract and validate authorization token identifiers
                v_old_token := (regexp_match(OLD.device, '(?:^|\|)token:([^|]+)'))[1];
                v_new_token := (regexp_match(NEW.device, '(?:^|\|)token:([^|]+)'))[1];

                IF v_old_token IS NULL OR TRIM(v_old_token) = '' THEN
                    RAISE EXCEPTION 'security_events approval record is missing valid authorization token.';
                END IF;
                IF v_new_token IS NULL OR TRIM(v_new_token) = '' THEN
                    RAISE EXCEPTION 'security_events consumption payload is missing authorization token.';
                END IF;
                IF v_old_token !~ '^ftok_[0-9a-zA-Z_-]{16,64}$' THEN
                    RAISE EXCEPTION 'security_events approval record contains malformed authorization token.';
                END IF;
                IF v_new_token !~ '^ftok_[0-9a-zA-Z_-]{16,64}$' THEN
                    RAISE EXCEPTION 'security_events consumption payload contains malformed authorization token.';
                END IF;
                IF TRIM(v_old_token) <> TRIM(v_new_token) THEN
                    RAISE EXCEPTION 'security_events authorization token identifier mismatch during consumption.';
                END IF;

                -- Extract and validate device binding identifier
                v_old_device_id := (regexp_match(OLD.device, '(?:^|\|)device_id:([^|]+)'))[1];
                v_new_device_id := (regexp_match(NEW.device, '(?:^|\|)device_id:([^|]+)'))[1];

                IF v_old_device_id IS NOT NULL AND TRIM(v_old_device_id) <> '' THEN
                    IF v_new_device_id IS NULL OR TRIM(v_new_device_id) = '' THEN
                        RAISE EXCEPTION 'security_events consumption payload is missing required device_id.';
                    END IF;
                    IF TRIM(v_new_device_id) <> TRIM(v_old_device_id) THEN
                        RAISE EXCEPTION 'security_events device identifier mismatch: cannot swap device binding during token consumption.';
                    END IF;
                END IF;

                RETURN NEW;
            END IF;

            RAISE EXCEPTION 'security_events invalid face request lifecycle transition from result=%, status=% to result=%, status=%.',
                OLD.result, v_old_status, NEW.result, v_new_status;
        END IF;

        RAISE EXCEPTION 'security_events is an immutable audit log: UPDATE operations are permitted only for active face request lifecycle transitions.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_security_events_immutability ON public.security_events;
CREATE TRIGGER trg_enforce_security_events_immutability
BEFORE UPDATE OR DELETE ON public.security_events
FOR EACH ROW
EXECUTE FUNCTION public.enforce_security_events_immutability();

-- ---------------------------------------------------------------------
-- 4.2 STORED PROCEDURE: atomic_verify_and_consume_attendance_challenge
-- Serializes and consumes single-use challenge nonces with row locking
-- ---------------------------------------------------------------------
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
    v_record RECORD;
    v_now TIMESTAMPTZ := NOW();
    v_now_iso TEXT := to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
    IF p_challenge IS NULL OR TRIM(p_challenge) = '' THEN
        RETURN jsonb_build_object('valid', false, 'error', 'CHALLENGE_REQUIRED', 'message', 'Challenge nonce is required.');
    END IF;

    SELECT * INTO v_record
    FROM public.attendance_challenges
    WHERE challenge = TRIM(p_challenge)
    FOR UPDATE;

    IF v_record IS NULL THEN
        RETURN jsonb_build_object('valid', false, 'error', 'CHALLENGE_NOT_FOUND', 'message', 'Challenge nonce not found or invalid.');
    END IF;

    IF v_record.status = 'CONSUMED' THEN
        RETURN jsonb_build_object('valid', false, 'error', 'CHALLENGE_ALREADY_USED', 'message', 'Challenge nonce has already been consumed.');
    END IF;

    IF v_record.status = 'EXPIRED' THEN
        RETURN jsonb_build_object('valid', false, 'error', 'CHALLENGE_EXPIRED', 'message', 'Challenge nonce has expired.');
    END IF;

    IF v_record.status <> 'ACTIVE' THEN
        RETURN jsonb_build_object('valid', false, 'error', 'INVALID_CHALLENGE_STATUS', 'message', 'Challenge nonce status is not active: ' || v_record.status);
    END IF;

    IF v_now > v_record.expires_at THEN
        UPDATE public.attendance_challenges
        SET status = 'EXPIRED'
        WHERE challenge = v_record.challenge;

        RETURN jsonb_build_object('valid', false, 'error', 'CHALLENGE_EXPIRED', 'message', 'Challenge nonce has expired.');
    END IF;

    IF UPPER(TRIM(v_record.staff_code)) <> UPPER(TRIM(p_staff_code)) THEN
        RETURN jsonb_build_object('valid', false, 'error', 'CHALLENGE_STAFF_MISMATCH', 'message', 'Challenge was issued for a different staff member.');
    END IF;

    IF v_record.device_id <> 'PENDING_REGISTRATION' AND v_record.device_id <> TRIM(p_device_id) THEN
        RETURN jsonb_build_object('valid', false, 'error', 'CHALLENGE_DEVICE_MISMATCH', 'message', 'Challenge was issued for a different device identifier.');
    END IF;

    IF p_operation IS NOT NULL AND TRIM(p_operation) <> '' AND UPPER(TRIM(v_record.operation)) <> UPPER(TRIM(p_operation)) THEN
        RETURN jsonb_build_object('valid', false, 'error', 'CHALLENGE_OPERATION_MISMATCH', 'message', 'Challenge was issued for a different operation type: ' || v_record.operation);
    END IF;

    UPDATE public.attendance_challenges
    SET status = 'CONSUMED',
        consumed_at = v_now
    WHERE challenge = v_record.challenge;

    RETURN jsonb_build_object(
        'valid', true,
        'consumed_at', v_now_iso,
        'challenge', v_record.challenge,
        'staff_code', v_record.staff_code
    );
END;
$$;

-- ---------------------------------------------------------------------
-- 4.3 STORED PROCEDURE: atomic_consume_face_approval_token
-- Validates and consumes single-use face replacement authorization
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.atomic_consume_face_approval_token(
    p_staff_code VARCHAR,
    p_token VARCHAR,
    p_device_id VARCHAR DEFAULT NULL,
    p_sample_count INT DEFAULT 5
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_staff_id UUID;
    v_req_id UUID;
    v_device TEXT;
    v_now TIMESTAMPTZ := NOW();
    v_now_iso TEXT := to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    v_expires_match TEXT[];
    v_expires_at TIMESTAMPTZ;
    v_clean_device_id TEXT := COALESCE(NULLIF(TRIM(p_device_id), ''), 'active-device');
    v_bound_device_id TEXT;
BEGIN
    IF p_staff_code IS NULL OR TRIM(p_staff_code) = '' THEN
        RETURN jsonb_build_object('success', false, 'code', 'STAFF_CODE_MISSING', 'error', 'Staff identifier is required.');
    END IF;

    IF p_token IS NULL OR TRIM(p_token) = '' THEN
        RETURN jsonb_build_object('success', false, 'code', 'TOKEN_MISSING', 'error', 'Authorization token is required.');
    END IF;

    SELECT id INTO v_staff_id
    FROM public.staff
    WHERE UPPER(staff_code) = UPPER(TRIM(p_staff_code))
      AND active = true;

    IF v_staff_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'STAFF_NOT_FOUND', 'error', 'Active staff member not found.');
    END IF;

    -- Atomically lock and select exactly one valid matching approval record
    SELECT id, device INTO v_req_id, v_device
    FROM public.security_events
    WHERE UPPER(staff) = UPPER(TRIM(p_staff_code))
      AND result = 'Allowed'
      AND (
          device LIKE ('%token:' || TRIM(p_token) || '|%')
          OR device LIKE ('%token:' || TRIM(p_token))
      )
      AND device ~ '(^|\|)status:approved(\||$)'
      AND device !~ '(^|\|)status:consumed(\||$)'
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_req_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_OR_CONSUMED_TOKEN', 'error', 'Invalid, expired, or already consumed face change authorization.');
    END IF;

    -- If the approval record binds authorization to a device_id, verify that consumption matches
    v_bound_device_id := (regexp_match(v_device, '(?:^|\|)device_id:([^|]+)'))[1];
    IF v_bound_device_id IS NOT NULL AND TRIM(v_bound_device_id) <> '' THEN
        IF p_device_id IS NOT NULL AND TRIM(p_device_id) <> '' AND TRIM(p_device_id) <> TRIM(v_bound_device_id) THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'DEVICE_BINDING_MISMATCH',
                'error', 'Authorization token is bound to a different device.'
            );
        END IF;
        v_clean_device_id := TRIM(v_bound_device_id);
    END IF;

    v_expires_match := regexp_match(v_device, 'expires_at:([^|\s]+)');
    IF v_expires_match IS NULL OR v_expires_match[1] IS NULL OR v_expires_match[1] = '' THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_EXPIRY', 'error', 'Approval record is missing a valid expiration timestamp.');
    END IF;

    BEGIN
        v_expires_at := v_expires_match[1]::TIMESTAMPTZ;
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'code', 'MALFORMED_EXPIRY', 'error', 'Approval record has a malformed expiration timestamp.');
    END;

    IF v_now > v_expires_at THEN
        RETURN jsonb_build_object('success', false, 'code', 'EXPIRED_APPROVAL_TOKEN', 'error', 'Your 24-hour administrator approval window has expired.');
    END IF;

    UPDATE public.security_events
    SET device = 'token:' || TRIM(p_token) || '|status:consumed|device_id:' || v_clean_device_id || '|count:' || p_sample_count || '|consumed_at:' || v_now_iso,
        time = v_now
    WHERE id = v_req_id;

    RETURN jsonb_build_object(
        'success', true,
        'code', 'TOKEN_CONSUMED',
        'isLocked', true,
        'count', p_sample_count,
        'deviceId', v_clean_device_id,
        'message', 'Face registration updated and permanently locked. Single-use authorization consumed.'
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'code', 'TRANSACTION_ROLLBACK',
        'error', 'Database transaction failed during atomic approval token consumption.'
    );
END;
$$;

-- Backward-compatibility wrapper forwarding to atomic_consume_face_approval_token
CREATE OR REPLACE FUNCTION public.atomic_replace_face_biometrics(
    p_staff_code VARCHAR,
    p_token VARCHAR,
    p_samples JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    RETURN public.atomic_consume_face_approval_token(p_staff_code, p_token, 'android-keystore', 5);
END;
$$;

-- ---------------------------------------------------------------------
-- 4.4 STORED PROCEDURE: clean_expired_admin_revocations
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clean_expired_admin_revocations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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

-- =====================================================================
-- SECTION 5: ROW LEVEL SECURITY & LEAST-PRIVILEGE PERMISSIONS
-- =====================================================================

ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registered_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_token_revocations ENABLE ROW LEVEL SECURITY;

-- Service Role Full Access (Backend serverless functions bypass RLS via service key)
DROP POLICY IF EXISTS "service_role_all_staff" ON public.staff;
CREATE POLICY "service_role_all_staff" ON public.staff FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_devices" ON public.devices;
CREATE POLICY "service_role_all_devices" ON public.devices FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_registered_devices" ON public.registered_devices;
CREATE POLICY "service_role_all_registered_devices" ON public.registered_devices FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_attendance_records" ON public.attendance_records;
CREATE POLICY "service_role_all_attendance_records" ON public.attendance_records FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_attendance_challenges" ON public.attendance_challenges;
CREATE POLICY "service_role_all_attendance_challenges" ON public.attendance_challenges FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_attendance_corrections" ON public.attendance_corrections;
CREATE POLICY "service_role_all_attendance_corrections" ON public.attendance_corrections FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_security_events" ON public.security_events;
CREATE POLICY "service_role_all_security_events" ON public.security_events FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_admin_users" ON public.admin_users;
CREATE POLICY "service_role_all_admin_users" ON public.admin_users FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_admin_token_revocations" ON public.admin_token_revocations;
CREATE POLICY "service_role_all_admin_token_revocations" ON public.admin_token_revocations FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Revoke all direct public access on base tables and views
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.staff_directory FROM PUBLIC, anon, authenticated;

-- Explicitly revoke execution on custom database functions from untrusted roles
REVOKE ALL ON FUNCTION public.enforce_security_events_immutability() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.atomic_verify_and_consume_attendance_challenge(VARCHAR, VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.atomic_consume_face_approval_token(VARCHAR, VARCHAR, VARCHAR, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.atomic_replace_face_biometrics(VARCHAR, VARCHAR, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clean_expired_admin_revocations() FROM PUBLIC, anon, authenticated;

-- Grant execution and table management to service_role
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;

-- Grant staff_directory view access strictly to backend service_role
-- (Application does not use Supabase Auth; backend API routes /api/admin/staff read via service_role)
GRANT SELECT ON public.staff_directory TO service_role;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
