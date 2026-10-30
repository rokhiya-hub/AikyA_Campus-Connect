# Events, announcements and notifications MVP

The existing React/Vite, Express and MongoDB architecture is retained. No real
campus event, deadline, allocation or contact was invented. Existing/demo event
records are preserved and labelled unverified; they do not produce alerts.

## In-app first

Open **Notifications** from the navigation bell, sidebar, dashboard or landing
Updates link. The center supports pagination, read/unread controls, an unread
filter, refresh, loading, empty states and retry feedback. It refreshes every
60 seconds while visible and hides expired entries locally. An open page may
take up to that interval to reflect cancellation. The server checks current
visibility on every request and before saving read state.

Public announcements work for guests. Only notification IDs/read timestamps are
stored locally for guests (bounded to 300 IDs), never announcement text. Existing
faculty/admin/approved-owner accounts have server-synced read state. Account
changes clear the visible feed; another account's receipts are never used.
There is **no student identity system in this repository**: students browse
public notices as guests. This MVP does not invent student credentials or treat
guests as an authenticated student audience. Driver/device sessions cannot
access account notifications. Suspended owners and removed accounts are rejected.

In Admin → Announcements, create a draft, edit it, verify its content and dates
against an official source, and schedule it. Scheduled announcements are immutable;
cancel and create a replacement to retain delivery history. Cancelled records
are retained, not deleted. Admin creation/update/cancellation uses existing audit
logging without message values. Only admins can manage notices or view delivery
counts. Delivery counts distinguish claimed, push-service accepted, failed and
cancelled; service acceptance does not prove device display or reading.

Notification fields include type (`announcement`, `event`, `deadline`), audience,
optional recipient/event reference, status, scheduled/expiry/occurrence timestamps,
timezone, official verification and creator. Restricted audience/recipient
matching happens in database queries and again before delivery; unauthenticated
responses never contain restricted notices. Unknown body fields and unsafe
Mongo keys are rejected using the existing Zod validation approach.

## Verified dates and careful migration

Event records retain legacy `date`, `startTime` and `endTime`. Add `startsAt`,
optional `endsAt`/`deadlineAt` and verification via the existing Events admin
editor; use ISO timestamps with `Z` or an explicit offset such as `+05:30`.
Verified start date must match the legacy calendar date in Asia/Kolkata. End must
follow start. Verification requires a source and a nonfuture verification date.
No automatic backfill or database rewrite was performed.

The Events page retains all recorded events with verification labels and adds
verified upcoming/deadline filters. Dashboard upcoming cards/counts use verified
timestamps. Confirmed times display in **Asia/Kolkata**, independent of the
device timezone. Announcement date/time controls explicitly use campus wall time
and convert it to UTC for storage. Unzoned timestamps are rejected by the API.

To link an event alert, select type event/deadline, supply its event ID and the
matching verified start/deadline occurrence. A linked alert is hidden if its event
loses verification or its timestamp changes. Standalone deadlines also require
an occurrence time and official verification. Expiry follows publication and
cannot extend past a supplied occurrence time. No alerts are automatically
created from demo/unverified events.

## Setup

Use Node 22+ and npm 10+, then the existing README installation/configuration:

```sh
cd server
npm ci
# Review the configured MONGODB_URI before this additive index operation:
npm run notifications:indexes -- --confirm-indexes
npm run dev
```

The index command creates notification collections/indexes additively; it never
drops collections, seeds data or rewrites event records. It was not run against
an existing database during implementation. Guest feeds do not require the push
worker. Account read receipts and push subscriptions fail closed if required
unique/retention indexes are missing. Production deployment must provision the
indexes before enabling these writes.

`Notification` is itself the persistent schedule: scheduledAt/expiry/verification
determine eligibility in indexed MongoDB queries, not an in-memory timeout or
restart-dependent queue. Publication works even if the push worker is stopped.
The push outbox uses a unique `(notificationId, subscriptionId)` delivery record.
The receipt index is unique per notification/account; subscription endpoint hashes
are unique. Retention indexes remove receipts/delivery metadata seven days after
notice expiry. Subscriptions expire after 90 days without renewal. TTL cleanup is
asynchronous; reads filter expiry immediately. Announcements themselves are
retained as admin history, without a destructive automatic migration.

## Optional Web Push

In `server/.env`, configure your own stable VAPID keypair and operational contact:

```dotenv
WEB_PUSH_ENABLED=false
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
```

Generate the keypair using `web-push.generateVAPIDKeys()` in your secure deployment
tooling. Persist it securely; do not regenerate on restart. Use a real `mailto:`
or HTTPS operational contact for the subject. Never commit or expose the private
key. The browser receives only the intentionally public VAPID key. After index
provisioning, set `WEB_PUSH_ENABLED=true`, restart the API, and run a supervised
worker using the same database/configuration:

