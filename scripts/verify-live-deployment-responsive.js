async function check() {
  try {
    const res = await fetch('https://geo-fenced-attendence-system.vercel.app/mark-attendance');
    const html = await res.text();
    console.log('HTTP Status:', res.status);
    
    // Find all asset script tags and modulepreload links
    const scriptMatches = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map(m => m[1]);
    console.log('Discovered script bundles:', scriptMatches);

    let foundHideClose = false;
    let foundNodOnce = false;
    let foundResponsiveCalc = false;
    let foundStep1 = false;
    let foundTiltUp = false;
    let foundCentering = false;
    let checkedCount = 0;

    for (const src of scriptMatches) {
      const url = src.startsWith('http') ? src : 'https://geo-fenced-attendence-system.vercel.app' + src;
      const jsRes = await fetch(url);
      if (jsRes.ok) {
        const text = await jsRes.text();
        checkedCount++;
        if (text.includes('hideCloseButton')) foundHideClose = true;
        if (text.includes('nod once') || text.includes('Please nod once')) foundNodOnce = true;
        if (text.includes('calc(100vw-16px)')) foundResponsiveCalc = true;
        if (text.includes('Step 1 of 2 — Face Match') || text.includes('Step 1 of 2')) foundStep1 = true;
        if (text.includes('Please tilt your head slightly upward')) foundTiltUp = true;
        if (text.includes('transform:translate(-50%,-50%)') || text.includes('transform:translateY(-50%)')) foundCentering = true;
      }
    }

    console.log(`Checked ${checkedCount} scripts:`);
    console.log(`- hideCloseButton present: ${foundHideClose}`);
    console.log(`- 'Please nod once' present: ${foundNodOnce}`);
    console.log(`- 'calc(100vw-16px)' present: ${foundResponsiveCalc}`);
    console.log(`- 'Step 1 of 2 — Face Match' present: ${foundStep1}`);
    console.log(`- 'Please tilt your head slightly upward' present: ${foundTiltUp}`);
    console.log(`- Centering transform fallback present: ${foundCentering}`);

    if (foundResponsiveCalc && foundStep1 && foundTiltUp && foundCentering) {
      console.log('SUCCESS: Production Vercel deployment is serving updated commit 75eefc4 with 1-head movement & centered dialog!');
      process.exit(0);
    } else {
      console.log('PENDING: Vercel deployment is still building or caching previous bundle...');
      process.exit(2);
    }
  } catch (err) {
    console.error('Error verifying Vercel deployment:', err.message);
    process.exit(1);
  }
}

check();
