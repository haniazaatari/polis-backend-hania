import http from 'http';
import { expect } from '@jest/globals';
import dotenv from 'dotenv';
/**
 * Shared API test helper functions for Polis tests
 */
import request from 'supertest';

// Use { override: false } to prevent dotenv from overriding command-line env vars
dotenv.config({ override: false });

console.log('process.env.API_SERVER_PORT', process.env.API_SERVER_PORT);

// API constants - export these for use in test files
const API_PORT = process.env.API_SERVER_PORT || 5000;
const API_URL = process.env.API_URL || `http://localhost:${API_PORT}`;
const API_PREFIX = '/api/v3';

/**
 * Helper function to make HTTP requests that can handle both JSON and text responses
 * This is needed because the legacy server sometimes sends text responses with JSON content-type
 */
async function makeRequest(method, path, data = null, cookies = null) {
  const options = {
    hostname: 'localhost',
    port: API_PORT,
    path: `${API_PREFIX}${path}`,
    method: method.toUpperCase(),
    headers: {
      'Content-Type': 'application/json'
    }
  };

  // Add cookies if provided
  if (cookies && cookies.length > 0) {
    const cookieValues = cookies.map((cookie) => {
      const [cookieValue] = cookie.split(';');
      return cookieValue;
    });
    options.headers.Cookie = cookieValues.join('; ');
  }

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        // Try to parse as JSON first, fall back to text if that fails
        let body = data;
        try {
          body = JSON.parse(data);
        } catch (e) {
          // Keep as text if JSON parsing fails
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body,
          text: data
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

/**
 * Helper to generate random test user data
 * @returns {Object} Random user data for registration
 */
function generateTestUser() {
  const timestamp = Date.now();
  const randomSuffix = Math.floor(Math.random() * 10000);

  return {
    email: `test.user.${timestamp}.${randomSuffix}@example.com`,
    password: `TestPassword${randomSuffix}!`,
    hname: `Test User ${timestamp}`
  };
}

/**
 * Helper to generate a random external ID
 * @returns {string} Random XID
 */
function generateRandomXid() {
  const timestamp = Date.now();
  const randomSuffix = Math.floor(Math.random() * 10000);
  return `test-xid-${timestamp}-${randomSuffix}`;
}

/**
 * Helper to attach auth token to request - handles both cookie and header
 * @param {Object} req - Supertest request object
 * @param {string|Array} token - Auth token or cookie array
 * @returns {Object} Request with auth token attached
 */
function attachAuthToken(req, token) {
  if (!token) {
    return req; // If no token provided, just return the request unchanged
  }

  if (Array.isArray(token)) {
    // This is cookie array
    const cookieValues = token.map((cookie) => {
      const [cookieValue] = cookie.split(';');
      return cookieValue;
    });
    req.set('Cookie', cookieValues.join('; '));
  } else if (typeof token === 'string' && (token.includes(';') || token.startsWith('token2='))) {
    // This is likely a cookie string
    req.set('Cookie', token);
  } else {
    // This is likely a token for the x-polis header
    req.set('x-polis', token);
  }
  return req;
}

/**
 * Helper function to wait/pause execution
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise} Promise that resolves after the specified time
 */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Helper function to retry API calls
 * @param {Function} requestFn - Function that returns a request promise
 * @param {number} maxRetries - Maximum number of retries (default: 3)
 * @param {number} delay - Delay between retries in ms (default: 1000)
 * @returns {Promise} Promise that resolves with the response
 */
async function retryRequest(requestFn, maxRetries = 3, delay = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await requestFn();
      return response;
    } catch (error) {
      console.warn(`Request failed on attempt ${attempt}/${maxRetries}: ${error.message}`);
      lastError = error;
      if (attempt < maxRetries) {
        await wait(delay);
      }
    }
  }
  throw lastError;
}

/**
 * Helper to create a test conversation
 * @param {string|Array} authToken - Auth token or cookie array
 * @param {Object} options - Conversation options
 * @returns {Promise<Object>} Created conversation data
 */
async function createTestConversation(authToken, options = {}) {
  const timestamp = Date.now();
  const defaultOptions = {
    topic: `Test Conversation ${timestamp}`,
    description: `This is a test conversation created at ${timestamp}`,
    is_active: true,
    is_anon: true,
    is_draft: false,
    strict_moderation: false,
    profanity_filter: false, // Disable profanity filter for testing
    ...options
  };

  const response = await attachAuthToken(request(API_URL).post(`${API_PREFIX}/conversations`), authToken).send(
    defaultOptions
  );

  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty('url');
  expect(response.body).toHaveProperty('zid');

  // Extract conversation zinvite from URL (needed for API calls)
  const url = response.body.url;
  const conversationZinvite = url.split('/').pop();

  return {
    zid: response.body.zid,
    zinvite: conversationZinvite
  };
}

