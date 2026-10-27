-- ====================================================================
-- CampusAttend — Enforce Two-Way One Faculty <-> One Device Uniqueness
-- Migration: 20261025_enforce_two_way_device_uniqueness.sql
--
-- Policy Guarantees:
-- 1. One faculty account can be bound to at most ONE active device at a time.
-- 2. One physical device (by public_key and key_id) can be bound to at most ONE faculty account at a time.
-- 3. Idempotent retries by the same account and same device are safe.
-- 4. Cross-account binding attempts are rejected with atomic uniqueness enforcement.
-- ====================================================================

-- 1. Ensure public.devices has all required cryptographic identity columns
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

-- 2. Ensure status constraint includes all states
ALTER TABLE public.devices DROP CONSTRAINT IF EXISTS devices_status_check;
ALTER TABLE public.devices ADD CONSTRAINT devices_status_check 
    CHECK (status IN ('Active', 'Pending', 'Blocked', 'Revoked'));

-- 3. RULE 1: AT MOST ONE ACTIVE DEVICE PER FACULTY MEMBER
-- Guarantees that one faculty account cannot be bound to two active devices concurrently.
DROP INDEX IF EXISTS idx_one_active_device_per_faculty;
CREATE UNIQUE INDEX idx_one_active_device_per_faculty 
    ON public.devices (staff_code) 
    WHERE (status = 'Active');

-- 4. RULE 2: AT MOST ONE FACULTY ACCOUNT PER PHYSICAL DEVICE
-- Guarantees that one physical device cannot be bound to two staff accounts concurrently.
DROP INDEX IF EXISTS idx_one_active_staff_per_device;
CREATE UNIQUE INDEX idx_one_active_staff_per_device 
    ON public.devices (public_key) 
    WHERE (status = 'Active' AND public_key IS NOT NULL);

DROP INDEX IF EXISTS idx_one_active_staff_per_key_id;
CREATE UNIQUE INDEX idx_one_active_staff_per_key_id 
    ON public.devices (key_id) 
    WHERE (status = 'Active' AND key_id IS NOT NULL);

-- 5. Performance lookup indexes
CREATE INDEX IF NOT EXISTS idx_devices_staff_code ON public.devices (staff_code);
CREATE INDEX IF NOT EXISTS idx_devices_key_id ON public.devices (key_id);
CREATE INDEX IF NOT EXISTS idx_devices_status ON public.devices (status);
CREATE INDEX IF NOT EXISTS idx_devices_registered_at ON public.devices (registered_at DESC);
