# Agentic Project Doc Template

A reusable **documentation scaffold** for software projects — especially ones built
with (or by) AI coding agents. Clone/generate from this template and you start every
project with a consistent, discoverable set of docs instead of reinventing them.

The core insight: **durable, discoverable context is what makes both humans AND
agents effective.** Agents perform dramatically better when the "why", the plan, the
data model, and the conventions live in predictable files they can find — rather than
being trapped in one person's head or a chat history that scrolls away.

## The standard file set

| File | Purpose | Applies to |
|---|---|---|
| `README.md` | What the project is; quickstart; index to the other docs. | Every project |
| `PLAN.md` | The build roadmap — phased milestones, scope, acceptance criteria. **Start here.** | Every project |
| `ARCHITECTURE.md` | Components, data flow, and the key technical decisions/tradeoffs. | Every project |
| `SCHEMA.md` | The data model — tables/types, DDL, and the invariants that keep it correct. | Any data-backed project |
| `AGENTS.md` | The agent operating protocol — conventions, guardrails, how work flows. **Auto-loaded by most agent tools.** | Every agent-built project |
| `DESIGN.md` | UI/UX spec + design tokens (colors, spacing, type). | Any project with a UI |
| `ROADMAP.md` | Committed next work with acceptance criteria (what you WILL build). | Every project |
| `IDEAS.md` | Running backlog of "nice-to-have" sparks (what you MIGHT build). | Every project |
| `HANDOFF.md` | Session-to-session continuity — where we left off, what's next. The successor to ad-hoc SESSION_NOTES. | Every project |
| `RELEASING.md` | The versioned-release procedure — annotated tag on HEAD per version, semver, approval gate. | Every project |
| `CHANGELOG.md` | Permanent per-version history of what shipped (Added/Fixed/Changed). | Every project |

### Add project-specific docs as needed
Some projects need docs beyond the standard set — keep the same "header block +
skeleton" style. Examples from real projects:
- `MCP_SERVER.md` — an agent-tool/API contract.
- `DISPATCH.md` — ops runbook for wiring distributed workers.
- `API.md`, `DEPLOYMENT.md`, `SECURITY.md`, `RUNBOOK.md`, `ADR/` (decision records).

## Why these filenames

- `README.md` is the one true universal standard.
- `ROADMAP.md`, `CHANGELOG.md`, `CONTRIBUTING.md` are widely-recognized conventions.
- `AGENTS.md` is the **emerging cross-tool standard** for agent context — many agent
  tools auto-read it. Tool-specific variants exist and can co-exist or symlink to it:
  `CLAUDE.md` (Claude Code), `.cursorrules` (Cursor), `.hermes.md` (Hermes Agent).
- `ARCHITECTURE.md`, `SCHEMA.md`, `DESIGN.md`, `PLAN.md`, `IDEAS.md` are *our*
  convention — not formal standards, but useful, predictable homes for context that
  otherwise gets lost. Consistency across your projects is the payoff.

## How to use this template

1. **On GitHub:** mark this repo as a *Template repository* (Settings → Template
   repository), then "Use this template" to start a new project.
2. **Or locally:** copy the `*.md` files into a fresh repo.
3. In each file, **read the header block** (the `> ABOUT THIS DOCUMENT` blockquote),
   fill in the skeleton, then **delete the header block + inline `<!-- guidance -->`
   comments** once the doc holds real content.
4. Point `AGENTS.md` (and any tool file like `.hermes.md`/`CLAUDE.md`) at the deeper
   docs so agents actually load them.
5. Delete files you don't need (no UI → drop `DESIGN.md`; no datastore → drop
   `SCHEMA.md`).

## The golden rule
Don't add a file because it's "standard." Add it because it puts durable context
where a human or an agent will find it. Keep them current — a stale doc is worse than
no doc.
