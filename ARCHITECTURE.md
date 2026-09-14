<!--
════════════════════════════════════════════════════════════════════════════
ABOUT THIS DOCUMENT — ARCHITECTURE.md
Purpose : How the system is put together and WHY. The components, how data
          flows between them, and the load-bearing technical decisions +
          their tradeoffs.
Audience: Anyone (human or agent) about to change the system and needing the
          mental model first — so they don't fight the design.
Update  : When a component, boundary, data flow, or key decision changes.
Belongs : Component overview, data-flow description/diagram, the consistency/
          concurrency model, key decisions WITH the tradeoffs considered,
          explicit non-goals.
NOT here: Row-level data model (→ SCHEMA.md), the build order (→ PLAN.md),
          UI specifics (→ DESIGN.md).
Delete this comment block once ARCHITECTURE holds real content.
════════════════════════════════════════════════════════════════════════════
-->

# ARCHITECTURE — <Project Name>

## Overview

<2–4 sentences: the shape of the system and its major pieces.>

## Components

| Component | Responsibility | Talks to |
|-----------|----------------|----------|
| <name> | <what it owns> | <neighbors> |

## Data flow

<How a request / event moves through the system, start to finish.>

## Consistency & concurrency model

<How the system stays correct under parallel access / failure. State the
invariants that must always hold.>

## Key decisions (with tradeoffs)

- **<Decision>** — chose X over Y because <reason>. Tradeoff: <what we gave up>.

## Non-goals

- <What this system deliberately does NOT do, so scope stays honest.>
