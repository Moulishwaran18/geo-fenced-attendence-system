-- ====================================================================
-- CampusAttend — Supabase Database Schema & Setup Script
-- Project URL: https://qvjcxoznvhoagclbyhad.supabase.co
--
-- Instructions:
-- 1. Open your Supabase Dashboard: https://supabase.com/dashboard/project/qvjcxoznvhoagclbyhad
-- 2. Navigate to "SQL Editor" in the left sidebar
-- 3. Click "New Query", paste this entire script, and click "Run"
-- ====================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. STAFF TABLE
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

-- 3. FACE EMBEDDINGS TABLE (512-D ArcFace Biometric Vectors)
CREATE TABLE IF NOT EXISTS public.face_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
    embedding vector(512) NOT NULL,
    reference_image_path TEXT NOT NULL,
    photo_data TEXT, -- Base64 JPEG data URL
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 4. FACE DETECTION / AUTHENTICATION AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS public.face_detection_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    detected_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    server_date DATE DEFAULT CURRENT_DATE NOT NULL,
    server_time TIME DEFAULT CURRENT_TIME NOT NULL,
    confidence NUMERIC(5, 4) DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 5. ATTENDANCE RECORDS TABLE
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
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 6. SECURITY EVENTS / ANOMALIES TABLE
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

-- 7. REGISTERED DEVICES TABLE (One Faculty <-> One Registered Device Policy)
CREATE TABLE IF NOT EXISTS public.devices (
    id VARCHAR(128) PRIMARY KEY, -- e.g. DEV_ANDROID_15da1ec2b55216de
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

-- RULE 1: At most one active registered device per faculty account
DROP INDEX IF EXISTS idx_one_active_device_per_faculty;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_device_per_faculty 
    ON public.devices (staff_code) 
    WHERE (status = 'Active');

-- RULE 2: At most one active faculty account per registered physical device
DROP INDEX IF EXISTS idx_one_active_staff_per_device;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_staff_per_device 
    ON public.devices (public_key) 
    WHERE (status = 'Active' AND public_key IS NOT NULL);

DROP INDEX IF EXISTS idx_one_active_staff_per_key_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_staff_per_key_id 
    ON public.devices (key_id) 
    WHERE (status = 'Active' AND key_id IS NOT NULL);

-- 8. GEOFENCE ZONES TABLE
CREATE TABLE IF NOT EXISTS public.geofence_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    campus_name VARCHAR(255) DEFAULT 'Sona College of Technology',
    polygon_coords TEXT NOT NULL,
    center_lat DOUBLE PRECISION DEFAULT 11.6814,
    center_lng DOUBLE PRECISION DEFAULT 78.1384,
    radius_meters DOUBLE PRECISION DEFAULT 500,
    active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 9. ADMINISTRATOR ACCOUNTS TABLE
CREATE TABLE IF NOT EXISTS public.admin_users (
    id VARCHAR(64) PRIMARY KEY,
    username VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(32) DEFAULT 'admin' NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ====================================================================
-- INDEXES FOR PERFORMANCE
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_admin_users_username ON public.admin_users(username);
CREATE INDEX IF NOT EXISTS idx_staff_staff_code ON public.staff(staff_code);
CREATE INDEX IF NOT EXISTS idx_staff_email ON public.staff(email);
CREATE INDEX IF NOT EXISTS idx_staff_active ON public.staff(active);
CREATE INDEX IF NOT EXISTS idx_face_embeddings_staff_id ON public.face_embeddings(staff_id);
CREATE INDEX IF NOT EXISTS idx_face_logs_user_id ON public.face_detection_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_face_logs_detected_at ON public.face_detection_logs(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_staff_code ON public.attendance_records(staff_code);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance_records(date DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON public.security_events(created_at DESC);

-- ====================================================================
-- ATTENDANCE UNIQUE CONSTRAINT (PREVENTS CONCURRENT DUPLICATES)
-- ====================================================================
DROP INDEX IF EXISTS idx_unique_staff_attendance_per_day;
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_staff_attendance_per_day 
    ON public.attendance_records (staff_code, date);

-- ====================================================================
-- SINGLE-USE ATTENDANCE CHALLENGES TABLE & ATOMIC CONSUMPTION FUNCTION
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.attendance_challenges (
    challenge VARCHAR(64) PRIMARY KEY,
    staff_code VARCHAR(64) NOT NULL,
    device_id VARCHAR(128) NOT NULL,
    operation VARCHAR(32) DEFAULT 'ATTENDANCE_PUNCH' NOT NULL,
    issued_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    status VARCHAR(32) DEFAULT 'ACTIVE' NOT NULL CHECK (status IN ('ACTIVE', 'CONSUMED', 'EXPIRED')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attendance_challenges_staff ON public.attendance_challenges(staff_code);
CREATE INDEX IF NOT EXISTS idx_attendance_challenges_expires ON public.attendance_challenges(expires_at);

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

    SELECT * INTO v_row
    FROM public.attendance_challenges
    WHERE challenge = pg_catalog.btrim(p_challenge)
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'CHALLENGE_NOT_FOUND', 'message', 'Challenge nonce was not found or was forged.');
    END IF;

    IF v_row.status = 'CONSUMED' OR v_row.consumed_at IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'CHALLENGE_ALREADY_CONSUMED', 'message', 'Challenge nonce has already been consumed.');
    END IF;

    IF v_now > v_row.expires_at THEN
        UPDATE public.attendance_challenges SET status = 'EXPIRED' WHERE challenge = pg_catalog.btrim(p_challenge);
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'CHALLENGE_EXPIRED', 'message', 'Challenge has expired. Fresh challenge required.');
    END IF;

    IF v_row.operation IS DISTINCT FROM pg_catalog.btrim(p_operation) THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'CHALLENGE_OPERATION_MISMATCH', 'message', 'Challenge was issued for a different operation.');
    END IF;

    IF pg_catalog.upper(v_row.staff_code) IS DISTINCT FROM pg_catalog.upper(pg_catalog.btrim(p_staff_code)) THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'CHALLENGE_STAFF_MISMATCH', 'message', 'Challenge is bound to a different faculty account.');
    END IF;

    IF v_row.device_id IS DISTINCT FROM pg_catalog.btrim(p_device_id) THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'error', 'CHALLENGE_DEVICE_MISMATCH', 'message', 'Challenge is bound to a different registered device.');
    END IF;

    UPDATE public.attendance_challenges
    SET status = 'CONSUMED',
        consumed_at = v_now
    WHERE challenge = pg_catalog.btrim(p_challenge);

    RETURN pg_catalog.jsonb_build_object('valid', true, 'consumed_at', v_now);
