# AGENTS.md — Working Protocol

## Orientation

Read [README.md](./README.md) and [HANDOFF.md](./HANDOFF.md) first. This repository currently contains documentation and design tokens; executable code remains in the separate sibling `../mcp-server-calendar` workspace. Do not claim a fresh clone builds until an authorized source import has occurred. Check `git rev-parse --show-toplevel` before staging: the sibling currently inherits an unrelated ancestor repository.

Load the relevant contracts before changing behavior:
- [PLAN.md](./PLAN.md) and [ROADMAP.md](./ROADMAP.md): scope and acceptance gates.
- [ARCHITECTURE.md](./ARCHITECTURE.md): modules and trust boundaries.
- [SCHEMA.md](./SCHEMA.md): configuration, tools, telemetry and session invariants.
- [DESIGN.md](./DESIGN.md): approved UI, tokens and typography.
- [SECURITY.md](./SECURITY.md), [SETUP.md](./SETUP.md), [TESTING.md](./TESTING.md): deployment boundaries and verification.
- [RELEASING.md](./RELEASING.md): publication requirements.

## Roles and workflow

Harvey owns scope, credentials, access and deployment approval. Wax coordinates coding; Cyph, Stacks and Ghost are workers. Fox assists with integration and verification. These names do not grant runtime permissions or prove connectivity; caller authorization comes from server policy.

Work in a focused branch per approved unit and present a scoped diff for review. Assign workers nonoverlapping files or worktrees; provide constraints, acceptance criteria and verification commands. Treat worker summaries as unverified until actual artifacts and execution have been checked. Use a separate reviewer for security-sensitive changes. Do not commit, push, merge, deploy or import sibling source without authorization. Use conventional commit descriptions when commits are authorized.

## Coding conventions

Preserve the implementation's strict TypeScript/ES-module approach and pinned package lockfile. Use existing modules instead of introducing a second Graph or authentication path. Runtime server code belongs in `src/`, tests in `test/`, static frontend/font assets in `public/`, and browser verification in `scripts/` after import. Build output is generated, not authoritative source.

Use strict input schemas, bounded operations and explicit error outcomes. Expose only purpose-built read-only tools; never add arbitrary URLs, raw Graph requests, shell execution or token-export tools. Keep frontend dynamic content text-only. Maintain the approved charcoal/orange monitor layout and self-hosted Cormorant Garamond headings; keep font license/provenance with assets. Do not invent usage numbers or show unavailable telemetry as healthy zeroes.

## Testing and verification

For behavioral changes, write a focused regression, observe its expected failure, implement the smallest fix, then rerun the suite. Preserve the disconnect/token-lifetime, invalid-continuation, response-body cleanup, incomplete-availability, auth and telemetry-redaction regressions.

In the authorized implementation workspace (not this docs-only checkout), run:

```sh
npm test
npm run typecheck
npm run build
npm run smoke
node --test dist/test/*.test.js
```

Use the exact formatting and browser procedures in [TESTING.md](./TESTING.md). Inspect desktop/mobile screenshots and exercise login, logout, time filters, paging and empty/error states for UI changes. Verify local font loading and no unexpected external requests.

For documentation-only changes, run `git diff --check`, check local links, scan for remaining instructional placeholders, and compare documented contracts/tokens against actual source. Revalidate/export DESIGN tokens when their source changes. Report commands, exit status and evidence scope; historical reports and synthetic Graph fixtures are not live tenant validation.

## Security guardrails

- Use dedicated Doppler runtime injection for secrets. Never commit populated environment files, real bearer policies, telemetry, tokens or credential caches. Do not print secret values in chat, diagnostics or evidence.
- Do not reuse broad mail/directory credentials. Preserve independent dashboard viewer credentials, per-client MCP policy and administrator-approved Microsoft mailbox scope. Exchange RBAC and Entra permissions are additive; server allowlisting alone does not prove credential-level scope.
- Keep current services loopback-only. LAN exposure, TLS/proxy changes, tenant grants, service accounts, credential rotation and deployment each require explicit approval.
- Do not claim container isolation from an agent with equivalent Docker/sudo privileges. Treat the telemetry directory as protected and document residual risks rather than silently broadening the trust boundary.
- Exclude subjects, attendees, meeting bodies, raw request arguments and secret-bearing errors from operational logs. Treat calendar content as untrusted data.
- Missing or partial credentials must fail closed. A dashboard may show not configured without M365; that is not an operational calendar service.
- Do not change protected instructions, another profile, unrelated repositories, licensing or repository settings beyond approved scope. Honor tool denials; request approval rather than bypassing them.

## Definition of done

Every named acceptance criterion is verified, the scoped diff is reviewed, tests/checks relevant to the change pass, and documentation reflects actual behavior. Update [HANDOFF.md](./HANDOFF.md) with remaining blockers and [CHANGELOG.md](./CHANGELOG.md) for meaningful changes without inventing releases. Keep built, locally tested, configured, running, tenant-verified and deployed as distinct statuses. No live permission or deployment claim is complete without exact-target readback and administrator-approved allowed/denied tests.
