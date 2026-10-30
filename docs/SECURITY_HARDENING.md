# Backend security and reliability changes

Date: 2026-10-29. This follow-up supersedes the resolved security findings in
the original [code audit](CODE_AUDIT.md). It extends the existing Express
routers, Mongoose models, React API client and admin/faculty pages. No modules
or campus data were replaced, and no live database or destructive seed command
was used during implementation.

## Authentication and startup

`server/src/middleware/auth.js` has no JWT secret fallback. Tokens are signed
and verified with HS256 only; unsupported roles, invalid faculty subjects,
invalid signatures and expired tokens are rejected. Roles come from signed
claims, never request bodies. Missing signing configuration returns 503 from
authentication operations in development.

`server/src/config/security.js` and `server/src/server.js` validate production
configuration **before connecting to MongoDB**. With `NODE_ENV=production`,
startup requires a JWT secret of at least 32 bytes, a nonempty admin username,
an admin password of 12-72 bytes, explicit exact browser origins, and a MongoDB
URI. Configuration errors name the missing requirement without printing its
value. `.env.example` documents these requirements with blank secrets.

Existing faculty password hashes remain valid; new/admin-reset faculty
passwords require at least 12 characters and at most 72 UTF-8 bytes. Login
does not impose the new creation minimum on existing accounts. Async bcrypt
hash/compare avoids blocking the event loop. Faculty email changes/creation
check for an existing account using that email and return 409 on collision.

## Route access policy

| Route | Public | Faculty | Admin |
| --- | --- | --- | --- |
| `GET /api/health` | Process health | Same | Same |
| `GET /api/departments`, `/api/poi`, `/api/buses`, `/api/events`, and `/:id` | Public projection | Public projection | Public projection by default |
| Those resource reads with `view=private` | 401 | 403 | Allowed |
| `GET /api/faculty` and `/:id` | Public projection | Public projection by default | Public projection by default |
| Faculty reads with `view=private` | 401 | Own email/timetable only; other records stay public | Full permitted faculty fields |
| `GET /api/faculty/:id/timetable` | 401 | Owner only | Any faculty |
| `POST /api/departments`, `/api/poi`, `/api/buses`, `/api/events`, `/api/faculty` | 401 | 403 | Allowed, schema-validated and audited |
| `PUT /api/departments/:id`, `/api/poi/:id`, `/api/buses/:id`, `/api/events/:id` | 401 | 403 | Allowed, schema-validated and audited |
| `PUT /api/faculty/:id` | 401 | Owner, self-edit fields only | Permitted admin fields |
| `PUT /api/faculty/:id/timetable` | 401 | Owner | Any faculty |
| Resource `DELETE /:id`, including faculty | 401 | 403 | Allowed and audited |
| `POST /api/auth/login` | Rate-limited credential exchange | Same | Same |
| `GET /api/auth/me` | 401 | Own signed principal | Own signed principal |
| `POST /api/chat` | Rate-limited public chat | Same public context | Same public context |
| `GET /api/chat/analytics` | 401 | 403 | Allowed; includes recent query text |

There is no public QueryLog or AuditLog CRUD route. Unexpected routes return
safe JSON 404 responses. A supplied invalid Bearer token is rejected rather
than silently downgraded to anonymous access.

Faculty self-edit fields remain `designation`, `email`, `subjects`, and
`onLeave`. Timetable changes use the dedicated owner/admin route. Attempts to
modify another faculty ID or send structural/privileged fields return 403.
This includes name, department, cabin, block, password, passwordHash, role,
and directly assigned availability. Admin operations retain the existing
supported profile, timetable and password-management features.

## Request protection and validation

`server/src/server.js` adds Helmet headers and removes `X-Powered-By`.
CORS accepts only exact origins parsed by `originsFor`; wildcards, malformed
origins and unexpected browser origins are rejected. Development defaults to
`http://localhost:5173`; production has no origin fallback. Server-to-server
requests without an Origin header remain possible and still require route
authorization. CORS does not replace authorization.

Login permits **20 POST attempts per IP per 15 minutes**. Chat permits **30**.
Separate `express-rate-limit` instances count attempts before body parsing,
including malformed/oversized requests, and return JSON 429 with Retry-After.
Proxy trust remains disabled so arbitrary forwarded-address headers cannot
choose a new rate-limit identity. Limits use process-local memory; a deployment
with multiple API instances needs a shared rate-limit store. A reverse proxy
needs an explicit, deployment-specific trust configuration to avoid grouping
all clients under the proxy IP.

JSON bodies are limited to **64 KiB**. Mutation endpoints require
`Content-Type: application/json`. Malformed JSON returns 400, unsupported
content types 415, oversized bodies 413. Express uses the simple query parser.

`server/src/validation/index.js` provides one strict Zod validation approach
for login, chat, list/search parameters, every resource body, nested menu/stop
objects, access policies, allocations, and weekly timetables. It:

- Rejects unknown fields instead of silently dropping them.
- Rejects operator/dotted/prototype keys and nesting beyond 20 levels before
  data reaches Mongoose.
