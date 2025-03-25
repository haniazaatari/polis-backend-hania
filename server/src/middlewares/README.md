# Middleware Organization

This directory contains middleware functions used throughout the application. Middlewares are organized by their functionality to improve code organization and maintainability.

## Middleware Categories

### Authentication Middlewares (`auth.js`)

- `auth`: Middleware for required authentication
- `authOptional`: Middleware for optional authentication

### Parameter Validation Middlewares (`paramValidation.js`)

- `paramValidation`: Middleware for validating request parameters

### Domain Middlewares (`domain.js`)

- `denyIfNotFromWhitelistedDomain`: Middleware to deny requests from non-whitelisted domains

### Redirect Middlewares (`redirectMiddleware.js`)

- `redirectIfHasZidButNoConversationId`: Middleware to handle redirects based on URL parameters

### Request Body Middlewares (`moveToBody.js`)

- `moveToBody`: Middleware to move query and path parameters to the request body

### Logging Middlewares (`loggingMiddleware.js`)

- `logRequestBody`: Middleware to log request body (with sensitive information masked)
- `logMiddlewareErrors`: Middleware to log middleware errors

### CORS Middlewares (`corsMiddleware.js`)

- `checkIfOptions`: Middleware to handle OPTIONS requests
- `addCorsHeader`: Middleware to add CORS headers to the response with domain whitelist checks
- `hasWhitelistMatches`: Helper function to check if a host matches any of the whitelisted domains

### Participant Middlewares (`participantMiddleware.js`)

- `getParticipantIdMiddleware`: Middleware to get participant ID for a user and assign it to the request

### Utility Middlewares (`utilityMiddleware.js`)

- `asyncMiddleware`: Utility to convert async functions to Express middleware

## Usage

You can import middlewares directly from their respective files:

```javascript
import { auth } from '../middlewares/auth.js';
```

Or you can import them from the index file:

```javascript
import { auth, moveToBody, logRequestBody } from '../middlewares/index.js';
```

## Adding New Middlewares

When adding new middlewares, follow these guidelines:

1. Place the middleware in an appropriate file based on its functionality
2. If the middleware doesn't fit into an existing category, create a new file
3. Add proper JSDoc comments to document the middleware's purpose and parameters
4. Export the middleware from the file
5. Add the middleware to the index.js file for easier imports
6. Update this README if you're adding a new category

## Middleware Best Practices

1. Keep middlewares focused on a single responsibility
2. Use async/await with the asyncMiddleware wrapper for asynchronous operations
3. Always call next() or return a response to avoid hanging requests
4. Handle errors properly and pass them to the next middleware
5. Log meaningful information for debugging purposes
6. Use descriptive names that indicate the middleware's purpose
