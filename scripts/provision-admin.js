/**
 * CampusAttend — Administrator Account Provisioning Script
 *
 * Idempotently provisions the administrator account:
 * - Administrator ID: moulish
 * - Role: admin
 * - Salted PBKDF2 hash of password (plaintext NEVER stored)
 *
 * Usage:
 *   node --env-file=.env scripts/provision-admin.js
 */

import {
  ensureAdminAccountProvisioned,
  verifyPassword,
} from "../src/server/admin-auth.ts";

async function main() {
  console.log("==================================================");
  console.log("CampusAttend — Administrator Provisioning Engine");
  console.log("==================================================");

  console.log("Provisioning administrator account 'moulish' idempotently...");
  const admin = await ensureAdminAccountProvisioned();

  console.log("✓ Administrator account provisioned successfully!");
  console.log("  - Username / ID  :", admin.username);
  console.log("  - Name           :", admin.name);
  console.log("  - Email          :", admin.email);
  console.log("  - Role           :", admin.role);
  console.log("  - Active Status  :", admin.active);
  console.log("  - Salt (hex)     :", admin.salt.slice(0, 8) + "..." + admin.salt.slice(-8));
  console.log("  - Password Hash  :", admin.password_hash.slice(0, 16) + "... (128-char SHA-512 PBKDF2)");

  // Verification test
  const valid = verifyPassword("moulish@123", admin.password_hash, admin.salt);
  const invalid = verifyPassword("wrong_password", admin.password_hash, admin.salt);

  if (valid && !invalid) {
    console.log("✓ Cryptographic self-test PASSED: Password verification works as expected.");
    console.log("✓ Plaintext password is NEVER stored.");
  } else {
    console.error("✗ Cryptographic self-test FAILED!");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Provisioning fatal error:", err);
  process.exit(1);
});
