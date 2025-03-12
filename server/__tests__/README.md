# Tests for Polis Server

This directory contains tests for the Polis server API.

## Test Structure

- `__tests__/routes/`: Unit tests for route handlers
- `__tests__/controllers/`: Unit tests for controllers
- `__tests__/integration/`: Integration tests that test the API endpoints

## Running Tests

### Unit Tests

To run unit tests:

```bash
npm run test:unit
```

### Integration Tests

Integration tests require the API to be running. Make sure you have the API running locally or in Docker before running these tests.

```bash
# Start the API using Docker (in a separate terminal)
docker-compose up

# Run integration tests
npm run test:integration
```

You can also specify a custom API URL:

```bash
API_URL=http://localhost:5000 npm run test:integration
```

If you're running the API on a different port, make sure to update the API_URL accordingly:

```bash
API_URL=http://localhost:5001 npm run test:integration
```

### All Tests

To run all tests:

```bash
npm test
```

### Test Coverage

To generate test coverage reports:

```bash
npm run test:coverage
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
