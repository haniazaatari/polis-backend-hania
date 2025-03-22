# GOTCHAS in the Polis Codebase

This document outlines various pitfalls, quirks, and "dragons" encountered in the Polis codebase. Understanding these issues will help you navigate and debug the codebase more effectively.

## Database Query Functions (pg-query.js)

### Function Overloading

The database query functions in `pg-query.js` are heavily overloaded and accept multiple argument patterns:

- `queryImpl(pool, queryString)` - No parameters, no callback
- `queryImpl(pool, queryString, callback)` - No parameters, with callback
- `queryImpl(pool, queryString, params)` - With parameters, no callback
- `queryImpl(pool, queryString, params, callback)` - With parameters and callback

**Gotcha:** If the function doesn't recognize the argument pattern, it throws a generic "unexpected db query syntax" error, which is hard to debug.

**Solution:** Always ensure you're passing arguments in the expected format. When using `queryP`, make sure you pass parameters as an array.

### Promise vs Callback Patterns

The codebase mixes different query function patterns:

- `query` / `query_readOnly` - Callback-based
- `queryP` / `queryP_readOnly` - Promise-based
- `queryP_metered` - Promise-based with metrics

**Gotcha:** Using the wrong variant can lead to unexpected behavior or unhandled promises.

## Falsy Values Causing Bugs

### Valid Zero (0) Values Being Treated as Falsy

JavaScript treats `0` as falsy, but `0` is often a valid value in the database (like `pid=0`).

**Gotcha:** Using conditions like `if (pid)` will evaluate to false when `pid` is 0, skipping critical code paths.

**Solution:** Always use explicit comparisons like `if (pid !== undefined && pid !== null)` or `if (pid >= 0)`.

Example issues:

- Participant IDs (`pid`) can validly be 0
- Comment IDs (`tid`) can validly be 0
- Vote values can be 0 (neutral vote)

## Schema-related Issues

### Broken Queries with Incorrect Column Names

The codebase sometimes references columns that don't exist in the current schema or have been renamed.

**Gotcha:** These errors can be difficult to track down because they only appear at runtime as database errors.

**Example:** The `high_priority` column in the `votes` table is essential but was mistakenly considered unused.

### Missing Parameters in SQL Queries

SQL queries in the codebase expect a specific number of parameters with specific types.

**Gotcha:** Using the wrong number of parameters or passing them in the wrong format can cause "unexpected db query syntax" errors.

**Solution:** Double-check the SQL query and ensure you're passing all parameters in an array format for `queryP` functions.

## Participant Handling

### Variations of `pid` Processing

The codebase handles participant IDs (`pid`) inconsistently across different functions.

**Gotcha:** Some functions require `pid` to be provided, others auto-generate it, and some treat `pid=0` as invalid.

**Paths for pid resolution:**

1. Explicitly provided in request parameters
2. Resolved via the `resolve_pidThing` middleware
3. Created by `addParticipantAndMetadata` during vote processing
4. Created by `addParticipant` as a fallback

### Race Conditions in Participant Creation

When creating participants, race conditions can occur if the same user tries to participate multiple times simultaneously.

**Gotcha:** These race conditions can cause unique constraint violations that appear as database errors.

**Solution:** The codebase handles these by catching the specific error and continuing operation.

## Asynchronous Programming Issues

### Mixed Async Modalities

The codebase mixes several async patterns:

- Callbacks (older pattern)
- Promises with `.then()` chains
- Async/await
- Node-style error-first callbacks

**Gotcha:** Converting between these patterns can introduce subtle bugs, especially around error handling.

**Solution:** Be consistent within a module and carefully handle the transitions between patterns.

### Unhandled Promise Rejections

Many of the Promise-based functions don't have proper error handling.

**Gotcha:** This can lead to silent failures or server crashes when errors occur.

**Solution:** Always use try/catch with async/await or .catch() with Promise chains.

## Authentication Strategies

### Nonstandard User/Participant Authentication

The codebase uses several parallel authentication methods:

- Token-based auth via cookies (`pc` cookie)
- Session-based auth
- XID-based authentication
- Combined auth strategies for different endpoints

**Gotcha:** Some endpoints require specific auth methods, and passing the wrong type causes auth failures.

**Solution:** Check the relevant controller to understand which auth strategy it expects.

