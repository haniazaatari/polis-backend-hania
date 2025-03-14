# 2olis Server Development Guide

## Build/Test/Lint Commands

- Build: `npm run build` (runs fix-imports, clean, and tsc)
- Dev server: `npm run dev` (debug mode with inspector)
- Linting: `npm run lint` (biome lint with write)
- Formatting: `npm run format` (biome format with write)
- All-in-one: `npm run check:fix` (biome check with write)
- Run tests: `npm run test`

## Code Style Guidelines

- **Formatting**: Use spaces (not tabs), 120 char line width, single quotes
- **Imports**: ES modules with .js extension (use `npm run fix-imports` to add extensions)
- **Structure**: Follow controller/service/repository architecture pattern
- **Error handling**: Use try/catch with specific error types
- **Naming**: camelCase for variables/functions, PascalCase for classes
- **Console**: No direct console.log (use logger instead)
- **Semicolons**: Required at end of statements
- **Trailing commas**: None

## Source of Truth

- Code has been rewritten in JavaScript from original TypeScript, with lots of restructuring.
- See RESTRUCTURING.md for more details on that effort.
- The original JavaScript "source of truth" can be found in the legacy/ folder (There Be Dragons!).
- A copy of the db schema can be found in the legacy/schema.sql file.
- The majority of the functionality is preserved, but we intentionally removed twitter and facebook integration.

## Testing

- See **tests**/README.md for more details on the testing strategy.
- Run tests with `npm run test`.
- Test suite assumes the API is running locally on port 5000, via docker compose.
- Test suite assumes the database is running locally and accessible at `localhost:5432`.
- Some tests are EXPECTED TO FAIL, because the restructuring is not yet validated.
- Tests should focus on API surface area, and use the database itself to validate as needed.
- Server logs can be viewed with `docker compose logs`.
- Please, DO NOT SKIP TESTS, or parts of tests, to get the build to pass. Failing tests are important indicators of missing functionality. Prefer robust failing tests over flimsy passing tests.

## Bugs

Bugs are to be expected as a result of the restructuring as well as carryover from the legacy codebase.
Perceived bugs (ie test failures) may be the result of one or more of the following:

- The test is expected to fail as part of the restructuring effort.
- The test is failing because of a new bug introduced as part of the restructuring effort.
- The test is failing because of a bug in the legacy codebase, and the bug has not yet been fixed in the restructured code.
- Incorrect test setup or assumptions.

## Docker

- Typically I'm running the server, the postgres db, and the 'math' engine in docker compose.
- Logs can be viewed with `docker compose logs`.
- The server is run on port 5001 to avoid conflict with MacOS services.
- The database "polis-dev" is available at `localhost:5432`, credentials are `postgres:postgres`.
- The sever is typically run with `npm run debug` and will restart via nodemon as changes are made.
- You can run `docker compose down` to stop the containers, and `docker compose up -d` to restart them.
