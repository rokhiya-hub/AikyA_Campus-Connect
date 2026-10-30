# Local setup report

Local API connectivity follow-up (2026-10-30): all five collection fetches failed
because Express was not running; `server/.env` and inherited `MONGODB_URI` were
absent. The browser used 127.0.0.1 while the original default allowed only
localhost. Local MongoDB port 27017 was reachable, but no database was selected
or queried without configuration. The running Vite server now forwards `/api`
and returns an actionable JSON 503 when Express is unavailable, rather than a
browser-level fetch error. The database choice remains pending user input.

Checks: server tests 87/87 passed; client API/proxy tests 13/13 passed, including
real Vite-to-Express requests for all five collections with isolated synthetic
persistence doubles, followed by a backend-stop/503 check. Production build and
component results are retained in `artifacts/api-connectivity-*.txt`.
Final checks: 61 component tests, the production client build, 56 server syntax
checks and `git diff --check` passed. Actual campus database access is not verified
until an actual connection is configured.
No production database, seed script, fabricated credentials or real data writes
were used. This follow-up changes routing/errors and documents the remaining
setup requirement; it does not substitute a mock backend for the application.

Configuration follow-up: after the user saved their chosen MongoDB connection,
the real backend was started on Node 22. Health and all five campus collection
endpoints returned HTTP 200 both directly on port 5000 and via Vite on port 5173.
Faculty, departments, POIs, buses and events each contained zero records. No seed
was run and no records were inserted. The previously pending database connection
is now working. Authentication is still unconfigured; public browsing works,
while sign-in needs the user's authentication settings. No environment values or
credentials are recorded in this report.
The running Vite instance also had an outdated optimized dependency cache after
development/test server activity. Restarting that owned instance with `--force`
re-optimized dependencies; no source or database records were removed.

Latest events/notification MVP: [NOTIFICATIONS.md](NOTIFICATIONS.md). Verification
on Node 22 (2026-10-30):

| Check | Result | Output |
| --- | --- | --- |
| Server `npm ci` | Passed; 150 packages installed, audit reported 0 vulnerabilities | [install](artifacts/notifications-server-ci.txt) |
| Server `npm test` | 87 passed, 0 failed | [API/security/worker tests](artifacts/notifications-server-tests.txt) |
| Server `npm run check` | 56 files syntax checked; no seeds executed | [syntax](artifacts/notifications-server-check.txt) |
| Client `npm test` | 10 API tests + 60 component tests passed | [client tests](artifacts/notifications-client-tests.txt) |
| Client `npm run build` | Passed | [production build](artifacts/notifications-client-build.txt) |
| Client `npm run test:notifications-browser` | Passed mobile read persistence, error/retry, keyboard focus, scheduling from another timezone, landing link and dock clearance; no permission prompts/page errors/overflow | [browser](artifacts/notifications-browser.txt) |
| Server `npm run test:notifications:local` | Passed real unique claims under concurrency/restart, interrupted delivery, read receipts, cancellation and TTL definitions on its own disposable mongod | [MongoDB](artifacts/notifications-mongo.txt) |
| Existing campus/shop browser regression | Passed maps, search/directions, theme, owner/admin workflows and dashboard errors | [campus/shop](artifacts/notifications-regression-browser.txt) |
| Existing bus browser regression | Passed route browsing, Leaflet tracking and driver consent/start/stop | [bus](artifacts/notifications-regression-bus.txt) |
| `git diff --check` | Passed | No whitespace errors |

An initial dashboard test expected an unverified future demo event to be promoted;
its fixture/assertions now require explicit verification and reject the demo card.
The new browser test's initial HTTP wildcard intercepted a Vite source module;
the harness now intercepts only its explicit synthetic API origin. Both issues
were corrected and the affected suites passed. No current check failures remain.

Only `web-push` and its locked backend dependencies were added for this feature.
Client dependencies were unchanged. All push sends were mocked; actual vendor,
iOS/Android/Safari delivery and elapsed TTL deletion remain unverified. Existing
production data/configuration was not used or changed. The production additive
index command and worker were not started; only disposable test indexes were
created. Earlier sections below retain results for their respective prior work.

