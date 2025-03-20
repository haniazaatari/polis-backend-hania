/**
 * Special test for detecting comment repetition bug
 *
 * This test creates a conversation with many comments, then has a participant
 * vote on comments until there are none remaining. It checks that:
 * 1. Each comment is seen exactly once
 * 2. No comments are repeated for a participant who has already voted on them
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import {
  createTestComment,
  createTestConversation,
  initializeParticipant,
  registerAndLoginUser,
  submitVote,
  wait
} from '../setup/api-test-helpers.js';
import { rollbackTransaction, startTransaction } from '../setup/db-test-helpers.js';

// Constants
const NUM_COMMENTS = 8; // Total number of comments to create
const VOTE_DELAY = 1000; // Delay between voting on comments in milliseconds

describe('Comment Repetition Bug Test', () => {
  // Test state
  let conversationOwner;
  let ownerToken;
  let zinvite;
  const allCommentIds = [];
  let client = null;

  // Start a transaction before each test
  beforeEach(async () => {
    client = await startTransaction();
  });

  // Rollback the transaction after each test
  afterEach(async () => {
    if (client) {
      await rollbackTransaction(client);
      client = null;
    }
  });

  // Setup: Register admin, create conversation, and create comments
  beforeAll(async () => {
    // Register and login admin user as conversation owner
    conversationOwner = await registerAndLoginUser({
      email: `owner_${Date.now()}@example.com`,
      password: 'password123',
      hname: 'Conversation Owner'
    });
    ownerToken = conversationOwner.authToken;

    // Create test conversation
    const conversationData = await createTestConversation(ownerToken, {
      topic: `Comment Repetition Test ${Date.now()}`,
      description: 'A conversation to test for the comment repetition bug'
    });

    zinvite = conversationData.zinvite;

    // Create comments as the owner
    for (let i = 0; i < NUM_COMMENTS; i++) {
      const commentId = await createTestComment(ownerToken, zinvite, {
        txt: `Test comment ${i + 1}`
      });
      allCommentIds.push(commentId);

      if (i % 5 === 0 || i === NUM_COMMENTS - 1) {
        console.log(`Created ${i + 1} of ${NUM_COMMENTS} comments`);
      }
    }

    console.log(`Created ${NUM_COMMENTS} total comments for the test conversation`);
  }, 120000); // Longer timeout for setup

  test('A participant should never see the same comment twice', async () => {
    // Track seen comments to detect repetitions
    const seenCommentIds = new Set();
    const commentRepetitions = new Map(); // Track how many times each comment is seen
    let votedCount = 0;
    // Add an array to track the order of comments seen
    const orderedCommentIds = [];

    try {
      // STEP 1: Initialize anonymous participant
      const { cookies: initCookies, body: initBody, status: initStatus } = await initializeParticipant(zinvite);

      let authToken = initCookies;
      let nextComment = initBody.nextComment;
      let commentId = nextComment.tid;

      // STEP 2: Process each comment one by one
      const MAX_ALLOWED_COMMENTS = NUM_COMMENTS + 1; // Allow one extra to detect repetition
      let processedComments = 0;

      while (commentId) {
        processedComments++;
        if (processedComments > MAX_ALLOWED_COMMENTS) {
          throw new Error(`Test failed: Processed ${processedComments} comments which exceeds maximum allowed (${MAX_ALLOWED_COMMENTS}). This indicates a comment repetition issue.`);
        }

        // Add the comment ID to our ordered list
        orderedCommentIds.push(commentId);

        // Check if we've seen this comment before
        if (seenCommentIds.has(commentId)) {
          // Update repetition count
          commentRepetitions.set(commentId, (commentRepetitions.get(commentId) || 1) + 1);
          console.error(`REPETITION DETECTED: Comment ${commentId} seen again`);
        } else {
          seenCommentIds.add(commentId);
          commentRepetitions.set(commentId, 1);
          votedCount++;
        }

        // Vote on the current comment (randomly agree, disagree, or pass)
        const voteOptions = [-1, 1, 0]; // -1 agree, 1 disagree, 0 pass
        const randomVote = voteOptions[Math.floor(Math.random() * voteOptions.length)];

        // Build vote payload
        const voteData = {
          conversation_id: zinvite,
          tid: commentId,
          vote: randomVote
        };

        // Submit vote using our improved helper - will handle auth errors
        const { cookies: voteCookies, body: voteBody, status: voteStatus } = await submitVote(voteData, authToken);

        // Check for error in response
        if (voteStatus !== 200) {
          const voteError = 'Error submitting vote'; // TODO: Get error from response
          console.error(voteError);
          throw new Error(voteError);
        }

        authToken = voteCookies;
        nextComment = voteBody.nextComment;
        commentId = nextComment?.tid;

        // Log progress periodically
        if ((votedCount + 1) % 5 === 0) {
          console.log(`Voted on ${votedCount} unique comments out of ${NUM_COMMENTS} total.`);
        }

        // Add a small delay to avoid rate limiting
        await wait(VOTE_DELAY);
      }

      // STEP 3: Analyze results
      console.log('\nFINAL RESULTS:');
      console.log(`Seen ${seenCommentIds.size} unique comments out of ${NUM_COMMENTS} total`);
      console.log(`Voted on ${votedCount} comments`);

      // Print the ordered sequence of comments
      console.log('\nORDERED COMMENT SEQUENCE:');
      console.log(orderedCommentIds);
      console.log(`Total comments in sequence: ${orderedCommentIds.length}`);

      // Check for repeats
      const repeatedComments = Array.from(commentRepetitions.entries())
        .filter(([_, count]) => count > 1)
        .map(([commentId, count]) => ({ commentId, count }));

      if (repeatedComments.length > 0) {
        console.error('Found repeated comments:', repeatedComments);
      }

      // Check if all comments were seen
      const unseenComments = allCommentIds.filter((id) => !seenCommentIds.has(id));
      if (unseenComments.length > 0) {
        console.log(`Comments never seen: ${unseenComments.length} of ${NUM_COMMENTS}`);
      }

      // Test assertions: We're in development mode, so if there are repetitions,
      // log them but don't fail the test yet to gather more data
      if (repeatedComments.length > 0) {
        console.log(`WARNING: Found ${repeatedComments.length} repeated comments - the bug appears to be present`);
      } else {
        console.log('SUCCESS: No comments were repeated! This suggests the bug does not occur in this scenario.');
      }

      expect(repeatedComments.length).toBe(0); // No comment should be repeated
    } catch (err) {
      console.error('Test error:', err);
      throw err;
    }
  }, 180000); // Longer timeout for test execution
});
