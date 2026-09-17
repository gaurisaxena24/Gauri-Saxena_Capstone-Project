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

## 2026-09-17
### Task: Fix VS Code TypeScript errors coming from `node_modules/fast-uri/tsconfig.json`

**What I asked Claude Code to do:**
Fix TypeScript errors showing in VS Code's Problems panel ("Cannot write file .../node_modules/fast-uri/... because it would overwrite input file"), by fixing the root cause in our own TypeScript configuration rather than patching each error individually, without touching `node_modules`, without removing dependencies, and without changing functionality.

**What Claude Code did:**
- Confirmed `npx tsc --noEmit` and `npm run build` were already completely clean from the command line — our own `mcp-server/tsconfig.json` already scopes correctly to `src/**/*` and TypeScript excludes `node_modules` by default, so our actual project build never touches `fast-uri`.
- Identified the real mechanism: `fast-uri` (a transitive dependency pulled in via `ajv`/`ajv-formats`, used by `@modelcontextprotocol/sdk`) ships its own internal `tsconfig.json` with `allowJs`/`checkJs` and no `outDir`, meant only for its own package's dev tooling. VS Code's built-in TypeScript extension auto-detects *every* `tsconfig.json` under the opened workspace folder (via `typescript.tsc.autoDetect`, on by default) — including ones deep inside `node_modules` — and if that config is ever run as a build task, it tries to emit files over its own `.js` sources, producing exactly this "would overwrite input file" (TS5055) error. This shows up in VS Code but not the CLI because it's an editor/task-detection issue, not a problem with our own `tsc` invocation.
- Made the exclusion explicit in `mcp-server/tsconfig.json` (`"exclude": ["node_modules", "dist"]`) — functionally a no-op (already the default) but makes the intent unambiguous.
- Added `.vscode/settings.json` at the repo root with `typescript.tsc.autoDetect: "off"` (stops VS Code from discovering/offering build tasks from any `tsconfig.json` under `node_modules`), `typescript.tsserver.experimental.enableProjectDiagnostics: false` (stops the TS server from proactively running project-wide diagnostics against every discovered config), and `files.watcherExclude`/`search.exclude` for `node_modules`.
- Added `.vscode/tasks.json` defining a single explicit default build task pointing at `mcp-server/tsconfig.json`, so "Run Build Task" always resolves to our own project instead of any ambiguous auto-detected one.
- Did not modify anything inside `node_modules`, did not remove any dependency, and did not change any application logic.

**Files created/modified:**
- mcp-server/tsconfig.json (added explicit `exclude`)
- .vscode/settings.json (new)
- .vscode/tasks.json (new)
- BUILD_LOG.md

**Result:**
Root cause fixed at the configuration level. `npx tsc --noEmit` and a clean `npm run build` both still pass with zero output. The MCP server starts and runs without errors after the change (verified by restarting the detached background process and confirming it stays up with no crash/error output). The user reported the VS Code errors were still visible immediately after the first settings.json change; since these come from either an already-running background task/watcher or a not-yet-reloaded TS server, a VS Code **window reload** ("Developer: Reload Window") or at minimum "TypeScript: Restart TS Server" is needed for a settings/tasks change to take effect — a config file edit alone cannot retroactively stop an already-running background process. This was communicated to the user as the next step to confirm the errors clear.

**Testing / verification:**
- `npx tsc --noEmit` — clean, exit 0.
- `npm run build` (after deleting `dist/` for a clean rebuild) — clean, exit 0.
- Confirmed `mcp-server/node_modules/fast-uri/tsconfig.json` exists and has no `outDir`, matching the exact failure mode described.
- Confirmed no `tasks.json` or `*.code-workspace` file existed anywhere in the repo prior to this fix (ruling out a pre-existing custom task as the cause).
- Restarted the detached bot process (`nohup npm start … & disown`) after the fix; it started cleanly with no errors (only the expected experimental `node:sqlite` warning) and stayed running.

**Claude Code token usage:**
Not available.

**Notes / issues:**
- This is a known, previously-reported issue with `fast-uri`'s own packaged `tsconfig.json` tripping up editors/tools that scan `node_modules` for build configs; it is not a bug in this project's code.
- If the errors persist after a window reload, the next step would be to check VS Code's "Terminal → Show Running Tasks" for a lingering `tsc` watcher and terminate it manually, since only a reload/terminate can stop a task that was already started before this fix was applied.

## 2026-09-17
### Task: Give each agent module and each skill module its own subfolder

**What I asked Claude Code to do:**
"Make the agent a separate folder for itself" (clarified to mean: split `debtinfoAgent.ts` and `debtDraftAgent.ts`, currently sitting together in `agent/`, so each gets its own dedicated subfolder), then the same treatment for the skill files (`debtCollectorSkill.ts` and `debtFormStore.ts`, sitting together in `skills/`).

**What Claude Code did:**
- Noted an unrelated change had happened outside this session: the whole `mcp-server/src/` folder had been renamed on disk to `mcp-server/Source (agent and database)/`, with `tsconfig.json`'s `rootDir`/`include` already updated to match. Flagged this to the user and asked whether to keep it or revert to `src/`; the user chose to keep it as-is, so all work below happened inside that renamed folder.
- Moved `agent/debtinfoAgent.ts` → `agent/debtinfoAgent/debtinfoAgent.ts` and `agent/debtDraftAgent.ts` → `agent/debtDraftAgent/debtDraftAgent.ts`.
- Moved `skills/debtCollectorSkill.ts` → `skills/debtCollectorSkill/debtCollectorSkill.ts` and `skills/debtFormStore.ts` → `skills/debtFormStore/debtFormStore.ts`.
- Fixed every import path affected by the four moves: the two agents' cross-import of each other, the Skill's import of its form store, and the three call sites in `telegram/poller.ts`, plus doc-comment references mentioning the old paths.
- Used plain `mv` (not `git mv`) since the earlier `src` → `Source (agent and database)` rename happened outside git, leaving everything under that folder untracked.

**Files created/modified:**
- mcp-server/Source (agent and database)/agent/debtinfoAgent/debtinfoAgent.ts (moved + import paths fixed)
- mcp-server/Source (agent and database)/agent/debtDraftAgent/debtDraftAgent.ts (moved + import paths fixed)
- mcp-server/Source (agent and database)/skills/debtCollectorSkill/debtCollectorSkill.ts (moved + import paths fixed)
- mcp-server/Source (agent and database)/skills/debtFormStore/debtFormStore.ts (moved + import path fixed)
- mcp-server/Source (agent and database)/telegram/poller.ts (updated import paths to all four moved files)
- BUILD_LOG.md

**Result:**
Each agent and each skill module now lives in its own dedicated subfolder. No behavior change.

**Testing / verification:**
- `npx tsc --noEmit` — clean.
- Clean `npm run build` (after deleting `dist/`) — clean; confirmed compiled output landed at the expected new nested paths (e.g. `dist/agent/debtinfoAgent/debtinfoAgent.js`).
- Restarted the detached bot process; started cleanly with no errors.

**Claude Code token usage:**
Not available.

**Notes / issues:**
The `mcp-server/src` → `mcp-server/Source (agent and database)` rename (not made by me) means this whole source tree is currently untracked by git under its new path (git still shows the old `src/*` files as deleted). Not fixed here since it wasn't part of this request, but worth resolving before the next commit.
