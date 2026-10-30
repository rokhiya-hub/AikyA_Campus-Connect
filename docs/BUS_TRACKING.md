# Optional live bus tracking

The existing `/buses` route directory and schedule cards remain available.
Tracking defaults **off**. No route is opted in by default, no devices or trips
are seeded, and the production API contains no simulated location generator.
Implementation date: 2026-10-29. No existing or production database was changed.
Integration tests use a freshly created, isolated local replica set and synthetic
records; browser tests use synthetic sensors and stubbed map tiles.

## Flow and privacy boundaries

1. An administrator enables tracking for an existing BusRoute and authorizes
   a device for that bus with an expiry of at most 30 days. Device labels should
   identify equipment, not people. Authorization generates a 256-bit credential,
   returned only once; MongoDB stores its SHA-256 hash. Transfer it securely.
2. The device exchanges its ID/secret for a driver-role session valid for at most
   15 minutes, bounded by its grant expiry. Driver sessions have no faculty,
   shop-owner, analytics or shared CRUD permissions. Revocation increments the
   grant version and blocks old sessions, renewals and uploads. Reassignment
   uses a newly authorized device and revocation of the previous grant.
3. A consented start creates a BusTrip for the assigned bus/device. Partial
   unique indexes allow one active trip per bus and per device. The maximum trip
   duration is four hours, bounded by the grant expiry. A 90-second fix lease
   begins at start and renews only on an accepted GPS fix. Session renewal does
   not renew this lease. End abandoned/expired trips before dispatching again.
4. Express checks the current grant, trip ownership, bus opt-in, trip deadline,
   fix lease and GPS data. A MongoDB transaction writes the current fix on the
   trip and a BusLocation history entry together. The transaction also writes
   the grant, serializing ingestion against concurrent revocation. Unacknowledged
   storage failures roll back; devices must not infer that a rejected point was
   accepted. Device fixes are reports, not proof of a vehicle's physical identity.
5. Students poll the authorized bus feed every **12 seconds** while the page is
   visible. Only bus/route/stop metadata and the latest authorized fix are
   returned. Driver identity, contact, device ID, secret and location history
   are absent from this feed. Existing route browsing retains its prior fields.
   There is no individual/user-location lookup endpoint or history HTTP endpoint.
6. Ending a trip clears its embedded latest coordinates and removes it from the
   feed. Revoked/expired devices, disabled/deleted buses and expired trips are
   excluded. A missed fix becomes stale after 30 seconds; an expired 90-second
   lease becomes offline and returns **no coordinates**. Uploads cannot resume
   an expired lease: end it and obtain fresh trip consent. Previously downloaded
   data cannot be recalled; an open student page learns of explicit end/revoke
   on its next poll, or clears points sooner when its authorization deadline
   expires. Network failures clear unconfirmed markers.

Location records and embedded latest coordinates have a **24-hour TTL deadline**
after their server receipt time. Ending clears embedded coordinates immediately;
trip metadata has a deadline 24 hours after its end, or 24 hours after the maximum
trip deadline when no GPS ever arrived. MongoDB TTL removal is asynchronous,
not an exact deletion-time guarantee. Monitor TTL/index health, backup retention,
and administrator database access under the campus's own privacy policy.
Public access checks do not rely on TTL cleanup having completed.

Consent is an explicit operator attestation, not permission to track arbitrary
people. Provision only equipment attached to authorized buses. There is no
remote browser “turn on GPS” action: even an admin-dispatched trip cannot start
the browser's GPS without the operator's local consent. A browser finding an
existing trip requires it to be ended before starting its own sharing session.

## GPS acceptance policy

- Strict numeric latitude −90…90, longitude −180…180 and accuracy 0…200 metres.
  Weak accuracy above 100 m is shown to students; the browser suppresses fixes
  worse than 200 m. An accuracy circle represents reported uncertainty.
- `recordedAt` must be from the current trip, at most 30 seconds old and at most
  five seconds ahead of server time. Keep device/server clocks synchronized.
  `receivedAt` and retention deadlines are assigned by Express.
- Accepted timestamps must increase strictly. At least five seconds must pass
  between server receipts for the same trip; the browser sends at most once per
  12 seconds. Replays and overly frequent fixes are rejected.
