import { afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import request from 'supertest';
import {
  API_PREFIX,
  API_URL,
  createTestComment,
  createTestConversation,
  generateTestUser,
  getMyVotes,
  getVotes,
  initializeParticipant,
  submitVote
} from '../setup/api-test-helpers.js';
import { rollbackTransaction, startTransaction } from '../setup/db-test-helpers.js';

describe('Vote Endpoints', () => {
  let ownerAuthToken = null;
  let voterAuthToken = null;
  let conversationId = null;
  let conversationZinvite = null;
  let commentId = null;
  let client = null;
  const ownerUser = generateTestUser();
  const voterUser = generateTestUser();

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
    // Register the conversation owner/comment creator
    const ownerRegisterResponse = await request(API_URL).post(`${API_PREFIX}/auth/new`).send({
      email: ownerUser.email,
      password: ownerUser.password,
      hname: ownerUser.hname,
      gatekeeperTosPrivacy: true
    });

    expect(ownerRegisterResponse.status).toBe(200);
    expect(ownerRegisterResponse.body).toHaveProperty('uid');

    // Login as owner
    const ownerLoginResponse = await request(API_URL).post(`${API_PREFIX}/auth/login`).send({
      email: ownerUser.email,
      password: ownerUser.password
    });

    expect(ownerLoginResponse.status).toBe(200);

    // Extract owner's auth token
    if (ownerLoginResponse.headers['x-polis']) {
      ownerAuthToken = ownerLoginResponse.headers['x-polis'];
    } else {
      throw new Error('No auth token found in owner login response');
    }

    // Register the voter (separate user)
    const voterRegisterResponse = await request(API_URL).post(`${API_PREFIX}/auth/new`).send({
      email: voterUser.email,
      password: voterUser.password,
      hname: voterUser.hname,
      gatekeeperTosPrivacy: true
    });

    expect(voterRegisterResponse.status).toBe(200);
    expect(voterRegisterResponse.body).toHaveProperty('uid');

    // Login as voter
    const voterLoginResponse = await request(API_URL).post(`${API_PREFIX}/auth/login`).send({
      email: voterUser.email,
      password: voterUser.password
    });

    expect(voterLoginResponse.status).toBe(200);

    // Extract voter's auth token
    if (voterLoginResponse.headers['x-polis']) {
      voterAuthToken = voterLoginResponse.headers['x-polis'];
    } else {
      throw new Error('No auth token found in voter login response');
    }

    // Create a test conversation as owner
    const conversation = await createTestConversation(ownerAuthToken);
    expect(conversation).toBeDefined();
    expect(conversation.zid).toBeDefined();
    expect(conversation.zinvite).toBeDefined();

    conversationId = conversation.zid;
    conversationZinvite = conversation.zinvite;

    // Create test comments as owner
    commentId = await createTestComment(ownerAuthToken, conversationZinvite);
    expect(commentId).toBeDefined();
    await createTestComment(ownerAuthToken, conversationZinvite);
    await createTestComment(ownerAuthToken, conversationZinvite);
  }, 30000); // Increase timeout for setup

  test('Vote lifecycle for authenticated user', async () => {
    // STEP 1: Submit a vote as voter (not comment creator)
    const voteResponse = await submitVote(
      {
        tid: commentId,
        vote: 1, // Agree
        conversation_id: conversationZinvite
      },
      voterAuthToken
    );

    expect(voteResponse.status).toBe(200);
    expect(voteResponse.body).toBeDefined();
    const { currentPid, nextComment } = voteResponse.body;
    expect(nextComment).toBeDefined();
    expect(currentPid).toBeDefined();

    // STEP 2: Verify vote appears in voter's votes
    // NOTE: The legacy implementation returns an empty array.
    const myVotes = await getMyVotes(voterAuthToken, conversationZinvite, currentPid);
    expect(Array.isArray(myVotes)).toBe(true);

    // STEP 3: Verify vote appears in conversation votes
    const votes = await getVotes(voterAuthToken, conversationZinvite, currentPid);
    expect(Array.isArray(votes)).toBe(true);
    expect(votes.length).toBe(1);
    expect(votes[0].tid).toBe(commentId);
    expect(votes[0].vote).toBe(1);
  });

  test('Vote lifecycle for anonymous participant', async () => {
    // STEP 1: Initialize anonymous participant
    const { cookies, body: initBody } = await initializeParticipant(conversationZinvite);
    expect(cookies).toBeDefined();
    expect(cookies.length).toBeGreaterThan(0);
    expect(initBody).toBeDefined();

    // STEP 2: Submit vote as anonymous participant
    const voteResponse = await submitVote(
      {
        tid: commentId,
        vote: -1, // Disagree
        conversation_id: conversationZinvite
      },
      cookies
    );

    expect(voteResponse.status).toBe(200);
    expect(voteResponse.body).toBeDefined();
    const { currentPid, nextComment } = voteResponse.body;
    expect(currentPid).toBeDefined();
    expect(nextComment).toBeDefined();

    // STEP 3: Verify anonymous vote appears in conversation votes
    const votes = await getVotes(cookies, conversationZinvite, currentPid);
    expect(Array.isArray(votes)).toBe(true);
    expect(votes.length).toBe(1);
    expect(votes[0].tid).toBe(commentId);
    expect(votes[0].vote).toBe(-1);
  });

  test('Vote validation', async () => {
    // Test invalid comment ID
    const invalidCommentResponse = await submitVote(
      {
        tid: 999999,
        vote: 1,
        conversation_id: conversationZinvite
      },
      voterAuthToken
    );
    const { body: invalidCommentBody, status: invalidCommentStatus } = invalidCommentResponse;
    // Note: The legacy implementation returns a 200 status with a nextComment.
    expect(invalidCommentStatus).toBe(200);
    expect(invalidCommentBody.nextComment).toBeDefined();

    // Test invalid conversation ID
    const invalidConvResponse = await submitVote(
      {
        tid: commentId,
        vote: 1,
        conversation_id: 'invalid-conversation'
      },
      voterAuthToken
    );
    const { body: invalidConvBody, status: invalidConvStatus } = invalidConvResponse;
    // Note: The legacy implementation returns a 400 status with an empty body.
    expect(invalidConvStatus).toBe(400);
    expect(invalidConvBody).toStrictEqual({});

    // Test invalid vote value
    const invalidVoteResponse = await submitVote(
      {
        tid: commentId,
        vote: 5, // Only -1, 0, 1 are valid
        conversation_id: conversationZinvite
      },
      voterAuthToken
    );
    const { body: invalidVoteBody, status: invalidVoteStatus } = invalidVoteResponse;
    // Note: The legacy implementation returns a 400 status with an empty body.
    expect(invalidVoteStatus).toBe(400);
    expect(invalidVoteBody).toStrictEqual({});

    // Test missing required fields
    const missingFieldsResponse = await request(API_URL)
      .post(`${API_PREFIX}/votes`)
      .set('x-polis', voterAuthToken)
      .send({});
    const { body: missingFieldsBody, status: missingFieldsStatus } = missingFieldsResponse;
    // Note: The legacy implementation returns a 400 status with an empty body.
    expect(missingFieldsStatus).toBe(400);
    expect(missingFieldsBody).toStrictEqual({});
  });

  test('Vote modification', async () => {
    // STEP 1: Submit initial vote
    const { body: initialVoteBody, status: initialVoteStatus } = await submitVote(
      {
        tid: commentId,
        vote: 1,
        conversation_id: conversationZinvite
      },
      voterAuthToken
    );
    expect(initialVoteStatus).toBe(200);
    expect(initialVoteBody).toBeDefined();
    const { currentPid } = initialVoteBody;
    expect(currentPid).toBeDefined();

    // STEP 2: Change vote
    const { status: changedVoteStatus } = await submitVote(
      {
        tid: commentId,
        vote: -1,
        conversation_id: conversationZinvite
      },
      voterAuthToken
    );
    expect(changedVoteStatus).toBe(200);

    // STEP 3: Verify vote was changed
    const myVotes = await getVotes(voterAuthToken, conversationZinvite, currentPid);
    expect(Array.isArray(myVotes)).toBe(true);
    const userVote = myVotes.find((v) => v.tid === commentId);
    expect(userVote).toBeDefined();
    expect(userVote.vote).toBe(-1);
  });
});
