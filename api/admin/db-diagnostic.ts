/**
 * Vercel Serverless Function: /api/admin/db-diagnostic
 */

import { createClient } from "@supabase/supabase-js";

function getSupabaseClient() {
  const url =
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"])) ||
    "https://qvjcxoznvhoagclbyhad.supabase.co";
  const key =
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
        process.env["SUPABASE_ANON_KEY"] ||
        process.env["VITE_SUPABASE_ANON_KEY"] ||
        process.env["VITE_SUPABASE_PUBLISHABLE_KEY"])) ||
    "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";
  if (!url || !key) return null;
  return createClient(url, key);
}

export default async function handler(req: any, res?: any) {
  const supabase = getSupabaseClient();
  let status = "ok";
  let count = 0;
  if (supabase) {
    const { data } = await supabase.from("staff").select("id", { count: "exact" });
    count = data ? data.length : 0;
  }
  const payload = { status, timestamp: new Date().toISOString(), staffCount: count };
  if (res && typeof res.json === "function") {
    return res.json(payload);
  }
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
