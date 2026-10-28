import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://gcpuuvhydtgmcpiumpfa.supabase.co";
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function runInspection() {
  const { data: staffList, error: sErr } = await supabase
    .from("staff")
    .select("id, staff_code, name, email, department, designation, device_status, status, active, inside_campus, device, created_at, updated_at")
    .order("created_at", { ascending: true });

  if (sErr) {
    console.error("Error fetching staff:", sErr);
    return;
  }

  const { data: attList } = await supabase.from("attendance_records").select("staff_code");
  const { data: secList } = await supabase.from("security_events").select("staff, result, event");
  const { data: devList } = await supabase.from("devices").select("staff_code, staff_id");
  const { data: embList } = await supabase.from("face_embeddings").select("staff_id");

  const attMap = {};
  (attList || []).forEach(a => attMap[a.staff_code] = (attMap[a.staff_code] || 0) + 1);

  const secMap = {};
  (secList || []).forEach(s => secMap[s.staff] = (secMap[s.staff] || 0) + 1);

  const devMap = {};
  (devList || []).forEach(d => {
    if (d.staff_code) devMap[d.staff_code] = (devMap[d.staff_code] || 0) + 1;
  });

  const embMap = {};
  (embList || []).forEach(e => {
    if (e.staff_id) embMap[e.staff_id] = (embMap[e.staff_id] || 0) + 1;
  });

  console.log(`TOTAL RECORDS IN public.staff: ${staffList.length}`);
  console.log("------------------------------------------------------------------------------------------------------------------------");
  console.log(
    "Index".padEnd(6) +
    "Staff Code".padEnd(18) +
    "Name".padEnd(28) +
    "Department".padEnd(30) +
    "Email Domain".padEnd(20) +
    "Created At".padEnd(26) +
    "Auth Set".padEnd(10) +
    "Att".padEnd(5) +
    "Sec".padEnd(5)
  );
  console.log("------------------------------------------------------------------------------------------------------------------------");

  staffList.forEach((s, idx) => {
    const hasAuth = !!(s.device && s.device.startsWith("auth:pbkdf2$"));
    const emailDomain = s.email ? s.email.split("@")[1] || s.email : "N/A";
    const attCount = attMap[s.staff_code] || 0;
    const secCount = secMap[s.staff_code] || 0;

    console.log(
      String(idx + 1).padEnd(6) +
      String(s.staff_code).padEnd(18) +
      String(s.name).padEnd(28) +
      String(s.department).padEnd(30) +
      String(emailDomain).padEnd(20) +
      String(s.created_at).padEnd(26) +
      String(hasAuth).padEnd(10) +
      String(attCount).padEnd(5) +
      String(secCount).padEnd(5)
    );
  });
}

runInspection().catch(console.error);
