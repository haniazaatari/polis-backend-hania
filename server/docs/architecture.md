# Architecture

## Layer Separation and Responsibilities

This document outlines the recommended architecture for the application, focusing on the separation of concerns and responsibilities between different layers.

### Current State Analysis

The application currently has:

1. **DB Modules** (`src/db/*.js`) - Contains basic DB operations
2. **Repository Modules** (`src/repositories/*/*.js`) - Mix of DB queries and some business logic
3. **Service Modules** (`src/services/*/*.js`) - Business logic, using both repository and DB modules
4. **Controller Modules** (`src/controllers/*.js`) - HTTP layer, using services, repositories, and DB modules

The main issues are:

- Overlap between repository and DB modules
- Inconsistent usage patterns (sometimes services use DB directly, sometimes through repositories)
- Direct DB access from multiple layers

### Recommended Architecture: Clear Layer Separation

A clear separation of concerns with the following structure is recommended:

#### 1. DB Layer (`db/*.js`)

- **Purpose**: Raw database access only
- **Contains**: SQL queries, connection handling, transactions
- **Example**: `pgQueryP`, basic CRUD operations
- **Used by**: Repository layer only

#### 2. Repository Layer (`repositories/*.js`)

- **Purpose**: Data access abstraction
- **Contains**: Domain-specific data operations combining multiple DB calls
- **Example**: Methods like `getCommentsForModeration` which might use multiple DB calls with specific business rules
- **Used by**: Service layer

#### 3. Service Layer (`services/*.js`)

- **Purpose**: Business logic, orchestration
- **Contains**: Domain logic, orchestrating multiple repositories
- **Example**: Comment creation with validation, moderation logic
- **Used by**: Controller layer

#### 4. Controller Layer (`controllers/*.js`)

- **Purpose**: HTTP handling
- **Contains**: Request parsing, response formatting, route handling
- **Used by**: Router/app

### Implementation Plan

1. **Move all direct DB queries from repositories to DB modules**
   - Keep DB modules focused on single-table operations

2. **Make repositories use DB modules exclusively**
   - Repositories can combine multiple DB operations but shouldn't contain SQL

3. **Make services use repositories exclusively**
   - No direct DB access from services

4. **Make controllers use services exclusively**
   - No direct DB or repository access from controllers

This creates a clean dependency chain: Controllers → Services → Repositories → DB Modules

### Benefits

1. **Testability**: Each layer can be mocked independently
2. **Maintainability**: Clear responsibility boundaries
3. **Code organization**: Consistent patterns across the codebase
4. **Flexibility**: Database implementation details hidden behind repositories

### Practical Example

For the `commentExists` function:

```javascript
// src/db/comments.js
async function commentExists(zid, txt) {
  const rows = await pgQueryP_readOnly(/* SQL query */);
  return !!rows?.length;
}

// src/repositories/comment/commentRepository.js
import { commentExists as dbCommentExists } from '../../db/comments.js';

async function commentExists(zid, txt) {
  return await dbCommentExists(zid, txt);
}
```

This way:

- DB module handles the actual SQL
- Repository provides the domain-oriented interface
- Multiple DB operations can be combined at the repository level when needed

Following this architecture will provide a solid foundation for maintainable and testable code with clear responsibility boundaries between layers.
