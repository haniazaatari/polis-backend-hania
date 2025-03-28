import { beforeAll, describe, expect, test } from '@jest/globals';
import request from 'supertest';
import {
  API_PREFIX,
  API_URL,
  attachAuthToken,
  createComment,
  generateRandomXid,
  initializeParticipant,
  initializeParticipantWithXid,
  setupAuthAndConvo
} from '../setup/api-test-helpers.js';

describe('Comment Endpoints', () => {
  let authToken = null;
  let conversationId = null;

  beforeAll(async () => {
    // Setup auth and create test conversation
    const setup = await setupAuthAndConvo();
    authToken = setup.authToken;
    conversationId = setup.conversationId;
  });

  test('Comment lifecycle', async () => {
    // STEP 1: Create a new comment
    const timestamp = Date.now();
    const commentText = `Test comment ${timestamp}`;
    const commentId = await createComment(authToken, conversationId, {
      txt: commentText
    });

    expect(commentId).toBeDefined();

    // STEP 2: Verify comment appears in conversation
    const listResponse = await attachAuthToken(
      request(API_URL).get(`${API_PREFIX}/comments?conversation_id=${conversationId}`),
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
    const { cookies, body: initBody } = await initializeParticipant(conversationId);
    expect(cookies).toBeDefined();
    expect(cookies.length).toBeGreaterThan(0);

    // Create a comment as anonymous participant using the helper
    const timestamp = Date.now();
    const commentText = `Anonymous participant comment ${timestamp}`;
    const commentId = await createComment(cookies, conversationId, {
      txt: commentText
    });

    expect(commentId).toBeDefined();

    // Verify the comment appears in the conversation
    const listResponse = await attachAuthToken(
      request(API_URL).get(`${API_PREFIX}/comments?conversation_id=${conversationId}`),
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
    const { cookies, body: initBody } = await initializeParticipantWithXid(conversationId, xid);
    expect(cookies).toBeDefined();
    expect(cookies.length).toBeGreaterThan(0);

    // Create a comment as XID participant using the helper
    const timestamp = Date.now();
    const commentText = `XID participant comment ${timestamp}`;
    const commentId = await createComment(cookies, conversationId, {
      txt: commentText
    });

    expect(commentId).toBeDefined();

    // Verify the comment appears in the conversation
    const listResponse = await attachAuthToken(
      request(API_URL).get(`${API_PREFIX}/comments?conversation_id=${conversationId}`),
      authToken
    );

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    const foundComment = listResponse.body.find((comment) => comment.tid === commentId);
    expect(foundComment).toBeDefined();
    expect(foundComment.txt).toBe(commentText);
  });
});
