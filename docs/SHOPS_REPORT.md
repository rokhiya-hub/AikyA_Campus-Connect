# Campus shops and canteen extension

Implemented on 2026-10-29 in the existing React/Express/Mongoose application.
`PointOfInterest` remains the source of shops; `/canteen` remains the existing
Food & Shops page. No production database, configured credentials or external
AI provider was accessed. No seed, migration or index creation was executed.
Existing demo prices, menu names, coordinates and opening-hour strings were
preserved; test fixtures are explicitly synthetic.

## Using the interfaces

- **Students and guests:** open Food & Shops, search a listed product/service,
  filter shop/item categories or area, and page through matching shops. Cards
  show location/floor, contact when supplied, display price, stock report and
  separate update times. Report inaccurate stock, price, hours or location using
  the report form. Reports are private to administrators and never automatically
  change a listing. There is no existing student identity provider, so these
  submissions are honestly labelled unverified student/guest reports.
- **Owners:** open Admin, request a shop-owner account and wait for approval.
  An administrator must approve the account and assign a shop. Select **Shop
  owner** when signing in. The owner portal lists only assigned shops and lets
  owners add/edit/archive/restore items, explicitly report stock, change prices,
  reconfirm unchanged prices, and maintain contact and schedules. Saving an
  archived item restores it. Archived entries remain stored and count toward
  the 200-entry menu limit.
- **Administrators:** sign in normally, then select **Shops & owners**. Approve,
  suspend or return accounts to pending; copy an approved account ID into a
  shop's ownership form to assign/reassign it. An empty ID removes assignment.
  The current assignment is loaded separately through an admin-only endpoint.
  Review pending reports, record a moderation note, and resolve or dismiss them.
  Correct the actual listing separately. Admins can classify and officially
  verify a listing only with a confirmation source and date. Listing verification
  does not verify current prices, inventory, coordinates or room allocations.

## Data and compatibility

[PointOfInterest.js](../server/src/models/PointOfInterest.js) and
[shopFields.js](../server/src/models/shopFields.js) retain the existing `items`,
string `price` and Boolean `available` fields. New item subdocuments add
`category`, keywords, active/archive state, search tokens, and independent
`pricing` and `stock` metadata. Both reports store server-generated
`lastUpdatedAt` and `updatedBy: {id, role}`. Item-level edit metadata is also
stored. Clients cannot supply report timestamps or actor IDs.

Stock freshness expires after **2 hours**, and price freshness after **7 days**.
These are application policies, not claims about campus operations. Legacy,
missing, future-dated, unknown or stale stock reports display **Availability
unconfirmed**. Recent reports say **Reported in stock — confirm with shop** or
**Reported out of stock**. Missing/stale prices are labelled unconfirmed. Old
availability Booleans and document `updatedAt` never manufacture a report time.
Legacy/demo listings default to `demo_unverified` until officially verified.

[shopData.js](../server/src/services/shopData.js) owns freshness and schedule
semantics. Every weekly day is independent. Missing days mean unknown; explicit
empty periods mean scheduled closed. Start times use strict `HH:MM`; end times
also allow `24:00`. Overlaps, backwards/overnight spans, invalid dates and
duplicate dated entries are rejected. Split overnight hours across days.
Exceptions override holidays, which override weekly hours. No holidays are
invented. The timezone is always **Asia/Kolkata**. Scheduled opening is never a
claim that the shop is physically open. Canteen refreshes at most once per minute
while mounted; cached map/AI snapshots include report timestamps and honest
confirmation labels.

[publicData.js](../server/src/services/publicData.js) publishes actor roles,
not owner IDs/emails. Shop contact is public; hostel contact remains private.
Public responses hide archived items and ownership. Owner/admin management
views include archived entries. `/api/poi` retains its array API and existing
admin editor: full-menu edits match existing names to preserve item IDs/report
history and archive omitted items. Use the item API to rename entries while
preserving their IDs. Unchanged legacy prices/Booleans are not reconfirmed just
by saving the legacy editor.

## API and security changes

The implementation lives in [routes/shops.js](../server/src/routes/shops.js),
[validation/shops.js](../server/src/validation/shops.js),
[ShopOwner.js](../server/src/models/ShopOwner.js) and
[ShopFeedback.js](../server/src/models/ShopFeedback.js).