END;
$$;

-- ====================================================================
-- IMMUTABLE APPEND-ONLY DATABASE TRIGGER ON ATTENDANCE RECORDS
-- ====================================================================
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

-- ====================================================================
-- CONTROLLED ATTENDANCE CORRECTIONS TABLE
-- ====================================================================
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

DROP TRIGGER IF EXISTS trg_attendance_corrections_immutable ON public.attendance_corrections;
CREATE TRIGGER trg_attendance_corrections_immutable
    BEFORE UPDATE OR DELETE ON public.attendance_corrections
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_attendance_records_append_only();

-- ====================================================================
-- IMMUTABLE AUDIT TRAIL TRIGGER ON SECURITY EVENTS
-- ====================================================================
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

-- ====================================================================
-- HARDENED ROW LEVEL SECURITY (RLS) POLICIES & PRIVILEGES
-- Ensures ordinary clients cannot insert Present records or modify tables
-- ====================================================================
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.face_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.face_detection_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geofence_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Idempotent role creation for standard environments
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

-- Revoke write privileges from anon and ordinary authenticated client roles
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.attendance_records FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.attendance_corrections FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.security_events FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.staff FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.devices FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.face_embeddings FROM anon, authenticated;

-- Allow SELECT for authorized client queries
GRANT SELECT ON public.attendance_records TO anon, authenticated;
GRANT SELECT ON public.attendance_corrections TO anon, authenticated;
GRANT SELECT ON public.security_events TO anon, authenticated;
GRANT SELECT ON public.staff TO anon, authenticated;
GRANT SELECT ON public.devices TO anon, authenticated;
GRANT SELECT ON public.geofence_zones TO anon, authenticated;

-- Admin users security: never expose admin credentials to public queries
DROP POLICY IF EXISTS "Restrict public read admin_users" ON public.admin_users;
CREATE POLICY "Restrict public read admin_users" ON public.admin_users FOR SELECT USING (false);

-- Staff policies (read-only for clients)
DROP POLICY IF EXISTS "Allow public read staff" ON public.staff;
CREATE POLICY "Allow public read staff" ON public.staff FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public write staff" ON public.staff;

-- Face embeddings policies
DROP POLICY IF EXISTS "Allow public read face_embeddings" ON public.face_embeddings;
CREATE POLICY "Allow public read face_embeddings" ON public.face_embeddings FOR SELECT USING (false);
DROP POLICY IF EXISTS "Allow public write face_embeddings" ON public.face_embeddings;

-- Attendance records policies (read permitted; direct client writes strictly denied)
DROP POLICY IF EXISTS "Allow public read attendance_records" ON public.attendance_records;
CREATE POLICY "Allow public read attendance_records" ON public.attendance_records FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public write attendance_records" ON public.attendance_records;
DROP POLICY IF EXISTS "Disallow direct write attendance_records" ON public.attendance_records;
CREATE POLICY "Disallow direct write attendance_records" ON public.attendance_records FOR INSERT WITH CHECK (false);

