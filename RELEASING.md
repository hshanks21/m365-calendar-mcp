<!--
════════════════════════════════════════════════════════════════════════════
ABOUT THIS DOCUMENT — RELEASING.md
Purpose : The versioned-release procedure. Every version gets an annotated git
          tag on HEAD, a CHANGELOG entry, and an explicit human approval before
          anything is tagged or pushed. Tags are immutable markers of what was
          deployed — this doc exists to slow down at the right moments.
Audience: Whoever cuts a release (human or agent).
Update  : If the release/versioning convention changes.
Belongs : The semver rules, the phased tag-and-push workflow, the approval gate,
          the hard "never" rules.
NOT here: The changelog itself (→ CHANGELOG.md). This is the HOW; CHANGELOG is
          the WHAT-shipped.
Origin  : Distilled from the `release-tagging` agent skill. If you use that
          skill, it enforces this same flow (it calls the changelog file
          SESSION_NOTES.md; this template standardizes on CHANGELOG.md — point
          the skill at CHANGELOG.md, or rename to taste, but keep ONE changelog).
Delete this comment block once RELEASING is adopted.
════════════════════════════════════════════════════════════════════════════
-->

# RELEASING — <Project Name>

Cut a versioned release: document → commit → **approval gate** → tag HEAD → push.
Tags are immutable; the whole point is to be deliberate.

## Core principles
- **Tags always go on HEAD** — never an older commit. A tag describes what's
  deployed right now.
- **Never tag or push without explicit human approval.** Stop and wait for a
  "green light" every time. A pushed tag is hard to take back.
- **One tag per release.** Immutable — never reuse, move, or overwrite.
- **Semantic versioning:** `vMAJOR.MINOR.PATCH`, always with the `v` prefix.
- **Annotated tags only:** `git tag -a` (carries message, author, date).
- **Releases go out from `main`** (merge the feature branch first).

## Version bump
- **MAJOR (`vX.0.0`)** — breaking changes (incompatible API, schema migration,
  removals). Stays `0` until the first production release.
- **MINOR (`v0.Y.0`)** — new, non-breaking functionality.
- **PATCH (`v0.0.Z`)** — fixes, perf, docs, dependency bumps, no-behavior refactors.

## Workflow

### Phase 0 — Pre-flight (gather state, don't assume)
```bash
git status --short                          # dirty tree? staged?
git branch --show-current                   # expect: main
git tag -l -n1 | sort -V | tail -5          # recent tags → latest version
git log origin/main..HEAD --oneline         # commits not yet pushed
```
On a feature branch → merge to `main` first. Detached HEAD → stop.

### Phase 1 — Update CHANGELOG.md
Prepend the new version at the top (date + summary + Added/Fixed/Changed/Removed).
See CHANGELOG.md.

### Phase 2 — Commit (changelog included in this commit)
```bash
git add -A
git commit -m "<type>: <summary> (vX.Y.Z)

- what / why / notes"
```
Type prefix (`feat|fix|refactor|docs|chore`), version in the subject `(vX.Y.Z)`.

### Phase 3 — STOP. Present + wait for approval ⏸️
```
✅ CHANGELOG.md updated
✅ Committed to HEAD (<sha>)
⏸️ Waiting for approval
Proposed tag: vX.Y.Z   (<MAJOR/MINOR/PATCH> — one-line justification)
Push target:  main → origin
On approval:  git tag -a vX.Y.Z -m "vX.Y.Z - <summary>"
              git push origin main --tags
```
A question or vague reply is NOT approval.

### Phase 4 — Tag HEAD (after approval only)
```bash
git tag -a vX.Y.Z -m "vX.Y.Z - <one-line summary>"
```

### Phase 5 — Push commits + tag together, then verify
```bash
git push origin main --tags
git ls-remote --tags origin "vX.Y.Z"        # confirm it landed
```

## Hard rules
**Never:** tag/push before approval · tag a non-HEAD commit · move/overwrite a
pushed tag · lightweight tags · release from anywhere but `main`.
**Always:** wait for approval · annotated tag on HEAD · semver with `v` ·
changelog in the tagged commit · push with `--tags` and verify on the remote.
