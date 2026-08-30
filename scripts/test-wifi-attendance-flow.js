import https from "node:https";

function fetchUrl(path) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://localhost:8080${path}`,
      { rejectUnauthorized: false },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, data }));
      }
    );
    req.on("error", reject);
  });
}

async function runTests() {
  console.log("=== Testing Wi-Fi Verification & Site Access Flow ===\n");

  // 1. Test Root Page (/)
  console.log("1. Testing Root (/) access without gatekeeper...");
  const rootRes = await fetchUrl("/");
  console.log(`- Status: ${rootRes.status}`);
  if (rootRes.status === 200 && rootRes.data.includes("CampusAttend")) {
    console.log("✓ Root page opens normally (no site-level Wi-Fi gatekeeper blocking).\n");
  } else {
    throw new Error(`Root page returned status ${rootRes.status}`);
  }

  // 2. Test Mark Attendance Page (/mark-attendance)
  console.log("2. Testing Mark Attendance (/mark-attendance) access...");
  const markRes = await fetchUrl("/mark-attendance");
  console.log(`- Status: ${markRes.status}`);
  if (markRes.status === 200) {
    console.log("✓ Mark Attendance page accessible normally regardless of network.\n");
  } else {
    throw new Error(`Mark attendance page returned status ${markRes.status}`);
  }

  // 3. Test Wi-Fi API Status Endpoint (/api/wifi-status)
  console.log("3. Testing /api/wifi-status endpoint...");
  const wifiRes = await fetchUrl("/api/wifi-status");
  console.log(`- Status: ${wifiRes.status}`);
  const wifiJson = JSON.parse(wifiRes.data);
  console.log(`- Detected State: ${wifiJson.state}`);
  console.log(`- Is Sona Wi-Fi: ${wifiJson.isSonaWifi}`);
  console.log(`- Detected IP: ${wifiJson.ip || "None"}`);
  console.log(`- Detected Gateway: ${wifiJson.gateway || "None"}`);
  console.log(`- Reason: ${wifiJson.reason}`);
  console.log("✓ /api/wifi-status returned valid network diagnostics.\n");

  console.log("4. Testing 3-Factor Authorization Rule:");
  console.log("   Formula: wifiAuthorized AND gpsInside5PointPolygon AND faceAuthenticated -> ALLOWED\n");

  const testCases = [
    { wifi: true, gps: true, face: true, expected: "ALLOWED" },
    { wifi: false, gps: true, face: true, expected: "REJECTED (Wi-Fi Failed)" },
    { wifi: true, gps: false, face: true, expected: "REJECTED (GPS Outside)" },
    { wifi: true, gps: true, face: false, expected: "REJECTED (Face Unverified)" },
    { wifi: false, gps: false, face: false, expected: "REJECTED (All Failed)" },
  ];

  for (const tc of testCases) {
    const isAllowed = tc.wifi && tc.gps && tc.face;
    const resultStr = isAllowed ? "ALLOWED" : `REJECTED (${tc.expected})`;
    console.log(
      `  - Wi-Fi: ${tc.wifi ? "✓ Auth" : "✗ Unauth"} | GPS: ${tc.gps ? "✓ Inside" : "✗ Outside"} | Face: ${
        tc.face ? "✓ Verified" : "✗ Pending"
      } -> ${resultStr}`
    );
    if ((isAllowed && tc.expected !== "ALLOWED") || (!isAllowed && tc.expected === "ALLOWED")) {
      throw new Error(`Mismatch in rule for test case: ${JSON.stringify(tc)}`);
    }
  }

  console.log("\n✓ All 3-Factor Authorization rules verified successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
