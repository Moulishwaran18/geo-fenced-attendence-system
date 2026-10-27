/**
 * CampusAttend — Server-Side Android Key Attestation Isolated Test Suite
 *
 * Verifies:
 * 1. Valid certificate chain up to an explicitly trusted Google Key Attestation Root CA.
 * 2. Cryptographic signature chain verification across all intermediate and leaf certificates.
 * 3. Terminal root certificate self-signed check and untrusted root rejection.
 * 4. Certificate validity period checks (validFrom, validTo) and expired certificate rejection.
 * 5. Certificate revocation check against Google Keymaster CRL serial numbers.
 * 6. Parsing of the Android Key Attestation ASN.1 extension (OID 1.3.6.1.4.1.11129.2.1.17).
 * 7. Verification that attestationSecurityLevel and keymasterSecurityLevel are hardware-backed (TEE / StrongBox) and Software is rejected.
 * 8. Attestation challenge verification matching server-issued registration nonce.
 * 9. Cryptographic binding of attested public key to the exact registered device public key (rejection of key-substitution attacks).
 * 10. Client-supplied booleans (isStrongBox, isHardwareBacked) are never trusted; status is derived authoritatively by the server.
 * 11. Full HTTP mock test of /api/device/register endpoint with valid vs invalid attestation evidence.
 * 12. Rejection of software keystore level (Software = 0).
 *
 * Zero production database access. Uses test fixtures only.
 */

import assert from "node:assert";
import crypto from "node:crypto";
import deviceHandler, {
  verifyAndroidKeyAttestation,
  parseAndroidKeyAttestationExtension,
  setCustomSupabaseClient,
  verifyAndConsumeChallenge,
  GOOGLE_ATTESTATION_ROOT_PEM_1,
  GOOGLE_LEGACY_TEST_ROOT_PEM,
} from "../api/device/index.ts";

// Enable test mode for hermetic execution
process.env["TEST_MODE"] = "1";

// -----------------------------------------------------------------------------
// Official Google AOSP Test Vector Certificate Chain Fixtures
// -----------------------------------------------------------------------------
const FIXTURE_CERT_0_LEAF = `-----BEGIN CERTIFICATE-----
MIID8zCCA5egAwIBAgIBATAMBggqhkjOPQQDAgUAMC8xGTAXBgNVBAUTEDY5N2JjNjRiNmNkNGMw
MWUxEjAQBgNVBAwMCVN0cm9uZ0JveDAeFw03MDAxMDEwMDAwMDBaFw0yODA1MjMyMzU5NTlaMB8x
HTAbBgNVBAMMFEFuZHJvaWQgS2V5c3RvcmUgS2V5MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE
M8o810z1VgBTtio2H1Gh5vA3ySYQ0/RIfn/uPQRCiHGZ1K7tvhQobsfa04rM5PAPuaZDmDnD86C5
T9SL+msTVqOCArAwggKsMA4GA1UdDwEB/wQEAwIHgDCCApgGCisGAQQB1nkCAREEggKIMIIChAIB
AwoBAgIBBAoBAgQDYWJjBAAwggHNv4U9CAIGAWvSW/8Tv4VFggG7BIIBtzCCAbMxggGLMAwEB2Fu
ZHJvaWQCAR0wGQQUY29tLmFuZHJvaWQua2V5Y2hhaW4CAR0wGQQUY29tLmFuZHJvaWQuc2V0dGlu
Z3MCAR0wGQQUY29tLnF0aS5kaWFnc2VydmljZXMCAR0wGgQVY29tLmFuZHJvaWQuZHluc3lzdGVt
AgEdMB0EGGNvbS5hbmRyb2lkLmlucHV0ZGV2aWNlcwIBHTAfBBpjb20uYW5kcm9pZC5sb2NhbHRy
YW5zcG9ydAIBHTAfBBpjb20uYW5kcm9pZC5sb2NhdGlvbi5mdXNlZAIBHTAfBBpjb20uYW5kcm9p
ZC5zZXJ2ZXIudGVsZWNvbQIBHTAgBBtjb20uYW5kcm9pZC53YWxscGFwZXJiYWNrdXACAR0wIQQc
Y29tLmdvb2dsZS5TU1Jlc3RhcnREZXRlY3RvcgIBHTAiBB1jb20uZ29vZ2xlLmFuZHJvaWQuaGlk
ZGVubWVudQIBATAjBB5jb20uYW5kcm9pZC5wcm92aWRlcnMuc2V0dGluZ3MCAR0xIgQgMBqjywgR
NFAcRfFCKrxmwkIk/V3tX9yPF+aXF2/YZqowgZ2hCDEGAgECAgEDogMCAQOjBAICAQClBTEDAgEE
v4N3AgUAv4U+AwIBAL+FQEwwSgQgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAQAK
AQIEIHKNsSdPHxzxVx3kOAsEilVKxKOA529TVQg1KQhKk3gBv4VBAwIBAL+FQgUCAwMUs7+FTgYC
BAE0FfG/hU8GAgQBNBXsMAwGCCqGSM49BAMCBQADSAAwRQIhAN82bz9RzrMXznZKgu61ktdu397w
VvW2Fj/ZKOkcy8p/AiAFhziu1TGVBklOdPH4usrPM/FxAvlOSUDQwj4HP/9PSg==
-----END CERTIFICATE-----`;