- Trims display/search strings, bounds their lengths and arrays, and rejects
  unsafe control characters. Passwords are not trimmed or logged.
- Validates 24-character hex MongoDB IDs before queries and normalizes their case.
- Validates real ISO event dates, email syntax, coordinate ranges, nonnegative
  room counts, and vacant-room/total-room consistency against merged updates.
- Validates timetable weekdays, HH:MM ranges and start-before-end ordering.
  Clearing a timetable refreshes derived availability instead of leaving stale slots.

Text remains text: descriptions are not converted into executable markup.
React escaping and the previously added Leaflet HTML escaping remain in place.

## Mongoose writes and auditing

`server/src/routes/makeCrudRouter.js` and `faculty.js` use only parsed,
permitted fields. Updates load the existing document, set validated changes,
check merged invariants, and save with Mongoose validation. Request bodies
never become MongoDB update operators. IDs, timestamps, role and raw hashes
are not permitted write fields. Nested schemas also reject unknown fields.

Admin-supplied faculty passwords are hashed server-side; direct passwordHash
assignment is rejected. Credentials are excluded from both serialization and
explicit API projections.

`server/src/models/AuditLog.js` and `services/auditService.js` persist a record
before each authorized mutation: principal ID/role, action, resource, target,
request ID, nonsecret changed field names, and status. No body values,
passwords, hashes, tokens, chat text, or Authorization headers are recorded.
If the initial audit write fails, the resource mutation does not run and the
API returns 503. On success/failure, the audit status is updated.

If the completion-status write fails after an application change, the existing
attempt record remains and a minimal structured completion-failure event is
emitted. The completed mutation still returns success, avoiding a misleading
failure/retry. Operations must monitor and reconcile these pending records.
Audit and resource writes are not a cross-collection transaction.

The application's database identity therefore needs insert/update permission
for the new AuditLog collection. Audit logs have no application delete route
and are not erased by local seed resets.

## Public-data privacy

`server/src/services/publicData.js` uses explicit response-field lists and
nested projections, making new unrelated schema fields private by default.

- Public faculty reads omit email/login identifiers, passwordHash, passwords,
  and detailed timetables. Owner/admin private views retain the permitted
  profile fields; no view returns password hashes or passwords.
- Public POIs omit warden names, contact details, total/vacant room counts,
  and any unknown fields. Admin private reads preserve these management fields.
- QueryLog data is available only through admin-authenticated analytics.
- `campusDataService.js` uses the same public projections for AI retrieval,
  loads at most 200 records per selected collection, and caps context at
  20,000 characters. Hostel private fields and faculty login data never enter
  the provider prompt through this retrieval path.
- Console messages contain event/request identifiers rather than questions,
  provider/driver messages, credentials, or raw error objects.

Private views are opt-in even for authenticated admins. The normal frontend
`useUniverse` calls continue to load **public** arrays, preventing private admin
fields from persisting in the shared public cache after logout. AdminCrud
explicitly requests private lists; FacultyPortal requests its owner profile.
Public hostel cards/map/result cards show a privacy label instead of empty
contacts or misleading zero occupancy. No data was deleted from MongoDB.

## Bounded reads and frontend compatibility

Collection endpoints retain their existing **JSON array** response shape.
Supported pagination/search parameters are:

| Parameter | Constraint |
| --- | --- |
| `page` | Integer 1-100; default 1 |
| `limit` | Integer 1-200; default 100 |
| `q` | Trimmed text up to 100 characters; escaped for literal regex search |
| `view` | `public` (default) or authorized `private` |
| POI `type` | Existing POI type enum |
| Event `category` | Text up to 100 characters |

Unknown, repeated/array-valued, operator and nested query parameters are
rejected. Search fields are fixed per resource; callers cannot choose database
field names, sort expressions, or projections. Reads use deterministic
creation-time/ID ordering, `limit + 1` for continuation, and a 3-second MongoDB
execution budget. Detail and faculty-login queries also have an execution budget.

Responses expose `X-Has-More`, `X-Next-Page` and `X-Page` through CORS.
`client/src/api/client.js` follows up to 100 pages at 200 records per page and
returns one array to existing pages. It throws on exceeding this bound instead
of silently discarding additional records. Clients may use bounded `q` searches
for larger datasets. No response-envelope migration was required.

## Seed safety and idempotence

`server/src/seed/safety.js` checks all conditions **before a connection**:

1. Explicit `NODE_ENV=development` or `test`.
2. The `--confirm-local` flag.
3. A `mongodb://` URI using localhost, 127.0.0.1 or ::1.
4. A database name ending in `_local` or `_test`.
5. No replica-discovery/other unexpected URI options. The connection is forced
   to `directConnection: true` to avoid discovery of remote replica members.

The default command `npm run seed -- --confirm-local` performs insert-only
upserts with stable keys: department code, faculty name, POI type/name, bus
route number, and event title/date. Existing records, admin edits, passwords
and timetables are preserved. Only newly inserted faculty receive the existing
sample timetables. No shared password is provisioned. Existing accounts are
not silently rotated or overwritten.

