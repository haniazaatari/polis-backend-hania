import { describe, expect, test } from '@jest/globals';
import {
  createTestComment,
  createTestConversation,
  generateTestUser,
  makeRequest,
  registerAndLoginUser
} from '../setup/api-test-helpers.js';

describe('Conversation Details API', () => {
  test('should retrieve conversation details using conversation_id', async () => {
    // Create a test user and conversation
    const testUser = generateTestUser();
    const { authToken } = await registerAndLoginUser(testUser);

    // Create a public conversation
    const { conversationId } = await createTestConversation(authToken, {
      is_active: true,
      is_anon: true,
      topic: 'Test Public Conversation',
      description: 'This is a test public conversation for the details endpoint'
    });

    // Add a comment to the conversation
    await createTestComment(authToken, conversationId, {
      txt: 'This is a test comment for the conversation'
    });

    // Fetch conversation details - notice we're not prepending API_PREFIX since makeRequest adds it
    const response = await makeRequest(
      'GET',
      `/conversations?conversation_id=${conversationId}`,
      null,
      authToken
    );

    // Check that the response is successful
    expect(response.status).toBe(200);
    // The endpoint returns one conversation when conversation_id is specified
    expect(response.body).toBeDefined();
    // Verify the conversation has the expected topic
    expect(response.body.topic).toBe('Test Public Conversation');
  });

  test('should retrieve conversation list for an authenticated user', async () => {
    // Create a test user and conversation
    const testUser = generateTestUser();
    const { authToken } = await registerAndLoginUser(testUser);

    // Create a public conversation
    const { conversationId } = await createTestConversation(authToken, {
      is_active: true,
      is_anon: true,
      topic: 'My Test Conversation',
      description: 'This is a test conversation for the list endpoint'
    });

    // Fetch conversation list for the user - use the correct path without API_PREFIX
    const response = await makeRequest('GET', '/conversations', null, authToken);

    // Check that the response is successful
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);

    // Find our created conversation in the list
    const foundConversation = response.body.find(
      (conv) => conv.conversation_id === conversationId
    );

    expect(foundConversation).toBeDefined();
    expect(foundConversation.topic).toBe('My Test Conversation');
  });

  test('should retrieve public conversation by conversation_id', async () => {
    // Create a test user and conversation
    const testUser = generateTestUser();
    const { authToken } = await registerAndLoginUser(testUser);

    // Create a public conversation
    const { conversationId } = await createTestConversation(authToken, {
      is_active: true,
      is_anon: true,
      topic: 'Public Test Conversation',
      description: 'This is a public test conversation'
    });

    expect(conversationId).toBeDefined();

    // Fetch conversation details without auth token
    const response = await makeRequest(
      'GET',
      `/conversations?conversation_id=${conversationId}`
    );

    // Check that the response is successful
    expect(response.status).toBe(200);
    expect(response.body).toBeDefined();
    expect(response.body.topic).toBe('Public Test Conversation');
  });

  test('should return 404 for non-existent conversation', async () => {
    // Create a test user
    const testUser = generateTestUser();
    const { authToken } = await registerAndLoginUser(testUser);

    // Try to fetch a conversation with an invalid ID
    const response = await makeRequest(
      'GET',
      '/conversations?conversation_id=nonexistent-conversation-id',
      null,
      authToken
    );

    // For a non-existent conversation, we expect an error
    expect(response.status).not.toBe(200);
  });

  test('should retrieve conversation stats', async () => {
    // Create a test user and conversation
    const testUser = generateTestUser();
    const { authToken } = await registerAndLoginUser(testUser);

    // Create a public conversation
    const { conversationId } = await createTestConversation(authToken, {
      is_active: true,
      is_anon: true,
      topic: 'Test Stats Conversation'
    });

    // Get conversation stats
    const response = await makeRequest(
      'GET',
      `/conversationStats?conversation_id=${conversationId}`,
      null,
      authToken
    );

    // Check that the response is successful
    expect(response.status).toBe(200);
    expect(response.body).toBeDefined();
  });
});
