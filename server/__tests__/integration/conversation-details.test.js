import { beforeEach, describe, expect, test } from '@jest/globals';
import {
  createComment,
  createConversation,
  generateTestUser,
  getTestAgent,
  newAgent,
  registerAndLoginUser
} from '../setup/api-test-helpers.js';

describe('Conversation Details API', () => {
  const agent = getTestAgent();

  beforeEach(async () => {
    const testUser = generateTestUser();
    await registerAndLoginUser(testUser);
  });

  test('should retrieve conversation details using conversation_id', async () => {
    // Create a public conversation
    const conversationId = await createConversation(agent, {
      is_active: true,
      is_anon: true,
      topic: 'Test Public Conversation',
      description: 'This is a test public conversation for the details endpoint'
    });

    // Add a comment to the conversation
    await createComment(agent, conversationId, {
      txt: 'This is a test comment for the conversation'
    });

    const response = await agent.get(`/api/v3/conversations?conversation_id=${conversationId}`);

    // Check that the response is successful
    expect(response.status).toBe(200);
    // The endpoint returns one conversation when conversation_id is specified
    expect(response.body).toBeDefined();
    // Verify the conversation has the expected topic
    expect(response.body.topic).toBe('Test Public Conversation');
  });

  test('should retrieve conversation list for an authenticated user', async () => {
    // Create a public conversation
    const conversation1Id = await createConversation(agent, {
      topic: 'My Test Conversation 1'
    });

    const conversation2Id = await createConversation(agent, {
      topic: 'My Test Conversation 2'
    });

    // Fetch conversation list for the user - use the correct path without API_PREFIX
    const response = await agent.get('/api/v3/conversations');

    // Check that the response is successful
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(2);

    // Find our created conversation in the list
    const foundConversation1 = response.body.find((conv) => conv.conversation_id === conversation1Id);
    const foundConversation2 = response.body.find((conv) => conv.conversation_id === conversation2Id);

    expect(foundConversation1).toBeDefined();
    expect(foundConversation1.topic).toBe('My Test Conversation 1');
    expect(foundConversation2).toBeDefined();
    expect(foundConversation2.topic).toBe('My Test Conversation 2');
  });

  test('should retrieve public conversation by conversation_id', async () => {
    // Create a public conversation
    const conversationId = await createConversation(agent, {
      is_active: true,
      is_anon: true,
      topic: 'Public Test Conversation',
      description: 'This is a public test conversation'
    });

    const publicAgent = newAgent();

    // Fetch conversation details without auth token
    const response = await publicAgent.get(`/api/v3/conversations?conversation_id=${conversationId}`);

    // Check that the response is successful
    expect(response.status).toBe(200);
    expect(response.body).toBeDefined();
    expect(response.body.topic).toBe('Public Test Conversation');
  });

  test('should return 400 for non-existent conversation', async () => {
    // Try to fetch a conversation with an invalid ID
    const response = await agent.get('/api/v3/conversations?conversation_id=nonexistent-conversation-id');

    // The endpoint returns a 400 error for a non-existent conversation
    expect(response.status).toBe(400);
    expect(response.text).toContain('polis_err_param_parse_failed_conversation_id');
    expect(response.text).toContain('polis_err_fetching_zid_for_conversation_id');
  });

  test('should retrieve conversation stats', async () => {
    // Create a public conversation
    const conversationId = await createConversation(agent, {
      is_active: true,
      is_anon: true,
      topic: 'Test Stats Conversation'
    });

    // Get conversation stats
    const response = await agent.get(`/api/v3/conversationStats?conversation_id=${conversationId}`);

    // Check that the response is successful
    expect(response.status).toBe(200);
    expect(response.body).toBeDefined();
    expect(response.body.voteTimes).toBeDefined();
    expect(response.body.firstVoteTimes).toBeDefined();
    expect(response.body.commentTimes).toBeDefined();
    expect(response.body.firstCommentTimes).toBeDefined();
    expect(response.body.votesHistogram).toBeDefined();
    expect(response.body.burstHistogram).toBeDefined();
  });
});
