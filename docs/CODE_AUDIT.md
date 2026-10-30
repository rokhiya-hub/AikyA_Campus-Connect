# AIKYA code audit

Local API connectivity follow-up: `client/src/api/client.js` now defaults to
same-origin `/api`; `client/vite.config.js` forwards development requests to
Express on loopback port 5000 and returns a clear 503 when it is offline.
`server/src/config/security.js` permits both exact development hostnames,
localhost and 127.0.0.1; production origins remain explicit. Shared collection
outages are summarized once in `client/src/lib/useUniverse.js`, with individual
errors/retry behavior preserved. At diagnosis, `server/.env` and inherited
`MONGODB_URI` were absent and port 5000 was not listening. Actual campus records
still require an operator-selected database; no fallback data or credentials
were invented. See the latest local setup report for verification.

Latest notification MVP: [NOTIFICATIONS.md](NOTIFICATIONS.md) records the models,
API/role enforcement, durable scheduling and delivery claims, verified dates,
retention, mobile/accessibility changes and tests. Confirmed prior issues fixed:
`client/src/components/Navbar.jsx` derived alerts from unverified legacy events;
`server/src/models/Event.js` lacked offset-aware timestamps/verification;
`client/src/pages/Dashboard.jsx` promoted any future date as upcoming.
No existing event records were rewritten. Remaining limitations: no student
identity service, at-most-once optional push (not guaranteed delivery), and actual
mobile push platforms awaiting deployment testing. See the linked operational guide.

Latest assistant changes: [AI_SERVICE_REPORT.md](AI_SERVICE_REPORT.md) documents
provider configuration, evidence grounding, consent/privacy, bounded requests,
metadata retention and deterministic tests. Legacy raw logs require separate
owner-reviewed retention remediation; no production records were modified.

Optional transport tracking: [BUS_TRACKING.md](BUS_TRACKING.md) documents the
feature flag, device/trip authorization, privacy boundaries, transaction and
retention requirements, browser limitations, simulation isolation and tests.

Shop/canteen follow-up: [SHOPS_REPORT.md](SHOPS_REPORT.md) records owner-scoped
permissions, reported inventory freshness, schedules, feedback moderation,
indexes and backward-compatible migration. No production records were changed.

Latest campus-module work: [CAMPUS_MODULES_REPORT.md](CAMPUS_MODULES_REPORT.md)
documents the corrected per-weekday availability, timestamp semantics, stable
building references, map verification labels, cache/error handling and tests.

**Initial audit snapshot.** The subsequent backend security work resolves
several items listed as open below. See [SECURITY_HARDENING.md](SECURITY_HARDENING.md)
for the current route policy, seeding safeguards, validation, privacy controls,
and latest verification. Historical findings below retain their original references.

Audit date: 2026-10-29 (Asia/Calcutta). Baseline: `24584ef`.
Scope: the existing local checkout of `satya-sri-karri/AikyA`, under `AikyA/`.
No production database was contacted, no seed script was executed, and no
campus facts, credentials, or environment values were invented.

Findings below distinguish fixes made in this change from open issues. Line
references describe this working tree; named functions make them traceable
after later edits. Static findings are not claims of production exploitation.
Actual execution evidence and limitations are in
[LOCAL_SETUP_REPORT.md](LOCAL_SETUP_REPORT.md).

## Confirmed issues fixed

