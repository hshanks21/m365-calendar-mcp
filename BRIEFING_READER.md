# Morning briefing reader (unreleased)

## Scope and entrypoint

`scripts/calendar_briefing.py` is a Python 3.12+ standard-library reader. Pass a JSON object on private stdin with `work` and `family` entries, each containing **only** `secret` (existing MCP caller bearer) and `calendarKey` (approved policy alias). It talks only to the existing authenticated `http://127.0.0.1:3217/mcp`; it cannot contact providers, discover calendars, execute event text, create events, or deliver messages. Do not put credentials in shell arguments or commit live output.

The deployment-specific Doppler/policy adapter stays outside this repository. Scheduling and Discord delivery are separate responsibilities. Forward the deterministic `text` verbatim, treating event titles as untrusted quoted data rather than instructions. Do not ask an agent to act on event content. Do not rerun authentication automatically after a failure.

## Behavior

- Resolve today from the runtime clock in `America/New_York`; derive each midnight separately, including 23/25-hour DST days. Include today's agenda and tomorrow's heads-up.
- One `list_events` per provider over a four-local-day padded window, filtered locally to the two requested dates. Padding captures floating all-day dates on calendars with another timezone. Two authenticated MCP handshakes plus two read tool calls; no client retries, redirects, arbitrary endpoints or provider credentials. Existing server-side bounded provider retry policy is unchanged.
- HTTP socket timeout at most 20 seconds, per-provider 25-second budget between requests, 2 MB response cap, 60-second Unix alarm in the CLI. The private runner additionally imposes a 65-second child deadline and 85-second credential-wrapper deadline. The socket timeout alone is not claimed to be an absolute trickle-response deadline.
- Exclude cancelled events. All-day `startDate` is inclusive; `endDate` is exclusive and never converted to Eastern. Multi-day entries are shown on each covered date, not as timed conflicts.
- Keep timed events in Eastern, compare actual instants, include overnight overlaps, and do not count touching endpoints or free events. Tentative/unknown/working-elsewhere overlaps are labeled possible. Family overlap does not establish required attendance. Shared invitations are not deduplicated without a reliable cross-provider identifier.
- Failed/incomplete providers discard partial provider results. Malformed event metadata and legacy all-day events lacking dates explicitly mark coverage incomplete. Never equate these failures with an empty calendar or no conflicts.
- At most 1,000 events per provider; retain at most 100 conflict pairs per day, with explicit truncation flag. Human-readable output limits 40 events and 20 conflict examples per day; structured private report retains remaining events. Discord delivery must support splitting long messages without dropping the coverage warning.

## All-day compatibility gate

The released v0.1.0 projection loses original Google date-only values. The UTC instant alone cannot reveal the original calendar date without independently verified calendar timezone; converting it to Eastern can move an event to the preceding day. The reader deliberately reports `all_day_dates_unavailable` instead of guessing or using provider credentials directly.

The unshipped source changes add optional `startDate`/`endDate`:

- Google preserves the original validated date-only values.
- Graph requests original start/end zones and recovers dates only when both zones match, are recognized by ICU (plus the standard Windows `Eastern Standard Time` alias), and both instants map to exact local midnight. Original fractional seconds must be absent or entirely zero **before** JavaScript Date conversion (which loses submillisecond precision). Missing/custom/unsupported Windows zones or nonmidnight boundaries leave dates unavailable. Unsupported all-day coverage remains explicit, not silently shifted. Timed projection and authorization boundaries are unchanged.

These source changes require independent review and a **new versioned release**, then separately approved deployment and live acceptance. Do not overwrite/relabel/redeploy v0.1.0. Fixture success is not production all-day verification. Running this reader against the old service produces an honest degraded briefing, not a complete all-day fix.

## Installed-reader boundary

An operational wrapper must not execute this development checkout. Install an explicitly reviewed, SHA-256-pinned versioned copy under the private deployment and verify the pin before credential retrieval and again before passing caller bearers. Execute the verified bytes rather than reopening a mutable path; isolate Python imports from the working directory/environment. Missing, writable or hash-mismatched artifacts must fail closed. Atomic installation must leave the prior active pin intact on preflight failure. Content pinning is a review/durability boundary, not OS isolation from the owning user or root.

The global alarm raises a distinct `GlobalDeadline`, not `TimeoutError` (an `OSError`). It bypasses per-provider network recovery and exits the entire provider loop; ordinary socket timeouts still permit the other provider. Maintained tests use both an actual SIGALRM and a real short interval timer.

## Tests

```sh
python3 -m unittest discover -s test -p test_briefing.py
npm test
npm run typecheck
npm run build
npm run smoke
```

Python tests are intentionally separate from the existing Node-only container pipeline; the production server image does not run this host-side reader. No synthetic fixture or event data is evidence of live provider access.
