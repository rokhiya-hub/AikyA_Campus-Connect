# Campus information improvements

Date: 2026-10-29. This work extends the existing React 18/Vite/Leaflet and
Express/Mongoose modules. It does not replace the application, run seed scripts,
connect to a live database, or apply a migration to existing records.

## Faculty availability

`server/src/services/facultyAvailability.js` is the shared calculation/validation
implementation used by the Faculty model and API responses. It calculates each
weekday independently; busy periods from different days are never combined.
Adjacent periods are allowed, overlapping periods are rejected, and all
positive-length gaps are returned, including gaps shorter than one hour.

Validation runs on both API writes and Mongoose document validation:

- Strict 24-hour `HH:MM`, positive slot lengths and recognized weekdays.
- No overlapping teaching periods within a day.
- No invalid or overlapping teaching windows.
- Each period must fit entirely inside one of that day's windows. A period
  cannot cross a break between split windows.
- Leave is a Boolean; leave suppresses all derived free periods.

The existing application's 09:00-17:00 Monday-Saturday window is retained as
an **application default**, not presented as an officially confirmed campus
schedule. Sunday has no default teaching window. Admins may provide
`teachingWindows` per weekday, including split windows and Sunday windows.
An explicit empty window list means no teaching window for that day.

A missing weekday in a legacy timetable remains **unknown**, not free all day.
An explicitly supplied empty day has no busy periods within its configured
teaching windows. The existing full-week timetable PUT remains a replacement
operation: omitted days in that full-week submission become explicit empty days.
Invalid legacy periods yield an invalid/needs-review summary instead of an
invented free period. No legacy data was automatically corrected or deleted.

API faculty lists/details add an `availability` object:

```text
availability.timeZone              Asia/Kolkata
availability.calculatedAt          Actual server calculation time (ISO)
availability.sourceUpdatedAt       Actual timetable/window/leave change time, or null
availability.presence              not_tracked
availability.teachingWindowSource  application_default or configured
availability.day                   Current campus weekday
availability.currentStatus         free_in_timetable / teaching / outside_teaching_window /
                                   on_leave / non_teaching / unknown / invalid
availability.byDay[weekday]        status, freePeriods [{start,end}], freeTime [display labels]
```

`sourceUpdatedAt` is not manufactured for old records. Unchanged timetable
submissions and unrelated profile edits do not advance it. `calculatedAt` is
not a physical-presence observation. Existing `freeTime` day keys in the private
timetable response remain; compatibility `availableSlots` labels now carry
weekday prefixes instead of merging days. The legacy stored field remains in
the schema but is not used as proof of current availability.

Public summaries exclude subject/room schedules and faculty login credentials.
Raw timetables and teaching-window editing retain the existing owner/admin
permissions. Faculty can edit their own teaching periods and leave status;
teaching-window policy remains admin-managed. AI context and result cards
explicitly distinguish timetable gaps from physical presence.

## Faculty search and dashboard

The faculty directory searches name, department, cabin, block and designation,
including multiple words across those fields. The API uses the same bounded,
escaped-word search across permitted fields and preserves array pagination.
The directory has a weekday selector, timetable-gap/leave filters, timestamps,
unknown/invalid states and location-verification labels.

`useUniverse` now has a shared subscribed cache, coalesced in-flight reads,
per-collection loading/error states, last-success times, retry, and a visible-page
refresh interval. A failed initial request is not cached as an empty collection.
A failed refresh preserves the last good records and exposes its error. Refresh
updates all mounted consumers. Successful mutations invalidate public collections;
a mutation during an older fetch schedules a subsequent fresh read.

Dashboard distinguishes loading, genuine empty, partial error and retry states.
Unavailable counts show an unknown marker rather than a fabricated zero.
Faculty counts use fresh timetable summaries rather than `onLeave === false`
as a presence signal. Campus dates use Asia/Kolkata; past events are excluded
from the upcoming section. Stored outlet/transport flags are labelled as stored
status rather than live telemetry. Department and map pages also expose retry.

## Building IDs and careful migration

Departments, faculty and contained POIs accept an optional `buildingId` reference
to an existing `PointOfInterest` whose type is `block`. A building POI's own `_id`
is its canonical identity; building POIs cannot contain another `buildingId`.
Owner/self-service writes cannot change these privileged links.

New references are validated. A submitted block label plus building ID must
match the selected building's name/block label. Referenced buildings cannot be
deleted or changed into another POI type. Renaming a building retains its ID and
associations; the frontend resolves its current name by ID. Legacy text fields
remain intact for compatibility.