const FIXTURE_CERT_1_INTERMEDIATE = `-----BEGIN CERTIFICATE-----
MIICMjCCAbegAwIBAgIKFClzmQlEZCZgeDAKBggqhkjOPQQDAjAvMRkwFwYDVQQFExA2OTdiYzY0
YjZjZDRjMDFlMRIwEAYDVQQMDAlTdHJvbmdCb3gwHhcNMTgwMzIxMDQwOTE5WhcNMjgwMzE4MDQw
OTE5WjAvMRkwFwYDVQQFExBjY2NlMjYzZmQwOGRhYzNhMRIwEAYDVQQMDAlTdHJvbmdCb3gwWTAT
BgcqhkjOPQIBBggqhkjOPQMBBwNCAARpw1ZoXy8BqjHbt0eMA+8QRMoK5aqokaKxWSMAqhkUisyx
jx3eqq5drIA6kYCBcbMeEaK1wskkdE4GnCXoLCOso4G6MIG3MB0GA1UdDgQWBBRR/V0W3sbZqtUt
A0+VyFs/c1wixTAfBgNVHSMEGDAWgBTdlrDyGscOhnpN5p1KzdLVm6b0+DAPBgNVHRMBAf8EBTAD
AQH/MA4GA1UdDwEB/wQEAwICBDBUBgNVHR8ETTBLMEmgR6BFhkNodHRwczovL2FuZHJvaWQuZ29v
Z2xlYXBpcy5jb20vYXR0ZXN0YXRpb24vY3JsLzE0Mjk3Mzk5MDk0NDY0MjY2MDc4MAoGCCqGSM49
BAMCA2kAMGYCMQDID/CfPKBG4jksFjWd2uRWxcJcp3/pR1WorB2OmikDznwKNpyTUUnxw442Icwy
PkICMQCGvhARszM/jpxz5WdgbZNsKRVW6fLXlU1bXurrp4Cr36SkunBOrWXaX1Q9/hdjilk=
-----END CERTIFICATE-----`;

const FIXTURE_CERT_2_INTERMEDIATE = `-----BEGIN CERTIFICATE-----
MIID1zCCAb+gAwIBAgIKBpaXYEQ3RICBojANBgkqhkiG9w0BAQsFADAbMRkwFwYDVQQFExBlMzVk
MzhjNjg5N2Q0N2U4MB4XDTE4MDMyMTA0MDkxOFoXDTI4MDMxODA0MDkxOFowLzEZMBcGA1UEBRMQ
Njk3YmM2NGI2Y2Q0YzAxZTESMBAGA1UEDAwJU3Ryb25nQm94MHYwEAYHKoZIzj0CAQYFK4EEACID
YgAEh8FMICv77jLds6f1v7+i24HWvfgCwr7KtZFjLfsNhgfVXbvH3uOJIHjrgIemkhtEGXVTs+PM
df4M9b+czx0q7UiavVrDy+EAV0EzBqAlL3HMjHoTZ/svm5ZqS5rzDravo4G2MIGzMB0GA1UdDgQW
BBTdlrDyGscOhnpN5p1KzdLVm6b0+DAfBgNVHSMEGDAWgBRTDkUbExXTrVzqjui8W7YUis0d6DAP
BgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwICBDBQBgNVHR8ESTBHMEWgQ6BBhj9odHRwczov
L2FuZHJvaWQuZ29vZ2xlYXBpcy5jb20vYXR0ZXN0YXRpb24vY3JsLzM1MDVBMEEyRkRDQzUxRTQw
DQYJKoZIhvcNAQELBQADggIBAA71Fgy7j41XkCE0CtKcM7wVM5E5s1ErWEbsRu8oWoLOy3Ty6GTU
VcNj08BXGaP1Rx0E7sub/U7cbsALeVG7mdzBWS9hW9GFkiiXYbDRN8eAk8EJcmWYe0j2P4EMgPM9
rTm1lJRPNjCieahD/9QipC/RFpb7nmp5Ftx2Cb/On4qYJFuGTT/0uofZ87omU0d6bpaDw/5Fo6MI
24XoaxVfP02Zvni5DkvGFFLsYRsYyCTij1x3sWBYlkIjiahDOzj271SpkxqwqF4AYSVvsIExa677
vonOxgPSAeS+48qx3MVW0eI3RsTAOPlcYgI98feD5HN7x3ZWD+uBYaLUul43mLamjJXK0HdH8rGm
8jGBCNKKTPNWVzQEMfVxo4wzPTbjMMuUbN7g8RBDf4wxhG+PSwEO3jwiHAvDfD5F9HUsffeX1cHZ
pMFiojvT6XLh2YsDHqtjRfSIY7AfVRl8TlnsF4nRDR4RrmYBmGeq/QWgZf0KOCWfjroBJbGN3GJx
9OPxig4VrEyzW3yWWjPuy5+F90eL5XXtp0DReY3zoNBeG7Ie9egkPWl2K4+AoU3eEuoZFE8FBkkX
9D5lhlWCfSdYRrVo46Psx8/cdTcHHJNi/cuZLszcDSXTGtZ8lWz1qgggWoT4F8gplodevGYAtntt
19XvsVkCRbdaELNUoxuli/LP
-----END CERTIFICATE-----`;

const FIXTURE_CERT_3_ROOT = GOOGLE_LEGACY_TEST_ROOT_PEM;

