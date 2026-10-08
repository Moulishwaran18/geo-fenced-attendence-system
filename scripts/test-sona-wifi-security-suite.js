import {
  extractTrustedClientIp,
  isAuthorizedCampusEgressIp,
  getAuthorizedCampusEgressIps,
  sanitizeIp,
} from "../src/lib/wifi-config.ts";
import {
  createNetworkAuthToken,
  verifyNetworkAuthToken,
} from "../src/server/network-auth.ts";
import wifiStatusHandler, { setDevServerPublicIpForTesting } from "../api/wifi-status.ts";
import attendanceHandler from "../api/attendance.ts";

console.log("=================================================================");
console.log("   SONA-WIFI SERVER-SIDE DUAL-EGRESS SECURITY TEST SUITE         ");
console.log("   Authorized Egress IPs: 111.92.42.18 (Asianet) & 115.247.87.98 (Jio)");
console.log("   Architecture: Option B - Server-Side Dual-Egress Verification   ");
console.log("   Zero Client Trust: Anti-Spoofing & Cryptographic Hard Gate     ");
console.log("=================================================================\n");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

// Helper to mock Vercel / Node serverless request & response
function createMockReqRes({
  method = "GET",
  headers = {},
  body = {},
  socketRemoteAddress = "127.0.0.1",
} = {}) {
  const req = {
    method,
    headers: { ...headers },
    body,
    socket: { remoteAddress: socketRemoteAddress },
    connection: { remoteAddress: socketRemoteAddress },
  };

  let resData = null;
  let resStatus = 200;
  let resHeaders = {};

  const res = {
    statusCode: 200,
    setHeader(key, value) {
      resHeaders[key.toLowerCase()] = value;
    },
    status(code) {
      resStatus = code;
      this.statusCode = code;
      return this;
    },
    json(data) {
      resData = data;
      return this;
    },
    end(str) {
      if (str && !resData) {
        try {
          resData = JSON.parse(str);
        } catch {
          resData = str;
        }
      }
    },
  };

  return {
    req,
    res,
    getResponse: () => ({ status: resStatus, headers: resHeaders, body: resData }),
  };
}

