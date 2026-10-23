/**
 * Verification of Live Vercel Production Deployment for Administrator Auth
 */

async function run() {
  const base = "https://geo-fenced-attendence-system.vercel.app";
  console.log("=================================================================");
  console.log("   CAMPUSATTEND LIVE VERCEL PRODUCTION VERIFICATION             ");
  console.log("   URL: " + base);
  console.log("=================================================================\n");

  let isLive = false;
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      const ping = await fetch(base + "/api/admin/session", { method: "GET" });
      console.log(`[Attempt ${attempt}] GET /api/admin/session returned HTTP ${ping.status}`);
      if (ping.status === 401) {
        console.log("--> Deployment is LIVE and active!\n");
        isLive = true;
        break;
      }
    } catch (err) {
      console.log(`[Attempt ${attempt}] Network error:`, err.message);
    }
    await new Promise((r) => setTimeout(r, 6000));
  }

  if (!isLive) {
    console.error("Timeout waiting for production deployment to propagate.");
    process.exit(1);
  }

  // 1. Missing Token test -> HTTP 401
  const unauthRes = await fetch(base + "/api/admin/session", { method: "GET" });
  const unauthData = await unauthRes.json();
  console.log("1. Unauthenticated GET /api/admin/session:", unauthRes.status, unauthData.code);
  if (unauthRes.status !== 401 || unauthData.code !== "TOKEN_MISSING") {
    throw new Error("Expected 401 TOKEN_MISSING for unauthenticated /api/admin/session");
  }

  // 2. Invalid Password test -> HTTP 401
  const badLogin = await fetch(base + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "moulish", password: "wrongpassword999" }),
  });
  const badLoginData = await badLogin.json();
  console.log("2. Incorrect credentials login:", badLogin.status, badLoginData.error);
  if (badLogin.status !== 401) {
    throw new Error("Expected 401 for incorrect credentials");
  }

  // 3. Valid Login with moulish and moulish@123 -> HTTP 200
  const loginRes = await fetch(base + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "moulish", password: "moulish@123" }),
  });
  const loginData = await loginRes.json();
  const setCookie = loginRes.headers.get("set-cookie") || "";
  console.log("3. Valid credentials login: HTTP", loginRes.status, "Token present:", !!loginData.token);
  console.log("   Admin User:", loginData.admin);
  if (loginRes.status !== 200 || !loginData.token || loginData.admin.username !== "moulish") {
    throw new Error("Login failed with valid credentials");
  }

  // 4. Session Verification via Authorization: Bearer <token> -> HTTP 200
  const sessBearerRes = await fetch(base + "/api/admin/session", {
    method: "GET",
    headers: { Authorization: "Bearer " + loginData.token },
  });
  const sessBearerData = await sessBearerRes.json();
  console.log("4. Session via Bearer token: HTTP", sessBearerRes.status, "Authenticated:", sessBearerData.authenticated);
  console.log("   Session Admin:", sessBearerData.admin);
  if (sessBearerRes.status !== 200 || !sessBearerData.authenticated || sessBearerData.admin.username !== "moulish") {
    throw new Error("Session verification failed via Bearer token");
  }

  // 5. Session Verification via Cookie -> HTTP 200
  const cookieMatch = setCookie ? setCookie.split(";")[0] : `admin_session=${loginData.token}`;
  const sessCookieRes = await fetch(base + "/api/admin/session", {
    method: "GET",
    headers: { Cookie: cookieMatch },
  });
  const sessCookieData = await sessCookieRes.json();
  console.log("5. Session via Cookie header: HTTP", sessCookieRes.status, "Authenticated:", sessCookieData.authenticated);
  if (sessCookieRes.status !== 200 || !sessCookieData.authenticated) {
    throw new Error("Session verification failed via Cookie");
  }

  // 6. Protected Admin Staff API Access -> HTTP 200
  const staffRes = await fetch(base + "/api/admin/staff", {
    method: "GET",
    headers: { Authorization: "Bearer " + loginData.token },
  });
  const staffData = await staffRes.json();
  console.log("6. Protected /api/admin/staff: HTTP", staffRes.status, "Staff count:", staffData.count || (staffData.data ? staffData.data.length : 0));
  if (staffRes.status !== 200) {
    throw new Error("Protected /api/admin/staff access failed with valid token");
  }

  // 7. Protected Admin Face Requests API Access -> HTTP 200
  const faceReqRes = await fetch(base + "/api/admin/face-requests", {
    method: "GET",
    headers: { Authorization: "Bearer " + loginData.token },
  });
  const faceReqData = await faceReqRes.json();
  console.log("7. Protected /api/admin/face-requests: HTTP", faceReqRes.status, "Count:", faceReqData.count);
  if (faceReqRes.status !== 200) {
    throw new Error("Protected /api/admin/face-requests failed with valid token");
  }

  // 8. Unauthenticated Access to Protected APIs is strictly rejected (HTTP 401)
  const unauthStaff = await fetch(base + "/api/admin/staff", { method: "GET" });
  console.log("8. Unauthenticated /api/admin/staff: HTTP", unauthStaff.status, "(Expected 401)");
  if (unauthStaff.status !== 401) {
    throw new Error("Unauthenticated /api/admin/staff must return 401");
  }

  // 9. Logout -> HTTP 200
  const logoutRes = await fetch(base + "/api/admin/logout", {
    method: "POST",
    headers: { Authorization: "Bearer " + loginData.token },
  });
  const logoutData = await logoutRes.json();
  console.log("9. Logout /api/admin/logout: HTTP", logoutRes.status, "Message:", logoutData.message);
  if (logoutRes.status !== 200) {
    throw new Error("Logout failed");
  }

  console.log("\n=================================================================");
  console.log("   ALL LIVE PRODUCTION VERIFICATIONS PASSED SUCCESSFULLY!        ");
  console.log("=================================================================");
}

run().catch((err) => {
  console.error("Live verification error:", err);
  process.exit(1);
});
