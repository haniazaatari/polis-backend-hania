import { describe, expect, test } from '@jest/globals';
import { generateTestUser, newAgent, registerAndLoginUser } from '../setup/api-test-helpers.js';

describe('GET /contexts', () => {
  // Use getTestAgent() to ensure agent is available
  const agent = newAgent();

  test('Returns available contexts to anonymous users', async () => {
    // Call the contexts endpoint
    const response = await agent.get('/api/v3/contexts');

    // Verify response status is 200
    expect(response.status).toBe(200);

    // Verify response contains expected keys
    expect(response.body).toBeDefined();
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
    const { agent: authAgent } = await registerAndLoginUser(testUser);

    // Call the contexts endpoint with authentication
    const response = await authAgent.get('/api/v3/contexts');

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
