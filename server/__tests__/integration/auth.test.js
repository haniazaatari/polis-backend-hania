import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  createTestComment,
  createTestConversation,
  extractCookieValue,
  generateTestUser,
  initializeParticipant,
  makeRequest,
  registerAndLoginUser,
  submitVote
} from '../setup/api-test-helpers.js';
import { rollbackTransaction, startTransaction } from '../setup/db-test-helpers.js';

describe('Authentication', () => {
  // Store cookies between tests for auth flow
  let authCookies = [];
  let client = null;

  // Store test user data for register-login flow
  const testUser = generateTestUser();

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

  // Helper to extract error message from response
  function getErrorMessage(response) {
    if (typeof response.text === 'string') {
      try {
        const parsed = JSON.parse(response.text);
        return parsed.error || response.text;
      } catch (e) {
        return response.text;
      }
    }
    return response.text;
  }

  describe('Login Endpoint', () => {
    it('should return 400 when no password provided', async () => {
      const response = await makeRequest('POST', '/auth/login', {});

      expect(response.status).toBe(400);
      expect(response.text).toContain('polis_err_param_missing_password');
    });

    it('should return 401 when no credentials provided', async () => {
      const response = await makeRequest('POST', '/auth/login', {
        password: 'testpassword'
      });

      expect(response.status).toBe(403);
      expect(response.text).toContain('polis_err_login_unknown_user_or_password_noresults');
    });

    it('should return 401 with invalid credentials', async () => {
      const response = await makeRequest('POST', '/auth/login', {
        email: 'nonexistent@example.com',
        password: 'wrongpassword'
      });

      expect(response.status).toBe(403);
      expect(response.text).toContain('polis_err_login_unknown_user_or_password');
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
      const response = await makeRequest('POST', '/auth/new', {
        ...validRegistration,
        password2: 'DifferentPassword123!'
      });

      expect(response.status).toBe(400);
      expect(getErrorMessage(response)).toMatch(/Passwords do not match/);
    });

    it('should return 400 when required fields are missing', async () => {
      const response = await makeRequest('POST', '/auth/new', {
        email: validRegistration.email
      });

      expect(response.status).toBe(400);
      expect(getErrorMessage(response)).toMatch(/polis_err_reg_need_tos/);
    });

    it('should return 400 when terms not accepted', async () => {
      const response = await makeRequest('POST', '/auth/new', {
        ...validRegistration,
        gatekeeperTosPrivacy: false
      });

      expect(response.status).toBe(400);
      expect(getErrorMessage(response)).toMatch(/polis_err_reg_need_tos/);
    });
  });

  describe('Deregister (Logout) Endpoint', () => {
    it('should handle missing showPage parameter', async () => {
      const response = await makeRequest('POST', '/auth/deregister', {});
      expect(response.status).toBe(200);
    });

    it('should handle null showPage value', async () => {
      const response = await makeRequest('POST', '/auth/deregister', {
        showPage: null
      });
      expect(response.status).toBe(200);
    });
  });

  describe('Register-Login Flow', () => {
    it('should register a new user and then login with the same credentials', async () => {
      // Step 1: Register a new user
      const registerResponse = await makeRequest('POST', '/auth/new', {
        email: testUser.email,
        password: testUser.password,
        password2: testUser.password,
        hname: testUser.hname,
        gatekeeperTosPrivacy: true
      });

      expect(registerResponse.status).toBe(200);
      // The response could be JSON or text, so we check body first
      const registerData = registerResponse.body || JSON.parse(registerResponse.text);
      expect(registerData).toHaveProperty('uid');
      expect(registerData).toHaveProperty('email', testUser.email);

      // Store the user ID
      testUser.uid = registerData.uid;

      // Step 2: Immediately try to login with the same credentials
      const loginResponse = await makeRequest('POST', '/auth/login', {
        email: testUser.email,
        password: testUser.password
      });

      // This is the key test - if login works immediately after registration
      expect(loginResponse.status).toBe(200);
      // The response could be JSON or text, so we check body first
      const loginData = loginResponse.body || JSON.parse(loginResponse.text);
      expect(loginData).toHaveProperty('uid', testUser.uid);
      expect(loginData).toHaveProperty('email', testUser.email);

      // Save cookies for subsequent tests
      authCookies = loginResponse.headers['set-cookie'] || [];
      expect(authCookies.length).toBeGreaterThan(0);

      // Verify token cookie is present
      const token = extractCookieValue(authCookies, 'token2');
      expect(token).toBeDefined();
    });
  });

  describe('Complete Auth Flow', () => {
    // Create a unique user for this test suite
    const completeFlowUser = generateTestUser();
    let completeFlowCookies = [];

    it('should register, login, and logout successfully', async () => {
      // Step 1: Register a new user
      const registerResponse = await makeRequest('POST', '/auth/new', {
        email: completeFlowUser.email,
        password: completeFlowUser.password,
        password2: completeFlowUser.password,
        hname: completeFlowUser.hname,
        gatekeeperTosPrivacy: true
      });

      expect(registerResponse.status).toBe(200);
      const registerData = registerResponse.body || JSON.parse(registerResponse.text);
      completeFlowUser.uid = registerData.uid;

      // Step 2: Login with the user
      const loginResponse = await makeRequest('POST', '/auth/login', {
        email: completeFlowUser.email,
        password: completeFlowUser.password
      });

      expect(loginResponse.status).toBe(200);
      completeFlowCookies = loginResponse.headers['set-cookie'] || [];
      expect(completeFlowCookies.length).toBeGreaterThan(0);

      // Step 3: Logout the user
      const logoutResponse = await makeRequest('POST', '/auth/deregister', {}, completeFlowCookies);
      expect(logoutResponse.status).toBe(200);

      // Step 4: Try to access a protected resource (should fail)
      const protectedResponse = await makeRequest('GET', '/conversations', {}, completeFlowCookies);
      expect([400, 401, 403]).toContain(protectedResponse.status);

      // Step 5: Login again to verify we can still authenticate
      const loginAgainResponse = await makeRequest('POST', '/auth/login', {
        email: completeFlowUser.email,
        password: completeFlowUser.password
      });

      expect(loginAgainResponse.status).toBe(200);
      expect(loginAgainResponse.headers['set-cookie']).toBeDefined();
      expect(loginAgainResponse.headers['set-cookie'].length).toBeGreaterThan(0);
    });
  });

  describe('Participant Authentication', () => {
    // Test data for participant tests
    let conversationId;
    let commentId;
    let testOwner;

    // Set up a test conversation once for all participant auth tests
    beforeEach(async () => {
      try {
        // Create a dedicated owner for this test suite
        const ownerUser = generateTestUser();

        // Register and login as the owner
        testOwner = await registerAndLoginUser(ownerUser);
        expect(testOwner.authToken).toBeDefined();

        // Create a conversation for participant testing
        const conversationData = await createTestConversation(testOwner.authToken, {
          topic: `Participant Auth Test Conversation ${Date.now()}`,
          description: 'Test conversation for participant authentication tests',
          is_active: true,
          is_anon: true
        });

        conversationId = conversationData.zinvite;
        expect(conversationId).toBeDefined();
        console.log(`Created test conversation with ID: ${conversationId}`);

        // Create a test comment - the legacy server response format is different
        commentId = await createTestComment(testOwner.authToken, conversationId, {
          txt: 'Test comment for participant auth flow'
        });

        console.log(`Created test comment with ID: ${commentId}`);

        // For legacy server testing, we can continue even if we don't have a specific comment ID
        // The initialize participant endpoint will return a comment anyway
        console.log(`Set up conversation ${conversationId} with comment ${commentId} for participant auth tests`);
      } catch (err) {
        console.error('Failed to set up participant auth tests:', err);
        throw err;
      }
    }, 30000); // Longer timeout for setup

    // Simple test that checks just the initialization of participant
    it('should initialize a participant session with cookies', async () => {
      // Initialize participant
      const { cookies, body, status } = await initializeParticipant(conversationId);

      expect(status).toBe(200);

      // Should receive cookies
      expect(cookies).toBeDefined();
      expect(cookies.length).toBeGreaterThan(0);

      // Should have a pc (permanent cookie)
      const pcCookie = extractCookieValue(cookies, 'pc');
      expect(pcCookie).toBeDefined();

      // Response body should have conversation and nextComment objects
      expect(Object.keys(body)).toContain('conversation');
      expect(Object.keys(body)).toContain('nextComment');

      // Log response structure to help debugging
      console.log('Participant init response keys:', Object.keys(body));

      const { conversation, nextComment } = body;

      // expect conversation.conversation_id to be the same as conversationId
      expect(conversation.conversation_id).toBe(conversationId);
      // expect nextComment.tid to be the same as commentId
      expect(nextComment.tid).toBe(commentId);
    });

    it('should authenticate a participant upon first vote', async () => {
      // Step 1: Initialize participant
      const { cookies, body, status } = await initializeParticipant(conversationId);
      expect(status).toBe(200);
      expect(cookies.length).toBeGreaterThan(0);
      expect(body).toHaveProperty('nextComment');
      const { nextComment } = body;
      expect(nextComment.tid).toBe(commentId);

      // Step 2: Vote on the comment
      const voteData = {
        conversation_id: conversationId,
        tid: commentId,
        vote: -1,
        agid: 1
      };

      const { cookies: voteCookies, body: voteBody, status: voteStatus } = await submitVote(voteData, cookies);
      expect(voteStatus).toBe(200);

      expect(voteCookies.length).toBeGreaterThan(1);

      // Verify participant-related cookies
      const uc = extractCookieValue(voteCookies, 'uc');
      const uid2 = extractCookieValue(voteCookies, 'uid2');
      const token2 = extractCookieValue(voteCookies, 'token2');

      // For participant auth flow, we should have these cookies
      expect(uc).toBeDefined();
      expect(uid2).toBeDefined();
      expect(token2).toBeDefined();

      expect(Object.keys(voteBody)).toContain('currentPid');
    });
  });
});
