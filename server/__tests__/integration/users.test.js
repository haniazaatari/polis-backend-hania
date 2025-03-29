import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import {
  getTestAgent,
  getTextAgent,
  initializeParticipantWithXid,
  newAgent,
  newTextAgent,
  setupAuthAndConvo,
  submitVote,
  wait
} from '../setup/api-test-helpers.js';
import { deleteAllEmails, findEmailByRecipient } from '../setup/email-helpers.js';

describe('User Management Endpoints', () => {
  // Access the global agents
  const agent = getTestAgent();
  const textAgent = getTextAgent();

  let ownerUserId;
  let testUser;
  let conversationId;

  // Setup - Create a test user with admin privileges and a conversation
  beforeAll(async () => {
    // Clear any existing emails - ignore errors if MailDev is not running
    try {
      await deleteAllEmails();
    } catch (error) {
      // Ignore MailDev errors - tests can proceed without email cleanup
      console.warn('MailDev may not be running - email cleanup skipped:', error.message);
    }

    // Setup auth and create test conversation
    const setup = await setupAuthAndConvo({ commentCount: 3 });
    ownerUserId = setup.userId;
    testUser = setup.testUser;
    conversationId = setup.conversationId;
  });

  // Cleanup after tests
  afterAll(async () => {
    try {
      await deleteAllEmails();
    } catch (error) {
      // Ignore MailDev errors during cleanup
      console.warn('MailDev may not be running - email cleanup skipped:', error.message);
    }
  });

  describe('GET /users', () => {
    test('should get the current user info when authenticated', async () => {
      const response = await agent.get('/api/v3/users');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('uid', ownerUserId);
      expect(response.body).toHaveProperty('email', testUser.email);
      expect(response.body).toHaveProperty('hname', testUser.hname);
    });

    test('should require authentication when errIfNoAuth is true', async () => {
      // Create a new agent without auth
      const unauthAgent = newTextAgent();
      const response = await unauthAgent.get('/api/v3/users?errIfNoAuth=true');

      // The server responds with 401 (authorization required)
      expect(response.status).toBe(401);

      // Check for error message in text
      expect(response.text).toMatch(/polis_error_auth_needed/);
    });

    test('should return empty response for anonymous users when errIfNoAuth is false', async () => {
      // Create a new agent without auth
      const unauthAgent = newAgent();
      const response = await unauthAgent.get('/api/v3/users?errIfNoAuth=false');

      expect(response.status).toBe(200);

      // Legacy API returns an empty object for anonymous users
      expect(response.body).toEqual({});
    });

    test('should handle user lookup by XID', async () => {
      // Create a random XID for testing
      const testXid = `test-xid-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

      // Initialize an XID-based participant in the conversation
      const { agent: xidAgent, body, status } = await initializeParticipantWithXid(conversationId, testXid);

      expect(status).toBe(200);
      expect(body).toHaveProperty('nextComment');
      const nextComment = body.nextComment;
      expect(nextComment).toBeDefined();
      expect(nextComment.tid).toBeDefined();

      // Vote to establish the xid user in the conversation
      await submitVote(xidAgent, {
        conversation_id: conversationId,
        vote: -1, // upvote
        tid: nextComment.tid,
        xid: testXid
      });

      await wait(500); // Wait for vote to be processed

      const lookupResponse = await agent.get(`/api/v3/users?owner_uid=${ownerUserId}&xid=${testXid}`);

      expect(lookupResponse.status).toBe(200);

      // Returns the caller's user info, not the xid user info
      // This is a legacy behavior, and is not what we want.
      expect(lookupResponse.body).toHaveProperty('email', testUser.email);
      expect(lookupResponse.body).toHaveProperty('hasXid', false);
      expect(lookupResponse.body).toHaveProperty('hname', testUser.hname);
      expect(lookupResponse.body).toHaveProperty('uid', ownerUserId);
    });
  });

  describe('PUT /users', () => {
    test('should update user information', async () => {
      const newName = `Updated Test User ${Date.now()}`;

      const response = await agent.put('/api/v3/users').send({
        hname: newName
      });

      expect(response.status).toBe(200);

      // Verify the update by getting user info
      const userInfo = await agent.get('/api/v3/users');
      expect(userInfo.status).toBe(200);
      expect(userInfo.body).toHaveProperty('hname', newName);
    });

    test('should require authentication', async () => {
      // Use an unauthenticated agent
      const unauthAgent = newAgent();
      const response = await unauthAgent.put('/api/v3/users').send({
        hname: 'Unauthenticated Update'
      });

      expect(response.status).toBe(500);
      expect(response.text).toMatch(/polis_err_auth_token_not_supplied/);
    });

    test('should validate email format', async () => {
      const response = await textAgent.put('/api/v3/users').send({
        email: 'invalid-email'
      });

      // The server should reject invalid email formats
      expect(response.status).toBe(400);
      expect(response.text).toMatch(/polis_err_param_parse_failed_email/);
      expect(response.text).toMatch(/polis_fail_parse_email/);
    });
  });

  describe('POST /users/invite', () => {
    test('should send invites to a conversation', async () => {
      const timestamp = Date.now();
      // NOTE: The DB restricts emails to 32 characters!
      const testEmails = [`invite.${timestamp}.1@test.com`, `invite.${timestamp}.2@test.com`];

      const response = await agent.post('/api/v3/users/invite').send({
        conversation_id: conversationId,
        emails: testEmails.join(',')
      });

      expect(response.status).toBe(200);
      // The legacy server returns a 200 with a status property of ':-)'. Yep.
      expect(response.body).toHaveProperty('status', ':-)');

      // Verify that emails were sent
      // Allow a small delay for emails to be processed
      await wait(2000);

      // Find the emails in MailDev
      const email1 = await findEmailByRecipient(testEmails[0]);
      const email2 = await findEmailByRecipient(testEmails[1]);

      // Test should fail if we don't find both emails
      if (!email1) {
        throw new Error(
          `Email verification failed: No email found for recipient ${testEmails[0]}. Is MailDev running?`
        );
      }
      if (!email2) {
        throw new Error(
          `Email verification failed: No email found for recipient ${testEmails[1]}. Is MailDev running?`
        );
      }

      // Verify email content
      expect(email1.subject).toMatch(/Join the pol.is conversation!/i);
      expect(email1.html || email1.text).toContain(conversationId);

      expect(email2.subject).toMatch(/Join the pol.is conversation!/i);
      expect(email2.html || email2.text).toContain(conversationId);
    });

    test('should require authentication', async () => {
      // Use an unauthenticated agent
      const unauthAgent = newAgent();
      const response = await unauthAgent.post('/api/v3/users/invite').send({
        conversation_id: conversationId,
        emails: `unauthenticated.${Date.now()}@example.com`
      });

      expect(response.status).toBe(500);
      expect(response.text).toMatch(/polis_err_auth_token_not_supplied/);
    });

    test('should require valid conversation ID', async () => {
      const response = await textAgent.post('/api/v3/users/invite').send({
        conversation_id: 'invalid-conversation-id',
        emails: `invalid-convo.${Date.now()}@example.com`
      });

      expect(response.status).toBe(400);
      expect(response.text).toMatch(/polis_err_param_parse_failed_conversation_id/);
      expect(response.text).toMatch(/polis_err_fetching_zid_for_conversation_id/);
    });

    test('should require email addresses', async () => {
      const response = await textAgent.post('/api/v3/users/invite').send({
        conversation_id: conversationId
      });

      expect(response.status).toBe(400);
      expect(response.text).toMatch(/polis_err_param_missing_emails/);
    });

    test('should validate email format', async () => {
      const response = await agent.post('/api/v3/users/invite').send({
        conversation_id: conversationId,
        emails: 'invalid-email'
      });

      // The server should reject invalid email formats
      // However, the legacy server just returns a 200
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', ':-)');
    });
  });
});
