-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.staff (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_code character varying NOT NULL UNIQUE,
  name character varying NOT NULL,
  email character varying NOT NULL UNIQUE,
  department character varying NOT NULL,
  designation character varying NOT NULL,
  phone character varying DEFAULT ''::character varying,
  device character varying DEFAULT ''::character varying,
  device_status character varying DEFAULT 'Active'::character varying CHECK (device_status::text = ANY (ARRAY['Active'::character varying, 'Pending'::character varying, 'Blocked'::character varying]::text[])),
  status character varying DEFAULT 'Active'::character varying CHECK (status::text = ANY (ARRAY['Active'::character varying, 'Inactive'::character varying]::text[])),
  active boolean NOT NULL DEFAULT true,
  inside_campus boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT staff_pkey PRIMARY KEY (id)
);
CREATE TABLE public.face_embeddings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL,
  embedding USER-DEFINED NOT NULL,
  reference_image_path text NOT NULL,
  photo_data text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT face_embeddings_pkey PRIMARY KEY (id),
  CONSTRAINT face_embeddings_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id)
);
CREATE TABLE public.face_detection_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id character varying NOT NULL,
  name character varying NOT NULL,
  email character varying NOT NULL,
  detected_at timestamp with time zone NOT NULL DEFAULT now(),
  server_date date NOT NULL DEFAULT CURRENT_DATE,
  server_time time without time zone NOT NULL DEFAULT CURRENT_TIME,
  confidence numeric DEFAULT 1.0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT face_detection_logs_pkey PRIMARY KEY (id)
);
CREATE TABLE public.attendance_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_code character varying NOT NULL,
  staff_name character varying NOT NULL,
  department character varying NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  day character varying NOT NULL,
  time character varying NOT NULL,
  status character varying NOT NULL DEFAULT 'Present'::character varying CHECK (status::text = ANY (ARRAY['Present'::character varying, 'Late'::character varying, 'Absent'::character varying]::text[])),
  location character varying DEFAULT 'Main Campus'::character varying,
  verification character varying NOT NULL DEFAULT 'Verified'::character varying CHECK (verification::text = ANY (ARRAY['Verified'::character varying, 'Failed'::character varying, 'Manual'::character varying]::text[])),
  latitude double precision,
  longitude double precision,
  device_id character varying,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT attendance_records_pkey PRIMARY KEY (id)
);
CREATE TABLE public.security_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  time character varying NOT NULL,
  staff character varying NOT NULL,
  event character varying NOT NULL,
  device character varying NOT NULL,
  location character varying NOT NULL,
  result character varying NOT NULL DEFAULT 'Blocked'::character varying CHECK (result::text = ANY (ARRAY['Blocked'::character varying, 'Allowed'::character varying, 'Flagged'::character varying]::text[])),
  severity character varying NOT NULL DEFAULT 'Medium'::character varying CHECK (severity::text = ANY (ARRAY['Low'::character varying, 'Medium'::character varying, 'High'::character varying]::text[])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT security_events_pkey PRIMARY KEY (id)
);
CREATE TABLE public.devices (
  id character varying NOT NULL,
  staff_id uuid,
  staff_code character varying,
  staff_name character varying,
  model character varying NOT NULL,
  os character varying NOT NULL,
  status character varying NOT NULL DEFAULT 'Active'::character varying CHECK (status::text = ANY (ARRAY['Active'::character varying, 'Pending'::character varying, 'Blocked'::character varying]::text[])),
  registered_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT devices_pkey PRIMARY KEY (id),
  CONSTRAINT devices_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id)
);
CREATE TABLE public.geofence_zones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name character varying NOT NULL,
  campus_name character varying DEFAULT 'Sona College of Technology'::character varying,
  polygon_coords text NOT NULL,
  center_lat double precision DEFAULT 11.6814,
  center_lng double precision DEFAULT 78.1384,
  radius_meters double precision DEFAULT 500,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT geofence_zones_pkey PRIMARY KEY (id)
);
CREATE TABLE public.marked_attendance (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_id character varying NOT NULL,
  staff_name character varying NOT NULL,
  department character varying DEFAULT 'General'::character varying,
  date date NOT NULL DEFAULT CURRENT_DATE,
  time character varying NOT NULL,
  status character varying NOT NULL DEFAULT 'Present'::character varying CHECK (status::text = ANY (ARRAY['Present'::character varying, 'Late'::character varying, 'Absent'::character varying]::text[])),
  location character varying DEFAULT 'Main Campus, Sona College'::character varying,
  verification character varying NOT NULL DEFAULT 'Verified'::character varying,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT marked_attendance_pkey PRIMARY KEY (id)
);