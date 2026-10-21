-- ====================================================================
-- CampusAttend — One Faculty–One Registered Device Policy Migration
-- ====================================================================

-- 1. Ensure columns exist on devices table
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS public_key TEXT;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS key_id VARCHAR(128);
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS key_algorithm VARCHAR(64) DEFAULT 'ECDSA_P256';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS platform VARCHAR(32) DEFAULT 'android';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS attestation_status VARCHAR(64) DEFAULT 'Verified';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS attestation_type VARCHAR(64) DEFAULT 'hardware';
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS attestation_evidence TEXT;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS revocation_reason TEXT;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS revoked_by VARCHAR(64);
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS audit_metadata JSONB DEFAULT '{}'::jsonb;

-- 2. Update status check constraint to include 'Revoked'
ALTER TABLE public.devices DROP CONSTRAINT IF EXISTS devices_status_check;
ALTER TABLE public.devices ADD CONSTRAINT devices_status_check 
    CHECK (status IN ('Active', 'Pending', 'Blocked', 'Revoked'));

-- 3. ENFORCE AT MOST ONE ACTIVE DEVICE PER FACULTY MEMBER
-- This partial unique index guarantees at database-level that concurrent registration 
-- requests cannot bind multiple active devices to the same faculty account.
DROP INDEX IF EXISTS idx_one_active_device_per_faculty;
CREATE UNIQUE INDEX idx_one_active_device_per_faculty 
    ON public.devices (staff_code) 
    WHERE (status = 'Active');

-- 4. Fast lookup indexes
CREATE INDEX IF NOT EXISTS idx_devices_staff_code ON public.devices (staff_code);
CREATE INDEX IF NOT EXISTS idx_devices_key_id ON public.devices (key_id);
CREATE INDEX IF NOT EXISTS idx_devices_status ON public.devices (status);
CREATE INDEX IF NOT EXISTS idx_devices_registered_at ON public.devices (registered_at DESC);

-- 5. RLS policies for devices
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read devices" ON public.devices;
CREATE POLICY "Allow public read devices" ON public.devices FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public write devices" ON public.devices;
CREATE POLICY "Allow public write devices" ON public.devices FOR ALL USING (true);
