import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { initializeParticipantWithXid, makeRequest, setupAuthAndConvo, submitVote } from '../setup/api-test-helpers.js';
import { deleteAllEmails, findEmailByRecipient } from '../setup/email-helpers.js';

describe('User Management Endpoints', () => {
  let ownerAuthToken;
  let ownerUserId;
  let testUser;
  let conversationId;

  // Setup - Create a test user with admin privileges and a conversation
  beforeAll(async () => {
    // Clear any existing emails
    try {
      await deleteAllEmails();
    } catch (error) {
      console.warn('Could not clear emails, MailDev may not be running:', error.message);
    }

    // Setup auth and create test conversation
    const setup = await setupAuthAndConvo({ commentCount: 3 });
    ownerAuthToken = setup.authToken;
    ownerUserId = setup.userId;
    testUser = setup.testUser;
    conversationId = setup.conversationId;
  });

  // Cleanup after tests
  afterAll(async () => {
    try {
      await deleteAllEmails();
    } catch (error) {
      console.warn('Could not clear emails after tests:', error.message);
    }
  });

  describe('GET /users', () => {
    test('should get the current user info when authenticated', async () => {
      const response = await makeRequest('GET', '/users', null, ownerAuthToken);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('uid', ownerUserId);
      expect(response.body).toHaveProperty('email', testUser.email);
      expect(response.body).toHaveProperty('hname', testUser.hname);
    });

    test('should require authentication when errIfNoAuth is true', async () => {
      const response = await makeRequest('GET', '/users?errIfNoAuth=true');

      // The server responds with 401 (authorization required)
      expect(response.status).toBe(401);

      // Check for error message in text
      expect(response.text).toMatch(/polis_error_auth_needed/);
    });

    test('should return empty response for anonymous users when errIfNoAuth is false', async () => {
      const response = await makeRequest('GET', '/users?errIfNoAuth=false');

      expect(response.status).toBe(200);

      // Legacy API returns an empty object for anonymous users
      expect(response.body).toEqual({});
    });

    // Note: This functionality is not working on the legacy server. There are multiple issues.
    // For now we can expect a 200 response, but the body will be empty.
    test('should handle user lookup by XID', async () => {
      // Create a random XID for testing
      const testXid = `test-xid-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

      // Initialize an XID-based participant in the conversation
      const {
        cookies: initCookies,
        body: { nextComment }
      } = await initializeParticipantWithXid(conversationId, testXid);

      // Vote to establish the xid user in the conversation
      await submitVote(
        {
          conversation_id: conversationId,
          vote: -1, // upvote
          tid: nextComment.tid,
          xid: testXid
        },
        initCookies
      );

      const response = await makeRequest('GET', `/users?owner_uid=${ownerUserId}&xid=${testXid}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({});
    });
  });

  describe('PUT /users', () => {
    test('should update user information', async () => {
      const newName = `Updated Test User ${Date.now()}`;

      const response = await makeRequest(
        'PUT',
        '/users',
        {
          hname: newName
        },
        ownerAuthToken
      );

      expect(response.status).toBe(200);

      // Verify the update by getting user info
      const userInfo = await makeRequest('GET', '/users', null, ownerAuthToken);
      expect(userInfo.status).toBe(200);
      expect(userInfo.body).toHaveProperty('hname', newName);
    });

    test('should require authentication', async () => {
      // Now use the standard makeRequest helper
      const response = await makeRequest('PUT', '/users', {
        hname: 'Unauthenticated Update'
      });

      expect(response.status).toBe(500);
      expect(response.text).toMatch(/polis_err_auth_token_not_supplied/);
    });

    test('should validate email format', async () => {
      const response = await makeRequest(
        'PUT',
        '/users',
        {
          email: 'invalid-email'
        },
        ownerAuthToken
      );

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

      // Use standard makeRequest helper
      const response = await makeRequest(
        'POST',
        '/users/invite',
        {
          conversation_id: conversationId,
          emails: testEmails.join(',')
        },
        ownerAuthToken
      );

      expect(response.status).toBe(200);
      // The legacy server returns a 200 with a status property of ':-)'. Yep.
      expect(response.body).toHaveProperty('status', ':-)');

      // Verify that emails were sent
      // Allow a small delay for emails to be processed
      await new Promise((resolve) => setTimeout(resolve, 2000));

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
      expect(email1.subject).toMatch(/Join the Pol.is conversation!/i);
      expect(email1.html || email1.text).toContain(conversationId);

      expect(email2.subject).toMatch(/Join the Pol.is conversation!/i);
      expect(email2.html || email2.text).toContain(conversationId);
    });

    test('should require authentication', async () => {
      // Use standard makeRequest helper
      const response = await makeRequest('POST', '/users/invite', {
        conversation_id: conversationId,
        emails: `unauthenticated.${Date.now()}@example.com`
      });

      expect(response.status).toBe(500);

      // Check for error text
      expect(response.text).toMatch(/polis_err_auth_token_not_supplied/);
    });

    test('should require valid conversation ID', async () => {
      const response = await makeRequest(
        'POST',
        '/users/invite',
        {
          conversation_id: 'invalid-conversation-id',
          emails: `invalid-convo.${Date.now()}@example.com`
        },
        ownerAuthToken
      );

      expect(response.status).toBe(400);
      expect(response.text).toMatch(/polis_err_param_parse_failed_conversation_id/);
      expect(response.text).toMatch(/polis_err_fetching_zid_for_conversation_id/);
    });

    test('should require email addresses', async () => {
      const response = await makeRequest(
        'POST',
        '/users/invite',
        {
          conversation_id: conversationId
        },
        ownerAuthToken
      );

      expect(response.status).toBe(400);
      expect(response.text).toMatch(/polis_err_param_missing_emails/);
    });

    test('should validate email format', async () => {
      const response = await makeRequest(
        'POST',
        '/users/invite',
        {
          conversation_id: conversationId,
          emails: 'invalid-email'
        },
        ownerAuthToken
      );

      // The server should reject invalid email formats
      // However, the legacy server just returns a 200
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', ':-)');
    });
  });
});
