import { afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import request from 'supertest';
import {
  API_PREFIX,
  API_URL,
  attachAuthToken,
  generateRandomXid,
  initializeParticipant,
  initializeParticipantWithXid,
  setupAuthForTest
} from '../setup/api-test-helpers.js';
import { rollbackTransaction, startTransaction } from '../setup/db-test-helpers.js';

describe('Participation Endpoints', () => {
  let authToken = null;
  let conversationZinvite = null;
  let client = null;
  const testXid = generateRandomXid();

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
    // Setup auth and create test conversation with comments
    const setup = await setupAuthForTest({
      commentCount: 3
    });

    authToken = setup.authToken;
    conversationZinvite = setup.conversationZinvite;
  }, 15000);

  test('Regular participation lifecycle', async () => {
    // STEP 1: Initialize anonymous participant
    const { body, cookies, status } = await initializeParticipant(conversationZinvite);

    expect(status).toBe(200);
    expect(cookies).toBeDefined();
    expect(cookies.length).toBeGreaterThan(0);
    expect(body).toBeDefined();

    // STEP 2: Get next comment for participant
    const nextCommentResponse = await request(API_URL)
      .get(`${API_PREFIX}/nextComment?conversation_id=${conversationZinvite}`)
      .set('Cookie', cookies);

    expect(nextCommentResponse.status).toBe(200);
    expect(nextCommentResponse.body).toBeDefined();
  });

  test('XID participation lifecycle', async () => {
    // STEP 1: Initialize participation with XID
    const { body, cookies, status } = await initializeParticipantWithXid(conversationZinvite, testXid);

    expect(status).toBe(200);
    expect(cookies).toBeDefined();
    expect(cookies.length).toBeGreaterThan(0);
    expect(body).toBeDefined();

    // STEP 2: Get next comment for participant
    const nextCommentResponse = await request(API_URL)
      .get(`${API_PREFIX}/nextComment?conversation_id=${conversationZinvite}&xid=${testXid}`)
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
