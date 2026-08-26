import { getDatabaseDiagnostics, getStaffById } from "../src/server/db/client.ts";

async function run() {
  console.log("==================================================");
  console.log("CAMPUSATTEND LIVE BACKEND DATABASE AUDIT");
  console.log("==================================================");

  const diag = await getDatabaseDiagnostics();

  console.log("\n[DIAGNOSTIC REPORT]");
  console.log(`Database connection: ${diag.status}`);
  console.log(`Database type: ${diag.databaseType}`);
  console.log(`Database host: ${diag.host}`);
  console.log(`Database name: ${diag.databaseName}`);
  console.log(`Staff count: ${diag.staffCount}`);
  console.log(`Active embedding count: ${diag.activeEmbeddingCount}`);
  console.log(`Total embedding count: ${diag.totalEmbeddingCount}`);
  console.log(`pgvector: ${diag.pgvector}`);
  console.log(`Active Source: ${diag.activeSource}`);
  if (diag.details) {
    console.log(`Details: ${diag.details}`);
  }

  console.log("\n[QUERY VERIFICATION]");
  const sampleStaff = await getStaffById("PERSON_001");
  console.log(`Query for 'PERSON_001':`);
  console.log(`- ID: ${sampleStaff?.id}`);
  console.log(`- Code: ${sampleStaff?.staff_code}`);
  console.log(`- Name: ${sampleStaff?.name}`);
  console.log(`- Department: ${sampleStaff?.department}`);
  console.log(`- Active: ${sampleStaff?.active}`);
  console.log(`- Reference Samples Count: ${sampleStaff?.embeddingCount}`);

  console.log("\n==================================================");
  console.log(`RESULT: RUNNING BACKEND IS ${diag.status === "CONNECTED" ? "CONNECTED TO POSTGRESQL" : "NOT CONNECTED TO POSTGRESQL"}`);
  console.log("==================================================");
}

run().catch(console.error);
