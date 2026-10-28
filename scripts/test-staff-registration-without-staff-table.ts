// Set environment for test
process.env["NODE_ENV"] = "test";
process.env["SUPABASE_URL"] = "https://gcpuuvhydtgmcpiumpfa.supabase.co";
process.env["SUPABASE_ANON_KEY"] = "mock_anon_key_for_testing";
process.env["SUPABASE_SERVICE_ROLE_KEY"] = "mock_service_role_key_for_testing";
process.env["STAFF_REGISTRATION_CODE"] = "staff@123";

// In-memory table for registered_devices
interface RegDevRow {
  id: string;
  staff_id: string;
  staff_code: string;
  staff_name: string;
  department: string;
  device_id: string;
  status: string;
  email?: string;
  designation?: string;
  active?: boolean;
  registered_at: string;
  created_at: string;
  updated_at: string;
}

const registeredDevicesStore: RegDevRow[] = [];

// Intercept global fetch for Supabase REST endpoints
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

  // Intercept Supabase REST requests
  if (urlStr.includes("gcpuuvhydtgmcpiumpfa.supabase.co/rest/v1/")) {
    const parsedUrl = new URL(urlStr);
    const pathname = parsedUrl.pathname;
    const method = (init?.method || "GET").toUpperCase();

    // 1. Requests to /rest/v1/staff ALWAYS return PGRST205: "Could not find the table 'public.staff' in the schema cache"
    if (pathname.includes("/staff")) {
      return new Response(
        JSON.stringify({
          code: "PGRST205",
          details: null,
          hint: null,
          message: "Could not find the table 'public.staff' in the schema cache",
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // 2. Requests to /rest/v1/devices
    if (pathname.includes("/devices")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. Requests to /rest/v1/security_events
    if (pathname.includes("/security_events")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 4. Requests to /rest/v1/registered_devices
    if (pathname.includes("/registered_devices")) {
      const searchParams = parsedUrl.searchParams;

      // Handle POST / Upsert
      if (method === "POST") {
        const bodyText = typeof init?.body === "string" ? init.body : "{}";
        const payload = JSON.parse(bodyText);
        const rows = Array.isArray(payload) ? payload : [payload];
        const results: RegDevRow[] = [];

        for (const row of rows) {
          const staffKey = (row.staff_id || row.staff_code || "").toUpperCase();
          const devId = (row.device_id || "").trim();

          // Check unique constraints:
          // Rule 2: device_id uniqueness
          if (devId && !devId.startsWith("DEV_PENDING_")) {
            const devConflict = registeredDevicesStore.find(
              (r) => r.device_id === devId && r.staff_id?.toUpperCase() !== staffKey
            );
            if (devConflict) {
              return new Response(
                JSON.stringify({
                  code: "23505",
                  message: `duplicate key value violates unique constraint "uq_registered_devices_device"`,
                }),
                { status: 409, headers: { "Content-Type": "application/json" } }
              );
            }
          }

          const existingIdx = registeredDevicesStore.findIndex(
            (r) => (r.staff_id || "").toUpperCase() === staffKey
          );

          const now = new Date().toISOString();
          if (existingIdx >= 0) {
            registeredDevicesStore[existingIdx] = {
              ...registeredDevicesStore[existingIdx]!,
              ...row,
              updated_at: now,
            };
            results.push(registeredDevicesStore[existingIdx]!);
          } else {
            const newRow: RegDevRow = {
              id: `uuid-${Date.now()}-${Math.random().toString().slice(2, 6)}`,
              staff_id: staffKey,
              staff_code: staffKey,
              staff_name: row.staff_name || "",
              department: row.department || "General",
              device_id: devId,
              status: row.status || "Active",
              email: row.email,
              designation: row.designation || "Staff",
              active: row.active !== undefined ? row.active : true,
              registered_at: now,
              created_at: now,
              updated_at: now,
            };
            registeredDevicesStore.push(newRow);
            results.push(newRow);
          }
        }

        const preferHeader = init?.headers ? (init.headers as any)["Prefer"] || (init.headers as any)["prefer"] || "" : "";
        const isSingleReturn = preferHeader.includes("return=representation");
        return new Response(JSON.stringify(isSingleReturn ? results[0] : results), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Handle PATCH (status toggle)
      if (method === "PATCH") {
        const bodyText = typeof init?.body === "string" ? init.body : "{}";
        const updates = JSON.parse(bodyText);
        // Apply to matching items
        let updatedRow: any = null;
        for (const row of registeredDevicesStore) {
          Object.assign(row, updates);
          updatedRow = row;
          break;
        }
        return new Response(JSON.stringify(updatedRow ? [updatedRow] : []), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Handle GET
      let filtered = [...registeredDevicesStore];

      for (const [key, val] of searchParams.entries()) {
        if ((key === "staff_id" || key === "staff_code") && val.startsWith("ilike.")) {
          const matchVal = val.replace("ilike.", "").toUpperCase();
          filtered = filtered.filter((r) => (r.staff_code || r.staff_id || "").toUpperCase() === matchVal);
        } else if (key === "device_id" && val.startsWith("eq.")) {
          const matchVal = val.replace("eq.", "");
          filtered = filtered.filter((r) => r.device_id === matchVal);
        } else if (key === "is_active" && val.startsWith("eq.")) {
          const matchVal = val.replace("eq.", "") === "true";
          filtered = filtered.filter((r) => (r.is_active !== undefined ? r.is_active : true) === matchVal);
        } else if (key === "status" && val.startsWith("eq.")) {
          const matchVal = val.replace("eq.", "");
          filtered = filtered.filter((r) => r.status === matchVal);
        } else if (key === "or") {
          // e.g. (staff_id.ilike.CODE,staff_code.ilike.CODE)
          const cleanExpr = val.replace(/^\(/, "").replace(/\)$/, "");
          const subExprs = cleanExpr.split(",");
          filtered = filtered.filter((r) => {
            return subExprs.some((sub) => {
              if (sub.includes(".ilike.")) {
                const [c, v] = sub.split(".ilike.");
                return ((r as any)[c!] || "").toUpperCase() === (v || "").toUpperCase();
              }
              if (sub.includes(".eq.")) {
                const [c, v] = sub.split(".eq.");
                return String((r as any)[c!]) === String(v);
              }
              return false;
            });
          });
        }
      }

      return new Response(JSON.stringify(filtered), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  return originalFetch(input, init);
};

// Now import handlers which will call Supabase
import adminStaffHandler from "../api/admin/staff/index";
import staffRegisterHandler from "../api/staff/register";

console.log("=================================================================");
console.log("   CAMPUSATTEND — STAFF REGISTRATION WITHOUT 'public.staff'      ");
console.log("=================================================================\n");

let passed = 0;
let total = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    console.error(`  ✗ FAIL: ${testName} - ${detail || "Condition not met"}`);
  }
}

function createMockReqRes(options: {
  method: string;
  url: string;
  body?: any;
  headers?: Record<string, string>;
}) {
  let statusCode = 200;
  let responseBody: any = null;
  const headers: Record<string, string> = {};

  const req = {
    method: options.method,
    url: options.url,
    body: options.body,
    headers: {
      "x-internal-test": "true",
      ...(options.headers || {}),
    },
    json: async () => options.body,
  };

  const res = {
    statusCode: 200,
    setHeader: (name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    },
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (payload: any) => {
      responseBody = payload;
      return res;
    },
    end: (str?: string) => {
      if (str && !responseBody) {
        try {
          responseBody = JSON.parse(str);
        } catch {
          responseBody = str;
        }
      }
    },
  };

  return {
    req,
    res,
    getStatusCode: () => statusCode,
    getBody: () => responseBody,
  };
}

async function runTests() {
  console.log("--- TEST 1: Admin Staff Registration with Device ID ---");
  const testStaffCode1 = `TEST_STF_001`;
  const testDevId1 = `DEV_ANDROID_PHONE_001`;

  const mock1 = createMockReqRes({
    method: "POST",
    url: "/api/admin/staff",
    body: {
      staff_code: testStaffCode1,
      name: "Dr. Schema Independence",
      email: "independence@sonatech.ac.in",
      department: "Artificial Intelligence & Data Science",
      designation: "Associate Professor",
      device_id: testDevId1,
    },
  });

  await adminStaffHandler(mock1.req, mock1.res);
  const status1 = mock1.getStatusCode();
  const body1 = mock1.getBody();

  assert(status1 === 201, "Admin staff registration returns HTTP 201 Created", `Got status ${status1}, body: ${JSON.stringify(body1)}`);
  assert(body1?.success === true, "Response indicates success = true");
  assert(body1?.data?.staff_code === testStaffCode1, "Staff code matches created staff");
  assert(body1?.data?.device_id === testDevId1, "Device ID matches bound device");
  assert(
    !body1?.error?.includes("Could not find the table 'public.staff'"),
    "No schema cache error for public.staff"
  );

  console.log("\n--- TEST 2: Admin Staff Registration without Device ID (Pending) ---");
  const testStaffCode2 = `TEST_STF_NODEV`;

  const mock2 = createMockReqRes({
    method: "POST",
    url: "/api/admin/staff",
    body: {
      staff_code: testStaffCode2,
      name: "Prof. Device Pending",
      email: "pending@sonatech.ac.in",
      department: "Computer Science and Engineering",
      designation: "Assistant Professor",
    },
  });

  await adminStaffHandler(mock2.req, mock2.res);
  const status2 = mock2.getStatusCode();
  const body2 = mock2.getBody();

  assert(status2 === 201, "Staff creation without initial device ID returns HTTP 201 Created", `Got status ${status2}, body: ${JSON.stringify(body2)}`);
  assert(body2?.success === true, "Response indicates success = true");
  assert(body2?.data?.status === "Pending", "Staff record status initialized to Pending");
  assert(body2?.data?.device_id?.startsWith("DEV_PENDING_"), "Deterministic pending device identifier assigned");

  console.log("\n--- TEST 3: Rule 1 — Duplicate Device Registration for Same Staff Blocked ---");
  const mock3 = createMockReqRes({
    method: "POST",
    url: "/api/admin/staff",
    body: {
      staff_code: testStaffCode1,
      name: "Dr. Schema Independence",
      email: "independence@sonatech.ac.in",
      department: "Artificial Intelligence & Data Science",
      device_id: "DEV_ANDROID_DIFFERENT_PHONE",
    },
  });

  await adminStaffHandler(mock3.req, mock3.res);
  const status3 = mock3.getStatusCode();
  const body3 = mock3.getBody();

  assert(status3 === 409, "Second active device for same faculty returns HTTP 409 Conflict");
  assert(body3?.code === "DEVICE_ALREADY_EXISTS", "Error code is DEVICE_ALREADY_EXISTS");

  console.log("\n--- TEST 4: Rule 2 — Same Device ID Bound to Another Staff Blocked ---");
  const testStaffCode3 = `TEST_STF_CONFLICT`;
  const mock4 = createMockReqRes({
    method: "POST",
    url: "/api/admin/staff",
    body: {
      staff_code: testStaffCode3,
      name: "Dr. Conflicting Faculty",
      email: "conflict@sonatech.ac.in",
      department: "Information Technology",
      device_id: testDevId1, // Same device already bound to testStaffCode1
    },
  });

  await adminStaffHandler(mock4.req, mock4.res);
  const status4 = mock4.getStatusCode();
  const body4 = mock4.getBody();

  assert(status4 === 409, "Binding already-registered physical device returns HTTP 409 Conflict");
  assert(body4?.code === "DEVICE_BOUND_TO_ANOTHER_ACCOUNT", "Error code is DEVICE_BOUND_TO_ANOTHER_ACCOUNT");

  console.log("\n--- TEST 5: GET /api/admin/staff returns registered staff ---");
  const mock5 = createMockReqRes({
    method: "GET",
    url: "/api/admin/staff",
  });

  await adminStaffHandler(mock5.req, mock5.res);
  const status5 = mock5.getStatusCode();
  const body5 = mock5.getBody();

  assert(status5 === 200, "GET /api/admin/staff returns HTTP 200 OK");
  assert(body5?.success === true, "Response indicates success = true");
  assert(Array.isArray(body5?.data), "Data is an array of staff members");
  assert(body5?.data?.length >= 2, "Array contains created staff members");
  assert(
    !body5?.error?.includes("Could not find the table 'public.staff'"),
    "No schema cache error for public.staff on GET"
  );

  console.log("\n--- TEST 6: Staff Self-Registration (/api/staff/register) ---");
  const selfStaffCode = `SELF_STF_001`;
  const mock6 = createMockReqRes({
    method: "POST",
    url: "/api/staff/register",
    body: {
      staff_code: selfStaffCode,
      name: "Self Registered Faculty",
      department: "Mechanical Engineering",
      password: "StrongPassword@123",
      confirmPassword: "StrongPassword@123",
      registrationCode: "staff@123",
      deviceId: "DEV_SELF_PHONE_001",
    },
  });

  await staffRegisterHandler(mock6.req, mock6.res);
  const status6 = mock6.getStatusCode();
  const body6 = mock6.getBody();

  assert(status6 === 201, "Self-registration returns HTTP 201 Created", `Got status ${status6}, body: ${JSON.stringify(body6)}`);
  assert(body6?.success === true, "Self-registration succeeds");
  assert(body6?.staff?.staff_code === selfStaffCode, "Self-registered staff code matches");
  assert(
    !body6?.error?.includes("Could not find the table 'public.staff'"),
    "No schema cache error for public.staff on self-registration"
  );

  console.log(`\n=================================================================`);
  console.log(`   TEST RESULTS: ${passed} / ${total} PASSED`);
  console.log(`=================================================================`);

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution exception:", err);
  process.exit(1);
});

