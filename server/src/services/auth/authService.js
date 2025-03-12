import * as userRepository from '../../repositories/user/userRepository.js';
import logger from '../../utils/logger.js';
import * as conversationService from '../conversation/conversationService.js';
import { getUidForApiKey } from '../user/userService.js';
import * as userService from '../user/userService.js';
import { COOKIES } from './constants.js';
import { verifyPassword } from './passwordService.js';
import { getUserIdForToken } from './tokenService.js';

/**
 * Check if a request has an auth token cookie
 * @param {Object} req - Express request object
 * @returns {boolean} - Whether the request has an auth token cookie
 */
function hasAuthToken(req) {
  return !!req.cookies[COOKIES.TOKEN];
}

/**
 * Authenticate a user based on request
 * @param {Object} req - Express request object
 * @returns {Promise<Object>} - Authentication result
 */
async function authenticateUser(req) {
  try {
    // Try to authenticate with various methods
    let authResult = null;

    // Helper function to get a value from request body, headers, or query params
    const getKey = (key) => req.body?.[key] || req.headers?.[key] || req.query?.[key];

    // Check for x-polis header
    const xPolisToken = req.headers?.['x-polis'];
    if (xPolisToken) {
      logger.info('authtype: header token (x-polis)');
      authResult = await authenticateWithHeader(xPolisToken, req);
      if (authResult?.uid) {
        return authResult;
      }
    }

    // Check for API key in various places
    const polisApiKey = getKey('polisApiKey');
    const ownerXid = getKey('ownerXid');
    const xid = getKey('xid') || req.headers?.['x-xid'];

    // Check for polisApiKey + ownerXid
    if (polisApiKey && ownerXid) {
      authResult = await authenticateWithXidApiKey(polisApiKey, ownerXid, req);
      if (authResult?.uid) {
        return authResult;
      }
    }

    // Check for polisApiKey + xid
    if (polisApiKey && xid) {
      authResult = await authenticateWithXidApiKey(polisApiKey, xid, req);
      if (authResult?.uid) {
        return authResult;
      }
    }

    // Check for xid + conversation_id
    const conversation_id = getKey('conversation_id');
    if (xid && conversation_id) {
      authResult = await authenticateWithXidConversation(xid, conversation_id, req);
      if (authResult?.uid) {
        return authResult;
      }
    }

    // Check for Sandstorm API key
    const sandstormApiKey = req.headers?.['x-sandstorm-app-polis-apikey'];
    if (sandstormApiKey) {
      authResult = await authenticateWithApiKey(sandstormApiKey);
      if (authResult?.uid) {
        return authResult;
      }
    }

    // Check for polisApiKey in body
    if (polisApiKey) {
      authResult = await authenticateWithApiKey(polisApiKey);
      if (authResult?.uid) {
        return authResult;
      }
    }

    // Check for session token in cookies
    const token = req.cookies?.token;
    if (token) {
      authResult = await authenticateWithCookie(token, req);
      if (authResult?.uid) {
        return authResult;
      }
    }

    // Check for Basic Auth
    const authHeader = req.headers?.authorization;
    if (authHeader?.startsWith('Basic ')) {
      authResult = await authenticateWithBasicAuth(authHeader);
      if (authResult?.uid) {
        return authResult;
      }
    }

    // No authentication method succeeded
    return { isAuthenticated: false };
  } catch (error) {
    logger.error('Error authenticating user', error);
    throw error;
  }
}

/**
 * Authenticate a user with email and password
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<Object>} - Authentication result
 */
async function authenticateWithCredentials(email, password) {
  try {
    // Get user by email
    const user = await userRepository.getUserByEmail(email);
    if (!user) {
      return { isAuthenticated: false, error: 'user_not_found' };
    }

    // Check if user is verified
    if (!user.is_verified) {
      return { isAuthenticated: false, error: 'user_not_verified' };
    }

    // Get password hash
    const hashedPassword = await userRepository.getPasswordHash(user.uid);
    if (!hashedPassword) {
      return { isAuthenticated: false, error: 'password_not_set' };
    }

    // Verify password
    const isPasswordValid = await verifyPassword(password, hashedPassword);
    if (!isPasswordValid) {
      return { isAuthenticated: false, error: 'invalid_password' };
    }

    // Authentication successful
    return {
      isAuthenticated: true,
      uid: user.uid,
      email: user.email,
      hname: user.hname
    };
  } catch (error) {
    logger.error('Error authenticating with credentials', error);
    throw error;
  }
}

/**
 * Authenticate with a token from header
 * @param {string} token - Authentication token
 * @param {Object} req - Express request object
 * @returns {Promise<Object>} - Authentication result
 */
async function authenticateWithHeader(token, req) {
  try {
    const uid = await getUserIdForToken(token);
    if (!uid) {
      return { isAuthenticated: false };
    }

    // Check if the UID in the request body matches the token's UID
    if (req?.body?.uid && req.body.uid !== uid) {
      return {
        isAuthenticated: false,
        error: 'polis_err_auth_mismatch_uid',
        status: 401
      };
    }

    return {
      isAuthenticated: true,
      uid
    };
  } catch (error) {
    logger.error('Error authenticating with header token', error);
    throw error;
  }
}

/**
 * Authenticate with an API key
 * @param {string} apiKey - API key
 * @returns {Promise<Object>} - Authentication result
 */
async function authenticateWithApiKey(apiKey) {
  try {
    const rows = await getUidForApiKey(apiKey);
    if (!rows || !rows.length) {
      return { isAuthenticated: false };
    }

    return {
      isAuthenticated: true,
      uid: Number(rows[0].uid)
    };
  } catch (error) {
    logger.error('Error authenticating with API key', error);
    throw error;
  }
}