Map associations use a stable ID first. For records not yet migrated, only a
unique exact normalized name/block match is allowed as a provisional fallback.
Prefix/substring/description matching has been removed. An unresolved or
ambiguous label is not guessed. Faculty/department navigation opens the selected
building with `/map?poi=<id>`.

The new migration command is **dry-run by default** and reuses the existing
local/test safeguards. It refuses production, non-loopback/SRV targets, and
database names without `_local` or `_test`. No migration command ran here.

From `server/`, with your own isolated local/test MongoDB configuration and
Node 22 selected, inspect the proposal:

```powershell
npm run migrate:buildings -- --confirm-local
```

To save an exact plan in Windows PowerShell without npm's command banner:

```powershell
node scripts/migrate-building-links.js --confirm-local | Set-Content -Encoding utf8 building-links.plan.json
```

Review the generated JSON before applying it to the isolated local/test copy:

```powershell
npm run migrate:buildings -- --confirm-local --apply --confirm-building-links --plan=building-links.plan.json
```

Apply uses the reviewed record/target IDs, skips existing links, stale source
labels, missing records and invalid targets, and uses a conditional update to
avoid overwriting concurrent source changes. It is idempotent and audited.
It only adds building references; it does not rewrite names, coordinates,
allocations or verification claims. Do not run concurrent campus edits during
application; this is not a cross-collection transaction or database foreign-key
constraint. Production migration/duplicate reconciliation needs a separate
reviewed data-owner procedure. Plan files contain record IDs and should remain
local review artifacts.

## Floors, map behavior and verification

The existing Leaflet UI, categories, marker styling, tile providers, theme
switching, zoom, search, geolocation, favourites and fullscreen controls remain.

- Removed manufactured room-marker offsets. The Rooms control now opens a
  building/floor/cabin/lab directory, explicitly labelled as a list, not an
  accurate floor plan. Only recorded floors are shown, including floors above
  the third; absent floor/room data is labelled unknown.
- Marker construction and external Maps links reject nonfinite/out-of-range
  coordinates. Search can still show recorded details for an unlocated place.
  Search also resolves recorded faculty/cabin/lab matches to their building.
- Permission denial, location unavailable, timeout, unsupported/insecure browser,
  invalid/stale results and synchronous browser failures produce visible retryable
  messages. Accuracy and measurement time are shown; low precision is called out.
- Tile failures have a retry control. Fullscreen targets the entire map shell,
  keeps its controls, handles denial, and invalidates Leaflet sizing. ResizeObserver
  handling and cleanup remain in place.
- Directions retain a labelled straight-line reference and external walking
  directions link. Invented gate-exit/stair/lift instructions and unverified
  walking ETAs were removed. Accessibility information explicitly says verified
  ramp/lift/step-free routing is unavailable.
- Narrow-screen CSS keeps controls, horizontal filters, notices and detail
  panels within the map viewport while retaining the existing design tokens.

POIs add `coordinateVerification`; faculty/departments add
`locationVerification`; allocations add a nested `verification` record. Each
defaults to unverified. A verified claim requires an explicit official source
reference and a nonfuture ISO verification date, entered by an admin. Old
`allocation.status` text such as “Verified” is retained as legacy content and
is **not** treated as official verification. The image-layout view also labels
fallback allocations unverified. Existing prototype coordinates, gate, road and
boundary overlays are explicitly labelled unverified; no official campus data
or surveyed coordinates were invented.

Admin forms expose stable building IDs, recorded coordinates, source/date
verification fields, and JSON teaching windows/timetables. Malformed JSON stays
in the form with a clear error; schema validation still runs on the server.

## Tests and browser evidence

The component suite uses Jest, React Testing Library and jsdom, with **real
Leaflet DOM layers** for marker, selection, search, floor-list, theme, tile-error
and fullscreen/location tests. The application remains on React 18 and Vite 5;
test transformation is configured separately in `client/jest.config.cjs`.

API/model tests cover independent weekdays, short gaps, leave, strict times,
overlaps, window breaks/bounds, unknown days, timestamps, unchanged submissions,
search fields, raw-timetable privacy, owner/admin guards, reference validation,
orphan protection, verification requirements, and migration planning/application.
Persistence doubles retain the real Mongoose documents and validation; they do
not establish real MongoDB driver/index/transaction behavior.

`npm run test:browser` launches a fresh headless Edge session by default
(`AIKYA_TEST_BROWSER_CHANNEL` can select another installed Chromium channel).
It starts an ephemeral Vite instance and API with synthetic in-memory records,
stubs tile/font requests, and closes both servers and browser afterwards. It
checks actual marker/floor selection, light/dark tiles, a 390×844 viewport,
search/directions, emulated GPS accuracy, stable-ID navigation and dashboard
outage/retry. No real geolocation, database, production credentials or AI calls
are used. It does not prove real tile-network availability or surveyed routing.