| Endpoint | Access / behavior |
| --- | --- |
| `GET /api/shops` | Public arrays with `page`, `limit`, product `q`, shop `category`, `itemCategory`, exact `area`. `mine=true` requires an active owner; `manage=true` requires admin. |
| `GET /api/shops/:id` | Public shop details; non-shop POIs are rejected. |
| `GET /api/shops/:id/owner` | Admin-only current assignment. |
| `PUT /api/shops/:id/owner` | Admin-only `{ownerId: approvedAccountId or null}`. |
| `PUT /api/shops/:id` | Assigned active owner: contact, display hours, schedule. Admin additionally: category and official verification. |
| `POST /api/shops/:id/items` | Assigned active owner/admin; add a validated item. |
| `PUT /api/shops/:id/items/:itemId` | Assigned active owner/admin; permitted fields only. `stockStatus` reports `in_stock`, `out_of_stock` or `unknown`; `active:false` archives. |
| `POST /api/shops/:id/feedback` | Rate-limited public report; validates item belongs to shop; opaque receipt only. |
| `POST /api/shop-owners/register` | Rate-limited account request; status is always pending. Duplicate email returns the same receipt. |
| `POST /api/auth/shop-owner/login` | Separate rate-limited login; approved accounts only. |
| `GET /api/shop-owners` | Admin-only paginated account summaries; never hashes/token versions. |
| `PUT /api/shop-owners/:id` | Admin-only permitted name/status/password changes. |
| `GET /api/shop-feedback` | Admin-only paginated moderation queue; optional pending/resolved/dismissed status. |
| `PUT /api/shop-feedback/:id` | Admin-only resolved/dismissed decision with a required moderation note. |

Security fixes and their purposes:

1. Every owner mutation reloads the account's approval/token version and the
   shop's current assignment. JWTs carry no trusted shop-ID permission list.
   Reassignment removes the former owner's scope on subsequent requests;
   suspension/status changes/password resets revoke previously issued sessions.
   `/auth/me` also checks owner account status. Already-running requests are not
   transactionally cancelled when a different document is suspended.
2. Owner login has its own endpoint, preserving existing admin/faculty login
   semantics. Passwords use bcrypt; account summaries exclude hashes and token
   versions. New owner email has a unique normalized index. Registration hashes
   passwords on both existing/new-account paths and uses a uniform receipt.
3. All bodies, IDs, filters and pagination use strict Zod schemas and the existing
   unsafe-key rejection. Each mutation assigns only permitted fields. Owners
   cannot assign accounts, verify listings, change campus locations or write
   another shop. Duplicate item names are rejected in the item editor.
4. Adding a role exposed a formerly implicit assumption in faculty self-service:
   matching `sub` alone was sufficient. The guard now explicitly requires the
   faculty role as well as the matching ID. Private faculty views also reject
   shop-owner sessions. Analytics and shared CRUD stay admin-only.
5. Account approval, assignment, menu/schedule changes and report moderation use
   the existing fail-closed audit service. Logs store actor/action/target/field
   names, not passwords, tokens or report message contents. Audit failure blocks
   the write. Mongoose optimistic concurrency and HTTP 409 handling protect
   against conflicting POI edits, including concurrent reassignment.
6. Owner login uses the existing 20-attempt/15-minute login limiter. Public owner
   registration and listing feedback share a 10-attempt/15-minute per-IP budget.
   Existing Helmet, restricted CORS, 64 KB JSON limit and centralized errors apply.
   These in-memory limits are per process; multi-instance deployments need a
   shared store and a reviewed proxy configuration.
7. Map and AI shop responses now distinguish reported stock/scheduled hours from
   live presence. Feedback submissions do not invalidate the public collection
   cache, preserving the report receipt and avoiding a pointless page refresh.

Search is limited to 100 characters/eight whitespace-separated terms, page
1–100, limit 1–100 (default 30), with a three-second database execution limit.
Matching terms must belong to the **same active item**. Names, item categories
and supplied keywords use normalized lowercase token-prefix matching; common
photocopy/xerox and colour/color variants share search tokens. Legacy shops
without `catalogVersion:1` retain a bounded raw-field fallback until migrated.
Arrays retain `X-Page`, `X-Has-More`, `X-Next-Page` pagination headers.

Indexes cover type/category/page, type/item search tokens, owner assignments,
unique owner email, owner moderation and feedback status/date/shop. POI automatic
index creation is disabled; the migration offers additive `createIndexes`, never
`syncIndexes` or index deletion. New account/feedback models retain Mongoose's
normal index initialization. If deployment disables auto-indexing globally,
   provision these indexes before accepting registrations. Registration checks
   the actual unique email index and fails closed if it is absent.

## Safe local migration

