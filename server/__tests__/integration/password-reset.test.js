import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { generateTestUser, makeHttpGetRequest, makeRequest, registerAndLoginUser, wait } from '../setup/api-test-helpers.js';
import { deleteAllEmails, getPasswordResetUrl } from '../setup/email-helpers.js';

describe('Password Reset API', () => {
  let testUser;
  let userId;

  // Setup - create a test user for password reset tests and clear mailbox
  beforeAll(async () => {
    // Clear any existing emails
    try {
      await deleteAllEmails();
    } catch (error) {
      console.warn('Could not clear emails, MailDev may not be running:', error.message);
    }

    testUser = generateTestUser();

    // Register the user
    const registerResponse = await registerAndLoginUser(testUser);
    userId = registerResponse.userId;
  });

  // Cleanup - nothing specific needed, test database is ephemeral
  afterAll(async () => {
    // Try to clean up emails
    try {
      await deleteAllEmails();
    } catch (error) {
      console.warn('Could not clear emails after tests:', error.message);
    }

    await wait(1000);
  });

  describe('POST /auth/pwresettoken', () => {
    it('should generate a password reset token for a valid email', async () => {
      const response = await makeRequest('POST', '/auth/pwresettoken', {
        email: testUser.email
      });

      // Check successful response
      expect(response.status).toBe(200);
      expect(response.text).toMatch(/Password reset email sent, please check your email./);
    });

    // Existence of an email address in the system should not be inferable from the response
    it('should behave normally for non-existent email', async () => {
      const response = await makeRequest('POST', '/auth/pwresettoken', {
        email: `nonexistent-${testUser.email}`
      });

      expect(response.status).toBe(200);
      expect(response.text).toMatch(/Password reset email sent, please check your email./);
    });

    it('should return an error for missing email parameter', async () => {
      const response = await makeRequest('POST', '/auth/pwresettoken', {});

      expect(response.status).toBe(400);
      expect(response.text).toMatch(/polis_err_param_missing_email/);
    });
  });

  describe('Password Reset Flow', () => {
    const newPassword = 'NewTestPassword123!';

    it('should request a reset token, reset password, and login with new password', async () => {
      // Step 1: Request reset token
      const tokenResponse = await makeRequest('POST', '/auth/pwresettoken', {
        email: testUser.email
      });

      expect(tokenResponse.status).toBe(200);

      // Try to get the URL from the email
      const { url: pwResetUrl, token: resetToken } = await getPasswordResetUrl(testUser.email);

      // Step 2: GET the reset page with token (just verify it works, not rendering)
      const resetPageResponse = await makeHttpGetRequest(pwResetUrl);

      // Since this returns HTML, just check the status code
      expect(resetPageResponse.status).toBe(200);

      // Step 3: Submit the reset with new password
      const resetResponse = await makeRequest('POST', '/auth/password', {
        newPassword: newPassword,
        pwresettoken: resetToken
      });

      // Check if password reset was successful
      expect(resetResponse.status).toBe(200);

      // Wait for password reset to take effect
      await wait(1000);

      // Step 4: Verify we can login with the new password
      const loginResponse = await makeRequest('POST', '/auth/login', {
        email: testUser.email,
        password: newPassword
      });

      // Check login success
      expect(loginResponse.status).toBe(200);
      const cookies = loginResponse.headers['set-cookie'];
      expect(cookies).toBeTruthy();
      expect(cookies.some(cookie => cookie.startsWith('token2='))).toBe(true);
      expect(cookies.some(cookie => cookie.startsWith('uid2='))).toBe(true);
      expect(cookies.some(cookie => cookie.startsWith('pc='))).toBe(true);
    });

    it('should reject reset attempts with invalid tokens', async () => {
      const invalidToken = `invalid_token_${Date.now()}`;

      const resetResponse = await makeRequest('POST', '/auth/password', {
        newPassword: 'AnotherPassword123!',
        pwresettoken: invalidToken
      });

      // Should be an error response
      expect(resetResponse.status).toBe(500);
      expect(resetResponse.text).toMatch(/Password Reset failed. Couldn't find matching pwresettoken./);
    });

    it('should reject reset attempts with missing parameters', async () => {
      // Missing token
      const resetResponse1 = await makeRequest('POST', '/auth/password', {
        newPassword: 'AnotherPassword123!'
      });

      expect(resetResponse1.status).toBe(400);
      expect(resetResponse1.text).toMatch(/polis_err_param_missing_pwresettoken/);

      // Missing password
      const resetResponse2 = await makeRequest('POST', '/auth/password', {
        pwresettoken: 'some_token'
      });

      expect(resetResponse2.status).toBe(400);
      expect(resetResponse2.text).toMatch(/polis_err_param_missing_newPassword/);
    });
  });
});