-- Security events policies (read permitted; client updates/deletes prohibited)
DROP POLICY IF EXISTS "Allow public read security_events" ON public.security_events;
CREATE POLICY "Allow public read security_events" ON public.security_events FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public write security_events" ON public.security_events;

-- Devices policies (read-only for clients)
DROP POLICY IF EXISTS "Allow public read devices" ON public.devices;
CREATE POLICY "Allow public read devices" ON public.devices FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public write devices" ON public.devices;

-- Geofence zones policies (read-only)
DROP POLICY IF EXISTS "Allow public read geofence_zones" ON public.geofence_zones;
CREATE POLICY "Allow public read geofence_zones" ON public.geofence_zones FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public write geofence_zones" ON public.geofence_zones;

-- Service role full access
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION public.atomic_verify_and_consume_attendance_challenge TO anon, authenticated, service_role;

-- ====================================================================
-- REALTIME SUBSCRIPTIONS
-- Enable realtime publication for dynamic updates
-- ====================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'attendance_records'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_records;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'face_detection_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.face_detection_logs;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'security_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.security_events;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    NULL; -- Publication might already have tables
END $$;

-- ====================================================================
-- VECTOR SIMILARITY SEARCH HELPER FUNCTION (RPC)
-- ====================================================================
CREATE OR REPLACE FUNCTION match_face_embeddings(
    query_embedding vector(512),
    match_threshold float DEFAULT 0.65,
    match_count int DEFAULT 5
)
RETURNS TABLE (
    id UUID,
    staff_id UUID,
    staff_code VARCHAR,
    name VARCHAR,
    reference_image_path TEXT,
    photo_data TEXT,
    distance float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        fe.id,
        fe.staff_id,
        s.staff_code,
        s.name,
        fe.reference_image_path,
        fe.photo_data,
        (fe.embedding <-> query_embedding) AS distance
    FROM public.face_embeddings fe
    JOIN public.staff s ON s.id = fe.staff_id
    WHERE s.active = true AND (fe.embedding <-> query_embedding) <= match_threshold
    ORDER BY distance ASC
    LIMIT match_count;
END;
$$;

-- ====================================================================
-- SEED INITIAL DATA (Optional: Initial Test Staff & Geofence Boundary)
-- ====================================================================
INSERT INTO public.staff (staff_code, name, email, department, designation, phone, device, device_status, active, inside_campus)
VALUES
    ('PERSON_001', 'Test Person 1', 'test.person1@sonatech.ac.in', 'Computer Science & Engineering', 'Associate Professor', '+91 98401 10001', 'Redmi Note 13 Pro', 'Active', true, true),
    ('PERSON_002', 'Test Person 2', 'test.person2@sonatech.ac.in', 'Information Technology', 'Assistant Professor', '+91 98401 10002', 'iPhone 14', 'Active', true, true),
    ('PERSON_003', 'Test Person 3', 'test.person3@sonatech.ac.in', 'Electronics & Communication', 'Professor', '+91 98401 10003', 'Samsung Galaxy S23', 'Active', true, false),
    ('SCT-2417', 'Dr. Priya Ramanathan', 'priya.r@sonatech.ac.in', 'Computer Science & Engineering', 'Associate Professor', '+91 98xxx 41220', 'Redmi Note 13 Pro (Android 14)', 'Active', true, true),
    ('SCT-2418', 'Prof. Karthik Subramanian', 'subramanian@sonatech.ac.in', 'Electronics & Communication', 'Assistant Professor', '+91 98xxx 41037', 'iPhone 14', 'Active', true, true)
ON CONFLICT (staff_code) DO NOTHING;

INSERT INTO public.geofence_zones (name, campus_name, polygon_coords, center_lat, center_lng, radius_meters, active)
VALUES
    ('Main Campus', 'Sona College of Technology', '[[11.675651510482604,78.12402220170895],[11.675657082681333,78.12382305416799],[11.675768526632474,78.12359545697831],[11.675857681761121,78.12339630943734],[11.676125146975094,78.1228443862524],[11.676370323194567,78.12244609117047],[11.676414900665728,78.12241764152176],[11.676448333764391,78.12143897360616],[11.676905252375372,78.12147880311436],[11.676977690622595,78.12159260170921],[11.67708913404289,78.12222418391055],[11.677990932044441,78.12235439874642],[11.677979915759753,78.1237830407748]]', 11.676556648538646, 78.12272439562298, 500, true)
ON CONFLICT DO NOTHING;
