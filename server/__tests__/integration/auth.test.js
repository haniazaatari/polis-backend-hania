import { beforeEach, describe, expect, test } from '@jest/globals';
import {
  extractCookieValue,
  generateTestUser,
  initializeParticipant,
  makeRequest,
  setupAuthForTest,
  submitVote,
  wait
} from '../setup/api-test-helpers.js';

describe('Authentication', () => {
  const testUser = generateTestUser();

  describe('Login Endpoint', () => {
    test('should validate login parameters', async () => {
      // Test missing password
      const noPasswordResponse = await makeRequest('POST', '/auth/login', {});
      expect(noPasswordResponse.status).toBe(400);
      expect(noPasswordResponse.text).toMatch(/polis_err_param_missing_password/);

      // Test missing email
      const noEmailResponse = await makeRequest('POST', '/auth/login', { password: 'testpassword' });
      expect(noEmailResponse.status).toBe(403);
      expect(noEmailResponse.text).toMatch(/polis_err_login_unknown_user_or_password_noresults/);

      // Test invalid credentials
      const invalidResponse = await makeRequest('POST', '/auth/login', {
        email: 'nonexistent@example.com',
        password: 'wrongpassword'
      });
      expect(invalidResponse.status).toBe(403);
      expect(invalidResponse.text).toMatch(/polis_err_login_unknown_user_or_password/);
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

    test('should validate registration parameters', async () => {
      // Test password mismatch
      const mismatchResponse = await makeRequest('POST', '/auth/new', {
        ...validRegistration,
        password2: 'DifferentPassword123!'
      });
      expect(mismatchResponse.status).toBe(400);
      expect(mismatchResponse.text).toMatch(/Passwords do not match/);

      // Test missing required fields
      const missingFieldsResponse = await makeRequest('POST', '/auth/new', {
        email: validRegistration.email
      });
      expect(missingFieldsResponse.status).toBe(400);
      expect(missingFieldsResponse.text).toMatch(/polis_err_reg_need_tos/);

      // Test terms not accepted
      const noTosResponse = await makeRequest('POST', '/auth/new', {
        ...validRegistration,
        gatekeeperTosPrivacy: false
      });
      expect(noTosResponse.status).toBe(400);
      expect(noTosResponse.text).toMatch(/polis_err_reg_need_tos/);
    });
  });

  describe('Deregister (Logout) Endpoint', () => {
    test('should handle logout parameters', async () => {
      // Test missing showPage
      const noShowPageResponse = await makeRequest('POST', '/auth/deregister', {});
      expect(noShowPageResponse.status).toBe(200);

      // Test null showPage
      const nullShowPageResponse = await makeRequest('POST', '/auth/deregister', { showPage: null });
      expect(nullShowPageResponse.status).toBe(200);
    });
  });

  describe('Register-Login Flow', () => {
    test('should complete full registration and login flow', async () => {
      // STEP 1: Register a new user
      const registerResponse = await makeRequest('POST', '/auth/new', {
        email: testUser.email,
        password: testUser.password,
        password2: testUser.password,
        hname: testUser.hname,
        gatekeeperTosPrivacy: true
      });

      expect(registerResponse.status).toBe(200);
      expect(registerResponse.body).toHaveProperty('uid');
      expect(registerResponse.body).toHaveProperty('email', testUser.email);
      const userId = registerResponse.body.uid;

      await wait(1000); // Wait for registration to complete

      // STEP 2: Login with registered user
      const loginResponse = await makeRequest('POST', '/auth/login', {
        email: testUser.email,
        password: testUser.password
      });

      expect(loginResponse.status).toBe(200);
      expect(loginResponse.body).toHaveProperty('uid', userId);
      expect(loginResponse.body).toHaveProperty('email', testUser.email);

      const authCookies = loginResponse.headers['set-cookie'];
      expect(authCookies).toBeDefined();
      expect(authCookies.length).toBeGreaterThan(0);

      const token = extractCookieValue(authCookies, 'token2');
      expect(token).toBeDefined();
    });
  });

  describe('Complete Auth Flow', () => {
    test('should handle complete auth lifecycle', async () => {
      const completeFlowUser = generateTestUser();

      // STEP 1: Register new user
      const registerResponse = await makeRequest('POST', '/auth/new', {
        email: completeFlowUser.email,
        password: completeFlowUser.password,
        password2: completeFlowUser.password,
        hname: completeFlowUser.hname,
        gatekeeperTosPrivacy: true
      });

      expect(registerResponse.status).toBe(200);
      expect(registerResponse.body).toHaveProperty('uid');

      await wait(1000); // Wait for registration to complete

      // STEP 2: Login user
      const loginResponse = await makeRequest('POST', '/auth/login', {
        email: completeFlowUser.email,
        password: completeFlowUser.password
      });

      expect(loginResponse.status).toBe(200);
      const authCookies = loginResponse.headers['set-cookie'];
      expect(authCookies).toBeDefined();
      expect(authCookies.length).toBeGreaterThan(0);

      // STEP 3: Logout user
      const logoutResponse = await makeRequest('POST', '/auth/deregister', {}, authCookies);
      expect(logoutResponse.status).toBe(200);

      // STEP 4: Verify protected resource access fails
      const protectedResponse = await makeRequest('GET', '/conversations', null, authCookies);
      expect(protectedResponse.status).toBe(403);
      expect(protectedResponse.text).toMatch(/polis_err_need_auth/);

      // STEP 5: Verify can login again
      const reloginResponse = await makeRequest('POST', '/auth/login', {
        email: completeFlowUser.email,
        password: completeFlowUser.password
      });

      expect(reloginResponse.status).toBe(200);
      expect(reloginResponse.headers['set-cookie']).toBeDefined();
      expect(reloginResponse.headers['set-cookie'].length).toBeGreaterThan(0);
    });
  });

  describe('Participant Authentication', () => {
    let conversationId;
    let commentId;
    let ownerAuthToken;

    beforeEach(async () => {
      // Create owner and conversation using the helper function
      const setup = await setupAuthForTest({ commentCount: 1 });
      ownerAuthToken = setup.authToken;
      conversationId = setup.conversationZinvite;
      commentId = setup.commentIds[0];
    });

    test('should initialize participant session', async () => {
      const { cookies, body, status } = await initializeParticipant(conversationId);
      expect(status).toBe(200);
      expect(cookies).toBeDefined();
      expect(cookies.length).toBeGreaterThan(0);

      const pcCookie = extractCookieValue(cookies, 'pc');
      expect(pcCookie).toBeDefined();

      expect(body).toHaveProperty('conversation');
      expect(body).toHaveProperty('nextComment');
      expect(body.conversation.conversation_id).toBe(conversationId);
      expect(body.nextComment.tid).toBe(commentId);
    });

    test('should authenticate participant upon voting', async () => {
      // STEP 1: Initialize participant
      const { cookies, body } = await initializeParticipant(conversationId);
      expect(cookies.length).toBeGreaterThan(0);
      expect(body.nextComment.tid).toBe(commentId);

      // STEP 2: Submit vote
      const response = await submitVote(
        {
          conversation_id: conversationId,
          tid: commentId,
          vote: -1,
          agid: 1
        },
        cookies
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('currentPid');

      // Verify participant cookies
      const voteCookies = response.cookies;
      const uc = extractCookieValue(voteCookies, 'uc');
      const uid2 = extractCookieValue(voteCookies, 'uid2');
      const token2 = extractCookieValue(voteCookies, 'token2');

      expect(uc).toBeDefined();
      expect(uid2).toBeDefined();
      expect(token2).toBeDefined();
    });
  });
});
