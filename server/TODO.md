# TODO

## Packages

- [ ] Update @google-cloud/translate
- [ ] Update akismet
- [ ] Update async
- [ ] Update bcryptjs
- [ ] Update boolean
- [ ] Update express
- [x] Remove fb
- [ ] Update lru-cache
- [ ] Update simple-oauth2
- [ ] Update AWS-SDK to v3
- [x] Remove lodash
- [ ] Remove underscore
- [x] Remove bluebird
- [ ] Remove request
- [ ] Somehow remove "punycode" (aws-sdk, request-promise, request)
- [ ] consider axios or native fetch over request/request-promise
- [x] Liquidate server.js
- [ ] Move app.js into src/

## Tests

- [ ] HTTP API test suite
- [ ] Test Auth
- [ ] Test Comment
- [ ] Test Conversation
- [ ] Test Cookie
- [ ] Test Data Export
- [ ] Test Email
- [ ] Test LaunchPrep
- [ ] Test Math
- [ ] Test Metadata
- [ ] Test Moderation
- [ ] Test Participant
- [ ] Test Password
- [ ] Test Report
- [ ] Test Narrative Report
- [ ] Test Subscription
- [ ] Test User
- [ ] Test Vote
- [ ] Test Zinvite
- [ ] Test Static File Fetching
- [ ] Test Middleware

## Database

- [x] Create migrations for (re)building the whole database
- [ ] Create a schema with TypeORM or similar
- [x] Upgrade to PostgreSQL 14
- [x] Upgrade to PostgreSQL 16

## Modular Code

- [x] Populate the "routes" directory
- [x] Break up the "server" file
- [x] Normalize the imports and exports
- [x] Isolate DB concerns
- [x] Isolate 3rd party API concerns
- [x] Isolate "Math" concerns
- [x] Isolate "Email" concerns
- [x] Isolate Static File concerns

## Code Hygiene

- [ ] Remove dead code
- [x] replace all console statements with logger
- [ ] Remove, Normalize, (or add) Comments
- [ ] Update callback chains with async/await
- [ ] Update and improve analytics
- [x] Update and improve logging
- [ ] Normalize the error handling
- [ ] Identify and refactor "hacks"
- [x] Swtich from eslint+prettier to biomejs
- [x] Fix all linting errors
- [ ] Convert to TypeScript

## Express

- [ ] Upgrade to 4.x
- [ ] Upgrade to 5.x
- [ ] Update and improve middleware
- [x] Update and improve routing
