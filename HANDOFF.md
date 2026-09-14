<!--
════════════════════════════════════════════════════════════════════════════
ABOUT THIS DOCUMENT — HANDOFF.md
Purpose : Session-to-session continuity. The "where we left off / what's next"
          state so any new session (human or agent) picks up cold without
          re-deriving context. The successor to ad-hoc SESSION_NOTES.
Audience: The next person or agent to touch this project — including future-you.
Update  : At the END of a work session (or when you pause). Overwrite the
          "Current state / Left off / Next" sections; append to the log.
Belongs : What's working now, what's in progress, exactly where work stopped,
          the immediate next step, open questions/blockers, recent decisions.
NOT here: The long-term plan (→ ROADMAP/PLAN). This is the volatile "right now"
          layer — it changes every session.
Why it exists even with agent memory: this file is version-controlled and lives
          IN the repo, so it survives across machines, profiles, tools, and
          teammates — unlike an agent's private session memory. If your agent
          tool auto-loads context files (e.g. .hermes.md / AGENTS.md / CLAUDE.md),
          either name this file that way or link it from the one that is loaded,
          so a fresh session reads it automatically.
Delete this comment block once HANDOFF holds real content.
════════════════════════════════════════════════════════════════════════════
-->

# HANDOFF — <Project Name>

> The living "current state" of the project. Keep the top three sections fresh;
> append to the log at the bottom.

## ✅ Current state (what works right now)
- <shipped / working things, one line each>

## 🚧 In progress / where we left off
- <what was mid-flight when the last session ended, and the EXACT stopping point —
  file, branch, command, or step so it can be resumed cold>

## ➡️ Next step (the very first thing to do next session)
- <the single most immediate action; then what follows>

## ⚠️ Open questions / blockers
- <decisions needed, things waiting on a human, known issues>

## 🧠 Recent decisions (short log)
- YYYY-MM-DD — <decision + one-line why> 
- YYYY-MM-DD — <decision + one-line why>

---
## Session log (append newest on top)
### YYYY-MM-DD — <session title>
- Did: <what got done>
- Left off: <where>
- Next: <what's queued>
