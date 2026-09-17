## Build Log
*Commit 1 — Capstone planning and repository setup*

Date: 11 September 2026
Time spent: ~1 hour
Rough tokens used: ~3,000–3,500 tokens (estimated)

What shipped:
Set up the capstone GitHub repository
Created the development branch
Defined the Unhinged Debt Collector concept
Added the initial project plan
Defined MVP scope and final goals
Defined the AI-involvement level
Defined the initial technical architecture and tech stack

*Commit 2- Removing all the unneeded  "*"s  from the text
* Commit 3- Cleaning up the text using paragraphs

## 2026-09-17
### Task: Unhinged Debt Collector Skill — Stage 1 setup, live-Telegram debugging, and multi-step Agent/Skill loop refactor

**What I asked Claude Code to do:**
Create the `unhinged-debt-collector` Skill on the existing `mcp-telegram-setup` branch to send a debt-info form on `hi`/`hello`/`hey`/`start` and collect the fields; then debug why the live Telegram test wasn't responding; then refactor the Skill into a Telegram-agnostic, state-aware module invoked repeatedly by a separate Agent module inside a multi-step loop (returning structured `status`/`next_field`/`next_question`/`debt_context` JSON), reusing the existing Telegram MCP layer; then make the bot run persistently in the background; then verify the final `debt_context` output.

**What Claude Code did:**
- Found the Stage 1 form-collection Skill (`debtCollectorSkill.ts` + `debtFormStore.ts`) already existed uncommitted on the branch; verified it against spec, added an owner-chat guard (`TELEGRAM_REVIEWER_CHAT_ID`) so only the project owner's chat can trigger it, and wired it into `poller.ts`.
- Debugged a "bot not responding" report: confirmed via direct Telegram Bot API calls (`getMe`, `getWebhookInfo`, `getUpdates`) that no updates were reaching the bot at all — root cause was on the Telegram client side (message not actually being sent), not a code bug. Once the user's Telegram client actually sent the message, the existing flow worked correctly.
- Refactored the Skill into a pure, Telegram-agnostic state machine (`invokeDebtCollectorSkill`) returning structured JSON (`status: "collecting"|"complete"`, `next_field`, `next_question`, `debt_context`, `error?`), and added a new `agent/debtinfoAgent.ts` (user-renamed from `debtCollectorAgent.ts`) that owns the multi-step loop and all Telegram I/O via the existing `tgSendMessage` wrapper — the Skill itself makes no Telegram calls.
- Added per-invocation and final `debt_context` console logging in the Agent as evidence the loop invokes the Skill repeatedly.
- Ran the bot as a background process detached from the Claude Code session (`nohup npm start … & disown`) so it keeps responding after the session closes.

**Files created/modified:**
- mcp-server/src/skills/debtCollectorSkill.ts (rewritten: pure state machine, structured JSON result)
- mcp-server/src/skills/debtFormStore.ts (unchanged, reused)
- mcp-server/src/agent/debtinfoAgent.ts (new: multi-step loop + Telegram I/O, renamed by user from debtCollectorAgent.ts)
- mcp-server/src/telegram/poller.ts (wired to the new Agent instead of calling the Skill directly)
- BUILD_LOG.md

**Result:**
Stage 1 form flow and the multi-step Agent/Skill loop both work end-to-end over real Telegram messages, ending in a fully populated `debt_context`. Bot is running detached in the background, responding to `hi`/`hello`/`hey`/`start`. No commits or pushes were made per instructions; all changes remain unstaged/untracked on `mcp-telegram-setup`.

**Testing / verification:**
- `npx tsc --noEmit` and `npm run build` passed after each change.
- Offline scripted tests (mocked Telegram fetch, no real network) covering trigger words, owner-chat guard, both Yes/No reminder branches, and the full structured-JSON contract (personalized questions, validation errors, exact reminder count never invented) — all passed.
- Live end-to-end tests over the real Telegram bot: confirmed multiple full runs through the form, 9 sequential Skill invocations per run visible in logs, ending at `status=complete` with correct final `debt_context`, e.g. `{"person_name":"Mel","telegram_username":"Hshsh","amount_owed":"100","debt_reason":"Snacks","overdue_duration":"1 day","relationship":"Friend","previously_reminded":false,"previous_reminder_count":0,"additional_context":"No"}`.