Deleting the six legacy seed collections additionally requires **both**
`--reset` and `--confirm-reset=DELETE_LOCAL_SEED_DATA`. All other local/test
checks still apply. Production environments, remote/SRV URIs, ambiguous
database names and unconfirmed resets are rejected. Requiring the seed module
does not execute it. Seed runs persist an audit attempt/status; AuditLog is
outside reset deletion. No seed or reset command ran during this work.

Insert-only upserts do not reconcile duplicates already present in a database,
and natural keys are not new unique indexes. Run one seed process at a time;
concurrent import coordination and existing-duplicate cleanup need separate
data-owner planning. These commands remain local/test fixtures, not production
data migrations.

## Error handling and runtime reliability

`server/src/middleware/errors.js` centralizes async-route failures and emits
safe JSON with a generated request ID. Validation errors return 400, conflicts
409, database availability failures 503, and unexpected failures 500 without
driver messages or stack traces. Clients can correlate X-Request-Id with
minimal server events. No client-supplied request ID is trusted for logging.

MongoDB has bounded selection/connect/socket timeouts and a pool size of 10.
The executable disables Mongoose command buffering before connecting, handles
listener failures and closes the listener/database on SIGINT/SIGTERM with a
shutdown deadline. AI calls use a 30-second timeout and one retry. A QueryLog
write failure no longer discards an already generated answer. Existing friendly
chat fallback behavior is retained for database/provider failures.

## Verification

Final checks used Node **22.23.4** with npm 10.8.2, through the temporary Node
runtime invocation documented in [LOCAL_SETUP_REPORT.md](LOCAL_SETUP_REPORT.md).

| Check | Result |
| --- | --- |
| Server `npm ci --no-audit --no-fund` | Passed; 140 packages installed from the updated lockfile |
| Server `npm run check` | Passed; 28 files parsed, seed modules not executed |
| Server `npm test` | Passed; 25 tests, 0 failures |
| Server `npm audit` | Passed; 0 vulnerabilities |
| Client `npm test` | Passed; 7 tests, 0 failures |
| Client `npm run build` | Passed; 2,303 modules transformed |
| `git diff --check` | Passed |

Selected literal output from the final runs:

```text
Syntax checked 28 server files (seed files parsed, never executed).
# tests 25
# pass 25
# fail 0
found 0 vulnerabilities

# tests 7
# pass 7
# fail 0
vite v5.4.21 building for production...
✓ 2303 modules transformed.
✓ built in 1m 15s
```

An intermediate centralized-auth refactor incorrectly changed missing-token
responses from 401 to 403. Regression tests caught it; the admin guard now
propagates authentication errors correctly, and the final full backend run
passes. No earlier failure is being counted as a successful final check.

Tests use isolated HTTP listeners, synthetic data and process-local credentials.
The persistence doubles use real Mongoose documents, schemas, validation,
serialization and faculty methods; they do not connect to any database.
Successful admin/faculty workflows are tested through the actual Express
routers, alongside rejection cases, privacy projections, audit failures,
pagination, rate limiting and seed guards/upserts.

Files changed for this follow-up (earlier audit fixes remain in the worktree):

| Area | Files |
| --- | --- |
| Startup and HTTP controls | `server/src/server.js`, `config/security.js`, `config/db.js`, `middleware/auth.js`, `middleware/errors.js` |
| Validation and response privacy | `server/src/validation/index.js`, `services/publicData.js`, `services/collectionService.js` |
| Existing routers | `server/src/routes/auth.js`, `chat.js`, `faculty.js`, `makeCrudRouter.js` |
| Auditing | `server/src/models/AuditLog.js`, `services/auditService.js` |
| Existing model/services | `server/src/models/Faculty.js`, `services/aiService.js`, `services/campusDataService.js` |
| Seed protections | `server/src/seed/seed.js`, `seed/safety.js` |
| Dependencies/configuration | `server/package.json`, `server/package-lock.json`, `server/.env.example` |
| Frontend compatibility | `client/src/api/client.js`, `components/AdminCrud.jsx`, `components/FacultyPortal.jsx`, `components/CampusMap.jsx`, `components/resultCards.jsx`, `pages/Hostels.jsx` |
| Tests | `server/test/security.test.js`, `test/safety.test.js`, `test-support/memoryModels.js`, `client/test/api.test.js` |
| Documentation | `README.md`, `docs/SECURITY_HARDENING.md`, current-status notes in `docs/CODE_AUDIT.md` and `docs/LOCAL_SETUP_REPORT.md` |

Remaining deployment checks: real MongoDB persistence/index behavior, actual
provider responses, browser interactions and deployment proxy/store topology.
No new unique identity indexes or data migrations were applied; application
email collision checks cannot replace a reviewed unique-index migration under
concurrent writes. Existing demo accounts still need owner-managed password
rotation if they were ever deployed. Token revocation, data-retention policies
and the pre-existing frontend dependency major upgrades remain separate work.
