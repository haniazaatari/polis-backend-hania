import http from 'http';
import dotenv from 'dotenv';

// Use { override: false } to prevent dotenv from overriding command-line env vars
dotenv.config({ override: false });

// API constants - export these for use in test files
const API_PORT = process.env.API_SERVER_PORT || 5000;
const API_URL = process.env.API_URL || `http://localhost:${API_PORT}`;
const API_PREFIX = '/api/v3';

/**
 * Helper function to make HTTP requests that can handle both JSON and text responses
 * This is needed because the legacy server sometimes sends text responses with JSON content-type
 */
async function makeRequest(method, path, data = null, token = null) {
  const options = {
    hostname: 'localhost',
    port: API_PORT,
    path: `${API_PREFIX}${path}`,
    method: method.toUpperCase(),
    headers: {
      'Content-Type': 'application/json'
    }
  };

  // Use attachAuthToken's logic for handling auth tokens
  if (token) {
    if (Array.isArray(token)) {
      // This is cookie array
      const cookieValues = token.map((cookie) => cookie.split(';')[0]);
      options.headers.Cookie = cookieValues.join('; ');
    } else if (typeof token === 'string' && (token.includes(';') || token.startsWith('token2='))) {
      // This is likely a cookie string
      options.headers.Cookie = token;
    } else {
      // This is likely a token for the x-polis header
      options.headers['x-polis'] = token;
    }
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
          // Only try to parse as JSON if content-type includes json
          const contentType = res.headers['content-type'] || '';
          if (contentType.includes('json')) {
            body = JSON.parse(data);
          }
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
      console.error('request error', error);
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

/**
 * Helper function to make HTTP requests with timeout and retry capabilities.
 * Use this for endpoints known to be problematic in the legacy server.
 */
async function makeRequestWithTimeout(method, path, data = null, cookies = null, options = {}) {
  const {
    timeout = 3000, // Default 3s timeout
    retries = 1, // Default 1 retry
    retryDelay = 1000 // Default 1s between retries
  } = options;

  const makeRequestWithTimer = () => {
    return Promise.race([
      makeRequest(method, path, data, cookies),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Request timed out after ${timeout}ms`)), timeout))
    ]);
  };

  // If no retries requested, just do the timeout wrapped call
  if (retries <= 1) {
    return makeRequestWithTimer();
  }

  // Otherwise use our existing retry mechanism with the timeout wrapper
  return retryRequest(makeRequestWithTimer, retries, retryDelay);
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

  const response = await makeRequest('POST', '/conversations', defaultOptions, authToken);

  // Validate response
  validateResponse(response, {
    expectedStatus: 200,
    errorPrefix: 'Failed to create conversation',
    requiredProperties: ['body.url']
  });

  // Extract conversation zinvite from URL (needed for API calls)
  const url = response.body.url;
  const zinvite = url.split('/').pop();

  // Handle both legacy and new response formats
  const zid = getResponseProperty(response, 'body.zid', getResponseProperty(response, 'body.conversation_id'));

  if (zid === null) {
    throw new Error('Conversation creation succeeded but no conversation ID was returned');
  }

  await wait(1000); // Wait for conversation to be created

  return {
    zid,
    zinvite: zinvite
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
    agid: 1,
    conversation_id: conversationId,
    is_active: true,
    pid: 'mypid',
    txt: `This is a test comment created at ${Date.now()}`,
    ...options
  };

  const response = await makeRequest('POST', '/comments', defaultOptions, authToken);

  // Validate response
  validateResponse(response, {
    expectedStatus: 200,
    errorPrefix: 'Failed to create comment',
    requiredProperties: ['body.tid']
  });

  const commentId = response.body.tid;
  await wait(1000); // Wait for comment to be created

  return commentId;
}

/**
 * Helper function to extract a specific cookie value from a cookie array
 * @param {Array} cookies - Array of cookies from response
 * @param {string} cookieName - Name of the cookie to extract
 * @returns {string|null} Cookie value or null if not found
 */
function extractCookieValue(cookies, cookieName) {
  if (!cookies || !Array.isArray(cookies) || cookies.length === 0) {
    return null;
  }

  for (const cookie of cookies) {
    if (cookie.startsWith(`${cookieName}=`)) {
      return cookie.split(`${cookieName}=`)[1].split(';')[0];
    }
  }

  return null;
}

/**
 * Improved helper to initialize an anonymous participant with better cookie handling
 * @param {string} conversationId - Conversation zinvite
 * @returns {Promise<Object>} Participant data with cookies, body, and status
 */
async function initializeParticipant(conversationId) {
  const response = await makeRequestWithTimeout(
    'GET',
    `/participationInit?conversation_id=${conversationId}&pid=mypid&lang=acceptLang`,
    null,
    null,
    { timeout: 5000 }
  );

  if (response.status !== 200) {
    console.error('Failed to initialize participant - status:', response.status);
    console.error('Response body:', response.body || response.text);
    throw new Error(`Failed to initialize anonymous participant. Status: ${response.status}`);
  }

  // Extract cookies - critical for participant authentication
  const cookies = response.headers['set-cookie'] || [];

  return {
    cookies,
    body: response.body,
    status: response.status
  };
}

/**
 * Initialize a participant with an XID for embedded use cases
 * @param {string} conversationId - Conversation zinvite
 * @param {string} xid - External ID (generated or provided)
 * @returns {Promise<Object>} Participant data including cookies, body, and status
 */
async function initializeParticipantWithXid(conversationId, xid = null) {
  // Generate XID if not provided
  const participantXid = xid || generateRandomXid();

  const response = await makeRequestWithTimeout(
    'GET',
    `/participationInit?conversation_id=${conversationId}&xid=${participantXid}&pid=mypid&lang=acceptLang`,
    null,
    null,
    { timeout: 5000 }
  );

  if (response.status !== 200) {
    console.error('Failed to initialize participant with XID - status:', response.status);
    console.error('Response body:', response.body || response.text);
    throw new Error(`Failed to initialize participant with XID. Status: ${response.status}`);
  }

  // Extract cookies
  const cookies = response.headers['set-cookie'] || [];

  return {
    cookies,
    body: response.body,
    status: response.status
  };
}

/**
 * Helper to register and login a test user
 * @param {Object} userData - User data for registration
 * @returns {Promise<Object>} Object containing auth token and user ID
 */
async function registerAndLoginUser(userData) {
  // Register the user
  const registerResponse = await makeRequest('POST', '/auth/new', {
    ...userData,
    gatekeeperTosPrivacy: true
  });

  // Validate registration response
  validateResponse(registerResponse, {
    expectedStatus: 200,
    errorPrefix: 'Failed to register user',
    requiredProperties: ['body.uid']
  });

  const userId = registerResponse.body.uid;
  await wait(1000); // Wait for registration to complete

  // Login with the user
  const loginResponse = await makeRequest('POST', '/auth/login', {
    email: userData.email,
    password: userData.password
  });

  // Validate login response
  validateResponse(loginResponse, {
    expectedStatus: 200,
    errorPrefix: 'Failed to login user'
  });

  // Extract auth token from response
  const authToken =
    loginResponse.headers['x-polis'] ||
    (loginResponse.headers['set-cookie'] ? loginResponse.headers['set-cookie'] : null);

  if (!authToken) {
    throw new Error('Login succeeded but no authentication token was returned');
  }

  return {
    authToken,
    userId
  };
}

/**
 * Retrieves votes for a conversation
 * @param {Object} authToken - Authentication token for the request
 * @param {string} zinvite - Conversation invite code
 * @param {number} pid - Participant ID
 * @returns {Promise<Array>} - Array of votes
 */
async function getVotes(authToken, zinvite, pid) {
  try {
    // Get votes for the conversation
    const response = await makeRequest('GET', `/votes?conversation_id=${zinvite}&pid=${pid}`, null, authToken);

    // Validate response
    validateResponse(response, {
      expectedStatus: 200,
      errorPrefix: 'Failed to get votes'
    });

    return response.body;
  } catch (error) {
    console.error('Error getting votes:', error.message);
    throw error;
  }
}

/**
 * Retrieves votes for the current participant in a conversation
 * @param {Object} authToken - Authentication token for the request
 * @param {string} zinvite - Conversation invite code
 * @returns {Promise<Array>} - Array of votes
 */
async function getMyVotes(authToken, zinvite) {
  try {
    // Get votes for the participant
    const response = await makeRequest('GET', `/votes/me?conversation_id=${zinvite}`, null, authToken);

    // Validate response
    validateResponse(response, {
      expectedStatus: 200,
      errorPrefix: 'Failed to get my votes'
    });

    // NOTE: This endpoint seems to return a 200 status with an empty array.
    return response.body;
  } catch (error) {
    console.error('Error getting my votes:', error.message);
    throw error;
  }
}

/**
 * Submits a vote for a comment
 * @param {Object} options - Vote options (tid, conversation_id, vote, etc)
 * @param {Object} authToken - Authentication token for the request
 * @returns {Promise<Object>} - Response from the vote API
 */
async function submitVote(options, authToken) {
  // Error if options does not have tid or conversation_id
  // NOTE: 0 is a valid value for tid or conversation_id
  if (options.tid === undefined || options.conversation_id === undefined) {
    throw new Error('Options must have tid or conversation_id');
  }

  try {
    // Create vote payload
    const voteData = Object.assign(
      {
        agid: 1, // Always include agid=1 for consistency
        high_priority: false,
        lang: 'en',
        pid: 'mypid',
        vote: 0
      },
      options
    );

    // Submit the vote using makeRequest instead of supertest
    // This handles the content-type mismatch issues more gracefully
    const response = await makeRequest('POST', '/votes', voteData, authToken);

    // Don't use validateResponse here as we want to handle multiple status codes
    // Legacy server can return error responses that are also valid test outcomes
    await wait(1000); // Wait for vote to be processed

    return {
      cookies: response.headers['set-cookie'] || [],
      body: response.body,
      status: response.status
    };
  } catch (error) {
    console.error('Error submitting vote:', error.message);
    throw error;
  }
}

/**
 * Sets up authentication for tests - registers user, logs in, creates test conversation
 * @param {Object} options - Options for setup
 * @returns {Promise<Object>} Object containing auth token, userId, and conversation info
 */
async function setupAuthForTest(options = {}) {
  const { createConversation = true } = options;
  const testUser = generateTestUser();

  // Register and login
  const { authToken, userId } = await registerAndLoginUser(testUser);

  let conversationData = {};

  // Create test conversation if requested
  if (createConversation) {
    const conversation = await createTestConversation(authToken, options.conversationOptions || {});
    conversationData = {
      conversationId: conversation.zid,
      conversationZinvite: conversation.zinvite
    };

    // Create test comments if commentCount is specified
    if (options.commentCount && options.commentCount > 0) {
      const commentIds = [];
      for (let i = 0; i < options.commentCount; i++) {
        const commentId = await createTestComment(
          authToken,
          conversation.zinvite,
          options.commentOptions || { txt: `Test comment ${i + 1}` }
        );
        commentIds.push(commentId);
      }
      conversationData.commentIds = commentIds;
    }
  }

  return {
    authToken,
    userId,
    testUser,
    ...conversationData
  };
}

/**
 * Utility function to safely check for response properties, handling falsy values correctly
 * @param {Object} response - API response object
 * @param {string} propertyPath - Dot-notation path to property (e.g., 'body.tid')
 * @returns {boolean} - True if property exists and is not undefined/null
 */
function hasResponseProperty(response, propertyPath) {
  if (!response) return false;

  const parts = propertyPath.split('.');
  let current = response;

  for (const part of parts) {
    // 0, false, and empty string are valid values
    if (current[part] === undefined || current[part] === null) {
      return false;
    }
    current = current[part];
  }

  return true;
}

/**
 * Utility function to safely get response property value, with proper handling for IDs that might be 0
 * @param {Object} response - API response object
 * @param {string} propertyPath - Dot-notation path to property (e.g., 'body.tid')
 * @param {*} defaultValue - Default value to return if property doesn't exist
 * @returns {*} - Property value or default
 */
function getResponseProperty(response, propertyPath, defaultValue = null) {
  if (!response) return defaultValue;

  const parts = propertyPath.split('.');
  let current = response;

  for (const part of parts) {
    // Check explicitly for undefined/null (not falsy check)
    if (current[part] === undefined || current[part] === null) {
      return defaultValue;
    }
    current = current[part];
  }

  return current;
}

/**
 * Formats an error message from a response
 * @param {Object} response - The API response
 * @param {string} prefix - Error message prefix
 * @returns {string} - Formatted error message
 */
function formatErrorMessage(response, prefix = 'API error') {
  const errorMessage =
    typeof response.body === 'string' ? response.body : response.text || JSON.stringify(response.body);
  return `${prefix}: ${response.status} ${errorMessage}`;
}

/**
 * Validates a response and throws an error if invalid
 * @param {Object} response - The API response
 * @param {Object} options - Validation options
 * @returns {Object} - The response if valid
 * @throws {Error} - If response is invalid
 */
function validateResponse(response, options = {}) {
  const { expectedStatus = 200, errorPrefix = 'API error', requiredProperties = [] } = options;

  // Check status
  if (response.status !== expectedStatus) {
    throw new Error(formatErrorMessage(response, errorPrefix));
  }

  // Check required properties
  for (const prop of requiredProperties) {
    if (!hasResponseProperty(response, prop)) {
      throw new Error(`${errorPrefix}: Missing required property '${prop}'`);
    }
  }

  return response;
}

// Export API constants along with helper functions
export {
  API_PREFIX,
  API_URL,
  attachAuthToken,
  createTestComment,
  createTestConversation,
  extractCookieValue,
  generateRandomXid,
  generateTestUser,
  getMyVotes,
  getVotes,
  initializeParticipant,
  initializeParticipantWithXid,
  makeRequest,
  makeRequestWithTimeout,
  registerAndLoginUser,
  setupAuthForTest,
  submitVote,
  wait
};
