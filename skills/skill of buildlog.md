---
name: build-log
description: Explains and manually re-runs the automatic prompt-level logging to build-log.md (date, time, and approximate tokens used per prompt). The actual logging is automatic via a Stop hook — invoke this skill (/build-log) only to inspect the log, explain how it works, or manually append an entry if the hook didn't fire.
---

# Build log (per-prompt token log)

`build-log.md` at the repo root records one line per user prompt: the date, time, and an approximate token count for that turn.

This is automatic. A `Stop` hook (`.claude/settings.json` → `hooks.Stop`, running `.claude/hooks/build-log-stop.ps1`) fires after every assistant turn.

The hook:
- Reads the session transcript
- Sums `input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens`
- Processes only assistant messages produced since the hook's previous run
- Tracks the last processed transcript position per session in `.claude/build-log-state/<session_id>.txt`
- Appends one line to `build-log.md`

Format:

```markdown
- YYYY-MM-DD HH:mm:ss - ~<token count> tokens