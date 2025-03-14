# Utility Scripts

This directory contains utility scripts for development and maintenance of the Polis server.

## Database Reset Script

`db-reset.js` - Completely resets the development/test database by:

1. Dropping the existing database (specified by DATABASE_URL)
2. Creating a fresh database
3. Running all migrations to set up the schema

### Usage

You can run this script in one of two ways:

```bash
# Using the npm script
npm run db:reset

# Or directly
./bin/db-reset.js
```

⚠️ **WARNING**: This script will delete ALL data in the database specified by DATABASE_URL. Make sure you're using a development/test database, not production.

### Safety Features

The script includes several safety measures:

- Checks for production indicators in the DATABASE_URL (amazonaws, prod)
- 5-second countdown before executing the drop operation
- Clear warnings about data loss

### Environment Variables

- `DATABASE_URL` - Connection URL for the database to reset
  - Format: `postgres://username:password@host:port/database`
  - Default: `postgres://postgres:postgres@localhost:5432/polis-dev`

## Other Scripts

- `add-extensions.js` - Script to fix imports with extensions
