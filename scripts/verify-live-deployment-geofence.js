/**
 * Verifies that the live Vercel production deployment has completed
 * and is serving the updated 13-point Campus Geofence polygon.
 */

async function verifyLiveGeofenceDeployment() {
  const baseUrl = "https://geo-fenced-attendence-system.vercel.app";
  console.log(`===============================================================================`);
  console.log(`     VERIFYING LIVE VERCEL GEOFENCE DEPLOYMENT (${baseUrl})     `);
  console.log(`===============================================================================\n`);

  // 1. Check API endpoint responsiveness
  console.log(`1. Testing /api/attendance endpoint health...`);
  try {
    const apiRes = await fetch(`${baseUrl}/api/attendance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    console.log(`   API HTTP Status: ${apiRes.status}`);
    const apiJson = await apiRes.json().catch(() => null);
    if (apiJson && (apiJson.error === "UNAUTHORIZED" || apiJson.error === "MISSING_PAYLOAD")) {
      console.log(`   [✓] Deployed API is active, protected, and responding with: ${apiJson.error}`);
    } else {
      console.log(`   API Response:`, apiJson);
    }
  } catch (err) {
    console.error(`   [!] Could not reach /api/attendance: ${err.message}`);
  }

  // 2. Check web client bundles for new 13-point coordinates
  console.log(`\n2. Inspecting live web client bundles for 13-point geofence coordinates...`);
  const pages = ["/mark-attendance", "/admin/campus-map"];
  const scriptUrls = new Set();

  for (const page of pages) {
    const targetUrl = `${baseUrl}${page}`;
    try {
      const res = await fetch(targetUrl, { headers: { "Cache-Control": "no-cache" } });
      if (res.ok) {
        const html = await res.text();
        const scriptRegex = /(?:src|href)="([^"]+\.js)"/g;
        let match;
        while ((match = scriptRegex.exec(html)) !== null) {
          scriptUrls.add(match[1]);
        }
      }
    } catch (e) {
      console.warn(`   Could not fetch ${targetUrl}: ${e.message}`);
    }
  }

  console.log(`   Discovered ${scriptUrls.size} script bundles.`);

  let foundNewPolygonPoint1 = false; // 11.675651510482604
  let foundNewCentroid = false;      // 11.676556648538646 or 78.122724
  let checkedBundles = 0;

  for (const scriptPath of scriptUrls) {
    const fullUrl = scriptPath.startsWith("http") ? scriptPath : `${baseUrl}${scriptPath}`;
    try {
      const bundleRes = await fetch(fullUrl, { headers: { "Cache-Control": "no-cache" } });
      if (bundleRes.ok) {
        checkedBundles++;
        const content = await bundleRes.text();
        if (content.includes("11.675651") || content.includes("78.124022")) {
          foundNewPolygonPoint1 = true;
          console.log(`   [✓] Found 13-point polygon vertex (C1) in ${scriptPath}`);
        }
        if (content.includes("11.676556") || content.includes("78.122724")) {
          foundNewCentroid = true;
          console.log(`   [✓] Found new centroid in ${scriptPath}`);
        }
      }
    } catch (e) {
      console.warn(`   Could not check bundle ${scriptPath}: ${e.message}`);
    }
  }

  console.log(`\n   Checked ${checkedBundles} live bundles.`);
  console.log(`   Markers found:`);
  console.log(`   - 13-point Polygon Vertex C1 (11.675651...): ${foundNewPolygonPoint1}`);
  console.log(`   - New Campus Centroid (11.676556...):       ${foundNewCentroid}`);

  if (foundNewPolygonPoint1) {
    console.log(`\n===============================================================================`);
    console.log(`SUCCESS: Live Vercel deployment verified with updated 13-point campus geofence!`);
    console.log(`===============================================================================`);
    process.exit(0);
  } else {
    console.log(`\n===============================================================================`);
    console.log(`NOT YET DEPLOYED: Live bundles still reflect previous build or deployment in progress.`);
    console.log(`Please deploy the commit via Vercel Dashboard and re-run this check.`);
    console.log(`===============================================================================`);
    process.exit(2);
  }
}

verifyLiveGeofenceDeployment().catch((err) => {
  console.error(err);
  process.exit(1);
});
