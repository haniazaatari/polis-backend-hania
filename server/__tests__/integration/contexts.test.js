import { describe, expect, test } from '@jest/globals';
import request from 'supertest';
import { API_PREFIX, API_URL, generateTestUser, registerAndLoginUser } from '../setup/api-test-helpers.js';

describe('GET /contexts', () => {
  test('Returns available contexts to anonymous users', async () => {
    // Call the contexts endpoint
    const response = await request(API_URL).get(`${API_PREFIX}/contexts`);

    // Verify response status is 200
    expect(response.status).toBe(200);

    // Verify response contains an array of contexts
    expect(Array.isArray(response.body)).toBe(true);

    // Each context should have basic properties
    if (response.body.length > 0) {
      const context = response.body[0];
      expect(context).toHaveProperty('name');
    }
  });

  test('Returns available contexts to authenticated users', async () => {
    // Register and login a test user
    const testUser = generateTestUser();
    const { authToken } = await registerAndLoginUser(testUser);

    // Call the contexts endpoint with authentication
    const response = await request(API_URL).get(`${API_PREFIX}/contexts`).set('x-polis', authToken);

    // Verify response status is 200
    expect(response.status).toBe(200);

    // Verify response contains an array of contexts
    expect(Array.isArray(response.body)).toBe(true);

    // Each context should have basic properties
    if (response.body.length > 0) {
      const context = response.body[0];
      expect(context).toHaveProperty('name');
    }
  });
});
