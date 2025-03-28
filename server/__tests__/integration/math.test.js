import { beforeAll, describe, expect, test } from '@jest/globals';
import { initializeParticipant, makeRequest, setupAuthAndConvo, submitVote, wait } from '../setup/api-test-helpers.js';

const NUM_PARTICIPANTS = 5;
const NUM_COMMENTS = 5;

describe('Math and Analysis Endpoints', () => {
  let authToken = null;
  let conversationId = null;
  let commentIds = [];
  const participantCookies = [];

  beforeAll(async () => {
    // Setup conversation with comments and votes to have data for analysis
    const setup = await setupAuthAndConvo({
      createConvo: true,
      commentCount: NUM_COMMENTS
    });

    authToken = setup.authToken;
    conversationId = setup.conversationId;
    commentIds = setup.commentIds;

    // Create 5 participants and have them vote on comments
    for (let i = 0; i < NUM_PARTICIPANTS; i++) {
      let cookies = null;
      let pid = 'mypid';
      // Initialize a participant
      const { cookies: initCookies } = await initializeParticipant(conversationId);
      participantCookies.push(initCookies);
      cookies = initCookies;

      // Have each participant vote on several comments with different patterns
      // This creates a dataset that can be analyzed
      for (let j = 0; j < NUM_COMMENTS; j++) {
        // Different voting patterns for different participants
        const vote = ((i + j) % 3) - 1; // -1, 0, or 1

        const {
          cookies: voteCookies,
          body: { currentPid }
        } = await submitVote(
          {
            tid: commentIds[j],
            conversation_id: conversationId,
            vote: vote,
            pid: pid
          },
          cookies
        );
        cookies = voteCookies;
        pid = currentPid;
      }
    }

    // Wait for all votes to be processed
    await wait(1000);
  }, 60000);

  test('GET /math/pca2 - Get Principal Component Analysis', async () => {
    // Request PCA results for the conversation
    // The response will be automatically decompressed by our enhanced makeRequest
    const { body, status } = await makeRequest('GET', `/math/pca2?conversation_id=${conversationId}`, null, authToken);

    // Validate response
    expect(status).toBe(200);
    expect(body).toBeDefined();

    // The response has been decompressed and parsed from gzip
    if (body) {
      expect(body.pca).toBeDefined();
      const { pca } = body;

      // Check that the body has the expected fields
      expect(body.consensus).toBeDefined();
      expect(body.lastModTimestamp).toBeDefined();
      expect(body.lastVoteTimestamp).toBeDefined();
      expect(body.math_tick).toBeDefined();
      expect(body.n).toBeDefined();
      expect(body.pca).toBeDefined();
      expect(body.repness).toBeDefined();
      expect(body.tids).toBeDefined();
      expect(body['base-clusters']).toBeDefined();
      expect(body['comment-priorities']).toBeDefined();
      expect(body['group-aware-consensus']).toBeDefined();
      expect(body['group-clusters']).toBeDefined();
      expect(body['group-votes']).toBeDefined();
      expect(body['in-conv']).toBeDefined();
      expect(body['meta-tids']).toBeDefined();
      expect(body['mod-in']).toBeDefined();
      expect(body['mod-out']).toBeDefined();
      expect(body['n-cmts']).toBeDefined();
      expect(body['user-vote-counts']).toBeDefined();
      expect(body['votes-base']).toBeDefined();

      // Check that the PCA results are defined
      expect(pca.center).toBeDefined();
      expect(pca.comps).toBeDefined();
      expect(pca['comment-extremity']).toBeDefined();
      expect(pca['comment-projection']).toBeDefined();
    }
  });

  // Requires Report ID to exist first.
  // TODO: Revisit this after Reports have been covered in tests.
  test.skip('GET /math/correlationMatrix - Get correlation matrix', async () => {
    // Request correlation matrix for the conversation
    const response = await makeRequest(
      'GET',
      `/math/correlationMatrix?conversation_id=${conversationId}`,
      null,
      authToken
    );

    // Validate response
    expect(response.status).toBe(200);
    expect(response.body).toBeDefined();

    // Correlation matrix should be an array or object with correlation data
    if (response.body) {
      // Check for structure - could be:
      // 1. A 2D array/matrix
      // 2. An object with correlation data
      // 3. An object with a matrix property

      const hasCorrelationData = Array.isArray(response.body) || response.body.matrix || response.body.correlations;

      expect(hasCorrelationData).toBeTruthy();
    }
  });

  test('Math endpoints - Return 400 for missing conversation_id', async () => {
    // Request PCA without conversation_id
    const pcaResponse = await makeRequest('GET', '/math/pca2', null, authToken);

    expect(pcaResponse.status).toBe(400);
    expect(pcaResponse.text).toMatch(/polis_err_param_missing_conversation_id/);

    // Request correlation matrix without report_id
    const corrResponse = await makeRequest(
      'GET',
      `/math/correlationMatrix?conversation_id=${conversationId}`,
      null,
      authToken
    );

    expect(corrResponse.status).toBe(400);
    expect(corrResponse.text).toMatch(/polis_err_param_missing_report_id/);
  });

  test('Math endpoints - Return appropriate error for invalid conversation_id', async () => {
    const invalidId = 'nonexistent-conversation-id';

    // Request PCA with invalid conversation_id
    const pcaResponse = await makeRequest('GET', `/math/pca2?conversation_id=${invalidId}`, null, authToken);

    // Should return an error status
    expect(pcaResponse.status).toBeGreaterThanOrEqual(400);
    expect(pcaResponse.text).toMatch(/polis_err_param_parse_failed_conversation_id/);
    expect(pcaResponse.text).toMatch(/polis_err_fetching_zid_for_conversation_id/);

    // Request correlation matrix with invalid report_id
    const corrResponse = await makeRequest('GET', `/math/correlationMatrix?report_id=${invalidId}`, null, authToken);

    // Should return an error status
    expect(corrResponse.status).toBeGreaterThanOrEqual(400);
    expect(corrResponse.text).toMatch(/polis_err_param_parse_failed_report_id/);
    expect(corrResponse.text).toMatch(/polis_err_fetching_rid_for_report_id/);
  });

  test('Math endpoints - Require sufficient data for meaningful analysis', async () => {
    // Create a new empty conversation
    const { conversationId: emptyConvoId } = await setupAuthAndConvo();

    // Request PCA for empty conversation
    const { body, status } = await makeRequest('GET', `/math/pca2?conversation_id=${emptyConvoId}`, null, authToken);

    expect(status).toBe(304);
    expect(body).toBe('');

    // TODO: Request correlation matrix for empty conversation
  });

  test('Math endpoints - Support math_tick parameter', async () => {
    // Request PCA with math_tick parameter
    const pcaResponse = await makeRequest(
      'GET',
      `/math/pca2?conversation_id=${conversationId}&math_tick=2`,
      null,
      authToken
    );

    // Validate response
    expect(pcaResponse.status).toBe(200);

    // TODO: Check that the math_tick is respected

    // TODO: Request correlation matrix with math_tick parameter
  });
});
