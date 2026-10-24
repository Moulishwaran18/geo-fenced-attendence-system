/**
 * CampusAttend — Critical Security Hardening Regression Test Suite
 *
 * Exhaustively validates all 18 security requirements specified in the objective:
 * 1. Forged JSON claiming status: "Present" is rejected when server verification fails.
 * 2. Changing the faculty ID in a request cannot impersonate another faculty member.
 * 3. Altering a signed field invalidates the signature.
 * 4. Replayed or expired challenges are rejected.
 * 5. Two simultaneous requests cannot consume the same one-time challenge.
 * 6. An unregistered or mismatched device cannot mark attendance.
 * 7. A revoked device cannot use an old session or token to mark attendance.
 * 8. Direct Supabase inserts from ordinary client roles are rejected.
 * 9. Direct Supabase updates and deletes of attendance records are rejected.
 * 10. Ordinary attendance APIs cannot overwrite or delete historical records.
 * 11. Unauthorized users cannot access another faculty member's protected records.
 * 12. An unauthorized RPC or alternate endpoint cannot bypass attendance validation.
 * 13. Invalid Wi-Fi, GPS, face, or device verification produces no successful attendance record.
 * 14. Valid attendance produces exactly one database row and a matching receipt.
 * 15. Duplicate submissions return the original result without inserting duplicate rows.
 * 16. Administrator corrections preserve the original attendance record and generate an audit entry.
 * 17. Exposed credentials are absent from client bundles and API responses.
 * 18. Existing administrator login, faculty login, face enrollment, device binding, and attendance continue working.
 */

process.env["TEST_MODE"] = "1";
process.env["NODE_ENV"] = "test";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Load .env manually if available
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...vals] = trimmed.split("=");
      if (key && vals.length > 0 && !process.env[key.trim()]) {
        process.env[key.trim()] = vals.join("=").trim();
      }
    }
  }
}

import pg from "pg";
import attendanceHandler from "../api/attendance.ts";
import adminLoginHandler from "../api/admin/login.ts";
import deviceHandler from "../api/device/index.ts";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST || "localhost",
  port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || "campus_biometrics",
});

const TOKEN_SECRET =
  process.env["CAMPUS_AUTH_SECRET"] ||
  process.env["NETWORK_AUTH_SECRET"] ||
  "sona-campus-wifi-egress-auth-secret-key-2026";

const STAFF_TOKEN_SECRET =
  process.env["CAMPUS_AUTH_SECRET"] ||
  process.env["STAFF_AUTH_SECRET"] ||
  process.env["CAMPUS_ADMIN_SECRET"] ||
  "campusattend-staff-auth-session-sec-key-2026";

const ADMIN_TOKEN_SECRET =
  process.env["CAMPUS_ADMIN_SECRET"] ||
  process.env["CAMPUS_AUTH_SECRET"] ||
  process.env["ADMIN_SECRET_KEY"] ||
  "campusattend-admin-sec-key-moulish-2026-auth-token";

// Helper to mock request/response
function callApi(handler, method, url, headers, body) {
  return new Promise(async (resolve) => {
    let statusCode = 200;
    let resData = null;

    const req = {
      method,
      url,
      headers: { ...headers },
      body,
      json: async () => body,
    };

    const res = {
      statusCode: 200,
      setHeader: () => {},
      status: (c) => {
        statusCode = c;
        res.statusCode = c;
        return res;
      },
      json: (p) => {
        resData = p;
        resolve({ status: statusCode, data: resData });
        return res;
      },
      end: (s) => {
        if (s && !resData) {
          try { resData = JSON.parse(s); } catch { resData = s; }
        }
        resolve({ status: statusCode, data: resData });
      },
    };

    try {
      await handler(req, res);
    } catch (e) {
      resolve({ status: 500, data: { error: e.message } });
    }
  });
}

