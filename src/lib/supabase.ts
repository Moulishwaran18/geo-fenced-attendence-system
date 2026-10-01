import { createClient } from "@supabase/supabase-js";

// Helper to retrieve environment variables in both Vite/browser and Node/SSR environments
const getEnvVar = (key: string): string => {
  if (typeof import.meta !== "undefined" && import.meta.env && import.meta.env[key]) {
    return import.meta.env[key] as string;
  }
  if (typeof process !== "undefined" && process.env && process.env[key]) {
    return process.env[key] as string;
  }
  return "";
};

const supabaseUrl =
  getEnvVar("VITE_SUPABASE_URL") ||
  getEnvVar("SUPABASE_URL") ||
  "https://qvjcxoznvhoagclbyhad.supabase.co";

const supabaseKey =
  getEnvVar("VITE_SUPABASE_PUBLISHABLE_KEY") ||
  getEnvVar("VITE_SUPABASE_ANON_KEY") ||
  getEnvVar("SUPABASE_ANON_KEY") ||
  "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    "[Supabase] Missing Supabase URL or Publishable Key. Please check your .env configuration.",
  );
}

/**
 * Universal Supabase Client
 */
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

// Database Type Definitions
export interface Staff {
  id: string;
  staff_code: string;
  name: string;
  email: string;
  department: string;
  designation: string;
  phone?: string;
  device?: string;
  device_status?: "Active" | "Pending" | "Blocked";
  status?: "Active" | "Inactive";
  active: boolean;
  inside_campus?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface FaceEmbedding {
  id: string;
  staff_id: string;
  embedding: number[];
  reference_image_path: string;
  photo_data?: string;
  created_at?: string;
}

export interface FaceDetectionLog {
  id?: string;
  user_id: string;
  name: string;
  email: string;
  detected_at?: string;
  server_date?: string;
  server_time?: string;
  confidence?: number;
  created_at?: string;
}

export interface AttendanceRecord {
  id?: string;
  staff_code: string;
  staff_name: string;
  department: string;
  date?: string;
  day: string;
  time: string;
  status: "Present" | "Late" | "Absent";
  location: string;
  verification: "Verified" | "Failed" | "Manual";
  latitude?: number;
  longitude?: number;
  device_id?: string;
  created_at?: string;
}

export interface SecurityEvent {
  id?: string;
  time: string;
  staff: string;
  event: string;
  device: string;
  location: string;
  result: "Blocked" | "Allowed" | "Flagged";
  severity: "Low" | "Medium" | "High";
  created_at?: string;
}

export interface Device {
  id: string;
  staff_id?: string;
  staff_code?: string;
  staff_name?: string;
  model: string;
  os: string;
  status: "Active" | "Pending" | "Blocked";
  registered_at?: string;
}

export interface GeofenceZone {
  id?: string;
  name: string;
  campus_name?: string;
  polygon_coords: string;
  center_lat?: number;
  center_lng?: number;
  radius_meters?: number;
  active: boolean;
  created_at?: string;
}
