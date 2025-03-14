import { afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import dotenv from 'dotenv';
import request from 'supertest';
import {
  API_PREFIX,
  API_URL,
  attachAuthToken,
  createTestConversation,
  generateRandomXid,
  generateTestUser
} from '../setup/api-test-helpers.js';
import { rollbackTransaction, startTransaction } from '../setup/db-test-helpers.js';

dotenv.config();

describe('Participation Endpoints', () => {
  // Store auth token and other data between tests
  let authToken = null;
  let userId = null;
  let conversationId = null;
  let conversationZid = null;
  let commentId = null;
  let client = null;
  let xidConversationId = null;

  // Store test user data
  const testUser = generateTestUser();
  const testXid = generateRandomXid();

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

  // Register and login a test user before running tests
  beforeAll(async () => {
    // Register a test user
    const registerResponse = await request(API_URL).post(`${API_PREFIX}/auth/new`).send({
      email: testUser.email,
      password: testUser.password,
      hname: testUser.hname,
      gatekeeperTosPrivacy: true
    });

    // Extract user ID
    userId = registerResponse.body.uid;

    // Login to get auth token
    const loginResponse = await request(API_URL).post(`${API_PREFIX}/auth/login`).send({
      email: testUser.email,
      password: testUser.password
    });

    // Extract auth token from response headers or body
    if (loginResponse.headers['x-polis']) {
      authToken = loginResponse.headers['x-polis'];
    } else if (loginResponse.body?.token) {
      authToken = loginResponse.body.token;
    } else if (loginResponse.headers['set-cookie']) {
      // Store the entire cookie array
      authToken = loginResponse.headers['set-cookie'];
    } else {
      console.error('Failed to extract auth token from login response:', loginResponse.body);
    }

    if (!authToken) {
      console.warn('Could not obtain auth token - some tests may fail');
    }

    // Create a test conversation
    const convData = await createTestConversation(authToken);

    // Extract conversation zinvite (this is what we need for API calls)
    conversationId = convData.zinvite;

    // Store the numeric ZID for future reference if needed
    conversationZid = convData.zid;

    // Attempt to create a comment (non-seed to avoid vote issues)
    if (conversationId) {
      // Add a comment to the conversation (with is_seed=false to avoid auto-vote issues)
      const commentData = await attachAuthToken(
        request(API_URL)
          .post(`${API_PREFIX}/comments`)
          .send({
            conversation_id: conversationId,
            txt: `Test comment ${Date.now()}`,
            is_seed: false
          }),
        authToken
      );

      if (commentData.body.tid !== undefined) {
        commentId = commentData.body.tid;
      } else {
        console.warn('Failed to get comment ID from response');
      }
    }

    // Create a conversation for XID testing
    if (authToken) {
      const xidConvData = await createTestConversation(authToken, {
        topic: `XID Test Conversation ${Date.now()}`,
        xid_whitelist: testXid
      });

      // Extract conversation zinvite (this is what we need for API calls)
      xidConversationId = xidConvData.zinvite;
    }
  });

  describe('GET /participationInit', () => {
    it('should return 200 OK without authentication when accessing a public conversation', async () => {
      const response = await request(API_URL).get(`${API_PREFIX}/participationInit`).query({
        conversation_id: conversationId,
        pid: 'mypid'
      });

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();

      expect(response.body.conversation).toHaveProperty('conversation_id');
    });

    it('should return 200 OK and participation initialization data when authenticated', async () => {
      const response = await attachAuthToken(
        request(API_URL).get(`${API_PREFIX}/participationInit`).query({
          conversation_id: conversationId
        }),
        authToken
      );

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
    });

    it('should return partial data when no conversation_id is provided', async () => {
      const response = await attachAuthToken(
        request(API_URL).get(`${API_PREFIX}/participationInit`).query({ pid: 'mypid' }),
        authToken
      );

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(response.body).toHaveProperty('user');
      expect(response.body.conversation).toBeUndefined();
    });

    it('should respect ptptoiLimit parameter', async () => {
      const response = await attachAuthToken(
        request(API_URL).get(`${API_PREFIX}/participationInit`).query({
          conversation_id: conversationId,
          ptptoiLimit: 10
        }),
        authToken
      );

      expect(response.status).toBe(200);
    });

    it('should support custom language settings', async () => {
      const response = await attachAuthToken(
        request(API_URL).get(`${API_PREFIX}/participationInit`).query({
          conversation_id: conversationId,
          lang: 'es'
        }),
        authToken
      );

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
    });

    it('should support participation with an external ID', async () => {
      const response = await request(API_URL).get(`${API_PREFIX}/participationInit`).query({
        conversation_id: xidConversationId,
        xid: testXid
      });

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
    });
  });

  describe('GET /participation', () => {
    it('should return 200 OK and participation data when authenticated', async () => {
      const response = await attachAuthToken(
        request(API_URL).get(`${API_PREFIX}/participation`).query({
          conversation_id: conversationId
        }),
        authToken
      );

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
    });

    it('should return 401 when not authenticated', async () => {
      const response = await request(API_URL).get(`${API_PREFIX}/participation`).query({
        conversation_id: conversationId
      });

      expect(response.status).toBe(401);
    });

    it('should return 400 when conversation_id is not provided', async () => {
      const response = await attachAuthToken(request(API_URL).get(`${API_PREFIX}/participation`), authToken);

      expect(response.status).toBe(400);
    });

    it('should return 409 when strict mode is enabled and no XIDs exist', async () => {
      const response = await attachAuthToken(
        request(API_URL).get(`${API_PREFIX}/participation`).query({
          conversation_id: conversationId,
          strict: true
        }),
        authToken
      );

      expect(response.status).toBe(409);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('polis_err_get_participation_missing_xids');
    });

    it('should be able to participate after participation initialization', async () => {
      // First initialize participation
      const initResponse = await request(API_URL).get(`${API_PREFIX}/participationInit`).query({
        conversation_id: conversationId,
        pid: 'mypid'
      });

      expect(initResponse.status).toBe(200);
      expect(initResponse.body).toBeDefined();

      // Verify the response contains expected data
      expect(initResponse.body).toHaveProperty('user');
      expect(initResponse.body).toHaveProperty('conversation');

      // Get the pid from the init response
      let pid = initResponse.body.user?.pid;

      if (pid === undefined) {
        // If we can't find pid in the user object, try to get the participant ID directly
        const pidResponse = await attachAuthToken(
          request(API_URL).get(`${API_PREFIX}/participants`).query({
            conversation_id: conversationId
          }),
          authToken
        );

        if (pidResponse.status === 200 && pidResponse.body) {
          pid = pidResponse.body.pid;
        }
      }

      // Then get participation data (this is just to verify access, we don't need the data)
      const participationResponse = await attachAuthToken(
        request(API_URL).get(`${API_PREFIX}/participation`).query({
          conversation_id: conversationId
        }),
        authToken
      );

      expect(participationResponse.status).toBe(200);
      expect(participationResponse.body).toBeDefined();

      // Prepare the vote request data
      const voteData = {
        conversation_id: conversationId,
        tid: commentId,
        vote: -1, // -1 = agree; 1 = disagree
        pid: pid // Use the pid we retrieved from the API
      };

      // Verify a user can vote after participation initialization
      const voteResponse = await attachAuthToken(
        request(API_URL).post(`${API_PREFIX}/votes`).send(voteData),
        authToken
      );

      expect(voteResponse.status).toBe(200);
      expect(voteResponse.body).toBeDefined();
    });
  });
});
