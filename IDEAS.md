# Ideas — Uncommitted options

These are proposals, not implemented features or approval to expand the security boundary. Promote only after owner review and concrete acceptance criteria in [ROADMAP.md](./ROADMAP.md).

## Read-only diagnostics

- Stable cursor/snapshot paging for retained telemetry, if live offset drift becomes disruptive.
- Explicit historical policy generation IDs without storing client names or mailbox mappings.
- A sanitized local export with retention/coverage labels, after privacy review; never export meeting data as telemetry.
- More precise tool-latency distribution and actual retry measurements, if instrumentation can preserve strict fixed-field privacy.

## Reliability and accessibility

- Harden existing filesystem path ownership/symlink handling for policy and telemetry, with adversarial tests.
- Screen-reader regression checks, stale-page recovery and explicit focus management around login/logout.
- Reproducible pinned browser-verifier packaging for this checkout, without adding it to production runtime dependencies.

## Deliberately separate future designs

Named viewers and distributed persistence require separate threat models. Private IPv4 dashboard HTTPS is implemented, but any new exposure or proxy still requires explicit review. Multi-calendar availability would need explicit per-calendar authorization and complete-result semantics. Calendar writes, mail access and arbitrary Graph proxying remain outside this project's current read-only scope.