```sh
cd server
npm run notifications:worker
```

The worker polls durable scheduled records every 15 seconds, scans in bounded
keyset-paginated batches and claims each delivery with a journaled majority write
before sending. Multiple workers/restarts share the unique claim. A claimed
delivery is never automatically retried, including after ambiguous transport
errors or a crash between claiming and sending. This is **at-most-once push
attempts**, not guaranteed delivery: a crash can lose a push, but the in-app notice
remains. Monitor failed/claimed counts. Do not manually reset claims for replay.
Large audiences may require dedicated capacity and further worker partitioning;
bounded queries can fail safely under load and resume on the next cycle.

Push requires an explicit click and browser permission. Users can enable/renew
public push for this device or disable it in the center. Opt-out unsubscribes the
browser and deletes the device-owned server registration. If offline, the browser
records a pending server opt-out for an explicit retry; browser permission can
also be disabled in browser settings. Re-enabling retries pending opt-out first.
Device registration ownership uses a random local token, stored hashed on the
server; another device cannot overwrite/remove it by knowing the endpoint.
Clearing site data can remove that local token; revoke browser permission and
create a fresh subscription if ownership no longer matches.

Only **public**, currently eligible announcements are considered for push. New
subscribers do not get historical bursts. Every payload/lock-screen message is
generic and links only to `/notifications`; restricted titles, bodies and account
data never enter push payloads. Server subscriptions/keys have no public listing.
HTTPS push endpoints are restricted to explicitly supported browser-vendor hosts
to prevent arbitrary outbound requests. Unsupported vendor endpoints are rejected,
not silently proxied. Revoked endpoints (404/410) are disabled. Cancellation and
opt-out are rechecked before sending; a push already in flight or accepted by a
vendor cannot be recalled. The service worker does not cache private pages.

## Browser/platform limits

Service workers require a secure context, generally HTTPS; localhost is permitted
for development. Feature detection disables unsupported controls. See
[MDN Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API).
iOS/iPadOS Web Push requires a supported Home Screen web app and a permission
request following a user action. The added standalone manifest supports this
installation flow; platform testing is still needed. See
[WebKit's Web Push requirements](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

OS focus modes, battery/network settings, enterprise policies and revoked
permissions can suppress/delay delivery. No background timer, mobile browser or
push vendor guarantees timely alerts. This is not an emergency notification
system. Actual Safari/iOS/Android delivery was not exercised; browser permissions,
subscription success/failure and opt-out are mocked in automated tests.

## Changed files and UX

- Backend: `src/models/{Notification,NotificationReceipt,NotificationDelivery,PushSubscription}.js`,
  `src/services/notifications.js`, `src/routes/notifications.js`, `src/server.js`.
- Event compatibility: `src/models/Event.js`, `src/validation/index.js`,
  `src/services/publicData.js`; existing seed records remain untouched.
- Operations: `scripts/notification-{indexes,worker}.js`, `package.json`,
  `package-lock.json` (`web-push` only), `.env.example`.
- Client: `components/Notification{Center,Admin}.jsx`, `lib/{notificationTime,pushNotifications}.js`,
  `api/client.js`, `pages/{Admin,Events,Dashboard,Landing}.jsx`, `App.jsx`,
  `components/{Navbar,Sidebar}.jsx`, `App.css`, `index.html`, public service worker,
  standalone manifest and SVG app icon.

Existing theme/search/portals remain. New responsive forms/cards have labels,
status/error announcements, 44px mobile controls and safe plain-text rendering.
Navigation adds skip links, visible keyboard focus, hidden offscreen mobile links,
Escape-to-close, focus return and keyboard focus containment while the menu is
open. Reduced-motion settings are honored. This is targeted accessibility work,
not a full WCAG certification.
Floating assistant/emergency controls now sit above the mobile dock with safe-area
spacing so they do not cover navigation links; browser checks assert this layout.

## Tests

Run server `npm test`/`npm run check`, client `npm test`/`npm run build`, and client
`npm run test:notifications-browser`. The browser test uses synthetic HTTP fixtures
and Edge by default (`AIKYA_TEST_BROWSER_CHANNEL` can select another installed
Playwright channel). It never calls a real push service.

Server `npm run test:notifications:local` starts **its own** temporary loopback
mongod, verifies process ownership, creates test indexes and removes only that
generated temporary directory. It ignores existing database URI configuration.
Install `mongod` on PATH, or set `AIKYA_TEST_MONGOD` to its executable. The test
checks real unique delivery claims under concurrency/restart, interrupted claims,
idempotent read receipts, cancellation and TTL definitions; transport is mocked.
It does not wait seven days to test TTL deletion.

Results and raw outputs: [LOCAL_SETUP_REPORT.md](LOCAL_SETUP_REPORT.md),
`artifacts/notifications-*.txt`. No production database, seed, real push endpoint
or existing credentials were used.
