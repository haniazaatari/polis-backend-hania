import dotenv from 'dotenv';
import request from 'supertest';

// Import the Express app
import app from '../../app.js';

// Use { override: false } to prevent dotenv from overriding command-line env vars
dotenv.config({ override: false });

// Set environment variable to indicate we're running in test mode
process.env.NODE_ENV = 'test';
process.env.TESTING = 'true';

// Ensure global agents exist - this is critical for when the file is imported directly
// without going through globalSetup.js first
if (!global.__TEST_AGENT__) {
  global.__TEST_AGENT__ = request.agent(app);
}

if (!global.__TEXT_AGENT__) {
  global.__TEXT_AGENT__ = createTextAgent(app);
}

// Reference the global agents - use getters to ensure we always get the latest instance
function getTestAgent() {
  if (!global.__TEST_AGENT__) {
    global.__TEST_AGENT__ = request.agent(app);
  }
  return global.__TEST_AGENT__;
}

function getTextAgent() {
  if (!global.__TEXT_AGENT__) {
    global.__TEXT_AGENT__ = createTextAgent(app);
  }
  return global.__TEXT_AGENT__;
}

function newAgent() {
  return request.agent(app);
}

function newTextAgent() {
  return createTextAgent(app);
}

/**
 * Create an agent that handles text responses properly
 * Use this when you need to maintain cookies across requests but still handle text responses
 *
 * @param {Object} app - Express app instance
 * @returns {Object} - Supertest agent with custom parser
 */
function createTextAgent(app) {
  const agent = request.agent(app);
  agent.parse((res, fn) => {
    res.setEncoding('utf8');
    res.text = '';
    res.on('data', (chunk) => {
      res.text += chunk;
    });
    res.on('end', () => {
      fn(null, res.text);
    });
  });
  return agent;
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
 * Helper function to wait/pause execution
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise} Promise that resolves after the specified time
 */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Helper to create a test conversation using a supertest agent
 * @param {Object} agent - Supertest agent to use for the request
 * @param {Object} options - Conversation options
 * @returns {Promise<string>} Created conversation ID (zinvite)
 */
async function createConversation(agent, options = {}) {
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

  const response = await agent.post('/api/v3/conversations').send(defaultOptions);

  // Validate response
  if (response.status !== 200) {
    throw new Error(`Failed to create conversation: ${response.status} ${response.text}`);
  }

  try {
    // Try to parse the response text as JSON
    const jsonData = JSON.parse(response.text);
    return jsonData.conversation_id;
  } catch (error) {
    throw new Error(`Failed to parse conversation response: ${error.message}, Response: ${response.text}`);
  }
}

/**
 * Helper to create a test comment using a supertest agent
 * @param {Object} agent - Supertest agent to use for the request
 * @param {string} conversationId - Conversation ID (zinvite)
 * @param {Object} options - Comment options
 * @returns {Promise<number>} Created comment ID
 */
