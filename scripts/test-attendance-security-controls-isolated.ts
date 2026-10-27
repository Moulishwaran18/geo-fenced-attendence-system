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

    console.log("\n=================================================================");
    console.log("   ALL ISOLATED ATTENDANCE SECURITY TESTS PASSED (10/10)        ");
    console.log("=================================================================\n");
  } finally {
    // Restore clean environment
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    setCustomSupabaseClient(null);
  }
}

runIsolatedAttendanceSecuritySuite().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
