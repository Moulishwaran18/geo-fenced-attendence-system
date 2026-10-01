import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://qvjcxoznvhoagclbyhad.supabase.co";
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";

console.log("Connecting to Supabase...");
console.log("URL:", SUPABASE_URL);
console.log("Key Prefix:", SUPABASE_KEY.slice(0, 20) + "...");

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testConnection() {
  try {
    // Attempt to query staff or get health
    const { data, error, status } = await supabase.from("staff").select("count", { count: "exact", head: true });
    
    console.log("Response HTTP Status:", status);
    if (error) {
      if (error.code === "PGRST205" || error.message.includes("does not exist") || error.code === "42P01") {
        console.log("✓ Connection successful! (Table 'staff' has not been created yet in Supabase SQL editor).");
        console.log("Please run the schema script in the Supabase SQL editor to create the tables.");
      } else {
        console.log("Supabase response status/message:", error.message, "(code: " + error.code + ")");
        console.log("✓ API endpoint reached successfully!");
      }
    } else {
      console.log("✓ Connection verified successfully! Staff table exists. Count:", data);
    }
  } catch (err) {
    console.error("Connection error:", err.message);
  }
}

testConnection();