| Priority | Reference | Confirmed behavior and correction |
| --- | --- | --- |
| High | `server/src/config/db.js:1` | Loading DB configuration forcibly changed process DNS to a private router and Google DNS. Removed `dns.setServers` and the DNS import; MongoDB now uses OS resolver configuration. |
| High | `server/src/middleware/auth.js:3`; `server/src/routes/auth.js:23` | Missing `JWT_SECRET` previously fell back to a public source-controlled signing secret, allowing tokens to be forged under that configuration. Removed fallback; signing requires a configured secret and authentication endpoints return 503 when absent. Existing deployments must supply their own secret. |
| High | `server/src/routes/chat.js:52` | Anonymous callers could retrieve recent questions and answers through analytics. Added the existing `adminOnly` guard; faculty and anonymous access are rejected. |
| High | `client/src/components/CampusMap.jsx:472`, `:495`, `:509`; `client/src/lib/escapeHtml.js` | Database-derived POI, room and faculty labels were interpolated into Leaflet HTML and tooltips without escaping, creating a stored-script injection path. Escape all dynamic text at those HTML boundaries. React's normal escaping remains in place elsewhere. |
| Medium | `server/src/routes/auth.js:19` | Truthy objects/arrays could reach the faculty email selector or bcrypt password comparison. Require nonempty string credentials before either operation. |
| Medium | `server/src/routes/chat.js:21` | A numeric/object message caused `.trim()` to throw before the route's try/catch. Validate strings and cap messages at 4,000 characters before database/provider work. |
| Medium | `server/src/models/Faculty.js:89`; `server/src/routes/faculty.js:82` | `select:false` hides hashes on queries, but does not hide a newly created document's hash in POST responses. Added JSON/object serialization transforms and rejected direct `passwordHash` input on creation; passwords still use bcrypt. |
| Medium | `client/src/pages/Admin.jsx:112` | Independent `loggedIn` state stayed true after logout, causing the admin dashboard to remain rendered with no user. The page now renders solely from AuthContext identity/loading state. Server authorization was already separate. |
| Medium | `client/src/lib/useUniverse.js:15`, `:53` | Failed fetches cached an empty collection indefinitely; `refresh` updated module cache without updating the hook's visible data. Failed requests no longer overwrite/cache empty data, and refresh updates the caller's state. Cross-component invalidation remains an open improvement below. |
| Medium | `client/src/components/GlobalSearch.jsx:39` | Shop `openHours` is optional in the schema but search unconditionally lowercased its value. A shop without hours could crash search. Normalize missing shop hours to an empty string. |
| Low | `client/src/api/client.js:21` | The original HTTP error handler assumed parsed JSON was non-null; an HTTP error with body `null` raised a TypeError and lost its status. Safely handle null/non-JSON/nonstring error responses. The baseline did contain `body` and `err` declarations; an initial inspection suggesting otherwise was incorrect. |
| Low | `client/src/components/CampusMap.jsx:365` | Theme changes updated overlays but not the existing tile layer. Retain the layer reference and update its tile URL when theme changes. |
| Low | `client/src/admin/entityConfig.js` faculty password field; `client/src/components/AdminCrud.jsx` FieldInput | Admin faculty passwords were displayed in a text input. Use a password input. |
| Setup | `README.md`; `client/.env.example`; `server/.env.example`; `.nvmrc`; both package manifests/locks | README had an unclosed code fence, incorrect Tailwind/provider configuration, and Node 18 guidance incompatible with locked OpenAI 7.10.0. Added accurate setup, blank secret examples, Node >=22/npm >=10 metadata, and reproducible check/test scripts. |
| Dependencies | `client/package-lock.json`; `server/package-lock.json` | Compatible lockfile security updates were applied without forced major upgrades. Backend audit now reports zero findings. Frontend source-map-js was patched; remaining findings are listed below. |

## Open security and reliability issues

