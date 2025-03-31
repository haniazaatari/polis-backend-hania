import { beforeAll, describe, expect, test } from '@jest/globals';
import {
  createComment,
  createConversation,
  initializeParticipant,
  registerAndLoginUser,
  submitVote
} from '../setup/api-test-helpers.js';

describe('Conversation Stats API', () => {
  let agent;
  let conversationId;

  beforeAll(async () => {
    // Register a user (conversation owner)
    const auth = await registerAndLoginUser();
    agent = auth.agent;

    // Create a conversation
    conversationId = await createConversation(agent);

    // Initialize a participant
    const participantResult = await initializeParticipant(conversationId);
    const participantAgent = participantResult.agent;

    // Create a comment as the owner
    const commentId = await createComment(agent, conversationId, 'This is a test comment');

    // Cast a vote as a participant
    await submitVote(participantAgent, {
      conversation_id: conversationId,
      tid: commentId,
      vote: 1
    });
  });

  test('GET /api/v3/conversationStats - should return stats for conversation owner', async () => {
    const response = await agent.get(`/api/v3/conversationStats?conversation_id=${conversationId}`);

    // Should return successful response
    expect(response.status).toBe(200);

    // Response should be JSON and contain stats data
    const data = JSON.parse(response.text);
    expect(data).toHaveProperty('voteTimes');
    expect(data).toHaveProperty('firstVoteTimes');
    expect(data).toHaveProperty('commentTimes');
    expect(data).toHaveProperty('firstCommentTimes');
    expect(data).toHaveProperty('votesHistogram');
    expect(data).toHaveProperty('burstHistogram');

    // Should have one comment time
    expect(data.commentTimes.length).toBe(1);

    // Should have one vote time
    expect(data.voteTimes.length).toBe(1);
  });

  test('GET /api/v3/conversationStats - should accept until parameter', async () => {
    // Get current time in milliseconds
    const currentTimeMs = Date.now();

    const response = await agent.get(
      `/api/v3/conversationStats?conversation_id=${conversationId}&until=${currentTimeMs}`
    );

    // Should return successful response
    expect(response.status).toBe(200);

    // Response should be JSON and contain stats data
    const data = JSON.parse(response.text);

    // All the data should be present because until is in the future
    expect(data.commentTimes.length).toBe(1);
    expect(data.voteTimes.length).toBe(1);
  });

  test('GET /api/v3/conversationStats - should filter data with until parameter', async () => {
    // Get time from yesterday (before our test data was created)
    const yesterdayMs = Date.now() - 24 * 60 * 60 * 1000;

    const response = await agent.get(
      `/api/v3/conversationStats?conversation_id=${conversationId}&until=${yesterdayMs}`
    );

    // Should return successful response
    expect(response.status).toBe(200);

    // Response should be JSON and contain stats data with no entries
    const data = JSON.parse(response.text);

    // No data should be present because until is in the past
    expect(data.commentTimes.length).toBe(0);
    expect(data.voteTimes.length).toBe(0);
  });
});
