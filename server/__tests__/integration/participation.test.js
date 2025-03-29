import { beforeAll, describe, expect, test } from '@jest/globals';
import {
  generateRandomXid,
  getTestAgent,
  initializeParticipant,
  initializeParticipantWithXid,
  setupAuthAndConvo
} from '../setup/api-test-helpers.js';

describe('Participation Endpoints', () => {
  // Access the global agents
  const agent = getTestAgent();
  const testXid = generateRandomXid();
  let conversationId;

  beforeAll(async () => {
    // Setup auth and create test conversation with comments
    const setup = await setupAuthAndConvo({
      commentCount: 3
    });

    conversationId = setup.conversationId;
  }, 15000);

  test('Regular participation lifecycle', async () => {
    // STEP 1: Initialize anonymous participant
    const { agent: anonAgent, body, cookies, status } = await initializeParticipant(conversationId);

    expect(status).toBe(200);
    expect(cookies).toBeDefined();
    expect(cookies.length).toBeGreaterThan(0);
    expect(body).toBeDefined();

    // STEP 2: Get next comment for participant
    const nextCommentResponse = await anonAgent.get(`/api/v3/nextComment?conversation_id=${conversationId}`);

    expect(nextCommentResponse.status).toBe(200);
    expect(JSON.parse(nextCommentResponse.text)).toBeDefined();
  });

  test('XID participation lifecycle', async () => {
    // STEP 1: Initialize participation with XID
    const { agent: xidAgent, body, cookies, status } = await initializeParticipantWithXid(conversationId, testXid);

    expect(status).toBe(200);
    expect(cookies).toBeDefined();
    expect(cookies.length).toBeGreaterThan(0);
    expect(body).toBeDefined();

    // STEP 2: Get next comment for participant
    const nextCommentResponse = await xidAgent.get(
      `/api/v3/nextComment?conversation_id=${conversationId}&xid=${testXid}`
    );

    expect(nextCommentResponse.status).toBe(200);
    expect(JSON.parse(nextCommentResponse.text)).toBeDefined();
  });

  test('Participation validation', async () => {
    // Test missing conversation ID in participation
    const missingConvResponse = await agent.get('/api/v3/participation');
    expect(missingConvResponse.status).toBe(400);

    // Test missing conversation ID in participationInit
    const missingConvInitResponse = await agent.get('/api/v3/participationInit');
    expect(missingConvInitResponse.status).toBe(200);
    const responseBody = JSON.parse(missingConvInitResponse.text);
    expect(responseBody).toBeDefined();
    expect(responseBody.conversation).toBeNull();
  });
});
