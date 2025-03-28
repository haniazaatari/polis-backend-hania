import { describe, expect, test } from '@jest/globals';
import { generateTestUser, makeRequest, registerAndLoginUser } from '../setup/api-test-helpers.js';

describe('POST /tutorial', () => {
  test('should update tutorial step for authenticated user', async () => {
    // Register and login a test user
    const testUser = generateTestUser();
    const { authToken } = await registerAndLoginUser(testUser);

    // Test updating the tutorial step
    const response = await makeRequest('POST', '/tutorial', { step: 1 }, authToken);

    // Expect success response
    expect(response.status).toBe(200);
  });

  test('should require authentication', async () => {
    // Try to update tutorial step without authentication
    const response = await makeRequest('POST', '/tutorial', { step: 1 });

    // Expect authentication error
    expect(response.status).toBe(500);

    // The error might be in body as string, text field, or JSON
    const errorText =
      typeof response.body === 'string' ? response.body : response.text || JSON.stringify(response.body);

    expect(errorText).toMatch(/polis_err_auth_token_not_supplied/);
  });

  test('should require valid step parameter', async () => {
    // Register and login a test user
    const testUser = generateTestUser();
    const { authToken } = await registerAndLoginUser(testUser);

    // Test missing step parameter
    const missingStepResponse = await makeRequest('POST', '/tutorial', {}, authToken);
    expect(missingStepResponse.status).toBe(400);

    const errorText =
      typeof missingStepResponse.body === 'string'
        ? missingStepResponse.body
        : missingStepResponse.text || JSON.stringify(missingStepResponse.body);

    expect(errorText).toMatch(/polis_err_param_missing_step/);
  });
});
