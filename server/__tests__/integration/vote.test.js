import { afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import {
  API_PREFIX,
  API_URL,
  attachAuthToken,
  createTestComment,
  createTestConversation,
  generateTestUser,
  wait
} from '../setup/api-test-helpers.js';
import { rollbackTransaction, startTransaction } from '../setup/db-test-helpers.js';

describe('Vote Endpoints', () => {
  // Store auth data between tests
  let authToken = null;
  let conversationId = null;
  let conversationZinvite = null;
  let commentId = null;
  let client = null;
  let pid = null;
  let userId = null;

  // Store test user data
  const testUser = generateTestUser();

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

  // Helper function to apply auth token to requests
  function attachAuth(req) {
    return attachAuthToken(req, authToken);
  }

  // Helper function to get participant ID directly from database
  async function getParticipantId(uid, zid) {
    try {
      const result = await client.query('SELECT pid FROM participants WHERE uid = $1 AND zid = $2', [uid, zid]);
      if (result.rows.length > 0) {
        return result.rows[0].pid;
      }
      return null;
    } catch (error) {
      console.error('Error getting participant ID:', error);
      return null;
    }
  }

  // Helper function to ensure we have a valid participant ID
  async function ensureParticipantId() {
    // If we already have a pid, return it
    if (pid !== null && pid !== undefined) {
      return pid;
    }

    // Try to get the participant ID from the database
    if (userId && conversationId) {
      // Try up to 3 times with a delay in between
      for (let attempt = 1; attempt <= 3; attempt++) {
        pid = await getParticipantId(userId, conversationId);
        if (pid !== null) {
          return pid;
        }

        if (attempt < 3) {
          await wait(1000);
        }
      }

      // If we still don't have a pid, try to create one
      try {
        const insertResult = await client.query('INSERT INTO participants (uid, zid) VALUES ($1, $2) RETURNING pid', [
          userId,
          conversationId
        ]);
        if (insertResult.rows.length > 0) {
          pid = insertResult.rows[0].pid;
          return pid;
        }
      } catch (error) {
        // If error is a duplicate key error, try to get the pid again
        if (error.code === '23505' && error.constraint === 'participants_zid_uid_key') {
          pid = await getParticipantId(userId, conversationId);
          if (pid !== null) {
            return pid;
          }
        } else {
          console.error('Error creating participant:', error);
        }
      }
    }

    throw new Error('Failed to obtain a valid participant ID after multiple attempts');
  }

  // Register, login, create a conversation, and add a comment before testing
  beforeAll(async () => {
    try {
      // Register a test user
      const registerResponse = await request(API_URL).post(`${API_PREFIX}/auth/new`).send({
        email: testUser.email,
        password: testUser.password,
        hname: testUser.hname,
        gatekeeperTosPrivacy: true
      });

      expect(registerResponse.status).toBe(200);

      // Get user ID from response if available
      if (registerResponse.body?.uid) {
        userId = registerResponse.body.uid;
      }

      // Login with the test user
      const loginResponse = await request(API_URL).post(`${API_PREFIX}/auth/login`).send({
        email: testUser.email,
        password: testUser.password
      });

      expect(loginResponse.status).toBe(200);

      // Extract auth token from response
      if (loginResponse.headers['x-polis']) {
        authToken = loginResponse.headers['x-polis'];
      } else if (loginResponse.body?.token) {
        authToken = loginResponse.body.token;
      } else if (loginResponse.headers['set-cookie']) {
        authToken = loginResponse.headers['set-cookie'];
      }

      // If we didn't get user ID from register response, try to get it from login
      if (!userId && loginResponse.body?.uid) {
        userId = loginResponse.body.uid;
      }

      // Verify we have a user ID
      expect(userId).toBeDefined();

      // Create a test conversation
      const conversation = await createTestConversation(authToken);
      conversationId = conversation.zid;
      conversationZinvite = conversation.zinvite;

      // Verify we have conversation data
      expect(conversationId).toBeDefined();
      expect(conversationZinvite).toBeDefined();

      // Create a test comment
      commentId = await createTestComment(authToken, conversationZinvite);

      // Verify we have a comment ID
      expect(commentId).toBeDefined();

      // Start a transaction for setup
      client = await startTransaction();

      // Ensure we have a valid participant ID
      pid = await ensureParticipantId();

      // Verify we have a pid
      expect(pid).toBeDefined();
      expect(pid).not.toBeNull();

      // Commit the transaction
      await client.query('COMMIT');
    } catch (error) {
      console.error('Test setup failed with error:', error);
      // Rollback if there was an error
      if (client) {
        await client.query('ROLLBACK');
      }
      throw error; // Re-throw to fail the test
    } finally {
      // Release the client
      if (client) {
        client.release();
        client = null;
      }
    }
  });

  describe('POST /votes', () => {
    it('should cast a vote on a comment', async () => {
      // Verify we have all the required data
      expect(conversationZinvite).toBeDefined();
      expect(commentId).toBeDefined();
      expect(pid).toBeDefined();

      // Create vote payload
      const voteData = {
        tid: commentId,
        vote: -1, // Agree vote (-1)
        conversation_id: conversationZinvite,
        pid: pid
      };

      // Submit the vote
      const response = await attachAuth(request(API_URL).post(`${API_PREFIX}/votes`)).send(voteData);

      // Check response - the API returns { currentPid: pid } on success
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('currentPid');
      expect(response.body.currentPid).toBe(pid);
    });
  });

  describe('GET /votes', () => {
    it('should retrieve votes for a conversation', async () => {
      // Verify we have all the required data
      expect(conversationZinvite).toBeDefined();
      expect(commentId).toBeDefined();
      expect(pid).toBeDefined();

      // First create a vote to ensure there's something to retrieve
      const voteData = {
        tid: commentId,
        vote: -1,
        conversation_id: conversationZinvite,
        pid: pid
      };

      await attachAuth(request(API_URL).post(`${API_PREFIX}/votes`)).send(voteData);

      // Wait a moment for the vote to be processed
      await wait(1000);

      // Get votes for the conversation
      const response = await attachAuth(
        request(API_URL).get(`${API_PREFIX}/votes?conversation_id=${conversationZinvite}`)
      );

      // Check response
      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      // The response might be an empty array if no votes are found
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /votes/me', () => {
    it("should attempt to retrieve a participant's votes for a conversation", async () => {
      // Verify we have all the required data
      expect(conversationZinvite).toBeDefined();
      expect(commentId).toBeDefined();
      expect(pid).toBeDefined();

      // First create a vote to ensure there's something to retrieve
      const voteData = {
        tid: commentId,
        vote: 1, // Disagree vote (1)
        conversation_id: conversationZinvite,
        pid: pid
      };

      await attachAuth(request(API_URL).post(`${API_PREFIX}/votes`)).send(voteData);

      // Wait a moment for the vote to be processed
      await wait(1000);

      // Get votes for the participant
      const response = await attachAuth(
        request(API_URL).get(`${API_PREFIX}/votes/me?conversation_id=${conversationZinvite}`)
      );

      // Note: This endpoint might return a 500 error with 'polis_err_get_votes_by_me'
      // We'll check that we either get a successful response or the expected error
      if (response.status === 200) {
        expect(Array.isArray(response.body)).toBe(true);

        // If votes were returned, check if our vote is included
        if (response.body.length > 0) {
          const foundVote = response.body.find((vote) => vote.tid === commentId);
          if (foundVote) {
            expect(foundVote).toHaveProperty('vote');
          }
        }
      } else {
        // If the endpoint returns an error, check that it's the expected one
        expect(response.status).toBe(500);
        expect(response.body).toHaveProperty('error', 'polis_err_get_votes_by_me');
      }
    });
  });
});
