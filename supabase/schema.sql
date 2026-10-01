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

-- 7. REGISTERED DEVICES TABLE
CREATE TABLE IF NOT EXISTS public.devices (
    id VARCHAR(64) PRIMARY KEY, -- e.g. DEV-8842-AX
    staff_id UUID REFERENCES public.staff(id) ON DELETE SET NULL,
    staff_code VARCHAR(64),
    staff_name VARCHAR(255),
    model VARCHAR(255) NOT NULL,
    os VARCHAR(64) NOT NULL,
    status VARCHAR(32) DEFAULT 'Active' NOT NULL CHECK (status IN ('Active', 'Pending', 'Blocked')),
    registered_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

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

-- ====================================================================
-- INDEXES FOR PERFORMANCE
-- ====================================================================
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
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Ensures anon/publishable key can read & write smoothly
-- ====================================================================
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.face_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.face_detection_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geofence_zones ENABLE ROW LEVEL SECURITY;

-- Staff policies
DROP POLICY IF EXISTS "Allow public read staff" ON public.staff;
CREATE POLICY "Allow public read staff" ON public.staff FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public write staff" ON public.staff;
CREATE POLICY "Allow public write staff" ON public.staff FOR ALL USING (true);

-- Face embeddings policies
DROP POLICY IF EXISTS "Allow public read face_embeddings" ON public.face_embeddings;
CREATE POLICY "Allow public read face_embeddings" ON public.face_embeddings FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public write face_embeddings" ON public.face_embeddings;
CREATE POLICY "Allow public write face_embeddings" ON public.face_embeddings FOR ALL USING (true);

-- Face detection logs policies
DROP POLICY IF EXISTS "Allow public read face_detection_logs" ON public.face_detection_logs;
CREATE POLICY "Allow public read face_detection_logs" ON public.face_detection_logs FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public write face_detection_logs" ON public.face_detection_logs;
CREATE POLICY "Allow public write face_detection_logs" ON public.face_detection_logs FOR ALL USING (true);

-- Attendance records policies
DROP POLICY IF EXISTS "Allow public read attendance_records" ON public.attendance_records;
CREATE POLICY "Allow public read attendance_records" ON public.attendance_records FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public write attendance_records" ON public.attendance_records;
CREATE POLICY "Allow public write attendance_records" ON public.attendance_records FOR ALL USING (true);

-- Security events policies
DROP POLICY IF EXISTS "Allow public read security_events" ON public.security_events;
CREATE POLICY "Allow public read security_events" ON public.security_events FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public write security_events" ON public.security_events;
CREATE POLICY "Allow public write security_events" ON public.security_events FOR ALL USING (true);

-- Devices policies
DROP POLICY IF EXISTS "Allow public read devices" ON public.devices;
CREATE POLICY "Allow public read devices" ON public.devices FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public write devices" ON public.devices;
CREATE POLICY "Allow public write devices" ON public.devices FOR ALL USING (true);

-- Geofence zones policies
DROP POLICY IF EXISTS "Allow public read geofence_zones" ON public.geofence_zones;
CREATE POLICY "Allow public read geofence_zones" ON public.geofence_zones FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public write geofence_zones" ON public.geofence_zones;
CREATE POLICY "Allow public write geofence_zones" ON public.geofence_zones FOR ALL USING (true);

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
    ('Main Campus', 'Sona College of Technology', '18,12 46,6 62,14 78,10 92,26 88,48 94,66 74,82 52,88 30,84 14,70 8,44', 11.6814, 78.1384, 500, true)
ON CONFLICT DO NOTHING;
