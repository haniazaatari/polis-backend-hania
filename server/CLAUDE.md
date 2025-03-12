# 2olis Server Development Guide

## Build/Test/Lint Commands

- Build: `npm run build` (runs fix-imports, clean, and tsc)
- Dev server: `npm run dev` (debug mode with inspector)
- Linting: `npm run lint` (biome lint with write)
- Formatting: `npm run format` (biome format with write)
- All-in-one: `npm run check:fix` (biome check with write)

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
