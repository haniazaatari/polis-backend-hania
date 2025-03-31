import { beforeAll, describe, expect, test } from '@jest/globals';
import {
  createConversation,
  createHmacSignature,
  generateTestUser,
  newTextAgent,
  registerAndLoginUser
} from '../setup/api-test-helpers.js';

describe('Notification Subscription API', () => {
  let conversationId;
  let agent;
  let textAgent;
  let testUser;

  beforeAll(async () => {
    // Create an authenticated user and conversation
    testUser = generateTestUser();
    const auth = await registerAndLoginUser(testUser);
    agent = auth.agent;
    textAgent = auth.textAgent;

    // Create a conversation for testing
    conversationId = await createConversation(agent);
  });

  test('GET /notifications/subscribe - should handle signature validation', async () => {
    const email = testUser.email;
    const signature = createHmacSignature(email, conversationId);

    // Using textAgent to handle text response properly
    const response = await textAgent.get('/api/v3/notifications/subscribe').query({
      signature,
      conversation_id: conversationId,
      email
    });

    // We now expect success since we're using the correct HMAC generation
    expect(response.status).toBe(200);
    expect(response.text).toContain('Subscribed!');
  });

  test('GET /notifications/unsubscribe - should handle signature validation', async () => {
    const email = testUser.email;
    const signature = createHmacSignature(email, conversationId, 'api/v3/notifications/unsubscribe');

    // Using textAgent to handle text response properly
    const response = await textAgent.get('/api/v3/notifications/unsubscribe').query({
      signature,
      conversation_id: conversationId,
      email
    });

    // We now expect success since we're using the correct path and key
    expect(response.status).toBe(200);
    expect(response.text).toContain('Unsubscribed');
  });

  test('POST /convSubscriptions - should allow subscribing to conversation updates', async () => {
    const response = await agent.post('/api/v3/convSubscriptions').send({
      conversation_id: conversationId,
      email: testUser.email,
      type: 1 // Subscription type (1 = updates)
    });

    expect(response.status).toBe(200);

    // Subscription confirmation should be returned
    expect(response.body).toEqual({ subscribed: 1 });
  });

  test('POST /convSubscriptions - authentication behavior (currently not enforced)', async () => {
    // Create unauthenticated agent
    const unauthAgent = newTextAgent();

    const response = await unauthAgent.post('/api/v3/convSubscriptions').send({
      conversation_id: conversationId,
      email: testUser.email,
      type: 1
    });

    // The API gives a 500 error when the user is not authenticated
    expect(response.status).toBe(500);
    expect(response.text).toMatch(/polis_err_auth_token_not_supplied/);
  });

  test('POST /convSubscriptions - should validate required parameters', async () => {
    // Test missing email
    const missingEmailResponse = await agent.post('/api/v3/convSubscriptions').send({
      conversation_id: conversationId,
      type: 1
    });

    expect(missingEmailResponse.status).toBe(400);
    expect(missingEmailResponse.text).toMatch(/polis_err_param_missing_email/);

    // Test missing conversation_id
    const missingConvoResponse = await agent.post('/api/v3/convSubscriptions').send({
      email: testUser.email,
      type: 1
    });

    expect(missingConvoResponse.status).toBe(400);
    expect(missingConvoResponse.text).toMatch(/polis_err_param_missing_conversation_id/);

    // Test missing type
    const missingTypeResponse = await agent.post('/api/v3/convSubscriptions').send({
      conversation_id: conversationId,
      email: testUser.email
    });

    expect(missingTypeResponse.status).toBe(400);
    expect(missingTypeResponse.text).toMatch(/polis_err_param_missing_type/);
  });
});