/**
 * Authenticate with an API key and XID
 * @param {string} apiKey - API key
 * @param {string} xid - External ID
 * @param {Object} req - Express request object
 * @returns {Promise<Object>} - Authentication result
 */
async function authenticateWithXidApiKey(apiKey, xid, req) {
  try {
    // Get user ID for API key
    const rows = await getUidForApiKey(apiKey);
    if (!rows || !rows.length) {
      return { isAuthenticated: false };
    }

    const uidForApiKey = Number(rows[0].uid);

    // Get or create XID record with profile information
    const x_profile_image_url = req?.body?.x_profile_image_url || req?.query?.x_profile_image_url;
    const x_name = req?.body?.x_name || req?.query?.x_name;
    const x_email = req?.body?.x_email || req?.query?.x_email;
    const createIfMissing = !!req?.body?.agid || !!req?.query?.agid;

    const xidRows = await userService.getXidRecordByXidOwnerId(
      xid,
      uidForApiKey,
      undefined,
      x_profile_image_url,
      x_name,
      x_email,
      createIfMissing
    );

    if (!xidRows || !xidRows.length) {
      return { isAuthenticated: false };
    }

    return {
      isAuthenticated: true,
      uid: Number(xidRows[0].uid),
      xid
    };
  } catch (error) {
    logger.error('Error authenticating with XID API key', error);
    throw error;
  }
}

/**
 * Authenticate with XID and conversation ID
 * @param {string} xid - External ID
 * @param {string} conversationId - Conversation ID
 * @param {Object} req - Express request object
 * @returns {Promise<Object>} - Authentication result
 */
async function authenticateWithXidConversation(xid, conversationId, req) {
  try {
    // Get conversation information
    const conversation = await conversationService.getConversationInfoByConversationId(conversationId);
    if (!conversation) {
      return { isAuthenticated: false };
    }

    // Get or create XID record with profile information
    const x_profile_image_url = req?.body?.x_profile_image_url || req?.query?.x_profile_image_url;
    const x_name = req?.body?.x_name || req?.query?.x_name;
    const x_email = req?.body?.x_email || req?.query?.x_email;
    const createIfMissing = !!req?.body?.agid || !!req?.query?.agid;

    const rows = await userService.getXidRecordByXidOwnerId(
      xid,
      conversation.org_id,
      conversation.zid,
      x_profile_image_url,
      x_name,
      x_email,
      createIfMissing
    );

    if (!rows || !rows.length) {
      return { isAuthenticated: false };
    }

    const uid = Number(rows[0].uid);

    return {
      isAuthenticated: true,
      uid
    };
  } catch (error) {
    logger.error('Error authenticating with XID and conversation ID', error);
    throw error;
  }
}

/**
 * Authenticate with a cookie token
 * @param {string} token - Session token
 * @param {Object} req - Express request object
 * @returns {Promise<Object>} - Authentication result
 */
async function authenticateWithCookie(token, req) {
  try {
    const uid = await getUserIdForToken(token);
    if (!uid) {
      return { isAuthenticated: false };
    }

    // Store the token in the request for later use
    req.token = token;

    return {
      isAuthenticated: true,
      uid
    };
  } catch (error) {
    logger.error('Error authenticating with cookie', error);
    throw error;
  }
}

/**
 * Parse a Basic Auth header
 * @param {string} authHeader - Authorization header
 * @returns {Object} - Parsed credentials
 */
function parseBasicAuthHeader(authHeader) {
  try {
    // Remove 'Basic ' prefix
    const base64Credentials = authHeader.slice(6);

    // Decode base64 credentials
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');

    // Split into username and password
    const [username, password] = credentials.split(':');

    return {
      username,
      password
    };
  } catch (error) {
    logger.error('Error parsing Basic Auth header', error);
    return {};
  }
}

/**
 * Authenticate with Basic Auth
 * @param {string} authHeader - Authorization header
 * @returns {Promise<Object>} - Authentication result
 */
async function authenticateWithBasicAuth(authHeader) {
  try {
    const { username } = parseBasicAuthHeader(authHeader);
    if (!username) {
      return { isAuthenticated: false };
    }

    // Treat the username as an API key
    const apiKey = username;
    return await authenticateWithApiKey(apiKey);
  } catch (error) {
    logger.error('Error authenticating with Basic Auth', error);
    throw error;
  }
}

/**
 * Create an anonymous user
 * @returns {Promise<number>} - Created user ID
 */
async function createAnonymousUser() {
  try {
    // Create a dummy user
    const uid = await userRepository.createDummyUser();
    return uid;
  } catch (error) {
    logger.error('Error creating anonymous user', error);
    throw error;
  }
}

/**
 * Check if a request is authenticated
 * @param {Object} req - Express request object
 * @returns {Promise<boolean>} - Whether the request is authenticated
 */
async function isAuthenticated(req) {
  try {
    const authResult = await authenticateUser(req);
    return authResult.isAuthenticated;
  } catch (error) {
    logger.error('Error checking if authenticated', error);
    return false;
  }
}

export {
  authenticateUser,
  authenticateWithCredentials,
  authenticateWithHeader,
  authenticateWithApiKey,
  authenticateWithXidApiKey,
  authenticateWithXidConversation,
  authenticateWithCookie,
  authenticateWithBasicAuth,
  createAnonymousUser,
  isAuthenticated,
  parseBasicAuthHeader,
  hasAuthToken
};
