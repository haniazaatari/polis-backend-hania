import { afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import request from 'supertest';
import {
  API_PREFIX,
  API_URL,
  attachAuthToken,
  createTestComment,
  createTestConversation,
  generateRandomXid,
  generateTestUser,
  initializeParticipant,
  initializeParticipantWithXid,
  wait
} from '../setup/api-test-helpers.js';
import { rollbackTransaction, startTransaction } from '../setup/db-test-helpers.js';

describe('Participation Endpoints', () => {
  let authToken = null;
  let conversationId = null;
  let conversationZinvite = null;
  const xidConversationZinvite = null;
  let client = null;
  const testUser = generateTestUser();
  const testXid = generateRandomXid();

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

    // Create a regular test conversation
    const conversation = await createTestConversation(authToken);
    expect(conversation).toBeDefined();
    expect(conversation.zid).toBeDefined();
    expect(conversation.zinvite).toBeDefined();

    conversationId = conversation.zid;
    conversationZinvite = conversation.zinvite;

    // Create test comments in the conversation
    const commentId = await createTestComment(authToken, conversationZinvite);
    expect(commentId).toBeDefined();
    await createTestComment(authToken, conversationZinvite);
    await createTestComment(authToken, conversationZinvite);

    // Wait for all setup operations to complete
    await wait(1000);
  }, 15000);

  test('Regular participation lifecycle', async () => {
    // STEP 1: Initialize anonymous participant
    const { body, cookies, status} = await initializeParticipant(conversationZinvite);

    expect(status).toBe(200);
    expect(cookies).toBeDefined();
    expect(cookies.length).toBeGreaterThan(0);
    expect(body).toBeDefined();

    // STEP 2: Get next comment for participant
    const nextCommentResponse = await request(API_URL)
      .get(`${API_PREFIX}/nextComment?conversation_id=${conversationZinvite}`)
      .set('Cookie', cookies);

    expect(nextCommentResponse.status).toBe(200);
    expect(nextCommentResponse.body).toBeDefined();
  });

  test('XID participation lifecycle', async () => {
    // STEP 1: Initialize participation with XID
    const { body, cookies, status} = await initializeParticipantWithXid(conversationZinvite, testXid);

    expect(status).toBe(200);
    expect(cookies).toBeDefined();
    expect(cookies.length).toBeGreaterThan(0);
    expect(body).toBeDefined();

    // STEP 2: Get next comment for participant
    const nextCommentResponse = await request(API_URL)
      .get(`${API_PREFIX}/nextComment?conversation_id=${conversationZinvite}&xid=${testXid}`)
      .set('Cookie', cookies);

    expect(nextCommentResponse.status).toBe(200);
    expect(nextCommentResponse.body).toBeDefined();
  });

  test('Participation validation', async () => {
    // Test missing conversation ID in participation
    const missingConvResponse = await attachAuthToken(request(API_URL).get(`${API_PREFIX}/participation`), authToken);
    expect(missingConvResponse.status).toBe(400);

    // Test missing conversation ID in participationInit
    const missingConvInitResponse = await request(API_URL).get(`${API_PREFIX}/participationInit`);
    expect(missingConvInitResponse.status).toBe(200);
    expect(missingConvInitResponse.body).toBeDefined();
    expect(missingConvInitResponse.body.conversation).toBeNull();
  });
});
