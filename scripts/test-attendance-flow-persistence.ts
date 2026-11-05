import handler from "../api/attendance";
import wifiStatusHandler from "../api/wifi-status";
import crypto from "node:crypto";

function mintToken(bssid: string): string {
  const payload = {
    authorized: true,
    bssid: bssid.toUpperCase(),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 120,
  };
  const secret = process.env["CAMPUS_AUTH_SECRET"] || process.env["NETWORK_AUTH_SECRET"] || "sona-campus-wifi-egress-auth-secret-key-2026";
  const pB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(pB64).digest("base64url");
  return `${pB64}.${sig}`;
}

function createTestStaffToken(staffCode = "SCT-002") {
  const secret =
    process.env["CAMPUS_AUTH_SECRET"] ||
    process.env["STAFF_AUTH_SECRET"] ||
    process.env["CAMPUS_ADMIN_SECRET"] ||
    "campusattend-staff-auth-session-sec-key-2026";
  const payload = {
    staffId: staffCode,
    sub: staffCode,
    role: "staff",
    expiresAt: Date.now() + 3600000,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

class MockRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;

  constructor(opts: { url?: string; method?: string; headers?: Record<string, string>; body?: any } = {}) {
    this.url = opts.url || "/api/attendance";
    this.method = opts.method || "POST";
    this.headers = opts.headers || {};
    this.body = opts.body;
  }
}

class MockResponse {
  statusCode = 200;
  headers: Record<string, string> = {};
  body: any = null;

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, val: string) {
    this.headers[name] = val;
    return this;
  }

  json(data: any) {
    this.body = data;
    return this;
  }

  end(data?: any) {
    if (data && !this.body) {
      try {
        this.body = JSON.parse(data);
      } catch {
        this.body = data;
      }
    }
    return this;
  }
}

