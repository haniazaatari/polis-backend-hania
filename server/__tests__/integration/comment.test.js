import { beforeAll, describe, expect, test } from '@jest/globals';
import {
  createComment,
  generateRandomXid,
  getTestAgent,
  getTextAgent,
  initializeParticipant,
  initializeParticipantWithXid,
  setupAuthAndConvo
} from '../setup/api-test-helpers.js';

describe('Comment Endpoints', () => {
  // Get agents using getter functions
  const agent = getTestAgent();
  const textAgent = getTextAgent();

  let conversationId = null;

  beforeAll(async () => {
    // Setup auth and create test conversation
    const setup = await setupAuthAndConvo();
    conversationId = setup.conversationId;
  });

  test('Comment lifecycle', async () => {
    // STEP 1: Create a new comment
    const timestamp = Date.now();
    const commentText = `Test comment ${timestamp}`;
    const commentId = await createComment(agent, conversationId, {
      txt: commentText
    });

    expect(commentId).toBeDefined();

    // STEP 2: Verify comment appears in conversation
    const listResponse = await agent.get(`/api/v3/comments?conversation_id=${conversationId}`);
    expect(listResponse.status).toBe(200);
    const responseBody = JSON.parse(listResponse.text);
    expect(Array.isArray(responseBody)).toBe(true);
    const foundComment = responseBody.find((comment) => comment.tid === commentId);
    expect(foundComment).toBeDefined();
    expect(foundComment.txt).toBe(commentText);
  });

  test('Comment validation', async () => {
    // Test invalid conversation ID
    const invalidResponse = await textAgent.post('/api/v3/comments').send({
      conversation_id: 'invalid-conversation-id',
      txt: 'This comment should fail'
    });

    expect(invalidResponse.status).toBe(400);

    // Test missing conversation ID in comments list
    const missingConvResponse = await agent.get('/api/v3/comments');
    expect(missingConvResponse.status).toBe(400);
  });

  test('Anonymous participant can submit a comment', async () => {
    // Initialize anonymous participant
    const { agent } = await initializeParticipant(conversationId);

    // Create a comment as anonymous participant using the helper
    const timestamp = Date.now();
    const commentText = `Anonymous participant comment ${timestamp}`;
    const commentId = await createComment(agent, conversationId, {
      txt: commentText
    });

    expect(commentId).toBeDefined();

    // Verify the comment appears in the conversation
    const listResponse = await agent.get(`/api/v3/comments?conversation_id=${conversationId}`);

    expect(listResponse.status).toBe(200);
    const responseBody = JSON.parse(listResponse.text);
    expect(Array.isArray(responseBody)).toBe(true);
    const foundComment = responseBody.find((comment) => comment.tid === commentId);
    expect(foundComment).toBeDefined();
    expect(foundComment.txt).toBe(commentText);
  });

  test('XID participant can submit a comment', async () => {
    // Initialize participant with XID
    const xid = generateRandomXid();
    const { agent } = await initializeParticipantWithXid(conversationId, xid);

    // Create a comment as XID participant using the helper
    const timestamp = Date.now();
    const commentText = `XID participant comment ${timestamp}`;
    const commentId = await createComment(agent, conversationId, {
      txt: commentText
    });

    expect(commentId).toBeDefined();

    // Verify the comment appears in the conversation
    const listResponse = await agent.get(`/api/v3/comments?conversation_id=${conversationId}`);

    expect(listResponse.status).toBe(200);
    const responseBody = JSON.parse(listResponse.text);
    expect(Array.isArray(responseBody)).toBe(true);
    const foundComment = responseBody.find((comment) => comment.tid === commentId);
    expect(foundComment).toBeDefined();
    expect(foundComment.txt).toBe(commentText);
  });
});
