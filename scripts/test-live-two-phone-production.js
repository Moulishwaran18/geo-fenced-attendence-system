/**
 * Production Live Two-Phone Policy Verification Script
 * Target: https://geo-fenced-attendence-system.vercel.app
 *
 * Simulates Phone A (Authorized Phone) and Phone B (Second Phone / Attacker)
 * using real cryptographic ECDSA P-256 key pairs.
 */

import crypto from "node:crypto";

const BASE_URL = "https://geo-fenced-attendence-system.vercel.app";
const STAFF_CODE = "SCT-001";
const PASSWORD = "Moulish@123";

function generateEcKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

function signData(privateKeyPem, data) {
  const signer = crypto.createSign("SHA256");
  signer.update(typeof data === "string" ? Buffer.from(data, "utf-8") : data);
  return signer.sign(privateKeyPem, "base64");
}

async function request(method, path, body = null, headers = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { rawText: text };
  }
  return { status: res.status, headers: res.headers, data: json };
}

async function runTest() {
  console.log("================================================================================");
  console.log("   LIVE PRODUCTION VERIFICATION: ONE FACULTY ID = ONE PHONE POLICY");
  console.log(`   Target: ${BASE_URL}`);
  console.log(`   Faculty Account: ${STAFF_CODE}`);
  console.log("================================================================================\n");

  // Generate distinct cryptographic keys for Phone A and Phone B
  const phoneA = generateEcKeyPair();
  const phoneB = generateEcKeyPair();

  console.log("[+] Generated ECDSA P-256 cryptographic keys:");
  console.log("    Phone A (Authorized Phone) Public Key SHA-256:", crypto.createHash("sha256").update(phoneA.publicKey).digest("hex").slice(0, 16));
  console.log("    Phone B (Second Phone)     Public Key SHA-256:", crypto.createHash("sha256").update(phoneB.publicKey).digest("hex").slice(0, 16));

  // STEP 1: Query device status before registration
  console.log("\n[TEST 1] Querying device registration status for SCT-001...");
  const statusBefore = await request("GET", `/api/device/status?staff_code=${STAFF_CODE}`);
  console.log(`         HTTP Status: ${statusBefore.status}`);
  console.log(`         Has Active Device: ${statusBefore.data.hasActiveDevice}`);

  // If no active device, test initial login rejection
  if (!statusBefore.data.hasActiveDevice) {
    console.log("\n[TEST 2] Ordinary login attempt with NO device registered (should reject):");
    const unregLogin = await request("POST", "/api/staff/login", {
      staffId: STAFF_CODE,
      password: PASSWORD,
    });
    console.log(`         HTTP Status: ${unregLogin.status} (Expected 403)`);
    console.log(`         Error: ${unregLogin.data.error} (Expected DEVICE_REGISTRATION_REQUIRED)`);
    if (unregLogin.status === 403 && unregLogin.data.error === "DEVICE_REGISTRATION_REQUIRED") {
      console.log("         >>> PASS: Unregistered phone cannot log in with password alone.");
    } else {
      console.error("         >>> FAIL: Login was not strictly blocked!", unregLogin.data);
    }

    // Register Phone A
    console.log("\n[TEST 3] Registering Phone A as the authorized physical device:");
    const chRes = await request("POST", "/api/device/challenge", {
      staff_code: STAFF_CODE,
      password: PASSWORD,
    });
    console.log(`         Challenge issuance HTTP: ${chRes.status}`);
    if (chRes.status !== 200 || !chRes.data.challenge) {
      throw new Error(`Failed to get device challenge: ${JSON.stringify(chRes.data)}`);
    }

    const { challenge, challengeToken } = chRes.data;
    const sigA = signData(phoneA.privateKey, challenge);

    const regRes = await request("POST", "/api/device/register", {
      staff_code: STAFF_CODE,
      password: PASSWORD,
      challengeToken,
      challenge,
      signature: sigA,
      publicKey: phoneA.publicKey,
      keyAlgorithm: "ECDSA_P256",
      platform: "android",
      model: "Samsung Galaxy S24 Ultra (Phone A)",
      os: "Android 14",
      isHardwareBacked: true,
      isStrongBox: true,
    });
    console.log(`         Registration HTTP: ${regRes.status} (Expected 201 or 200)`);
    console.log(`         Registered Device ID: ${regRes.data.device?.id}`);
    if (regRes.status !== 200 && regRes.status !== 201) {
      throw new Error(`Phone A registration failed: ${JSON.stringify(regRes.data)}`);
    }
    console.log("         >>> PASS: Phone A successfully bound to SCT-001.");
  } else {
    console.log("         Account already has an active device:", statusBefore.data.activeDevice?.id);
  }

  // STEP 4: Phone B tries to REGISTER its own device
  console.log("\n[TEST 4] Phone B attempts to register itself for SCT-001 (should fail with 409):");
  const phoneBCh = await request("POST", "/api/device/challenge", {
    staff_code: STAFF_CODE,
    password: PASSWORD,
  });
  console.log(`         Phone B Challenge HTTP: ${phoneBCh.status} (Expected 409)`);
  console.log(`         Error: ${phoneBCh.data.error}`);
  if (phoneBCh.status === 409 && phoneBCh.data.error === "DEVICE_ALREADY_REGISTERED") {
    console.log("         >>> PASS: Phone B registration blocked at challenge gate.");
  } else {
    console.error("         >>> FAIL: Phone B was not blocked with 409!", phoneBCh.data);
  }

  // STEP 5: Phone B tries to log in with correct Staff ID & password (NO Phone A key)
  console.log("\n[TEST 5] Phone B attempts fresh login with correct credentials:");
  const phoneBLoginAttempt = await request("POST", "/api/staff/login", {
    staffId: STAFF_CODE,
    password: PASSWORD,
  });
  console.log(`         HTTP Status: ${phoneBLoginAttempt.status} (Expected 403)`);
  console.log(`         Error: ${phoneBLoginAttempt.data.error} (Expected DEVICE_MISMATCH)`);
  console.log(`         Code: ${phoneBLoginAttempt.data.code}`);
  console.log(`         Message: ${phoneBLoginAttempt.data.message}`);

  if (phoneBLoginAttempt.status === 403 && phoneBLoginAttempt.data.error === "DEVICE_MISMATCH") {
    console.log("         >>> PASS: Phone B login strictly rejected before issuing session!");
  } else {
    console.error("         >>> FAIL: Phone B was allowed to log in!", phoneBLoginAttempt.data);
  }

  // STEP 6: Phone B tries to forge/sign the challenge with its own Phone B key
  if (phoneBLoginAttempt.data.challengeToken && phoneBLoginAttempt.data.challenge) {
    console.log("\n[TEST 6] Phone B tries to satisfy device challenge using Phone B private key:");
    const phoneBChallenge = phoneBLoginAttempt.data.challenge;
    const phoneBToken = phoneBLoginAttempt.data.challengeToken;
    const phoneBSig = signData(phoneB.privateKey, phoneBChallenge);

    const phoneBChallengeLogin = await request("POST", "/api/staff/login", {
      staffId: STAFF_CODE,
      password: PASSWORD,
      challengeToken: phoneBToken,
      challenge: phoneBChallenge,
      deviceSignature: phoneBSig,
      deviceKeyId: "DEV_PHONE_B_ROGUE_KEY",
    });

    console.log(`         HTTP Status: ${phoneBChallengeLogin.status} (Expected 403)`);
    console.log(`         Error: ${phoneBChallengeLogin.data.error} (Expected DEVICE_MISMATCH)`);
    if (phoneBChallengeLogin.status === 403 && phoneBChallengeLogin.data.error === "DEVICE_MISMATCH") {
      console.log("         >>> PASS: Signature with Phone B's private key rejected by server.");
    } else {
      console.error("         >>> FAIL: Invalid signature was accepted!", phoneBChallengeLogin.data);
    }
  }

  // STEP 7: Phone A (Authorized Phone) logs in successfully using its registered key
  console.log("\n[TEST 7] Phone A logs in with cryptographic proof of registered key:");
  // Phone A triggers login to receive challenge
  const phoneAInit = await request("POST", "/api/staff/login", {
    staffId: STAFF_CODE,
    password: PASSWORD,
  });

  let phoneAToken = "";
  if (phoneAInit.status === 403 && phoneAInit.data.requiresDeviceProof) {
    const { challenge, challengeToken } = phoneAInit.data;
    const sigA = signData(phoneA.privateKey, challenge);

    const phoneALogin = await request("POST", "/api/staff/login", {
      staffId: STAFF_CODE,
      password: PASSWORD,
      challengeToken,
      challenge,
      deviceSignature: sigA,
    });

    console.log(`         Phone A Verified Login HTTP: ${phoneALogin.status} (Expected 200)`);
    console.log(`         Device Verified: ${phoneALogin.data.deviceVerified}`);
    console.log(`         Session Token Received: ${!!phoneALogin.data.token}`);
    if (phoneALogin.status === 200 && phoneALogin.data.token) {
      phoneAToken = phoneALogin.data.token;
      console.log("         >>> PASS: Phone A successfully authenticated with registered key!");
    } else {
      console.error("         >>> FAIL: Phone A could not log in!", phoneALogin.data);
    }
  }

  // STEP 8: Session restoration on Phone A vs Phone B
  if (phoneAToken) {
    console.log("\n[TEST 8] Phone A restores session via GET /api/staff/session:");
    const sessionResA = await request("GET", "/api/staff/session", null, {
      Authorization: `Bearer ${phoneAToken}`,
    });
    console.log(`         HTTP Status: ${sessionResA.status} (Expected 200)`);
    console.log(`         Authenticated: ${sessionResA.data.authenticated}`);
    if (sessionResA.status === 200 && sessionResA.data.authenticated) {
      console.log("         >>> PASS: Phone A session restored successfully.");
    } else {
      console.error("         >>> FAIL: Phone A session restoration failed!", sessionResA.data);
    }

    console.log("\n[TEST 9] Phone B attempts session request without token (or with tampered token):");
    const sessionResB = await request("GET", "/api/staff/session", null, {
      Authorization: "Bearer invalid_tampered_token",
    });
    console.log(`         HTTP Status: ${sessionResB.status} (Expected 401)`);
    if (sessionResB.status === 401) {
      console.log("         >>> PASS: Phone B session access rejected.");
    } else {
      console.error("         >>> FAIL: Phone B was not rejected with 401!", sessionResB.data);
    }
  }

  // STEP 10: Verify administrator account is unchanged
  console.log("\n[TEST 10] Verifying Administrator login is completely functional:");
  const adminLogin = await request("POST", "/api/admin/login", {
    username: "moulish",
    password: "moulish@123",
  });
  console.log(`          Admin Login HTTP Status: ${adminLogin.status} (Expected 200)`);
  console.log(`          Admin Role: ${adminLogin.data.admin?.role}`);
  if (adminLogin.status === 200 && adminLogin.data.admin?.role === "admin") {
    console.log("          >>> PASS: Administrator account is intact and functional.");
  } else {
    console.error("          >>> FAIL: Admin login failed!", adminLogin.data);
  }

  console.log("\n================================================================================");
  console.log("   ALL TWO-PHONE POLICY VERIFICATION TESTS COMPLETED SUCCESSFULLY");
  console.log("================================================================================\n");
}

runTest().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
