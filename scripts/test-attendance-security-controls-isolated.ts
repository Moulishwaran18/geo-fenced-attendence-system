process.env["SUPABASE_URL"] = process.env["SUPABASE_URL"] || "https://gcpuuvhydtgmcpiumpfa.supabase.co";
/**
 * CampusAttend — Isolated Local Attendance Security Controls Test Suite
 *
 * Covers all required checks from User Prompt without external database dependency:
 * 1. Missing production service-role credentials fail closed.
 * 2. Publishable keys ('sb_publishable_...') rejected in production.
 * 3. Anonymous keys strictly prevented from fallback in production.
 * 4. Missing HMAC secret fails closed outside isolated test mode.
 * 5. Low-entropy HMAC secret (< 32 chars) fails closed in production.
 * 6. Successful authenticated attendance insertion with confirmed record ID.
 * 7. Server returns 500 on database insertion error (NO mock success).
 * 8. Duplicate daily attendance prevention (Idempotency).
 * 9. Device signature validation with registered device public key.
 * 10. 13-point campus geofence validation and accuracy threshold (<= 20m).
 *
 * RESTRICTION: 100% Local, zero network calls to production Supabase.
 */

import assert from "node:assert";
import crypto from "node:crypto";
import deviceApiHandler, {
  setCustomSupabaseClient as setDeviceCustomSupabaseClient,
} from "../api/device/index.ts";
import attendanceHandler, {
  getSupabaseClient,
  getRecordHmacSecret,
  computeRecordHmac,
  verifyRecordHmac,
  setCustomSupabaseClient,
} from "../api/attendance.ts";

