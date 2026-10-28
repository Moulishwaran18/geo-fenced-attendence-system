-- ====================================================================
-- CampusAttend — Registered Devices Table Migration
-- Project: https://gcpuuvhydtgmcpiumpfa.supabase.co
-- File: supabase/migrations/20261028_registered_devices.sql
-- ====================================================================
-- TARGET SCHEMA:
-- - id UUID primary key DEFAULT gen_random_uuid()
-- - staff_code VARCHAR UNIQUE NOT NULL
-- - staff_name VARCHAR NOT NULL
-- - department VARCHAR NOT NULL
-- - device_id VARCHAR UNIQUE NOT NULL
-- - device_locked BOOLEAN NOT NULL DEFAULT true
-- - is_active BOOLEAN NOT NULL DEFAULT true
-- - registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
-- - updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
-- ====================================================================

BEGIN;

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

-- Indexes for high-performance authentication and lookup
CREATE INDEX IF NOT EXISTS idx_registered_devices_staff_code ON public.registered_devices(staff_code);
CREATE INDEX IF NOT EXISTS idx_registered_devices_device_id ON public.registered_devices(device_id);
CREATE INDEX IF NOT EXISTS idx_registered_devices_is_active ON public.registered_devices(is_active);
CREATE INDEX IF NOT EXISTS idx_registered_devices_device_locked ON public.registered_devices(device_locked);

-- Enable RLS
ALTER TABLE public.registered_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_registered_devices" ON public.registered_devices;
CREATE POLICY "service_role_all_registered_devices" ON public.registered_devices
FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.registered_devices FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.registered_devices TO service_role;

-- Backward compatibility view for legacy readers if public.staff table does not exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'staff'
  ) THEN
    EXECUTE 'CREATE VIEW public.staff AS
      SELECT
        id,
        staff_code,
        staff_name AS name,
        lower(staff_code) || ''@sonatech.ac.in'' AS email,
        department,
        ''Staff'' AS designation,
        device_id AS device,
        CASE WHEN is_active THEN ''Active'' ELSE ''Inactive'' END AS device_status,
        is_active AS active,
        false AS inside_campus,
        registered_at AS created_at,
        updated_at
      FROM public.registered_devices';
    EXECUTE 'GRANT ALL ON public.staff TO service_role';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
