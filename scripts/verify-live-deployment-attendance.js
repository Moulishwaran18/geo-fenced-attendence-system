/**
 * Verifies that the live Vercel production deployment has completed
 * and is serving the updated Attendance Success Screen and Mark Attendance button.
 */

async function verifyLiveDeployment() {
  const targetUrl = "https://geo-fenced-attendence-system.vercel.app/mark-attendance";
  console.log(`Fetching ${targetUrl}...`);

  const res = await fetch(targetUrl, { headers: { "Cache-Control": "no-cache" } });
  console.log(`HTTP Status: ${res.status}`);
  if (!res.ok) {
    console.error(`Failed to fetch ${targetUrl}: HTTP ${res.status}`);
    process.exit(1);
  }

  const html = await res.text();
  const scriptRegex = /(?:src|href)="([^"]+\.js)"/g;
  const scriptUrls = [];
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    scriptUrls.push(match[1]);
  }

  console.log(`Found ${scriptUrls.length} script references in HTML.`);

  let foundSuccessScreen = false;
  let foundMarkAttendanceBtn = false;
  let foundRecordId = false;
  let foundVerificationPanelBtn = false;
  let checkedBundles = 0;

  for (const scriptPath of scriptUrls) {
    const fullUrl = scriptPath.startsWith("http")
      ? scriptPath
      : `https://geo-fenced-attendence-system.vercel.app${scriptPath}`;

    try {
      const bundleRes = await fetch(fullUrl, { headers: { "Cache-Control": "no-cache" } });
      if (bundleRes.ok) {
        checkedBundles++;
        const content = await bundleRes.text();
        if (content.includes("attendance-success-screen")) {
          foundSuccessScreen = true;
          console.log(`[✓] Found 'attendance-success-screen' in ${scriptPath}`);
        }
        if (content.includes("mark-attendance-btn")) {
          foundMarkAttendanceBtn = true;
          console.log(`[✓] Found 'mark-attendance-btn' in ${scriptPath}`);
        }
        if (content.includes("attendance-record-id")) {
          foundRecordId = true;
          console.log(`[✓] Found 'attendance-record-id' in ${scriptPath}`);
        }
        if (content.includes("view-verification-panel-btn")) {
          foundVerificationPanelBtn = true;
          console.log(`[✓] Found 'view-verification-panel-btn' in ${scriptPath}`);
        }
      }
    } catch (e) {
      console.warn(`Could not check bundle ${scriptPath}: ${e.message}`);
    }
  }

  console.log(`Checked ${checkedBundles} bundles.`);
  console.log(`Markers found:`);
  console.log(`- attendance-success-screen: ${foundSuccessScreen}`);
  console.log(`- mark-attendance-btn: ${foundMarkAttendanceBtn}`);
  console.log(`- attendance-record-id: ${foundRecordId}`);
  console.log(`- view-verification-panel-btn: ${foundVerificationPanelBtn}`);

  if (foundSuccessScreen && foundMarkAttendanceBtn && foundRecordId && foundVerificationPanelBtn) {
    console.log("SUCCESS: Live deployment contains all verified attendance success screen changes!");
    process.exit(0);
  } else {
    console.log("NOT READY: Some or all updated markers not yet detected in live bundle. Deployment may still be building or propagating.");
    process.exit(2);
  }
}

verifyLiveDeployment().catch((err) => {
  console.error(err);
  process.exit(1);
});
