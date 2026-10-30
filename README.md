# AIKYA — One Campus. Everything Connected.

AIKYA is a campus information application with a React frontend, an Express API,
MongoDB persistence, Leaflet maps, and an OpenAI-compatible campus assistant.
It includes an existing prototype dataset; campus facts and contacts need owner
verification before operational use.

Faculty availability is calculated separately for each weekday and displays
calculation/source timestamps. Timetable gaps do not confirm physical presence.
Maps use recorded building IDs where available, mark unverified coordinates and
allocations, and show room lists without invented indoor coordinates or routes.
See [campus module changes and tests](docs/CAMPUS_MODULES_REPORT.md) for details
and the optional local/test building-link migration procedure.

## Requirements

- **Node.js 22 or newer and npm 10 or newer.** The locked OpenAI SDK requires
  Node >=22.0.0. `.nvmrc` selects Node 22 for version managers that support it.
- Git and access to your own MongoDB instance or MongoDB Atlas database.
- Optional: credentials and a model ID from an OpenAI-compatible AI provider.

```sh
node --version
npm --version
git clone https://github.com/rokhiya-hub/AikyA_Campus-Connect.git
cd AikyA_Campus-Connect
```

Run commands from the directory containing `client/` and `server/`. There is no
root npm workspace or root package.json.

## Install and configure

```sh
cd client
npm ci
cd ../server
npm ci
cd ..
```

Copy the examples without overwriting existing `.env` files. In PowerShell,
on a fresh checkout:

```powershell
Copy-Item client/.env.example client/.env
Copy-Item server/.env.example server/.env
```

On macOS/Linux use `cp -n client/.env.example client/.env` and
`cp -n server/.env.example server/.env`.

Set these values in `server/.env` using your own configuration:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Required MongoDB URI. The API starts listening only after connecting. |
| `PORT` | API port; defaults to `5000`. |
| `NODE_ENV` | Set explicitly to `production` when deploying. Production startup validates security configuration before connecting to MongoDB. |
| `CLIENT_ORIGIN` | Exact comma-separated permitted HTTP(S) browser origins. Development permits `http://localhost:5173` and `http://127.0.0.1:5173`; production requires an explicit list. Wildcards are rejected. |
| `JWT_SECRET` | Required for authentication; production requires at least 32 bytes. No built-in signing secret is used. |
| `JWT_EXPIRES_IN` | Token duration; defaults to `7d`. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Your administrator login. Production requires both, with a password of 12-72 bytes. Missing values disable admin login only in development. |
| `AI_API_KEY` | Optional provider key; keep it on the server. External AI requires all three AI settings. |
| `AI_BASE_URL` | Explicit OpenAI-compatible HTTPS base URL. No provider default; development/test permits loopback HTTP. |
| `AI_MODEL` | Explicit model ID available to your provider account. No fallback model. |
| `AI_TIMEOUT_MS` | Provider deadline: default 8000 ms, permitted 1000–15000 ms. |
| `AI_MAX_TOKENS` | Provider output limit: default 256, permitted 64–512. |

You can generate a JWT secret locally with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

The example files contain no credentials. Only `AI_BASE_URL`, `AI_API_KEY` and
`AI_MODEL` configure the existing provider; obtain their actual values from your
provider. Chat answers locally from bounded campus records by default. External
AI requires explicit consent for each question and selects existing public facts;
it cannot supply arbitrary answer text. Faculty/hostel personal questions stay
local. Missing configuration or provider failures preserve local record answers.
See [AI privacy, setup and verification](docs/AI_SERVICE_REPORT.md), including
the optional metadata-only telemetry index setup and legacy log limitations.

In `client/.env`, `VITE_API_URL` defaults to `/api`. During development Vite proxies
it to `http://127.0.0.1:5000`, so both local browser hostnames work. The backend
must still be running with a valid database connection. If using a different API
port or separate production hosting, set the actual API URL ending in `/api` and
allow the frontend's exact origin in `CLIENT_ORIGIN`. For same-origin production
hosting, configure your web server to forward `/api` to Express; Vite's development
proxy is not included in the build. Vite exposes `VITE_*` values to the browser:
never put secrets there. Restart Vite after environment changes and rebuild for deployment.
The backend loads `.env` relative to its working directory, so start it from
`server/`.

