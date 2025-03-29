import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { generateTestUser, getTestAgent, getTextAgent, registerAndLoginUser, wait } from '../setup/api-test-helpers.js';
import { deleteAllEmails, getPasswordResetUrl } from '../setup/email-helpers.js';

describe('Password Reset API', () => {
  // Access the global agents
  const agent = getTestAgent();
  const textAgent = getTextAgent();

  let testUser;

  // Setup - create a test user for password reset tests and clear mailbox
  beforeAll(async () => {
    // Clear any existing emails - ignore errors if MailDev is not running
    try {
      await deleteAllEmails();
    } catch (error) {
      console.warn('MailDev may not be running - email cleanup skipped:', error.message);
    }

    testUser = generateTestUser();

    // Register the user
    await registerAndLoginUser(testUser);
  });

  // Cleanup - nothing specific needed, test database is ephemeral
  afterAll(async () => {
    // Try to clean up emails
    try {
      await deleteAllEmails();
    } catch (error) {
      console.warn('MailDev may not be running - email cleanup skipped:', error.message);
    }
  });

  describe('POST /auth/pwresettoken', () => {
    test('should generate a password reset token for a valid email', async () => {
      const response = await textAgent.post('/api/v3/auth/pwresettoken').send({
        email: testUser.email
      });

      // Check successful response
      expect(response.status).toBe(200);
      expect(response.text).toMatch(/Password reset email sent, please check your email./);
    });

    // Existence of an email address in the system should not be inferable from the response
    test('should behave normally for non-existent email', async () => {
      const response = await textAgent.post('/api/v3/auth/pwresettoken').send({
        email: `nonexistent-${testUser.email}`
      });

      expect(response.status).toBe(200);
      expect(response.text).toMatch(/Password reset email sent, please check your email./);
    });

    test('should return an error for missing email parameter', async () => {
      const response = await textAgent.post('/api/v3/auth/pwresettoken').send({});

      expect(response.status).toBe(400);
      expect(response.text).toMatch(/polis_err_param_missing_email/);
    });
  });

  describe('Password Reset Flow', () => {
    const newPassword = 'NewTestPassword123!';

    test('should request a reset token, reset password, and login with new password', async () => {
      // Step 1: Request reset token
      const tokenResponse = await textAgent.post('/api/v3/auth/pwresettoken').send({
        email: testUser.email
      });

      expect(tokenResponse.status).toBe(200);

      // Try to get the URL from the email
      const { url: pwResetUrl, token: resetToken } = await getPasswordResetUrl(testUser.email);

      // Step 2: GET the reset page with token (just verify it works, not rendering)
      const url = new URL(pwResetUrl);
      const resetPageResponse = await agent.get(url.pathname + url.search);

      // Since this returns HTML, just check the status code
      expect(resetPageResponse.status).toBe(200);

      // Step 3: Submit the reset with new password
      const resetResponse = await textAgent.post('/api/v3/auth/password').send({
        newPassword: newPassword,
        pwresettoken: resetToken
      });

      // Check if password reset was successful
      expect(resetResponse.status).toBe(200);

      // Wait for password reset to take effect
      await wait(1000);

      // Step 4: Verify we can login with the new password
      const loginResponse = await agent.post('/api/v3/auth/login').send({
        email: testUser.email,
        password: newPassword
      });

      // Check login success
      expect(loginResponse.status).toBe(200);
      const cookies = loginResponse.headers['set-cookie'];
      expect(cookies).toBeTruthy();
      expect(cookies.some((cookie) => cookie.startsWith('token2='))).toBe(true);
      expect(cookies.some((cookie) => cookie.startsWith('uid2='))).toBe(true);
    });

    test('should reject reset attempts with invalid tokens', async () => {
      const invalidToken = `invalid_token_${Date.now()}`;

      const resetResponse = await textAgent.post('/api/v3/auth/password').send({
        newPassword: 'AnotherPassword123!',
        pwresettoken: invalidToken
      });

      // Should be an error response
      expect(resetResponse.status).toBe(500);
      expect(resetResponse.text).toMatch(/Password Reset failed. Couldn't find matching pwresettoken./);
    });

    test('should reject reset attempts with missing parameters', async () => {
      // Missing token
      const resetResponse1 = await textAgent.post('/api/v3/auth/password').send({
        newPassword: 'AnotherPassword123!'
      });

      expect(resetResponse1.status).toBe(400);
      expect(resetResponse1.text).toMatch(/polis_err_param_missing_pwresettoken/);

      // Missing password
      const resetResponse2 = await textAgent.post('/api/v3/auth/password').send({
        pwresettoken: 'some_token'
      });

      expect(resetResponse2.status).toBe(400);
      expect(resetResponse2.text).toMatch(/polis_err_param_missing_newPassword/);
    });
  });
});
