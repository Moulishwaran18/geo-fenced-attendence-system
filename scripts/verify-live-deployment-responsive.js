async function check() {
  try {
    const res = await fetch('https://geo-fenced-attendence-system.vercel.app/mark-attendance');
    const html = await res.text();
    console.log('HTTP Status:', res.status);
    
    // Find all asset script tags and modulepreload links
    const scriptMatches = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map(m => m[1]);
    console.log('Discovered script bundles:', scriptMatches);

    let foundFullScreen = false;
    let foundNodOnce = false;
    let foundBlinkOnce = false;
    let foundStep1 = false;
    let foundStep2 = false;
    let foundTiltUp = false;
    let foundTiltDown = false;
    let foundTurnLeft = false;
    let foundTurnRight = false;
    let checkedCount = 0;

    for (const src of scriptMatches) {
      const url = src.startsWith('http') ? src : 'https://geo-fenced-attendence-system.vercel.app' + src;
      const jsRes = await fetch(url);
      if (jsRes.ok) {
        const text = await jsRes.text();
        checkedCount++;
        if (text.includes('100dvh') || text.includes('fullScreen')) foundFullScreen = true;
        if (text.includes('nod once') || text.includes('Please nod once')) foundNodOnce = true;
        if (text.includes('blink once') || text.includes('BLINK_ONCE')) foundBlinkOnce = true;
        if (text.includes('Step 1 of 2 — Face Match') || text.includes('Step 1 of 2')) foundStep1 = true;
        if (text.includes('Step 2 of 2 — Head Movement') || text.includes('Step 2 of 2')) foundStep2 = true;
        if (text.includes('Please tilt your head slightly upward')) foundTiltUp = true;
        if (text.includes('Please tilt your head slightly downward')) foundTiltDown = true;
        if (text.includes('Please turn your head slightly to the left')) foundTurnLeft = true;
        if (text.includes('Please turn your head slightly to the right')) foundTurnRight = true;
      }
    }

    console.log(`Checked ${checkedCount} scripts:`);
    console.log(`- Fullscreen 100dvh overlay present: ${foundFullScreen}`);
    console.log(`- 'Step 1 of 2 — Face Match' present: ${foundStep1}`);
    console.log(`- 'Step 2 of 2 — Head Movement' present: ${foundStep2}`);
    console.log(`- LOOK_UP ('tilt head slightly upward') present: ${foundTiltUp}`);
    console.log(`- LOOK_DOWN ('tilt head slightly downward') present: ${foundTiltDown}`);
    console.log(`- TURN_LEFT ('turn head slightly to the left') present: ${foundTurnLeft}`);
    console.log(`- TURN_RIGHT ('turn head slightly to the right') present: ${foundTurnRight}`);
    console.log(`- 'Please nod once' present: ${foundNodOnce} (must be FALSE)`);
    console.log(`- 'blink once' present: ${foundBlinkOnce} (must be FALSE)`);

    const allFourActionsPresent = foundTiltUp && foundTiltDown && foundTurnLeft && foundTurnRight;
    const noNodOrBlink = !foundNodOnce && !foundBlinkOnce;

    if (foundFullScreen && foundStep1 && allFourActionsPresent && noNodOrBlink) {
      console.log('SUCCESS: Production Vercel deployment is serving updated build with full-screen overlay and exactly 4 head movements!');
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