### Participant vs User Authentication

The system distinguishes between:

- **Users** (identified by `uid`)
- **Participants** (identified by `pid` in a specific conversation)

**Gotcha:** Many operations require both a valid user and participant ID, but the error messages don't always make this clear.

## Logging and Debugging

### Inconsistent Error Handling

Error handling is inconsistent throughout the codebase:

- Some errors are logged and rethrown
- Some are logged and ignored
- Some are silently passed up the chain

**Gotcha:** This makes tracing the root cause of issues challenging.

**Solution:** Add your own detailed logging when debugging, particularly around database operations.

## Legacy Server Stability Issues

### Process Hanging and Resource Leaks

The legacy server has several stability issues that can affect development and testing:

**Gotcha:** The server process often leaves open handles and connections, causing:

- Tests to hang indefinitely
- Node process to not exit cleanly
- Resource leaks in development
- Difficulty identifying which endpoints are causing hangs

**Solution:**

- Use `--detectOpenHandles` flag with Jest to identify problematic tests
- Set appropriate timeouts in test configurations
- Monitor process resources during development
- Implement proper cleanup in `afterAll` and `afterEach` blocks

### Endpoint Timeouts and Hanging Requests

The legacy server has issues with certain endpoints that may hang indefinitely:

**Gotcha:**

- Some endpoints never return a response
- Others may take an extremely long time to respond
- Certain operations (like closing conversations) consistently hang
- Test timeouts may need to be much longer than expected
- Resource cleanup might not happen properly when requests hang

**Solution:**

- Implement request timeouts in test helpers
- Use circuit breakers for known problematic endpoints
- Consider skipping tests for endpoints known to hang
- Document timeout values that work reliably
- Implement cleanup even when requests fail
- Known problematic endpoints:
  - `/conversation/close` - Often hangs indefinitely
  - `/auth/deregister` - May timeout with certain parameters
  - Add others as they are discovered

### Response Format Reliability

The legacy server's response handling is inconsistent and can be misleading:

**Gotcha:**

- Content-Type headers don't always match the actual response format
- Some endpoints return text/plain for JSON responses
- Error responses mix formats between structured JSON and plain text
- Status codes may not follow REST conventions
- **Some endpoints use gzip compression without proper indication**
- **Content may be compressed but returned with incorrect content-type headers**

**Solution:**

- Always use the test helpers that handle format detection
- Don't rely solely on Content-Type headers
- Implement robust response parsing that can handle both formats
- Document endpoint-specific response format quirks
- **Use helpers with automatic gzip decompression capabilities**
- **Check both content-encoding headers and attempt gzip decompression fallbacks**

### Dead Code and Deprecated Endpoints

The codebase contains endpoints that may no longer be functional or used in production:

**Gotcha:**

- Some endpoints exist in code but are broken or non-functional
- Documentation may reference endpoints that are no longer supported
- Error handling might be incomplete for deprecated paths
- Test failures might indicate dead code rather than bugs

**Solution:**

- Verify endpoint usage in production before extensive debugging
- Document known dead code paths
- Consider adding deprecation notices in responses
- Maintain a list of known-broken endpoints

## Testing Considerations

### Database Reset Between Tests

Tests assume the database is reset between runs, but this doesn't always happen cleanly.

**Gotcha:** Failed tests can leave the database in an inconsistent state, causing future tests to fail.

**Solution:** Consider running the `db-reset.js` script before test runs if you encounter consistent unexplained failures.

### Mock/Real API Expectations

Some tests expect the API to be running, while others mock it.

**Gotcha:** Changes to the API can break tests in non-obvious ways.

**Solution:** Check if the test is using a real or mocked API before making changes that might affect it.

### Shared Test State

The test suites sometimes share state variables (users, cookies, etc.) between different test suites.

**Gotcha:** When running multiple test suites together, shared state can cause tests to interfere with each other. For example:

- One test suite might create a user that another suite tries to create
- Authentication tokens might persist between suites
- Database records created in one suite might affect assertions in another

**Solution:**

- Each test suite should maintain its own isolated state variables
- Generate unique test data for each suite (e.g., unique email addresses)
- Clear authentication tokens and cookies after each test
- Use database transactions to roll back changes after each test
- If you must share state, document it clearly and consider the implications for test ordering
