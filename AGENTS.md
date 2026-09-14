<!--
════════════════════════════════════════════════════════════════════════════
ABOUT THIS DOCUMENT — AGENTS.md
Purpose : The operating protocol for anyone (especially AI agents) doing work
          in this repo. Conventions, guardrails, how work flows, what's
          enforced vs. trusted.
Audience: AI coding agents FIRST (many tools auto-load this file), and humans
          who want the working conventions.
Update  : When conventions, guardrails, review flow, or "how we work here"
          change. This is the highest-leverage doc for agent quality.
Belongs : Roles/responsibilities, the work lifecycle, coding conventions,
          test/verify expectations, guardrails (what NOT to do), and links to
          the deeper docs an agent should load (PLAN/ARCHITECTURE/SCHEMA/DESIGN).
NOT here: The plan itself, the data model — LINK to those, don't duplicate.
Note    : AGENTS.md is an emerging cross-tool standard. Tool-specific context
          files (.hermes.md, CLAUDE.md, .cursorrules) can point here or add to it.
Delete this comment block once AGENTS.md holds real content.
════════════════════════════════════════════════════════════════════════════
-->

# AGENTS.md — Working Protocol

> Read this before making changes. Then load the docs it links.

## Orientation (read these first)
- [PLAN.md](./PLAN.md) — what we're building and in what order.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — how it fits together.
- [SCHEMA.md](./SCHEMA.md) — the data model + invariants.
- [DESIGN.md](./DESIGN.md) — UI/UX spec + tokens.

## How we work here
- <e.g. branch-per-unit + PR; small, scoped changes; conventional commits>
- <e.g. one unit of work = one focused change; don't expand scope mid-task>

## Coding conventions
- <language style, formatting, naming, error-handling norms>
- <where types live, how modules are organized>

## Testing & verification (don't trust, verify)
- <how to run the tests; expectation that changes ship with tests>
- <run the real command and report real output — never fabricate results>

## Guardrails (do NOT)
- <destructive actions requiring human approval>
- <files/areas off-limits; secrets never committed; etc.>

## Definition of done
- <builds, tests pass, docs updated, acceptance criteria met>
