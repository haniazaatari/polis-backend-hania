import dotenv from 'dotenv';
import request from 'supertest';

// Load environment variables from .env file
dotenv.config();

// Use the API_SERVER_PORT from the environment
const API_PORT = process.env.API_SERVER_PORT || 5000;
const API_URL = process.env.API_URL || `http://localhost:${API_PORT}`;

describe('Health API Integration Tests', () => {
  describe('GET /api/v3/testConnection', () => {
    it('should return a 200 status when API is running', async () => {
      const response = await request(API_URL).get('/api/v3/testConnection');

      expect(response.status).toBe(200);

      if (response.status === 200) {
        expect(response.body).toHaveProperty('status');
      }
    });
  });

  describe('GET /api/v3/testDatabase', () => {
    it('should return a 200 status when database is connected', async () => {
      const response = await request(API_URL).get('/api/v3/testDatabase');

      expect(response.status).toBe(200);

      if (response.status === 200) {
        expect(response.body).toHaveProperty('status');
      }
    });
  });
});
