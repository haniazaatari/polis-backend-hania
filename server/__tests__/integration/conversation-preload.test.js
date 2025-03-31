import { beforeAll, describe, expect, test } from '@jest/globals';
import { createConversation, getTextAgent, registerAndLoginUser } from '../setup/api-test-helpers.js';

describe('Conversation Preload API', () => {
  let agent;
  let textAgent;
  let conversationId;

  beforeAll(async () => {
    // Register a user (conversation owner)
    const auth = await registerAndLoginUser();
    agent = auth.agent;
    textAgent = getTextAgent();

    // Create a conversation
    conversationId = await createConversation(agent);

    // Wait a moment to ensure the conversation is registered
    // await wait(1000);
  });

  test('GET /api/v3/conversations/preload - should return preload info for a conversation', async () => {
    const { body, status } = await agent.get(`/api/v3/conversations/preload?conversation_id=${conversationId}`);

    // Should return successful response
    expect(status).toBe(200);

    expect(body).toHaveProperty('conversation_id', conversationId);
    expect(body).toHaveProperty('topic');
    expect(body).toHaveProperty('description');
    expect(body).toHaveProperty('created');
    expect(body).toHaveProperty('vis_type');
    expect(body).toHaveProperty('write_type');
    expect(body).toHaveProperty('help_type');
    expect(body).toHaveProperty('socialbtn_type');
    expect(body).toHaveProperty('bgcolor');
    expect(body).toHaveProperty('help_color');
    expect(body).toHaveProperty('help_bgcolor');
    expect(body).toHaveProperty('style_btn');
    expect(body).toHaveProperty('auth_needed_to_vote', false);
    expect(body).toHaveProperty('auth_needed_to_write', false);
    expect(body).toHaveProperty('auth_opt_allow_3rdparty', true);
  });

  test('GET /api/v3/conversations/preload - should return 500 with invalid conversation_id', async () => {
    const response = await textAgent.get('/api/v3/conversations/preload?conversation_id=invalid_id');

    // Should return error response
    expect(response.status).toBe(500);
    expect(response.text).toContain('polis_err_get_conversation_preload_info');
  });

  test('GET /api/v3/conversations/preload - should return 500 with non-existent conversation_id', async () => {
    const response = await textAgent.get('/api/v3/conversations/preload?conversation_id=99999999');

    // Should return error response
    expect(response.status).toBe(500);
    expect(response.text).toContain('polis_err_get_conversation_preload_info');
  });

  test('GET /api/v3/conversations/preload - should require conversation_id parameter', async () => {
    const response = await textAgent.get('/api/v3/conversations/preload');

    // Should return error response
    expect(response.status).toBe(400);
    expect(response.text).toContain('polis_err_param_missing_conversation_id');
  });
});