## Run locally

Terminal 1:

```sh
cd server
npm run dev
```

Terminal 2:

```sh
cd client
npm run dev
```

Open the URL Vite prints (normally `http://localhost:5173`). If Vite selects a
different port, update `CLIENT_ORIGIN` to match. The API health route is
`http://localhost:5000/api/health`; it reports process health, not ongoing
database/provider readiness. `npm start` starts the backend without nodemon.

## Pages and architecture

```text
AikyA/
├── client/
│   ├── src/pages/       # Dashboard, landing, map, directories, admin
│   ├── src/components/  # Leaflet/layout maps, AI chat, search, CRUD, faculty portal
│   ├── src/context/     # Auth, theme and toast providers
│   └── src/lib/         # Collection cache, favorites and map utilities
├── server/
│   ├── src/config/      # MongoDB connection using system DNS
│   ├── src/routes/      # CRUD, faculty self-service, auth, chat and analytics
│   ├── src/models/      # Department, Faculty, PointOfInterest, BusRoute, Event, QueryLog
│   ├── src/services/    # Campus retrieval and OpenAI-compatible completion service
│   └── src/seed/        # Destructive prototype seeder and static master tables
└── docs/                # Audit, setup results and existing allocation document
```

The frontend uses React 18, Vite 5, React Router 6, Framer Motion, Lucide,
Leaflet, and custom CSS in `client/src/App.css`. Tailwind is not installed.
The server uses CommonJS, Express 4, Mongoose 8, bcrypt, JWTs, and the OpenAI SDK.

| URL | Page |
| --- | --- |
| `/` | Dashboard |
| `/home` | Landing page |
| `/map` | Leaflet map and image-based campus layout |
| `/faculty`, `/departments` | Academic directories |
| `/canteen`, `/hostels`, `/buses`, `/events` | Campus information |
| `/admin` | Admin sign-in/CRUD or faculty self-service portal, based on role |

Public API reads are under `/api/departments`, `/api/faculty`, `/api/poi`,
`/api/buses`, and `/api/events`. Writes require an admin Bearer token.
Faculty may update allowed profile fields and their own timetable.
Authentication uses `/api/auth/login` and `/api/auth/me`.
`POST /api/chat` retrieves bounded public campus data, calls the AI service, and
logs the question/answer. `/api/chat/analytics` requires admin authentication.
Detailed faculty timetables require the faculty owner or an admin. Collection
reads return arrays with pagination headers; the frontend follows pages
automatically. Private admin fields require an explicit authenticated
`view=private` request, so public collection caches contain no private data.

Helmet, exact-origin CORS, a 64 KiB JSON limit, strict Zod validation, and safe
JSON error handling protect the API. Login allows 20 attempts per 15 minutes
per IP; chat allows 30. Rate-limit storage is per process and proxy trust is
disabled. Privileged mutations use permitted fields and persistent audit
records excluding passwords/tokens. See [security changes](docs/SECURITY_HARDENING.md)
for the complete route policy, deployment limits and verification results.

## Data and current limitations

Normal setup does **not** require seeding. Use your configured database and
existing admin forms. The seed command now rejects production and remote
targets. It requires explicit `NODE_ENV=development` or `test`, a loopback
MongoDB URI naming a database ending in `_local` or `_test`, and `--confirm-local`.
Run only from `server/` with your own isolated database configuration:

```sh
npm run seed -- --confirm-local
```

The default uses insert-only upserts with stable identities. Rerunning it
preserves existing data, passwords and admin edits. Seeded faculty have no
shared/default password; an admin can provision an individual password.
**Destructive local reset additionally requires both** `--reset` and the exact
flag `--confirm-reset=DELETE_LOCAL_SEED_DATA`. Reset still refuses production,
remote databases, and database names without the local/test suffix. No seed
command is part of normal installation or automated tests.

