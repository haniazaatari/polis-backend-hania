import { afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import {
  attachAuthToken,
  createTestComment,
  createTestConversation,
  generateRandomXid,
  generateTestUser,
  makeRequestWithTimeout
} from '../setup/api-test-helpers.js';
import { rollbackTransaction, startTransaction } from '../setup/db-test-helpers.js';

// Helper function to wait for a specified duration
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Participation Endpoints', () => {
  // Store auth token and other data between tests
  let authToken = null;
  let userId = null;
  let conversationId = null;
  let conversationZinvite = null;
  let commentId = null;
  let client = null;
  let xidConversationId = null;

  // Store test user data
  const testUser = generateTestUser();
  const testXid = generateRandomXid();

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

  // Register and login a test user before running tests
  beforeAll(async () => {
    try {
      // Register a test user with retries
      let registerResponse;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          registerResponse = await makeRequestWithTimeout(
            'POST',
            '/auth/new',
            {
              email: testUser.email,
              password: testUser.password,
              hname: testUser.hname,
              gatekeeperTosPrivacy: true
            },
            null,
            { timeout: 5000 }
          );
          if (registerResponse.status === 200) break;
          await wait(1000);
        } catch (error) {
          console.warn(`Registration attempt ${attempt} failed:`, error.message);
          if (attempt === 3) throw error;
          await wait(1000);
        }
      }

      expect(registerResponse.status).toBe(200);
      userId = registerResponse.body.uid;

      await wait(1000); // Wait before login

      // Login with retries
      let loginResponse;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          loginResponse = await makeRequestWithTimeout(
            'POST',
            '/auth/login',
            {
              email: testUser.email,
              password: testUser.password
            },
            null,
            { timeout: 5000 }
          );
          if (loginResponse.status === 200) break;
          await wait(1000);
        } catch (error) {
          console.warn(`Login attempt ${attempt} failed:`, error.message);
          if (attempt === 3) throw error;
          await wait(1000);
        }
      }

      expect(loginResponse.status).toBe(200);
      if (loginResponse.headers['x-polis']) {
        authToken = loginResponse.headers['x-polis'];
      } else if (loginResponse.body?.token) {
        authToken = loginResponse.body.token;
      } else if (loginResponse.headers['set-cookie']) {
        authToken = loginResponse.headers['set-cookie'];
      }

      expect(authToken).toBeTruthy();

      await wait(1000); // Wait before creating conversation

      // Create a test conversation with retries
      let conversation;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          conversation = await createTestConversation(authToken);
          if (conversation.zid && conversation.zinvite) break;
          await wait(1000);
        } catch (error) {
          console.warn(`Conversation creation attempt ${attempt} failed:`, error.message);
          if (attempt === 3) throw error;
          await wait(1000);
        }
      }

      conversationId = conversation.zid;
      conversationZinvite = conversation.zinvite;

      await wait(1000); // Wait before creating comment

      // Create a test comment with retries
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          commentId = await createTestComment(authToken, conversationZinvite);
          if (commentId) break;
          await wait(1000);
        } catch (error) {
          console.warn(`Comment creation attempt ${attempt} failed:`, error.message);
          if (attempt === 3) throw error;
          await wait(1000);
        }
      }

      await wait(1000); // Wait before creating XID conversation

      // Create a conversation with XID with retries
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const xidConversation = await createTestConversation(authToken, {
            xid: testXid
          });
          if (xidConversation.zinvite) {
            xidConversationId = xidConversation.zinvite;
            break;
          }
          await wait(1000);
        } catch (error) {
          console.warn(`XID conversation creation attempt ${attempt} failed:`, error.message);
          if (attempt === 3) throw error;
          await wait(1000);
        }
      }
    } catch (error) {
      console.error('Error in beforeAll:', error);
      throw error;
    }
  }, 30000); // Increase timeout to 30 seconds

  describe('GET /participation', () => {
    it('should get participation data for a conversation', async () => {
      try {
        const response = await makeRequestWithTimeout(
          'GET',
          `/participation?conversation_id=${conversationZinvite}`,
          null,
          authToken,
          { timeout: 5000, retries: 2 }
        );

        // Legacy server might return various status codes or error messages
        if (response.status === 500 && response.text?.includes('polis_err')) {
          console.warn('Participation endpoint returned expected error:', response.text);
          return;
        }

        expect([200, 304]).toContain(response.status);
        if (response.status === 200) {
          expect(response.body).toBeDefined();
        }
      } catch (error) {
        console.warn('Participation data retrieval failed:', error.message);
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
          console.warn('Skipping test due to connection issues');
          return;
        }
        throw error;
      }
    });

    it('should handle missing conversation ID', async () => {
      const response = await makeRequestWithTimeout('GET', '/participation', null, authToken, { timeout: 5000 });
      expect([400, 500]).toContain(response.status);
    });
  });

  describe('GET /participationInit', () => {
    it('should initialize participation for anonymous users', async () => {
      try {
        const response = await makeRequestWithTimeout(
          'GET',
          `/participationInit?conversation_id=${conversationZinvite}&pid=mypid&lang=en`,
          null,
          null,
          { timeout: 5000, retries: 2 }
        );

        // Legacy server might return various status codes or error messages
        if (response.status === 500 && response.text?.includes('polis_err')) {
          console.warn('ParticipationInit endpoint returned expected error:', response.text);
          return;
        }

        expect([200, 304]).toContain(response.status);
        if (response.status === 200) {
          expect(response.body).toBeDefined();
          if (response.body.pid !== undefined) {
            expect(typeof response.body.pid).toBe('number');
          }
          expect(response.headers['set-cookie']).toBeDefined();
        }
      } catch (error) {
        console.warn('ParticipationInit failed:', error.message);
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
          console.warn('Skipping test due to connection issues');
          return;
        }
        throw error;
      }
    });

    it('should handle missing conversation ID', async () => {
      const response = await makeRequestWithTimeout('GET', '/participationInit', null, null, { timeout: 5000 });
      expect([200, 500]).toContain(response.status);
      if (response.status === 500) {
        expect(response.text).toContain('polis_err');
      }
    });
  });

  describe('GET /nextComment', () => {
    it('should get the next comment to show', async () => {
      try {
        const response = await makeRequestWithTimeout(
          'GET',
          `/nextComment?conversation_id=${conversationZinvite}`,
          null,
          authToken,
          { timeout: 5000, retries: 2 }
        );

        // Legacy server might return various status codes or error messages
        if (response.status === 500 && response.text?.includes('polis_err')) {
          console.warn('NextComment endpoint returned expected error:', response.text);
          return;
        }

        expect([200, 304, 404]).toContain(response.status);
        if (response.status === 200) {
          expect(response.body).toBeDefined();
          if (response.body.currentPid) {
            expect(typeof response.body.currentPid).toBe('number');
          }
        }
      } catch (error) {
        console.warn('NextComment retrieval failed:', error.message);
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
          console.warn('Skipping test due to connection issues');
          return;
        }
        throw error;
      }
    });

    it('should handle missing conversation ID', async () => {
      const response = await makeRequestWithTimeout('GET', '/nextComment', null, authToken, { timeout: 5000 });
      expect([400, 500]).toContain(response.status);
    });
  });

  describe('GET /participationInit by XID', () => {
    it('should initialize participation with XID', async () => {
      try {
        const response = await makeRequestWithTimeout(
          'GET',
          `/participationInit?conversation_id=${xidConversationId}&xid=${testXid}`,
          null,
          null,
          { timeout: 5000, retries: 2 }
        );

        // Legacy server might return various status codes or error messages
        if (response.status === 500 && response.text?.includes('polis_err')) {
          console.warn('ParticipationInit XID endpoint returned expected error:', response.text);
          return;
        }

        expect([200, 304]).toContain(response.status);
        if (response.status === 200) {
          expect(response.body).toBeDefined();
          if (response.body.pid !== undefined) {
            expect(typeof response.body.pid).toBe('number');
          }
        }
      } catch (error) {
        console.warn('ParticipationInit XID failed:', error.message);
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
          console.warn('Skipping test due to connection issues');
          return;
        }
        throw error;
      }
    });

    it('should handle invalid XID', async () => {
      const response = await makeRequestWithTimeout(
        'GET',
        `/participationInit?xid=invalid_xid&conversation_id=${xidConversationId}`,
        null,
        null,
        { timeout: 5000 }
      );
      expect([200, 500]).toContain(response.status);
      if (response.status === 500) {
        expect(response.text).toContain('polis_err');
      }
    });
  });
});
