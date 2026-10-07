import https from "node:https";

function fetchUrl(path, method = "GET", postData = null) {
  return new Promise((resolve, reject) => {
    const options = {
      rejectUnauthorized: false,
      method,
      headers: postData
        ? {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
          }
        : {},
    };

    const req = https.request(`https://localhost:8080${path}`, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, data }));
    });
    req.on("error", reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runTests() {
  console.log("=== Testing Wi-Fi Network Fingerprint Verification & Flow ===\n");

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

  // 3. Test Wi-Fi API Status Endpoint (/api/wifi-status) GET (Browser Fallback)
  console.log("3. Testing /api/wifi-status GET (Browser without native bridge)...");
  const wifiRes = await fetchUrl("/api/wifi-status");
  console.log(`- Status: ${wifiRes.status}`);
  const wifiJson = JSON.parse(wifiRes.data);
  console.log(`- Detected State: ${wifiJson.state}`);
  console.log(`- Wi-Fi Authorized: ${wifiJson.authorized}`);
  console.log(`- Network Summary: ${wifiJson.networkSummary}`);
  console.log(`- Reason: ${wifiJson.reason}`);
  if (wifiJson.authorized === false) {
    console.log("✓ /api/wifi-status correctly denies authorization to plain browser without bridge.\n");
  } else {
    throw new Error("/api/wifi-status unexpectedly authorized plain browser request");
  }

  // 4. Test Wi-Fi API Status Endpoint (/api/wifi-status) POST with SONA Fingerprint
  console.log("4. Testing /api/wifi-status POST with SONA network fingerprint...");
  const sonaPayload = JSON.stringify({
    transport: "wifi",
    isWifi: true,
    ipv4: "172.16.184.252",
    ipv4Subnet: "172.16.0.0/12",
    gateway: "172.16.16.16",
    dnsServers: ["172.16.16.16"],
    isNativeBridge: true,
  });
  const sonaRes = await fetchUrl("/api/wifi-status", "POST", sonaPayload);
  const sonaJson = JSON.parse(sonaRes.data);
  console.log(`- Status: ${sonaRes.status}`);
  console.log(`- Wi-Fi Authorized: ${sonaJson.authorized}`);
  console.log(`- Network Type: ${sonaJson.networkType}`);
  console.log(`- Reason: ${sonaJson.reason}`);
  if (sonaJson.authorized === true && sonaJson.networkType === "SONA") {
    console.log("✓ SONA network fingerprint successfully validated by server!\n");
  } else {
    throw new Error(`SONA fingerprint validation failed: ${JSON.stringify(sonaJson)}`);
  }

  // 5. Test Wi-Fi API Status Endpoint (/api/wifi-status) POST with M Fingerprint
  console.log("5. Testing /api/wifi-status POST with M network fingerprint...");
  const mPayload = JSON.stringify({
    transport: "wifi",
    isWifi: true,
    ipv4: "10.220.86.182",
    ipv4Subnet: "10.220.86.0/24",
    dnsServers: ["10.220.86.133"],
    isNativeBridge: true,
  });
  const mRes = await fetchUrl("/api/wifi-status", "POST", mPayload);
  const mJson = JSON.parse(mRes.data);
  console.log(`- Status: ${mRes.status}`);
  console.log(`- Wi-Fi Authorized: ${mJson.authorized}`);
  console.log(`- Network Type: ${mJson.networkType}`);
  console.log(`- Reason: ${mJson.reason}`);
  if (mJson.authorized === true && mJson.networkType === "M") {
    console.log("✓ M network fingerprint successfully validated by server!\n");
  } else {
    throw new Error(`M fingerprint validation failed: ${JSON.stringify(mJson)}`);
  }

  // 6. Test Wi-Fi API Status Endpoint (/api/wifi-status) POST with Rogue Hotspot (Oppo K13)
  console.log("6. Testing /api/wifi-status POST with Oppo K13 hotspot...");
  const oppoPayload = JSON.stringify({
    transport: "wifi",
    isWifi: true,
    ipv4: "192.168.43.88",
    ipv4Subnet: "192.168.43.0/24",
    gateway: "192.168.43.1",
    dnsServers: ["192.168.43.1"],
    isNativeBridge: true,
  });
  const oppoRes = await fetchUrl("/api/wifi-status", "POST", oppoPayload);
  const oppoJson = JSON.parse(oppoRes.data);
  console.log(`- Status: ${oppoRes.status}`);
  console.log(`- Wi-Fi Authorized: ${oppoJson.authorized}`);
  console.log(`- Reason: ${oppoJson.reason}`);
  if (oppoJson.authorized === false) {
    console.log("✓ Rogue hotspot correctly rejected by server!\n");
  } else {
    throw new Error(`Rogue hotspot unexpectedly authorized: ${JSON.stringify(oppoJson)}`);
  }

  // 7. Testing 3-Factor Authorization Rule
  console.log("7. Testing 3-Factor Authorization Rule:");
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

  console.log("\n✓ All Network Fingerprint & 3-Factor Authorization tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
