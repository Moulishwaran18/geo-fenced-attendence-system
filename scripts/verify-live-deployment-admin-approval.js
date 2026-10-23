/**
 * Verifies that the live Vercel production deployment has completed
 * and is serving the updated full-screen responsive overlay bundle for admin face requests approval dialog.
 */

async function verifyLiveDeployment() {
  const targetUrl = "https://geo-fenced-attendence-system.vercel.app/admin/face-requests";
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

  let foundNewOverlay = false;
  let foundSafeAreas = false;
  let foundConfirmBtn = false;
  let foundGrantPermission = false;
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
        if (content.includes("admin-decision-confirm-btn")) {
          foundConfirmBtn = true;
          console.log(`[✓] Found 'admin-decision-confirm-btn' in ${scriptPath}`);
        }
        if (content.includes("safe-area-inset-top")) {
          foundSafeAreas = true;
          console.log(`[✓] Found 'safe-area-inset-top' in ${scriptPath}`);
        }
        if (content.includes("Grant Re-enrollment Permission")) {
          foundGrantPermission = true;
          console.log(`[✓] Found 'Grant Re-enrollment Permission' in ${scriptPath}`);
        }
        if (
          content.includes("h-[100dvh]") &&
          content.includes("[transform:none]")
        ) {
          foundNewOverlay = true;
          console.log(`[✓] Found full-screen overlay markers in ${scriptPath}`);
        }
      }
    } catch (e) {
      console.warn(`Could not check bundle ${scriptPath}: ${e.message}`);
    }
  }

  console.log(`Checked ${checkedBundles} bundles.`);
  console.log(`Markers found:`);
  console.log(`- confirm button id: ${foundConfirmBtn}`);
  console.log(`- safe areas: ${foundSafeAreas}`);
  console.log(`- Grant Re-enrollment Permission: ${foundGrantPermission}`);
  console.log(`- fullScreen overlay & [transform:none]: ${foundNewOverlay}`);

  if (foundConfirmBtn && foundSafeAreas && foundGrantPermission && foundNewOverlay) {
    console.log("SUCCESS: Live deployment contains all verified admin face approval dialog changes!");
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
