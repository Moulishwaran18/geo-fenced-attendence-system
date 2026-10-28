-- ====================================================================
-- CampusAttend — Registered Devices Table Migration
-- Project: https://gcpuuvhydtgmcpiumpfa.supabase.co
-- File: supabase/migrations/20261028_registered_devices.sql
-- ====================================================================
-- PURPOSE:
-- 1. Create public.registered_devices table to record administrator-registered
--    and client-registered hardware bindings (staff_id, staff_name, department, device_id).
-- 2. Enforce physical hardware uniqueness (Rule 1 & Rule 2):
--    - Rule 1: One faculty account <-> At most ONE active registered device
--    - Rule 2: One physical device <-> At most ONE active faculty account
-- 3. Configure strict Row Level Security (RLS) granting access only to service_role.
-- ====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.registered_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id VARCHAR(64) NOT NULL,
    staff_code VARCHAR(64),
    staff_name VARCHAR(255) NOT NULL,
    department VARCHAR(128) NOT NULL,
    device_id VARCHAR(128) NOT NULL,
    status VARCHAR(32) DEFAULT 'Active' NOT NULL CHECK (status IN ('Active', 'Revoked', 'Pending', 'Blocked')),
    registered_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uq_registered_devices_staff UNIQUE (staff_id),
    CONSTRAINT uq_registered_devices_device UNIQUE (device_id)
);

CREATE INDEX IF NOT EXISTS idx_registered_devices_staff_id ON public.registered_devices(staff_id);
CREATE INDEX IF NOT EXISTS idx_registered_devices_device_id ON public.registered_devices(device_id);
CREATE INDEX IF NOT EXISTS idx_registered_devices_status ON public.registered_devices(status);

ALTER TABLE public.registered_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_registered_devices" ON public.registered_devices;
CREATE POLICY "service_role_all_registered_devices" ON public.registered_devices
FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.registered_devices FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.registered_devices TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
