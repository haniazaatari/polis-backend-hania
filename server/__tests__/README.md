# Testing in Polis

This directory contains tests for the Polis server. We have both unit tests and integration tests.

## Test Structure

- `__tests__/unit/` - Unit tests for individual functions and modules
- `__tests__/integration/` - Integration tests that test the entire API
- `__tests__/setup/` - Test setup and helper utilities

## Database Testing Helpers

We use a transaction-based approach for database testing, which provides several benefits:

1. Tests run in isolated transactions that are rolled back after each test
2. No need for complex cleanup logic
3. Tests run faster since database state is reset via rollback
4. Multiple tests can run in parallel without interfering with each other

### How to Use Transaction-Based Testing

Here's an example of how to use transaction-based testing in your test file:

```javascript
import { afterAll, afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { startTransaction, rollbackTransaction, closePool } from '../setup/db-test-helpers.js';

describe('My Test Suite', () => {
  let client = null;

  // Start a transaction before each test
  beforeEach(async () => {
    client = await startTransaction();
  });

  // Rollback the transaction after each test
  afterEach(async () => {
    if (client) {
      await rollbackTransaction(client);
      client = null;
    }
  });

  // Close connection pool after all tests
  afterAll(async () => {
    await closePool();
  });

  it('should perform a database operation in isolation', async () => {
    // Test code here
    // Any database changes will be rolled back after the test
  });
});
```

### Additional Database Helpers

The `db-test-helpers.js` module provides additional utilities:

- `cleanTables(tableNames)`: Clean specific tables
- `cleanAllTables()`: Clean all tables in the correct order
- `cleanupTestUsers(emailPattern)`: Clean up test users and associated data

### Transaction Limitations

Be aware that transactions have some limitations:

1. DDL statements (like CREATE TABLE) will implicitly commit the transaction
2. Some operations like sequence updates might persist across rollbacks
3. Connections to external services aren't covered by database transactions

## Running Tests

To run all tests:

```
npm test
```

To run only unit tests:

```
npm run test:unit
```

To run only integration tests:

```
npm run test:integration
```

To run a specific test file:

```
npm test -- path/to/test.js
```

## Writing Tests

### Unit Tests

Unit tests should test individual components in isolation. Use mocks for dependencies.

Example:

```javascript
import { someFunction } from '../src/utils/someUtil.js';

jest.mock('../src/services/someService.js');

describe('someFunction', () => {
  it('should do something', () => {
    // Test implementation
  });
});
```

### Integration Tests

Integration tests should test the API endpoints as they would be used by clients.

Example:

```javascript
import request from 'supertest';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Use the API_SERVER_PORT from the environment
const API_PORT = process.env.API_SERVER_PORT || 5000;
const API_URL = process.env.API_URL || `http://localhost:${API_PORT}`;

describe('API Endpoint', () => {
  it('should return expected data', async () => {
    const response = await request(API_URL).get('/some-endpoint');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('expectedProperty');
  });
});
```

## Key Test Files

### Participation Tests

The `__tests__/integration/participation.test.js` file tests the participation endpoints:

- `GET /participationInit`: Initializes participation for a conversation
- `GET /participation`: Retrieves participation data for a conversation

These tests cover both authenticated and unauthenticated access, parameter validation, and support for external identifiers (XIDs). They also test the full participation flow from initialization to voting.

The participation tests provide reusable helper functions that can be useful for other tests:

- `generateRandomXid()`: Creates random external IDs for testing
- `createTestConversation()`: Creates a test conversation with customizable options
- `createTestComment()`: Creates a test comment in a conversation

You can see the full list of tests and helpers in the `__tests__/integration/README.md` file.

## Known Database Issues

When running tests, you may encounter database-related issues that cause connection resets (ECONNRESET errors). These issues include:

1. Vote query syntax errors when creating comments
2. Schema mismatches in tables like `notification_tasks`

These issues can cause the server to crash during tests. The test suite is designed to handle these errors gracefully, but you may see tests being skipped. For more details, see the `__tests__/integration/README.md` file.
