import { beforeAll, describe, expect, test } from '@jest/globals';
import { initializeParticipant, makeRequest, setupAuthAndConvo, submitVote } from '../setup/api-test-helpers.js';

describe('Next Comment Endpoint', () => {
  let authToken = null;
  let conversationId = null;
  let commentIds = [];

  beforeAll(async () => {
    // Setup auth and create test conversation with multiple comments
    const setup = await setupAuthAndConvo({
      createConvo: true,
      commentCount: 5
    });

    authToken = setup.authToken;
    conversationId = setup.conversationId;
    commentIds = setup.commentIds;

    // Ensure we have comments to work with
    expect(commentIds.length).toBe(5);
  });

  test('GET /nextComment - Get next comment for voting', async () => {
    // Request the next comment for voting
    const response = await makeRequest('GET', `/nextComment?conversation_id=${conversationId}`, null, authToken);

    // Validate response
    expect(response.status).toBe(200);
    expect(response.body).toBeDefined();

    // The response should have a tid (comment ID) and txt (comment text)
    expect(response.body.tid).toBeDefined();
    expect(response.body.txt).toBeDefined();

    // The returned comment should be one of our test comments
    expect(commentIds).toContain(response.body.tid);
  });

  test('GET /nextComment - Anonymous users can get next comment', async () => {
    // Initialize anonymous participant
    const { cookies } = await initializeParticipant(conversationId);

    // Request next comment as anonymous user
    const { body, status } = await makeRequest('GET', `/nextComment?conversation_id=${conversationId}`, null, cookies);

    // Validate response
    expect(status).toBe(200);
    expect(body).toBeDefined();
    expect(body.tid).toBeDefined();
    expect(body.txt).toBeDefined();
  });

  test('GET /nextComment - Respect not_voted_by_pid parameter', async () => {
    const [commentId] = commentIds;
    // Initialize a new participant
    const { cookies: initCookies, body: initBody } = await initializeParticipant(conversationId);
    expect(initBody.nextComment).toBeDefined();
    const { nextComment: firstComment } = initBody;

    // Submit vote to get auth token
    const firstVoteResponse = await submitVote(
      {
        tid: firstComment.tid,
        conversation_id: conversationId
      },
      initCookies
    );
    expect(firstVoteResponse.status).toBe(200);
    expect(firstVoteResponse.body).toHaveProperty('currentPid');

    const { cookies } = firstVoteResponse;
    const { currentPid: firstVoterPid, nextComment: secondComment } = firstVoteResponse.body;

    // Vote on 3 more comments
    const {
      body: { nextComment: thirdComment }
    } = await submitVote(
      {
        tid: secondComment.tid,
        conversation_id: conversationId
      },
      cookies
    );

    const {
      body: { nextComment: fourthComment }
    } = await submitVote(
      {
        tid: thirdComment.tid,
        conversation_id: conversationId
      },
      cookies
    );

    const {
      body: { nextComment: lastComment }
    } = await submitVote(
      {
        tid: fourthComment.tid,
        conversation_id: conversationId
      },
      cookies
    );

    // Initialize a new participant
    const { cookies: newInitCookies } = await initializeParticipant(conversationId);

    // Get next comment
    const nextResponse = await makeRequest(
      'GET',
      `/nextComment?conversation_id=${conversationId}&not_voted_by_pid=${firstVoterPid}`,
      null,
      newInitCookies
    );

    // Validate response - should return the comment not voted on by the first participant
    expect(nextResponse.status).toBe(200);
    expect(nextResponse.body).toBeDefined();
    expect(nextResponse.body.tid).toBe(lastComment.tid);
  });

  test('GET /nextComment - 400 for missing conversation_id', async () => {
    // Request without required conversation_id
    const response = await makeRequest('GET', '/nextComment', null, authToken);

    // Validate response
    expect(response.status).toBe(400);
    expect(response.text).toMatch(/polis_err_param_missing_conversation_id/);
  });

  test('GET /nextComment - Handles `without` parameter', async () => {
    const withoutCommentIds = commentIds.slice(1, 4);

    // Request next comment without comments 1-4
    const response = await makeRequest(
      'GET',
      `/nextComment?conversation_id=${conversationId}&without=${withoutCommentIds}`,
      null,
      authToken
    );

    // Validate response is the last comment
    expect(response.status).toBe(200);
    expect(response.body.tid).toBe(commentIds[4]);
    expect(withoutCommentIds).not.toContain(response.body.tid);
  });
});