- After subtracting both fixes' reported accuracy radii, a jump requiring more
  than 160 km/h is rejected. This is a gross sensor-error filter, not proof of
  actual speed, route adherence or attendance. No unverified campus geofence is
  invented. The initial fix is checked for bounds/freshness/authorization.
- Strict Zod bodies reject mass assignment, MongoDB operators, caller-supplied
  receipt times, other user/device IDs and simulation flags. Database IDs and
  pagination are validated. Limits: pages 1–100, page size 1–50 (default 20).

All tracking queries are bounded with database time limits. Live pagination can
have empty pages when a candidate trip loses authorization during evaluation;
the page controls remain available. GPS history is never loaded by the public
feed, ordinary campus search or the AI context service.

## Setup and operations

Use the repository's existing Node **22+** and npm **10+** setup:

```sh
cd server
npm ci
cd ../client
npm ci
```

Tracking needs a transaction-capable **MongoDB replica set or sharded cluster**.
Ordinary standalone MongoDB remains supported for route browsing with tracking
off. Before enabling tracking, review your own connection, TLS, access controls,
retention and index plan. This work did not provision indexes in an existing DB.

```sh
cd server
# Explicit operator action against the database configured by the operator:
npm run tracking:indexes -- --confirm-indexes
```

That command uses additive `createIndexes`; it never drops indexes or rewrites
bus/route/location records. It creates the new collections/indexes if absent.
It requires explicit confirmation because it operates on the configured target.
Review conflicts/duplicates separately; do not use `syncIndexes` or data resets
as a workaround. Required indexes cover one active trip per bus/device, active
trip pages, grant lookup, trip history ordering, and TTL deadlines.

Set `BUS_TRACKING_ENABLED=true` in the server's own environment and restart.
Production requires HTTPS browser origins; deploy the API behind HTTPS as well.
Startup checks transaction-capable topology and the active-trip/retention indexes
before listening. Missing readiness prerequisites fail startup. JWT/admin/origin
configuration remains required by the existing production configuration checks.

In **Admin → Bus tracking**, enable a real route, provision its device and
securely transfer the one-time device ID/secret. Device lists cannot recover the
secret. Revoke lost credentials and provision a replacement. Administrators can
list and end abandoned or expired trip records without viewing GPS history.

Production must supply TLS, protected provisioning, least-privilege MongoDB
access, privacy/backup retention, monitored clocks, and a reviewed reverse-proxy
configuration. The app does not automatically trust forwarded IP headers.
Session exchange/renewal has a 60-request/15-minute per-IP limit; uploads have a
1200-request/15-minute per-IP limit plus the persisted per-trip frequency rule.
These existing in-memory Express limiters are per process. Size them for shared
NAT/fleet traffic and use a shared limiter store for multiple instances.
The existing Helmet, restricted CORS, JSON size limit and sanitized errors apply.
Malformed attempts count toward the tracking rate limits before body parsing.
Audit records cover provisioning, revocation, trip start/end and route opt-in;
they contain actor/action/field names, never credentials or GPS values.

## Driver browser limitations

Open `/driver` on HTTPS (or localhost for development). Device credentials and
session tokens remain in memory, not local storage, URLs or frontend `.env`
values. Authorization does not request GPS. While safely parked, check the
consent box and explicitly choose **Start trip and share GPS**. Stop clears the
geolocation watch, timers, in-flight requests and pending fixes before attempting
the server end request. A generation check rejects queued sensor callbacks after
Stop, including callbacks from an older sharing session.

The page stops local sharing on permission denial, backgrounding, page exit,
browser-reported offline state, server/network upload failure, and local lease
or trip expiry. It never automatically resumes or buffers an offline history.
It handles weak GPS separately and requests fresh fixes with `maximumAge:0`.
Failed end requests retain a retry action; no further fixes are sent, and the
server lease bounds public visibility. `pagehide`/keepalive end delivery is best
effort: operating systems can terminate browsers without running cleanup.

**Do not rely on browser geolocation in the background.** Mobile browsers may
suspend timers, permission callbacks, network activity or the entire page when
the screen locks or another app opens. Keeping the foreground page awake is a
development/operational fallback, not a reliable background tracking solution.
High-accuracy GPS and networking consume battery; mount and power the device and
do not operate the interface while driving. A dedicated GPS device or native
app should implement secure credential storage, explicit background-location
permission/indication, start/stop controls, foreground/background service rules,
fresh timestamped fixes, clock synchronization, TLS, connectivity handling and
lease/session renewal. It must use the same trip authorization checks and must
discard old fixes rather than replay private travel after reconnection.