Latest assistant implementation: [AI_SERVICE_REPORT.md](AI_SERVICE_REPORT.md).
Current outputs are retained in `artifacts/ai-*.txt`; external providers and
production databases were not contacted by these checks.

Assistant verification (Node 22, 2026-10-30):

| Command | Result | Output |
| --- | --- | --- |
| Server `npm test` | 76 passed, 0 failed | [server tests](artifacts/ai-server-tests.txt) |
| Server `npm run check` | 48 files passed syntax checks; seeds not executed | [syntax checks](artifacts/ai-server-check.txt) |
| Client `npm test` | 10 API tests and 51 component tests passed | [client tests](artifacts/ai-client-tests.txt) |
| Client `npm run build` | Passed | [production build](artifacts/ai-client-build.txt) |
| `git diff --check` | Passed | No whitespace errors |

No new dependencies were needed for the assistant work. Provider replies were
mocked; actual provider/model compatibility and production TTL cleanup remain
unverified. No seed or index provisioning command was executed. Earlier install,
browser and MongoDB checks below describe their respective prior changes.

Latest optional bus tracking implementation and current verification:
[BUS_TRACKING.md](BUS_TRACKING.md). Tracking is off by default; the MongoDB
integration test uses a new temporary loopback replica set, never an existing DB.
Final bus extension checks: 65 backend tests, 46 syntax checks, 10 client API
tests, 48 component tests, production build/simulation exclusion, mobile bus and
existing browser workflows, and real MongoDB transaction/rollback checks passed.

Latest shop/canteen extension: [SHOPS_REPORT.md](SHOPS_REPORT.md), including
current test output and the guarded, non-destructive local migration procedure.
Final extension checks: server 49 tests and 39 syntax checks passed; client 9 API
tests, 33 component tests, production build and mobile Edge workflows passed.
Backend audit: zero vulnerabilities. Frontend audit: 9 affected packages remain.
No database, seed, migration or production index operation was run.

For the subsequent availability/map/dashboard work and current test evidence,
see [CAMPUS_MODULES_REPORT.md](CAMPUS_MODULES_REPORT.md). Earlier run details are
retained below as historical records.

**The original setup run is retained below.** Subsequent backend security
changes and their latest tests are recorded in
[SECURITY_HARDENING.md](SECURITY_HARDENING.md). The current seed process is guarded
and non-destructive by default; descriptions of the old destructive script
below are historical.

Latest security follow-up: server clean install, 28 syntax checks and 25 tests
passed; client 7 tests and production build passed. Server dependency audit
reported zero vulnerabilities. Tests did not contact MongoDB or an AI provider.
See the linked hardening report for exact changes, output and remaining limits.

Date: 2026-10-29 (Asia/Calcutta). Baseline commit: `24584ef`.
Checkout: `C:\Users\Rokhiya\Desktop\AikyA\AikyA`.
Platform: Windows / PowerShell.

## Result

Both clean installs, the frontend production build, backend syntax checks,
and all 13 regression tests passed on the final source/lockfiles.
The backend dependency audit passed with zero findings. The frontend audit
remains nonzero: four affected packages, three moderate and one high.

**No production database was contacted or modified. No seed script ran.**
Live MongoDB, successful DB-backed CRUD/login/chat, provider responses, and
interactive browser behavior were not verified. This report does not certify
those integrations or campus-data accuracy.

## Runtime and execution environment

The machine's default runtime was Node `v20.20.2`, npm `10.8.2`.
The locked `openai@7.10.0` declares Node `>=22.0.0`. Node 18/20 guidance in the
old README was incompatible with that dependency.

Final validation used temporary Node **v22.23.4**, obtained with
`npm exec --yes --package=node@22 -- node --version`. It did not replace the
machine's global Node installation. Both manifests/lockfile roots now declare
Node >=22 and npm >=10, and `.nvmrc` selects 22.

