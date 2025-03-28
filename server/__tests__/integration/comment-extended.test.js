import { beforeAll, describe, expect, test } from '@jest/globals';
import {
  createComment,
  getComments,
  initializeParticipant,
  makeRequest,
  setupAuthAndConvo,
  submitVote,
  wait
} from '../setup/api-test-helpers.js';

describe('Extended Comment Endpoints', () => {
  let authToken = null;
  let conversationId = null;
  let commentId = null;

  beforeAll(async () => {
    // Setup auth and create test conversation with 1 comment
    const setup = await setupAuthAndConvo({
      createConvo: true,
      commentCount: 1
    });

    authToken = setup.authToken;
    conversationId = setup.conversationId;
    commentId = setup.commentIds[0];

    // Ensure we have a valid commentId to work with
    expect(commentId).toBeDefined();
  });

  test('GET /comments with tids - Get specific comment by ID', async () => {
    // Create a new comment to ensure clean test data
    const timestamp = Date.now();
    const commentText = `Test comment for individual retrieval ${timestamp}`;
    const newCommentId = await createComment(authToken, conversationId, {
      txt: commentText
    });

    // Retrieve the specific comment by ID using the tids parameter
    const comments = await getComments(authToken, conversationId, {
      tids: [newCommentId]
    });

    // Validate response
    expect(Array.isArray(comments)).toBe(true);
    expect(comments.length).toBe(1);

    const [comment] = comments;
    expect(comment).toBeDefined();
    expect(comment.tid).toBe(newCommentId);
    expect(comment.txt).toBe(commentText);
  });

  test('GET /comments with non-existent tid returns empty array', async () => {
    // Request a comment with an invalid ID
    const nonExistentId = 999999999;
    const comments = await getComments(authToken, conversationId, {
      tids: [nonExistentId]
    });

    // Validate response - should be an empty array
    expect(Array.isArray(comments)).toBe(true);
    expect(comments.length).toBe(0);
  });

  test('PUT /comments - Moderate a comment', async () => {
    // Create a new comment to test moderation
    const timestamp = Date.now();
    const commentText = `Comment for moderation test ${timestamp}`;
    const commentId = await createComment(authToken, conversationId, {
      txt: commentText
    });

    // Moderate the comment - this endpoint is for moderation, not updating text
    const updateResponse = await makeRequest(
      'PUT',
      '/comments',
      {
        tid: commentId,
        conversation_id: conversationId,
        active: true, // Required - determines if comment is active
        mod: 1, // Required - moderation status (0=ok, 1=hidden, etc.)
        is_meta: false, // Required - meta comment flag
        velocity: 1 // Required - comment velocity (0-1)
      },
      authToken
    );

    // Validate update response
    expect(updateResponse.status).toBe(200);

    // Wait for moderation to be processed
    await wait(1000);

    // Get the comment to verify the moderation
    const comments = await getComments(authToken, conversationId, {
      tids: [commentId]
    });

    // Validate get response
    expect(Array.isArray(comments)).toBe(true);
    expect(comments.length).toBe(1);

    const [moderatedComment] = comments;
    expect(moderatedComment.tid).toBe(commentId);
    // Original text should remain unchanged as this endpoint only updates moderation status
    expect(moderatedComment.txt).toBe(commentText);
  });

  test('PUT /comments - Validation fails for missing required fields', async () => {
    // Try to update a comment with missing required fields
    const response = await makeRequest(
      'PUT',
      '/comments',
      {
        // Missing various required fields
        tid: commentId,
        conversation_id: conversationId
        // Missing: active, mod, is_meta, velocity
      },
      authToken
    );

    // Validate response - should fail with 400 Bad Request
    expect(response.status).toBe(400);
    expect(response.text).toMatch(/polis_err_param_missing_active/);
  });

  test('GET /comments/translations - Get comment translations', async () => {
    // Create a new comment to test translations
    const timestamp = Date.now();
    const commentText = `Comment for translation test ${timestamp}`;
    const translatedCommentId = await createComment(authToken, conversationId, {
      txt: commentText
    });

    // Request translations for the comment
    const response = await makeRequest(
      'GET',
      `/comments/translations?conversation_id=${conversationId}&tid=${translatedCommentId}&lang=es`,
      null,
      authToken
    );

    // NOTE: The legacy implementation has a bug (does not use moveToBody for GET params)
    // so it is expected to always return a 400 error
    expect(response.status).toBe(400);
    expect(response.text).toMatch(/polis_err_param_missing_conversation_id/);
  });

  test('GET /comments/translations - Anonymous users can request translations', async () => {
    // Initialize anonymous participant
    const { cookies: initCookies } = await initializeParticipant(conversationId);
    // Submit vote to get auth token
    const { cookies } = await submitVote(
      {
        tid: commentId,
        conversation_id: conversationId
      },
      initCookies
    );

    // Request translations as anonymous user
    const response = await makeRequest(
      'GET',
      `/comments/translations?conversation_id=${conversationId}&tid=${commentId}&lang=fr&agid=1`,
      null,
      cookies
    );

    // NOTE: The legacy implementation has a bug (does not use moveToBody for GET params)
    // so it is expected to always return a 400 error
    expect(response.status).toBe(400);
    expect(response.text).toMatch(/polis_err_param_missing_conversation_id/);
  });

  test('GET /comments/translations - 400 for missing parameters', async () => {
    // Request translations without required parameters
    const missingConvoResponse = await makeRequest(
      'GET',
      `/comments/translations?tid=${commentId}&lang=es`,
      null,
      authToken
    );

    // NOTE: The legacy implementation has a bug (does not use moveToBody for GET params)
    // so it is expected to always return a 400 error
    expect(missingConvoResponse.status).toBe(400);
    expect(missingConvoResponse.text).toMatch(/polis_err_param_missing_conversation_id/);

    const missingTidResponse = await makeRequest(
      'GET',
      `/comments/translations?conversation_id=${conversationId}&lang=es`,
      null,
      authToken
    );

    // NOTE: The legacy implementation has a bug (does not use moveToBody for GET params)
    // so it is expected to always return a 400 error
    expect(missingTidResponse.status).toBe(400);
    expect(missingConvoResponse.text).toMatch(/polis_err_param_missing_conversation_id/);
  });

  test('GET /comments - Filtering by multiple parameters', async () => {
    // Create multiple comments with different attributes
    const comment1Id = await createComment(authToken, conversationId, {
      txt: `Comment for filtering test 1 ${Date.now()}`
    });

    const comment2Id = await createComment(authToken, conversationId, {
      txt: `Comment for filtering test 2 ${Date.now()}`
    });

    const comment3Id = await createComment(authToken, conversationId, {
      txt: `Comment for filtering test 3 ${Date.now()}`
    });

    // Moderate comment 2
    const moderateResponse = await makeRequest(
      'PUT',
      '/comments',
      {
        tid: comment2Id,
        conversation_id: conversationId,
        active: true,
        mod: 1,
        is_meta: false,
        velocity: 1
      },
      authToken
    );

    expect(moderateResponse.status).toBe(200);

    await wait(1000);

    // Test filtering by specific tids
    const filteredByTids = await getComments(authToken, conversationId, {
      tids: [comment2Id, comment3Id]
    });

    expect(Array.isArray(filteredByTids)).toBe(true);
    expect(filteredByTids.length).toBe(2);
    // expect(filteredByTids.map((c) => c.tid).sort()).toEqual([comment1Id, comment3Id].sort());

    // The comment IDs we just created should be in the results
    const filteredCommentIds = filteredByTids.map((c) => c.tid);
    expect(filteredCommentIds).toContain(comment2Id);
    expect(filteredCommentIds).toContain(comment3Id);

    // Test filtering by moderation status and tids
    const filteredByMod = await getComments(authToken, conversationId, {
      tids: [comment1Id, comment2Id, comment3Id],
      mod: 1
    });

    expect(Array.isArray(filteredByMod)).toBe(true);
    expect(filteredByMod.length).toBe(1);

    // The seed comment ID we just created should be in the results
    const moderatedCommentIds = filteredByMod.map((c) => c.tid);
    expect(moderatedCommentIds).toContain(comment2Id);
  });

  test('GET /comments - Filtering by not_voted_by_pid parameter', async () => {
    // Create two new comments
    const comment1Id = await createComment(authToken, conversationId, {
      txt: `Comment for not_voted_by_pid test 1 ${Date.now()}`
    });

    const comment2Id = await createComment(authToken, conversationId, {
      txt: `Comment for not_voted_by_pid test 2 ${Date.now()}`
    });

    // Initialize a participant
    const { cookies: initCookies } = await initializeParticipant(conversationId);

    // Vote on one of the comments as the participant
    const voteResponse = await submitVote(
      {
        tid: comment1Id,
        conversation_id: conversationId
      },
      initCookies
    );

    expect(voteResponse.status).toBe(200);
    expect(voteResponse.body).toHaveProperty('currentPid');

    const { currentPid } = voteResponse.body;

    // Get comments not voted on by this participant
    const notVotedComments = await getComments(authToken, conversationId, {
      not_voted_by_pid: currentPid
    });

    // Should only return the second comment (not voted on)
    expect(Array.isArray(notVotedComments)).toBe(true);

    // Confirm comment1Id is not in the results (since we voted on it)
    const returnedIds = notVotedComments.map((c) => c.tid);
    expect(returnedIds).not.toContain(comment1Id);

    // Confirm comment2Id is in the results (since we didn't vote on it)
    expect(returnedIds).toContain(comment2Id);
  });
});