async function runSecurityTests() {
  // =================================================================
  // 1. AUTHORIZED CAMPUS EGRESS IPS VERIFICATION
  // =================================================================
  console.log("--- 1. AUTHORIZED CAMPUS EGRESS IP UNIT TESTS ---");
  const authorizedList = getAuthorizedCampusEgressIps();
  assert(authorizedList.includes("111.92.42.18"), "Authorized list contains Asianet 111.92.42.18");
  assert(authorizedList.includes("115.247.87.98"), "Authorized list contains Jio 115.247.87.98");

  const r1 = isAuthorizedCampusEgressIp("111.92.42.18");
  assert(r1.authorized === true, "111.92.42.18 is AUTHORIZED");
  assert(r1.matchedIp === "111.92.42.18", "111.92.42.18 matched correctly");

  const r2 = isAuthorizedCampusEgressIp("115.247.87.98");
  assert(r2.authorized === true, "115.247.87.98 is AUTHORIZED");
  assert(r2.matchedIp === "115.247.87.98", "115.247.87.98 matched correctly");

  // =================================================================
  // 2. UNAUTHORIZED, MISSING, AND MALFORMED IPS
  // =================================================================
  console.log("\n--- 2. UNAUTHORIZED, MISSING, AND MALFORMED IP TESTS ---");
  const rJioMobile = isAuthorizedCampusEgressIp("49.37.12.34");
  assert(rJioMobile.authorized === false, "Cellular IP 49.37.12.34 is UNAUTHORIZED");

  const rHomeWifi = isAuthorizedCampusEgressIp("192.168.1.100");
  assert(rHomeWifi.authorized === false, "Home Wi-Fi IP 192.168.1.100 is UNAUTHORIZED");

  const rMissing = isAuthorizedCampusEgressIp("");
  assert(rMissing.authorized === false, "Empty IP string is UNAUTHORIZED");

  const rNull = isAuthorizedCampusEgressIp(null);
  assert(rNull.authorized === false, "Null IP is UNAUTHORIZED");

  const rMalformed = isAuthorizedCampusEgressIp("999.999.999.999");
  assert(rMalformed.authorized === false, "Malformed IP 999.999.999.999 is UNAUTHORIZED");

  const rInjection = isAuthorizedCampusEgressIp("111.92.42.18; DROP TABLE users;");
  assert(rInjection.authorized === false, "SQL/Command injection IP string is UNAUTHORIZED");

  // IPv6 mapped IPv4 handling
  assert(sanitizeIp("::ffff:111.92.42.18") === "111.92.42.18", "IPv6-mapped IPv4 ::ffff:111.92.42.18 normalizes to 111.92.42.18");
  const rIpv6Mapped = isAuthorizedCampusEgressIp("::ffff:111.92.42.18");
  assert(rIpv6Mapped.authorized === true, "IPv6-mapped ::ffff:111.92.42.18 is AUTHORIZED");

  // =================================================================
  // 3. ANTI-SPOOFING HEADER INJECTION DEFENSE TESTS
  // =================================================================
  console.log("\n--- 3. ANTI-SPOOFING HEADER INJECTION DEFENSE TESTS ---");

  // Scenario A: Attacker on mobile data (49.37.12.34) sends forged X-Forwarded-For: 111.92.42.18
  // Vercel appends the real IP at the end of the chain.
  const spoofReq1 = {
    headers: {
      "x-forwarded-for": "111.92.42.18, 49.37.12.34",
    },
  };
  const extractedIp1 = extractTrustedClientIp(spoofReq1);
  assert(extractedIp1 === "49.37.12.34", `Attacker spoofed X-Forwarded-For prefix; server trusted peer IP is ${extractedIp1} (not spoofed prefix)`);
  assert(isAuthorizedCampusEgressIp(extractedIp1).authorized === false, "Spoofed request is REJECTED");

  // Scenario B: Attacker sends raw X-Real-IP while Vercel sets trusted x-vercel-forwarded-for
  const spoofReq2 = {
    headers: {
      "x-real-ip": "111.92.42.18",
      "x-vercel-forwarded-for": "49.37.12.34",
    },
  };
  const extractedIp2 = extractTrustedClientIp(spoofReq2);
  assert(extractedIp2 === "49.37.12.34", `Vercel trusted header x-vercel-forwarded-for takes precedence over spoofed x-real-ip (${extractedIp2})`);
  assert(isAuthorizedCampusEgressIp(extractedIp2).authorized === false, "Precedence spoof attack is REJECTED");

  // Scenario C: Legitimate Vercel request from campus egress IP
  const legitReq = {
    headers: {
      "x-vercel-forwarded-for": "111.92.42.18",
    },
  };
  const extractedIpLegit = extractTrustedClientIp(legitReq);
  assert(extractedIpLegit === "111.92.42.18", `Legitimate campus IP extracted: ${extractedIpLegit}`);
  assert(isAuthorizedCampusEgressIp(extractedIpLegit).authorized === true, "Legitimate campus IP is AUTHORIZED");

  // =================================================================
  // 4. API /api/wifi-status SERVER-SIDE ENDPOINT TESTS
  // =================================================================
  console.log("\n--- 4. /api/wifi-status SERVER-SIDE ENDPOINT TESTS ---");

  // Test 4A: Normal Android Chrome on SONA-WIFI (Egress: 111.92.42.18)
  const { req: wsReq1, res: wsRes1, getResponse: wsGet1 } = createMockReqRes({
    headers: { "x-vercel-forwarded-for": "111.92.42.18" },
  });
  await wifiStatusHandler(wsReq1, wsRes1);
  const resp1 = wsGet1();
  assert(resp1.status === 200, "Status is 200");
  assert(resp1.body.authorized === true, "authorized is true");
  assert(resp1.body.network === "SONA Campus Network", 'network is "SONA Campus Network"');
  assert(resp1.body.verificationMethod === "SERVER_EGRESS_IP", 'verificationMethod is "SERVER_EGRESS_IP"');
  assert(resp1.body.verifiedIp === "111.92.42.18", "verifiedIp is 111.92.42.18");
  assert(typeof resp1.body.networkAuthToken === "string" && resp1.body.networkAuthToken.length > 20, "networkAuthToken is issued");

  // Test 4B: Normal Android Chrome on Mobile Data (Egress: 49.37.12.34)
  const { req: wsReq2, res: wsRes2, getResponse: wsGet2 } = createMockReqRes({
    headers: { "x-vercel-forwarded-for": "49.37.12.34" },
  });
  await wifiStatusHandler(wsReq2, wsRes2);
  const resp2 = wsGet2();
  assert(resp2.status === 200, "Status is 200");
  assert(resp2.body.authorized === false, "authorized is false for mobile data");
  assert(resp2.body.network === "Unauthorized Network", 'network is "Unauthorized Network"');
  assert(resp2.body.networkAuthToken === undefined, "networkAuthToken is NOT issued for unauthorized network");

  // Test 4C: Malicious client attempting to claim wifiAuthorized=true in POST body
  const { req: wsReq3, res: wsRes3, getResponse: wsGet3 } = createMockReqRes({
    method: "POST",
    headers: { "x-vercel-forwarded-for": "49.37.12.34" },
    body: {
      wifiAuthorized: true,
      ssid: "SONA-WIFI",
      clientProvidedIp: "111.92.42.18",
    },
  });
  await wifiStatusHandler(wsReq3, wsRes3);
  const resp3 = wsGet3();
  assert(resp3.body.authorized === false, "Client body {wifiAuthorized: true, ssid: 'SONA-WIFI'} is IGNORED by server");

  // =================================================================
  // 5. CRYPTOGRAPHIC NETWORK AUTH TOKEN ENGINE TESTS
  // =================================================================
  console.log("\n--- 5. CRYPTOGRAPHIC NETWORK AUTH TOKEN ENGINE TESTS ---");
  const token = createNetworkAuthToken("111.92.42.18");
  assert(typeof token === "string" && token.includes("."), "Token format is valid payload.sig");

  const validCheck = verifyNetworkAuthToken(token);
  assert(validCheck.valid === true, "Genuine token verified successfully");
  assert(validCheck.payload.verifiedIp === "111.92.42.18", "Token contains verifiedIp 111.92.42.18");

  // Tampered Token Attack
  const parts = token.split(".");
  const tamperedPayload = Buffer.from(
    JSON.stringify({ verifiedIp: "111.92.42.18", expiresAt: Date.now() + 100000, auth: true })
  ).toString("base64url");
  const tamperedToken = `${tamperedPayload}.${parts[1]}`;
  const tamperedCheck = verifyNetworkAuthToken(tamperedToken);
  assert(tamperedCheck.valid === false, "Tampered payload token signature REJECTED");

  // Expired Token Attack
  const expiredPayload = Buffer.from(
    JSON.stringify({ verifiedIp: "111.92.42.18", expiresAt: Date.now() - 5000 })
  ).toString("base64url");
  const expiredToken = `${expiredPayload}.${parts[1]}`;
  const expiredCheck = verifyNetworkAuthToken(expiredToken);
  assert(expiredCheck.valid === false, "Expired token REJECTED");

  // =================================================================
  // 6. ATTENDANCE HARD GATE /api/attendance TESTS
  // =================================================================
  console.log("\n--- 6. ATTENDANCE HARD GATE /api/attendance TESTS ---");

  // Test 6A: Direct Attendance API call with NO token and off-campus IP (Mobile Data)
  const { req: attReq1, res: attRes1, getResponse: attGet1 } = createMockReqRes({
    method: "POST",
    headers: { "x-vercel-forwarded-for": "49.37.12.34" },
    body: {
      studentId: "STU001",
      name: "Test Student",
      confidence: 0.95,
      liveConfidence: 0.98,
    },
  });
  await attendanceHandler(attReq1, attRes1);
  const attResp1 = attGet1();
  assert(attResp1.status === 403, "Direct attendance without server authorization returns HTTP 403 Forbidden");
  assert(attResp1.body.error === "CAMPUS_NETWORK_UNAUTHORIZED", "Error is CAMPUS_NETWORK_UNAUTHORIZED");

  // Test 6B: Direct Attendance API call with client claiming wifiAuthorized: true in JSON
  const { req: attReq2, res: attRes2, getResponse: attGet2 } = createMockReqRes({
    method: "POST",
    headers: { "x-vercel-forwarded-for": "49.37.12.34" },
    body: {
      studentId: "STU001",
      wifiAuthorized: true,
      ssid: "SONA-WIFI",
      networkStatus: "VERIFIED",
    },
  });
  await attendanceHandler(attReq2, attRes2);
  const attResp2 = attGet2();
  assert(attResp2.status === 403, "Client-provided wifiAuthorized: true in body REJECTED (HTTP 403)");

  // Test 6C: Attendance API call with spoofed IP header and NO token
  const { req: attReq3, res: attRes3, getResponse: attGet3 } = createMockReqRes({
    method: "POST",
    headers: {
      "x-real-ip": "111.92.42.18",
      "x-vercel-forwarded-for": "49.37.12.34", // Real IP appended by Vercel
    },
    body: {
      studentId: "STU001",
    },
  });
  await attendanceHandler(attReq3, attRes3);
  const attResp3 = attGet3();
  assert(attResp3.status === 403, "Fake IP header attack on attendance API REJECTED (HTTP 403)");

  // Test 6D: Attendance API call with VALID server-issued networkAuthToken
  const validToken = createNetworkAuthToken("111.92.42.18");
  const { req: attReq4, res: attRes4, getResponse: attGet4 } = createMockReqRes({
    method: "POST",
    headers: {
      "x-vercel-forwarded-for": "49.37.12.34", // Even if client is routing through local tunnel
      "x-network-auth-token": validToken,
    },
    body: {
      studentId: "STU001",
      name: "Test Student",
      confidence: 0.95,
      liveConfidence: 0.98,
    },
  });
  await attendanceHandler(attReq4, attRes4);
  const attResp4 = attGet4();
  assert(attResp4.status === 200, "Attendance with valid server token succeeds (HTTP 200 OK)");
  assert(attResp4.body.success === true, "Attendance response success is true");
  assert(attResp4.body.verifiedNetwork === "SONA Campus Network", 'verifiedNetwork is "SONA Campus Network"');

  // Test 6E: Attendance API call directly connected from authorized campus egress IP 115.247.87.98 (Jio)
  const { req: attReq5, res: attRes5, getResponse: attGet5 } = createMockReqRes({
    method: "POST",
    headers: {
      "x-vercel-forwarded-for": "115.247.87.98",
    },
    body: {
      studentId: "STU002",
      name: "Test Student 2",
      confidence: 0.94,
      liveConfidence: 0.96,
    },
  });
  await attendanceHandler(attReq5, attRes5);
  const attResp5 = attGet5();
  assert(attResp5.status === 200, "Attendance direct from campus egress IP 115.247.87.98 succeeds (HTTP 200 OK)");
  // =================================================================
  // 7. DEVELOPMENT-ONLY LOCALHOST EGRESS VERIFICATION TESTS
  // =================================================================
  console.log("\n--- 7. DEVELOPMENT-ONLY LOCALHOST EGRESS VERIFICATION TESTS ---");

  // Test 7A: localhost + authorized public egress (115.247.87.98 Jio) -> authorized & token minted
  setDevServerPublicIpForTesting("115.247.87.98");
  const { req: devReq1, res: devRes1, getResponse: devGet1 } = createMockReqRes({
    socketRemoteAddress: "127.0.0.1",
  });
  await wifiStatusHandler(devReq1, devRes1);
  const devResp1 = devGet1();
  assert(devResp1.status === 200, "Localhost on authorized egress returns HTTP 200");
  assert(devResp1.body.authorized === true, "Localhost on authorized egress is AUTHORIZED");
  assert(devResp1.body.verifiedIp === "115.247.87.98", "verifiedIp is 115.247.87.98");
  assert(devResp1.body.verificationMethod === "SERVER_DEV_EGRESS_IP", 'verificationMethod is "SERVER_DEV_EGRESS_IP"');
  assert(typeof devResp1.body.networkAuthToken === "string" && devResp1.body.networkAuthToken.length > 20, "networkAuthToken is issued for localhost");

  // Test 7B: localhost + authorized public egress (111.92.42.18 Asianet) -> authorized & token minted
  setDevServerPublicIpForTesting("111.92.42.18");
  const { req: devReq2, res: devRes2, getResponse: devGet2 } = createMockReqRes({
    socketRemoteAddress: "127.0.0.1",
  });
  await wifiStatusHandler(devReq2, devRes2);
  const devResp2 = devGet2();
  assert(devResp2.body.authorized === true, "Localhost with Asianet egress 111.92.42.18 is AUTHORIZED");
  assert(devResp2.body.verifiedIp === "111.92.42.18", "verifiedIp is 111.92.42.18");

  // Test 7C: localhost + unauthorized public egress (49.37.12.34 Mobile Data) -> rejected
  setDevServerPublicIpForTesting("49.37.12.34");
  const { req: devReq3, res: devRes3, getResponse: devGet3 } = createMockReqRes({
    socketRemoteAddress: "127.0.0.1",
  });
  await wifiStatusHandler(devReq3, devRes3);
  const devResp3 = devGet3();
  assert(devResp3.body.authorized === false, "Localhost on cellular egress 49.37.12.34 is REJECTED");
  assert(devResp3.body.network === "Unauthorized Network", 'network is "Unauthorized Network"');
  assert(devResp3.body.networkAuthToken === undefined, "networkAuthToken is NOT issued for unauthorized egress");

  // Test 7D: 127.0.0.1 alone (egress lookup failure / null) -> rejected
  setDevServerPublicIpForTesting(null);
  // Temporarily stub fetch to reject so live lookup doesn't succeed when testing null/failure
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Offline / DNS failure"); };
  const { req: devReq4, res: devRes4, getResponse: devGet4 } = createMockReqRes({
    socketRemoteAddress: "127.0.0.1",
  });
  await wifiStatusHandler(devReq4, devRes4);
  const devResp4 = devGet4();
  assert(devResp4.body.authorized === false, "127.0.0.1 alone with no public egress is REJECTED (never authorized simply for being 127.0.0.1)");
  assert(devResp4.body.networkAuthToken === undefined, "networkAuthToken is NOT issued when egress lookup fails");
  globalThis.fetch = originalFetch; // restore fetch

  // Test 7E: Attacker on localhost sends fake X-Forwarded-For: 111.92.42.18 while egress is unauthorized (49.37.12.34) -> rejected
  setDevServerPublicIpForTesting("49.37.12.34");
  const { req: devReq5, res: devRes5, getResponse: devGet5 } = createMockReqRes({
    socketRemoteAddress: "127.0.0.1",
    headers: {
      "x-forwarded-for": "111.92.42.18",
      "x-real-ip": "111.92.42.18",
    },
  });
  await wifiStatusHandler(devReq5, devRes5);
  const devResp5 = devGet5();
  assert(devResp5.body.authorized === false, "Fake X-Forwarded-For / X-Real-IP on localhost is IGNORED; server uses real egress (REJECTED)");

  // Test 7F: Production Vercel behavior unchanged (fallback NEVER executes in Vercel environment)
  process.env.VERCEL = "1";
  setDevServerPublicIpForTesting("115.247.87.98"); // even if dev mock is set
  const { req: prodReq, res: prodRes, getResponse: prodGet } = createMockReqRes({
    socketRemoteAddress: "127.0.0.1", // incoming socket is 127.0.0.1 without vercel header
  });
  await wifiStatusHandler(prodReq, prodRes);
  const prodResp = prodGet();
  assert(prodResp.body.authorized === false, "In Vercel environment, local dev egress fallback NEVER executes; internal 127.0.0.1 is REJECTED");
  delete process.env.VERCEL; // restore

  // Test 7G: Direct Attendance on localhost with authorized dev egress -> authorized
  setDevServerPublicIpForTesting("115.247.87.98");
  const { req: attDevReq1, res: attDevRes1, getResponse: attDevGet1 } = createMockReqRes({
    method: "POST",
    socketRemoteAddress: "127.0.0.1",
    body: { studentId: "DEV_STU_001", name: "Dev Student" },
  });
  await attendanceHandler(attDevReq1, attDevRes1);
  const attDevResp1 = attDevGet1();
  assert(attDevResp1.status === 200, "Direct attendance on localhost with authorized dev egress succeeds (HTTP 200)");
  assert(attDevResp1.body.success === true, "Direct attendance success is true");

  // Test 7H: Direct Attendance on localhost with unauthorized dev egress -> rejected
  setDevServerPublicIpForTesting("49.37.12.34");
  const { req: attDevReq2, res: attDevRes2, getResponse: attDevGet2 } = createMockReqRes({
    method: "POST",
    socketRemoteAddress: "127.0.0.1",
    body: { studentId: "DEV_STU_002", name: "Dev Student" },
  });
  await attendanceHandler(attDevReq2, attDevRes2);
  const attDevResp2 = attDevGet2();
  assert(attDevResp2.status === 403, "Direct attendance on localhost with unauthorized dev egress is REJECTED (HTTP 403)");
  assert(attDevResp2.body.error === "CAMPUS_NETWORK_UNAUTHORIZED", "Error is CAMPUS_NETWORK_UNAUTHORIZED");

  // Reset test override
  setDevServerPublicIpForTesting(null);

  console.log("\n=================================================================");
  console.log(`TEST SUITE FINISHED: ${passed} Passed, ${failed} Failed`);
  console.log("=================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityTests().catch((err) => {
  console.error("Test suite crashed:", err);
  process.exit(1);
});