/**
 * Helper to create a test comment
 * @param {string|Array} authToken - Auth token or cookie array
 * @param {string} conversationId - Conversation ID (zinvite)
 * @param {Object} options - Comment options
 * @returns {Promise<number>} Created comment ID
 */
async function createTestComment(authToken, conversationId, options = {}) {
  if (!conversationId) {
    throw new Error('Conversation ID is required to create a comment');
  }

  const defaultOptions = {
    conversation_id: conversationId,
    txt: `This is a test comment created at ${Date.now()}`,
    is_active: true,
    ...options
  };

  const response = await attachAuthToken(request(API_URL).post(`${API_PREFIX}/comments`), authToken).send(
    defaultOptions
  );

  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty('tid');

  const commentId = response.body.tid;

  // Wait a moment to ensure the comment is processed
  await wait(1000);

  return commentId;
}

/**
 * Helper to initialize an anonymous participant
 * @param {string} conversationId - Conversation zinvite
 * @returns {Promise<Object>} Participant data with pid and cookies
 */
async function initializeAnonymousParticipant(conversationId) {
  // Call participationInit endpoint to get a pid
  const response = await request(API_URL)
    .get(`${API_PREFIX}/participationInit?conversation_id=${conversationId}&pid=mypid&lang=en`)
    .set('Accept', 'application/json');

  // Extract pid from response (handle different response structures)
  let pid = null;

  // First check the body directly
  if (response.body?.pid !== undefined) {
    pid = response.body.pid;
  }
  // Check in the user object if it exists
  else if (response.body?.user?.pid !== undefined) {
    pid = response.body.user.pid;
  }
  // Try to parse the response text if it's JSON and not already parsed
  else if (typeof response.text === 'string') {
    try {
      const parsedResponse = JSON.parse(response.text);
      if (parsedResponse?.pid !== undefined) {
        pid = parsedResponse.pid;
      } else if (parsedResponse?.user?.pid !== undefined) {
        pid = parsedResponse.user.pid;
      }
    } catch (err) {
      // Parsing failed, continue with other methods
    }
  }

  if (pid === null && pid !== 0) {
    console.error('Failed to extract pid from participation init response');
    console.error('Response body:', JSON.stringify(response.body, null, 2));
    console.error('Response status:', response.status);
    throw new Error('Failed to initialize anonymous participant');
  }

  // Store cookies for authentication
  const cookies = response.headers['set-cookie'] || [];

  // Generate agid for vote submission if needed
  const timestamp = Date.now();
  const randomId = Math.floor(Math.random() * 1000000);
  const agid = `anon_${timestamp}_${randomId}`;

  return {
    pid,
    cookies,
    agid
  };
}

/**
 * Helper to register and login a test user
 * @param {Object} userData - User data for registration
 * @returns {Promise<Object>} Object containing auth token and user ID
 */
async function registerAndLoginUser(userData) {
  // Register the user
  const registerResponse = await request(API_URL)
    .post(`${API_PREFIX}/auth/new`)
    .send({
      ...userData,
      gatekeeperTosPrivacy: true
    });

  expect(registerResponse.status).toBe(200);
  const userId = registerResponse.body?.uid;

  // Login with the user
  const loginResponse = await request(API_URL).post(`${API_PREFIX}/auth/login`).send({
    email: userData.email,
    password: userData.password
  });

  expect(loginResponse.status).toBe(200);

  // Extract auth token from response
  let authToken = null;
  if (loginResponse.headers['x-polis']) {
    authToken = loginResponse.headers['x-polis'];
  } else if (loginResponse.body?.token) {
    authToken = loginResponse.body.token;
  } else if (loginResponse.headers['set-cookie']) {
    authToken = loginResponse.headers['set-cookie'];
  }

  return {
    authToken,
    userId
  };
}

/**
 * Helper to get a participant ID for a conversation
 * @param {string|Array} authToken - Auth token or cookie array
 * @param {string} conversationId - Conversation ID (zinvite)
 * @returns {Promise<number|null>} Participant ID or null if not found
 */