## ETA and simulation

Existing stops contain names and schedule strings, not verified route geometry
or stop coordinates. The UI therefore says **Estimated arrival: unavailable**.
It does not turn scheduled times, straight-line distance or unverified GPS into
an arrival promise. A future ETA provider must validate route geometry, stop
positions, direction/progress, recent accurate samples and its arrival model
before publishing estimates. No ETA provider or route coordinates were invented.

For the Vite **development server only**, set
`VITE_BUS_TRACKING_SIMULATION=true` and restart Vite. The Buses page offers
**Development simulation**. It uses an explicitly labelled local fixture near
(0,0), unrelated to campus, with no uploads and no substitution into the real
feed. Leave it disabled normally. Vite's production `DEV=false` gate removes the
fixture path even if the simulation environment value is true. A separate Vite
command gate restricts it to the actual development server, excluding preview
and build commands even if `NODE_ENV=development` was inherited. The server has
no simulation endpoint, seed, fallback or accepted simulation field.

## REST API

All endpoints are under `/api/bus-tracking`. No state-changing GET endpoints exist.

| Endpoint | Authorization / purpose |
| --- | --- |
| `GET /status` | Public feature status and polling interval; works when disabled. |
| `GET /live?busId=&page=&limit=` | Public, bounded authorized bus feed; no history/driver identity. |
| `POST /devices` | Admin; `{busId,label,expiresAt}` → one-time credential. |
| `GET /devices?page=&limit=` | Admin; paginated nonsecret device summaries. |
| `PUT /devices/:id` | Admin; `{enabled:false}` revokes the grant. |
| `POST /devices/session` | `{deviceId,secret}` exchanges provisioned credentials for a short driver token. |
| `POST /devices/session/refresh` | Valid active driver token and `{}`; renews the session, not the GPS lease. |
| `GET /trips/current` | Driver; own active trip metadata only, including abandoned leases. |
| `GET /trips?page=&limit=&busId=` | Admin; dispatched/abandoned trip metadata, no coordinates. |
| `POST /trips` | Driver `{consent:true}` for its grant; admin additionally supplies `deviceId` and attests consent. |
| `POST /trips/:id/locations` | Owning driver token; `{latitude,longitude,accuracy,recordedAt}` only. Admin tokens cannot impersonate a GPS device. |
| `POST /trips/:id/end` | Owning driver or admin, `{}`; idempotently ends the trip and clears latest coordinates. |

Transport-independent rules are in
[busTracking.js](../server/src/services/busTracking.js); Express wiring is in
[routes/busTracking.js](../server/src/routes/busTracking.js). An optional
`onChange({busId,tripId})` callback runs after committed fixes/end operations.
This is a future WebSocket integration point, not a broadcast of coordinates.
Any future socket service must re-evaluate the public authorization projection,
process grant/route revocation and end events, apply access/rate limits, and
remove expired subscriptions. REST polling is the only current live transport.

## Changed files and validation

Models: existing [BusRoute.js](../server/src/models/BusRoute.js), new
[BusDevice.js](../server/src/models/BusDevice.js),
[BusTrip.js](../server/src/models/BusTrip.js),
[BusLocation.js](../server/src/models/BusLocation.js).
Backend also extends `src/server.js`, `config/security.js`, `middleware/auth.js`,
`models/AuditLog.js`, `routes/auth.js`, `services/publicData.js`, shared validation,
and adds `validation/busTracking.js`. Existing admin/faculty/owner permissions
remain enforced; the generic Admin screen explicitly excludes driver sessions.

Frontend: existing `vite.config.js`, `pages/Buses.jsx`, `pages/Admin.jsx`, `App.jsx`, `App.css` and
`api/client.js`; new `pages/DriverTracking.jsx`, `components/LiveBusTracking.jsx`,
`BusTrackingMap.jsx`, `BusTrackingAdmin.jsx`, `lib/trackingConfig.js` and
`lib/busSimulation.js`. New scripts/tests and safe env example flags are documented
above. Previous repository work was preserved; no production seeds were run.