| Priority | Exact references | Evidence and recommended next step |
| --- | --- | --- |
| High | `server/src/seed/seed.js:14-22`, `:815`, `:868`, `:1543` | Seeder immediately connects, deletes all six collections, and assigns a shared source-controlled faculty demo password. It also executes when imported. Retained unchanged and never run. Replace with an explicitly isolated, opt-in fixture workflow and a separate non-destructive import/migration design. Any existing demo accounts require owner-led credential rotation; no records were changed here. |
| High | `client/package-lock.json`, entries `node_modules/vite`, `node_modules/esbuild`, `node_modules/react-router`, `node_modules/react-router-dom` | Final npm audit: four affected package entries (one high, three moderate). npm proposes Vite 8.3.5 and react-router-dom 7.18.5 as breaking changes. Review migrations independently, including Vite plugin compatibility and route behavior. Do not expose development/preview servers as production services. Specific advisory links are below. |
| Medium | `server/src/routes/auth.js` login; `server/src/routes/chat.js` POST; `server/src/server.js` | No request-rate limiting on public login/chat. Synchronous bcrypt work can occupy the event loop, and chat can incur provider/database costs. Introduce measured rate limits, async bcrypt, provider/concurrency budgets, and deployment-specific proxy settings. Message length validation added here does not replace rate limiting. |
| Medium | `server/src/routes/chat.js:39-41`; `server/src/models/QueryLog.js` | Questions/answers are retained indefinitely and questions are also written to console logs. No retention/consent/redaction policy exists. Define retention and access rules, reduce log content, and consider a TTL policy after owner approval of data lifecycle. |
| Medium | `server/src/routes/makeCrudRouter.js` catch blocks; `server/src/routes/faculty.js` catch blocks; `server/src/routes/chat.js` analytics catch | Several API errors return raw `err.message`, including cast/validation/database details. Add consistent safe error mapping; malformed IDs should return 400 instead of 500. |
| Medium | `server/src/routes/makeCrudRouter.js` PUT; `server/src/routes/faculty.js` admin POST/PUT | Admin endpoints accept broad request bodies. Generic updates can include MongoDB update operators; field permissions and nested-object replacement semantics are not explicit. Introduce per-resource allowlists without dropping legitimate existing fields; add DB-isolated integration checks first. |
| Medium | `server/src/server.js:19`; `client/src/api/client.js:6-11`; `server/src/middleware/auth.js` | CORS defaults to all origins when unset; origin entries are not trimmed. Tokens live in localStorage with a seven-day default and have no revocation. Configure exact deployment origins and review session expiration/revocation/storage requirements. No claim is made that CORS is an authorization mechanism. |
| Medium | `server/src/models/Faculty.js` email; `server/src/routes/auth.js` Faculty.findOne | Faculty email is not unique, normalized, or validated, yet is the login identifier and is self-editable. Plan duplicate cleanup and a validated unique identity migration with the data owner before adding an index. |
| Medium | `server/src/models/Faculty.js:9`, `:25`, `:100`, `:119` | Timetable strings lack strict HH:MM/range/order validation. Weekly availability merges busy windows from different weekdays, effectively finding shared free windows rather than preserving day-specific availability. Clearing the final timetable slot can leave stored availability unchanged. Agree on availability semantics before changing existing records or displays. |
| Medium | `server/src/services/campusDataService.js:7`, `:186`; `server/src/services/aiService.js:36` | Retrieval loads entire selected collections; generic queries load all collections. No relevance ranking, pagination or context-token budget exists. The default model ID is not verified against a provider account. Bound retrieval, expose provider readiness, and configure a supported model explicitly. |
| Low | `server/src/routes/chat.js:39`; `server/src/services/aiService.js` | QueryLog failure discards an otherwise successful answer and returns the generic fallback. Provider errors also return HTTP 200, so clients cannot distinguish outage from success. Separate optional logging from answer delivery and define a compatible error contract. |
| Low | `server/src/server.js` health/startup | Health is static; there is no ongoing DB/provider readiness signal, graceful shutdown, or listen-error handling. Add operational lifecycle checks appropriate to the deployment. |
| Low | `client/src/lib/useUniverse.js`; `client/src/components/AdminCrud.jsx` | Cache has no TTL/subscription or mutation invalidation. Refresh updates only the requesting hook; already mounted map/search/dashboard consumers may remain stale after edits. Fetch errors are still represented as empty lists without an error UI. Add observable invalidation and explicit error/retry states. |
| Low | `client/src/api/client.js`; `client/src/lib/useFavorites.js` | Auth storage calls can throw when storage is unavailable. Favorites parsing catches invalid JSON but does not validate that parsed values are arrays. Validate stored shapes and handle unavailable storage. |
| Low | `client/src/components/Sidebar.jsx` SidebarLinks; `client/src/components/AdityaUniversityMap.jsx` closePanel | Mobile navigation does not call `onMobileClose` when a link is selected. A delayed layout-panel close can clear a newly selected building. Add drawer-close routing behavior and cancellable panel timers. |
| Low | `client/src/components/GlobalSearch.jsx`, `EmergencyFab.jsx`, `ChatWidget.jsx`; `client/src/context/ToastContext.jsx` | Modal focus traps, dialog semantics, focus restoration, and some icon-button labels are missing. Toast timers are not tracked for cleanup. Add keyboard/screen-reader checks and lifecycle cleanup without redesigning layouts. |

