---
name: build-log
description: Explains and manually re-runs the automatic prompt-level logging to BUILD_LOG.md's "Automatic per-turn token usage log" section (date, time, and exact token usage per prompt/turn, read from the session transcript). The actual logging is automatic via a Stop hook — invoke this skill (/build-log) only to inspect the log, explain how it works, or manually append/repair an entry if the hook didn't fire.
---

# Build log (per-turn token log)

`BUILD_LOG.md` at the repo root is the single canonical build log. Its narrative task-by-task
entries live at the top (written by whichever agent did that work); its last section, "Automatic
per-turn token usage log", records one line per Claude Code turn (one user prompt through to the
model going idle again, including any tool calls in between): the date, time, and the **actual**
token usage for that turn, taken from the session transcript — never estimated from character/word
counts.

This per-turn section used to live in its own separate file, `build-log.md`. The two were merged
into this one file on 2026-09-20 so there is a single build log; nothing in either log was altered
or re-estimated in that merge. The per-turn section is deliberately kept as the *last* section in
`BUILD_LOG.md` — the hook always appends to the end of the file, so any new narrative entry must be
added **above** it, never below.

## How logging works (automatic)

A `Stop` hook (`.claude/settings.json` → `hooks.Stop`, running `.claude/hooks/build-log-stop.cjs`) fires after every assistant turn. It:

1. Reads the session transcript (JSONL) at the path Claude Code passes in on stdin (`transcript_path`).
2. Looks up how many transcript lines it already processed for this session, from `.claude/build-log-state/<session_id>.txt` (gitignored). Defaults to 0 for a session it hasn't seen.
3. Only processes lines **after** that position — this is what prevents double-counting or re-logging old turns if the hook runs more than once, and what guarantees every new turn gets exactly one entry.
4. Sums token usage for those new lines (see "Token calculation" below) and appends one line to the end of `BUILD_LOG.md`.
5. Writes the new line count back to the state file, whether or not anything was logged.

If the Stop hook fires with genuinely no new assistant activity since last time (e.g. it double-fires), no line is appended — the state file simply doesn't advance further, so nothing is skipped and nothing is duplicated.

## Token calculation — what is actually counted

Source: the real `usage` object Claude Code's transcript attaches to each assistant API response (`input_tokens`, `cache_creation_input_tokens` — or the nested `cache_creation` object on older/newer transcript shapes — `cache_read_input_tokens`, `output_tokens`). This is never approximated.

**Critical deduplication step:** the transcript writes **one JSONL line per content block** of a single API response — one line for a `thinking` block, one for `text`, one per `tool_use` block, etc. Every one of those lines repeats the *same* `usage` object for that whole response. Naively summing usage across every assistant-typed line multiplies each response's real token count by however many content blocks it had (this is exactly the bug in earlier versions of this hook — see "History" below). The hook instead sums usage **once per unique response id** (`message.id`, falling back to `requestId`, falling back to `uuid`), so each API call is counted exactly once no matter how many transcript lines it produced.

A turn's logged total is the sum, across all unique API responses in that turn, of:

- **input side**: `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` (everything billed as prompt/context)
- **output side**: `output_tokens` (generation only)

Format:

```markdown
- YYYY-MM-DD HH:mm:ss - <total> tokens (input: <input side>, output: <output side>)
```

If a turn had assistant activity but the transcript carried no recoverable usage data for it (a future/unexpected transcript shape), the entry is logged as:

```markdown
- YYYY-MM-DD HH:mm:ss - unknown tokens (transcript had assistant activity but no usage data)
```

Token counts are never invented — an unrecoverable turn is always marked `unknown`, never given a guessed number.

The dedup/summing logic lives in one place — `summarizeUsage()` in `.claude/hooks/build-log-stop.cjs` — exported from that file so the hook and any manual backfill/audit work (see the `super-agent`, this project's single project-wide agent) share the exact same math instead of two implementations drifting apart.

## History

The original version of this hook (before the dedup fix) summed usage across every assistant-typed transcript line without deduplicating by response id, which triple- or quadruple-counted turns that had multiple content blocks. It produced one wildly inflated entry (~1.7M tokens for a turn that actually used ~952K). That entry has been corrected in the token-usage section of `BUILD_LOG.md` using the real transcript data for that turn — recovered, not re-estimated.

## When to invoke this skill

You do not need to invoke anything for normal logging — it happens on its own. Use `/build-log` only when:

1. **Explaining the log** — a teammate asks what the token-usage section of `BUILD_LOG.md` is or how the numbers are computed (point them at "Token calculation" above).
2. **The hook didn't fire** — e.g. it's disabled, `/hooks` needs a reload after this skill/hook was added or changed, or `node` isn't on PATH in the hook's environment. In that case:
   - Run `git rev-parse --is-inside-work-tree` to confirm you're in the repo.
   - Find the session transcript under `~/.claude/projects/<project-slug>/<session_id>.jsonl` and the corresponding state file under `.claude/build-log-state/<session_id>.txt` (0 if it doesn't exist yet).
   - Reuse the hook's own logic rather than re-deriving numbers by hand: `node -e "const {summarizeUsage,formatEntry}=require('./.claude/hooks/build-log-stop.cjs'); const fs=require('fs'); const lines=fs.readFileSync('<transcript>','utf8').split('\n').filter(Boolean).slice(<lastLine>); console.log(formatEntry(summarizeUsage(lines)))"` and append the result to the end of `BUILD_LOG.md`, then update the state file to the new total line count.
   - If the transcript genuinely has no usage data for that turn, append an `unknown tokens` line instead of guessing.
   - Tell the user the entry was added manually because the automatic hook did not run, and suggest they check `/hooks` or `.claude/settings.json`.
3. **Repairing the log** — for anything beyond appending one missed entry (duplicate entries, malformed lines, multiple historical entries needing backfill), prefer delegating to `super-agent` (this project's one project-wide agent, `.claude/agents/super-agent.md`), which knows this system and the safety rules around never inventing token counts.

## Notes

- Never edit or reorder *valid* existing entries — only append, or correct a specific entry when you have verified real transcript data backing the correction (as documented above).
- `BUILD_LOG.md` is now the one file both logs share: narrative per-**git-commit** entries (time spent, tokens, what shipped) at the top, and this skill's automatic per-**prompt/turn** entries in the "Automatic per-turn token usage log" section at the very end. They used to be two separate files (`BUILD_LOG.md` and `build-log.md`) until merged on 2026-09-20.
- The per-session state files under `.claude/build-log-state/` are bookkeeping only (last transcript line processed) — never edit them by hand except as part of a deliberate, verified repair; resetting one to 0 causes that session's entire transcript to be reprocessed on the next Stop.