Tests/setup files: `server/test/bus-tracking.test.js`,
`server/integration-tests/bus-tracking.mongo.cjs`,
`server/scripts/tracking-indexes.js`, `server/scripts/run-tracking-mongo-test.ps1`,
the query/session support in `server/test-support/memoryModels.js`,
`client/component-tests/bus-tracking.test.jsx`, `client/component-tests/bus-map.test.jsx`,
`client/test/api.test.js`, `client/browser-tests/bus-smoke.cjs` and
`client/browser-tests/check-tracking-build.cjs`. Both package manifests add only
scripts; both env examples add nonsecret feature flags.

Commands:

```sh
cd server
npm run check
npm test
# Windows with mongod installed: fresh temporary loopback-only replica set,
# automatically stopped/removed; never uses an existing MongoDB data directory.
npm run test:tracking:local
# Alternatively set your own TRACKING_TEST_MONGODB_URI for an isolated
# loopback _local/_test replica set, then:
npm run test:tracking:mongo
cd ../client
npm test
npm run build
npm run test:tracking-build
npm run test:browser
npm run test:bus-browser
```

The opt-in Mongo test refuses remote/production targets. It creates uniquely
identified synthetic records and cleans up only those records. The Windows
runner allocates a new temporary directory/port, starts its own hidden loopback
`mongod`, and validates the exact generated path before cleanup. It never stops
another MongoDB process. Node 22 is required. No secret configuration is printed.

Final verification used Node 22.23.4 through the temporary npm Node runtime;
the machine default is Node 20. No runtime or test dependency was added.

```text
server npm run check: 46 files syntax checked; seeds parsed, never executed
server npm test: 65 passed, 0 failed
client API tests: 10 passed, 0 failed
client components: 8 suites, 48 passed, 0 failed
client npm run build: PASS (simulation flag also explicitly tested true)
client npm run test:tracking-build: PASS — production fixture excluded
client npm run test:bus-browser: PASS — mobile Leaflet, stale/offline,
  ETA unavailable, driver consent, GPS and Stop; no errors/overflow
client npm run test:browser: PASS — prior campus/faculty/dashboard/shop flows
server npm run test:tracking:local: PASS — real replica-set transactions,
  concurrency/uniqueness, deliberate failure rollback, retention deadlines,
  current/history persistence and end-trip privacy
git diff --check: PASS
```

Full output: [server tests](artifacts/bus-server-tests.txt),
[client tests](artifacts/bus-client-tests.txt),
[production build](artifacts/bus-client-build.txt),
[production fixture gate](artifacts/bus-production-gate.txt),
[development-environment build exclusion](artifacts/bus-development-fixture-gate.txt),
[bus browser](artifacts/bus-browser-tests.txt),
[existing browser workflows](artifacts/bus-existing-browser-tests.txt),
[actual MongoDB integration](artifacts/bus-mongo-tests.txt).
The Mongo integration output contains an expected generic HTTP 500 diagnostic
from its deliberate history-storage failure; the test verifies rollback.
The [mobile screenshot](artifacts/bus-tracking-mobile.png) uses clearly synthetic
route/sensor fixtures and blank stubbed tiles, not live campus tracking.
The browser test also enters/exits the actual development simulation and verifies
that it does not add location history. Production and inherited-development
builds were both checked with the simulation flag true; neither includes the
fixture, and the final `dist` output was restored to a production build.

The first new browser run found a Strict Mode initialization bug that left the
Leaflet view unset on its second mount. Resetting the view signature fixed it;
the component test now runs real Leaflet under Strict Mode. A later browser
fixture needed a fresh sensor timestamp after consent; the production API
correctly rejected its pre-trip fix. One early complete server run had a transient
local HTTP fetch failure in an existing limiter test; that suite passed alone
and the final complete suite passed. These failures are resolved in the final
output. The temporary Mongo runner was also adjusted to use npm's verified Node
binary path on Windows.

No actual campus buses, GPS hardware, route coordinates, background native app,
arrival model, production throughput, physical 24-hour TTL deletion or production
deployment were verified. The tests establish the implemented authorization,
transaction, deadline and foreground-browser workflows. A production fleet needs
an operations rehearsal with its own equipment, TLS, shared limiter settings,
clock accuracy, monitoring and approved retention/backup policy. Existing
dependency-audit findings from earlier setup work are unchanged; no dependency
upgrade or production rollout was included.
