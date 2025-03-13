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
- The original TypeScript "source of truth" can be inspected in the git branch `edge`.

## Testing

- See **tests**/README.md for more details on the testing strategy.
- Run tests with `npm run test`.
- Test suite assumes the API is running locally on port 5000, via docker compose.
- Test suite assumes the database is running locally and accessible at `localhost:5432`.
- Some tests are EXPECTED TO FAIL, because the restructuring is not yet validated.
- Tests should focus on API surface area, and use the database itself to validate as needed.
