/**
 * Example test demonstrating the use of global agents with the new pattern
 */
import { describe, expect, test } from '@jest/globals';
import { authenticateAgent, getTestAgent, getTextAgent } from '../setup/api-test-helpers.js';

describe('Global Agent Example', () => {
  test('Using getTestAgent for standard JSON responses', async () => {
    // Get the agent using the getter function
    const agent = getTestAgent();

    // Make a request
    const response = await agent.get('/api/v3/testConnection');

    // Verify response
    expect(response.status).toBe(200);
    expect(response.body).toBeDefined();
  });

  test('Using getTextAgent for text responses', async () => {
    // Get the text agent using the getter function
    const textAgent = getTextAgent();

    // Make a request that might return text
    const response = await textAgent.post('/api/v3/auth/login').send({
      // Intentionally missing required fields to get a text error
    });

    // Verify response
    expect(response.status).toBe(400);
    expect(response.text).toContain('polis_err_param_missing');
  });

  test('Authenticating an agent with a token', async () => {
    // Get the agent
    const agent = getTestAgent();

    // Example token (in a real test, you'd get this from a login response)
    const mockToken = 'mock-token';

    // Authenticate the agent
    authenticateAgent(agent, mockToken);

    // Verify the agent has the token set (this is just a demonstration)
    expect(agent.get).toBeDefined();
  });
});
