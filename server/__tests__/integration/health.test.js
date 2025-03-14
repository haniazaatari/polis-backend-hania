import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { API_PREFIX, API_URL } from '../setup/api-test-helpers.js';
import { rollbackTransaction, startTransaction } from '../setup/db-test-helpers.js';

describe('Health Check Endpoints', () => {
  let client = null;

  // Start a transaction before each test
  beforeEach(async () => {
    client = await startTransaction();
  });

  // Rollback the transaction after each test
  afterEach(async () => {
    if (client) {
      await rollbackTransaction(client);
      client = null;
    }
  });

  describe('GET /testConnection', () => {
    it('should return 200 OK', async () => {
      const response = await request(API_URL).get(`${API_PREFIX}/testConnection`);

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
    });
  });

  describe('GET /testDatabase', () => {
    it('should return 200 OK when database is connected', async () => {
      const response = await request(API_URL).get(`${API_PREFIX}/testDatabase`);

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
    });
  });
});
