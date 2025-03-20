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
  initializeParticipantWithXid
} from '../setup/api-test-helpers.js';
import { rollbackTransaction, startTransaction } from '../setup/db-test-helpers.js';

describe('Comment Endpoints', () => {
  let authToken = null;
  let conversationId = null;
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

    // Create a test conversation
    const conversation = await createTestConversation(authToken);
    expect(conversation).toBeDefined();
    expect(conversation.zid).toBeDefined();
    expect(conversation.zinvite).toBeDefined();

    conversationId = conversation.zid;
    conversationZinvite = conversation.zinvite;
  });

  test('Comment lifecycle', async () => {
    // STEP 1: Create a new comment
    const timestamp = Date.now();
    const commentText = `Test comment ${timestamp}`;
    const createResponse = await attachAuthToken(request(API_URL).post(`${API_PREFIX}/comments`), authToken).send({
      conversation_id: conversationZinvite,
      txt: commentText
    });

    expect(createResponse.status).toBe(200);
    expect(createResponse.body).toBeDefined();
    const commentId = createResponse.body.tid;
    expect(commentId).toBeDefined();

    // STEP 2: Verify comment appears in conversation
    const listResponse = await attachAuthToken(
      request(API_URL).get(`${API_PREFIX}/comments?conversation_id=${conversationZinvite}`),
      authToken
    );

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    const foundComment = listResponse.body.find((comment) => comment.tid === commentId);
    expect(foundComment).toBeDefined();
    expect(foundComment.txt).toBe(commentText);
  });

  test('Comment validation', async () => {
    // Test invalid conversation ID
    const invalidResponse = await attachAuthToken(request(API_URL).post(`${API_PREFIX}/comments`), authToken).send({
      conversation_id: 'invalid-conversation-id',
      txt: 'This comment should fail'
    });

    expect(invalidResponse.status).toBe(400);

    // Test missing conversation ID in comments list
    const missingConvResponse = await attachAuthToken(request(API_URL).get(`${API_PREFIX}/comments`), authToken);

    expect(missingConvResponse.status).toBe(400);
  });

  test('Anonymous participant can submit a comment', async () => {
    // Initialize anonymous participant
    const { cookies, body: initBody } = await initializeParticipant(conversationZinvite);
    expect(cookies).toBeDefined();
    expect(cookies.length).toBeGreaterThan(0);

    // Create a comment as anonymous participant using the helper
    const timestamp = Date.now();
    const commentText = `Anonymous participant comment ${timestamp}`;
    const commentId = await createTestComment(cookies, conversationZinvite, {
      txt: commentText
    });

    expect(commentId).toBeDefined();

    // Verify the comment appears in the conversation
    const listResponse = await attachAuthToken(
      request(API_URL).get(`${API_PREFIX}/comments?conversation_id=${conversationZinvite}`),
      authToken
    );

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    const foundComment = listResponse.body.find((comment) => comment.tid === commentId);
    expect(foundComment).toBeDefined();
    expect(foundComment.txt).toBe(commentText);
  });

  test('XID participant can submit a comment', async () => {
    // Initialize participant with XID
    const xid = generateRandomXid();
    const { cookies, body: initBody } = await initializeParticipantWithXid(conversationZinvite, xid);
    expect(cookies).toBeDefined();
    expect(cookies.length).toBeGreaterThan(0);

    // Create a comment as XID participant using the helper
    const timestamp = Date.now();
    const commentText = `XID participant comment ${timestamp}`;
    const commentId = await createTestComment(cookies, conversationZinvite, {
      txt: commentText
    });

    expect(commentId).toBeDefined();

    // Verify the comment appears in the conversation
    const listResponse = await attachAuthToken(
      request(API_URL).get(`${API_PREFIX}/comments?conversation_id=${conversationZinvite}`),
      authToken
    );

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    const foundComment = listResponse.body.find((comment) => comment.tid === commentId);
    expect(foundComment).toBeDefined();
    expect(foundComment.txt).toBe(commentText);
  });
});
