import { afterAll, describe, expect, it, jest } from '@jest/globals';
import dotenv from 'dotenv';
import request from 'supertest';

dotenv.config();

const API_PORT = process.env.API_SERVER_PORT || 5000;
const API_URL = process.env.API_URL || `http://localhost:${API_PORT}`;
const API_PREFIX = '/api/v3';

describe('Auth Endpoints', () => {
  describe('POST /auth/login', () => {
    it('should return 400 when no password provided', async () => {
      const response = await request(API_URL).post(`${API_PREFIX}/auth/login`).send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('polis_err_param_missing');
    });

    it('should return 401 when no credentials provided', async () => {
      const response = await request(API_URL).post(`${API_PREFIX}/auth/login`).send({
        password: 'testpassword'
      });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('polis_err_login_invalid_credentials');
    });

    it('should return 401 with invalid credentials', async () => {
      const response = await request(API_URL).post(`${API_PREFIX}/auth/login`).send({
        email: 'nonexistent@example.com',
        password: 'wrongpassword'
      });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('polis_err_login_invalid_credentials');
    });
  });

  describe('POST /auth/new', () => {
    const validRegistration = {
      email: `test${Date.now()}@example.com`,
      password: 'TestPassword123!',
      password2: 'TestPassword123!',
      hname: 'Test User',
      gatekeeperTosPrivacy: true
    };

    it('should return 400 when passwords do not match', async () => {
      const response = await request(API_URL)
        .post(`${API_PREFIX}/auth/new`)
        .send({
          ...validRegistration,
          password2: 'DifferentPassword123!'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Passwords do not match.');
    });

    it('should return 400 when required fields are missing', async () => {
      const response = await request(API_URL).post(`${API_PREFIX}/auth/new`).send({
        email: validRegistration.email
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('polis_err_reg_need_tos');
    });

    it('should return 400 when terms not accepted', async () => {
      const response = await request(API_URL)
        .post(`${API_PREFIX}/auth/new`)
        .send({
          ...validRegistration,
          gatekeeperTosPrivacy: false
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('polis_err_reg_need_tos');
    });
  });

  describe('POST /auth/deregister', () => {
    it('should handle missing showPage parameter', async () => {
      const response = await request(API_URL)
        .post(`${API_PREFIX}/auth/deregister`)
        .set('Content-Type', 'application/json')
        .send({});

      // When showPage is missing/undefined, return 200
      expect(response.status).toBe(200);
    });

    it('should handle null showPage value', async () => {
      const response = await request(API_URL)
        .post(`${API_PREFIX}/auth/deregister`)
        .set('Content-Type', 'application/json')
        .send({ showPage: null });

      // When showPage is null, treat same as missing -> return 200
      expect(response.status).toBe(200);
    });

    it('should handle string showPage value when not logged in', async () => {
      const response = await request(API_URL)
        .post(`${API_PREFIX}/auth/deregister`)
        .set('Content-Type', 'application/json')
        .send({ showPage: 'home' });

      // When showPage is set but no auth token, return 401
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('polis_err_auth_token_not_supplied');
    });
  });

  // Cleanup function to help tests exit cleanly
  afterAll((done) => {
    done();
  });
});