async function runTests() {
  console.log("================================================================================");
  console.log("       CAMPUSATTEND — ATTENDANCE FLOW & PERSISTENCE TEST SUITE                  ");
  console.log("================================================================================");

  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`  [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${name} ${details ? `- ${details}` : ""}`);
      failed++;
    }
  }

  const validToken = mintToken("B0:1F:8C:29:6B:30");
  const secondaryToken = mintToken("72:CD:0D:E8:D4:B0");
  const staffToken = createTestStaffToken("SCT-002");
  const authHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${staffToken}`,
  };

  // Inside campus polygon coordinates (Authoritative Database Centroid Sona College)
  const insideLat = 11.677094;
  const insideLng = 78.125277;

  // Test 1: Face cosine distance > 0.45 rejected
  {
    const req = new MockRequest({
      headers: authHeaders,
      body: {
        staffCode: "SCT-002",
        token: staffToken,
        bssid: "B0:1F:8C:29:6B:30",
        networkAuthToken: validToken,
        latitude: insideLat,
        longitude: insideLng,
        accuracy: 10,
        faceMatchDistance: 0.46,
      },
    });
    const res = new MockResponse();
    await handler(req as any, res as any);
    assert(
      "Rejects face distance > 0.45 with 403",
      res.statusCode === 403 && res.body?.error === "FACE_BIOMETRIC_UNAUTHORIZED",
      `Got status: ${res.statusCode}, error: ${res.body?.error}`
    );
  }

  // Test 2: Face match margin < 0.08 rejected
  {
    const req = new MockRequest({
      headers: authHeaders,
      body: {
        staffCode: "SCT-002",
        token: staffToken,
        bssid: "B0:1F:8C:29:6B:30",
        networkAuthToken: validToken,
        latitude: insideLat,
        longitude: insideLng,
        accuracy: 10,
        faceMatchDistance: 0.35,
        matchMargin: 0.05,
      },
    });
    const res = new MockResponse();
    await handler(req as any, res as any);
    assert(
      "Rejects face match margin < 0.08 with 403",
      res.statusCode === 403 && res.body?.error === "FACE_MARGIN_INSUFFICIENT",
      `Got status: ${res.statusCode}, error: ${res.body?.error}`
    );
  }

  // Test 3: Unauthorized Wi-Fi BSSID rejected
  {
    const req = new MockRequest({
      headers: authHeaders,
      body: {
        staffCode: "SCT-002",
        token: staffToken,
        bssid: "11:22:33:44:55:66",
        latitude: insideLat,
        longitude: insideLng,
        accuracy: 10,
        faceMatchDistance: 0.35,
        matchMargin: 0.12,
      },
    });
    const res = new MockResponse();
    await handler(req as any, res as any);
    assert(
      "Rejects unauthorized Wi-Fi BSSID with 403",
      res.statusCode === 403 && (res.body?.error === "WIFI_BSSID_MISMATCH" || res.body?.error === "WIFI_VERIFICATION_REQUIRED"),
      `Got status: ${res.statusCode}, error: ${res.body?.error}`
    );
  }

  // Test 4: Redacted Wi-Fi BSSID rejected
  {
    const req = new MockRequest({
      headers: authHeaders,
      body: {
        staffCode: "SCT-002",
        token: staffToken,
        bssid: "02:00:00:00:00:00",
        latitude: insideLat,
        longitude: insideLng,
        accuracy: 10,
        faceMatchDistance: 0.35,
        matchMargin: 0.12,
      },
    });
    const res = new MockResponse();
    await handler(req as any, res as any);
    assert(
      "Rejects redacted BSSID 02:00:00:00:00:00 with 403",
      res.statusCode === 403 && res.body?.error === "WIFI_BSSID_UNAVAILABLE",
      `Got status: ${res.statusCode}, error: ${res.body?.error}`
    );
  }

  // Test 5: Outside campus polygon rejected
  {
    const req = new MockRequest({
      headers: authHeaders,
      body: {
        staffCode: "SCT-002",
        token: staffToken,
        bssid: "B0:1F:8C:29:6B:30",
        networkAuthToken: validToken,
        latitude: 12.9716, // Bangalore
        longitude: 77.5946,
        accuracy: 10,
        faceMatchDistance: 0.35,
        matchMargin: 0.12,
      },
    });
    const res = new MockResponse();
    await handler(req as any, res as any);
    assert(
      "Rejects outside campus GPS coordinates with 403",
      res.statusCode === 403 && res.body?.error === "GPS_OUTSIDE_CAMPUS",
      `Got status: ${res.statusCode}, error: ${res.body?.error}`
    );
  }

  // Test 6: Valid request targeting approved secondary BSSID (72:CD:0D:E8:D4:B0)
  {
    const req = new MockRequest({
      headers: authHeaders,
      body: {
        staffCode: "SCT-002",
        token: staffToken,
        bssid: "72:CD:0D:E8:D4:B0",
        networkAuthToken: secondaryToken,
        latitude: insideLat,
        longitude: insideLng,
        accuracy: 10,
        faceMatchDistance: 0.35,
        matchMargin: 0.15,
        recognizedStaffCode: "SCT-002",
      },
    });
    const res = new MockResponse();
    await handler(req as any, res as any);
    // Since Supabase / PG pool will attempt insert to attendance_record:
    // If DB is reachable: 200 with receipt, or alreadyMarked: true
    // If DB is unreachable: 500 with DATABASE_PERSISTENCE_FAILED (and NEVER synthetic UUID)
    const isValidOutcome =
      (res.statusCode === 200 && res.body?.success === true && res.body?.receipt?.attendanceId) ||
      (res.statusCode === 500 && res.body?.error === "DATABASE_PERSISTENCE_FAILED");
    assert(
      "Processes all 3 factors and attempts persistence to public.attendance_record without synthetic fallback",
      Boolean(isValidOutcome),
      `Got status: ${res.statusCode}, body: ${JSON.stringify(res.body)}`
    );
    if (res.statusCode === 500) {
      assert(
        "Does NOT issue synthetic ID when database persistence fails",
        res.body?.error === "DATABASE_PERSISTENCE_FAILED" && !res.body?.receipt,
        `Got: ${JSON.stringify(res.body)}`
      );
    } else {
      assert(
        "Returns verified database receipt with attendanceId",
        typeof res.body?.receipt?.attendanceId === "string",
        `Attendance ID: ${res.body?.receipt?.attendanceId}`
      );
    }
  }

  console.log("================================================================================");
  console.log(`       TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("================================================================================");

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