Screenshots from that synthetic fixture run:

- [Desktop map](artifacts/campus-map-desktop.png)
- [Mobile directions](artifacts/campus-map-mobile.png)

Final verification used the temporary Node 22.23.4 runtime as documented in
[LOCAL_SETUP_REPORT.md](LOCAL_SETUP_REPORT.md). All app dependencies keep their
existing major versions; added test tooling is development-only.

| Command/check | Result |
| --- | --- |
| Client `npm ci --no-audit --no-fund` | Passed; 646 installed packages from the final lockfile |
| Server `npm run check` | Passed; 32 files parsed without executing seeds |
| Server `npm test` | Passed; 34 tests, 0 failures |
| Client `npm test` | Passed; 7 client unit tests plus 24 React component tests in 5 suites |
| Client `npm run build` | Passed; 2,306 modules transformed; Vite 5.4.21 |
| Client `npm run test:browser` | Passed; headless Edge desktop and 390×844 viewport, no page errors/horizontal overflow |
| Server `npm audit` | Passed; 0 vulnerabilities |
| Client `npm audit` | Exit 1; 9 affected packages: 5 low, 3 moderate, 1 high |
| `git diff --check` | Passed |

Selected final output:

```text
Syntax checked 32 server files (seed files parsed, never executed).
# tests 34
# pass 34
# fail 0
found 0 vulnerabilities

# tests 7
# pass 7
# fail 0
Test Suites: 5 passed, 5 total
Tests:       24 passed, 24 total
✓ 2306 modules transformed.
✓ built in 9.46s

Browser smoke PASS: real Leaflet marker/floor selection, theme tiles,
mobile search/directions, GPS accuracy, stable-ID navigation, dashboard
outage/retry; no page errors or horizontal overflow.
```

The browser line above is wrapped for readability. Its GPS result is an
emulated browser reading, not a real campus GPS measurement. Early component
harness checks caught a JSX-transform configuration mismatch; it was corrected
before all final component suites passed. A final API check also verifies
teaching-window Maps are serialized as weekday JSON objects.

Main files changed for this follow-up:

| Area | Files |
| --- | --- |
| Availability and search | `server/src/services/facultyAvailability.js`, `models/Faculty.js`, `routes/faculty.js`, `validation/index.js`, `services/collectionService.js`, `services/publicData.js`, `services/campusDataService.js`, `services/aiService.js` |
| Building identity/verification | `server/src/models/Department.js`, `models/PointOfInterest.js`, `models/verification.js`, `services/buildingLinks.js`, `routes/makeCrudRouter.js`, `server.js`, `config/db.js`, `scripts/migrate-building-links.js`, `server/package.json` |
| Shared frontend state/helpers | `client/src/lib/useUniverse.js`, `lib/campusInfo.js`, `lib/useGeolocation.js`, `api/client.js`, `components/DataStatus.jsx` |
| Existing pages and map UI | `client/src/pages/Faculty.jsx`, `Departments.jsx`, `Dashboard.jsx`, `CampusMap.jsx`, `components/CampusMap.jsx`, `DirectionsPanel.jsx`, `AdityaUniversityMap.jsx`, `FacultyPortal.jsx`, `GlobalSearch.jsx`, `resultCards.jsx`, `AdminCrud.jsx`, `admin/entityConfig.js`, `App.css` |
| Test tooling/fixtures | `client/package.json`, `package-lock.json`, `jest.config.cjs`, `component-tests/*`, `browser-tests/campus-smoke.cjs`, `server/test/campus-info.test.js`, `test-support/memoryModels.js` |
| Documentation/evidence | `README.md`, this report, status notes in existing audit/setup reports, and the two synthetic screenshots |

## Remaining limits

Campus coordinates, allocations, teaching-window policy and accessibility paths
still need authoritative confirmation. Legacy unknown/invalid schedules and
ambiguous building labels need owner review. No physical-presence tracking or
indoor routing service was introduced. Real MongoDB integration and real mobile
GPS/network behavior remain deployment checks.

The pre-existing Vite/esbuild and React Router advisories remain. Added Jest
tooling also has a low-severity `deepmerge` advisory propagated through Jest's
configuration packages; the runner reads trusted local test configuration and
is not served by the application. No forced Vite/Router upgrade or production
dependency migration was hidden inside this module work. See the final audit
output below for counts.
