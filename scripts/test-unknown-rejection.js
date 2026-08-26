/**
 * Test unknown face rejection
 */
async function testUnknown() {
  // Generate random normalized 512-D vector
  const raw = Array.from({ length: 512 }, () => (Math.random() - 0.5));
  const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0));
  const unknownVector = raw.map(v => v / norm);

  const res = await fetch("http://localhost:8080/api/face/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      descriptor: unknownVector,
      verificationSessionId: "UNKNOWN-TEST-001",
    })
  });

  const json = await res.json();
  console.log("Unknown Face Test:");
  console.log("  HTTP Status:", res.status);
  console.log("  matched:", json.matched);
  console.log("  finalResult:", json.finalResult);
  console.log("  bestCandidate distance:", json.distance);
  console.log("  reason:", json.reason);
  console.log("  telemetry:", json.telemetry);

  if (json.matched === false && json.finalResult === "UNKNOWN" && json.distance > 0.45) {
    console.log("✓ Unknown face correctly REJECTED.");
  } else {
    console.error("✗ Unknown face was NOT rejected properly!");
    process.exit(1);
  }
}

testUnknown().catch(console.error);
