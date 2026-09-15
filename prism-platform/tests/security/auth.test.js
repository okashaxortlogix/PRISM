// PRISM Authentication & Session Security Test Suite
const assert = require('node:assert');
const app = require('../../src/server');
const { validatePasswordStrength, verifyPassword } = require('../../src/security/passwordService');
const { getDatabase } = require('../../src/db/database');

async function runAuthTests() {
  console.log('\n=====================================================');
  console.log('🔒 RUNNING PRISM AUTHENTICATION & SESSION TESTS');
  console.log('=====================================================');

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Password Strength Validation
    console.log('Test 1: Password strength validation');
    assert.strictEqual(validatePasswordStrength('short').valid, false);
    assert.strictEqual(validatePasswordStrength('alllowercase123!').valid, false);
    assert.strictEqual(validatePasswordStrength('NOLOWERCASE123!').valid, false);
    assert.strictEqual(validatePasswordStrength('NoSpecialNum123').valid, false);
    assert.strictEqual(validatePasswordStrength('ValidPassword2026!').valid, true);
    console.log('  ✔ Password strength rules properly enforced');

    // 2. Register valid user
    console.log('Test 2: Register valid user account');
    const testEmail = `auth_test_${Date.now()}@acme.internal`;
    const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'ValidPassword2026!',
        display_name: 'Security Test User',
        organization_name: 'Security Test Corp'
      })
    });
    const regData = await regRes.json();
    assert.strictEqual(regRes.status, 201);
    assert.strictEqual(regData.success, true);
    assert.ok(regData.data.token, 'Must return session token');
    assert.strictEqual(regData.data.user.email, testEmail);
    assert.strictEqual(regData.data.role, 'OWNER');
    assert.strictEqual(regData.data.user.password_hash, undefined, 'Password hash MUST NEVER be returned');
    console.log('  ✔ Valid user registration succeeded with safe user object');

    // 3. Register duplicate user
    console.log('Test 3: Register duplicate email must be rejected');
    const dupRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'ValidPassword2026!',
        display_name: 'Duplicate User'
      })
    });
    const dupData = await dupRes.json();
    assert.strictEqual(dupRes.status, 409);
    assert.strictEqual(dupData.error.code, 'DUPLICATE_ACCOUNT');
    console.log('  ✔ Duplicate email correctly rejected with 409');

    // 4. Register invalid password
    console.log('Test 4: Register with weak password must fail');
    const weakRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `weak_${Date.now()}@acme.internal`,
        password: '123',
        display_name: 'Weak Pass User'
      })
    });
    assert.strictEqual(weakRes.status, 400);
    console.log('  ✔ Weak password rejected with 400');

    // 5. Login with valid credentials
    console.log('Test 5: Login with valid credentials');
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'ValidPassword2026!'
      })
    });
    const loginData = await loginRes.json();
    assert.strictEqual(loginRes.status, 200);
    assert.strictEqual(loginData.success, true);
    assert.ok(loginData.data.token, 'Must return authentication bearer token');
    const authToken = loginData.data.token;
    console.log('  ✔ Login successful and returned secure session token');

    // 6. Login with invalid password
    console.log('Test 6: Login with invalid password');
    const badPassRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'WrongPassword123!'
      })
    });
    const badPassData = await badPassRes.json();
    assert.strictEqual(badPassRes.status, 401);
    assert.strictEqual(badPassData.error.code, 'INVALID_CREDENTIALS');
    console.log('  ✔ Invalid credentials safely rejected');

    // 7. Verify /api/v1/auth/me with valid session
    console.log('Test 7: GET /api/v1/auth/me returns authenticated context');
    const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const meData = await meRes.json();
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meData.data.user.email, testEmail);
    assert.ok(meData.data.organization.id);
    assert.strictEqual(meData.data.role, 'OWNER');
    assert.strictEqual(meData.data.user.password_hash, undefined, 'Password hash must not be exposed in /me');
    console.log('  ✔ Authenticated identity and tenant context successfully verified');

    // 8. Protected route without authentication returns 401
    console.log('Test 8: Protected endpoints require authentication (401)');
    const unauthRes = await fetch(`${baseUrl}/api/v1/projects`);
    assert.strictEqual(unauthRes.status, 401);
    const unauthData = await unauthRes.json();
    assert.strictEqual(unauthData.error.code, 'UNAUTHORIZED');
    console.log('  ✔ Unauthenticated access rejected with 401 UNAUTHORIZED');

    // 9. Logout and session revocation
    console.log('Test 9: Logout revokes session token');
    const logoutRes = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    assert.strictEqual(logoutRes.status, 200);

    // Verify subsequent request with same token fails
    const postLogoutRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    assert.strictEqual(postLogoutRes.status, 401);
    console.log('  ✔ Session revocation confirmed: token rejected after logout');

    console.log('\n✔ ALL AUTHENTICATION & SESSION TESTS PASSED (100% GREEN)');
  } finally {
    server.close();
  }
}

if (require.main === module) {
  runAuthTests().catch(err => {
    console.error('❌ Auth test suite failed:', err);
    process.exit(1);
  });
}

module.exports = { runAuthTests };