**Claude Code token usage:**
Not available.

**Notes / issues:**
- The original "bot not responding" issue was not a code defect — Telegram's API showed zero updates received until the user's client actually sent the message successfully.
- The bot only stays running as long as the detached background process is alive; it does not survive a reboot/logout (user explicitly chose session-survival only, not a full launchd service).
- Stopped scope deliberately at "multi-step loop works end-to-end" per instructions — no reminder-generation, Splitwise, approval workflow, or recipient-sending logic was added.

## 2026-09-17
### Task: Temporary Draft → Clean Preview → Human Approval → SQLite persistence

**What I asked Claude Code to do:**
Extend the existing form/collector flow (no second bot/form) so that once the form completes, the data is held as a temporary draft, shown as a clean Telegram preview with Save/Make Changes buttons, and only written to a new SQLite database (`data/debts.db`) when the user explicitly taps Save — idempotently (no duplicate rows), with Make Changes letting the user edit fields in place instead of redoing the whole form, and with validation on both the original and edited data.

**What Claude Code did:**
- Added `mcp-server/src/database/database.ts` using Node's built-in `node:sqlite` (no new dependency) to create `data/debts.db` and its `debts` table, with a single `saveDebt()` insert function that generates `id`/`created_at`.
- Added a new in-memory `debtDraftStore.ts` (Map-per-draft, mirroring the existing `draftStore.ts` pattern) to hold the preview/edit state between form completion and Save, plus `debtDraftFormat.ts` (preview text, editable-text formatting, and a parser that reads edited "Label: value" lines back into fields) and `debtDraftValidation.ts` (shared validation for both the original and edited draft).
- Added a small optional "tone" question to the end of the existing collector Skill (reply "skip" to leave it or `additional_context` blank), since the required SQLite schema includes an optional `tone` column the old form never asked for.
- Added `agent/debtDraftAgent.ts`: on collector-Skill completion it now shows the DEBT PREVIEW with Save/Make Changes buttons instead of a plain text summary; Save validates and inserts exactly one row (a second tap on an already-saved draft is a no-op); Make Changes sends the current values back as editable text, and the resubmitted reply is parsed, validated, and re-previewed under the *same* draft id (so only one row is ever produced regardless of how many edits happen).
- Wired the new callback actions (`save_debt:`/`edit_debt:`) and the edit-reply path into `telegram/poller.ts` alongside (not replacing) the existing approve/reject reminder-draft handling.
- Added `data/*.db` to `.gitignore`.

**Files created/modified:**
- mcp-server/src/database/database.ts (new)
- mcp-server/src/debtDraftStore.ts (new, later moved — see next entry)
- mcp-server/src/debtDraftFormat.ts (new, later moved — see next entry)
- mcp-server/src/debtDraftValidation.ts (new, later moved — see next entry)
- mcp-server/src/agent/debtDraftAgent.ts (new)
- mcp-server/src/agent/debtinfoAgent.ts (completion now starts the draft/preview stage instead of sending a text summary)
- mcp-server/src/skills/debtCollectorSkill.ts (added optional `tone` question + skip handling)
- mcp-server/src/skills/debtFormStore.ts (added `tone` field)
- mcp-server/src/telegram/poller.ts (routes Save/Make Changes callbacks and edit replies)
- .gitignore (added `data/*.db`)
- BUILD_LOG.md

**Result:**
Full flow works: form (including the new tone question) → draft → preview with Save/Make Changes → Save writes exactly one validated row to SQLite, or Make Changes lets the user edit just the fields they want without redoing the form, with the final row reflecting the edited value. No commits/pushes made by me for this task.

**Testing / verification:**
- `npx tsc --noEmit` and `npm run build` passed.
- Offline scripted test (26 assertions, real `node:sqlite` file, mocked Telegram) covering: preview appears with all fields after form completion; Save inserts exactly one row; pressing Save twice does not create a second row; Make Changes pre-fills the editable text; resubmitting with only the amount changed produces one row with the new amount and the unchanged name; invalid edited data (non-numeric amount) is rejected and never reaches the database; skipped optional fields store as `null`. Test rows were deleted afterward so the real database was left unchanged.
- Live test over the real Telegram bot: ran the form through to the DEBT PREVIEW message with working Save/Make Changes buttons.

