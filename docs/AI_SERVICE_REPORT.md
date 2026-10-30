# Campus assistant security and reliability

The existing React assistant, Express chat endpoint and OpenAI-compatible SDK
are retained. No provider was added, no real provider requests were made during
tests, and no production records or seed scripts were touched.

## Configuration and behavior

Set `AI_BASE_URL`, `AI_API_KEY` and `AI_MODEL` on the server to your provider's
actual values. All three are required; there is no default vendor or model.
HTTPS is required except loopback HTTP outside production. Credentials in URL
components are rejected. Never put provider keys in frontend `VITE_*` variables.
Node 22+ and the existing `npm ci` setup instructions still apply.

Without external configuration, chat retrieves and renders local campus facts.
The UI offers external AI consent separately for each question; retries do not
silently repeat that consent. Personal faculty/hostel questions and sensitive
input stay local even with consent. This conservative classifier is not a
general-purpose personal-data detector: users must not submit private details.

## Changed files and safeguards

- `server/src/services/aiService.js`: validates provider configuration, disables
  SDK debug logging and automatic retries, propagates cancellation and maps
  outages to safe codes. The static system message never includes records.
  Question and records are untrusted user-role JSON. Provider output must be a
  strict list of known public fact IDs; arbitrary prose is never displayed.
- `server/src/services/campusDataService.js`: escaped, bounded relevance searches,
  intent word boundaries, product searches and multi-result clarification replace
  complete campus snapshots. Explicit projections/serializers remove credentials,
  faculty contacts, driver contacts and hostel occupancy. Faculty/hostel facts
  never enter provider context. Invalid or instruction-like records are omitted.
- `server/src/services/chatPolicy.js`: shared strict evidence schema, safe text,
  sensitive-input checks, bounded operations and deterministic fact rendering.
  Sources contain stable record IDs, human labels and permitted internal links.
- `server/src/routes/chat.js`, `server/src/server.js` and
  `server/src/validation/index.js`: strict 1–1000-character requests, explicit
  boolean consent, local fallback, four concurrent requests per process and the
  existing 30 requests/IP/15 minutes limit. Analytics still requires admin auth.
- `server/src/models/QueryLog.js`: new logs contain only outcome, counts, latency
  and expiry metadata. Questions, answers, credentials, IPs and sessions are not
  written. Analytics explicitly whitelists fields and excludes undated legacy logs.
- `client/src/lib/useCampusChat.js`, `ChatEvidence.jsx`, `AIConsole.jsx`,
  `ChatWidget.jsx`, `client/src/api/client.js`, `client/src/App.css`: preserve the
  assistant layout while adding cancellable loading, unavailable/retry states,
  source links, clarification choices and one-question consent. Result cards
  require an exact source ID instead of selecting an unrelated first record.
- `README.md`, `server/.env.example`, `server/package.json` and
  `server/scripts/chat-log-indexes.js`: provider-neutral configuration and an
  explicit additive telemetry-index command.

Recorded prices, timings and stock carry freshness/demo/unverified qualifiers;
missing facts are explicitly unavailable. Timetable gaps never establish physical
presence. The assistant does not read live bus positions or private hostel
vacancies. Source records can themselves be inaccurate; confirmation with campus
owners remains necessary.

## Bounds and retention

Retrieval uses at most eight results per collection, five collections, eight
sources and 24 facts, with a 6500-byte context bound. Provider prompts are bounded
to 8192 UTF-8 bytes (not an exact tokenizer count). `AI_MAX_TOKENS` defaults to
256 and allows 64–512. `AI_TIMEOUT_MS` defaults to 8000 and allows 1000–15000;
the whole chat deadline is 14 seconds. Retrieval has a 3-second route deadline
and individual database queries use a 1200 ms maximum. The browser aborts after
18 seconds. There are no automatic provider retries. Per-process/IP controls are
not a distributed spending cap; a multi-instance deployment needs shared limits.

Metadata logging is skipped unless the required unrestricted TTL index exists.
On an explicitly selected database, an operator may provision the additive index:

```sh
cd server
npm run chat:indexes -- --confirm-indexes
```

This command was **not executed** against an existing database. It creates indexes,
not seed records. New entries expire after seven days; MongoDB TTL cleanup is
asynchronous. Legacy question/answer records are hidden from current analytics
but are not automatically erased or assigned expiry. Review their retention and
removal separately with the database owner; this work did not alter them.

## Verification

Deterministic mocked-provider tests in `server/test/ai-chat.test.js` cover missing
configuration, invalid data/output, injection-like records, consent/privacy,
clarification, bounded context, hard timeouts, outages and metadata-only logging.
`client/component-tests/chat.test.jsx` checks consent reset, loading, safe errors,
retry, cancellation, source links and exact-record cards. Existing security and
frontend suites remain part of the checks. Tests use synthetic records and no
real API keys. Raw output is in `docs/artifacts/ai-*.txt`; results are recorded in
the local setup report. Real provider compatibility, production MongoDB TTL timing
and live campus facts were not verified.
