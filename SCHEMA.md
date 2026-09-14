<!--
════════════════════════════════════════════════════════════════════════════
ABOUT THIS DOCUMENT — SCHEMA.md
Purpose : The data model — the tables/types/collections, their DDL, and the
          invariants that keep the data correct. The authoritative description
          of "what shape the data is."
Audience: Anyone touching the datastore or the types that mirror it (human or
          agent). Prevents drift between code and data.
Update  : With every migration / schema change. Keep it in lockstep with the
          actual DB — a wrong SCHEMA.md is worse than none.
Belongs : Entity list, DDL (or link to migrations), relationships, constraints,
          indexes, and the load-bearing invariants (uniqueness, ordering,
          state machines) that the app relies on.
NOT here: How components use the data (→ ARCHITECTURE.md). This is the model,
          not the behavior.
Applies : Any project with a datastore. Delete this file if there isn't one.
Delete this comment block once SCHEMA holds real content.
════════════════════════════════════════════════════════════════════════════
-->

# SCHEMA — <Project Name>

## Entities

| Entity | Represents | Key fields |
|--------|------------|------------|
| <table/type> | <what it models> | <pk, important cols> |

## DDL / migrations

<Inline the DDL, or link to the migrations directory. Keep migrations ordered
and append-only.>

## Relationships & constraints

<Foreign keys, uniqueness, checks. What the database enforces vs. what the app
enforces.>

## Invariants (the rules that must always hold)

- <e.g. "a card has exactly one owner while claimed"; "seq is unique per project">
