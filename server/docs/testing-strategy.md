# Testing Strategy for Modular and Legacy Servers

This document outlines the recommended hybrid testing strategy for migrating from the legacy server to the modular server. The goal is to ensure a smooth, incremental transition while maintaining robust API compatibility.

## Goals

- Ensure the modular server is a drop-in replacement for the legacy server.
- Maintain readability and debuggability benefits of the modular server.
- Quickly identify and document legacy server behaviors and quirks.
- Clearly document intentional deviations from legacy behavior.

## Migration Strategy

The planned migration path involves multiple phases:

1. **Feature Parity Phase** (`/api/v3`):
   - Achieve complete feature parity with legacy server
   - Maintain strict compatibility with existing clients
   - Pass all integration tests against both servers
   - Document all quirks and behaviors that must be preserved

2. **Side-by-Side Deployment**:
   - Deploy modular server alongside legacy server
   - Legacy server continues handling `/api/v3` requests
   - Modular server can handle both `/api/v3` and `/api/v4` requests
   - Allows for gradual client migration with minimal risk

3. **Modernization Phase** (`/api/v4`):
   - Introduce improvements and modern API design patterns
   - Clean up historical quirks and inconsistencies
   - Provide better error handling and response formats
   - Document migration path for clients moving from v3 to v4

4. **Client Migration**:
   - Clients can migrate to v4 at their own pace
   - Legacy server remains available until all clients have migrated
   - Eventually deprecate and remove legacy server

This approach minimizes risk by:

- Ensuring no disruption to existing clients
- Providing a clear path for improvements
- Allowing gradual migration at client's pace
- Maintaining system stability throughout transition

## Legacy Client Compatibility

**IMPORTANT**: This project has multiple legacy clients in production that depend on specific API contracts. While our test suite is designed to be flexible in handling both legacy and new server responses, we must ensure we don't break these existing contracts.

Key considerations:

- Response formats must remain compatible with what legacy clients expect
- Status codes should match legacy behavior unless explicitly documented otherwise
- Error messages and formats should maintain backward compatibility
- Test flexibility (accepting multiple status codes/formats) should not mask breaking changes

Future improvements to consider:

- Dedicated test suites for verifying legacy client compatibility
- Explicit documentation of required response formats for each endpoint
- Contract tests specifically targeting legacy client requirements
- Clear separation between legacy compatibility tests and new server behavior tests

## Legacy Server Quirks

When testing against the legacy server, be aware of these known quirks:

- **Response Format Inconsistency**: The legacy server sometimes sends plain text responses with `content-type: application/json`. Our test helpers handle this by attempting JSON parsing first, then falling back to raw text.
- **Error Response Format**: Error responses are often plain text error codes (e.g., `polis_err_param_missing_password`) rather than structured JSON objects.
- **Gzip Compression Handling**: The server sometimes responds with gzipped content, both with and without proper content-encoding headers. The test helpers automatically detect and decompress gzipped responses, handling both properly marked and unmarked compressed content.
- **Email Verification Challenges**: Testing email sending is critical but challenging. The test suite uses MailDev to capture and verify emails, with helpers to find emails by recipient and extract content for validation.
- **Deregister Endpoint Timeout**: The `/auth/deregister` endpoint may timeout when called with a `showPage` parameter but no auth token. This case is currently skipped in tests.
- **Server Stability Issues**:
  - The server frequently crashes or hangs due to unhandled errors
  - Node process may leave open handles, requiring `--detectOpenHandles` in tests
  - Some endpoints may timeout unexpectedly under load
  - Consider using shorter test timeouts to catch hanging endpoints early
- **Dead Code Paths**:
  - Some endpoints may be broken or non-functional despite being present in the codebase
  - These endpoints might have been deprecated in production but not removed
  - When encountering unexpected failures, verify if the endpoint is actually used in production
- **Test Reliability**:
  - Tests against the legacy server may be flaky due to these issues
  - Consider running critical tests multiple times
  - Add appropriate error handling and retries in test helpers
  - Document any endpoints that consistently fail or timeout
- **Endpoint Timeouts**:
  - Some endpoints may hang indefinitely without responding
  - The `/conversation/close` endpoint is known to hang frequently
  - Consider implementing circuit breakers or timeouts in test helpers
  - Some endpoints may require multiple attempts with delays between them
  - Document timeout values that work reliably for each endpoint

## Recommended Workflow (Hybrid Approach)

### Step 1: Write Initial Tests Against Modular Server

- Write new API tests against the modular server first.
- Leverage the readability and debuggability of the modular server to quickly iterate and refine tests.

### Step 2: Immediately Validate Tests Against Legacy Server

- As soon as a test passes against the modular server, immediately run it against the legacy server.
- Quickly identify and document any differences in behavior.
- Use appropriate test helpers (like `makeRequest`) to handle legacy server quirks.

### Step 3: Explicitly Handle Differences

For each difference identified between modular and legacy servers, explicitly decide:

- **Intentional Improvement**:  
  Clearly document the deviation in a migration guide.  
  Communicate these intentional differences to stakeholders.

- **Unintentional Difference**:  
  Immediately adjust the modular server code to match legacy behavior.  
  Ensure the test passes against both servers.

### Step 4: Iterate Quickly and Regularly

- Keep tests small, focused, and incremental to minimize context-switching overhead.
- Regularly run the full test suite against both servers to catch regressions early.
- Continuously refine tests and modular server code to maintain compatibility.

### Step 5: Maintain Clear Documentation

- Maintain a clear migration guide documenting intentional deviations from legacy behavior.
- Clearly communicate these differences to stakeholders and developers.

## Benefits of the Hybrid Approach

- **Reduced Iteration Cycles**: Quickly identify and resolve differences between servers.
- **Early Legacy Validation**: Catch legacy quirks early, reducing surprises later.
- **Maintain Readability**: Leverage the modular server's readability and debuggability.
- **Clear Documentation**: Explicitly document intentional deviations, improving clarity and communication.

## Test Isolation Best Practices

### State Management

- **Isolate Test Suite State**: Each test suite should maintain its own state variables (users, cookies, etc.) to prevent interference between suites.
- **Use Unique Test Data**: Generate unique test data (e.g., email addresses) for each test suite to prevent conflicts in concurrent or sequential test runs.
- **Clear State After Tests**: Always clear any stored state (cookies, tokens, etc.) after tests complete to prevent leakage into subsequent tests.
- **Clean Up External Resources**: When testing features that create external resources (like emails), ensure proper cleanup before and after tests.

### Database Transactions

- **Use Transaction Boundaries**: Wrap each test in a database transaction that gets rolled back after the test completes.
- **Reset Shared Resources**: If tests modify shared resources, ensure they are reset to a known state after each test.

## Final Goal

The final goal is a robust, comprehensive API test suite that passes consistently against both the modular and legacy servers, enabling a confident and smooth transition to the modular server in production.
