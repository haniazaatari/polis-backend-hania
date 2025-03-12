# Restructuring Plan

Here's a comprehensive plan to restructure the application:

## Phases

1. Organize Core Infrastructure
2. Extract Core Functionality
3. Implement Modern Patterns

### Phase 1: Organize Core Infrastructure

1. Create a proper services directory structure:

- /src/services/ - For business logic
- /src/controllers/ - For request handling
- /src/middlewares/ - For middleware functions
- /src/models/ - For data models
- /src/repositories/ - For database access
- /src/routes/ - For route handlers
- /src/utils/ - For utility functions
- /src/db/ - For database operations

2. Refactor database operations:

- Move all database queries from server.js to appropriate repository files
- Create a proper database connection manager

### Phase 2: Extract Core Functionality

1. Extract authentication logic:

- Move all auth-related functions to /src/auth/
- Create separate files for different auth strategies (cookie, API key, etc.)

2. Extract route handlers:

- Move HTTP handlers to controller files organized by resource
- Group related endpoints together

3. Extract services:

- Move business logic to service files
- Separate concerns like email sending, geocoding, etc.

### Phase 3: Implement Modern Patterns

1. Implement dependency injection:

- Use a simple DI container or pattern
- Make services testable

2. Standardize error handling:

- Create a global error handler
- Standardize error responses

3. Implement proper logging:

- Structured logging
- Request/response logging

## Hazards

The codebase is large and complex, so it will take time to restructure. There are also some potential hazards:

- duplicated code
- dead code
- antipatterns
- unecessary complexity
- incomplete replication of legacy features in our new modules
- incomplete refactorings (e.g. src/routes, and src/auth have been partly started but remain incomplete)

## Additional Notes

### Refactoring Considerations

- In general, don't modify app.js or server.js. I will do that manually after verifying the changes.
- Try not to duplicate functions. Look around and see if it's already implemented in another file.
- Prefer succinctness over verbosity. Some concerns can be contained in a single file.
- Always check app.js for the exact route handler requirements.
- Maintain feature parity with the legacy codebase.
- Please double-check your imports and ensure they are correct (look at similar files for reference).

### Routes Strategy

1. First Phase: Reorganize Route Files

- Migrate route handlers from app.js to /src/routes/ files
- Include these in the /src/routes/index.js with appropriate prefixes, as needed
- Use Controller files for the route handler functions, and Service files for the business logic

2. Second Phase: Refactor Route Handlers

- Extract business logic to service files
- Create controller functions for each route
- Standardize parameter handling with middleware

3. Third Phase: Implement Consistent Patterns

- Add documentation
- Implement error handling
- Add validation

### Application Domains

Work-in-progress list of domain areas of the app so far.
This is basically anything that has a controller, service, route, or repository.

- Auth / Authorization
- Comment / Comments
- Context
- Contributor
- Conversation / Conversations
- Cookie
- Data Export
- Demographics
- Domain
- EInvite
- Email
- Export
- Feature Request
- Health
- LaunchPrep
- Location / Geocoding
- Math
- Metadata
- Metrics
- Moderation
- Notification / Notifications
- Participant / Participants
- Participation
- Password
- Report
- ReportNarrative
- Session
- Snapshot
- Star
- Subscription
- Translation
- Trash
- Tutorial
- Upvote
- URL
- User
- Verification
- Vote / Votes
- XID