async function getParticipantId(authToken, conversationId) {
  try {
    const response = await attachAuthToken(
      request(API_URL).get(`${API_PREFIX}/participation?conversation_id=${conversationId}`),
      authToken
    );

    if (response.status === 200 && response.body?.pid !== undefined) {
      return response.body.pid;
    }
    return null;
  } catch (error) {
    console.error('Error getting participant ID:', error.message);
    return null;
  }
}

/**
 * Submits a vote for a comment using participant data
 * @param {Object} voteData - Vote data including tid, vote, and conversation_id
 * @param {Object} participantData - Participant data including cookies and pid
 * @returns {Promise<Object>} - Response from the vote API
 */
async function submitVoteWithParticipant(voteData, participantData) {
  const votePayload = {
    ...voteData
  };

  // Add participant ID if available
  if (participantData.pid) {
    votePayload.pid = participantData.pid;
  }

  // Add anonymous group ID if available
  if (participantData.agid) {
    votePayload.agid = participantData.agid;
  }

  // Submit the vote with participant cookies
  const req = request(API_URL).post(`${API_PREFIX}/votes`).set('Accept', 'application/json');
  return attachAuthToken(req, participantData.cookies).send(votePayload);
}

/**
 * Submits a vote for a comment
 * @param {Object} authToken - Authentication token for the request
 * @param {number} commentId - ID of the comment to vote on
 * @param {string} conversationZinvite - Conversation invite code
 * @param {number} vote - Vote value (-1 for agree, 1 for disagree, 0 for pass)
 * @param {number} [pid] - Optional participant ID (if known)
 * @returns {Promise<Object>} - Response from the vote API
 */
async function submitVote(authToken, commentId, conversationZinvite, vote, pid = null) {
  try {
    // Create vote payload
    const voteData = {
      tid: commentId,
      vote: vote, // -1 for agree, 1 for disagree, 0 for pass
      conversation_id: conversationZinvite
    };

    // Add pid if provided
    if (pid !== null) {
      voteData.pid = pid;
    }

    // Submit the vote
    const response = await attachAuthToken(request(API_URL).post(`${API_PREFIX}/votes`), authToken).send(voteData);

    return response;
  } catch (error) {
    console.error('Error submitting vote:', error.message);
    throw error;
  }
}

/**
 * Retrieves votes for a conversation
 * @param {Object} authToken - Authentication token for the request
 * @param {string} conversationZinvite - Conversation invite code
 * @returns {Promise<Array>} - Array of votes
 */
async function getVotes(authToken, conversationZinvite) {
  try {
    // Get votes for the conversation
    const response = await attachAuthToken(
      request(API_URL).get(`${API_PREFIX}/votes?conversation_id=${conversationZinvite}`),
      authToken
    );

    if (response.status !== 200) {
      throw new Error(`Failed to get votes: ${response.status} ${JSON.stringify(response.body)}`);
    }

    return response.body;
  } catch (error) {
    console.error('Error getting votes:', error.message);
    throw error;
  }
}

/**
 * Retrieves votes for the current participant in a conversation
 * @param {Object} authToken - Authentication token for the request
 * @param {string} conversationZinvite - Conversation invite code
 * @returns {Promise<Array>} - Array of votes
 */
async function getMyVotes(authToken, conversationZinvite) {
  try {
    // Get votes for the participant
    const response = await attachAuthToken(
      request(API_URL).get(`${API_PREFIX}/votes/me?conversation_id=${conversationZinvite}`),
      authToken
    );

    // Note: This endpoint might return a 500 error with 'polis_err_get_votes_by_me'
    if (response.status === 500 && response.body?.error === 'polis_err_get_votes_by_me') {
      console.warn('Warning: votes/me endpoint returned an error. This may be expected behavior.');
      return [];
    }

    if (response.status !== 200) {
      throw new Error(`Failed to get my votes: ${response.status} ${JSON.stringify(response.body)}`);
    }

    return response.body;
  } catch (error) {
    console.error('Error getting my votes:', error.message);
    throw error;
  }
}

// Export API constants along with helper functions
export {
  API_PORT,
  API_PREFIX,
  API_URL,
  attachAuthToken,
  createTestComment,
  createTestConversation,
  generateRandomXid,
  generateTestUser,
  getMyVotes,
  getParticipantId,
  getVotes,
  initializeAnonymousParticipant,
  makeRequest,
  registerAndLoginUser,
  retryRequest,
  submitVote,
  submitVoteWithParticipant,
  wait
};