[scripts/migrate-shops.js](../server/scripts/migrate-shops.js) is dry-run by
default. It accepts only an explicitly local/test environment and loopback
MongoDB database ending `_local` or `_test`, using the existing seed safety
guard. It backfills missing item IDs, unclassified categories, search tokens
and catalog version. It never changes price, stock, legacy availability,
verification, coordinates or ownership, nor manufactures report timestamps.
Updates compare source `__v`/`updatedAt`, increment the version and audit each
write; concurrent changes are skipped and counted. Reruns are idempotent.

After configuring **your own disposable local/test database**, use Node 22+:

```powershell
cd server
$env:NODE_ENV = "development"
npm run migrate:shops -- --confirm-local
# Review the dry-run count and a local backup before applying:
npm run migrate:shops -- --confirm-local --apply
# Optional additive local index creation:
npm run migrate:shops -- --confirm-local --apply --indexes
```

No reset option exists. These commands were **not executed** during this work.
This script intentionally refuses production/remote targets. A production
rollout requires a separately reviewed backup, rehearsal and operations plan;
do not weaken the local guard to point it at production.

## Changed files for this extension

Existing files extended: `client/src/api/client.js`, `context/AuthContext.jsx`,
`pages/Admin.jsx`, `pages/Canteen.jsx`, `components/CampusMap.jsx`,
`components/resultCards.jsx`, `App.css`, `browser-tests/campus-smoke.cjs`;
`server/package.json`, `src/server.js`, `middleware/auth.js`,
`middleware/errors.js`, `routes/auth.js`, `routes/faculty.js`,
`routes/makeCrudRouter.js`, `models/PointOfInterest.js`, `models/AuditLog.js`,
`services/publicData.js`, `services/collectionService.js`,
`services/campusDataService.js`, `test-support/memoryModels.js`;
`client/test/api.test.js`; README and report
links. Previous task changes in the working tree were preserved.

New files: `client/src/components/ShopDetails.jsx`, `ShopManagement.jsx`,
`client/component-tests/shops.test.jsx`; `server/src/models/ShopOwner.js`,
`ShopFeedback.js`, `shopFields.js`, `src/routes/shops.js`,
`src/validation/shops.js`, `src/services/shopData.js`,
`scripts/migrate-shops.js`, `test/shops.test.js`; this report and synthetic
`docs/artifacts/shops-mobile.png` screenshot.

## Verification

Node 22.23.4 was used through a temporary npm runtime because the machine's
default Node is 20.20.2. No new application dependency was needed.

Final verification output:

```text
server: npm run check
Syntax checked 39 server files (seed files parsed, never executed).

server: npm test
# tests 49
# pass 49
# fail 0

client: npm test
API tests: 9 passed, 0 failed
Test Suites: 6 passed, 6 total
Tests: 33 passed, 33 total

client: npm run build
2308 modules transformed.
built in 6.04s

client: npm run test:browser
Shop browser smoke PASS: mobile product search, unverified labels,
feedback submission, owner login and stock editing, admin moderation
and suspension; no horizontal overflow.
Existing campus map/faculty/dashboard browser smoke: PASS; no page errors.

git diff --check: PASS
npm audit (server): 0 vulnerabilities
npm audit (client): 9 affected packages: 5 low, 3 moderate, 1 high
```

Complete output: [server tests](artifacts/shop-server-tests.txt),
[client tests](artifacts/shop-client-tests.txt),
[client build](artifacts/shop-client-build.txt),
[browser tests](artifacts/shop-browser-tests.txt),
[server dependency audit](artifacts/shop-server-audit.json) and
[client dependency audit](artifacts/shop-client-audit.json).
The [mobile screenshot](artifacts/shops-mobile.png) uses synthetic listings.

The existing frontend audit findings involve Vite/esbuild, React Router and
the Jest/deepmerge dependency chain. They remain unresolved; no forced major
upgrades were applied as part of this module extension. Backend audit is clean.
No new application dependency was added. Clean-install commands and results
from the earlier setup work remain in [LOCAL_SETUP_REPORT.md](LOCAL_SETUP_REPORT.md).

The API suites use actual Mongoose schemas with in-memory persistence doubles;
the browser suite runs real React/Leaflet in headless Edge against the same
synthetic API. They do not prove MongoDB query planner performance, real unique
index enforcement or concurrent multi-process races. No real campus inventory,
holiday calendar, price, indoor route or shop allocation was verified. Real
MongoDB rehearsal and query `explain` remain deployment checks.

An initial migration test failed because adding the default category required
a second token backfill; the migration was corrected and its idempotency test
passes. The first new browser run caught feedback refresh hiding its receipt;
the cache event was corrected and the full browser run passes.
A component test also needed to await the post-save shop reload before clicking
Archive; that timing assumption was corrected and the complete suite passes.