On this Windows installation, `npm.cmd` explicitly invokes the global Node
binary even when entered through `npm exec`. To ensure final commands really
used Node 22, they were invoked from the applicable client/server directory as:

```powershell
npm exec --yes --package=node@22 -- node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" ci --no-audit --no-fund
```

The same prefix was used with `run build`, `run check`, `test`, `ls --depth=0`,
and `audit`. For normal setup, select Node 22+ in your shell and use ordinary
`npm ci`, `npm run build`, `npm run check`, and `npm test` commands.
`--no-audit --no-fund` only separated installation from the explicit advisory
checks; it did not disable lifecycle scripts or bypass lockfile validation.

## Final check output

| Directory | Command after selecting Node 22 | Exit | Result |
| --- | --- | --- | --- |
| `client` | `npm ci --no-audit --no-fund` | 0 | `added 72 packages in 44s` |
| `server` | `npm ci --no-audit --no-fund` | 0 | `added 134 packages in 30s` |
| `client` | `npm run build` | 0 | 2,303 modules transformed; production assets emitted. |
| `client` | `npm test` | 0 | 5 passed, 0 failed. |
| `server` | `npm run check` | 0 | 20 server files parsed, including seeds without executing them. |
| `server` | `npm test` | 0 | 8 passed, 0 failed. |
| `client` | `npm ls --depth=0` | 0 | No missing/invalid top-level dependencies reported. |
| `server` | `npm ls --depth=0` | 0 | No missing/invalid top-level dependencies reported. |
| `server` | `npm audit` | 0 | `found 0 vulnerabilities` |
| `client` | `npm audit` | 1 | `4 vulnerabilities (3 moderate, 1 high)` |
| Repository root | `git diff --check` | 0 | No whitespace errors. |

Selected literal build output (final run):

```text
> campusx-client@1.0.0 build
> vite build

vite v5.4.21 building for production...
transforming...
✓ 2303 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                               1.32 kB │ gzip:   0.69 kB
dist/assets/aditya_campus_map-mgAf28M8.png  490.58 kB
dist/assets/Admin-CvgKGL44.js                19.98 kB │ gzip:   5.66 kB
dist/assets/index-B85j5XoM.js               355.62 kB │ gzip: 114.53 kB
✓ built in 6.26s
```

All lazy page chunks built successfully. Build output remains ignored by Git.

Backend syntax output:

```text
> campusx-server@1.0.0 check
> node scripts/check.js

Syntax checked 20 server files (seed files parsed, never executed).
```

Client test result excerpt:

```text
ok 1 - HTTP errors retain the API message and status
ok 2 - non-JSON HTTP errors have a useful fallback
ok 3 - JSON null error bodies retain the HTTP failure
ok 4 - successful API responses retain their shape
ok 5 - Leaflet text escapes markup and attribute delimiters
# tests 5
# pass 5
# fail 0
```

Backend test result excerpt:

```text
ok 1 - health responds without a database connection
ok 2 - chat rejects malformed or oversized messages before retrieving data
ok 3 - login rejects object selectors and nonstring passwords
ok 4 - analytics rejects anonymous, invalid, and faculty tokens
ok 5 - all collection writes require admin authorization before database access
ok 6 - missing signing configuration fails closed
ok 7 - new faculty documents never serialize password hashes
ok 8 - missing MongoDB URI fails before connecting
# tests 8
# pass 8
# fail 0
```

Tests use mocked fetch responses on the client and an ephemeral localhost HTTP
listener on the server. They instantiate an unsaved synthetic Mongoose document
and generate a process-local signing key. Importing the app does not connect
to MongoDB; database-dependent handlers are rejected before access in these
tests. The missing-URI check deliberately removes the URI before invoking the
connection helper and restores the previous value afterwards.

## Dependency review

Final top-level versions reported by `npm ls --depth=0`:

