import { describe, expect, it, jest } from '@jest/globals';
import dotenv from 'dotenv';
import request from 'supertest';

dotenv.config();

const API_PORT = process.env.API_SERVER_PORT || 5000;
const API_URL = process.env.API_URL || `http://localhost:${API_PORT}`;
const API_PREFIX = '/api/v3';

// Increase timeout for this test suite
jest.setTimeout(5000);

// Helper to generate random test data
function generateTestUser() {
  const timestamp = Date.now();
  const randomSuffix = Math.floor(Math.random() * 10000);

  return {
    email: `test.user.${timestamp}.${randomSuffix}@example.com`,
    password: `TestPassword${randomSuffix}!`,
    hname: `Test User ${timestamp}`
  };
}

describe('Authentication', () => {
  // Store cookies between tests for auth flow
  let authCookies = [];

  // Store test user data for register-login flow
  const testUser = generateTestUser();

  // Helper to extract cookies from response
  function extractCookiesFromResponse(response) {
    return response.headers['set-cookie'] || [];
  }

  // Helper to attach cookies to request
  function attachCookiesToRequest(req) {
    authCookies.forEach((cookie) => {
      const [cookieValue] = cookie.split(';');
      req.set('Cookie', cookieValue);
    });
    return req;
  }

  describe('Login Endpoint', () => {
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

  describe('Registration Endpoint', () => {
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

  describe('Deregister (Logout) Endpoint', () => {
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

  describe('Register-Login Flow', () => {
    it('should register a new user and then login with the same credentials', async () => {
      // Step 1: Register a new user
      console.log('Test user:', testUser);

      const registerResponse = await request(API_URL).post(`${API_PREFIX}/auth/new`).send({
        email: testUser.email,
        password: testUser.password,
        password2: testUser.password,
        hname: testUser.hname,
        gatekeeperTosPrivacy: true
      });

      console.log('Registration response:', registerResponse.status, registerResponse.body);

      expect(registerResponse.status).toBe(200);
      expect(registerResponse.body).toHaveProperty('uid');
      expect(registerResponse.body).toHaveProperty('email', testUser.email);

      // Store the user ID
      testUser.uid = registerResponse.body.uid;

      // Step 3: Immediately try to login with the same credentials
      const loginResponse = await request(API_URL).post(`${API_PREFIX}/auth/login`).send({
        email: testUser.email,
        password: testUser.password
      });

      console.log('Login response:', loginResponse.status, loginResponse.body);

      // This is the key test - if login works immediately after registration
      expect(loginResponse.status).toBe(200);
      expect(loginResponse.body).toHaveProperty('uid', testUser.uid);
      expect(loginResponse.body).toHaveProperty('email', testUser.email);

      // Save cookies for subsequent tests
      authCookies = extractCookiesFromResponse(loginResponse);
      expect(authCookies.length).toBeGreaterThan(0);
    });
  });

  describe('Complete Auth Flow', () => {
    it('should access a protected resource with valid auth', async () => {
      // Skip this test if we don't have auth cookies
      if (authCookies.length === 0) {
        console.log('Skipping protected resource test - no auth cookies');
        return;
      }

      // Using /users/me as a protected endpoint that requires auth
      const req = request(API_URL).get(`${API_PREFIX}/users/me`).set('Content-Type', 'application/json');

      // Attach auth cookies
      attachCookiesToRequest(req);

      const response = await req;
      console.log('Protected resource response:', response.status);

      // The actual status code will depend on the endpoint
      // Just checking that we don't get a 401/403
      expect([401, 403]).not.toContain(response.status);
    });

    it('should successfully log out', async () => {
      // Skip this test if we don't have auth cookies
      if (authCookies.length === 0) {
        console.log('Skipping logout test - no auth cookies');
        return;
      }

      const req = request(API_URL)
        .post(`${API_PREFIX}/auth/deregister`)
        .set('Content-Type', 'application/json')
        .send({});

      // Attach auth cookies
      attachCookiesToRequest(req);

      const response = await req;
      expect(response.status).toBe(200);

      // Clear our stored cookies
      authCookies = [];
    });
  });
});
