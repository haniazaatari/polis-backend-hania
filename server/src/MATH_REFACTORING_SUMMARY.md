# Math.js Refactoring Summary

## Overview

The `math.js` file has been refactored according to the restructuring plan. The code has been split into four main components:

1. **Repository Layer** - `src/repositories/math/mathRepository.js`
2. **Service Layer** - `src/services/math/mathService.js`
3. **Controller Layer** - `src/controllers/mathController.js`
4. **Routes Layer** - `src/routes/api/mathRoutes.js`
5. **Middleware Layer** - `src/middlewares/redirectMiddleware.js`

Additionally, a backward-compatible version has been maintained at `src/routes/math.js` to ensure existing code continues to work.

## Changes Made

### 1. Repository Layer

The repository layer contains all database-related operations:

- `getXids` - Retrieves XID mappings for a conversation
- `addXidWhitelist` - Adds XID whitelist entries
- `getCorrelationMatrix` - Checks if a correlation matrix result exists
- `checkMathTaskExists` - Checks if a math task request exists
- `hasCommentSelections` - Checks if comment selections exist for a report
- `createMathUpdateTask` - Creates a math update task
- `createReportDataTask` - Creates a report data generation task

### 2. Service Layer

The service layer contains business logic and coordinates between repositories and routes:

- `processPcaData` - Processes PCA data for a conversation
- `updateMath` - Updates math for a conversation
- `getCorrelationMatrixForReport` - Gets correlation matrix for a report
- `getBidToPidMapping` - Gets bid to pid mapping for a conversation
- `getXidsForConversation` - Gets XIDs for a conversation if user is owner
- `addXidsToWhitelist` - Adds XIDs to whitelist
- `getBidsForParticipants` - Gets bids for a list of pids
- `getBidsForPids` - Original function name maintained for backward compatibility
- `getBidForParticipant` - Gets bid for a participant

### 3. Controller Layer

The controller layer handles the HTTP request/response cycle and delegates to the service layer:

- `handleGetMathPca` - Handles GET /math/pca
- `handleGetMathPca2` - Handles GET /math/pca2
- `handlePostMathUpdate` - Handles POST /mathUpdate
- `handleGetMathCorrelationMatrix` - Handles GET /math/correlationMatrix
- `handleGetBidToPid` - Handles GET /bidToPid
- `handleGetXids` - Handles GET /xids
- `handlePostXidWhitelist` - Handles POST /xidWhitelist
- `handleGetBid` - Handles GET /bid

### 4. Middleware Layer

The middleware layer contains functions that process HTTP requests before they reach the controller:

- `redirectIfHasZidButNoConversationId` - Redirects users with a zid parameter but no conversation_id to the about page

### 5. Routes Layer

The routes layer defines the API endpoints and connects them to the controller functions:

- `GET /math/pca` - Legacy endpoint
- `GET /math/pca2` - Get PCA data for a conversation
- `POST /mathUpdate` - Update math for a conversation
- `GET /math/correlationMatrix` - Get correlation matrix for a report
- `GET /bidToPid` - Get bid to pid mapping for a conversation
- `GET /xids` - Get XIDs for a conversation
- `POST /xidWhitelist` - Add XIDs to whitelist
- `GET /bid` - Get bid for a participant

Each route is defined with its full path and includes middleware for parameter validation, authentication, and other processing:

```javascript
router.get(
  '/math/pca2',
  moveToBody,
  redirectIfHasZidButNoConversationId,
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  want('math_tick', getInt, assignToP),
  wantHeader('If-None-Match', getStringLimitLength(1000), assignToPCustom('ifNoneMatch')),
  handleGetMathPca2
);
```

### 6. Parameter Mapping

To maintain compatibility with the original implementation, we've used `assignToPCustom` to map parameters to the same names expected by the controller functions:

- `conversation_id` is mapped to `zid` using `assignToPCustom('zid')`
- `report_id` is mapped to `rid` using `assignToPCustom('rid')`
- `If-None-Match` header is mapped to `ifNoneMatch` using `assignToPCustom('ifNoneMatch')`

This ensures that the controller functions can access the parameters using the same names as in the original implementation.

### 7. Route Mounting Strategy

In the original app.js, math-related routes were defined with various paths. To maintain this structure while using a modular approach, we've:

1. Defined each route in `mathRoutes.js` with its full path (e.g., `/math/pca`, `/bidToPid`)
2. Mounted the router at the root level in `api/index.js`:

   ```javascript
   router.use('/', mathRoutes); // Math routes are mounted at the root level with full paths
   ```

This approach allows us to maintain the original URL structure while keeping all math-related route handlers in a single file.

### 8. Backward Compatibility

The original `math.js` file has been maintained for backward compatibility, but now it:

1. Imports functionality from the new service and repository layers
2. Provides the same exported functions as before
3. Includes route handlers that use the new service layer
4. Mounts routes with the exact same paths as in app.js

Additionally, we've maintained the original function name `getBidsForPids` in the service layer for backward compatibility, even though we've also created a more descriptively named version `getBidsForParticipants`.

## Integration

The new routes have been integrated into the API router in `src/routes/api/index.js` and the main router in `src/routes/index.js`. The API routes are mounted at the root level with their full paths to match the original URL structure in app.js.

## Code Quality Improvements

1. **Separation of Concerns** - Database, business logic, HTTP handling, and routing are now separate
2. **Controller Pattern** - Using a controller layer to handle HTTP requests and responses
3. **Middleware Pattern** - Using middleware for parameter validation, authentication, and request processing
4. **Async/Await** - Replaced promise chains with async/await for better readability
5. **Error Handling** - Improved error handling with try/catch blocks
6. **Documentation** - Added JSDoc comments to functions and routes
7. **Consistent Patterns** - Used consistent patterns for route handlers
8. **Parameter Handling** - Added default values for optional parameters
9. **Input Validation** - Enhanced validation for input parameters
10. **Code Organization** - Clearly separated route handling from business logic
11. **Maintainability** - Improved code structure makes future changes easier

## Feature Parity

Special attention has been paid to ensure feature parity with the original implementation:

1. **Parameter Validation**
   - Using the same parameter validation middleware as other routes
   - Validating parameters with the same constraints as the original code

2. **Default Values**
   - Preserving default values for optional parameters
   - Handling undefined vs. explicitly set parameters

3. **Error Handling**
   - Maintaining specific error messages from the original implementation
   - Preserving HTTP status codes

4. **Response Formatting**
   - Maintaining content types and headers
   - Preserving response structures

5. **URL Structure**
   - Preserving original URL paths through full path routing

6. **Function Names**
   - Maintaining original function names for backward compatibility
   - Providing more descriptive function names for new code

7. **Middleware**
   - Preserving special middleware like `redirectIfHasZidButNoConversationId` for specific routes

8. **Parameter Mapping**
   - Using `assignToPCustom` to map parameters to the same names as in the original implementation
   - Ensuring controller functions can access parameters using the same names

## Next Steps

1. Run linting and tests to ensure everything works correctly
2. Update any remaining references to the old functions in other files
3. Consider removing the backward compatibility layer in the future when all code has been updated to use the new structure
4. Update app.js to use the new routes instead of the legacy handlers