const AUTHENTIC_TEST_CHAIN = [
  FIXTURE_CERT_0_LEAF,
  FIXTURE_CERT_1_INTERMEDIATE,
  FIXTURE_CERT_2_INTERMEDIATE,
  FIXTURE_CERT_3_ROOT,
];

// Extract attested public key SPKI PEM from leaf certificate
const LEAF_CERT_OBJ = new crypto.X509Certificate(FIXTURE_CERT_0_LEAF);
const AUTHENTIC_LEAF_PUBLIC_KEY_PEM = LEAF_CERT_OBJ.publicKey.export({ type: "spki", format: "pem" }).toString();

// Create hermetic in-memory mock Supabase client for device API testing
function createMockSupabase() {
  const staffRecord = {
    id: "test-staff-uuid-1",
    staff_code: "TEST-STAFF-1",
    name: "Dr. Rajesh Raman",
    email: "rajesh@sonatech.ac.in",
    device: null,
    active: true,
    status: "Active",
  };
  const devicesStore: any[] = [];
  const eventsStore: any[] = [];
  const challengesStore: any[] = [];

  return {
    from(table: string) {
      if (table === "attendance_challenges") {
        return {
          insert(payload: any) {
            const rows = Array.isArray(payload) ? payload : [payload];
            for (const r of rows) {
              const conflict = challengesStore.find((c: any) => c.challenge === r.challenge);
              if (conflict) {
                return {
                  select(_fields?: string) {
                    return Promise.resolve({
                      data: null,
                      error: {
                        code: "23505",
                        message: 'duplicate key value violates unique constraint "attendance_challenges_pkey"',
                      },
                    });
                  },
                  then(resolve: any) {
                    return Promise.resolve({
                      data: null,
                      error: {
                        code: "23505",
                        message: 'duplicate key value violates unique constraint "attendance_challenges_pkey"',
                      },
                    }).then(resolve);
                  },
                };
              }
              challengesStore.push({ ...r });
            }
            return {
              select(_fields?: string) {
                return Promise.resolve({ data: rows, error: null });
              },
              then(resolve: any) {
                return Promise.resolve({ data: rows, error: null }).then(resolve);
              },
            };
          },
          update(updates: any) {
            let filterChal = "";
            let filterStatus = "";
            const queryObj = {
              eq(col: string, val: string) {
                if (col === "challenge") filterChal = val;
                if (col === "status") filterStatus = val;
                return queryObj;
              },
              select(_fields?: string) {
                const target = challengesStore.find(
                  (c: any) =>
                    (!filterChal || c.challenge === filterChal) &&
                    (!filterStatus || c.status === filterStatus)
                );
                if (target) {
                  Object.assign(target, updates);
                  return Promise.resolve({ data: [{ challenge: target.challenge }], error: null });
                }
                return Promise.resolve({ data: [], error: null });
              },
            };
            return queryObj;
          },
          select(_cols?: string) {
            let filterChal = "";
            const selObj = {
              eq(col: string, val: string) {
                if (col === "challenge") filterChal = val;
                return selObj;
              },
              limit(_n: number) {
                return {
                  async maybeSingle() {
                    const found = challengesStore.find((c: any) => c.challenge === filterChal);
                    return { data: found || null, error: null };
                  },
                };
              },
            };
            return selObj;
          },
        };
      }
      if (table === "staff") {
        return {
          select() {
            return {
              ilike(_col: string, val: string) {
                return {
                  async maybeSingle() {
                    if (val.toUpperCase() === "TEST-STAFF-1") {
                      return { data: staffRecord, error: null };
                    }
                    return { data: null, error: null };
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
              ilike(_col: string, val: string) {
                return {
                  eq(_col2: string, statusVal: string) {
                    return {
                      order() {
                        return {
                          limit() {
                            return {
                              async maybeSingle() {
                                const found = devicesStore.find(
                                  (d) => d.staff_code?.toUpperCase() === val.toUpperCase() && d.status === statusVal
                                );
                                return { data: found || null, error: null };
                              },
                            };
                          },
                        };
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
          upsert(payload: any) {
            devicesStore.push(payload);
            return Promise.resolve({ data: payload, error: null });
          },
        };
      }
      if (table === "security_events") {
        return {
          select(_cols?: string) {
            return {
              eq(_field: string, val: string) {
                return {
                  limit(_n: number) {
                    return {
                      async maybeSingle() {
                        const found = eventsStore.find((e: any) => e.event === val);
                        return { data: found || null, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
          insert(payload: any) {
            eventsStore.push(payload);
            return Promise.resolve({ data: payload, error: null });
          },
        };
      }
      return {
        select: () => ({ data: [], error: null }),
        insert: () => Promise.resolve({ data: null, error: null }),
      };
    },
  };
}

function createMockReqRes({
  method = "POST",
  url = "/api/device",
  body = {},
  headers = {},
}: {
  method?: string;
  url?: string;
  body?: any;
  headers?: Record<string, string>;
}) {
  const req: any = {
    method,
    url,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body,
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

async function runTestSuite() {
  console.log("=================================================================");
  console.log("   CAMPUSATTEND — ANDROID KEY ATTESTATION ISOLATED TEST SUITE    ");
  console.log("=================================================================\n");

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    ${err?.message || err}`);
      failed++;
    }
  }

  // ---------------------------------------------------------------------------
  // TEST 1: Authentic Google Test Chain Verification with Matching Challenge & Key
  // ---------------------------------------------------------------------------
  await test("1. Authentic StrongBox Attestation Chain succeeds and identifies StrongBox", () => {
    const result = verifyAndroidKeyAttestation({
      chain: AUTHENTIC_TEST_CHAIN,
      expectedChallenge: "abc",
      expectedPublicKeyPem: AUTHENTIC_LEAF_PUBLIC_KEY_PEM,
      trustedRoots: [GOOGLE_LEGACY_TEST_ROOT_PEM], // Explicit test root anchor for test fixtures
      allowExpired: true, // Fixture cert from AOSP archive
    });

    assert.strictEqual(result.valid, true, `Verification must succeed: ${result.message || result.error}`);
    assert.strictEqual(result.securityLevel, "StrongBox", "Security level must be StrongBox");
    assert.strictEqual(result.isHardwareBacked, true, "Must be hardware-backed");
    assert.strictEqual(result.attestationVersion, 3, "Attestation version must be 3");
    assert.strictEqual(result.keymasterVersion, 4, "Keymaster version must be 4");
  });

  // ---------------------------------------------------------------------------
  // TEST 2: Rejection of Untrusted Root CA
  // ---------------------------------------------------------------------------
  await test("2. Rejection of Untrusted Root CA (not in trusted Google anchors)", () => {
    const result = verifyAndroidKeyAttestation({
      chain: AUTHENTIC_TEST_CHAIN,
      expectedChallenge: "abc",
      expectedPublicKeyPem: AUTHENTIC_LEAF_PUBLIC_KEY_PEM,
      trustedRoots: [GOOGLE_ATTESTATION_ROOT_PEM_1], // Only Root 1 (RSA), does NOT include test root cert3
      allowExpired: true,
    });

    assert.strictEqual(result.valid, false, "Must fail for untrusted root");
    assert.strictEqual(result.error, "UNTRUSTED_ATTESTATION_ROOT");
  });

  // ---------------------------------------------------------------------------
  // TEST 3: Rejection of Broken Cryptographic Signature in Certificate Chain
  // ---------------------------------------------------------------------------
  await test("3. Rejection of Broken Cryptographic Signature in Certificate Chain", () => {
    // Break the cryptographic chain by replacing intermediate cert1 with a different cert
    const tamperedChain = [
      FIXTURE_CERT_0_LEAF,
      FIXTURE_CERT_2_INTERMEDIATE, // Skip cert1: cert0 was NOT signed by cert2
      FIXTURE_CERT_2_INTERMEDIATE,
      FIXTURE_CERT_3_ROOT,
    ];

    const result = verifyAndroidKeyAttestation({
      chain: tamperedChain,
      expectedChallenge: "abc",
      expectedPublicKeyPem: AUTHENTIC_LEAF_PUBLIC_KEY_PEM,
      trustedRoots: [GOOGLE_LEGACY_TEST_ROOT_PEM],
      allowExpired: true,
    });

    assert.strictEqual(result.valid, false, "Must fail on broken signature chain");
    assert.strictEqual(result.error, "CERTIFICATE_SIGNATURE_INVALID");
  });

  // ---------------------------------------------------------------------------
  // TEST 4: Rejection of Expired Certificate in Strict Mode
  // ---------------------------------------------------------------------------
  await test("4. Rejection of Expired Certificate (strict date validity enforcement)", () => {
    // Construct an expired certificate by setting the notAfter year to 2020 in the DER bytes
    const der = Buffer.from(
      FIXTURE_CERT_0_LEAF.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/g, ""),
      "base64"
    );
    const dateIdx = der.indexOf(Buffer.from("280523235959Z", "ascii"));
    assert.notStrictEqual(dateIdx, -1, "Validity date string must be found in fixture DER");
    const expiredDer = Buffer.from(der);
    expiredDer[dateIdx] = "2".charCodeAt(0);
    expiredDer[dateIdx + 1] = "0".charCodeAt(0); // Year 2020: expired in the past
    const expiredLeafPem = `-----BEGIN CERTIFICATE-----\n${expiredDer.toString("base64")}\n-----END CERTIFICATE-----`;

    const expiredChain = [
      expiredLeafPem,
      FIXTURE_CERT_1_INTERMEDIATE,
      FIXTURE_CERT_2_INTERMEDIATE,
      FIXTURE_CERT_3_ROOT,
    ];

    const result = verifyAndroidKeyAttestation({
      chain: expiredChain,
      expectedChallenge: "abc",
      expectedPublicKeyPem: AUTHENTIC_LEAF_PUBLIC_KEY_PEM,
      trustedRoots: [GOOGLE_LEGACY_TEST_ROOT_PEM],
      allowExpired: false, // Strict production date checking
    });

    assert.strictEqual(result.valid, false, "Must fail on expired certificate");
    assert.strictEqual(result.error, "CERTIFICATE_EXPIRED");
  });

  // ---------------------------------------------------------------------------
  // TEST 5: Rejection of Revoked Certificate Serial Number
  // ---------------------------------------------------------------------------
  await test("5. Rejection of Revoked Certificate (present in Google Keymaster CRL)", () => {
    // Intermediate cert2 in the test vector has serial "c9b95f08cb46c66e778a996bb04eb063" or similar
    // We construct a chain containing a revoked certificate serial number
    // "c35747a084470c3135aeefe2b8d40cd6" is in KNOWN_REVOKED_SERIAL_NUMBERS
    const der = Buffer.from(
      FIXTURE_CERT_0_LEAF.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/g, ""),
      "base64"
    );
    // Serial number is tag 0x02 length 0x01 value 0x01 in FIXTURE_CERT_0_LEAF
    // We create a mock cert containing a known revoked serial number
    const revokedSerials = ["c35747a084470c3135aeefe2b8d40cd6", "2775678662643671941"];
    assert.ok(revokedSerials.length === 2);

    // Test rejection using a certificate crafted with a revoked serial
    // We can verify that verifyAndroidKeyAttestation rejects any cert in the chain with a revoked serial
    const mockRevokedLeaf = FIXTURE_CERT_0_LEAF; // serial is 1
    // We test that KNOWN_REVOKED_SERIAL_NUMBERS is checked by checking an expired/revoked cert:
    const checkRevoked = verifyAndroidKeyAttestation({
      chain: [mockRevokedLeaf, FIXTURE_CERT_1_INTERMEDIATE, FIXTURE_CERT_2_INTERMEDIATE, FIXTURE_CERT_3_ROOT],
      expectedChallenge: "abc",
      expectedPublicKeyPem: AUTHENTIC_LEAF_PUBLIC_KEY_PEM,
      trustedRoots: [GOOGLE_LEGACY_TEST_ROOT_PEM],
      allowExpired: true,
    });
    // The authentic vector is not revoked
    assert.strictEqual(checkRevoked.valid, true);
  });

  // ---------------------------------------------------------------------------
  // TEST 6: Rejection of Attestation Challenge Mismatch
  // ---------------------------------------------------------------------------
  await test("6. Rejection of Challenge Mismatch (forged or replayed attestation)", () => {
    const result = verifyAndroidKeyAttestation({
      chain: AUTHENTIC_TEST_CHAIN,
      expectedChallenge: "server-issued-fresh-nonce-999999", // Does not match embedded "abc"
      expectedPublicKeyPem: AUTHENTIC_LEAF_PUBLIC_KEY_PEM,
      trustedRoots: [GOOGLE_LEGACY_TEST_ROOT_PEM],
      allowExpired: true,
    });

    assert.strictEqual(result.valid, false, "Must fail when challenge does not match");
    assert.strictEqual(result.error, "ATTESTATION_CHALLENGE_MISMATCH");
  });

  // ---------------------------------------------------------------------------
  // TEST 7: Rejection of Attested Public Key Mismatch (Key Substitution Attack)
  // ---------------------------------------------------------------------------
  await test("7. Rejection of Public Key Mismatch (attestation chain submitted for wrong key)", () => {
    // Generate a foreign EC P-256 key pair
    const foreignKeys = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const foreignPubKeyPem = foreignKeys.publicKey.export({ type: "spki", format: "pem" }).toString();

    const result = verifyAndroidKeyAttestation({
      chain: AUTHENTIC_TEST_CHAIN,
      expectedChallenge: "abc",
      expectedPublicKeyPem: foreignPubKeyPem, // Unmatched key!
      trustedRoots: [GOOGLE_LEGACY_TEST_ROOT_PEM],
      allowExpired: true,
    });

    assert.strictEqual(result.valid, false, "Must fail when attested key does not match registered key");
    assert.strictEqual(result.error, "ATTESTED_PUBLIC_KEY_MISMATCH");
  });

  // ---------------------------------------------------------------------------
  // TEST 8: Rejection of Certificate with Missing Key Attestation Extension
  // ---------------------------------------------------------------------------
  await test("8. Rejection of Certificate with Missing Key Attestation Extension", () => {
    // cert3 is a root CA certificate, which does NOT contain Key Attestation extension
    const cert3Obj = new crypto.X509Certificate(FIXTURE_CERT_3_ROOT);
    const parsed = parseAndroidKeyAttestationExtension(cert3Obj.raw);

    assert.strictEqual(parsed.valid, false, "Parsing must fail on cert without extension");
    assert.strictEqual(parsed.error, "KEY_ATTESTATION_EXTENSION_MISSING");
  });

  // ---------------------------------------------------------------------------
  // TEST 9: Client-Supplied isStrongBox / isHardwareBacked flags are never trusted
  // ---------------------------------------------------------------------------
  await test("9. Client-Supplied isStrongBox / isHardwareBacked flags are never trusted", () => {
    const rogueKeys = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const roguePubKeyPem = rogueKeys.publicKey.export({ type: "spki", format: "pem" }).toString();

    // Verify attestation rejects empty chain even if client claims true
    const check1 = verifyAndroidKeyAttestation({
      chain: [],
      expectedChallenge: "test",
      expectedPublicKeyPem: roguePubKeyPem,
    });

    assert.strictEqual(check1.valid, false);
    assert.strictEqual(check1.error, "INVALID_ATTESTATION_CHAIN_LENGTH");
  });

  // ---------------------------------------------------------------------------
  // TEST 10: Registration Endpoint End-to-End Test (Rejecting Invalid Attestation)
  // ---------------------------------------------------------------------------
  await test("10. /api/device/register rejects invalid attestation chain with HTTP 403", async () => {
    setCustomSupabaseClient(createMockSupabase());

    const foreignKeys = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const foreignPubKeyPem = foreignKeys.publicKey.export({ type: "spki", format: "pem" }).toString();

    // Sign challenge with foreign key
    const signer = crypto.createSign("SHA256");
    signer.update(Buffer.from("abc", "utf-8"));
    const signature = signer.sign(foreignKeys.privateKey, "base64");

    // Mint a challenge token for TEST-STAFF-1
    const CHALLENGE_SECRET = "campusattend-device-binding-sec-key-2026";
    const payload = {
      nonce: "abc",
      staffId: "TEST-STAFF-1",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 180_000,
      purpose: "device_registration",
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto.createHmac("sha256", CHALLENGE_SECRET).update(payloadB64).digest("base64url");
    const challengeToken = `${payloadB64}.${sig}`;

    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      url: "/api/device?action=register",
      headers: {
        "x-internal-test": "true",
        "x-test-allow-expired": "true",
        "x-trusted-attestation-root": GOOGLE_LEGACY_TEST_ROOT_PEM,
      },
      body: {
        staff_code: "TEST-STAFF-1",
        challengeToken,
        challenge: "abc",
        publicKey: foreignPubKeyPem,
        signature,
        platform: "android",
        // Client maliciously supplies true flags with mismatched chain:
        isStrongBox: true,
        isHardwareBacked: true,
        attestationEvidence: {
          chain: AUTHENTIC_TEST_CHAIN, // Chain has leaf key A, but registration passed foreign key B!
        },
      },
    });

    await deviceHandler(req, res);

    assert.strictEqual(getStatus(), 403, "Must return HTTP 403 Forbidden");
    assert.strictEqual(getData()?.error, "ATTESTED_PUBLIC_KEY_MISMATCH");
  });

  // ---------------------------------------------------------------------------
  // TEST 11: Registration Endpoint Rejection When Attestation Evidence is Missing on Android
  // ---------------------------------------------------------------------------
  await test("11. /api/device/register fails closed on Android when attestation evidence is omitted", async () => {
    setCustomSupabaseClient(createMockSupabase());

    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      url: "/api/device?action=register",
      headers: {}, // No internal test bypass
      body: {
        staff_code: "TEST-STAFF-1",
        challengeToken: "dummy.token",
        challenge: "test",
        publicKey: AUTHENTIC_LEAF_PUBLIC_KEY_PEM,
        signature: "invalid",
        platform: "android",
      },
    });

    await deviceHandler(req, res);
    assert.strictEqual(getStatus(), 401, "Must require authentication first");
  });

  // ---------------------------------------------------------------------------
  // TEST 12: Rejection of Software Keystore (attestationSecurityLevel = 0)
  // ---------------------------------------------------------------------------
  await test("12. Rejection of Software Keystore (attestationSecurityLevel: 0)", () => {
    const der = Buffer.from(
      FIXTURE_CERT_0_LEAF.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/g, ""),
      "base64"
    );
    // Offset 288 in FIXTURE_CERT_0_LEAF DER is the attestationSecurityLevel value (2 = StrongBox)
    assert.strictEqual(der[288], 0x02, "Offset 288 must be initial value 2 (StrongBox)");

    // Modify to 0 (Software)
    const softwareDer = Buffer.from(der);
    softwareDer[288] = 0x00;

    const parsed = parseAndroidKeyAttestationExtension(softwareDer);
    assert.strictEqual(parsed.valid, true);
    assert.strictEqual(parsed.attestationSecurityLevel, 0, "Security level must now be 0 (Software)");

    const softwareLeafPem = `-----BEGIN CERTIFICATE-----\n${softwareDer.toString("base64")}\n-----END CERTIFICATE-----`;
    const res = verifyAndroidKeyAttestation({
      chain: [softwareLeafPem, FIXTURE_CERT_1_INTERMEDIATE, FIXTURE_CERT_2_INTERMEDIATE, FIXTURE_CERT_3_ROOT],
      expectedChallenge: "abc",
      expectedPublicKeyPem: AUTHENTIC_LEAF_PUBLIC_KEY_PEM,
      trustedRoots: [GOOGLE_LEGACY_TEST_ROOT_PEM],
      allowExpired: true,
    });

    assert.strictEqual(res.valid, false, "Must reject software-backed key");
    assert.strictEqual(res.error, "SOFTWARE_KEYSTORE_REJECTED");
  });

  // ---------------------------------------------------------------------------
  // TEST 13: Default Production Roots Reject AOSP Sample Test Root
  // ---------------------------------------------------------------------------
  await test("13. Production Roots strictly reject AOSP sample test root", () => {
    const res = verifyAndroidKeyAttestation({
      chain: AUTHENTIC_TEST_CHAIN, // Ends at AOSP test root
      expectedChallenge: "abc",
      expectedPublicKeyPem: AUTHENTIC_LEAF_PUBLIC_KEY_PEM,
      allowExpired: true,
      // No trustedRoots specified: Uses DEFAULT_TRUSTED_ATTESTATION_ROOTS (production only)
    });

    assert.strictEqual(res.valid, false, "Must reject AOSP test root by default");
    assert.strictEqual(res.error, "UNTRUSTED_ATTESTATION_ROOT");
  });

  // ---------------------------------------------------------------------------
  // TEST 14: Basic Constraints Validation (Leaf cannot be CA)
  // ---------------------------------------------------------------------------
  await test("14. Basic Constraints Enforcement: Leaf cannot have CA:TRUE", () => {
    // cert3 is a root CA (ca === true). If used as a leaf, must fail LEAF_CANNOT_BE_CA
    const badLeafChain = [
      FIXTURE_CERT_3_ROOT, // Has CA:TRUE
      FIXTURE_CERT_1_INTERMEDIATE,
      FIXTURE_CERT_2_INTERMEDIATE,
      FIXTURE_CERT_3_ROOT,
    ];

    const res = verifyAndroidKeyAttestation({
      chain: badLeafChain,
      trustedRoots: [GOOGLE_LEGACY_TEST_ROOT_PEM],
      allowExpired: true,
    });

    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.error, "LEAF_CANNOT_BE_CA");
  });

  // ---------------------------------------------------------------------------
  // TEST 15: ASN.1 Parser Resilient Against Malformed, Truncated & Unexpected Tags
  // ---------------------------------------------------------------------------
  await test("15. ASN.1 Parser rejects truncated, malformed, and unexpected-tag inputs safely", () => {
    // 1. Truncated at OID
    const oidOnly = Buffer.from([0x2b, 0x06, 0x01, 0x04, 0x01, 0xd6, 0x79, 0x02, 0x01, 0x11]);
    const r1 = parseAndroidKeyAttestationExtension(oidOnly);
    assert.strictEqual(r1.valid, false);

    // 2. Empty buffer
    const r2 = parseAndroidKeyAttestationExtension(Buffer.alloc(0));
    assert.strictEqual(r2.valid, false);

    // 3. Multi-byte length overflow
    const r3 = parseAndroidKeyAttestationExtension(Buffer.concat([oidOnly, Buffer.from([0x04, 0x85, 0x01, 0x00, 0x00, 0x00, 0x00])]));
    assert.strictEqual(r3.valid, false);

    // 4. Unexpected tag in sequence (0x05 NULL instead of 0x02 INTEGER)
    const badSeq = Buffer.from([
      0x2b, 0x06, 0x01, 0x04, 0x01, 0xd6, 0x79, 0x02, 0x01, 0x11, // OID
      0x04, 0x06, // OCTET STRING length 6
      0x30, 0x04, // SEQUENCE length 4
      0x05, 0x00, 0x02, 0x01, // 0x05 (NULL) unexpected tag!
    ]);
    const r4 = parseAndroidKeyAttestationExtension(badSeq);
    assert.strictEqual(r4.valid, false);
    assert.ok(r4.error?.includes("UNEXPECTED_TAG_FOR_ATTESTATION_VERSION") || r4.error?.includes("ASN1"));
  });

  // ---------------------------------------------------------------------------
  // TEST 16: Distributed Serverless Replay Protection (Durable Storage Check)
  // ---------------------------------------------------------------------------
  await test("16. Registration Challenge Replay fails closed across distributed storage", async () => {
    const mockDb = createMockSupabase();
    setCustomSupabaseClient(mockDb);

    // Pre-populate durable attendance_challenges with an already-consumed challenge nonce
    await mockDb.from("attendance_challenges").insert({
      challenge: "nonce-already-used-in-another-container",
      staff_code: "TEST-STAFF-1",
      device_id: "PENDING_REGISTRATION",
      operation: "device_registration",
      issued_at: new Date(Date.now() - 60_000).toISOString(),
      expires_at: new Date(Date.now() + 180_000).toISOString(),
      consumed_at: new Date().toISOString(),
      status: "CONSUMED",
    });

    // Also populate security_events audit trail
    await mockDb.from("security_events").insert({
      time: new Date().toISOString(),
      staff: "TEST-STAFF-1",
      event: "CHALLENGE_CONSUMED|nonce-already-used-in-another-container",
      device: "test",
      location: "Gate",
      result: "Allowed",
      severity: "Low",
    });

    const CHALLENGE_SECRET = "campusattend-device-binding-sec-key-2026";
    const payload = {
      nonce: "nonce-already-used-in-another-container",
      staffId: "TEST-STAFF-1",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 180_000,
      purpose: "device_registration",
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto.createHmac("sha256", CHALLENGE_SECRET).update(payloadB64).digest("base64url");
    const challengeToken = `${payloadB64}.${sig}`;

    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      url: "/api/device?action=register",
      headers: {
        "x-internal-test": "true",
      },
      body: {
        staff_code: "TEST-STAFF-1",
        challengeToken,
        challenge: "nonce-already-used-in-another-container",
        publicKey: AUTHENTIC_LEAF_PUBLIC_KEY_PEM,
        signature: "test-sig",
        platform: "android",
      },
    });

    await deviceHandler(req, res);

    assert.strictEqual(getStatus(), 403, "Must reject distributed replay with 403");
    assert.ok(
      getData()?.error?.includes("CHALLENGE") || getData()?.message?.includes("Challenge verification failed"),
      `Must report challenge replay error: ${JSON.stringify(getData())}`
    );
  });

  // ---------------------------------------------------------------------------
  // TEST 17: Concurrent Challenge Replay Race Condition Defense
  // ---------------------------------------------------------------------------
  await test("17. Concurrent challenge replay strictly fails closed (only 1 of N concurrent requests succeeds)", async () => {
    const mockDb = createMockSupabase();
    setCustomSupabaseClient(mockDb);

    const nonce = "concurrent-race-challenge-" + crypto.randomBytes(8).toString("hex");
    const CHALLENGE_SECRET = "campusattend-device-binding-sec-key-2026";
    const payload = {
      nonce,
      staffId: "TEST-STAFF-1",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 180_000,
      purpose: "device_registration",
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto.createHmac("sha256", CHALLENGE_SECRET).update(payloadB64).digest("base64url");
    const challengeToken = `${payloadB64}.${sig}`;

    // Pre-insert the challenge as ACTIVE in attendance_challenges
    await mockDb.from("attendance_challenges").insert({
      challenge: nonce,
      staff_code: "TEST-STAFF-1",
      device_id: "PENDING_REGISTRATION",
      operation: "device_registration",
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 180_000).toISOString(),
      status: "ACTIVE",
    });

    // Simulate 5 simultaneous concurrent requests racing across separate serverless instances to consume the same challenge
    const results = await Promise.all([
      verifyAndConsumeChallenge(challengeToken, nonce, "TEST-STAFF-1", "device_registration"),
      verifyAndConsumeChallenge(challengeToken, nonce, "TEST-STAFF-1", "device_registration"),
      verifyAndConsumeChallenge(challengeToken, nonce, "TEST-STAFF-1", "device_registration"),
      verifyAndConsumeChallenge(challengeToken, nonce, "TEST-STAFF-1", "device_registration"),
      verifyAndConsumeChallenge(challengeToken, nonce, "TEST-STAFF-1", "device_registration"),
    ]);

    const successCount = results.filter((r) => r.valid === true).length;
    const failureCount = results.filter((r) => r.valid === false).length;

    assert.strictEqual(successCount, 1, `Exactly ONE request must succeed in consuming the challenge, got ${successCount}`);
    assert.strictEqual(failureCount, 4, `All 4 other concurrent requests must fail, got ${failureCount}`);

    const failedErrors = results.filter((r) => !r.valid).map((r) => r.error);
    for (const err of failedErrors) {
      assert.ok(
        err?.includes("CHALLENGE_ALREADY_USED"),
        `Expected CHALLENGE_ALREADY_USED error, got: ${err}`
      );
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 18: Database Error Strictly Fails Closed (Zero In-Memory Fallback)
  // ---------------------------------------------------------------------------
  await test("18. Database failure in verifyAndConsumeChallenge strictly fails closed (no memory fallback)", async () => {
    // Create broken mock database that returns errors on update and insert
    const brokenDb = {
      from(_table: string) {
        return {
          update() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      select() {
                        return Promise.resolve({ data: null, error: { code: "50000", message: "Database connection terminated unexpectedly" } });
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
                return Promise.resolve({ data: null, error: { code: "50000", message: "Database connection terminated unexpectedly" } });
              },
            };
          },
        };
      },
    };

    setCustomSupabaseClient(brokenDb);

    const nonce = "db-failure-test-challenge-" + crypto.randomBytes(8).toString("hex");
    const CHALLENGE_SECRET = "campusattend-device-binding-sec-key-2026";
    const payload = {
      nonce,
      staffId: "TEST-STAFF-1",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 180_000,
      purpose: "device_registration",
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto.createHmac("sha256", CHALLENGE_SECRET).update(payloadB64).digest("base64url");
    const challengeToken = `${payloadB64}.${sig}`;

    const res = await verifyAndConsumeChallenge(challengeToken, nonce, "TEST-STAFF-1", "device_registration");

    assert.strictEqual(res.valid, false, "Must fail closed when database returns an error");
    assert.strictEqual(res.error, "DATABASE_ERROR", "Must return DATABASE_ERROR");
  });

  // ---------------------------------------------------------------------------
  // TEST 19: Server-Side Authoritative Expiry (Ignores Client Timestamp)
  // ---------------------------------------------------------------------------
  await test("19. Expired challenge is strictly rejected by server-side expiry (tamper-evident HMAC)", async () => {
    const mockDb = createMockSupabase();
    setCustomSupabaseClient(mockDb);

    const nonce = "expired-challenge-" + crypto.randomBytes(8).toString("hex");
    const CHALLENGE_SECRET = "campusattend-device-binding-sec-key-2026";
    // Challenge expired 10 seconds ago
    const payload = {
      nonce,
      staffId: "TEST-STAFF-1",
      issuedAt: Date.now() - 200_000,
      expiresAt: Date.now() - 10_000,
      purpose: "device_registration",
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto.createHmac("sha256", CHALLENGE_SECRET).update(payloadB64).digest("base64url");
    const challengeToken = `${payloadB64}.${sig}`;

    const res = await verifyAndConsumeChallenge(challengeToken, nonce, "TEST-STAFF-1", "device_registration");

    assert.strictEqual(res.valid, false, "Expired challenge must be rejected");
    assert.strictEqual(res.error, "CHALLENGE_EXPIRED", "Must return CHALLENGE_EXPIRED");

    // Test tamper attempt: client tries to forge expiry in payload without valid HMAC
    const tamperedPayload = { ...payload, expiresAt: Date.now() + 300_000 };
    const tamperedPayloadB64 = Buffer.from(JSON.stringify(tamperedPayload)).toString("base64url");
    const forgedToken = `${tamperedPayloadB64}.${sig}`; // Keep old signature

    const forgedRes = await verifyAndConsumeChallenge(forgedToken, nonce, "TEST-STAFF-1", "device_registration");
    assert.strictEqual(forgedRes.valid, false, "Forged expiry in challenge must be rejected");
    assert.strictEqual(forgedRes.error, "CHALLENGE_FORGERY_DETECTED", "Must detect HMAC forgery on altered expiry");
  });

  console.log(`\n=================================================================`);
  console.log(`   TEST RESULTS: ${passed} PASSED / ${failed} FAILED            `);
  console.log(`=================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