async function createComment(agent, conversationId, options = {}) {
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

  const response = await agent.post('/api/v3/comments').send(defaultOptions);

  // Validate response
  if (response.status !== 200) {
    throw new Error(`Failed to create comment: ${response.status} ${response.text}`);
  }

  const responseBody = parseResponseJSON(response);
  const commentId = responseBody.tid;
  const cookies = response.headers['set-cookie'] || [];
  authenticateAgent(agent, cookies);

  await wait(500); // Wait for comment to be created

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
 * Enhanced registerAndLoginUser that works with supertest agents
 * Maintains the same API as the original function but uses agents internally
 *
 * @param {Object} userData - User data for registration
 * @returns {Promise<Object>} Object containing authToken and userId
 */
async function registerAndLoginUser(userData = null) {
  const agent = getTestAgent();
  const textAgent = getTextAgent();

  // Generate user data if not provided
  const testUser = userData || generateTestUser();

  // Register the user
  const registerResponse = await textAgent.post('/api/v3/auth/new').send({
    ...testUser,
    password2: testUser.password,
    gatekeeperTosPrivacy: true
  });

  // Validate registration response
  if (registerResponse.status !== 200) {
    throw new Error(`Failed to register user: ${registerResponse.status} ${registerResponse.text}`);
  }

  await wait(1000); // Wait for registration to complete

  // Login with the user
  const loginResponse = await agent.post('/api/v3/auth/login').send({
    email: testUser.email,
    password: testUser.password
  });

  // Validate login response
  if (loginResponse.status !== 200) {
    throw new Error(`Failed to login user: ${loginResponse.status} ${loginResponse.text}`);
  }

  const loginBody = parseResponseJSON(loginResponse);

  // Get cookies for API compatibility
  const loginCookies = loginResponse.headers['set-cookie'] || [];
  authenticateGlobalAgents(loginCookies);

  // For compatibility with existing tests
  return {
    cookies: loginCookies,
    userId: loginBody.uid,
    agent, // Return the authenticated agent
    textAgent // Return the text agent for error cases
  };
}

/**
 * Enhanced setupAuthAndConvo that works with supertest agents
 * Maintains the same API as the original function but uses agents internally
 *
 * @param {Object} options - Options for setup
 * @returns {Promise<Object>} Object containing auth token, userId, and conversation info
 */
async function setupAuthAndConvo(options = {}) {
  const { createConvo = true, commentCount = 1, conversationOptions = {}, commentOptions = {} } = options;
  const agent = getTestAgent();

  // Register and login
  const testUser = options.userData || generateTestUser();
  const { userId } = await registerAndLoginUser(testUser);

  const commentIds = [];
  let conversationId;

  // Create test conversation if requested
  if (createConvo) {
    const timestamp = Date.now();
    const convoOptions = {
      topic: `Test Conversation ${timestamp}`,
      description: `This is a test conversation created at ${timestamp}`,
      is_active: true,
      is_anon: true,
      is_draft: false,
      strict_moderation: false,
      profanity_filter: false,
      ...conversationOptions
    };

    conversationId = await createConversation(agent, convoOptions);

    if (conversationId === null || conversationId === undefined) {
      throw new Error('Failed to create conversation');
    }

    await wait(500); // Wait for conversation to be created

    // Create test comments if commentCount is specified
    if (commentCount > 0) {
      for (let i = 0; i < commentCount; i++) {
        const commentData = {
          conversation_id: conversationId,
          txt: `Test comment ${i + 1}`,
          ...commentOptions
        };

        const commentId = await createComment(agent, conversationId, commentData);

        if (commentId == null || commentId === undefined) {
          throw new Error('Failed to create comment');
        }

        commentIds.push(commentId);

        await wait(300); // Small delay between comment creations
      }
    }
  }

  return {
    userId,
    testUser,
    conversationId,
    commentIds
  };
}

/**
 * Enhanced helper to initialize a participant with better cookie handling using supertest agents
 *
 * @param {string} conversationId - Conversation zinvite
 * @returns {Promise<Object>} Participant data with cookies, body, status and agent
 */
async function initializeParticipant(conversationId) {
  const participantAgent = newAgent();

  const response = await participantAgent.get(
    `/api/v3/participationInit?conversation_id=${conversationId}&pid=mypid&lang=en`
  );

  if (response.status !== 200) {
    throw new Error(`Failed to initialize anonymous participant. Status: ${response.status}`);
  }

  // Extract cookies
  const cookies = response.headers['set-cookie'] || [];
  authenticateAgent(participantAgent, cookies);

  return {
    cookies,
    body: parseResponseJSON(response),
    status: response.status,
    agent: participantAgent // Return an authenticated agent for the participant
  };
}

/**
 * Enhanced initializeParticipantWithXid using supertest agents
 *
 * @param {string} conversationId - Conversation zinvite
 * @param {string} xid - External ID (generated or provided)
 * @returns {Promise<Object>} Participant data including cookies, body, status and agent
 */
async function initializeParticipantWithXid(conversationId, xid = null) {
  const participantAgent = newAgent();

  // Generate XID if not provided
  const participantXid = xid || generateRandomXid();

  const response = await participantAgent.get(
    `/api/v3/participationInit?conversation_id=${conversationId}&xid=${participantXid}&pid=mypid&lang=en`
  );

  if (response.status !== 200) {
    throw new Error(`Failed to initialize participant with XID. Status: ${response.status}`);
  }

  // Extract cookies
  const cookies = response.headers['set-cookie'] || [];
  authenticateAgent(participantAgent, cookies);

  return {
    cookies,
    body: parseResponseJSON(response),
    status: response.status,
    agent: participantAgent, // Return an authenticated agent for the participant
    xid: participantXid // Return the XID that was used
  };
}

/**
 * Enhanced submitVote using supertest agents
 *
 * @param {Object} options - Vote options
 * @param {Object|Array} authToken - Auth token or cookies
 * @returns {Promise<Object>} Vote response
 */
async function submitVote(agent, options = {}) {
  // Error if options does not have tid or conversation_id
  // NOTE: 0 is a valid value for tid or conversation_id
  if (options.tid === undefined || options.conversation_id === undefined) {
    throw new Error('Options must have tid or conversation_id to vote');
  }
  const voterAgent = agent || getTestAgent();

  // Create vote payload
  const voteData = {
    agid: 1,
    high_priority: false,
    lang: 'en',
    pid: 'mypid',
    vote: 0,
    ...options
  };

  const response = await voterAgent.post('/api/v3/votes').send(voteData);

  await wait(500); // Wait for vote to be processed

  const cookies = response.headers['set-cookie'] || [];
  authenticateAgent(voterAgent, cookies);

  return {
    cookies,
    body: parseResponseJSON(response),
    text: response.text,
    status: response.status,
    agent: voterAgent // Return the agent for chaining
  };
}

/**
 * Retrieves votes for a conversation
 * @param {Object} agent - Supertest agent
 * @param {string} conversationId - Conversation ID
 * @param {number} pid - Participant ID
 * @returns {Promise<Array>} - Array of votes
 */
async function getVotes(agent, conversationId, pid) {
  // Get votes for the conversation
  const response = await agent.get(`/api/v3/votes?conversation_id=${conversationId}&pid=${pid}`);

  // Validate response
  validateResponse(response, {
    expectedStatus: 200,
    errorPrefix: 'Failed to get votes'
  });

  return response.body;
}

/**
 * Retrieves votes for the current participant in a conversation
 * @param {Object} agent - Supertest agent
 * @param {string} conversationId - Conversation ID
 * @param {number} pid - Participant ID
 * @returns {Promise<Array>} - Array of votes
 */
async function getMyVotes(agent, conversationId, pid) {
  // Get votes for the participant
  const response = await agent.get(`/api/v3/votes/me?conversation_id=${conversationId}&pid=${pid}`);

  // Validate response
  validateResponse(response, {
    expectedStatus: 200,
    errorPrefix: 'Failed to get my votes'
  });

  // NOTE: This endpoint seems to return a 200 status with an empty array.
  return response.body;
}

/**
 * Updates a conversation using query params
 * @param {Object} agent - Supertest agent
 * @param {Object} params - Update parameters
 * @returns {Promise<Object>} - API response
 */
async function updateConversation(agent, params = {}) {
  if (params.conversation_id === undefined) {
    throw new Error('conversation_id is required to update a conversation');
  }

  return agent.put('/api/v3/conversations').send(params);
}

/**
 * Helper function to safely check for response properties, handling falsy values correctly
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

/**
 * Helper function to authenticate a supertest agent with a token
 * @param {Object} agent - The supertest agent to authenticate
 * @param {string|Array} token - Auth token or cookie array
 * @returns {Object} - The authenticated agent (for chaining)
 */
function authenticateAgent(agent, token) {
  if (!token || token.length === 0) {
    return agent;
  }

  if (Array.isArray(token)) {
    // Handle cookie array
    const cookieString = token.map((c) => c.split(';')[0]).join('; ');
    agent.set('Cookie', cookieString);
  } else if (typeof token === 'string' && (token.includes(';') || token.startsWith('token2='))) {
    // Handle cookie string
    agent.set('Cookie', token);
  } else {
    // Handle x-polis token
    agent.set('x-polis', token);
  }

  return agent;
}

/**
 * Helper function to authenticate both global agents with the same token
 * Use this when you need to maintain the same auth state across both agents
 *
 * @param {string|Array} token - Auth token or cookie array
 * @returns {Object} - Object containing both authenticated agents
 */
function authenticateGlobalAgents(token) {
  const agent = getTestAgent();
  const textAgent = getTextAgent();

  if (!token || token.length === 0) {
    return { agent, textAgent };
  }

  if (Array.isArray(token)) {
    // Handle cookie array
    const cookieString = token.map((c) => c.split(';')[0]).join('; ');
    agent.set('Cookie', cookieString);
    textAgent.set('Cookie', cookieString);
  } else if (typeof token === 'string' && (token.includes(';') || token.startsWith('token2='))) {
    // Handle cookie string
    agent.set('Cookie', token);
    textAgent.set('Cookie', token);
  } else {
    // Handle x-polis token
    agent.set('x-polis', token);
    textAgent.set('x-polis', token);
  }

  return { agent, textAgent };
}

/**
 * Helper to parse response text safely
 *
 * @param {Object} response - Response object
 * @returns {Object} Parsed JSON or empty object
 */
function parseResponseJSON(response) {
  try {
    if (response?.text) {
      return JSON.parse(response.text);
    }
    return {};
  } catch (e) {
    console.error('Error parsing JSON response:', e);
    return {};
  }
}

// Export API constants along with helper functions
export {
  authenticateAgent,
  authenticateGlobalAgents,
  createComment,
  createConversation,
  createTextAgent,
  extractCookieValue,
  generateRandomXid,
  generateTestUser,
  getMyVotes,
  getTestAgent,
  getTextAgent,
  getVotes,
  initializeParticipant,
  initializeParticipantWithXid,
  newAgent,
  newTextAgent,
  parseResponseJSON,
  registerAndLoginUser,
  setupAuthAndConvo,
  submitVote,
  updateConversation,
  wait
};
