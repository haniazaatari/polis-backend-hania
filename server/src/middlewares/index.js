/**
 * Middleware index file
 * Exports all middleware functions for easier imports
 */

// Auth middlewares
export { auth, authOptional } from './auth.js';

// Parameter validation middlewares
export * as paramValidation from './paramValidation.js';

// Domain middlewares
export { denyIfNotFromWhitelistedDomain } from './domain.js';

// Redirect middlewares
export { redirectIfHasZidButNoConversationId } from './redirectMiddleware.js';
export { redirectIfNotHttps } from './httpMiddleware.js';

// Request body middlewares
export { moveToBody } from './moveToBody.js';

// Response header middlewares
export { writeDefaultHead } from './httpMiddleware.js';

// Logging middlewares
export { logRequestBody, logMiddlewareErrors } from './loggingMiddleware.js';

// CORS middlewares
export { checkIfOptions, addCorsHeader, hasWhitelistMatches } from './corsMiddleware.js';

// Performance middlewares
export { responseTimeStart } from './performanceMiddleware.js';

// Participant middlewares
export { getParticipantIdMiddleware } from './participantMiddleware.js';

// Utility middlewares
export { asyncMiddleware } from './utilityMiddleware.js';
