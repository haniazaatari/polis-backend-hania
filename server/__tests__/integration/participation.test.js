import { beforeAll, describe, expect, test } from '@jest/globals';
import request from 'supertest';
import {
  API_PREFIX,
  API_URL,
  attachAuthToken,
  generateRandomXid,
  initializeParticipant,
  initializeParticipantWithXid,
  setupAuthAndConvo
} from '../setup/api-test-helpers.js';

describe('Participation Endpoints', () => {
  let authToken = null;
  let conversationId = null;
  const testXid = generateRandomXid();

  beforeAll(async () => {
    // Setup auth and create test conversation with comments
    const setup = await setupAuthAndConvo({
      commentCount: 3
    });

    authToken = setup.authToken;
    conversationId = setup.conversationId;
  }, 15000);

  test('Regular participation lifecycle', async () => {
    // STEP 1: Initialize anonymous participant
    const { body, cookies, status } = await initializeParticipant(conversationId);

    expect(status).toBe(200);
    expect(cookies).toBeDefined();
    expect(cookies.length).toBeGreaterThan(0);
    expect(body).toBeDefined();

    // STEP 2: Get next comment for participant
    const nextCommentResponse = await request(API_URL)
      .get(`${API_PREFIX}/nextComment?conversation_id=${conversationId}`)
      .set('Cookie', cookies);

    expect(nextCommentResponse.status).toBe(200);
    expect(nextCommentResponse.body).toBeDefined();
  });

  test('XID participation lifecycle', async () => {
    // STEP 1: Initialize participation with XID
    const { body, cookies, status } = await initializeParticipantWithXid(conversationId, testXid);

    expect(status).toBe(200);
    expect(cookies).toBeDefined();
    expect(cookies.length).toBeGreaterThan(0);
    expect(body).toBeDefined();

    // STEP 2: Get next comment for participant
    const nextCommentResponse = await request(API_URL)
      .get(`${API_PREFIX}/nextComment?conversation_id=${conversationId}&xid=${testXid}`)
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
