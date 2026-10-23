/**
 * Verifies that the live Vercel production deployment has completed
 * and is serving the updated full-screen responsive overlay bundle for Re-enroll / Change Face.
 */

async function verifyLiveDeployment() {
  const targetUrl = "https://geo-fenced-attendence-system.vercel.app/face-enrollment";
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
  let foundSubmitBtn = false;
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
        if (content.includes("submit-face-change-request-btn")) {
          foundSubmitBtn = true;
          console.log(`[✓] Found 'submit-face-change-request-btn' in ${scriptPath}`);
        }
        if (content.includes("safe-area-inset-top")) {
          foundSafeAreas = true;
          console.log(`[✓] Found 'safe-area-inset-top' in ${scriptPath}`);
        }
        if (
          content.includes("Request Face Re-enrollment") &&
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

  console.log(`\nChecked ${checkedBundles} script bundles:`);
  console.log(`- submit-face-change-request-btn present: ${foundSubmitBtn}`);
  console.log(`- safe-area-inset-top present: ${foundSafeAreas}`);
  console.log(`- fullScreen 100dvh overlay with [transform:none] present: ${foundNewOverlay}`);

  if (foundSubmitBtn && foundSafeAreas && foundNewOverlay) {
    console.log("\n>>> SUCCESS: Vercel deployment is READY and serving the updated mobile responsive modal overlay!");
    process.exit(0);
  } else {
    console.log("\n>>> PENDING: Vercel build is currently in progress or propagating. Please retry in a few seconds.");
    process.exit(2);
  }
}

verifyLiveDeployment();
