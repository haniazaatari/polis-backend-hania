# Architecture

## Layer Separation and Responsibilities

This document outlines the recommended architecture for the application, focusing on the separation of concerns and responsibilities between different layers.

### Current State Analysis

The application currently has:

1. **DB Modules** (`src/db/*.js`) - Contains basic DB operations
2. **Repository Modules** (`src/repositories/*/*.js`) - Mix of DB queries and some business logic (being refactored)
3. **Service Modules** (`src/services/*/*.js`) - Business logic, using both repository and DB modules
4. **Controller Modules** (`src/controllers/*.js`) - HTTP layer, using services, repositories, and DB modules

The main issues identified were:

- Overlap between repository and DB modules (being addressed by moving all raw SQL to DB modules)
- Inconsistent usage patterns (sometimes services use DB directly, sometimes through repositories)
- Direct DB access from multiple layers
- Excessive layering for simple CRUD operations

### Recommended Architecture: Pragmatic Layered Approach

A clear separation of concerns is crucial, but strict adherence to a four-layer architecture (Controller -> Service -> Repository -> DB) can lead to unnecessary code duplication and complexity, especially for simple database operations. Therefore, we adopt a pragmatic approach with the following structure:

#### 1. DB Layer (`db/*.js`)

- **Purpose**: Raw database access only.
- **Contains**: SQL queries, connection handling, transactions.
- **Example**: `pgQueryP`, basic CRUD operations.
- **Used by**: Repository layer and *sometimes* the Service layer (see guidelines below).

#### 2. Repository Layer (`repositories/*.js`)

- **Purpose**: Data access abstraction for complex operations.
- **Contains**: Domain-specific data operations that may combine multiple DB calls, implement data transformations, or enforce data integrity rules that span multiple tables.
- **Example**: Methods like `getCommentsForModeration` (which might involve joining multiple tables and applying specific filtering logic).
- **Used by**: Service layer.

#### 3. Service Layer (`services/*.js`)

- **Purpose**: Business logic, orchestration.
- **Contains**: Domain logic, orchestrating multiple repositories *or* directly accessing DB modules for simple CRUD operations.
- **Example**: Comment creation with validation, moderation logic; or simple retrieval of a single record by ID.
- **Used by**: Controller layer.
- **Key Principle**: Services *primarily* use Repositories.  However, for very simple, single-table CRUD operations where the repository layer would add *no* value beyond a simple pass-through, the service *may* call the DB module directly.  This decision *must* be documented with a comment explaining *why* the repository layer is being bypassed. This exception is made to avoid excessive layering and boilerplate.

#### 4. Controller Layer (`controllers/*.js`)

- **Purpose**: HTTP handling.
- **Contains**: Request parsing, response formatting, route handling.
- **Used by**: Router/app.
- **Key Principle**: Controllers *always* use Services. They never directly access Repositories or DB modules.

### Implementation Plan

1. **Move all direct DB queries from repositories to DB modules.**
    - Keep DB modules focused on single-table operations.

2. **Make repositories use DB modules exclusively.**
    - Repositories can combine multiple DB operations but shouldn't contain SQL.

3. **Make services *primarily* use repositories, but allow direct DB module access for simple CRUD with justification.**
    - No direct DB access from services without a comment explaining the bypass.

4. **Make controllers use services exclusively.**
    - No direct DB or repository access from controllers.

This creates a dependency chain: Controllers → Services → (Repositories → DB Modules) OR (DB Modules)

### Benefits

1. **Testability**: Each layer can be mocked independently (though mocking becomes slightly more complex with the service/DB module flexibility).
2. **Maintainability**: Clear responsibility boundaries, with exceptions clearly documented.
3. **Code organization**: Consistent patterns across the codebase, with controlled deviations.
4. **Flexibility**: Avoids unnecessary indirection for simple operations.
5 **Reduced Boilerplate**: Less repetitive code compared to a strict four-layer approach.

### Practical Example (Revised)

The original example showed a strict layering:

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

The revised, pragmatic approach allows the service layer to bypass the repository for simple cases:

```javascript
// src/db/einvites.js
async function getEinviteInfo(einvite) {
  const rows = await queryP_readOnly('select * from einvites where einvite = ($1);', [einvite]);
  return rows.length ? rows[0] : null;
}

// src/services/einvite/einviteService.js
import { getEinviteInfo as dbGetEinviteInfo } from '../../db/einvites.js';

async function getEinviteInfo(einvite) {
  const info = await dbGetEinviteInfo(einvite); // Directly using the DB module
  // Bypassing the repository layer because this is a simple single-table query
  // and the repository would add no value.
  if (!info) {
    throw new Error('polis_err_missing_einvite');
  }
  return info;
}
```

This revised architecture prioritizes a clear separation of concerns while acknowledging the practical need to avoid excessive layering. The key is to be pragmatic, not dogmatic, and to document any deviations from the standard layered approach. This provides a balance between maintainability, testability, and code simplicity.
