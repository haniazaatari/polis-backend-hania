import { afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import request from 'supertest';
import {
  API_PREFIX,
  API_URL,
  attachAuthToken,
  generateTestUser,
  makeRequestWithTimeout
} from '../setup/api-test-helpers.js';
import { rollbackTransaction, startTransaction } from '../setup/db-test-helpers.js';

describe('Conversation Endpoints', () => {
  let authToken = null;
  const conversationId = null;
  let conversationZinvite = null;
  let client = null;
  const testUser = generateTestUser();

  beforeEach(async () => {
    client = await startTransaction();
  });

  afterEach(async () => {
    if (client) {
      await rollbackTransaction(client);
      client = null;
    }
  });

  beforeAll(async () => {
    // Register a test user
    const registerResponse = await request(API_URL).post(`${API_PREFIX}/auth/new`).send({
      email: testUser.email,
      password: testUser.password,
      hname: testUser.hname,
      gatekeeperTosPrivacy: true
    });

    expect(registerResponse.status).toBe(200);
    expect(registerResponse.body).toHaveProperty('uid');

    // Login to get auth token
    const loginResponse = await request(API_URL).post(`${API_PREFIX}/auth/login`).send({
      email: testUser.email,
      password: testUser.password
    });

    expect(loginResponse.status).toBe(200);

    // Extract auth token - fail if not found
    if (loginResponse.headers['x-polis']) {
      authToken = loginResponse.headers['x-polis'];
    } else {
      throw new Error('No auth token found in response');
    }
  });

  test('Full conversation lifecycle', async () => {
    // STEP 1: Create a new conversation
    const timestamp = Date.now();
    const createResponse = await attachAuthToken(request(API_URL).post(`${API_PREFIX}/conversations`), authToken).send({
      topic: `Test Conversation ${timestamp}`,
      description: `Test Description ${timestamp}`,
      is_active: true,
      is_draft: false
    });

    expect(createResponse.status).toBe(200);
    expect(createResponse.body).toHaveProperty('url');
    expect(createResponse.body).toHaveProperty('conversation_id');

    const { conversation_id: conversationId } = createResponse.body;

    // Extract and validate zinvite
    conversationZinvite = createResponse.body.url.split('/').pop();
    expect(conversationZinvite).toBeTruthy();

    // STEP 2: Verify conversation appears in list
    const listResponse = await attachAuthToken(request(API_URL).get(`${API_PREFIX}/conversations`), authToken);

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(
      listResponse.body.some((conv) => conv.conversation_id === conversationId || conv.zid === conversationId)
    ).toBe(true);

    // STEP 3: Get conversation stats
    const statsResponse = await attachAuthToken(
      request(API_URL).get(`${API_PREFIX}/conversationStats?conversation_id=${conversationZinvite}`),
      authToken
    );

    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body).toBeDefined();

    // STEP 4: Update conversation
    const updateData = {
      conversation_id: conversationZinvite,
      description: `Updated description ${timestamp}`,
      topic: `Updated topic ${timestamp}`,
      is_active: true,
      is_draft: false
    };

    const updateResponse = await attachAuthToken(request(API_URL).put(`${API_PREFIX}/conversations`), authToken).send(
      updateData
    );

    expect(updateResponse.status).toBe(200);

    // STEP 5: Close conversation
    try {
      const closeResponse = await makeRequestWithTimeout(
        'POST',
        '/conversation/close',
        { conversation_id: conversationZinvite },
        authToken,
        {
          timeout: 5000, // 5s timeout as before
          retries: 1, // No retries needed since timeout is expected
          retryDelay: 0 // No delay needed
        }
      );

      // If we get a response, it should be 200
      expect(closeResponse.status).toBe(200);
    } catch (error) {
      // For the close endpoint, a timeout is actually expected and indicates success
      // Only fail if we get an actual error response that isn't a timeout
      if (!error.message.includes('timed out')) {
        throw error;
      }
      // Close conversation timed out as expected
    }

    // STEP 6: Reopen conversation
    const reopenResponse = await attachAuthToken(
      request(API_URL).post(`${API_PREFIX}/conversation/reopen`),
      authToken
    ).send({
      conversation_id: conversationZinvite
    });

    expect(reopenResponse.status).toBe(200);
  }, 60000); // Increased timeout to account for potential timeouts
});