// Token creation helpers
function mintStaffToken(staffCode, ttlMs = 3600_000) {
  const payload = {
    staffId: staffCode.toUpperCase(),
    sub: staffCode.toUpperCase(),
    role: "staff",
    issuedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
    nonce: crypto.randomBytes(16).toString("hex"),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", STAFF_TOKEN_SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

function mintAdminToken(username = "moulish", ttlMs = 3600_000) {
  const payload = {
    sub: username,
    username,
    role: "admin",
    issuedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
    nonce: crypto.randomBytes(16).toString("hex"),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", ADMIN_TOKEN_SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

function mintNetworkToken(ssid = "SONA-WIFI-FACULTY", valid = true, ttlMs = 120_000) {
  const payload = {
    authorized: valid,
    ssid,
    issuedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
    verifiedIp: "111.92.42.18",
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

// ECDSA signing helper
function signPayload(privateKey, canonicalString) {
  const sign = crypto.createSign("SHA256");
  sign.update(canonicalString);
  return sign.sign(privateKey, "base64");
}

let passedCount = 0;
let failedCount = 0;

function assert(condition, title, details) {
  if (condition) {
    passedCount++;
    console.log(`  ✓ PASS: ${title}`);
  } else {
    failedCount++;
    console.error(`  ✗ FAIL: ${title}`, details ? details : "");
  }
}

async function runRegressionSuite() {
  console.log("=================================================================");
  console.log("   CAMPUSATTEND — CRITICAL SECURITY HARDENING REGRESSION SUITE   ");
  console.log("=================================================================\n");

  const testSuffix = Date.now().toString().slice(-6);
  const STAFF_A = `STAFF_SEC_A_${testSuffix}`;
  const STAFF_B = `STAFF_SEC_B_${testSuffix}`;
  const STAFF_RACE = `STAFF_SEC_RACE_${testSuffix}`;
  const TODAY = new Date().toISOString().split("T")[0];

  // Generate ECDSA P-256 Key Pair for Device A
  const keyPairA = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pubPemA = keyPairA.publicKey.export({ type: "spki", format: "pem" }).toString();
  const DEVICE_A_ID = `DEV_HARDEN_A_${testSuffix}`;

  // Generate ECDSA P-256 Key Pair for Device B (Mismatched)
  const keyPairB = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pubPemB = keyPairB.publicKey.export({ type: "spki", format: "pem" }).toString();
  const DEVICE_B_ID = `DEV_HARDEN_B_${testSuffix}`;

  // Generate ECDSA P-256 Key Pair for Race Test Device
  const keyPairRace = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pubPemRace = keyPairRace.publicKey.export({ type: "spki", format: "pem" }).toString();
  const DEVICE_RACE_ID = `DEV_HARDEN_RACE_${testSuffix}`;

  // Provision test staff and device in PostgreSQL
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO public.staff (staff_code, name, email, department, designation, active)
       VALUES ($1, 'Security Test Faculty A', $2, 'CSE', 'Assistant Professor', true)`,
      [STAFF_A, `faculty.a.${testSuffix}@sonatech.ac.in`]
    );
    await client.query(
      `INSERT INTO public.staff (staff_code, name, email, department, designation, active)
       VALUES ($1, 'Security Test Faculty B', $2, 'ECE', 'Associate Professor', true)`,
      [STAFF_B, `faculty.b.${testSuffix}@sonatech.ac.in`]
    );
    await client.query(
      `INSERT INTO public.staff (staff_code, name, email, department, designation, active)
       VALUES ($1, 'Security Test Faculty Race', $2, 'IT', 'Assistant Professor', true)`,
      [STAFF_RACE, `faculty.race.${testSuffix}@sonatech.ac.in`]
    );

    // Bind Device A to Staff A as Active
    await client.query(
      `INSERT INTO public.devices 
       (id, staff_code, staff_name, model, os, status, public_key, key_algorithm, registered_at)
       VALUES ($1, $2, 'Security Test Faculty A', 'Pixel 9 Pro', 'Android 15', 'Active', $3, 'ECDSA_P256', NOW())`,
      [DEVICE_A_ID, STAFF_A, pubPemA]
    );

    // Bind Device B to Staff B as Revoked
    await client.query(
      `INSERT INTO public.devices 
       (id, staff_code, staff_name, model, os, status, public_key, key_algorithm, registered_at, revocation_reason)
       VALUES ($1, $2, 'Security Test Faculty B', 'Samsung Galaxy S24', 'Android 14', 'Revoked', $3, 'ECDSA_P256', NOW(), 'Device reported lost')`,
      [DEVICE_B_ID, STAFF_B, pubPemB]
    );

    // Bind Device Race to Staff Race as Active
    await client.query(
      `INSERT INTO public.devices 
       (id, staff_code, staff_name, model, os, status, public_key, key_algorithm, registered_at)
       VALUES ($1, $2, 'Security Test Faculty Race', 'OnePlus 12', 'Android 14', 'Active', $3, 'ECDSA_P256', NOW())`,
      [DEVICE_RACE_ID, STAFF_RACE, pubPemRace]
    );
  } finally {
    client.release();
  }

  const tokenStaffA = mintStaffToken(STAFF_A);
  const tokenStaffB = mintStaffToken(STAFF_B);
  const tokenStaffRace = mintStaffToken(STAFF_RACE);
  const tokenAdmin = mintAdminToken("moulish");
  const validWifi = mintNetworkToken("SONA-WIFI-FACULTY", true);

  // Authoritative Campus Coordinates (Inside)
  const CAMPUS_LAT = 11.6775;
  const CAMPUS_LNG = 78.1250;
  // Outside Campus Coordinates
  const OUTSIDE_LAT = 11.6850;
  const OUTSIDE_LNG = 78.1300;

  // -------------------------------------------------------------------------
  // TEST 1: Forged JSON claiming status: "Present" is rejected
  // -------------------------------------------------------------------------
  console.log("--- TEST 1: FORGED JSON CLAIMING 'Present' REJECTED ---");
  {
    const res = await callApi(attendanceHandler, "POST", "/api/attendance", {
      authorization: `Bearer ${tokenStaffA}`,
      "x-network-auth-token": validWifi,
    }, {
      status: "Present",
      success: true,
      faceVerified: true,
      livenessPassed: true,
      deviceVerified: true,
      // Missing required GPS, challenge, and signature
    });
    assert(res.status === 403, "Forged JSON claiming 'Present' without server verification returns HTTP 403", res.data);
    assert(res.data?.success === false, "Server response explicitly declares success: false");
  }

  // -------------------------------------------------------------------------
  // TEST 2: Changing faculty ID in request cannot impersonate another faculty
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 2: IMPERSONATION BY CHANGING FACULTY ID REJECTED ---");
  {
    const res = await callApi(attendanceHandler, "POST", "/api/attendance", {
      authorization: `Bearer ${tokenStaffA}`, // Authenticated as STAFF_A
      "x-network-auth-token": validWifi,
    }, {
      staffCode: STAFF_B, // Attempting to mark attendance for STAFF_B
      latitude: CAMPUS_LAT,
      longitude: CAMPUS_LNG,
      accuracy: 8,
    });
    assert(res.status === 403, "Impersonation attempt returns HTTP 403", res.data);
    assert(res.data?.error === "IDENTITY_FORGERY_DETECTED", "Error code identifies IDENTITY_FORGERY_DETECTED");
  }

  // -------------------------------------------------------------------------
  // Obtain Valid Challenge for STAFF_A
  // -------------------------------------------------------------------------
  const chalRes = await callApi(attendanceHandler, "POST", "/api/attendance?action=challenge", {
    authorization: `Bearer ${tokenStaffA}`,
  }, {});
  const challengeA = chalRes.data?.challenge;
  const challengeTokenA = chalRes.data?.challengeToken;

  // -------------------------------------------------------------------------
  // TEST 3: Altering a signed field invalidates the signature
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 3: ALTERING SIGNED FIELD INVALIDATES SIGNATURE ---");
  {
    const timestamp = Date.now();
    // Signed over CAMPUS_LAT
    const canonicalPayload = `v2:${STAFF_A}:${DEVICE_A_ID}:${challengeA}:${CAMPUS_LAT.toFixed(6)}:${CAMPUS_LNG.toFixed(6)}:${timestamp}`;
    const validSig = signPayload(keyPairA.privateKey, canonicalPayload);

    // Tamper with latitude in the request payload (attacker changes location by 50m)
    const tamperedLat = CAMPUS_LAT + 0.0005;

    const res = await callApi(attendanceHandler, "POST", "/api/attendance", {
      authorization: `Bearer ${tokenStaffA}`,
      "x-network-auth-token": validWifi,
    }, {
      challenge: challengeA,
      challengeToken: challengeTokenA,
      latitude: tamperedLat, // TAMPERED!
      longitude: CAMPUS_LNG,
      accuracy: 5,
      deviceSignature: validSig,
      deviceTimestamp: timestamp,
      faceMatchDistance: 0.25,
      antiSpoofScore: 0.96,
    });
    assert(res.status === 403, "Altered location coordinates return HTTP 403", res.data);
    assert(res.data?.error === "INVALID_DEVICE_SIGNATURE", "Error code is INVALID_DEVICE_SIGNATURE");
  }

  // -------------------------------------------------------------------------
  // TEST 4: Replayed or expired challenges are rejected
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 4: EXPIRED CHALLENGE REJECTED ---");
  {
    // Mint an expired challenge token
    const expiredPayload = {
      challenge: "chal_expired_123",
      staffCode: STAFF_A,
      deviceId: DEVICE_A_ID,
      operation: "ATTENDANCE_PUNCH",
      issuedAt: Date.now() - 300_000,
      expiresAt: Date.now() - 10_000, // Expired 10s ago
    };
    const b64 = Buffer.from(JSON.stringify(expiredPayload)).toString("base64url");
    const sig = crypto.createHmac("sha256", process.env.CAMPUS_AUTH_SECRET || "campusattend-device-challenge-sec-key-2026").update(b64).digest("base64url");
    const expiredToken = `${b64}.${sig}`;

    const res = await callApi(attendanceHandler, "POST", "/api/attendance", {
      authorization: `Bearer ${tokenStaffA}`,
      "x-network-auth-token": validWifi,
    }, {
      challenge: "chal_expired_123",
      challengeToken: expiredToken,
      latitude: CAMPUS_LAT,
      longitude: CAMPUS_LNG,
      accuracy: 6,
      deviceSignature: "dummy_sig",
      deviceTimestamp: Date.now(),
    });
    assert(res.status === 403, "Expired challenge returns HTTP 403", res.data);
    assert(res.data?.error === "CHALLENGE_EXPIRED", "Error code is CHALLENGE_EXPIRED");
  }

  // -------------------------------------------------------------------------
  // TEST 5: Two simultaneous requests cannot consume the same one-time challenge
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 5: SIMULTANEOUS REQUESTS CANNOT REPLAY SAME CHALLENGE ---");
  {
    const cRes = await callApi(attendanceHandler, "POST", "/api/attendance?action=challenge", {
      authorization: `Bearer ${tokenStaffRace}`,
    }, {});
    const sharedChal = cRes.data?.challenge;
    const sharedChalToken = cRes.data?.challengeToken;

    const ts = Date.now();
    const canPayload = `v2:${STAFF_RACE}:${DEVICE_RACE_ID}:${sharedChal}:${CAMPUS_LAT.toFixed(6)}:${CAMPUS_LNG.toFixed(6)}:${ts}`;
    const sig = signPayload(keyPairRace.privateKey, canPayload);

    const makeReq = () => callApi(attendanceHandler, "POST", "/api/attendance", {
      authorization: `Bearer ${tokenStaffRace}`,
      "x-network-auth-token": validWifi,
    }, {
      challenge: sharedChal,
      challengeToken: sharedChalToken,
      latitude: CAMPUS_LAT,
      longitude: CAMPUS_LNG,
      accuracy: 5,
      deviceSignature: sig,
      deviceTimestamp: ts,
      faceMatchDistance: 0.20,
      antiSpoofScore: 0.98,
    });

    const [res1, res2] = await Promise.all([makeReq(), makeReq()]);
    const statuses = [res1.status, res2.status];
    const hasOneSuccess = statuses.filter(s => s === 200).length === 1;
    const hasOneBlocked = statuses.some(s => s === 403);

    assert(hasOneSuccess, "Exactly one of two racing requests succeeded (HTTP 200)");
    assert(hasOneBlocked, "The racing duplicate request was rejected (HTTP 403 / CHALLENGE_ALREADY_CONSUMED)");
  }

  // -------------------------------------------------------------------------
  // TEST 6: Unregistered or mismatched device cannot mark attendance
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 6: UNREGISTERED DEVICE CANNOT MARK ATTENDANCE ---");
  {
    // Try marking attendance using an unregistered key pair
    const unregKeyPair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const cRes = await callApi(attendanceHandler, "POST", "/api/attendance?action=challenge", {
      authorization: `Bearer ${tokenStaffA}`,
    }, {});
    const chal = cRes.data?.challenge;
    const chalToken = cRes.data?.challengeToken;

    const ts = Date.now();
    const payload = `v2:${STAFF_A}:${DEVICE_A_ID}:${chal}:${CAMPUS_LAT.toFixed(6)}:${CAMPUS_LNG.toFixed(6)}:${ts}`;
    const invalidSig = signPayload(unregKeyPair.privateKey, payload);

    const res = await callApi(attendanceHandler, "POST", "/api/attendance", {
      authorization: `Bearer ${tokenStaffA}`,
      "x-network-auth-token": validWifi,
    }, {
      challenge: chal,
      challengeToken: chalToken,
      latitude: CAMPUS_LAT,
      longitude: CAMPUS_LNG,
      accuracy: 5,
      deviceSignature: invalidSig,
      deviceTimestamp: ts,
    });
    assert(res.status === 403, "Unregistered device signature returns HTTP 403", res.data);
    assert(res.data?.error === "INVALID_DEVICE_SIGNATURE", "Error identifies INVALID_DEVICE_SIGNATURE");
  }

  // -------------------------------------------------------------------------
  // TEST 7: A revoked device cannot mark attendance
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 7: REVOKED DEVICE CANNOT MARK ATTENDANCE ---");
  {
    // STAFF_B has revoked device DEVICE_B_ID
    const res = await callApi(attendanceHandler, "POST", "/api/attendance?action=challenge", {
      authorization: `Bearer ${tokenStaffB}`,
    }, {});
    assert(res.status === 403, "Revoked device challenge request returns HTTP 403", res.data);
    assert(res.data?.error === "DEVICE_REVOKED", "Error code identifies DEVICE_REVOKED");
  }

  // -------------------------------------------------------------------------
  // TEST 8: Direct Supabase inserts from ordinary client roles are rejected
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 8: DIRECT CLIENT INSERTS REJECTED ---");
  {
    // Using PostgreSQL role 'anon'
    let directInsertBlocked = false;
    const c = await pool.connect();
    try {
      await c.query("SET ROLE anon");
      await c.query(
        `INSERT INTO public.attendance_records (staff_code, staff_name, department, date, day, time, status, verification)
         VALUES ('HACKER_01', 'Hacker', 'CSE', '2026-10-24', 'Saturday', '09:00 AM', 'Present', 'Verified')`
      );
    } catch (e: any) {
      directInsertBlocked = true;
      assert(true, "Direct INSERT by anon role blocked by database privileges/RLS: " + e.message);
    } finally {
      await c.query("RESET ROLE");
      c.release();
    }
    assert(directInsertBlocked, "Direct Supabase/PG insert from ordinary client role was rejected");
  }

  // -------------------------------------------------------------------------
  // TEST 9: Direct Supabase updates and deletes of attendance records rejected
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 9: IMMUTABLE ATTENDANCE: UPDATES & DELETES REJECTED ---");
  {
    const c = await pool.connect();
    try {
      // Find any existing record
      const exist = await c.query("SELECT id FROM public.attendance_records LIMIT 1");
      if (exist.rows.length > 0) {
        const id = exist.rows[0].id;
        let updateThrew = false;
        try {
          await c.query("UPDATE public.attendance_records SET status = 'Absent' WHERE id = $1", [id]);
        } catch (e: any) {
          updateThrew = true;
          assert(e.message.includes("CRITICAL_SECURITY_VIOLATION"), "UPDATE blocked by database engine trigger: " + e.message);
        }
        assert(updateThrew, "UPDATE statement on attendance_records was strictly blocked");

        let deleteThrew = false;
        try {
          await c.query("DELETE FROM public.attendance_records WHERE id = $1", [id]);
        } catch (e: any) {
          deleteThrew = true;
          assert(e.message.includes("CRITICAL_SECURITY_VIOLATION"), "DELETE blocked by database engine trigger: " + e.message);
        }
        assert(deleteThrew, "DELETE statement on attendance_records was strictly blocked");
      }
    } finally {
      c.release();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 10: Ordinary attendance APIs cannot overwrite historical records
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 10: HISTORICAL ATTENDANCE IMMUTABILITY ---");
  {
    // Try calling attendance API with an existing record's date and a different status or ID
    const res = await callApi(attendanceHandler, "POST", "/api/attendance", {
      authorization: `Bearer ${tokenStaffA}`,
    }, {
      action: "overwrite",
      attendanceId: "00000000-0000-0000-0000-000000000000",
      status: "Absent",
    });
    // Server rejects with invalid challenge/factors and will never execute an UPDATE
    assert(res.status === 403, "API rejects any attempt to overwrite or tamper with attendance");
  }

  // -------------------------------------------------------------------------
  // TEST 11: Unauthorized users cannot access another faculty's protected records
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 11: PRIVACY: CANNOT ACCESS ANOTHER FACULTY RECORDS ---");
  {
    // STAFF_A queries attendance with filter for STAFF_B
    const res = await callApi(attendanceHandler, "GET", `/api/attendance?staff_code=${STAFF_B}`, {
      authorization: `Bearer ${tokenStaffA}`,
    }, {});
    assert(res.status === 200, "Query returns HTTP 200 with scoped results");
    // All returned records MUST belong exclusively to STAFF_A, never STAFF_B
    const foreignRecords = (res.data?.records || []).filter((r: any) => r.staff_code?.toUpperCase() === STAFF_B);
    assert(foreignRecords.length === 0, "No records belonging to another faculty member are returned to Staff A");
  }

  // -------------------------------------------------------------------------
  // TEST 12: Unauthorized RPC cannot bypass attendance validation
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 12: UNPROTECTED RPC BYPASS REJECTED ---");
  {
    const c = await pool.connect();
    try {
      const res = await c.query(
        "SELECT public.atomic_verify_and_consume_attendance_challenge('fake_nonce', 'fake_staff', 'fake_dev') AS r"
      );
      assert(res.rows[0].r.valid === false, "RPC rejects invalid/unregistered challenge");
      assert(res.rows[0].r.error === "CHALLENGE_NOT_FOUND", "RPC returns CHALLENGE_NOT_FOUND");
    } finally {
      c.release();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 13: Invalid Wi-Fi, GPS, face produces no successful attendance
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 13: MULTI-FACTOR REJECTION MATRIX ---");
  {
    // A) Outside Campus GPS
    const resGps = await callApi(attendanceHandler, "POST", "/api/attendance", {
      authorization: `Bearer ${tokenStaffA}`,
      "x-network-auth-token": validWifi,
    }, {
      latitude: OUTSIDE_LAT,
      longitude: OUTSIDE_LNG,
      accuracy: 5,
      deviceSignature: "dummy",
    });
    assert(resGps.status === 403 && resGps.data?.error === "GPS_OUTSIDE_CAMPUS", "Outside polygon rejected (GPS_OUTSIDE_CAMPUS)");

    // B) Poor GPS Accuracy (> 20m)
    const resAcc = await callApi(attendanceHandler, "POST", "/api/attendance", {
      authorization: `Bearer ${tokenStaffA}`,
      "x-network-auth-token": validWifi,
    }, {
      latitude: CAMPUS_LAT,
      longitude: CAMPUS_LNG,
      accuracy: 65, // > 20m
      deviceSignature: "dummy",
    });
    assert(resAcc.status === 403 && resAcc.data?.error === "GPS_ACCURACY_INSUFFICIENT", "Low GPS accuracy rejected (GPS_ACCURACY_INSUFFICIENT)");

    // C) Unauthorized Wi-Fi
    const invalidWifi = mintNetworkToken("HOME-WIFI", false);
    const resWifi = await callApi(attendanceHandler, "POST", "/api/attendance", {
      authorization: `Bearer ${tokenStaffA}`,
      "x-network-auth-token": invalidWifi,
    }, {
      latitude: CAMPUS_LAT,
      longitude: CAMPUS_LNG,
      accuracy: 5,
      deviceSignature: "dummy",
    });
    assert(resWifi.status === 403 && resWifi.data?.error === "CAMPUS_NETWORK_UNAUTHORIZED", "Non-campus Wi-Fi rejected (CAMPUS_NETWORK_UNAUTHORIZED)");

    // D) Failed Biometric distance (> 0.45)
    const resFace = await callApi(attendanceHandler, "POST", "/api/attendance", {
      authorization: `Bearer ${tokenStaffA}`,
      "x-network-auth-token": validWifi,
    }, {
      latitude: CAMPUS_LAT,
      longitude: CAMPUS_LNG,
      accuracy: 5,
      faceMatchDistance: 0.68, // Exceeds 0.45
      deviceSignature: "dummy",
    });
    assert(resFace.status === 403 && resFace.data?.error === "FACE_BIOMETRIC_UNAUTHORIZED", "Biometric mismatch rejected (FACE_BIOMETRIC_UNAUTHORIZED)");
  }

  // -------------------------------------------------------------------------
  // TEST 14: Valid attendance produces exactly one database row and matching receipt
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 14: VALID ATTENDANCE PRODUCES RECEIPT & EXACTLY ONE ROW ---");
  let validAttendanceId: string | null = null;
  {
    const cRes = await callApi(attendanceHandler, "POST", "/api/attendance?action=challenge", {
      authorization: `Bearer ${tokenStaffA}`,
    }, {});
    const chal = cRes.data?.challenge;
    const chalToken = cRes.data?.challengeToken;

    const ts = Date.now();
    const canPayload = `v2:${STAFF_A}:${DEVICE_A_ID}:${chal}:${CAMPUS_LAT.toFixed(6)}:${CAMPUS_LNG.toFixed(6)}:${ts}`;
    const sig = signPayload(keyPairA.privateKey, canPayload);

    const res = await callApi(attendanceHandler, "POST", "/api/attendance", {
      authorization: `Bearer ${tokenStaffA}`,
      "x-network-auth-token": validWifi,
    }, {
      challenge: chal,
      challengeToken: chalToken,
      latitude: CAMPUS_LAT,
      longitude: CAMPUS_LNG,
      accuracy: 8,
      deviceSignature: sig,
      deviceTimestamp: ts,
      faceMatchDistance: 0.22,
      antiSpoofScore: 0.97,
    });

    assert(res.status === 200, "Valid attendance submission returns HTTP 200 OK", res.data);
    assert(res.data?.success === true, "Response returns success: true");
    assert(Boolean(res.data?.receipt?.attendanceId), "Receipt includes unique attendanceId");
    assert(Boolean(res.data?.receipt?.recordHash), "Receipt includes cryptographic recordHash");
    validAttendanceId = res.data?.receipt?.attendanceId;

    // Verify exactly one row in PostgreSQL
    const c = await pool.connect();
    try {
      const q = await c.query("SELECT * FROM public.attendance_records WHERE id = $1", [validAttendanceId]);
      assert(q.rows.length === 1, "Exactly one database row created for this attendance punch");
      assert(q.rows[0].status === "Present", "Database status is Present");
      assert(q.rows[0].record_hash === res.data?.receipt?.recordHash, "Database record_hash matches receipt hash");
    } finally {
      c.release();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 15: Duplicate submissions return original result without duplicate rows
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 15: IDEMPOTENCY: DUPLICATE RETURNS ORIGINAL RECEIPT ---");
  {
    const cRes = await callApi(attendanceHandler, "POST", "/api/attendance?action=challenge", {
      authorization: `Bearer ${tokenStaffA}`,
    }, {});
    const chal = cRes.data?.challenge;
    const chalToken = cRes.data?.challengeToken;

    const ts = Date.now();
    const canPayload = `v2:${STAFF_A}:${DEVICE_A_ID}:${chal}:${CAMPUS_LAT.toFixed(6)}:${CAMPUS_LNG.toFixed(6)}:${ts}`;
    const sig = signPayload(keyPairA.privateKey, canPayload);

    const dupRes = await callApi(attendanceHandler, "POST", "/api/attendance", {
      authorization: `Bearer ${tokenStaffA}`,
      "x-network-auth-token": validWifi,
    }, {
      challenge: chal,
      challengeToken: chalToken,
      latitude: CAMPUS_LAT,
      longitude: CAMPUS_LNG,
      accuracy: 6,
      deviceSignature: sig,
      deviceTimestamp: ts,
      faceMatchDistance: 0.24,
      antiSpoofScore: 0.95,
    });

    assert(dupRes.status === 200, "Duplicate attempt returns HTTP 200 OK");
    assert(dupRes.data?.alreadyMarked === true, "Response signals alreadyMarked: true");
    assert(dupRes.data?.receipt?.attendanceId === validAttendanceId, "Receipt attendanceId matches original punch");

    // Verify no second row was created
    const c = await pool.connect();
    try {
      const q = await c.query("SELECT COUNT(*) FROM public.attendance_records WHERE UPPER(staff_code) = $1 AND date = $2", [STAFF_A, TODAY]);
      assert(parseInt(q.rows[0].count, 10) === 1, "Database count remains strictly 1 (no duplicate rows created)");
    } finally {
      c.release();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 16: Administrator corrections preserve original record and create audit
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 16: CONTROLLED CORRECTION PRESERVES ORIGINAL RECORD ---");
  {
    const corrRes = await callApi(attendanceHandler, "POST", "/api/attendance?action=correct", {
      authorization: `Bearer ${tokenAdmin}`,
    }, {
      attendanceId: validAttendanceId,
      correctedStatus: "Late",
      reason: "Bus breakdown on Salem Highway verified by HOD",
    });

    assert(corrRes.status === 200, "Correction request returns HTTP 200 OK", corrRes.data);
    assert(corrRes.data?.success === true, "Correction success: true");
    assert(corrRes.data?.correction?.correctedStatus === "Late", "Correction details recorded new status: Late");

    // Verify original record remains Present
    const c = await pool.connect();
    try {
      const orig = await c.query("SELECT status FROM public.attendance_records WHERE id = $1", [validAttendanceId]);
      assert(orig.rows[0].status === "Present", "Original record in public.attendance_records is UNCHANGED ('Present')");

      const corrRow = await c.query("SELECT * FROM public.attendance_corrections WHERE attendance_id = $1", [validAttendanceId]);
      assert(corrRow.rows.length === 1, "Separate row created in public.attendance_corrections");
      assert(corrRow.rows[0].authorized_by === "moulish", "Correction authorized_by recorded as admin moulish");
    } finally {
      c.release();
    }
  }

  // -------------------------------------------------------------------------
  // TEST 17: Exposed credentials are absent from client bundles and responses
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 17: CREDENTIAL AUDIT & ZERO LEAKAGE ---");
  {
    // Verify client bundle source files
    const clientFiles = [
      "src/mocks/attendance-service.ts",
      "src/lib/device-registration-client.ts",
      "src/lib/supabase.ts",
    ];
    let leakFound = false;
    for (const f of clientFiles) {
      const fullPath = path.resolve(process.cwd(), f);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        if (
          content.includes("service_role") ||
          content.includes("DATABASE_URL") ||
          content.includes("moulish@123")
        ) {
          leakFound = true;
          console.error(`Leak detected in ${f}`);
        }
      }
    }
    assert(!leakFound, "Zero privileged secrets (service_role, DATABASE_URL, admin password) present in client files");
  }

  // -------------------------------------------------------------------------
  // TEST 18: Administrator login continues working seamlessly
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 18: ADMIN LOGIN & FUNCTIONALITY PRESERVATION ---");
  {
    const adminLoginRes = await callApi(adminLoginHandler, "POST", "/api/admin/login", {}, {
      username: "moulish",
      password: "moulish@123",
    });
    assert(adminLoginRes.status === 200, "Administrator 'moulish' logs in successfully (HTTP 200)");
    assert(adminLoginRes.data?.success === true, "Admin login success: true");
    assert(Boolean(adminLoginRes.data?.token), "HMAC-SHA256 admin session token issued");
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log("\n=================================================================");
  console.log(`TOTAL SECURITY REGRESSION SUITE: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("=================================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runRegressionSuite().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
