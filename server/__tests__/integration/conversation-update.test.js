import { beforeEach, describe, expect, test } from '@jest/globals';
import {
  createTestConversation,
  generateTestUser,
  makeRequest,
  registerAndLoginUser,
  wait
} from '../setup/api-test-helpers.js';

describe('Conversation Update API', () => {
  let testUser;
  let authToken;
  let conversationId;

  beforeEach(async () => {
    // Create a test user for each test
    testUser = generateTestUser();
    const auth = await registerAndLoginUser(testUser);
    authToken = auth.authToken;

    // Create a test conversation for each test
    const response = await createTestConversation(authToken, {
      is_active: true,
      is_anon: true,
      topic: 'Original Topic',
      description: 'Original Description',
      strict_moderation: false
    });

    conversationId = response.conversationId;
  });

  test('should update basic conversation properties', async () => {
    // Update the conversation with new values
    const updateData = {
      conversation_id: conversationId,
      topic: 'Updated Topic',
      description: 'Updated Description'
    };

    const updateResponse = await makeRequest('PUT', '/conversations', updateData, authToken);

    // Verify update was successful
    expect(updateResponse.status).toBe(200);

    // Wait for changes to be applied
    await wait(1000);

    // Verify the changes by getting the conversation details
    const getResponse = await makeRequest(
      'GET',
      `/conversations?conversation_id=${conversationId}`,
      null,
      authToken
    );

    expect(getResponse.status).toBe(200);
    expect(getResponse.body).toBeDefined();
    expect(getResponse.body.topic).toBe('Updated Topic');
    expect(getResponse.body.description).toBe('Updated Description');
  });

  test('should update boolean settings', async () => {
    // Update various boolean settings
    const updateData = {
      conversation_id: conversationId,
      is_active: false,
      strict_moderation: true,
      profanity_filter: true
    };

    const updateResponse = await makeRequest('PUT', '/conversations', updateData, authToken);

    // Verify update was successful
    expect(updateResponse.status).toBe(200);

    // Wait for changes to be applied
    await wait(1000);

    // Verify the changes by getting the conversation details
    const getResponse = await makeRequest(
      'GET',
      `/conversations?conversation_id=${conversationId}`,
      null,
      authToken
    );

    expect(getResponse.status).toBe(200);
    expect(getResponse.body).toBeDefined();
    expect(getResponse.body.is_active).toBe(false);
    expect(getResponse.body.strict_moderation).toBe(true);
    expect(getResponse.body.profanity_filter).toBe(true);
  });

  test('should update appearance settings', async () => {
    // Update appearance settings
    const updateData = {
      conversation_id: conversationId,
      bgcolor: '#f5f5f5',
      help_color: '#333333',
      help_bgcolor: '#ffffff'
    };

    const updateResponse = await makeRequest('PUT', '/conversations', updateData, authToken);

    // Verify update was successful
    expect(updateResponse.status).toBe(200);

    // Wait for changes to be applied
    await wait(1000);

    // Verify the changes by getting the conversation details
    const getResponse = await makeRequest(
      'GET',
      `/conversations?conversation_id=${conversationId}`,
      null,
      authToken
    );

    expect(getResponse.status).toBe(200);
    expect(getResponse.body).toBeDefined();
    expect(getResponse.body.bgcolor).toBe('#f5f5f5');
    expect(getResponse.body.help_color).toBe('#333333');
    expect(getResponse.body.help_bgcolor).toBe('#ffffff');
  });

  test('should fail when updating conversation without permission', async () => {
    // Create another user without permission to update the conversation
    const unauthorizedUser = generateTestUser();
    const unauthorizedAuth = await registerAndLoginUser(unauthorizedUser);

    // Attempt to update the conversation
    const updateData = {
      conversation_id: conversationId,
      topic: 'Unauthorized Topic Update'
    };

    const updateResponse = await makeRequest('PUT', '/conversations', updateData, unauthorizedAuth.authToken);

    // Verify update fails with permission error
    expect(updateResponse.status).toBe(403);
    expect(updateResponse.text).toMatch(/polis_err_update_conversation_permission/);
  });

  test('should handle non-existent conversation', async () => {
    const updateData = {
      conversation_id: 'non-existent-conversation',
      topic: 'This Should Fail'
    };

    const updateResponse = await makeRequest('PUT', '/conversations', updateData, authToken);

    // Verify update fails appropriately
    expect(updateResponse.status).not.toBe(200);
  });

  test('should reset appearance settings to default values', async () => {
    // First, set some appearance values
    await makeRequest(
      'PUT',
      '/conversations',
      {
        conversation_id: conversationId,
        bgcolor: '#f5f5f5',
        help_color: '#333333'
      },
      authToken
    );

    await wait(1000);

    // Then reset them to default
    const updateData = {
      conversation_id: conversationId,
      bgcolor: 'default',
      help_color: 'default'
    };

    const updateResponse = await makeRequest('PUT', '/conversations', updateData, authToken);

    // Verify update was successful
    expect(updateResponse.status).toBe(200);

    // Wait for changes to be applied
    await wait(1000);

    // Verify the changes by getting the conversation details
    const getResponse = await makeRequest(
      'GET',
      `/conversations?conversation_id=${conversationId}`,
      null,
      authToken
    );

    expect(getResponse.status).toBe(200);
    expect(getResponse.body).toBeDefined();
    expect(getResponse.body.bgcolor).toBeNull();
    expect(getResponse.body.help_color).toBeNull();
  });
});