Hostels and shops are PointOfInterest records. There are no separate building,
floor, classroom, individual hostel-room, or warden models. The admin form does
not expose every schema field (including menu-item editing and POI coordinates).
Private hostel contact/occupancy details are omitted from public pages and AI
context; authorized admins retain them in management views. Status flags are
stored values rather than live telemetry. Map routes are
straight-line estimates with generic steps, not verified walking/accessibility
routes. AI escalation records a flag; it does not notify a department.
See [the code audit](docs/CODE_AUDIT.md) for confirmed gaps and recommendations.

## Build and checks

```sh
cd client
npm ci
npm test
npm run build
npm run preview
```

The build output is `client/dist/`. Preview is a local static-build check, not
a production server. Configure your deployment host to serve `index.html` for
SPA routes and set the production API URL before building. Deploy the Express
server separately with your environment and database configuration.

`npm test` runs the existing API-client checks plus React component tests.
`npm run test:browser` performs a separate database-free headless browser smoke
check with synthetic records; it defaults to an installed Microsoft Edge browser.
It produces the labelled test screenshots in `docs/artifacts/`. This check does
not use your configured database or an AI provider.

```sh
cd server
npm ci
npm run check
npm test
```

`check` parses backend source and seed files without running them. Tests use a
local ephemeral HTTP listener, synthetic records and an ephemeral signing key;
they do not connect to MongoDB or call the AI provider. The server has no
compilation step. `npm audit` in each directory checks dependency advisories;
some frontend fixes currently require separately reviewed major migrations.

See [the local setup report](docs/LOCAL_SETUP_REPORT.md) for actual output,
environment restrictions, and checks that could not be performed.

## Shops and canteen

Food & Shops supports paginated product/service searches, category/area filters,
reported stock and price timestamps, Kolkata opening schedules and moderated
student/guest feedback. Existing demo listings remain labelled unverified.
Owners request an account from Admin and must be approved and assigned a shop
before using the Shop owner sign-in. Admins manage approvals, assignments,
verification and reports from **Shops & owners**.

See [the shops report](docs/SHOPS_REPORT.md) for permissions, API details,
freshness policies, safe local migration commands, changed files and test output.
The migration is dry-run by default and refuses production databases.

## Optional live bus tracking

Route browsing works with tracking disabled. To enable authorized bus trips,
review [BUS_TRACKING.md](docs/BUS_TRACKING.md): MongoDB transactions/indexes,
device provisioning, driver consent, privacy/retention, 12-second polling,
development-only simulation and production GPS-device/native-app requirements.
Tracking defaults off (`BUS_TRACKING_ENABLED=false`); no live locations are seeded.

## Events and notifications

The navigation bell opens the in-app notification center. Admins manage verified
announcements and deadlines under **Admin → Announcements**. Existing demo events
remain unverified and do not generate notifications. Campus times display in
Asia/Kolkata. Guest read state stays on-device; existing accounts sync read state.
Web Push is optional and disabled by default. See [notification setup and platform
limits](docs/NOTIFICATIONS.md) for the additive index command, persistent scheduling,
VAPID configuration, worker startup, privacy and tests.

## Troubleshooting

- **Engine warnings:** select Node 22+ before running npm. Node 18/20 is not
  compatible with the locked OpenAI SDK.
- **Database startup failure:** set your own `MONGODB_URI`, check connectivity,
  DNS, credentials, and Atlas network access. The application uses OS DNS.
- **Authentication returns 503:** configure `JWT_SECRET` and restart the API.
  For admin login, also configure `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
- **Frontend cannot reach API:** configure your actual `MONGODB_URI` in
  `server/.env` and start the backend from `server/`. Check `/api/health` through
  Vite at `http://127.0.0.1:5173/api/health`. The development `/api` proxy targets
  port 5000. Explicit external API URLs also require the matching `CLIENT_ORIGIN`.
  No database records are created automatically to hide connection failures.
- **AI fallback:** verify the provider URL, key and supported model ID, and
  MongoDB availability. Model access is provider/account dependent.
- **Empty directories:** check network/API errors before assuming data is
  missing. Do not use the destructive seed script as an outage workaround.


## Project provenance

This repository imports and extends the existing [AIKYA project](https://github.com/satya-sri-karri/AikyA). It starts a new Git history for this publication; that history does not represent sole authorship of the original application. Original source attribution and embedded third-party notices are preserved.
