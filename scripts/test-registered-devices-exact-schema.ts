// Comprehensive verification for CampusAttend with exact 9-column public.registered_devices schema
process.env["NODE_ENV"] = "test";
process.env["SUPABASE_URL"] = "https://gcpuuvhydtgmcpiumpfa.supabase.co";
process.env["SUPABASE_ANON_KEY"] = "mock_anon_key_for_testing";
process.env["SUPABASE_SERVICE_ROLE_KEY"] = "mock_service_role_key_for_testing";
process.env["STAFF_REGISTRATION_CODE"] = "staff@123";

// EXACT 9 COLUMNS ONLY
interface RegisteredDeviceRow {
  id: string;
  staff_code: string;
  staff_name: string;
  department: string;
  device_id: string;
  device_locked: boolean;
  is_active: boolean;
  registered_at: string;
  updated_at: string;
}

const mockRegisteredDevices: RegisteredDeviceRow[] = [];

// Intercept global fetch for Supabase REST endpoints
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

  if (urlStr.includes("gcpuuvhydtgmcpiumpfa.supabase.co/rest/v1/")) {
    const parsedUrl = new URL(urlStr);
    const pathname = parsedUrl.pathname;
    const method = (init?.method || "GET").toUpperCase();

    // 1. Requests to /rest/v1/staff ALWAYS return PGRST205 schema cache error
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

    // 2. Devices table (legacy/optional)
    if (pathname.includes("/devices")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. Security events table
    if (pathname.includes("/security_events")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 4. registered_devices table (EXACT 9 COLUMNS)
    if (pathname.includes("/registered_devices")) {
      const searchParams = parsedUrl.searchParams;

      // Handle POST / Upsert
      if (method === "POST") {
        const bodyText = typeof init?.body === "string" ? init.body : "{}";
        const payload = JSON.parse(bodyText);
        const rows = Array.isArray(payload) ? payload : [payload];
        const results: RegisteredDeviceRow[] = [];

        for (const row of rows) {
          const sCode = (row.staff_code || "").trim().toUpperCase();
          const devId = (row.device_id || "").trim();

          // Validate that no unexpected/nonexistent columns are sent
          const allowedKeys = new Set([
            "id",
            "staff_code",
            "staff_name",
            "department",
            "device_id",
            "device_locked",
            "is_active",
            "registered_at",
            "updated_at",
          ]);
          for (const key of Object.keys(row)) {
            if (!allowedKeys.has(key)) {
              return new Response(
                JSON.stringify({
                  code: "42703",
                  message: `column "${key}" of relation "registered_devices" does not exist`,
                }),
                { status: 400, headers: { "Content-Type": "application/json" } }
              );
            }
          }

          // Rule 2: device_id uniqueness
          if (devId && !devId.startsWith("DEV_PENDING_")) {
            const devConflict = mockRegisteredDevices.find(
              (r) => r.device_id === devId && r.staff_code.toUpperCase() !== sCode
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

          const existingIdx = mockRegisteredDevices.findIndex(
            (r) => r.staff_code.toUpperCase() === sCode
          );

          const now = new Date().toISOString();
          if (existingIdx >= 0) {
            mockRegisteredDevices[existingIdx] = {
              ...mockRegisteredDevices[existingIdx]!,
              ...row,
              staff_code: sCode,
              updated_at: now,
            };
            results.push(mockRegisteredDevices[existingIdx]!);
          } else {
            const newRow: RegisteredDeviceRow = {
              id: row.id || `uuid-${Date.now()}-${Math.random().toString().slice(2, 6)}`,
              staff_code: sCode,
              staff_name: row.staff_name || "",
              department: row.department || "General",
              device_id: devId,
              device_locked: row.device_locked !== undefined ? row.device_locked : true,
              is_active: row.is_active !== undefined ? row.is_active : true,
              registered_at: row.registered_at || now,
              updated_at: now,
            };
            mockRegisteredDevices.push(newRow);
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

      // Handle PATCH (updates)
      if (method === "PATCH") {
        const bodyText = typeof init?.body === "string" ? init.body : "{}";
        const updates = JSON.parse(bodyText);

        let updatedRows: RegisteredDeviceRow[] = [];
        let filterStaffCode: string | null = null;

        for (const [key, val] of searchParams.entries()) {
          if (key === "staff_code" && val.startsWith("ilike.")) {
            filterStaffCode = val.replace("ilike.", "").toUpperCase();
          } else if (key === "staff_code" && val.startsWith("eq.")) {
            filterStaffCode = val.replace("eq.", "").toUpperCase();
          }
        }

        for (const r of mockRegisteredDevices) {
          if (!filterStaffCode || r.staff_code.toUpperCase() === filterStaffCode) {
            Object.assign(r, updates);
            updatedRows.push(r);
          }
        }

        return new Response(JSON.stringify(updatedRows), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Handle GET
      let filtered = [...mockRegisteredDevices];

      for (const [key, val] of searchParams.entries()) {
        if (key === "staff_code" && val.startsWith("ilike.")) {
          const matchVal = val.replace("ilike.", "").toUpperCase();
          filtered = filtered.filter((r) => r.staff_code.toUpperCase() === matchVal);
        } else if (key === "staff_code" && val.startsWith("eq.")) {
          const matchVal = val.replace("eq.", "").toUpperCase();
          filtered = filtered.filter((r) => r.staff_code.toUpperCase() === matchVal);
        } else if (key === "device_id" && val.startsWith("eq.")) {
          const matchVal = val.replace("eq.", "");
          filtered = filtered.filter((r) => r.device_id === matchVal);
        } else if (key === "is_active" && val.startsWith("eq.")) {
          const matchVal = val.replace("eq.", "") === "true";
          filtered = filtered.filter((r) => r.is_active === matchVal);
        } else if (key === "device_locked" && val.startsWith("eq.")) {
          const matchVal = val.replace("eq.", "") === "true";
          filtered = filtered.filter((r) => r.device_locked === matchVal);
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

// Import backend handlers
import adminStaffHandler from "../api/admin/staff/index";
import staffLoginHandler from "../api/staff/login";
import staffRegisterHandler from "../api/staff/register";

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

async function runExactSchemaTests() {
  console.log("=================================================================");
  console.log(" CAMPUSATTEND — EXACT 9-COLUMN REGISTERED_DEVICES VERIFICATION   ");
  console.log("=================================================================\n");

  // TEST 1: Admin registers staff member with device_id
  console.log("--- TEST 1: Admin Staff Registration (9 Columns) ---");
  const staff1 = "FAC_CSE_101";
  const device1 = "DEVICE_PIXEL_8_ABC123";

  const mock1 = createMockReqRes({
    method: "POST",
    url: "/api/admin/staff",
    body: {
      staff_code: staff1,
      name: "Dr. Alan Turing",
      email: "aturing@sonatech.ac.in",
      department: "Computer Science",
      device_id: device1,
    },
  });

  await adminStaffHandler(mock1.req, mock1.res);
  const status1 = mock1.getStatusCode();
  const body1 = mock1.getBody();

  assert(status1 === 201, "Admin staff registration returns HTTP 201 Created", `Status ${status1}`);
  assert(body1?.success === true, "Response indicates success = true");
  assert(body1?.data?.staff_code === staff1, "Staff code matches registered staff");
  assert(body1?.data?.device_id === device1, "Device ID bound in response");

  const storedRow1 = mockRegisteredDevices.find((r) => r.staff_code === staff1);
  assert(!!storedRow1, "Record exists in mock public.registered_devices");
  assert(storedRow1?.device_locked === true, "device_locked default is true");
  assert(storedRow1?.is_active === true, "is_active default is true");
  assert(storedRow1?.department === "Computer Science", "department correctly saved");

  // TEST 2: Registration without Device ID (Assigns DEV_PENDING_)
  console.log("\n--- TEST 2: Staff Registration without Initial Device ID ---");
  const staff2 = "FAC_ECE_202";
  const mock2 = createMockReqRes({
    method: "POST",
    url: "/api/admin/staff",
    body: {
      staff_code: staff2,
      name: "Prof. Claude Shannon",
      email: "cshannon@sonatech.ac.in",
      department: "Electronics & Communication",
    },
  });

  await adminStaffHandler(mock2.req, mock2.res);
  const status2 = mock2.getStatusCode();
  const body2 = mock2.getBody();

  assert(status2 === 201, "Staff registration without device returns HTTP 201 Created", `Status ${status2}, body: ${JSON.stringify(body2)}`);
  assert(body2?.data?.device_id?.startsWith("DEV_PENDING_"), "Deterministic DEV_PENDING_ assigned");

  // TEST 3: Rule 1 — Duplicate Staff Code Registration Blocked
  console.log("\n--- TEST 3: Rule 1 Enforcement (One Device per Staff) ---");
  const mock3 = createMockReqRes({
    method: "POST",
    url: "/api/admin/staff",
    body: {
      staff_code: staff1,
      name: "Dr. Alan Turing Duplicate",
      email: "turing2@sonatech.ac.in",
      department: "Computer Science",
      device_id: "DEVICE_DIFFERENT_XYZ",
    },
  });

  await adminStaffHandler(mock3.req, mock3.res);
  const status3 = mock3.getStatusCode();
  const body3 = mock3.getBody();

  assert(status3 === 409, "Duplicate staff registration returns HTTP 409 Conflict", `Status ${status3}, body: ${JSON.stringify(body3)}`);
  assert(body3?.code === "DEVICE_ALREADY_EXISTS", "Error code is DEVICE_ALREADY_EXISTS");

  // TEST 4: Rule 2 — Same Device Bound to Another Account Blocked
  console.log("\n--- TEST 4: Rule 2 Enforcement (One Staff per Device) ---");
  const staff3 = "FAC_MECH_303";
  const mock4 = createMockReqRes({
    method: "POST",
    url: "/api/admin/staff",
    body: {
      staff_code: staff3,
      name: "Prof. Nikola Tesla",
      email: "ntesla@sonatech.ac.in",
      department: "Mechanical",
      device_id: device1, // Already bound to staff1
    },
  });

  await adminStaffHandler(mock4.req, mock4.res);
  const status4 = mock4.getStatusCode();
  const body4 = mock4.getBody();

  assert(status4 === 409, "Binding already-registered physical device returns HTTP 409 Conflict");
  assert(body4?.code === "DEVICE_BOUND_TO_ANOTHER_ACCOUNT", "Error code is DEVICE_BOUND_TO_ANOTHER_ACCOUNT");

  // TEST 5: Login with Correct Device (Matches device_id)
  console.log("\n--- TEST 5: Login with Authorized Bound Device ---");
  const mock5 = createMockReqRes({
    method: "POST",
    url: "/api/staff/login",
    body: {
      staffId: staff1,
      password: "campusattend",
      deviceId: device1, // Correct matching device
    },
  });

  await staffLoginHandler(mock5.req, mock5.res);
  const status5 = mock5.getStatusCode();
  const body5 = mock5.getBody();

  assert(status5 === 200, "Login with matching device returns HTTP 200 OK", `Status ${status5}, body: ${JSON.stringify(body5)}`);
  assert(body5?.success === true, "Login successful");
  assert(body5?.staff?.staff_code === staff1, "Authenticated staff code matches");

  // TEST 6: Login with Wrong Device (Device Mismatch Rejection)
  console.log("\n--- TEST 6: Login with Unauthorized / Wrong Device ---");
  const mock6 = createMockReqRes({
    method: "POST",
    url: "/api/staff/login",
    body: {
      staffId: staff1,
      password: "campusattend",
      deviceId: "DEVICE_UNAUTHORIZED_ROGUE_PHONE", // Wrong device
    },
  });

  await staffLoginHandler(mock6.req, mock6.res);
  const status6 = mock6.getStatusCode();
  const body6 = mock6.getBody();

  assert(status6 === 403, "Login with wrong device returns HTTP 403 Forbidden");
  assert(body6?.code === "DEVICE_MISMATCH" || body6?.error === "DEVICE_MISMATCH", "Error is DEVICE_MISMATCH");

  // TEST 7: Inactive Account Login Rejection (is_active === false)
  console.log("\n--- TEST 7: Inactive Account Login Rejection (is_active: false) ---");
  // Set is_active to false
  const rowToDeactivate = mockRegisteredDevices.find((r) => r.staff_code === staff1);
  if (rowToDeactivate) rowToDeactivate.is_active = false;

  const mock7 = createMockReqRes({
    method: "POST",
    url: "/api/staff/login",
    body: {
      staffId: staff1,
      password: "campusattend",
      deviceId: device1,
    },
  });

  await staffLoginHandler(mock7.req, mock7.res);
  const status7 = mock7.getStatusCode();
  const body7 = mock7.getBody();

  assert(status7 === 403, "Login for deactivated staff returns HTTP 403 Forbidden");
  assert(body7?.error === "ACCOUNT_DEACTIVATED", "Error code is ACCOUNT_DEACTIVATED");

  // Restore is_active
  if (rowToDeactivate) rowToDeactivate.is_active = true;

  // TEST 8: Locked Account Login Rejection (device_locked === false)
  console.log("\n--- TEST 8: Locked Account Login Rejection (device_locked: false) ---");
  if (rowToDeactivate) rowToDeactivate.device_locked = false;

  const mock8 = createMockReqRes({
    method: "POST",
    url: "/api/staff/login",
    body: {
      staffId: staff1,
      password: "campusattend",
      deviceId: device1,
    },
  });

  await staffLoginHandler(mock8.req, mock8.res);
  const status8 = mock8.getStatusCode();
  const body8 = mock8.getBody();

  assert(status8 === 403, "Login for unlocked/disabled device returns HTTP 403 Forbidden");
  assert(body8?.error === "ACCOUNT_LOCKED", "Error code is ACCOUNT_LOCKED");

  // Restore device_locked
  if (rowToDeactivate) rowToDeactivate.device_locked = true;

  // TEST 9: Staff Self-Registration (/api/staff/register)
  console.log("\n--- TEST 9: Staff Self-Registration into registered_devices ---");
  const selfStaff = "FAC_CIVIL_404";
  const selfDevice = "DEVICE_ONEPLUS_CIVIL";

  const mock9 = createMockReqRes({
    method: "POST",
    url: "/api/staff/register",
    body: {
      staff_code: selfStaff,
      name: "Prof. Ada Lovelace",
      department: "Civil Engineering",
      password: "SafePassword@123",
      confirmPassword: "SafePassword@123",
      registrationCode: "staff@123",
      deviceId: selfDevice,
    },
  });

  await staffRegisterHandler(mock9.req, mock9.res);
  const status9 = mock9.getStatusCode();
  const body9 = mock9.getBody();

  assert(status9 === 201, "Self registration returns HTTP 201 Created", `Status ${status9}`);
  assert(body9?.success === true, "Self registration success");

  const storedSelfRow = mockRegisteredDevices.find((r) => r.staff_code === selfStaff);
  assert(!!storedSelfRow, "Self-registered row saved in public.registered_devices");
  assert(storedSelfRow?.device_id === selfDevice, "Device ID bound in database");
  assert(storedSelfRow?.is_active === true, "Self-registered is_active is true");
  assert(storedSelfRow?.device_locked === true, "Self-registered device_locked is true");

  // TEST 10: Admin Staff Directory Query
  console.log("\n--- TEST 10: GET /api/admin/staff Queries registered_devices ---");
  const mock10 = createMockReqRes({
    method: "GET",
    url: "/api/admin/staff",
  });

  await adminStaffHandler(mock10.req, mock10.res);
  const status10 = mock10.getStatusCode();
  const body10 = mock10.getBody();

  assert(status10 === 200, "Admin staff listing returns HTTP 200 OK");
  assert(Array.isArray(body10?.data), "Staff data is an array");
  assert(body10?.data?.length >= 3, "Contains registered staff members");

  console.log(`\n=================================================================`);
  console.log(`   FINAL RESULTS: ${passed} / ${total} TESTS PASSED`);
  console.log(`=================================================================`);

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runExactSchemaTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
