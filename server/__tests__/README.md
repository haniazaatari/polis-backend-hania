# Testing Guide

This directory contains the test suite for the Polis server. The tests are organized by type (unit, integration, e2e) and use Jest as the test runner.

## Getting Started

To run the tests, you'll need:

- A local PostgreSQL database for testing
- Node.js and npm installed

## Running Tests

### All Tests

```bash
npm test
```

### Unit Tests Only

```bash
npm run test:unit
```

### Integration Tests Only

```bash
npm run test:integration
```

### Run Specific Tests

```bash
# Run tests in a specific file
npm test -- __tests__/integration/participation.test.js

# Run tests that match a specific name
npm test -- -t "should do something specific"
```

## Database Setup for Tests

The tests require a clean database state to run successfully. There are several ways to manage this:

### Option 1: Reset Database Before Running Tests

This will completely reset your database, dropping and recreating it with a fresh schema:

```bash
# Reset the database immediately
npm run db:reset

# Run tests with a database reset first
RESET_DB_BEFORE_TESTS=true npm test
```

⚠️ **WARNING**: The `db:reset` script will delete ALL data in the database specified by `DATABASE_URL`.

## Test Safety Features

The test environment includes this safety feature:

- **Production Database Prevention**: Tests will not run against production databases (URLs containing 'amazonaws', 'prod', etc.)

## Troubleshooting Common Issues

### Participant Creation Issues

If tests fail with duplicate participant errors, try:

```bash
npm run db:reset
```

### Database Connection Errors

Check that:

1. Your PostgreSQL server is running
2. Your DATABASE_URL environment variable is correct
3. Database and schema exist (you can use `npm run db:reset` to create them)

### Test Timeouts

If tests timeout, try:

1. Increase the timeout in individual tests:

   ```javascript
   jest.setTimeout(20000); // Set timeout to 20 seconds
   ```

2. Check for any blocking async operations that might not be resolving