function createMockReqRes({
  method = "POST",
  body = {},
  headers = {},
  url = "/api/attendance",
}: {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
  url?: string;
}) {
  const req: any = {
    method,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body,
    url,
    json: async () => body,
  };

  let statusCode = 200;
  let responseData: any = null;
  const headersSent: Record<string, string> = {};

  const res: any = {
    setHeader(name: string, val: string) {
      headersSent[name.toLowerCase()] = val;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(data: any) {
      responseData = data;
      return this;
    },
    end(str?: string) {
      if (str && !responseData) {
        try {
          responseData = JSON.parse(str);
        } catch {
          responseData = str;
        }
      }
      return this;
    },
  };

  return {
    req,
    res,
    getStatus: () => statusCode,
    getData: () => responseData,
  };
}

function mintTestStaffToken(staffCode: string, secret = "campusattend-staff-auth-session-sec-key-2026"): string {
  const payload = {
    staffId: staffCode,
    sub: staffCode,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

function mintTestWifiToken(secret = "sona-campus-wifi-egress-auth-secret-key-2026"): string {
  const payload = {
    authorized: true,
    ip: "111.92.42.18",
    ssid: "SONA-WIFI",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600_000,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

function createTestDeviceKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

function signDevicePayload(privateKeyPem: string, data: string): string {
  const signer = crypto.createSign("SHA256");
  signer.update(Buffer.from(data, "utf-8"));
  return signer.sign(privateKeyPem, "base64");
}

async function runIsolatedAttendanceSecuritySuite() {
  console.log("=================================================================");
  console.log("   CAMPUSATTEND — ISOLATED ATTENDANCE SECURITY TEST SUITE       ");
  console.log("=================================================================");

  const originalEnv = { ...process.env };

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Missing production service-role credentials fail closed
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 1: Missing SUPABASE_SERVICE_ROLE_KEY in Production ---");
    process.env["NODE_ENV"] = "production";
    delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
    delete process.env["DATABASE_URL"];

    let threwConfigFault = false;
    try {
      getSupabaseClient();
    } catch (err: any) {
      if (err.message.includes("CONFIGURATION_FAULT")) threwConfigFault = true;
    }
    assert.strictEqual(threwConfigFault, true, "getSupabaseClient() must throw CONFIGURATION_FAULT when service-role key is missing in production");

    const mock1 = createMockReqRes({
      method: "POST",
      url: "/api/attendance",
      body: { action: "request_challenge", staff_code: "SCT-TEST-001" },
    });
    await attendanceHandler(mock1.req, mock1.res);
    assert.strictEqual(mock1.getStatus(), 503, "Handler must return HTTP 503 on missing production credentials");
    assert.strictEqual(mock1.getData()?.error, "SERVER_CONFIG_FAULT", "Handler error must be SERVER_CONFIG_FAULT");
    console.log("  ✓ PASS: Missing production service-role key strictly fails closed with 503 SERVER_CONFIG_FAULT");

    // -------------------------------------------------------------------------
    // TEST 2: Publishable key ('sb_publishable_...') rejected in production
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 2: Rejection of Publishable Key in Production ---");
    process.env["NODE_ENV"] = "production";
    process.env["SUPABASE_SERVICE_ROLE_KEY"] = "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";

    let threwPublishableFault = false;
    try {
      getSupabaseClient();
    } catch (err: any) {
      if (err.message.includes("CONFIGURATION_FAULT")) threwPublishableFault = true;
    }
    assert.strictEqual(threwPublishableFault, true, "getSupabaseClient() must reject keys starting with 'sb_publishable_'");

    const mock2 = createMockReqRes({
      method: "POST",
      url: "/api/attendance",
      body: { action: "request_challenge", staff_code: "SCT-TEST-001" },
    });
    await attendanceHandler(mock2.req, mock2.res);
    assert.strictEqual(mock2.getStatus(), 503, "Handler must return HTTP 503 on publishable key supplied as service-role key");
    assert.strictEqual(mock2.getData()?.error, "SERVER_CONFIG_FAULT");
    console.log("  ✓ PASS: Publishable keys strictly rejected in production runtime");

    // -------------------------------------------------------------------------
    // TEST 3: Anonymous key fallback prevention in production
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 3: Anonymous Key Fallback Prevention in Production ---");
    process.env["NODE_ENV"] = "production";
    delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
    process.env["SUPABASE_ANON_KEY"] = "eyJh...anon_key_mock_token";
    process.env["VITE_SUPABASE_ANON_KEY"] = "eyJh...anon_key_mock_token";

    let threwAnonFault = false;
    try {
      getSupabaseClient();
    } catch (err: any) {
      if (err.message.includes("CONFIGURATION_FAULT")) threwAnonFault = true;
    }
    assert.strictEqual(threwAnonFault, true, "getSupabaseClient() must NEVER fall back to anon key in production");

    // Verify non-production mode DOES permit fallback
    process.env["NODE_ENV"] = "test";
    process.env["TEST_MODE"] = "1";
    delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
    const devClient = getSupabaseClient();
    assert.ok(devClient !== null, "In non-production test mode, anonymous client is permitted");
    console.log("  ✓ PASS: Anonymous key fallback strictly prohibited in production, permitted in local non-prod");

    // -------------------------------------------------------------------------
    // TEST 4: Missing HMAC secret fails closed
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 4: Separation of Secrets & Missing HMAC Secret ---");
    delete process.env["RECORD_HMAC_SECRET"];
    delete process.env["RECORD_HMAC_TEST_KEY"];

    // 4a: In production without secret -> returns null & fails closed
    process.env["NODE_ENV"] = "production";
    delete process.env["TEST_MODE"];
    const prodHmac = getRecordHmacSecret();
    assert.strictEqual(prodHmac, null, "In production, missing RECORD_HMAC_SECRET must return null");

    let computeThrew = false;
    try {
      computeRecordHmac({
        staff_code: "SCT-001",
        date: "2026-10-27",
        time: "10:00 AM",
        status: "Present",
        device_id: "DEV_001",
      });
    } catch (err: any) {
      if (err.message.includes("RECORD_HMAC_SECRET_MISSING")) computeThrew = true;
    }
    assert.strictEqual(computeThrew, true, "computeRecordHmac must throw RECORD_HMAC_SECRET_MISSING when secret is missing");

    // 4b: Outside test mode in development, must NOT silently use CAMPUS_ADMIN_SECRET
    process.env["NODE_ENV"] = "development";
    process.env["CAMPUS_ADMIN_SECRET"] = "admin-secret-key-that-must-not-be-used-for-hmac";
    delete process.env["TEST_MODE"];
    const devHmac = getRecordHmacSecret();
    assert.strictEqual(devHmac, null, "getRecordHmacSecret must NOT substitute CAMPUS_ADMIN_SECRET outside test mode");

    // 4c: Short secret in production (< 32 chars) fails closed
    process.env["NODE_ENV"] = "production";
    process.env["RECORD_HMAC_SECRET"] = "short-secret";
    const shortHmac = getRecordHmacSecret();
    assert.strictEqual(shortHmac, null, "Low-entropy secret (< 32 chars) must return null in production");

    // 4d: Isolated test mode permits test key
    process.env["NODE_ENV"] = "test";
    process.env["TEST_MODE"] = "1";
    delete process.env["RECORD_HMAC_SECRET"];
    process.env["RECORD_HMAC_TEST_KEY"] = "campusattend-test-isolated-hmac-secret-key-32bytes";
    const testHmac = getRecordHmacSecret();
    assert.strictEqual(testHmac, "campusattend-test-isolated-hmac-secret-key-32bytes", "Isolated test mode uses dedicated test key");
    console.log("  ✓ PASS: Strict separation of secrets enforced; missing HMAC secret fails closed");

    // -------------------------------------------------------------------------
    // TEST 5: Successful authenticated attendance insertion with confirmed record ID
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 5: Successful Authenticated Attendance Insertion ---");
    process.env["NODE_ENV"] = "test";
    process.env["TEST_MODE"] = "1";
    process.env["RECORD_HMAC_SECRET"] = "campusattend-test-isolated-hmac-secret-key-32bytes";

    const { publicKey, privateKey } = createTestDeviceKeyPair();
    const testStaffCode = "SCT-777";
    const testDeviceId = "dev-test-uuid-hardware-keystore-001";
    const testConfirmedId = "att-record-confirmed-uuid-9999-8888";

    // Set up completely isolated in-memory Mock Supabase Client
    let insertWasCalled = false;
    let insertedPayload: any = null;

    const mockSupabase = {
      from(table: string) {
        if (table === "devices") {
          return {
            select() {
              return {
                ilike() {
                  return {
                    order() {
                      return {
                        limit() {
                          return {
                            async maybeSingle() {
                              return {
                                data: {
                                  id: testDeviceId,
                                  staff_code: testStaffCode,
                                  staff_name: "Dr. Grace Hopper",
                                  public_key: publicKey,
                                  key_algorithm: "ECDSA_P256",
                                  status: "Active",
                                  registered_at: new Date().toISOString(),
                                },
                                error: null,
                              };
                            },
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "attendance_records") {
          return {
            select() {
              return {
                eq(col: string, val: any) {
                  return {
                    async maybeSingle() {
                      return {
                        data: {
                          id: val,
                          staff_code: testStaffCode,
                          date: "2026-10-28",
                          time: "10:00:00 AM",
                        },
                        error: null,
                      };
                    },
                  };
                },
                ilike() {
                  return {
                    eq() {
                      return {
                        order() {
                          return {
                            limit() {
                              return {
                                async maybeSingle() {
                                  return { data: null, error: null }; // No prior record today
                                },
                              };
                            },
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
            insert(recordData: any) {
              insertWasCalled = true;
              insertedPayload = recordData;
              return {
                select() {
                  return {
                    async single() {
                      return {
                        data: {
                          ...recordData,
                          id: testConfirmedId, // Confirmed ID returned by database
                          created_at: new Date().toISOString(),
                        },
                        error: null,
                      };
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "staff") {
          return {
            select() {
              return {
                ilike() {
                  return {
                    async maybeSingle() {
                      return {
                        data: {
                          name: "Dr. Grace Hopper",
                          department: "Computer Science",
                        },
                        error: null,
                      };
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "security_events") {
          return {
            insert() {
              return Promise.resolve({ data: null, error: null });
            },
          };
        }
        return {
          select: () => ({ ilike: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: "test" }, error: null }) }) }),
        };
      },
    };

    setCustomSupabaseClient(mockSupabase);

    // Centroid of Sona campus polygon
    const validLat = 11.6766;
    const validLng = 78.1228;
    const nowTimestamp = Date.now();
    const challengeNonce = crypto.randomBytes(16).toString("hex");

    const canonicalPayload = `v2:${testStaffCode}:${testDeviceId}:${challengeNonce}:${validLat.toFixed(6)}:${validLng.toFixed(6)}:${nowTimestamp}`;
    const validSignature = signDevicePayload(privateKey, canonicalPayload);
    const validStaffToken = mintTestStaffToken(testStaffCode);
    const validWifiToken = mintTestWifiToken();

    const punchReq = createMockReqRes({
      method: "POST",
      url: "/api/attendance",
      headers: {
        authorization: `Bearer ${validStaffToken}`,
      },
      body: {
        staffCode: testStaffCode,
        latitude: validLat,
        longitude: validLng,
        accuracy: 6.2,
        challenge: challengeNonce,
        deviceSignature: validSignature,
        deviceTimestamp: nowTimestamp,
        deviceId: testDeviceId,
        networkAuthToken: validWifiToken,
      },
    });

    await attendanceHandler(punchReq.req, punchReq.res);
    if (punchReq.getStatus() !== 200) {
      console.error("punchReq failed with status:", punchReq.getStatus(), punchReq.getData());
    }

    assert.strictEqual(punchReq.getStatus(), 200, "Valid authenticated attendance request must return HTTP 200");
    const punchData = punchReq.getData();
    assert.strictEqual(punchData.success, true, "Success must be true");
    assert.strictEqual(punchData.receipt?.attendanceId, testConfirmedId, "Returned attendanceId must match confirmed DB record ID");
    assert.strictEqual(punchData.receipt?.staffCode, testStaffCode, "Staff code must match");
    assert.strictEqual(punchData.receipt?.staffName, "Dr. Grace Hopper", "Staff name must match");
    assert.strictEqual(insertWasCalled, true, "Supabase insert must have been executed");
    assert.strictEqual(insertedPayload.staff_code, testStaffCode, "Inserted staff code must match");
    console.log("  ✓ PASS: Attendance successfully inserted into database and verified record ID returned");

    // -------------------------------------------------------------------------
    // TEST 6: Server returns 500 on database failure (NO mock success)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 6: Fail Closed on Database Persistence Error (No Mock Success) ---");
    const failingSupabase = {
      from(table: string) {
        if (table === "devices") {
          return mockSupabase.from("devices");
        }
        if (table === "attendance_records") {
          return {
            select() {
              return {
                ilike: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
              };
            },
            insert() {
              return {
                select() {
                  return {
                    async single() {
                      return {
                        data: null,
                        error: { message: "Database connection lost during write" },
                      };
                    },
                  };
                },
              };
            },
          };
        }
        return mockSupabase.from(table);
      },
    };

    setCustomSupabaseClient(failingSupabase);

    const failReq = createMockReqRes({
      method: "POST",
      url: "/api/attendance",
      headers: {
        authorization: `Bearer ${validStaffToken}`,
      },
      body: {
        staffCode: testStaffCode,
        latitude: validLat,
        longitude: validLng,
        accuracy: 6.2,
        challenge: challengeNonce,
        deviceSignature: validSignature,
        deviceTimestamp: nowTimestamp,
        deviceId: testDeviceId,
        networkAuthToken: validWifiToken,
      },
    });

    await attendanceHandler(failReq.req, failReq.res);

    assert.strictEqual(failReq.getStatus(), 500, "Persistence failure must return HTTP 500");
    assert.strictEqual(failReq.getData()?.success, false, "Success must be false on persistence failure");
    assert.strictEqual(failReq.getData()?.error, "DATABASE_PERSISTENCE_FAILED", "Error code must be DATABASE_PERSISTENCE_FAILED");
    console.log("  ✓ PASS: Database write failure strictly fails closed with HTTP 500 (zero mock success)");

    // -------------------------------------------------------------------------
    // TEST 7: Duplicate attendance prevention (Idempotency)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 7: Duplicate Daily Attendance Prevention (Idempotency) ---");
    const existingTodayRecord = {
      id: "existing-today-record-uuid-111",
      staff_code: testStaffCode,
      staff_name: "Dr. Grace Hopper",
      department: "Computer Science",
      date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
      time: "09:00:00 AM",
      record_hash: "hash123",
    };

    const duplicateSupabase = {
      from(table: string) {
        if (table === "devices") return mockSupabase.from("devices");
        if (table === "staff") return mockSupabase.from("staff");
        if (table === "attendance_records") {
          return {
            select() {
              return {
                ilike() {
                  return {
                    eq() {
                      return {
                        order() {
                          return {
                            limit() {
                              const res = { data: [existingTodayRecord], error: null };
                              return {
                                ...res,
                                then: (resolve: any) => Promise.resolve(res).then(resolve),
                                async maybeSingle() {
                                  return { data: existingTodayRecord, error: null };
                                },
                              };
                            },
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
            insert() {
              return {
                select() {
                  return {
                    async single() {
                      return { data: null, error: { message: "duplicate", code: "23505" } };
                    },
                  };
                },
              };
            },
          };
        }
        return mockSupabase.from(table);
      },
    };

    setCustomSupabaseClient(duplicateSupabase);

    const dupReq = createMockReqRes({
      method: "POST",
      url: "/api/attendance",
      headers: { authorization: `Bearer ${validStaffToken}` },
      body: {
        staffCode: testStaffCode,
        latitude: validLat,
        longitude: validLng,
        accuracy: 5.0,
        challenge: challengeNonce,
        deviceSignature: validSignature,
        deviceTimestamp: nowTimestamp,
        deviceId: testDeviceId,
        networkAuthToken: validWifiToken,
      },
    });

    await attendanceHandler(dupReq.req, dupReq.res);

    assert.strictEqual(dupReq.getStatus(), 200);
    assert.strictEqual(dupReq.getData()?.alreadyMarked, true, "Must flag alreadyMarked: true");
    assert.strictEqual(dupReq.getData()?.receipt?.attendanceId, "existing-today-record-uuid-111");
    console.log("  ✓ PASS: Duplicate punch cleanly handled as idempotent alreadyMarked without new insert");

    // -------------------------------------------------------------------------
    // TEST 8: Invalid device signature strictly rejected
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 8: Rejection of Forged / Invalid Device Signature ---");
    setCustomSupabaseClient(mockSupabase);

    const { privateKey: foreignPrivateKey } = createTestDeviceKeyPair();
    const forgedSig = signDevicePayload(foreignPrivateKey, canonicalPayload);

    const forgedReq = createMockReqRes({
      method: "POST",
      url: "/api/attendance",
      headers: { authorization: `Bearer ${validStaffToken}` },
      body: {
        staffCode: testStaffCode,
        latitude: validLat,
        longitude: validLng,
        accuracy: 5.0,
        challenge: challengeNonce,
        deviceSignature: forgedSig, // Signed by different/unregistered private key
        deviceTimestamp: nowTimestamp,
        deviceId: testDeviceId,
        networkAuthToken: validWifiToken,
      },
    });

    await attendanceHandler(forgedReq.req, forgedReq.res);

    assert.strictEqual(forgedReq.getStatus(), 403, "Forged signature must return 403 Forbidden");
    assert.strictEqual(forgedReq.getData()?.error, "INVALID_DEVICE_SIGNATURE");
    console.log("  ✓ PASS: Forged device signature strictly rejected with 403 INVALID_DEVICE_SIGNATURE");

    // -------------------------------------------------------------------------
    // TEST 9: Geofence validation rejects outside coordinates
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 9: Campus Geofence Validation Rejects Outside Coordinates ---");
    const outsideLat = 12.9716; // Bangalore (far outside Salem campus)
    const outsideLng = 77.5946;

    const outsidePayload = `v2:${testStaffCode}:${testDeviceId}:${challengeNonce}:${outsideLat.toFixed(6)}:${outsideLng.toFixed(6)}:${nowTimestamp}`;
    const outsideSig = signDevicePayload(privateKey, outsidePayload);

    const outsideReq = createMockReqRes({
      method: "POST",
      url: "/api/attendance",
      headers: { authorization: `Bearer ${validStaffToken}` },
      body: {
        staffCode: testStaffCode,
        latitude: outsideLat,
        longitude: outsideLng,
        accuracy: 5.0,
        challenge: challengeNonce,
        deviceSignature: outsideSig,
        deviceTimestamp: nowTimestamp,
        deviceId: testDeviceId,
        networkAuthToken: validWifiToken,
      },
    });

    await attendanceHandler(outsideReq.req, outsideReq.res);

    assert.strictEqual(outsideReq.getStatus(), 403, "Outside coordinates must return 403 Forbidden");
    assert.strictEqual(outsideReq.getData()?.error, "GPS_OUTSIDE_CAMPUS");
    console.log("  ✓ PASS: Coordinates outside 13-point campus polygon strictly rejected with 403 GPS_OUTSIDE_CAMPUS");

    // -------------------------------------------------------------------------
    // TEST 10: GPS Accuracy threshold (<= 20m) enforced
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 10: Enforce Maximum 20m GPS Accuracy Gate ---");
    const inaccurateReq = createMockReqRes({
      method: "POST",
      url: "/api/attendance",
      headers: { authorization: `Bearer ${validStaffToken}` },
      body: {
        staffCode: testStaffCode,
        latitude: validLat,
        longitude: validLng,
        accuracy: 45.0, // Exceeds 20m gate
        challenge: challengeNonce,
        deviceSignature: validSignature,
        deviceTimestamp: nowTimestamp,
        deviceId: testDeviceId,
        networkAuthToken: validWifiToken,
      },
    });

    await attendanceHandler(inaccurateReq.req, inaccurateReq.res);

    assert.strictEqual(inaccurateReq.getStatus(), 403, "Inaccurate GPS (> 20m) must return 403 Forbidden");
    assert.strictEqual(inaccurateReq.getData()?.error, "GPS_ACCURACY_INSUFFICIENT");
    console.log("  ✓ PASS: GPS accuracy exceeding 20m strictly rejected with 403 GPS_ACCURACY_INSUFFICIENT");

    // -------------------------------------------------------------------------
    // TEST 11: Successful device registration
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 11: Successful Device Registration Flow ---");
    process.env["NODE_ENV"] = "test";
    process.env["TEST_MODE"] = "1";

    const regStaff = "SCT-REG-001";
    const regStaffToken = mintTestStaffToken(regStaff);
    const regKeyPair = createTestDeviceKeyPair();
    const storedDevices: any[] = [];
    const storedSecurityEvents: any[] = [];
    const storedChallenges: any[] = [];

    const mockDeviceDb = {
      from(table: string) {
        if (table === "staff") {
          return {
            select() {
              return {
                ilike(col: string, val: string) {
                  return {
                    async maybeSingle() {
                      return {
                        data: {
                          id: `uuid-staff-${val.toLowerCase()}`,
                          staff_code: val.toUpperCase(),
                          name: "Registered Faculty",
                          email: `${val.toLowerCase()}@sonatech.ac.in`,
                          active: true,
                        },
                        error: null,
                      };
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "devices") {
          return {
            select() {
              return {
                ilike(col: string, val: string) {
                  return {
                    eq(col2: string, val2: string) {
                      return {
                        order() {
                          return {
                            limit() {
                              return {
                                async maybeSingle() {
                                  const found = storedDevices.find(
                                    (d) => d.staff_code?.toUpperCase() === val.toUpperCase() && d.status === val2
                                  );
                                  return { data: found || null, error: null };
                                },
                              };
                            },
                          };
                        },
                      };
                    },
                    order() {
                      return {
                        async limit() {
                          const found = storedDevices.filter(
                            (d) => d.staff_code?.toUpperCase() === val.toUpperCase()
                          );
                          return { data: found, error: null };
                        },
                      };
                    },
                  };
                },
                eq(col: string, val: string) {
                  return {
                    or(cond: string) {
                      return {
                        data: storedDevices.filter((d) => d.status === val),
                        error: null,
                      };
                    },
                  };
                },
              };
            },
            async upsert(payload: any) {
              storedDevices.push(payload);
              return { data: payload, error: null };
            },
          };
        }
        if (table === "security_events") {
          return {
            select() {
              return {
                ilike(col: string, val: string) {
                  return {
                    limit() {
                      return {
                        data: storedSecurityEvents.filter((e) => e.event?.toUpperCase() === val.toUpperCase()),
                        error: null,
                      };
                    },
                  };
                },
                eq(col: string, val: string) {
                  return {
                    limit() {
                      return {
                        data: storedSecurityEvents.filter((e) => e.event === val),
                        error: null,
                      };
                    },
                  };
                },
              };
            },
            async insert(payload: any) {
              storedSecurityEvents.push(payload);
              return { data: payload, error: null };
            },
          };
        }
        if (table === "attendance_challenges") {
          return {
            select() {
              return {
                eq(col: string, val: any) {
                  return {
                    async maybeSingle() {
                      const found = storedChallenges.find((c) => c[col] === val);
                      return { data: found || null, error: null };
                    },
                  };
                },
              };
            },
            async insert(payload: any) {
              const existing = storedChallenges.find((c) => c.challenge === payload.challenge);
              if (existing) {
                return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
              }
              storedChallenges.push({ ...payload });
              return { data: payload, error: null };
            },
            update(updateFields: any) {
              return {
                eq(col1: string, val1: any) {
                  return {
                    eq(col2: string, val2: any) {
                      return {
                        select() {
                          const foundIndex = storedChallenges.findIndex(
                            (c) => c[col1] === val1 && c[col2] === val2
                          );
                          if (foundIndex !== -1) {
                            storedChallenges[foundIndex] = {
                              ...storedChallenges[foundIndex],
                              ...updateFields,
                            };
                            return {
                              data: [{ challenge: val1 }],
                              error: null,
                            };
                          }
                          return { data: [], error: null };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        }
        return {
          select: () => ({ error: null, data: [] }),
          insert: async () => ({ error: null }),
        };
      },
    };

    setDeviceCustomSupabaseClient(mockDeviceDb);

    // 1. Request Challenge
    const chalReq = createMockReqRes({
      method: "POST",
      url: "/api/device/challenge",
      headers: { authorization: `Bearer ${regStaffToken}` },
      body: { staff_code: regStaff, action: "challenge" },
    });
    await deviceApiHandler(chalReq.req, chalReq.res);
    assert.strictEqual(chalReq.getStatus(), 200, "Device challenge must return 200 OK");
    const chalResult = chalReq.getData();
    assert.strictEqual(chalResult?.success, true);
    assert.ok(chalResult?.challenge, "Challenge nonce must be returned");
    assert.ok(chalResult?.challengeToken, "Challenge token must be returned");

    // 2. Sign Challenge Nonce with ECDSA P-256 Key
    const challengeSig = signDevicePayload(regKeyPair.privateKey, chalResult.challenge);

    // 3. Register Device
    const regDeviceReq = createMockReqRes({
      method: "POST",
      url: "/api/device/register",
      headers: { authorization: `Bearer ${regStaffToken}` },
      body: {
        staff_code: regStaff,
        challengeToken: chalResult.challengeToken,
        challenge: chalResult.challenge,
        publicKey: regKeyPair.publicKey,
        signature: challengeSig,
        platform: "web",
        model: "OnePlus Nord CE 3 Lite (Chrome WebCrypto)",
        os: "Android",
        attestationEvidence: {
          cryptoSystem: "WebCrypto non-exportable ECDSA P-256",
          timestamp: Date.now(),
        },
      },
    });
    await deviceApiHandler(regDeviceReq.req, regDeviceReq.res);
    assert.strictEqual(regDeviceReq.getStatus(), 201, "Device registration must return 201 Created");
    assert.strictEqual(regDeviceReq.getData()?.success, true);
    assert.strictEqual(regDeviceReq.getData()?.device?.status, "Active");
    console.log("  ✓ PASS: Successful device registration flow with ECDSA P-256 signature verification");

    // -------------------------------------------------------------------------
    // TEST 12: Unavailable database fails closed with 500 / 503
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 12: Unavailable Database Fails Closed ---");
    setDeviceCustomSupabaseClient(null);
    process.env["NODE_ENV"] = "production";
    delete process.env["SUPABASE_SERVICE_ROLE_KEY"];

    const unavailReq = createMockReqRes({
      method: "POST",
      url: "/api/device/challenge",
      headers: { authorization: `Bearer ${regStaffToken}` },
      body: { staff_code: regStaff, action: "challenge" },
    });
    await deviceApiHandler(unavailReq.req, unavailReq.res);
    assert.ok(
      unavailReq.getStatus() === 500 || unavailReq.getStatus() === 503,
      "Unavailable database in production must return 500 or 503"
    );
    assert.ok(
      unavailReq.getData()?.error === "DATABASE_UNAVAILABLE" ||
      unavailReq.getData()?.error === "SERVER_CONFIG_FAULT",
      "Must return DATABASE_UNAVAILABLE or SERVER_CONFIG_FAULT"
    );
    console.log("  ✓ PASS: Missing / unavailable database strictly fails closed in production");

    // -------------------------------------------------------------------------
    // TEST 13: Invalid or forged challenge rejected
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 13: Invalid / Forged / Expired Challenge Nonce Rejected ---");
    setDeviceCustomSupabaseClient(mockDeviceDb);
    process.env["NODE_ENV"] = "test";
    process.env["TEST_MODE"] = "1";

    // 13a: Forged challenge token (invalid HMAC signature)
    const forgedToken = "eyJub25jZSI6ImZvcmdlZCJ9.invalid-sig";
    const forgedDeviceChalReq = createMockReqRes({
      method: "POST",
      url: "/api/device/register",
      headers: { authorization: `Bearer ${regStaffToken}` },
      body: {
        staff_code: regStaff,
        challengeToken: forgedToken,
        challenge: "forged-nonce-123",
        publicKey: regKeyPair.publicKey,
        signature: challengeSig,
        platform: "web",
      },
    });
    await deviceApiHandler(forgedDeviceChalReq.req, forgedDeviceChalReq.res);
    assert.strictEqual(forgedDeviceChalReq.getStatus(), 403, "Forged challenge must return 403 Forbidden");
    assert.strictEqual(forgedDeviceChalReq.getData()?.error, "CHALLENGE_FORGERY_DETECTED");

    // 13b: Expired challenge token
    const expiredPayload = {
      nonce: "expired-nonce-123456",
      staffId: regStaff,
      issuedAt: Date.now() - 600_000,
      expiresAt: Date.now() - 300_000, // Expired 5 minutes ago
      purpose: "device_registration",
    };
    const expPayloadB64 = Buffer.from(JSON.stringify(expiredPayload)).toString("base64url");
    const expSig = crypto.createHmac("sha256", "campusattend-device-binding-sec-key-2026").update(expPayloadB64).digest("base64url");
    const expiredToken = `${expPayloadB64}.${expSig}`;
    const expSigBytes = signDevicePayload(regKeyPair.privateKey, expiredPayload.nonce);

    const expiredReq = createMockReqRes({
      method: "POST",
      url: "/api/device/register",
      headers: { authorization: `Bearer ${regStaffToken}` },
      body: {
        staff_code: regStaff,
        challengeToken: expiredToken,
        challenge: expiredPayload.nonce,
        publicKey: regKeyPair.publicKey,
        signature: expSigBytes,
        platform: "web",
      },
    });
    await deviceApiHandler(expiredReq.req, expiredReq.res);
    assert.strictEqual(expiredReq.getStatus(), 403, "Expired challenge must return 403 Forbidden");
    assert.strictEqual(expiredReq.getData()?.error, "CHALLENGE_EXPIRED");

    // 13c: Staff code mismatch in challenge token
    const mismatchedPayload = {
      nonce: "mismatch-nonce-123456",
      staffId: "SCT-OTHER-USER",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 300_000,
      purpose: "device_registration",
    };
    const misPayloadB64 = Buffer.from(JSON.stringify(mismatchedPayload)).toString("base64url");
    const misSig = crypto.createHmac("sha256", "campusattend-device-binding-sec-key-2026").update(misPayloadB64).digest("base64url");
    const misToken = `${misPayloadB64}.${misSig}`;
    const misSigBytes = signDevicePayload(regKeyPair.privateKey, mismatchedPayload.nonce);

    const misReq = createMockReqRes({
      method: "POST",
      url: "/api/device/register",
      headers: { authorization: `Bearer ${regStaffToken}` },
      body: {
        staff_code: regStaff, // SCT-REG-001 vs token's SCT-OTHER-USER
        challengeToken: misToken,
        challenge: mismatchedPayload.nonce,
        publicKey: regKeyPair.publicKey,
        signature: misSigBytes,
        platform: "web",
      },
    });
    await deviceApiHandler(misReq.req, misReq.res);
    assert.strictEqual(misReq.getStatus(), 403, "Mismatched staff challenge must return 403 Forbidden");
    assert.strictEqual(misReq.getData()?.error, "CHALLENGE_STAFF_MISMATCH");

    // 13d: Challenge marked status: 'EXPIRED' in database while expires_at is in future
    const futureExpiredNonce = "future-expired-nonce-999";
    storedChallenges.push({
      challenge: futureExpiredNonce,
      staff_code: regStaff,
      device_id: "PENDING_REGISTRATION",
      operation: "device_registration",
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 600_000).toISOString(), // 10 minutes in the future!
      status: "EXPIRED",
    });
    const futureExpPayload = {
      nonce: futureExpiredNonce,
      staffId: regStaff,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 600_000,
      purpose: "device_registration",
    };
    const futureExpB64 = Buffer.from(JSON.stringify(futureExpPayload)).toString("base64url");
    const futureExpSig = crypto.createHmac("sha256", "campusattend-device-binding-sec-key-2026").update(futureExpB64).digest("base64url");
    const futureExpToken = `${futureExpB64}.${futureExpSig}`;
    const futureExpSigBytes = signDevicePayload(regKeyPair.privateKey, futureExpiredNonce);

    const futureExpReq = createMockReqRes({
      method: "POST",
      url: "/api/device/register",
      headers: { authorization: `Bearer ${regStaffToken}` },
      body: {
        staff_code: regStaff,
        challengeToken: futureExpToken,
        challenge: futureExpiredNonce,
        publicKey: regKeyPair.publicKey,
        signature: futureExpSigBytes,
        platform: "web",
      },
    });
    await deviceApiHandler(futureExpReq.req, futureExpReq.res);
    assert.strictEqual(futureExpReq.getStatus(), 403, "Challenge marked EXPIRED in database must return 403 even if expires_at is in future");
    assert.strictEqual(futureExpReq.getData()?.error, "CHALLENGE_EXPIRED");

    // 13e: Challenge already CONSUMED in database
    const consumedNonce = "already-consumed-nonce-888";
    storedChallenges.push({
      challenge: consumedNonce,
      staff_code: regStaff,
      device_id: "PENDING_REGISTRATION",
      operation: "device_registration",
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      consumed_at: new Date().toISOString(),
      status: "CONSUMED",
    });
    const consumedPayload = {
      nonce: consumedNonce,
      staffId: regStaff,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 600_000,
      purpose: "device_registration",
    };
    const consumedB64 = Buffer.from(JSON.stringify(consumedPayload)).toString("base64url");
    const consumedSig = crypto.createHmac("sha256", "campusattend-device-binding-sec-key-2026").update(consumedB64).digest("base64url");
    const consumedToken = `${consumedB64}.${consumedSig}`;
    const consumedSigBytes = signDevicePayload(regKeyPair.privateKey, consumedNonce);

    const consumedReq = createMockReqRes({
      method: "POST",
      url: "/api/device/register",
      headers: { authorization: `Bearer ${regStaffToken}` },
      body: {
        staff_code: regStaff,
        challengeToken: consumedToken,
        challenge: consumedNonce,
        publicKey: regKeyPair.publicKey,
        signature: consumedSigBytes,
        platform: "web",
      },
    });
    await deviceApiHandler(consumedReq.req, consumedReq.res);
    assert.strictEqual(consumedReq.getStatus(), 403, "Already-consumed challenge must return 403 Forbidden");
    assert.strictEqual(consumedReq.getData()?.error, "CHALLENGE_ALREADY_USED_DISTRIBUTED");

    // 13f: Concurrent attempts to consume the exact same challenge
    const concurrentNonce = "concurrent-nonce-777";
    storedChallenges.push({
      challenge: concurrentNonce,
      staff_code: regStaff,
      device_id: "PENDING_REGISTRATION",
      operation: "device_registration",
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      status: "ACTIVE",
    });
    const concurrentPayload = {
      nonce: concurrentNonce,
      staffId: regStaff,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 600_000,
      purpose: "device_registration",
    };
    const concB64 = Buffer.from(JSON.stringify(concurrentPayload)).toString("base64url");
    const concSig = crypto.createHmac("sha256", "campusattend-device-binding-sec-key-2026").update(concB64).digest("base64url");
    const concToken = `${concB64}.${concSig}`;
    const concSigBytes = signDevicePayload(regKeyPair.privateKey, concurrentNonce);

    const concReq1 = createMockReqRes({
      method: "POST",
      url: "/api/device/register",
      headers: { authorization: `Bearer ${regStaffToken}` },
      body: {
        staff_code: regStaff,
        challengeToken: concToken,
        challenge: concurrentNonce,
        publicKey: regKeyPair.publicKey,
        signature: concSigBytes,
        platform: "web",
      },
    });
    const concReq2 = createMockReqRes({
      method: "POST",
      url: "/api/device/register",
      headers: { authorization: `Bearer ${regStaffToken}` },
      body: {
        staff_code: regStaff,
        challengeToken: concToken,
        challenge: concurrentNonce,
        publicKey: regKeyPair.publicKey,
        signature: concSigBytes,
        platform: "web",
      },
    });

    // Run both concurrently
    const [res1, res2] = await Promise.all([
      deviceApiHandler(concReq1.req, concReq1.res),
      deviceApiHandler(concReq2.req, concReq2.res),
    ]);

    const statuses = [concReq1.getStatus(), concReq2.getStatus()].sort();
    // Exactly one request must succeed (200), and the second must be rejected (403 CHALLENGE_ALREADY_USED_DISTRIBUTED)
    assert.strictEqual(statuses[0], 200, "One concurrent registration request must succeed with 200");
    assert.strictEqual(statuses[1], 403, "Second concurrent registration request must be rejected with 403");
    console.log("  ✓ PASS: Concurrent attempts to consume same challenge serialized: exactly 1 succeeded, 1 rejected");

    console.log("  ✓ PASS: Invalid, forged, expired, and mismatched challenges strictly rejected with 403 Forbidden");

    // -------------------------------------------------------------------------
    // TEST 14: Unauthorized replacement of active device rejected (Rule 1)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 14: Unauthorized Device Replacement Rejected (Rule 1) ---");
    // Generate new different key pair representing unauthorized second phone
    const attackerPhoneKeyPair = createTestDeviceKeyPair();

    // Get fresh challenge for regStaff
    const chalReq2 = createMockReqRes({
      method: "POST",
      url: "/api/device/challenge",
      headers: { authorization: `Bearer ${regStaffToken}` },
      body: { staff_code: regStaff, action: "challenge", isReRegistration: true },
    });
    await deviceApiHandler(chalReq2.req, chalReq2.res);
    const chal2 = chalReq2.getData();

    const attackerSig = signDevicePayload(attackerPhoneKeyPair.privateKey, chal2.challenge);
    const replaceReq = createMockReqRes({
      method: "POST",
      url: "/api/device/register",
      headers: { authorization: `Bearer ${regStaffToken}` },
      body: {
        staff_code: regStaff,
        challengeToken: chal2.challengeToken,
        challenge: chal2.challenge,
        publicKey: attackerPhoneKeyPair.publicKey, // DIFFERENT KEY!
        signature: attackerSig,
        platform: "web",
        model: "Unauthorized Second Phone",
      },
    });
    await deviceApiHandler(replaceReq.req, replaceReq.res);
    assert.strictEqual(replaceReq.getStatus(), 409, "Unauthorized device replacement must return 409 Conflict");
    assert.strictEqual(replaceReq.getData()?.error, "DEVICE_ALREADY_REGISTERED");
    console.log("  ✓ PASS: Unauthorized second device replacement strictly rejected with 409 DEVICE_ALREADY_REGISTERED");

    // -------------------------------------------------------------------------
    // TEST 15: Database errors fail closed with 500 (Zero Mock Success)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 15: Database Errors Fail Closed with HTTP 500 ---");
    const failingDb = {
      from(table: string) {
        if (table === "staff") {
          return {
            select() {
              return {
                ilike(col: string, val: string) {
                  return {
                    async maybeSingle() {
                      return {
                        data: { id: "staff-fail-id", staff_code: val.toUpperCase(), name: "Fail Staff", active: true },
                        error: null,
                      };
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "devices") {
          return {
            select() {
              return {
                ilike() {
                  return {
                    eq() {
                      return {
                        order() {
                          return {
                            limit() {
                              return {
                                async maybeSingle() {
                                  return { data: null, error: null };
                                },
                              };
                            },
                          };
                        },
                      };
                    },
                    order() {
                      return {
                        async limit() {
                          return { data: [], error: null };
                        },
                      };
                    },
                  };
                },
                eq() {
                  return {
                    or() {
                      return { data: [], error: null };
                    },
                  };
                },
              };
            },
            async upsert() {
              return {
                data: null,
                error: { code: "57P01", message: "terminating connection due to administrator command" },
              };
            },
          };
        }
        return {
          select: () => ({ error: null, data: [] }),
          insert: async () => ({ error: null }),
        };
      },
    };

    setDeviceCustomSupabaseClient(failingDb);

    // Get fresh challenge
    const freshStaff = "SCT-FAIL-001";
    const freshToken = mintTestStaffToken(freshStaff);
    const chalReq3 = createMockReqRes({
      method: "POST",
      url: "/api/device/challenge",
      headers: { authorization: `Bearer ${freshToken}` },
      body: { staff_code: freshStaff, action: "challenge" },
    });
    await deviceApiHandler(chalReq3.req, chalReq3.res);
    const chal3 = chalReq3.getData();

    const failKey = createTestDeviceKeyPair();
    const failSig = signDevicePayload(failKey.privateKey, chal3.challenge);
    const failRegReq = createMockReqRes({
      method: "POST",
      url: "/api/device/register",
      headers: { authorization: `Bearer ${freshToken}` },
      body: {
        staff_code: freshStaff,
        challengeToken: chal3.challengeToken,
        challenge: chal3.challenge,
        publicKey: failKey.publicKey,
        signature: failSig,
        platform: "web",
      },
    });
    await deviceApiHandler(failRegReq.req, failRegReq.res);
    assert.strictEqual(failRegReq.getStatus(), 500, "Database persistence failure must return HTTP 500");
    assert.strictEqual(failRegReq.getData()?.error, "DATABASE_ERROR");
    console.log("  ✓ PASS: Database errors strictly fail closed with HTTP 500 (zero mock success)");

    console.log("\n=================================================================");
    console.log("   ALL ISOLATED ATTENDANCE & DEVICE SECURITY TESTS PASSED (15/15) ");
    console.log("=================================================================\n");
  } finally {
    // Restore clean environment
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    setCustomSupabaseClient(null);
    setDeviceCustomSupabaseClient(null);
  }
}

runIsolatedAttendanceSecuritySuite().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
