import { describe, expect, it } from '@jest/globals';
import dotenv from 'dotenv';
import request from 'supertest';
// Load environment variables from .env file
dotenv.config();

// Use the API_SERVER_PORT from the environment
const API_PORT = process.env.API_SERVER_PORT || 5000;
const API_URL = process.env.API_URL || `http://localhost:${API_PORT}`;
const API_PREFIX = '/api/v3';

describe('Health Check Endpoints', () => {
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