**Claude Code token usage:**
Not available.

**Notes / issues:**
- Used Node's built-in `node:sqlite` (confirmed available and working on the project's Node v22.19.0) instead of adding a third-party SQLite package, per "keep it simple."
- No reminder generation, Splitwise, retrieval, or conflict detection was added — scope stayed at draft → preview → SQLite only, as instructed.

## 2026-09-17
### Task: Temporary `/debug` command for inspecting in-memory state

**What I asked Claude Code to do:**
Show where the in-memory sessions Map lives and add a temporary debug command/log that prints the active sessions and their fields.

**What Claude Code did:**
Pointed to `mcp-server/src/skills/debtFormStore.ts`'s `sessions` Map (the collector Skill's in-progress form state) and noted that the separate preview/edit stage lives in its own Map in the debt draft store instead. Added a `debugListSessions()` export to the form store and a `debugListDebtDrafts()` export to the draft store, then added a `/debug` command intercepted early in `telegram/poller.ts`'s `handleUpdate()` that logs both Maps' contents and replies with them in Telegram, clearly marked as temporary.

**Files created/modified:**
- mcp-server/src/skills/debtFormStore.ts (added `debugListSessions()`)
- mcp-server/src/debtDraftStore.ts (added `debugListDebtDrafts()`; later moved — see next entry)
- mcp-server/src/telegram/poller.ts (added `/debug` command handling)
- BUILD_LOG.md

**Result:**
Sending `/debug` to the bot now prints both in-memory Maps (sessions and drafts) to the log and back to the chat.

**Testing / verification:**
`npx tsc --noEmit` and `npm run build` passed; bot restarted and running, ready for the user to try `/debug` live.

**Claude Code token usage:**
75k

**Notes / issues:**
Marked clearly with "TEMPORARY DEBUG HELPER" comments so it's easy to find and remove later.

## 2026-09-17
### Task: Move loose debt-draft files into a proper subfolder

**What I asked Claude Code to do:**
Clean up anything sitting outside a proper subfolder (like the existing `skills/`, `telegram/`, `tools/` convention).

**What Claude Code did:**
Moved the three files that had been added directly under `mcp-server/src/` (`debtDraftStore.ts`, `debtDraftFormat.ts`, `debtDraftValidation.ts`) into a new `mcp-server/src/debtDraft/` subfolder, matching the existing per-concern folder convention, and fixed every import path that referenced them (in themselves, `agent/debtDraftAgent.ts`, and `telegram/poller.ts`). Left the pre-existing loose files (`draftStore.ts`, `draftText.ts`, `reviewMessage.ts`, `index.ts`) untouched since they predate this session and weren't part of the request, and asked the user whether those should be reorganized too.

**Files created/modified:**
- mcp-server/src/debtDraft/debtDraftStore.ts (moved from mcp-server/src/debtDraftStore.ts)
- mcp-server/src/debtDraft/debtDraftFormat.ts (moved from mcp-server/src/debtDraftFormat.ts)
- mcp-server/src/debtDraft/debtDraftValidation.ts (moved from mcp-server/src/debtDraftValidation.ts)
- mcp-server/src/agent/debtDraftAgent.ts (updated import paths)
- mcp-server/src/telegram/poller.ts (updated import path)
- BUILD_LOG.md

**Result:**
Reorganization complete; no behavior change.

**Testing / verification:**
`npx tsc --noEmit` and a clean `npm run build` (after deleting `dist/`) both passed with the new file locations. Re-ran the earlier offline draft/preview/save test (26 assertions) and it still passed fully. (A separate, older scratch test script from the previous task failed, but only because it predates the `tone` field added in the SQLite task and hardcoded an outdated message count — not a regression from this move, and not part of the shipped code.)

**Claude Code token usage:**
18.9k

**Notes / issues:**
None.

2026-09-17
### Task: Fix
Fixing VS Code TypeScript errors from a dependency's stray tsconfig in your Debt Collector project; applied config fixes and rebuilt cleanly. Bot's running again waiting on your test message to confirm Telegram still works.