| Client | Version | Server | Version |
| --- | --- | --- | --- |
| React / React DOM | 18.3.1 | Express | 4.22.3 |
| Vite | 5.4.21 | Mongoose | 8.24.4 |
| @vitejs/plugin-react | 4.7.0 | OpenAI | 7.10.0 |
| React Router DOM | 6.30.6 | bcryptjs | 3.0.3 |
| Framer Motion | 13.2.0 | jsonwebtoken | 9.0.3 |
| Leaflet | 1.9.4 | cors | 2.8.6 |
| lucide-react | 1.42.0 | dotenv | 16.6.1 |
| | | nodemon | 3.1.14 |

Compatible security updates recorded in the lockfiles:

- Client `source-map-js`: 1.2.1 → 1.2.2.
- Server `express`: 4.22.2 → 4.22.3; `body-parser`: 1.20.6 → 1.20.9;
  `proxy-addr`: 2.0.7 → 2.0.8; `qs`: 6.15.3 → 6.16.2;
  `brace-expansion`: 5.0.9 → 5.0.12.

Used `npm audit fix --package-lock-only --ignore-scripts`, without `--force`.
A second compatible backend resolution was needed to clear the remaining
Express/qs findings. Both folders were then installed again with `npm ci`
and the final build/tests were run against those installed dependencies.

The frontend audit still identifies Vite/esbuild and React Router/Router DOM.
npm proposes Vite 8.3.5 and Router DOM 7.18.5, which are major migrations.
Those upgrades were deferred to preserve the existing architecture and allow
separate review. Advisory details and application exposure limits are in
[CODE_AUDIT.md](CODE_AUDIT.md). A successful build does not resolve these findings.

## Earlier failures and recovery

- Initial sandboxed frontend `npm ci` failed during esbuild installation with
  `EPERM: operation not permitted, lstat 'C:\Users\Rokhiya'`, with cleanup/log
  path warnings. Rerunning outside that filesystem restriction succeeded.
- Initial server installation succeeded under Node 20 but emitted
  `EBADENGINE` for OpenAI's Node >=22 requirement. An initial `npm exec ... npm`
  attempt also used Windows' global Node 20. Final installs/checks invoked
  npm's JS entry through Node 22 as documented above and had no engine warnings.
- Initial sandboxed npm audit calls could not reach the registry endpoint or
  write npm cache logs. Retried with the required network/filesystem access;
  final audit results are recorded above.
- An intermediate implementation build failed on duplicate `body`/`err`
  declarations introduced while editing the API error handler. Corrected
  before the final successful build; this was not a baseline import defect.
- PowerShell JSON conversion could not parse lockfile empty-string package
  keys. Restored the baseline locks and used Node JSON serialization to retain
  dependency entries before applying the reviewed security patches. Final
  lockfiles pass `npm ci`; their dependency changes are enumerated above.

## Changed files

```text
.nvmrc                                      (new)
README.md
client/.env.example                         (new)
client/package.json
client/package-lock.json
client/src/admin/entityConfig.js
client/src/api/client.js
client/src/components/AdminCrud.jsx
client/src/components/CampusMap.jsx
client/src/components/GlobalSearch.jsx
client/src/lib/escapeHtml.js                 (new)
client/src/lib/useUniverse.js
client/src/pages/Admin.jsx
client/test/api.test.js                      (new)
docs/CODE_AUDIT.md                           (new)
docs/LOCAL_SETUP_REPORT.md                   (new)
server/.env.example
server/package.json
server/package-lock.json
server/scripts/check.js                     (new)
server/src/config/db.js
server/src/middleware/auth.js
server/src/models/Faculty.js
server/src/routes/auth.js
server/src/routes/chat.js
server/src/routes/faculty.js
server/src/server.js
server/test/safety.test.js                   (new)
```

No modules, seed data, map assets, or database records were removed. There
were no commits, pushes, deployments, or changes to real `.env` files.

## Remaining verification

Use an owner-supplied isolated test database and actual provider configuration
for successful CRUD, faculty login/timetable, chat/retrieval, and admin analytics
integration checks. Test the existing pages in a browser for login/logout,
theme/tile switching, search without shop hours, mobile navigation, keyboard
access, external tiles and geolocation. No browser automation/lint suite was
present; the added unit/HTTP checks do not substitute for these checks.