Dependency advisory evidence from npm audit:

- Vite: [path traversal](https://github.com/advisories/GHSA-4w7w-66w2-5vf9),
  [Windows editor command handling](https://github.com/advisories/GHSA-587h-7wmj-h5pm),
  and other advisories shown by `npm audit --json`.
- esbuild: [development-server cross-origin access](https://github.com/advisories/GHSA-67mh-4wv8-2f99).
- React Router: [open redirect](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6),
  [SSR hydration constructor injection](https://github.com/advisories/GHSA-337j-9hxr-rhxg).
  This application uses BrowserRouter with local destination strings, not SSR;
  the audit identifies affected installed versions, not demonstrated exploitation.

## Missing features and data accuracy gaps

| References | Confirmed gap |
| --- | --- |
| `client/src/components/DirectionsPanel.jsx:8-25`; `client/src/components/CampusMap.jsx` route polyline | Directions always include exiting the main gate and offer unverified ramp/lift guidance. The route is a straight line; distance/ETA use Haversine distance, not paths. Verified road/indoor/accessibility routing requires new authoritative data. |
| `client/src/pages/Dashboard.jsx:33-42`, `:130`, `:175`; `Landing.jsx:103`, `:265`; `Navbar.jsx:29`; `resultCards.jsx:34` | "Today" uses UTC via toISOString instead of the campus/browser date. "Upcoming"/"Next up" slices records in API creation order without date filtering/sorting, so past seeded events can appear as upcoming. Centralize campus-time date handling and retain an all-events view. |
| `client/src/pages/Faculty.jsx:21`, `:74`; `Dashboard.jsx:42`; `server/src/models/PointOfInterest.js` isOpenNow; `BusRoute.js` status | "Available" means not on leave, not free according to the current timetable. Open/route flags are stored/admin values, not live presence/telemetry. Label freshness honestly and define source/update cadence. |
| `client/src/components/ChatWidget.jsx:91`; `server/src/routes/chat.js:15`, `:37-39` | UI says queries were routed for departmental follow-up, but backend only saves an escalation Boolean. There is no assignment queue or notification mechanism. |
| `client/src/components/AIConsole.jsx:137-140`; `server/src/services/aiService.js` messages | Voice and attachments are explicitly placeholders. Chat sends only the current question and campus context, with no conversation history. |
| `client/src/admin/entityConfig.js`; `server/src/models/PointOfInterest.js`, `BusRoute.js` | Admin forms omit menu items/prices, POI latitude/longitude, and bus type/ground. Empty text/number fields are omitted from payloads, preventing some values from being cleared. Extend forms in separately reviewed work while preserving existing data. |
| `server/src/models/PointOfInterest.js`; `client/src/components/CampusMap.jsx` floor rendering | No individual building/floor/classroom/hostel-room/warden models or occupancy records exist. Labs/cabins are derived from departments/faculty; indoor coordinates are scattered for display. The original README overstated those management features. |
| `client/src/components/AdityaUniversityMap.jsx:9`, resolveHotspotDetails; `server/src/seed/seed.js:747`, `:1338` | Static layout facts remain fallback content; the seeder generates emails and approximate shop positions with jitter. These are prototype assumptions, not verified campus records. The allocation DOCX explicitly describes demo assumptions; some assignments differ between it, static hotspots, and seed data. Reconcile with the data owner; existing facts were not rewritten. |
| `client/src/components/EmergencyFab.jsx`; `client/src/pages/Landing.jsx` medical lookup | "Nearest" medical facility is the first matching name or first service, without a proximity calculation. Security/fire buttons just open the map. No dispatch integration is implemented. |
| `client/src/components/resultCards.jsx` buildResult; `AIConsole.jsx` and `ChatWidget.jsx` goTo | Result cards can pick the first faculty/bus/shop by heuristic rather than an entity identified by the server answer. Navigation generally opens `/map` without a selected entity. Add stable IDs/deep links and server-grounded result metadata. |
| `client/src/App.jsx` Routes | Unknown paths have no catch-all route or not-found view. Deployment must also provide SPA rewrites for known deep links. |

## Inventory reviewed

### Frontend pages and providers

All ten page modules were reviewed: `client/src/pages/Landing.jsx`,
`Dashboard.jsx`, `CampusMap.jsx`, `Faculty.jsx`, `Departments.jsx`, `Canteen.jsx`,
`Hostels.jsx`, `Buses.jsx`, `Events.jsx`, and `Admin.jsx`.
They retain their routes, layouts and existing features.

Provider wiring is in `client/src/main.jsx`: BrowserRouter wraps ThemeProvider,
AuthProvider and ToastProvider. Reviewed `client/src/context/AuthContext.jsx`
(token restoration/login/logout), `ThemeContext.jsx` (OS/stored theme), and
`ToastContext.jsx` (transient notices). No provider architecture was replaced.

Reviewed the API client, admin field configuration, both existing hooks, the
stylesheet, HTML entry, Vite configuration, campus map asset reference, and all
14 original component modules: `AIConsole.jsx`, `AIOrb.jsx`,
`AdityaUniversityMap.jsx`, `AdminCrud.jsx`, `CampusMap.jsx`, `ChatWidget.jsx`,
`DirectionsPanel.jsx`, `EmergencyFab.jsx`, `FacultyPortal.jsx`,
`GlobalSearch.jsx`, `Navbar.jsx`, `Sidebar.jsx`, `resultCards.jsx`, `ui.jsx`.
The existing PNG and allocation DOCX remain unchanged.

### Backend routes

| Module | Mounted API and access |
| --- | --- |
| `server/src/server.js` | `GET /api/health`; mounts all resource routers and connects before listening when run directly. |
| `server/src/routes/makeCrudRouter.js` | Departments, POIs, buses and events: public list/detail; admin POST/PUT/DELETE. |
| `server/src/routes/faculty.js` | Public list/detail/timetable; admin creation/deletion; admin or owner profile/timetable updates with self-edit field restrictions. |
| `server/src/routes/auth.js` | Admin/faculty login; authenticated `/me`. |
| `server/src/routes/chat.js` | Public chat POST with query logging; admin analytics GET after this fix. |

Also reviewed `server/src/config/db.js`, `server/src/middleware/auth.js`,
`server/src/services/aiService.js`, and `campusDataService.js`.

### Schemas

| File under `server/src/models/` | Data and validation observations |
| --- | --- |
| `Department.js` | Required name/code/block/floor; optional HOD/labs/contact/hours. No unique code or contact validation. |
| `Faculty.js` | Optional department reference and denormalized fields, secret hash, timetable map and derived slots. Identity/time-validation concerns above. |
| `PointOfInterest.js` | Required type enum/name; shop menu, hostel aggregate counts, coordinates, policies, allocation. No coordinate bounds or nonnegative/occupancy consistency checks. |
| `BusRoute.js` | Required routeNumber, optional stops/times/driver details/type/ground/status. No unique routeNumber or time validation. |
| `Event.js` | Required title/date strings; no ISO-date validity or start/end ordering validation. |
| `QueryLog.js` | Question/answer/escalation with timestamps; no retention policy. |

No schema migration, index creation, or database write was performed.

### Seeds, dependencies and setup files

Reviewed `server/src/seed/seed.js` and its static data modules
`busDetailsData.js`, `facultyMasterData.js`, and `foodAndShopsData.js`.
They combine master tables with enriched demo records, generated values and
fixed event dates. Referenced master source documents other than the allocation
DOCX are not included in the repository; their factual accuracy is unverified.

Reviewed both package manifests and lockfiles, both original gitignore files,
the root README, existing environment example, Vite/HTML entry points, and the
allocation DOCX's text. Dependency major versions and module systems remain
unchanged. No Tailwind, TypeScript, ESLint, or original automated test suite is
configured. Added checks use Node's built-in test runner and no new dependency.

Recommended order for follow-up: isolate destructive/demo seeding; plan Vite
and Router upgrades; add rate limits and log retention; validate identity and
timetables with a migration plan; improve cache/error/date handling; then add
verified navigation and missing admin fields with authoritative campus input.
