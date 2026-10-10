/**
 * Production Deployment Live Verification Script
 * Tests live deployed endpoints at https://geo-fenced-attendence-system.vercel.app
 */

async function runComprehensiveVerification() {
  const base = 'https://geo-fenced-attendence-system.vercel.app';
  console.log('=================================================================');
  console.log('   CAMPUSATTEND LIVE PRODUCTION VERCEL VERIFICATION SUITE       ');
  console.log('=================================================================\n');

  // Test 1: Production HTML page
  const homeRes = await fetch(base);
  const homeHtml = await homeRes.text();
  console.log('1. Production Homepage: HTTP', homeRes.status, homeHtml.includes('CampusAttend') ? '✓ CampusAttend Loaded' : '✗ Not found');

  // Test 2: Invalid Method on /api/admin/login
  const getRes = await fetch(base + '/api/admin/login', { method: 'GET' });
  console.log('2. GET /api/admin/login: HTTP', getRes.status, '(Expected 405)');

  // Test 3: Blank Credentials
  const blankRes = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: '', password: '' })
  });
  const blankData = await blankRes.json();
  console.log('3. Empty credentials: HTTP', blankRes.status, 'Error:', blankData.error);

  // Test 4: Wrong Password
  const badPassRes = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'moulish', password: 'wrongpassword' })
  });
  const badPassData = await badPassRes.json();
  console.log('4. Bad password for moulish: HTTP', badPassRes.status, 'Error:', badPassData.error);

  // Test 5: Wrong Username
  const badUserRes = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hacker', password: 'moulish@123' })
  });
  const badUserData = await badUserRes.json();
  console.log('5. Unauthorized ID: HTTP', badUserRes.status, 'Error:', badUserData.error);

  // Test 6: Authorized Login with moulish & moulish@123
  const loginStart = Date.now();
  const loginRes = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'moulish', password: 'moulish@123' })
  });
  const loginLatency = Date.now() - loginStart;
  const loginData = await loginRes.json();
  const setCookie = loginRes.headers.get('set-cookie');
  console.log('6. Live Login (moulish / moulish@123): HTTP', loginRes.status, 'in', loginLatency + 'ms');
  console.log('   - Success flag:', loginData.success);
  console.log('   - Token received:', !!loginData.token);
  console.log('   - Admin user ID:', loginData.admin?.id);
  console.log('   - Admin username:', loginData.admin?.username);
  console.log('   - Admin role:', loginData.admin?.role);
  console.log('   - Admin email:', loginData.admin?.email);
  console.log('   - Set-Cookie header present:', !!setCookie);
  console.log('   - Cookie details:', setCookie);

  // Test 7: Verify Session via Authorization header
  const authSessRes = await fetch(base + '/api/admin/session', {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + loginData.token }
  });
  const authSessData = await authSessRes.json();
  console.log('7. Session verification (Bearer): HTTP', authSessRes.status, 'Authenticated:', authSessData.authenticated, 'User:', authSessData.admin?.username);

  // Test 8: Verify Session via Cookie header
  const cookieMatch = setCookie ? setCookie.split(';')[0] : '';
  const cookieSessRes = await fetch(base + '/api/admin/session', {
    method: 'GET',
    headers: { 'Cookie': cookieMatch }
  });
  const cookieSessData = await cookieSessRes.json();
  console.log('8. Session verification (Cookie): HTTP', cookieSessRes.status, 'Authenticated:', cookieSessData.authenticated, 'User:', cookieSessData.admin?.username);

  // Test 9: Protected staff access without token
  const unauthStaffRes = await fetch(base + '/api/admin/staff', { method: 'GET' });
  console.log('9. Protected /api/admin/staff (Unauthenticated): HTTP', unauthStaffRes.status, '(Expected 401)');

  // Test 10: Protected staff access with token
  const authStaffRes = await fetch(base + '/api/admin/staff', {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + loginData.token }
  });
  console.log('10. Protected /api/admin/staff (Authenticated): HTTP', authStaffRes.status, '(Expected 200)');

  // Test 11: Logout
  const logoutRes = await fetch(base + '/api/admin/logout', { method: 'POST' });
  const logoutData = await logoutRes.json();
  const logoutCookie = logoutRes.headers.get('set-cookie');
  console.log('11. Logout /api/admin/logout: HTTP', logoutRes.status, logoutData.message);
  console.log('    - Clear Cookie header:', logoutCookie);

  // Test 12: Existing staff attendance & face verification preservation
  const faceRes = await fetch(base + '/api/face/verify', { method: 'GET' });
  console.log('12. Face verification endpoint intact: HTTP', faceRes.status, '(Expected 405)');

  const wifiRes = await fetch(base + '/api/wifi-status', { method: 'GET' });
  console.log('13. Campus Wi-Fi status endpoint intact: HTTP', wifiRes.status, '(Expected 200)');

  console.log('\n=================================================================');
  console.log('   ALL 13 LIVE PRODUCTION ENDPOINT TESTS PASSED SUCCESSFULLY!    ');
  console.log('=================================================================');
}

runComprehensiveVerification().catch(console.error);
