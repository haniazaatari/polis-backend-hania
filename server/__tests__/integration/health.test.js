import { describe, expect, test } from '@jest/globals';
import { newAgent } from '../setup/api-test-helpers.js';

describe('Health Check Endpoints', () => {
  // Use newAgent() instead of direct global access
  const agent = newAgent();

  describe('GET /testConnection', () => {
    test('should return 200 OK', async () => {
      const response = await agent.get('/api/v3/testConnection');

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(response.body.status).toBe('ok');
    });
  });

  describe('GET /testDatabase', () => {
    test('should return 200 OK when database is connected', async () => {
      const response = await agent.get('/api/v3/testDatabase');

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(response.body.status).toBe('ok');
    });
  });
});
