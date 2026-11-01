-- ====================================================================
-- CampusAttend — Attendance Reminder Notifications Migration
-- File: supabase/migrations/20261101_attendance_reminder_notifications.sql
--
-- Features:
-- 1. attendance_reminder_settings: Singleton admin configuration table
-- 2. staff_device_tokens: Device notification tokens mapped to staff
-- 3. attendance_reminder_logs: Delivery audit trail with unique idempotency keys
-- 4. attendance_reminder_execution_runs: Scheduler run logs and statistics
-- ====================================================================

BEGIN;

-- 1. ATTENDANCE REMINDER SETTINGS (Singleton config)
CREATE TABLE IF NOT EXISTS public.attendance_reminder_settings (
    id VARCHAR(32) PRIMARY KEY DEFAULT 'default',
    enabled BOOLEAN NOT NULL DEFAULT true,
    reminder_time_1 VARCHAR(10) NOT NULL DEFAULT '09:30',
    reminder_time_2_enabled BOOLEAN NOT NULL DEFAULT false,
    reminder_time_2 VARCHAR(10) DEFAULT '10:00',
    applicable_days JSONB NOT NULL DEFAULT '["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]'::jsonb,
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    title VARCHAR(255) NOT NULL DEFAULT 'CampusAttend – Attendance Reminder',
    message TEXT NOT NULL DEFAULT 'You have not marked your attendance today. Please open CampusAttend and complete your attendance verification.',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by VARCHAR(64) DEFAULT 'admin'
);

-- Seed default settings row if not present
INSERT INTO public.attendance_reminder_settings (
    id, enabled, reminder_time_1, reminder_time_2_enabled, reminder_time_2, applicable_days, timezone, title, message
) VALUES (
    'default',
    true,
    '09:30',
    false,
    '10:00',
    '["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]'::jsonb,
    'Asia/Kolkata',
    'CampusAttend – Attendance Reminder',
    'You have not marked your attendance today. Please open CampusAttend and complete your attendance verification.'
) ON CONFLICT (id) DO NOTHING;

-- 2. STAFF NOTIFICATION DEVICE TOKENS TABLE
CREATE TABLE IF NOT EXISTS public.staff_device_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_code VARCHAR(64) NOT NULL,
    device_id VARCHAR(64) NOT NULL,
    token TEXT NOT NULL,
    platform VARCHAR(32) NOT NULL DEFAULT 'android',
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT staff_device_tokens_staff_device_unique UNIQUE (staff_code, device_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_device_tokens_staff_code ON public.staff_device_tokens(staff_code);
CREATE INDEX IF NOT EXISTS idx_staff_device_tokens_is_active ON public.staff_device_tokens(is_active);

-- 3. ATTENDANCE REMINDER LOGS TABLE (Delivery audit with idempotency)
CREATE TABLE IF NOT EXISTS public.attendance_reminder_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_code VARCHAR(64) NOT NULL,
    reminder_slot VARCHAR(32) NOT NULL, -- 'first' | 'second' | 'test'
    attendance_date DATE NOT NULL,
    scheduled_time VARCHAR(16) NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(32) NOT NULL CHECK (status IN ('delivered', 'failed', 'skipped', 'already_marked')),
    title VARCHAR(255),
    message TEXT,
    device_token TEXT,
    error_message TEXT,
    idempotency_key VARCHAR(128) UNIQUE NOT NULL, -- e.g. 'SCT-001_2026-11-01_first'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminder_logs_staff_date ON public.attendance_reminder_logs(staff_code, attendance_date);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_idempotency ON public.attendance_reminder_logs(idempotency_key);

-- 4. ATTENDANCE REMINDER EXECUTION RUNS (Scheduler execution tracking)
CREATE TABLE IF NOT EXISTS public.attendance_reminder_execution_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reminder_slot VARCHAR(32) NOT NULL,
    attendance_date DATE NOT NULL,
    total_staff_count INT NOT NULL DEFAULT 0,
    marked_attendance_count INT NOT NULL DEFAULT 0,
    eligible_unmarked_count INT NOT NULL DEFAULT 0,
    sent_count INT NOT NULL DEFAULT 0,
    failed_count INT NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'completed',
    summary_message TEXT,
    details JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_reminder_runs_date ON public.attendance_reminder_execution_runs(attendance_date);

-- 5. GRANTS FOR POSTGREST ACCESS
GRANT SELECT, INSERT, UPDATE ON public.attendance_reminder_settings TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_device_tokens TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.attendance_reminder_logs TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.attendance_reminder_execution_runs TO anon, authenticated, service_role;

COMMIT;

