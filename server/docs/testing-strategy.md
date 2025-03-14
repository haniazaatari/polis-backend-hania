# Testing Strategy for Modular and Legacy Servers

This document outlines the recommended hybrid testing strategy for migrating from the legacy server to the modular server. The goal is to ensure a smooth, incremental transition while maintaining robust API compatibility.

## Goals

- Ensure the modular server is a drop-in replacement for the legacy server.
- Maintain readability and debuggability benefits of the modular server.
- Quickly identify and document legacy server behaviors and quirks.
- Clearly document intentional deviations from legacy behavior.

## Legacy Server Quirks

When testing against the legacy server, be aware of these known quirks:

- **Response Format Inconsistency**: The legacy server sometimes sends plain text responses with `content-type: application/json`. Our test helpers handle this by attempting JSON parsing first, then falling back to raw text.
- **Error Response Format**: Error responses are often plain text error codes (e.g., `polis_err_param_missing_password`) rather than structured JSON objects.
- **Deregister Endpoint Timeout**: The `/auth/deregister` endpoint may timeout when called with a `showPage` parameter but no auth token. This case is currently skipped in tests.

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

## Final Goal

The final goal is a robust, comprehensive API test suite that passes consistently against both the modular and legacy servers, enabling a confident and smooth transition to the modular server in production. 