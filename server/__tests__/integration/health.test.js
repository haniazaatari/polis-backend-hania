import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import dotenv from 'dotenv';
import request from 'supertest';
import { rollbackTransaction, startTransaction } from '../setup/db-test-helpers.js';

// Load environment variables from .env file
dotenv.config();

// Use the API_SERVER_PORT from the environment
const API_PORT = process.env.API_SERVER_PORT || 5000;
const API_URL = process.env.API_URL || `http://localhost:${API_PORT}`;
const API_PREFIX = '/api/v3';

console.log('API_URL:', API_URL);

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
