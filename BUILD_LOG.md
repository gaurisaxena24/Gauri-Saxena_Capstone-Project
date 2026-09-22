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

---

*Day summary — Assessment 2: Skill, agent loop, MCP and SQLite persistence*

Date: 17 September 2026
Time spent: ~7.5 hours elapsed (first work ~09:55, last commit 17:23), covering both the Claude Code sessions and my own edits/commits in between
Rough tokens used: ]
Sonnet 5: 11.3k input + 182.2k output
Opus 5: 8 input + 4.5k output
Haiku 4.5: 2.2k input + 17 output
Cache read: 55.8m (Sonnet) + 715.2k (Opus)
Cache write: 357.5k (Sonnet) + 586k (Opus)
Total API cost: $19.68

So the biggest actual generation usage was Sonnet 5 with ~182,200 output tokens.

What shipped:
Verified and hardened the `unhinged-debt-collector` Skill so the debt form triggers on `hi`/`hello`/`hey`/`start`, and restricted it to my own Telegram chat via `TELEGRAM_REVIEWER_CHAT_ID`
Debugged the "bot not responding" problem and proved via direct Telegram Bot API calls that no updates were reaching the bot — the cause was client-side, not a code defect
Refactored the Skill into a pure, Telegram-agnostic state machine that returns structured JSON (`status`, `next_field`, `next_question`, `debt_context`) and is invoked repeatedly by a separate Agent inside a real multi-step loop
Added per-invocation logging as evidence the Agent calls the Skill once per incoming message, ending at `status=complete`
Got the bot running as a detached background process so it keeps answering after the editor session closes
Built the full Temporary Draft → Clean Preview → Human Approval → SQLite pipeline: preview with Save / Make Changes buttons, in-place field editing without redoing the form, shared validation, and an idempotent Save that writes exactly one row to `data/debts.db`
Added a `tone` question to the form and `data/*.db` to `.gitignore`
Added a temporary `/debug` command that dumps the in-memory session and draft state
Reorganised the source tree: debt-draft modules into their own folder, then each agent and each skill module into its own dedicated subfolder
Renamed the working branch to `assesment_2_gauri` (local and remote) and deleted the old remote branch
Fixed the VS Code TypeScript errors originating from `node_modules/fast-uri/tsconfig.json` via explicit `exclude` plus `.vscode/settings.json` and `.vscode/tasks.json`

Verification: `npx tsc --noEmit` and a clean `npm run build` pass; offline test suites (multi-step loop, and 26 assertions covering preview/Save/edit/validation against a real SQLite file) pass; the full flow was exercised live over the real Telegram bot.

## 2026-09-17
### Task: Full project reorganization into agent/, skills/debtCollector/, backend/, frontend/, data/, compiled/

**What I asked Claude Code to do:**
Reorganize the whole project into a specific clean structure — `agent/`, `skills/debtCollector/`, `frontend/`, `backend/{database,debtDraft,telegram,tools,review}/`, `data/`, `compiled/debt-collector-telegram-system/`, with `README.md`/`plan.md`/`BUILD_LOG.md`/`.env`/`.gitignore`/`package.json`/`package-lock.json`/`tsconfig.json` at the true project root — without changing functionality, deleting files, or creating duplicates, updating every broken import and config path, and verifying the project still runs.

**What Claude Code did:**
- Found the project had already been restructured outside this session (by hand) since the last entry: the old `mcp-server/` wrapper was renamed to `debt-collector-telegram-system/` (containing its own `src/`, `compiled-debtcollector-telegram-system/`, `package.json`, `tsconfig.json`, `node_modules`).
- Moved every source `.ts` file (via `git mv`, since they were tracked) out of that wrapper into the requested top-level layout: `agent/debtDraftAgent/`, `agent/debtinfoAgent/`, `skills/debtCollector/debtCollectorSkill/`, `skills/debtCollector/debtFormStore/`, `backend/index.ts`, `backend/database/`, `backend/debtDraft/` (including `draftStore.ts`/`draftText.ts`, exactly as instructed), `backend/telegram/`, `backend/tools/`, `backend/review/reviewMessage.ts`.
- Moved `package.json`, `package-lock.json`, `tsconfig.json` (tracked, via `git mv`) and `node_modules` (untracked, plain `mv`) up to the true project root.
- Moved two documentation files that had been sitting inside the *compiled* output by mistake (`Agent_info.md`, `skill.md`) to sit next to the source they document (`agent/`, `skills/debtCollector/`), and moved the root-level `Agents_DebtCollector` architecture notes file into `agent/` as well.
- Preserved the old build output (rather than deleting it) by moving it wholesale into `compiled/_pre-reorg-build-snapshot/`, then let a fresh `tsc` build populate the correct new-structure output at `compiled/debt-collector-telegram-system/` (which now mirrors `agent/`, `skills/`, `backend/`).
- Rewrote `tsconfig.json` (`rootDir: "."`, `include` covering all four top-level source folders, `outDir: "compiled/debt-collector-telegram-system"`) and `package.json`'s `main`/`start`/`dev` scripts to match.
- Fixed every relative import across all 17 moved files (recomputed by hand for the new nesting depth), plus the two `__dirname`-based runtime path resolutions (`.env` loading in `backend/index.ts`, the SQLite `data/` directory in `backend/database/database.ts`) which needed extra `../` levels because the compiled output is now nested one level deeper (`compiled/debt-collector-telegram-system/backend/...` instead of the old `mcp-server/dist/...`).
- Updated `.vscode/tasks.json` (stale `mcp-server/tsconfig.json` reference) and `.gitignore` (`dist/` → `compiled/`, since the build output folder was renamed).
- Confirmed `README.md`/`plan.md` had no stale path references; left `BUILD_LOG.md`'s own historical entries untouched since they're an accurate record of the structure *at the time*, not something to rewrite.
- `frontend/` was left empty — there are no frontend/UI files in this project to move into it.

**Files created/modified:**
- All 17 source `.ts` files, moved and import paths fixed (agent/, skills/debtCollector/, backend/ subfolders — see git rename list)
- Agent_info.md, skill.md, Agents_DebtCollector (moved to sit next to their respective source)
- package.json, package-lock.json, tsconfig.json, node_modules (moved to project root)
- .vscode/tasks.json (fixed tsconfig path)
- .gitignore (dist/ → compiled/)
- BUILD_LOG.md

**Result:**
Project now matches the requested structure exactly (`agent/`, `skills/debtCollector/`, `backend/{database,debtDraft,telegram,tools,review}/`, `data/`, `compiled/debt-collector-telegram-system/`, docs + config at root). No functionality changed, no files deleted — the pre-reorg build output was preserved under `compiled/_pre-reorg-build-snapshot/` rather than removed. `git status` shows every move as a clean rename (`R`/`RM`), preserving file history.

**Testing / verification:**
- `npx tsc --noEmit` — clean.
- `npm run build` — clean; compiled output correctly lands at `compiled/debt-collector-telegram-system/` mirroring the new `agent/`/`skills/`/`backend/` structure.
- Started the bot from the new location (`npm start`) — clean startup, no errors, confirming `.env` still loads correctly from its new relative path depth.
- Ran a scripted offline smoke test against the newly compiled modules driving a full `hi` → form → preview loop across the `agent/` ↔ `backend/` ↔ `skills/` boundary — passed (person name, amount, and full preview all correct).
- Asked the user to send a live Telegram message to confirm end-to-end; awaiting confirmation.

**Claude Code token usage:**
Not available.

**Notes / issues:**
- `frontend/` exists conceptually in the request but has nothing to contain yet, since this project has no UI code — left uncreated rather than adding an empty placeholder.
- The pre-existing build output under `compiled-debtcollector-telegram-system/` was already git-tracked (unusual for generated output); it was preserved as a renamed snapshot rather than deleted, per instructions, but going forward `compiled/` is gitignored so new builds won't be tracked.

## 2026-09-18
### Task: Fix broken Telegram bot after manual reorg

**What I asked Claude Code to do:**
"can you make the telegram thing work still" — the bot was broken.

**What Claude Code did:**
- Diagnosed that `npm run build` failed with `TS2307: Cannot find module` errors.
- Root cause: the prior manual commit "modified files into folders" (c88146b) renamed `skills/debtCollector/` to `skills/skill/` but left three stale imports pointing at the old path: `agent/debtDraftAgent/debtDraftAgent.ts`, `agent/debtinfoAgent/debtinfoAgent.ts`, and `backend/telegram/poller.ts`.
- Fixed all three import paths to `../../skills/skill/...`.
- Rebuilt (`npm run build`, clean) and started the bot (`npm start`), confirmed the process stayed alive with no crash.

**Files created/modified:**
- agent/debtDraftAgent/debtDraftAgent.ts
- agent/debtinfoAgent/debtinfoAgent.ts
- backend/telegram/poller.ts

**Result:**
Build passes cleanly; bot runs and stays up as a background process. Not yet committed — left for the user to review and commit.

**Testing / verification:**
- `npx tsc`/`npm run build` — clean.
- Started bot, confirmed process alive after ~8s with no errors beyond the expected experimental-SQLite warning.
- Awaiting live Telegram message confirmation from the user.

**Claude Code token usage:**
Not available.

**Notes / issues:**
None.

## 2026-09-18 (2)
### Task: Build the local web app on top of the existing Telegram/MCP system

**What I asked Claude Code to do:**
Build a full local web app (upload a bill → OCR → tag person → pick amount → AI builds context automatically → AI generates a tone-appropriate reminder → review/edit/send via Telegram → history), reusing the existing Skill/Agent/MCP server/database rather than rebuilding, with no fake AI responses and no invented Telegram capabilities.

**What Claude Code did:**
- Inspected the existing repo first: found the MCP stdio server + Telegram long-poller had zero real AI integration (message generation was a plain string template) and a single `debts` SQLite table with no people/bills/history support, and no frontend or HTTP API existed at all.
- Fixed a latent bug (`backend/paths.ts`): `.env`/`data/` path resolution depended on a hardcoded number of `../` segments that only worked for compiled output, not `tsx` — needed for the new `npm run dev`.
- Extended `data/debts.db` additively: new `people`, `bills`, `telegram_contacts`, `users` tables, plus nullable columns added to the existing `debts` table (`person_id`, `bill_id`, `status`, `message`, `telegram_sent`, `context_json`, `source`, …). Old Telegram-flow rows and code are untouched.
- Added `backend/ai/` — a dependency-free Anthropic Messages API client (matching the existing raw-fetch style used for Telegram) for bill vision-OCR and structured tone/message generation. No AI SDK dependency added; `ANTHROPIC_API_KEY` required via `.env`, with a clean "AI not configured" error path (no fake data) when absent.
- Added `backend/api/` — an Express + Multer HTTP API (new deps, justified by the multipart upload requirement), booted from the *same* process as the existing Telegram poller and MCP server so there's still only one long-poller.
- Hooked the existing poller to cache Telegram username→chat_id from real incoming messages, since the Bot API can only ever deliver to a numeric chat_id — "Send via Telegram" resolves a person's username against that cache, falling back to the existing test-mode-to-reviewer-chat pattern when the recipient hasn't messaged the bot yet.
- Built `frontend/` (React + Vite + TypeScript + Tailwind v4): Login (Telegram-username local-dev auth), Dashboard, a 5-step Upload Bill wizard (upload → extracted-and-editable bill info → tag/create person → full/half/custom amount → AI reminder with tone pills/regenerate/edit/send), People list/detail, History list/detail.
- Verified the entire pipeline for real via curl (login, people, bill seeding, debt creation with computed context, manual message edit, a genuine Telegram send that hit the real Bot API, mark-as-paid, dashboard aggregation, static image serving) and visually via a live browser session (Login, Dashboard, People, Person detail, Debt detail all screenshotted and confirmed correct); fixed one polish bug found this way (unformatted bill date on the debt detail page).

**Files created/modified:** see architecture summary given to the user in-session; broadly `backend/paths.ts`, `backend/ai/*`, `backend/api/*`, `frontend/` (entire new app), plus additive changes to `backend/database/database.ts`, `backend/index.ts`, `backend/telegram/{rawApi,poller}.ts`, `tsconfig.json`, `package.json`, `.gitignore`, new `.env.example`.

**Result:** `npm run dev` from the project root runs frontend (`http://localhost:5173`) + API (`:4000`) together. Login/dashboard/people/history/manual debt flow and real Telegram sending are fully working now. Bill OCR and AI message generation are wired correctly but need the user to add their own `ANTHROPIC_API_KEY` to `.env` — untested against a live model in this session since no key was available.

**Testing / verification:** `npm run build` (backend `tsc`) and `frontend`'s `tsc -b && vite build` both clean. Full API pipeline exercised via curl including a real Telegram delivery. Live browser session via Claude in Chrome confirmed Login/Dashboard/People/Person-detail/Debt-detail render correctly with real seeded data and no console errors; upload flow's AI-not-configured error path confirmed to render correctly end-to-end.

**Claude Code token usage:** Not available.

**Notes / issues:**
- One test person ("Rahul") and one test debt were seeded while verifying the pipeline end-to-end — left in place pending the user's confirmation on whether to clear it before a demo.
- Bill OCR / AI message quality cannot be confirmed live until `ANTHROPIC_API_KEY` is added — the error-handling path is confirmed correct, but real model output is unverified in this session.

## 2026-09-18 (3)
### Task: Diagnose xAI key, add multi-provider Groq support, fix orphaned-upload bug, clean up project

**What I asked Claude Code to do:**
Diagnose why the Grok/xAI connection still failed after adding a key; separately, add support for the user's real Groq key ("make it one env"); update plan.md to reflect reality; audit and remove unused/extra files while keeping frontend/backend/agent/skills/README/BUILD_LOG/plan.md.

**What Claude Code did:**
- Diagnosed the xAI failure by testing directly against xAI's raw API (bypassing all app code): found `.env` had a duplicated variable name (`XAI_API_KEYXAI_API_KEY=`) so the key was never actually loaded, a stale invalid key saved via the Settings UI was permanently shadowing `.env` regardless, and once both were fixed, a leading space in the value was also stripped — proved via direct `curl` against `api.x.ai/v1/models` that the final key value itself was still rejected as invalid by xAI's own servers, independent of any app code.
- Also fixed a real bug found in the process: `AiRequestError`/provider failures were being swallowed into a generic "Couldn't read that bill" message with no logging — now the actual provider error (e.g. "Incorrect API key provided") is logged and shown.
- Added `tsx watch` to the dev script — backend changes weren't hot-reloading before, which had been silently hiding earlier fixes.
- User then replaced `.env` to use `GROQ_API_KEY` (Groq Inc., the fast-inference company — distinct from xAI's "Grok") instead. Added `backend/ai/providers/groq.ts` as a fifth provider. Verified the key directly against Groq's API: valid, but this account has no vision-capable model available (only text/audio models) — verified by testing an actual chat completion. Added a `supportsVision` flag to the `AiProvider` interface so Settings labels Groq "text-only" and the bill-upload picker only offers vision-capable, configured providers, rather than silently failing every time Groq is picked.
- Found and fixed a real bug while auditing: bill image uploads that failed extraction (all 29 of the user's real attempts, from before the key was fixed) were saved to `data/uploads/` but the code only inserted a DB row on success — meaning every failed attempt left an orphaned image file forever. Fixed `bills.ts` to delete the uploaded file on any failure path.
- Cleaned up: 29 orphaned upload images (none referenced by any DB row, confirmed before deleting), the old `compiled/_pre-reorg-build-snapshot/` build snapshot, `.DS_Store`, and all of my own test data from prior sessions (2 test people, 2 test bills, 2 test debts, 1 test login) — leaving only the user's real 3 original Telegram-flow debts and real `gauri` login untouched.
- Updated `plan.md` with a "Status" section at the top mapping the original MVP plan to what's actually shipped, and annotated Section F's "out of scope" list with what's since been implemented, without rewriting the original reasoning.
- Updated `agent/Agent_info.md` and `agent/Agents_DebtCollector` with status notes clarifying which parts of the originally-planned multi-agent design became real separate code vs. were collapsed into a single AI call, since the original docs described an aspirational design that was never fully built as separate agent files.
- Updated `README.md` with a short "how to run it" section; updated `.env.example` to include `GROQ_API_KEY`/`GROQ_MODEL`.

**Files created/modified:** `backend/ai/providers/groq.ts` (new), `backend/ai/types.ts`, `backend/ai/registry.ts`, `backend/ai/keyStore.ts`, `backend/ai/providers/{anthropic,gemini,openai,grok,openAiCompatible}.ts`, `backend/api/routes/bills.ts`, `.env` (formatting fixes), `.env.example`, `package.json` (`tsx watch`), `plan.md`, `agent/Agent_info.md`, `agent/Agents_DebtCollector`, `README.md`, `frontend/src/{api/client.ts,pages/Settings.tsx,pages/UploadBillFlow.tsx}`.

**Files/data removed:** `compiled/_pre-reorg-build-snapshot/` (dead build output, was git-tracked — deletion is staged, not committed), `.DS_Store`, 29 orphaned upload images, and my own seeded test rows (people/bills/debts/user) from `data/debts.db`.

**Result:** Groq is a working, correctly-labeled text-only provider; xAI/Anthropic/Gemini/OpenAI remain available for vision once a valid key is added. The orphaned-file bug is fixed going forward. Project state matches the user's real usage (3 real Telegram debts) with no leftover test clutter.

**Testing / verification:** `npm run build` (backend) and frontend `tsc -b && vite build` both clean. Verified via direct `curl` against both xAI's and Groq's real APIs (independent of app code) that: the xAI key is genuinely invalid, the Groq key is genuinely valid, and Groq's account has no accessible vision model. Verified via live browser screenshots that Settings correctly shows Groq as "Connected / text-only" and the Upload page correctly refuses to offer it for bill reading with an accurate, actionable message.

**Claude Code token usage:** Not available.

**Notes / issues:**
- The user still needs a valid key for a vision-capable provider (Anthropic/Gemini/OpenAI, or a working xAI key) before bill-photo reading will work end-to-end. Groq now works correctly for what it *can* do (nothing yet reachable in this app's flow uses text-only generation independently of a bill, so practically Groq is "connected but not yet exercised" until either a vision key is added elsewhere or a future feature uses text-only generation directly).
- `git status` shows the `compiled/_pre-reorg-build-snapshot/` deletion staged but not committed — left for the user to review/commit, per instructions not to commit without being asked.

## 2026-09-18 (4)
### Task: Rebuild as a general Expense tracker (not bill-only), Groq-only, manual entry, OCR fallback, Telegram verification

**What I asked Claude Code to do:**
Change the core object from "bill" to "Expense" so any payment (manual entry, restaurant bill, Google Pay/UPI screenshot, receipt) goes through one system; make Groq the only AI provider (no in-app key management); add automatic OCR fallback when Groq has no vision model; require genuine Telegram verification before sending (not just a typed username/phone); restructure into a single Agent + named Skills; remove all example/demo data; keep the message-preview/approval separation from before.

**What Claude Code did:**
- Audited the existing web app (built over the prior 3 sessions) before changing anything: found a working multi-provider (Anthropic/Gemini/OpenAI/xAI/Groq) bill-reading system with a Settings page, a `bills`+`debts`-additive-columns schema, and message preview/send separation already correctly enforced.
- Removed the entire multi-provider system (Settings page/route, `backend/ai/providers/*`, `backend/ai/registry.ts`, `backend/ai/keyStore.ts`, the `ai_keys` DB table) — Groq is now the only provider, configured solely via `GROQ_API_KEY` in the one root `.env`, with no key input anywhere in the frontend.
- Replaced the bill-only data model with a general Expense model: new `expenses` (source MANUAL|IMAGE, merchant, date, total, currency, tax, tip, category, payment method, transaction reference, description, line items, visible names, image), `expense_debts` (one row per person's share — multiple rows per expense is how more than one person could be attached later, without hard-coding a single-person assumption), and `reminders` (permanent send-attempt history, SENT/FAILED) tables. Dropped the now-empty, fully-superseded `bills` table. The original `debts` table (Telegram-only flow) and its rows were left completely untouched.
- Added a real OCR fallback (`tesseract.js`, a new dependency — no external API/key) in `skills/expenseReaderSkill.ts`: tries Groq Vision only if `GROQ_VISION_MODEL` is explicitly set (most Groq accounts don't have one — verified directly against the real API in a prior session), otherwise runs local OCR and feeds the extracted text to Groq's text model. Tested end-to-end with a real generated receipt image: OCR correctly read merchant, date, total, tax, payment method, transaction reference, and all line items, which Groq then structured correctly.
- Restructured into the requested architecture: `agent/debtCollectorAgent.ts` (single orchestrating agent) + `skills/{profileSkill,expenseReaderSkill,debtCalculationSkill,debtSkill,contextSkill,messageDraftSkill,telegramSkill,reminderSkill}.ts`, added as new top-level files alongside (not replacing) the existing Telegram-only flow's `agent/debtDraftAgent/`, `agent/debtinfoAgent/`, and `skills/skill/` — those remain untouched and still work.
- Implemented genuine Telegram verification: `people` gained `phone_number`, `telegram_user_id`, `telegram_chat_id`, `telegram_verified` columns. A phone number or typed username is never treated as proof; a person is only marked verified when the existing Telegram poller (`backend/telegram/poller.ts`) actually observes an incoming message from that exact username — the only proof the Bot API can give — which also captures their real chat ID. `skills/telegramSkill.ts` refuses to send to anyone not verified, with a clear, actionable error rather than a silent fallback.
- Found and fixed a real bug during testing: the newly-built AI context was computed at debt-creation time but never actually persisted (`JSON.stringify(null)` produces the truthy string `"null"`, which passed the "has context" falsy-check but meant Groq received no real facts) — first end-to-end test produced a technically-successful but context-free, generic message. Fixed by writing the real computed context back to the debt row immediately after creation; re-tested and confirmed the regenerated message correctly referenced the real amount, category, and history.
- Removed all example/demo data: the app now starts with genuinely empty People/Expenses/Debts/Reminders and shows "No X yet." states rather than seeded names.
- Rebuilt the entire frontend around Expenses: `AddExpenseFlow.tsx` starts with an explicit "Upload screenshot/receipt" vs "Enter manually" choice (manual entry never calls Groq), new `Expenses`/`ExpenseDetail`/`Debts`/`Reminders` pages, `People`/`PersonDetail` updated with phone number and a Telegram-verification status section with instructions, `DebtDetail` shows send history (SENT/FAILED) per attempt. Nav is now Dashboard/People/Expenses/Debts/Reminders + a persistent "+ Add Expense" button.

**Files created:** `backend/ai/groqClient.ts`, `agent/debtCollectorAgent.ts`, `skills/{profileSkill,expenseReaderSkill,debtCalculationSkill,debtSkill,contextSkill,messageDraftSkill,telegramSkill,reminderSkill}.ts`, `backend/api/routes/{expenses,reminders}.ts`, `frontend/src/pages/{AddExpenseFlow,Expenses,ExpenseDetail,Debts,Reminders}.tsx`.

**Files removed:** `backend/ai/providers/*`, `backend/ai/registry.ts`, `backend/ai/keyStore.ts`, `backend/ai/extractBill.ts`, `backend/ai/generateReminder.ts`, `backend/api/routes/{settings,bills,debtMapper}.ts`, `frontend/src/pages/{Settings,UploadBillFlow,History,DebtDetail-old}.tsx` (DebtDetail was rewritten, not just deleted).

**Result:** Manual expense entry works without touching Groq at all (verified live by the user themselves mid-session). Image entry correctly falls back to real OCR + Groq text (Groq Vision isn't available on this account — verified directly, not assumed) and extracts accurate structured data from a real test receipt. Telegram sending is genuinely blocked until a person is verified, and correctly unblocks and delivers once verification is simulated/real. Reminder history records both FAILED (blocked) and SENT attempts accurately. Dashboard/People/Expenses/Debts/Reminders all reflect real data with correct empty states.

**Testing / verification:** Backend `tsc` and frontend `tsc -b && vite build` both clean. Full pipeline exercised via curl: manual expense creation, FULL/HALF debt-share math, message generation (caught and fixed the context-persistence bug above), manual edit, blocked send while unverified (403 + clear message), a genuine Telegram send after simulating verification (real `telegram_message_id` returned), reminder history showing both the failed and successful attempts, mark-as-paid, and dashboard/list aggregation. A real synthetic receipt image was generated and run through the actual OCR→Groq pipeline with correct extraction of every field. Live browser screenshots confirmed the Add Expense choice screen, empty People/Dashboard states, and the user's own real manually-entered expense rendering correctly.

**Claude Code token usage:** Not available.

**Notes / issues:**
- Groq Vision is still unavailable on this account (`GROQ_VISION_MODEL` unset) — OCR fallback is the active path for image entry, and works correctly, but a true vision-based read hasn't been (and can't currently be) tested.
- Multi-person splitting on one expense is supported by the data model (`expense_debts.expense_id` isn't unique) but the UI still only attaches one person per expense at a time, per the requested MVP scope.

## 2026-09-18 (5)
### Task: Diagnose failed Telegram verification, add code-based verification, retire the old conversational flow, update plan

**What I asked Claude Code to do:**
Figure out why a newly-added person ("Sara") couldn't be verified after saying "hi" to the bot; separately, update plan.md and consolidate the architecture to a single skill-based agent, removing the old Telegram-only conversational agents since they're no longer used.

**What Claude Code did:**
- Diagnosed the verification failure as two real, separate bugs: (1) `PATCH /api/people/:id` returned a payload missing `debts`/`reminders`, and the frontend replaced its whole `person` state with that response, crashing `PersonDetail` the moment it rendered `person.debts.length` on `undefined`; (2) the actual blocker — added temporary diagnostic logging and found Sara's Telegram account has **no public @username at all**, so the Bot API gives no username to match against, only a numeric id. Username-based verification could never have worked for her no matter how many times she messaged the bot.
- Fixed the crash by sharing one `buildPersonDetail()` helper between the GET and PATCH person routes.
- Added a second, independent verification path for accounts with no public username: a one-time 6-character code generated per person (backfilled for existing people), shown on their profile page, sent to the bot as `/verify CODE` (or the bare code). The poller recognizes this regardless of the sender's username and links their real chat ID. Verified end-to-end using Sara's actual chat ID from her real earlier message — she is now genuinely verified and successfully received a real Telegram reminder.
- Also found and fixed a related bug while investigating: the poller's startup backlog-clearing logic discarded any messages received while the dev server was restarting (which happens often during active development) without recording them for verification at all — meaning a genuine verification attempt could be silently lost across a restart. Fixed so backlog messages still count for verification, just without replaying the old conversational flow.
- Per explicit confirmation, removed the retired Telegram-only conversational flow entirely: `agent/debtinfoAgent/`, `agent/debtDraftAgent/`, `skills/skill/debtCollectorSkill/`, `skills/skill/debtFormStore/`, and the debt-draft-preview modules under `backend/debtDraft/` that only that flow used (`debtDraftFormat.ts`, `debtDraftStore.ts`, `debtDraftValidation.ts`). Kept everything the *other* Telegram feature (the MCP server's `create_debt_reminder_draft`/`get_draft_status` tools, still a separate, still-used capability) depends on: `backend/debtDraft/draftText.ts`, `backend/debtDraft/draftStore.ts`, `backend/review/reviewMessage.ts`, and the MCP tools themselves — none of that was touched. Removed the now-orphaned `saveDebt()`/`SaveDebtInput`/`SavedDebtRecord` from `database.ts` (its only caller was the removed flow) — the `debts` table itself and its real historical rows were left completely untouched.
- Simplified `backend/telegram/poller.ts` accordingly: dropped the imports/calls into the removed modules and the temporary `/debug` command (which only ever inspected that flow's internal state).
- Updated `plan.md`, `agent/Agent_info.md`, and `README.md` to reflect that the conversational flow is retired (historical data kept) and that the project now has exactly one agent (`agent/debtCollectorAgent.ts`) built entirely from the `skills/*.ts` modules, with no agent logic that doesn't route through a skill.

**Files removed:** `agent/debtinfoAgent/`, `agent/debtDraftAgent/`, `skills/skill/` (entire folder), `backend/debtDraft/{debtDraftFormat,debtDraftStore,debtDraftValidation}.ts`.

**Files modified:** `backend/database/database.ts` (verification code column + functions, removed `saveDebt`), `backend/telegram/poller.ts` (verification-by-code, backlog fix, removed retired-flow wiring), `backend/api/routes/people.ts` (shared detail-builder bugfix), `frontend/src/{api/client.ts,pages/PersonDetail.tsx}`, `plan.md`, `agent/Agent_info.md`, `README.md`.

**Result:** Verification now genuinely works for every Telegram account, with or without a public username. The person-profile crash is fixed. The project has exactly one real agent, skill-based throughout, with no dead/competing agent code left. The MCP server's separate Telegram draft/approval tools are confirmed untouched and still intact.

**Testing / verification:** Backend and frontend both build clean after every change. Full grep across the repo confirmed zero remaining references to any removed file/symbol outside historical BUILD_LOG entries. Restarted the full dev stack and confirmed the poller starts without error, the API responds, and Sara's real verification/send history persisted through the refactor. The code-verification path was tested with Sara's actual real chat ID (captured from her genuine earlier message) and confirmed by a real Telegram delivery, not a simulation.

**Claude Code token usage:** Not available.

**Notes / issues:** None outstanding. The MCP-tool-driven Telegram draft/approval flow (separate from the removed conversational flow) was not exercised in this session since it requires a live MCP host to invoke it — its code was left untouched and still compiles/imports correctly.

## 2026-09-18 (6)
### Task: Base the reminder message on person description + relationship + expense context + desired action

**What I asked Claude Code to do:**
Change how the AI generates the final reminder so it's a genuine synthesis of (1) a description of the person's personality/behavior, (2) the relationship, and (3) the expense/debt facts — not a generic template — plus support an optional "what do you want them to do?" field. Keep everything else (Telegram, database structure, agent, other features) intact; make the smallest changes necessary.

**What Claude Code did:**
- Inspected and confirmed the exact responsibility of each layer first: form state (`AddExpenseFlow.tsx`, `People.tsx`/`PersonDetail.tsx`), image/expense extraction (`skills/expenseReaderSkill.ts`), debt state (`backend/database/database.ts`, `skills/debtSkill.ts`), message generation (`skills/messageDraftSkill.ts`, `skills/contextSkill.ts`, `backend/ai/types.ts`), and Telegram sending (`skills/telegramSkill.ts`, unrelated to this change and left untouched).
- Found the actual gap: a person's `notes` field already existed in the database but was **never included** in the AI's context object — the "person description" input the user wanted was already collectable but silently discarded before reaching the model. Relationship was already flowing through correctly.
- Added `share_mode`, `additional_context`, `desired_action` columns to `expense_debts` (additive, existing rows unaffected) so which of full/half/custom a debt represents, and the two new optional fields, persist with it and feed the same context on every regenerate/tone-change rather than being asked for again.
- Extended `ReminderContext` (`backend/ai/types.ts`) with `person.description`, `debt.expenseTotal`, `debt.shareMode`, `debt.additionalContext`, `debt.desiredAction`, and rewrote `REMINDER_SYSTEM_PROMPT` to explicitly instruct the model that person description + relationship must shape *how* the message is written (casualness, teasing, directness, realistic language between these two specific people) while the expense facts remain the factual backbone — and that `desiredAction`, when set, is what the message must actually ask for.
- `skills/contextSkill.ts` now builds all of this from the database; `agent/debtCollectorAgent.ts`'s `attachPersonToExpense` now accepts and persists `additionalContext`/`desiredAction` alongside the share mode.
- Frontend: `AddExpenseFlow.tsx` gained an "Additional context" textarea and a "What do you want them to do?" preset-or-custom picker on the amount step, and a "Describe them" field on the inline add-person form (also relabeled the standalone People/PersonDetail "Notes" fields to make clear they shape reminder tone). `DebtDetail.tsx` now shows the share/description/context/desired-action actually used, for transparency.
- Separately, per the request to keep image input working gracefully: `agent/debtCollectorAgent.ts` and the `/expenses/extract` route now surface the `extractionFailed` flag (already computed by the reader skill from a prior session) all the way to the frontend, which shows a clear "we couldn't read that image, please fill it in yourself" notice on the review step instead of silently showing a blank form.
- Verified the core requirement directly: created two people with contrasting descriptions/relationships (a chaotic best friend vs. a formal colleague), attached the identical expense/debt/desired-action/forced-tone to both, and confirmed the two generated messages were genuinely different in voice — teasing and casual for one, formal and polite for the other — while both correctly stated the same facts and the same requested action.

**Files modified:** `backend/database/database.ts`, `backend/ai/types.ts`, `skills/contextSkill.ts`, `skills/debtSkill.ts`, `agent/debtCollectorAgent.ts`, `backend/api/routes/{debts,expenses}.ts`, `frontend/src/{api/client.ts,pages/AddExpenseFlow.tsx,pages/People.tsx,pages/PersonDetail.tsx,pages/DebtDetail.tsx}`. Telegram sending, the MCP server, and the retired-flow cleanup from earlier sessions were not touched.

**Testing / verification:** Backend and frontend both build clean. Full end-to-end test via curl: two contrasting people, identical expense/debt facts, identical forced tone — the generated messages differed exactly as intended (casual/teasing vs. formal/polite) while both stayed factually accurate and honored the requested action ("send it today"). Test data cleaned up afterward.

**Claude Code token usage:** Not available.

**Notes / issues:** None outstanding.

## 2026-09-18 (7)
### Task: One agent per skill, coordinated by the Main Agent

**What I asked Claude Code to do:**
"Make the agents for each skill" — add a dedicated agent for each of the 8 skills, rather than having debtCollectorAgent.ts call the skills directly.

**What Claude Code did:**
- Clarified scope first since this could mean either "replace the Main Agent with 8 flat agents" or "keep the Main Agent, add a layer of per-skill agents beneath it" — confirmed the latter, matching the original Main/Debt/Store/Message/Telegram-role design more closely (now with 8 more granular roles instead of 5).
- Added `agent/{profileAgent,expenseReaderAgent,debtCalculationAgent,debtAgent,contextAgent,messageDraftAgent,telegramAgent,reminderAgent}.ts` — each a documented, addressable interface over exactly one matching skill.
- Rewrote `agent/debtCollectorAgent.ts` (Main Agent) so it no longer imports any `skills/*.ts` file directly — every operation now goes through the matching per-skill agent. Its public function signatures (what the API routes call) are unchanged, so no route file needed to change.
- Updated `agent/Agent_info.md`, `agent/Agents_DebtCollector`, and `plan.md` to describe the real structure: one Main Agent, one agent per skill, each agent owning exactly one skill underneath it.

**Files created:** 8 new files under `agent/` (listed above).

**Files modified:** `agent/debtCollectorAgent.ts`, `agent/Agent_info.md`, `agent/Agents_DebtCollector`, `plan.md`.

**Result:** Same external behavior, cleaner internal layering — the Main Agent is now purely an orchestrator over named agents, and each agent is a stable, addressable unit that could later gain its own logic (retries, validation, etc.) without touching its skill.

**Testing / verification:** Backend and frontend both build clean. Ran a full regression through the new chain via curl — create person → manual expense → create debt → generate message (real Groq call) → mark paid — all succeeded through debtCollectorAgent → the new per-skill agents → the existing skills → the database, with no behavior change. Test data cleaned up afterward.

**Claude Code token usage:** Not available.

**Notes / issues:** The API routes (`backend/api/routes/*.ts`) still import some skills directly for simple read/list operations that debtCollectorAgent doesn't expose (e.g. listing all people/expenses/debts). Only the agent layer itself was restructured, per the specific question that was confirmed — routing every API endpoint through the agent layer too would be a reasonable follow-up if full consistency end-to-end is wanted.

## 2026-09-18 (8)
### Task: Clean up the Expense detail page

**What I asked Claude Code to do:**
Clicking into an expense from the Expenses list looked like a text file, not clean like the rest of the app.

**What Claude Code did:**
- Found the real culprit using actual data already in the app: for image-derived expenses, when the model doesn't produce a proper `description`, the code fell back to `raw_context` — which the model sometimes filled with a full multi-line OCR transcription of the receipt (verified directly against a real expense in the database, e.g. an entire scanned Cambodia restaurant invoice dumped as one field). Rendered on the page, that's exactly what looked like a text file.
- Rewrote `frontend/src/pages/ExpenseDetail.tsx`: a hero card (merchant, amount large, date, source badge), a receipt-style image, a clean two-column facts grid (fixing an invalid `dt`/`dd`-outside-`dl` markup bug in the process), an items list, and — for the long-text case — a distinct "Note" card that truncates to 3 lines with a "Show more" toggle instead of sprawling across the page.
- Tightened the extraction prompt (`backend/ai/types.ts`) so `description`/`raw_context` are explicitly asked for as short summaries, not transcriptions, and added a defensive 300-character cap in `mapRawExtractionToExpense` regardless of what the model returns, as a second line of defense.

**Files modified:** `frontend/src/pages/ExpenseDetail.tsx`, `backend/ai/types.ts`.

**Result:** Verified live against the actual offending real expense in the database (a scanned restaurant invoice whose OCR dump had been shown in full) — it now renders as distinct, well-organized cards with the raw text properly contained and collapsible.

**Testing / verification:** Frontend and backend both build clean. Confirmed visually in the browser against real user data (not synthetic test data) that the specific "text file" case is fixed.



**Notes / issues:** None outstanding.

## 2026-09-19
### Task: Richer person memory + genuinely human-sounding reminders

Make the system remember a person across separate debts (without merging old and new debts together) and rewrite message generation so reminders read like a real text from a friend, not four AI-template tones.

**What Claude Code did:**
- Inspected the existing architecture first, as asked, before changing anything: `people`/`expense_debts`/`reminders` (`backend/database/database.ts`) already store a persistent per-person record (matched by Telegram username) with one row per debt and a full reminder audit log; the person picker in `AddExpenseFlow.tsx` already reuses an existing person rather than re-asking their relationship/description; and `skills/contextSkill.ts` already fed some of this into the AI. So the real gap was narrower than "add person memory from scratch": the AI's context only carried *counts* (`previousDebts`, `previousReminders`) — never the actual other unpaid debts or which tone was used last — so it couldn't reference "the other thing they owe for" or continue an established dynamic, and had no way to keep escalating consistently across reminders.
- Extended `ReminderContext.history` (`backend/ai/types.ts`) with `lastReminderTone` (the tone actually used the last time a reminder was sent to this person, from the real `reminders` row, or `null`) and `otherOpenDebts` (this person's other currently-unpaid debts as real `{amount, reason, daysOutstanding}` facts, capped at 5, excluding the debt being messaged about). `skills/contextSkill.ts` computes both purely from existing rows — no new tables, no invented data.
- Rewrote `REMINDER_SYSTEM_PROMPT` and `buildReminderPrompt` to (a) explicitly tell the model how to use this history — first-ever reminders get no faked familiarity, a later one to a close relationship can be more blunt/tired, and an existing other debt can be acknowledged naturally but must never be added into the amount being asked for — and (b) push much harder on sounding like an actual text message: contractions and imperfect grammar/punctuation are explicitly framed as more natural rather than mistakes, greetings/sign-offs are dropped unless the relationship needs them, corporate phrasing ("kindly", "outstanding balance", "I hope this finds you well") is explicitly banned, length/structure must vary between messages, and regenerating must produce a genuinely different structure rather than a reworded sentence.
- The four escalation tones (Casual/Funny/Passive-Aggressive/Unhinged) are unchanged as a set, but the prompt now treats them as one person's texting voice shifting register, not four separate templates.
- Mirrored the two new `history` fields into the frontend's `ReminderContext` type (`frontend/src/api/client.ts`) and surfaced them on the debt detail page (`DebtDetail.tsx`: "Tone last used" row, "Also owes for: …" line) so the memory actually being used is visible, not just internal.
- Confirmed no re-asking was needed on the input side: the person step in `AddExpenseFlow.tsx` already only asks name/relationship/description once, when a person is first created, and reuses the saved person for every later debt — nothing had to change there.
- Documented all of this in `README.md` (new "Person memory" and "Human-sounding messages" sections).

**Files modified:** `backend/ai/types.ts`, `skills/contextSkill.ts`, `frontend/src/api/client.ts`, `frontend/src/pages/DebtDetail.tsx`, `README.md`, `BUILD_LOG.md`.

**Result:** Verified against real Groq calls, not assumptions.

**Testing / verification:** Backend `tsc --noEmit` and frontend `tsc -b && vite build` both clean; full project `npm run build` clean. Ran the full pipeline live via curl against the real Groq API:
1. Created a new person (Rahul, close friend, "always forgets to pay until reminded, jokes around a lot") → person record created.
2. Created a ₹500 "dinner" debt for him, generated a message ("hey Rahul, that 500 INR dinner is still waiting for its rescue mission 😅…"), then seeded one SENT reminder (tone "Funny") to simulate prior history.
3. Created a *second*, separate ₹800 "concert tickets" debt for the same person. Confirmed via `GET /debts/:id` that the app recognized him as the same person (reused relationship/description) while keeping the ₹500 debt as its own untouched row (`history.previousDebts: 1`, `otherOpenDebts: [{amount:500, reason:"dinner"}]`) rather than merging or overwriting it, and correctly carried `lastReminderTone: "Funny"` forward.
4. Generated the message for the second debt: it asked for exactly ₹800, naturally mentioned the outstanding ₹500 dinner without adding it in ("…don't forget the 500 ₹ dinner cash either"), and kept the same joking voice — a genuinely different message from the first, not a template reuse.
5. Created an unrelated second person (Priya, coworker, no description, no history) with a ₹300 debt: context correctly showed all-zero history and `lastReminderTone: null`, and the generated message ("Just a heads up, the 300 INR from lunch is still pending…") was more measured/polite and invented nothing, in clear contrast to Rahul's messages.
6. Regenerated Rahul's dinner reminder: produced a genuinely different phrasing ("yo, that 500 INR dinner is still chilling in my account…") at the same tone, not a reworded duplicate.
7. Confirmed existing behavior is unchanged: sending to an unverified person is still blocked with the same error, and marking a debt paid still works.
All test people/expenses/debts/reminders were deleted from `data/debts.db` afterward — the real user's existing data was untouched.


**Notes / issues:** `otherOpenDebts` is capped at 5 entries for prompt size — not expected to matter in practice, but worth revisiting if someone ever has many simultaneous open debts with the same person.

## 2026-09-19 (2)
### Task: Line-item bill extraction + item-selection UI

**What I asked Claude Code to do:**
Process bill screenshots at the individual line-item level instead of just the total, since the existing Groq vision/OCR flow "is not reliably extracting" — diagnose the real pipeline first, fix it, then let the user select/edit/add specific items and split just those (with tax/service/discount handled explicitly) rather than always billing the whole receipt, and thread the actual selected items through to person memory and message generation.

**What Claude Code did:**
- Diagnosed before changing anything, per the checklist given (upload handling, base64/MIME, Groq request, model config, response parsing, JSON extraction, error handling, env vars). Found two real, separate bugs:
  1. **`.env`'s `GROQ_VISION_MODEL=qwen/qwen3.6-27b` was a typo for the real model `qwen/qwen3.8-27b`** — verified directly against Groq's `/v1/models` endpoint and a raw chat-completions call, which returned `model_not_found` for the typo'd id. Every single vision call was silently failing and falling back to noisy Tesseract OCR (the code already had this fallback, so nothing crashed — it just never actually used vision). Fixed in `.env` and `.env.example`.
  2. **The extraction schema never asked for or mapped line items at all**, even when vision *did* work: `RawExpenseExtraction` had no `items`/`tax`/`service_charge`/`discount` fields, and `mapRawExtractionToExpense` always left `lineItems: []`. This was the deeper reason itemized bills were never actually itemized, independent of the model-id bug.
- Rewrote the extraction contract in `backend/ai/types.ts`: `RawExpenseExtraction` now asks for `items[]` (name/quantity/unit_price/total), `subtotal`/`tax`/`service_charge`/`discount`/`grand_total`, and a `confidence` (0-1) score; `EXPENSE_SYSTEM_PROMPT`/`EXPENSE_USER_PROMPT` explicitly instruct the model to extract every line item separately, never invent a name/price/item, use null for anything unreadable, and set confidence low (not guess) on a blurry/cropped/tilted image. `mapRawLineItem` never invents a line total — uses the model's stated total, derives quantity×unitPrice only when both are known, otherwise leaves it `0` with a new `uncertain: true` flag so the UI can flag it rather than silently trusting a fabricated number.
- Extended `Expense`/`ExpenseLineItem` (both `backend/database/database.ts` and mirrored in `frontend/src/api/client.ts`) with `subtotal`/`serviceCharge`/`discount`/`confidence` and richer line items (`id`/`quantity`/`unitPrice`/`uncertain`), as new additive DB columns (`addColumnIfMissing`, existing rows unaffected). Added `expense_debts.selected_items_json` — the specific item(s) *this* debt covers (e.g. `[{"name":"Chicken Biryani","amount":500}]`), separate from the bill's full item list, so multiple people/debts against the same bill can each cover a different subset without ever touching each other's amount.
- Threaded `selectedItems` through `backend/api/routes/debts.ts` → `agent/debtCollectorAgent.ts` → `agent/debtAgent.ts` → `skills/debtSkill.ts` → `createExpenseDebt`, and surfaced it back out via `skills/contextSkill.ts` as `ReminderContext.debt.items` — real, stored facts only. Extended `REMINDER_SYSTEM_PROMPT`/`buildReminderPrompt` so the model may naturally reference what a debt is actually for (e.g. "your share of the biryani and the coke") using only those exact items, never inventing others, and never substituting the bill's original item prices for the (possibly corrected/split) `debt.amount` it must actually ask for.
- Bumped `EXTRACTION_MAX_TOKENS` from 2048 to 3072 in `skills/expenseReaderSkill.ts` — the old budget was tuned for the flat pre-item schema and could truncate a many-item receipt's JSON before it finished.
- Added dev-only diagnostic logging (`NODE_ENV !== "production"`, tagged `[expense-extract]`/`[groq]`, never logging the API key) at every stage from the debugging checklist: upload received (name/mimetype/size) and MIME resolution in `backend/api/routes/expenses.ts`; which vision model is configured, the raw model response, and the mapped item/total/confidence in `skills/expenseReaderSkill.ts`; the model id and request shape in `backend/ai/groqClient.ts`.
- New item-selection UI in `frontend/src/pages/AddExpenseFlow.tsx`: a new `"items"` step (only entered for an image-derived expense that actually has line items — manual entries and non-itemized screenshots go straight to the amount step exactly as before) with a checkbox per item, inline-editable name/quantity/unit price/line total, delete, "+ Add item", running "Selected items total" vs. "Bill total", a low-confidence warning banner, and per-item highlighting when the model flagged a price as `uncertain`. When the bill has tax/service charge/discount, a follow-up question lets the user choose "included proportionally" / "excluded" / "manually adjust" and shows the resulting math live. A "Use whole bill amount instead" escape hatch skips itemization entirely for bills the user doesn't want to split. The existing "amount" step now branches: itemized flows get a 4-way split (entire selected amount / half / custom % / custom amount) computed against the selected-and-tax-adjusted total and submitted as `mode: "CUSTOM"` with the computed number (so `debtCalculationAgent`/`computeShare` needed zero changes — `CUSTOM` already just takes the exact amount given); non-itemized flows keep the original FULL/HALF/CUSTOM-of-the-whole-bill UI completely unchanged.
- Person memory needed no new plumbing: the person step already recognizes an existing person from the list without re-asking anything, and `attachPersonToExpense` already always creates a new `expense_debts` row rather than merging into an old one — confirmed this explicitly in testing (below) rather than assuming it.

**Files created:** none (all additive changes to existing files).

**Files modified:** `.env`, `.env.example`, `backend/ai/types.ts`, `backend/ai/groqClient.ts`, `backend/database/database.ts`, `skills/expenseReaderSkill.ts`, `skills/debtSkill.ts`, `skills/contextSkill.ts`, `agent/debtAgent.ts`, `agent/debtCollectorAgent.ts`, `backend/api/routes/expenses.ts`, `backend/api/routes/debts.ts`, `frontend/src/api/client.ts`, `frontend/src/pages/AddExpenseFlow.tsx`, `frontend/src/pages/DebtDetail.tsx`.

**Result:** Vision extraction now genuinely reads a bill at the line-item level (verified against the real Groq API, not assumed), and the user gets to pick exactly which items a specific person owes for — with tax/service/discount handled explicitly — instead of always being forced onto the full bill total.

**Testing / verification:** Backend `tsc --noEmit` and frontend `tsc -b && vite build` both clean; full `npm run build` clean throughout. Verified live against the real Groq API:
1. Rendered a synthetic restaurant receipt (5 items including two with quantities >1 — 2× Coke, 3× Butter Naan — plus subtotal/tax/service charge/discount/grand total: ₹1350 + ₹68 tax + ₹135 service − ₹50 discount = ₹1503) via a browser screenshot, uploaded it through the real `/expenses/extract` endpoint. Confirmed `extractionMethod: "vision"` (proving the model-id fix actually took effect, not a silent OCR fallback), all 5 items extracted correctly with quantity/unit price/line total, and subtotal/tax/service/discount/grand total all correct, confidence 0.95.
2. **Found and fixed a real bug during this same test**: the model returned `discount: -50` (receipts often print discounts with a minus sign); my own proportional tax/discount formula (`tax + serviceCharge - discount`) would have silently added a negative discount instead of subtracting a positive one. Fixed by making the extraction prompt explicit that discount is always a positive magnitude, plus a defensive `Math.abs()` in the mapper regardless of what the model returns. Re-tested — discount now stores as `50`, formula correct.
3. Fed a 20×20 solid-noise PNG through the same endpoint: vision correctly refused it (Groq's own "image must have at least 32 pixels in each dimension"), OCR fallback ran and found no text, and the result came back as an honest `extractionFailed: true` with every field null/empty and no invented items — confirmed via the new dev logs that each stage (upload received → mediaType resolved → vision attempted → OCR fallback → 0 chars read) executed and logged correctly.
4. Created a person (Rahul) and attached a debt to the itemized receipt selecting only 2 of the 5 items (Chicken Biryani, manually corrected from the extracted ₹450 to ₹500, and Coke at ₹120) — confirmed the created debt was exactly ₹620 (not the ₹1503 whole bill, and using the corrected ₹500 not the original ₹450), and that `ReminderContext.debt.items` carried exactly those two items. Generated a message: *"bro, that chicken biryani & coke still owes me 620 ₹ – send it over when you can 😅"* — correctly named only the selected items and the corrected amount.
5. Created a second, unrelated ₹300 debt for the same Rahul from a different expense: confirmed both debts appear separately under his person record (₹620 restaurant, ₹300 movies) with neither touching the other, and that the second debt's context correctly listed the first as an `otherOpenDebts` entry.
6. Walked the new "items" step in the actual browser UI (not just curl): uploaded the synthetic receipt through the real Add Expense flow, confirmed the extraction/person/items steps render and compute correctly end-to-end.
All test people/expenses/debts and uploaded test images were deleted afterward — the real user's existing data was untouched.

**Found live, by accident, while testing in the browser:** while I was mid-test, a second, real debt (`expense_debts` id 16 — Mel, ₹665.27, for "Assorted Veg Platter" + "Choice OF Juice" from a real "THE SUFFER FACTORY" receipt) appeared in the same shared `data/debts.db`, created by what all the evidence points to being the user's own concurrent, independent use of the app in an already-running dev session (PIDs from ~7:55 PM, well before this session's testing) — not by my automation (that debt's message had already been hand-edited, and reached a step my own browser session never got to). I verified this did not touch or corrupt anything: Sara's and Mel's pre-existing real debts were byte-for-byte unchanged, and I only deleted my own leftover unattached test expenses/images/login row, leaving debt 16 and everything else real exactly as it was. This was still a useful, unplanned real-world validation of the new feature (itemized OCR read at confidence 0.85 despite real OCR misreads like "Fapad"/"Preniun Whisky", correct item selection, tax handling, person-memory reference to another real debt, and a natural generated message) — but it also surfaced a real bug: that other real debt's `otherOpenDebts.reason` carried a 428-character raw OCR dump (an old expense's `description` had never been cleanly summarized) straight into the live Groq prompt. Fixed with a `shortReason()` helper in `skills/contextSkill.ts` that caps both `debt.reason` and every `otherOpenDebts[].reason` to 60 characters, regardless of how dirty the underlying stored text is — applied retroactively to old rows too, not just newly-created ones.

*

**Notes / issues:** The item-selection UI's per-item editing keeps `quantity`/`unitPrice`/`price` in sync (editing quantity or unit price recomputes the line total; editing the line total directly overrides it), but there's no re-validation if a user edits quantity to 0 with a nonzero unit price — the line total simply stays whatever it was until touched again, which is harmless but slightly surprising. Separately: this session discovered there was already a dev server running from a prior/concurrent session (started well before this one) sharing the same `data/debts.db` — worth being aware that multiple `npm run dev` instances against the same project all read/write the same database file.

## 2026-09-19 (3)
### Task: Diagnose "Telegram verification not working after the person sent the code"

**What I asked Claude Code to do:** A real person (divyanshi) was given her verification code and sent it to the bot, but her profile still shows unverified — find and fix why.

**What Claude Code did:**
- Confirmed the bot token is valid (`getMe` succeeds) and the person's record (`people` id 23) is real, unverified, with a stored `verification_code` (`QNK9S2`) and no `telegram_user_id`/`telegram_chat_id` recorded yet — so her message was never actually processed by anything that could see this database.
- Checked `backend/index.ts`'s `shouldPollTelegram()`: by design, the Telegram poller only runs when `RAILWAY_ENVIRONMENT` is set (i.e. on Railway) or `ENABLE_TELEGRAM_POLLER=true` is set locally — neither was set, so the local dev server was never even attempting to read Telegram updates, let alone process her code.
- Temporarily set `ENABLE_TELEGRAM_POLLER=true` and restarted the local dev server to test enabling it — this immediately surfaced the real root cause: `Telegram getUpdates failed ... Conflict: terminated by other getUpdates request; make sure that only one bot instance is running`. Confirmed via `ps -ef` that no other local process for this project was running, meaning the only thing that could be holding that connection is the deployed Railway instance, which is apparently live and actively polling right now.
- Telegram allows only one long-poll connection per bot token at a time, and whichever instance wins processes the update against *its own* database. Since divyanshi was added through the local app's database, even if her `/verify QNK9S2` message reached the bot, it was Railway's separate deployed database (which has no record of her or her code) that received it — not this local one — so it could only ever fail to match or go unseen locally.
- Reverted `ENABLE_TELEGRAM_POLLER` back out of `.env` (leaving it retrying every 3s against a connection it can never win, while Railway is live, is pure log noise with no benefit) and restarted the dev server back to its normal quiet state.


**Files modified:** none (a local-only `.env` toggle was set then reverted during diagnosis; net change is zero).

**Result:** Root cause identified and explained, not silently patched around, since the real fix requires a decision only the user can make about which environment (local vs. the live Railway deployment) they're actually testing verification against. No application logic was touched.

**Testing / verification:** Reproduced the exact failure live: enabling the local poller and watching it immediately hit Telegram's real `Conflict` error against the real bot token, then confirmed via `ps -ef` that the only other possible source of that conflict is the deployed Railway instance (no stray local process exists). Restarted the dev server afterward and confirmed clean startup logs with the poller correctly skipped and the API serving normally on port 4000.


**Notes / issues:** Unresolved — needs a decision from the user: either (a) pause/stop the Railway service while testing Telegram verification locally, so the local instance can win the `getUpdates` connection and see divyanshi's code, or (b) add/verify people directly through the deployed Railway app instead of localhost, since that's the instance actually receiving Telegram messages right now. Divyanshi will need to resend her code (`QNK9S2`) after whichever path is chosen, since her original message was never seen by the database she was created in.

## 2026-09-20
### Task: Item-level partial-ownership expense splitting + payer auto-identified from session, payer's share hidden everywhere

**What I asked Claude Code to do:** Replace the expense flow's old whole/half/custom-amount split (one person, one share mode) with per-item ownership: for each bill item, pick everyone who shared it (the payer can be included in that pick, for correct math), split that item's price equally among whoever's picked, sum each person's per-item shares across the whole bill, and never show the payer's own computed share anywhere in the UI — the collection/results view and the Telegram-recipient list must only ever contain other people who owe the payer money. The payer had to be identified automatically from whatever session/auth concept already exists (no new auth, no picking yourself from a list). Auth/Telegram verification/AI message generation/deployment/env vars/unrelated pages were explicitly out of scope.

**What Claude Code did:**
- Inspected the existing flow end to end first: `frontend/src/pages/AddExpenseFlow.tsx` (the whole/half/custom split UI and the old single-item-selection-for-one-person step), `backend/api/routes/{expenses,debts,auth}.ts`, `backend/database/database.ts` (schema), `skills/debtCalculationSkill.ts`, and `frontend/src/context/AuthContext.tsx`.
- Found the existing "authenticated session" concept: `backend/api/routes/auth.ts` explicitly documents itself as a **local-development-only, single-user "login"** (`upsertUser` keyed only by a typed-in Telegram username — not real authentication) whose result (`{id, telegramUsername}`) is held in `AuthContext`/`useAuth()` and persisted to `localStorage`. There is no other user/session mechanism in this app. I used exactly this: `useAuth().user.id` is the payer's identity (`payer-${user.id}`), reported here rather than inventing new auth, per the task's instruction to say so explicitly if the app has no real multi-user auth.
- Found that `expense_debts` already has **no concept of the payer as a row at all** — every row is already "person X owes the payer," and the schema/comments already say multiple `expense_debts` rows against the same expense are expected (multiple people). This meant the entire feature could be built as a **frontend-only** change, calling the existing `POST /debts` (mode `"CUSTOM"`, computed `customAmount`, `selectedItems`), `generate-message`, `message` (edit), and `send` endpoints exactly as before, once per non-payer person — no backend/schema changes needed.
- Rewrote `frontend/src/pages/AddExpenseFlow.tsx`:
  - Removed the old whole/half/custom `ShareMode`/`SplitMode` UI and the old single-item-selection-for-one-person step entirely.
  - Replaced the single-select "who owes?" step with a multi-select "who was there?" step (existing `listPeople`/`createPerson` contacts feature, unchanged) — the payer is never in this list.
  - Replaced item selection with per-item person-assignment chips ("Me" + each selected person); an item's price splits equally among whoever's checked for it. Manual (non-itemized) expenses and image extractions with no line items are handled by synthesizing one whole-bill "item," so the same equal-split logic produces the old whole/half/other outcomes as special cases (e.g. payer + 1 other checked = a 2-way split) instead of needing a separate mode.
  - Added validation: an item with nobody assigned blocks calculation ("Continue" disabled + inline per-item warning); an item with only the payer checked is valid and correctly contributes ₹0 to everyone else.
  - Tax/service-charge/discount handling (proportional/excluded/manual) is preserved, now distributed per person proportionally to their pre-tax item share.
  - On "Calculate shares," creates one `expense_debts` row (existing `createDebt`, mode `CUSTOM`) per non-payer person whose computed share is > 0 — the payer's own share is computed only in memory to get everyone else's numbers right, then discarded; it is never sent to the backend and never stored anywhere.
  - New "People who owe you" review screen renders only those created debts (a `RecipientCard` per non-payer person) with per-recipient message generation/regeneration/tone/edit (same `generateMessage`/`editMessage` as before) and a "Send via Telegram" action that sends every selected, ready recipient's message in one action (`Promise.all` over the existing `sendDebtViaTelegram` per debt id). The payer cannot structurally appear in this list — it's built by iterating `selectedPeopleIds` (a `Set<number>` of real contact ids), which the payer's key (`payer-${user.id}`, not a contact id) can never be a member of.

**Files created/modified:**
- `frontend/src/pages/AddExpenseFlow.tsx` (rewritten — the only file changed; no backend, schema, auth, Telegram-verification, AI-generation, or other page/component changes)

**Result:** The new item-level split flow, automatic session-based payer identification, and genuine payer-share exclusion are implemented and compile cleanly. Backend, auth, Telegram verification, AI message generation, deployment config, and every other page are untouched.

**Testing / verification:**
- `npx tsc -b` and `npm run build` (frontend) both clean, no errors/warnings, `noUnusedLocals`/`noUnusedParameters` enabled so no dead old-flow state was left behind. `npx oxlint` on the changed file: clean.
- **Could not run a real click-through UI test or hit the live API**: this machine's `.env` `DATABASE_URL` points at `postgres.railway.internal`, which only resolves from inside Railway's private network — `npm run dev` locally fails immediately with `ENOTFOUND postgres.railway.internal`, so the backend never comes up (confirmed via logs and a health-check curl returning nothing/connection failed). No local Postgres or Docker is available in this environment to substitute a throwaway database, and per my instructions I did not modify `.env`/credentials or attempt to reach the shared production database. I stopped the non-functional dev processes afterward (no server was left running, no data was touched).
- In lieu of that, I did two things I can stand behind: (1) re-read the final component to confirm structurally that the "people who owe you" list (`recipients`) is only ever populated by iterating `selectedPeopleIds` (real contact ids from the existing `listPeople` contacts feature) — the payer's key is a string (`payer-<userId>`), never a member of that numeric `Set`, so the payer cannot appear in that array even in principle, not merely display as ₹0; the "Me" chip only exists in the item-assignment step, which the spec explicitly allows. (2) Extracted the exact per-item-split-plus-proportional-tax arithmetic from the new `proceedToReview` function into a standalone Node script and ran every edge case from the spec against it: payer-only on an item → nobody owes; payer + 1 other → other owes the full remaining half; payer + 2 others → each owes a third; two non-payer people alone → they split it between themselves; one non-payer alone → owes the full item; an unassigned item → flagged invalid and blocks calculation; a 3-item bill with different groups per item plus proportional tax → summed correctly per person and the payer's own (never-shown) share also verified correct. All checks passed. This is a genuine arithmetic verification, not a claim of a UI test that didn't happen.
- No throwaway test data was created in this session (no database was reachable to create it in), so there was nothing to clean up.

**Claude Code token usage:** Not available (this task ran as a delegated sub-agent without access to the parent session's transcript/usage accounting).

**Notes / issues:**
- Flagging, not fixing (out of scope for this task): the repo's `.env` `DATABASE_URL` is currently set to Railway's *internal* hostname (`postgres.railway.internal`), which cannot be reached from outside Railway's network — this appears to have changed since the 2026-09-19 entries above, where local dev against the real database clearly worked. Local development (`npm run dev`) is currently non-functional on this machine until `DATABASE_URL` is pointed at a reachable (e.g. Railway's public/proxy) connection string or a local dev Postgres instance, per `.env.example`'s own guidance ("For local dev, point this at your own dev Postgres instance — never at the same database production uses").
- Design decision worth flagging: additional context / desired-action text is now entered once per bill (on the "items" step) and applied identically to every recipient's generated message, rather than once per person — this is a natural consequence of one bill now producing multiple recipients in a single pass, and preserves the feature rather than dropping it.
- Design decision: tax/service-charge/discount is distributed across people proportionally to each person's pre-tax item share (including the payer's hidden share, which absorbs its own proportional cut and is discarded). The spec's edge cases don't mention tax at all; this was the smallest, most defensible generalization of the existing single-person tax-handling UI to multiple people.

## 2026-09-20
### Task: Fix two bugs in the item-split bill-adjustment math (missing tip, backwards toggle colors) and add exact rounding reconciliation

**What I asked Claude Code to do:** In `frontend/src/pages/AddExpenseFlow.tsx` only (continuing the item-level split flow from the entry above): (1) fix that `expense.tip` was never added into the bill-adjustment calculation even though it's a real, editable field; (2) fix the tax-handling toggle's selected/unselected colors, which were backwards, and verify the visually-selected option is actually the one driving the math; (3) implement full reconciliation so payer + every other person's final rounded share always sums exactly (to the paisa) to item subtotal + tax + service charge − discount + tip, with a documented, deterministic policy for where rounding remainders go; (4) confirm the final reconciled (not raw pre-tax) amount is what reaches the review screen, `createDebt`, and the generated Telegram message.

**What Claude Code did:**
- Read the current state of `AddExpenseFlow.tsx` in full (not from memory) plus `frontend/src/api/client.ts`'s `Expense`/`ExpenseLineItem` types and `backend/database/database.ts` / `backend/ai/types.ts` / `backend/api/routes/expenses.ts` to confirm there is no "already included in total" flag anywhere in the codebase for tax/service/discount/tip — the schema comment in `database.ts` confirms these are meant to be applied on top of item prices, never assumed baked in, which is exactly what the existing `taxHandling === "excluded"` mode is for.
- Fixed bug #1: `netExtraCharges` (used to compute `taxAdjustment`/`previewAdjustedTotal`) now adds `expense?.tip ?? 0`, alongside tax and service charge, matching discount's existing subtraction.
- Fixed bug #2: swapped the tax-handling toggle's Tailwind classes so the selected option renders `bg-ink/5 text-ink-soft` (grey) and unselected renders `bg-ink text-paper` (black), per the explicit requirement. Traced `taxAdjustment`'s branch on `taxHandling` end to end and confirmed no mismatch — whichever option is visually selected is the one whose formula (`proportional` → `netExtraCharges`, `excluded` → `0`, `manual` → `Number(manualTaxAdjustment)`) actually feeds the math; verified this with the standalone reconciliation script's "excluded" and "manual" test cases.
- Rewrote the share/rounding section of `proceedToReview()`: shares are now computed in two passes — (a) exact, unrounded per-person totals (item pretax share + that person's proportional cut of tax+service+discount+tip, including the payer's own hidden share, needed to get everyone else's proportion right), then (b) rounded to whole paise using integer-cent arithmetic (avoids floating-point drift), with any leftover remainder from rounding added to the payer's own hidden share — never to a share that's actually shown to or collected from another person. This is deterministic and documented in a code comment. It holds in the simplest case too (no adjustments at all), since the "true total" and the rounded-share sum are computed the same way regardless of whether `hasExtraCharges` is true.
- Traced `proceedToReview()` → `createDebt({ customAmount: r.amount, ... })` → `skills/debtCalculationSkill.ts`'s `computeShare("CUSTOM", ...)` (backend does no recomputation for `CUSTOM` mode, `debt.amount` is exactly what was sent) → the review screen's `formatCurrency(r.debt.amount)` and `people.totalOwed` → `generate-message`'s prompt (uses `debt.amount`) to confirm the final reconciled amount, not the raw item subtotal, is what's shown and sent everywhere.

**Files created/modified:**
- `frontend/src/pages/AddExpenseFlow.tsx` (targeted changes: `netExtraCharges` now includes tip; tax-handling toggle color classes swapped; `proceedToReview()`'s share/rounding logic rewritten for exact reconciliation with a documented remainder policy; doc comments updated to match)
- `BUILD_LOG.md` (this entry)

**Result:** Both bugs fixed; reconciliation now provably exact to the paisa in every case tested, including the spec's worked example (₹2,180 total, one person owing ₹763, another ₹545, payer's hidden share ₹872, sum ₹2,180).

**Testing / verification:**
- `npx tsc --noEmit -p frontend/tsconfig.json`: clean, no errors.
- Ported the exact new calculation logic (item split → proportional adjustment distribution → integer-paise rounding → payer-absorbs-remainder) into a standalone Node script and ran 9 cases: no adjustments, tax only, tax+service, discount only, tip only (the bug #1 case), all four together (spec's exact numbers: 2000 subtotal split 800/700/500 across payer/person1/person2, tax 180 + service 100 − discount 200 + tip 100 = 2180 → person1 763, person2 545, payer 872, sum 2180 exactly), a 3-way ₹100 split (rounding-remainder case: 33.33/33.33/33.34, sum 100 exactly), "excluded" mode with all four adjustments present but correctly ignored, and "manual" override — all 9 reconciled exactly (`sum(all incl. hidden payer share) === trueTotal`), including the zero-adjustment case.
- Confirmed the app's dev server and a **local** Postgres (`DATABASE_URL=postgresql://postgres@localhost:5433/debtcollector`, not Railway) were already running (`curl localhost:4000/api/people` → 200) and used them directly for a real end-to-end test: created two throwaway test contacts (`QA Test Calc 1` / `qa_test_calc_1`, id 3; `QA Test Calc 2` / `qa_test_calc_2`, id 4), a manual expense (`QA Test Restaurant`, id 7, ₹2000) with tax 180/serviceCharge 100/discount 200/tip 100 set via `PATCH /api/expenses/7`, then created two debts via `POST /api/debts` with the pre-computed reconciled amounts (763 and 545, mode `CUSTOM`). Verified via `GET /api/people` that `totalOwed` for both test contacts showed the reconciled amounts (763, 545) exactly, not the raw item shares (700, 500). Generated a real message via `POST /api/debts/6/generate-message` and confirmed the returned text — `"hey, quick reminder about the ₹763 for Item B whenever you get a chance"` — embeds the final reconciled amount, not the pre-adjustment ₹700.
- Confirmed the payer's own share never appeared in any API response (`GET /api/people`, debt payloads, generated message) in any test case — it only ever exists inside the frontend's in-memory calculation.
- Verified the toggle's color swap by code inspection (a deterministic static Tailwind class swap with no runtime branching); did not click-test it live because reaching the tax-adjustment banner in the wizard requires the image-upload/extraction step (manual entry never sets tax/service/discount/tip), and I didn't want to spend a real Groq vision/OCR call on an arbitrary or reused receipt image for a CSS-class check. The three `taxHandling` modes' effect on the actual numbers *was* exercised programmatically (see the 9-case script above) and via the "excluded"/"manual" reasoning above.
- Cleaned up all test data immediately after: deleted both debts (204), the test expense (204), and both test people (204) via their existing `DELETE` endpoints. Re-ran `GET /api/people` afterward and confirmed the two real, pre-existing contacts (`mel`, 1350.88 owed / 3 open debts; `sara`, 720.88 owed / 2 open debts) were unchanged before and after — no real data was touched at any point.

**Claude Code token usage:** Not available (this task ran as a delegated sub-agent without access to the parent session's transcript/usage accounting).

**Notes / issues:**
- Rounding-remainder policy, stated explicitly: any leftover from rounding every person's exact proportional share to the nearest paisa is added to the payer's own hidden share, never to a share shown to or collected from another person. This is safe specifically because the payer's share is never surfaced or sent anywhere (confirmed above) — so nobody's collected amount is ever nudged by a stray paisa to make the books balance; only the invisible payer-side figure absorbs it.
- Did not touch the item-level splitting UI, the payer-hiding mechanism itself, Telegram sending mechanics, auth, or any other screen, per scope.
- Did not commit these changes, per instructions.

## 2026-09-20
### Task: Add "← Back" navigation to every step of the Add Expense flow, plus a duplicate-debt guard

**What I asked Claude Code to do:** In `frontend/src/pages/AddExpenseFlow.tsx` only, add a "← Back" button to every step (People, Items/Split, Review/Send) so users can correct mistakes without restarting, preserving all data already entered — matching the existing "← Back" style already used on the upload/manual steps. Back from People must return to whichever Expense sub-step was actually used (`"extracted"` if the expense came from an image, else `"manual"`, whose state is already preserved). Back from Items must return to People. Back from Review must return to Items. Must not remove or change "Back to dashboard". Also identified and required a fix for a real correctness bug this feature would otherwise expose: `proceedToReview()` calls `createDebt` once per person with no delete-before-recreate step, so using the new Back button to correct an item assignment and recalculating would create duplicate `expense_debts` rows on top of the old (now-stale) ones instead of replacing them.

**What Claude Code did:**
- Read `AddExpenseFlow.tsx` in full (already modified several times this session) plus `backend/api/server.ts`, `backend/database/database.ts`, `backend/api/routes/debts.ts`, `agent/debtCollectorAgent.ts`, and `frontend/src/api/client.ts` to find the existing CRUD/debt-deletion patterns before writing anything new.
- Discovered the "necessary backend addition" described in the task (a `DELETE /api/debts/:id` endpoint) **already exists end-to-end**: `debtsRouter.delete("/:id")` in `backend/api/routes/debts.ts` → `agent.removeDebt()` in `agent/debtCollectorAgent.ts` → `deleteExpenseDebt()` in `backend/database/database.ts` (deletes the debt's own `reminders` rows, then the `expense_debts` row, nothing else) → `removeDebt(debtId)` already exported from `frontend/src/api/client.ts`. No backend or client changes were needed or made — only the missing piece was wiring this existing client function into `proceedToReview()`.
- Added three "← Back" buttons, styled identically to the existing ones (`className="mb-4 text-sm text-ink-soft hover:text-ink"`, positioned above each step's `<h1>`): People step → `setStep(expense?.source === "IMAGE" ? "extracted" : "manual")`; Items step → `setStep("people")`; Review step → `setStep("items")`.
- Modified `proceedToReview()`: before creating any new debts, if `recipients` is non-empty (i.e. this is a recalculation after Back → edit → recalculate, not the first run), it now calls `removeDebt` on every debt currently in `recipients` and clears `recipients`, so the new results replace rather than duplicate the old ones. Only ever touches debts this flow itself created and is currently tracking in `recipients` — never any other debt in the system. If any delete call fails, `itemsError` is set and the function returns before creating anything, rather than silently proceeding to create duplicates.
- Imported `removeDebt` into the file's existing import block from `../api/client`.

**Files created/modified:**
- `frontend/src/pages/AddExpenseFlow.tsx` (three new "← Back" buttons; `proceedToReview()` now deletes previously-created debts for this expense before recreating them; new `removeDebt` import) — no backend or `client.ts` changes were needed since the DELETE endpoint, agent function, DB function, and client wrapper all already existed.
- `BUILD_LOG.md` (this entry)

**Result:** All three Back buttons work and preserve state; the duplicate-debt bug is fixed by delete-before-recreate.

**Testing / verification:**
- `npx tsc --noEmit -p frontend` (frontend tsconfig): clean, no errors, both before and after final changes.
- Confirmed the dev server (`npm run server:dev` + `npm --prefix frontend run dev`, already running from earlier in this session) and a **local** Postgres (`DATABASE_URL=postgresql://postgres@localhost:5433/debtcollector`, not Railway) were up via `curl localhost:4000/api/health` → `{"aiConfigured":true,"telegramConfigured":true}`.
- Found the pre-existing browser tab (`http://localhost:5173/add-expense`) already open showed leftover, changing state (a real debt for `mel`, then later a different in-progress "extracted" McDonald's-receipt state) consistent with a **concurrent live session** — per project safety rules I did not drive further test actions in that tab. Opened a separate, dedicated new browser tab for all testing instead, and left the original tab untouched throughout.
- Created one throwaway test contact via `POST /api/people` (`backnavtest` / `@backnavtest_qa`, id 5) and drove the real UI end-to-end via browser automation:
  - Manual entry (amount 1000, merchant `QA_BACKNAV_TEST_MERCHANT`) → People: clicked the new Back button → confirmed it returned to the "manual" step with Amount/Merchant fields still pre-filled.
  - Forward again → People (selected `backnavtest`) → Items: clicked Back → confirmed it returned to People with `backnavtest`'s checkbox still checked.
  - Forward again → Items (item assigned to "Me" + `backnavtest`, ₹1000 split 50/50) → clicked "Calculate shares" → Review showed `backnavtest` owing ₹500. Confirmed via `GET /api/people` (totalOwed 500, openDebts 1) and `GET /api/debts` (debt id 10, amount 500).
  - **Duplicate-debt test:** clicked the new Back button on Review → confirmed it returned to Items with the item's assignment/amount intact (Me + backnavtest, ₹1000) → toggled "Me" off so `backnavtest` alone owned the full ₹1000 → clicked "Calculate shares" again → Review updated to show ₹1,000. Verified via API: `GET /api/people` for id 5 now shows `totalOwed: 1000, openDebts: "1"` (not 1500 and not 2) and `GET /api/debts` shows only one debt for person 5 (id 12, amount 1000); the old debt id 10 now returns `404` from `GET /api/debts/10`, confirming it was deleted rather than left as an orphaned duplicate.
  - Uploaded a synthetic test receipt image (generated locally with Pillow, text "QA_BACKNAV_IMG_TEST", total 250, tax 10, date 2026-09-20) through the image-upload path; AI vision correctly extracted total 250/tax 10/date. Continued to People, then clicked the new Back button and confirmed it returned to the "extracted" AI-vision review screen (not "manual") with the receipt image and extracted fields still shown, per the `expense?.source === "IMAGE"` branch. This test expense was never continued past People, so it was never persisted to the DB.
  - Confirmed "Back to dashboard" still navigates to `/dashboard` and still fully exits the flow.
- Cleaned up all test data immediately after: `DELETE /api/debts/12` (204), `DELETE /api/expenses/14` (204), `DELETE /api/people/5` (204). Re-ran `GET /api/people` and `GET /api/debts` afterward and confirmed no rows referencing person 5 or expense 14 remained, and the two real pre-existing contacts (`mel`, `sara`) were the only people left — their debt totals were not modified by any of this testing (mel's total did change between snapshots, from ₹1,100.88 to ₹1,237.89 owed, but only because of the concurrent live session identified above, not any action taken here).

**Claude Code token usage:** Not available (this task ran as a delegated sub-agent without access to the parent session's transcript/usage accounting).

**Notes / issues:**
- The task description assumed the `DELETE /api/debts/:id` backend stack didn't exist yet and asked for it to be built; inspection showed it was already fully implemented (route, agent function, DB function, and client wrapper) from earlier work in this project, so no backend files were touched — only the existing `removeDebt` client function needed to be called from the frontend.
- Did not touch the item-splitting math, tax/tip logic, or payer-hiding mechanism — only navigation and the delete-before-recreate guard, per scope.
- Noticed what appears to be a real concurrent session actively using the app in a pre-existing browser tab during this task; did not interact with or disturb it, and used a separate tab for all testing instead, per the project's safety rules around shared/live data.
- Did not commit these changes, per instructions.

## 2026-09-20
### Task: Remove em/en dashes from generated Telegram reminders; verify relationship-aware wording

**What I asked Claude Code to do:**
Fix the reminder message generation so no `—` (em dash) or `–` (en dash) ever appears in a generated Telegram message, and make sure messages are genuinely relationship/context-aware rather than templated, without touching expense calculation, verification, sending, or auth.

**What Claude Code did:**
- Inspected the existing message-generation system first (`backend/ai/types.ts`'s `REMINDER_SYSTEM_PROMPT`/`buildReminderPrompt`, `skills/messageDraftSkill.ts`) before changing anything. Found that most of the requested relationship/context-awareness (person.description and person.relationship shaping tone and wording, item-level context, reminder history driving escalation, an explicit banned-phrase list for corporate/AI-sounding language, varied length/structure, short-message requirement) was already implemented in depth in the existing prompt.
- Found the actual root cause of the reported issue: a `stripEmDashes()` post-processing function already existed as a deterministic safety net (since the prompt-only instruction wasn't 100% reliable against the real model), but its regex (`/\s*—\s*/g`) only stripped em dashes (U+2014) — not en dashes (U+2013). The example in the report used an en dash, which the model substituted after being told not to use an em dash, and the sanitizer let it through.
- Fixed `stripEmDashes()` in `backend/ai/types.ts` to strip both em dashes and en dashes (`/\s*[—–]\s*/g`), replacing with a comma and collapsing any resulting double comma, same as before.
- Reinforced `REMINDER_SYSTEM_PROMPT` itself: explicitly bans en dashes alongside em dashes (and bans substituting one for the other), and added the specific phrases from the reported example ("is hanging out in my account", "just a quick reminder", "just following up") to the existing banned corporate/AI-sounding phrase list, as defense in depth alongside the deterministic sanitizer.
- Verified there is exactly one generation code path (`draftReminderMessage` in `skills/messageDraftSkill.ts`), used for both initial generation and regeneration, and no hardcoded fallback/default message templates exist anywhere else in the codebase — so this one fix applies globally, per the request, with nothing else to update.

**Files created/modified:**
- `backend/ai/types.ts` (`stripEmDashes` regex fix; `REMINDER_SYSTEM_PROMPT` reinforcement)
- `BUILD_LOG.md` (this entry)

**Result:** Both the em dash and en dash are now stripped from every generated message regardless of what the model produces, and the prompt itself now explicitly names en dashes and the specific reported AI-sounding phrases as banned.

**Testing / verification:**
- `npx tsc --noEmit -p tsconfig.json`: clean, no errors.
- Created 4 throwaway test contacts with different relationships (best friend, batchmate, colleague, sibling) and distinct `notes`/descriptions via `POST /api/people`, created an identical ₹945 test expense/debt (Tandoori Roti + Chicken Pepper) for each, and generated a real message via `POST /api/debts/:id/generate-message` for all 4 tones (Casual, Funny, Passive-Aggressive, Unhinged) per person — 16 real Groq calls total.
- Checked every one of the 16 generated messages programmatically for `—` or `–`: zero violations.
- Read all 16 messages: wording genuinely differed by relationship (e.g. sibling messages read blunter/more teasing than colleague messages, which stayed lighter/more restrained even at "Funny"), matching the existing prompt's design rather than inserting the relationship word literally.
- Noted one non-issue during review: some Funny/Unhinged messages used a non-breaking hyphen (U+2011) inside ordinary compound words like "heads-up" and "meme-money" — confirmed via direct Unicode inspection this is a normal hyphen character, not the banned em/en dash, and not something the request asked to change.
- Cleaned up all test data immediately after: deleted all 4 test debts, 4 test expenses, and 4 test people via their respective DELETE endpoints (all 204). Re-checked `GET /api/people` afterward — only the two real pre-existing contacts (`mel`, `sara`) remain, totals unaffected by this testing.

**Claude Code token usage:** Not available.

**Notes / issues:** None outstanding. Did not modify expense calculation, item splitting, tax/tip logic, payer identification, Telegram verification/sending, authentication, or contacts, per scope. Did not commit anything, per instructions.

## 2026-09-20
### Task: Automatic escalating follow-up reminders after the first manual approval

**What I asked Claude Code to do:**
After a person manually approves and sends the FIRST Telegram reminder for a debt, automatically generate and send escalating follow-up reminders on a timer, with no further manual approval, until the debt is explicitly marked paid. Reuse the existing message-generation machinery (never a second/parallel one), fix a specific known bug in `contextSkill.ts` where same-debt reminder history is deliberately excluded from context, follow the exact same local/Railway activation-guard pattern already used for the Telegram poller, keep the interval a single named/easily-changed value, restrict the first-reminder tone picker to Casual/Funny/Unhinged, and test the whole thing safely with throwaway/unverified contacts only.

**What Claude Code did:**
- Read the whole brief and then inspected the real current code end to end before changing anything: `backend/ai/types.ts`, `skills/contextSkill.ts`, `skills/messageDraftSkill.ts`, `skills/debtSkill.ts`, `skills/telegramSkill.ts`, `backend/telegram/poller.ts`, `backend/index.ts`, `backend/api/routes/debts.ts`, `agent/debtCollectorAgent.ts` and its per-skill agents, `backend/database/database.ts`, `frontend/src/pages/DebtDetail.tsx`, `frontend/src/pages/AddExpenseFlow.tsx`, and `frontend/src/api/client.ts`. Confirmed the only place a reminder is ever manually generated/sent today is `AddExpenseFlow.tsx`'s review step (`DebtDetail.tsx` has no generate/send controls, only "Mark as paid"/"Remove"), and confirmed `backend/telegram/poller.ts` only ever handles verification codes/the old conversational draft-approval flow — it never touches `expense_debts.status` and cannot resolve or stop a debt.
- **Schema decision: no new columns.** Everything the feature needs is derivable from the existing `reminders` table via the existing `getRemindersForDebt(debt.id)` — count of `SENT` reminders for this exact debt, and the most recent one's tone/`sent_at`. No migration needed.
- **Fixed the described contextSkill.ts bug**: added `history.remindersForThisDebt` and `history.lastToneForThisDebt` to `ReminderContext` (`backend/ai/types.ts`), populated in `skills/contextSkill.ts` from `getRemindersForDebt(debt.id)` filtered to `status === "SENT"`, deliberately kept separate from (and without changing) the existing cross-debt `previousReminders`/`lastReminderTone` fields, which other code still relies on for "relationship-wide" framing. Updated `buildReminderPrompt` to add a distinct same-debt-history sentence and an optional `escalationNote`, and added a paragraph to `REMINDER_SYSTEM_PROMPT` explaining automatic escalation continuity and reinforcing that relationship/description should still shape HOW a given escalation stage reads (e.g. professor vs. close friend at the same stage), plus that the "never a real threat/harassment" rule matters even more with zero human review.
- **Escalation-tone-staging design** (`skills/escalationSkill.ts`, new): reminder 1 is always the user's manually-chosen tone (Casual/Funny/Unhinged), never touching this module. Reminder 2 forces `"Passive-Aggressive"` (stage 2). Reminder 3 forces `"Passive-Aggressive"` again but with a stronger stage-3 prompt note (blunter/more direct) — reusing the same tone label deliberately, since `TONES` only has 4 values and a 5th label wasn't warranted. Reminder 4 and every reminder after it (5, 6, 7...) force `"Unhinged"` and hold there permanently as a ceiling, rather than trying to invent something angrier than the app's own existing Unhinged register — which already carries the hard "never a real threat/harassment" rule that matters far more once nothing reviews these before they send.
- **Scheduler** (`backend/reminders/scheduler.ts`, new): a `setInterval`-based in-process loop (no new dependency, matching the app's existing style). Each tick queries `getDebtsDueForAutomaticFollowUp` (new function in `backend/database/database.ts`) for `UNPAID` debts with at least one `SENT` reminder whose most recent `sent_at` is at least `REMINDER_INTERVAL_MINUTES` old, re-fetches the debt and re-checks `status === "UNPAID"` a second time immediately before actually sending (closing the race window against a user clicking "Mark as paid" mid-cycle), builds fresh context via `contextAgent.buildContext` (never a stale cached one), computes the escalation stage, generates via the existing `agent.generateDraft` → `messageDraftAgent` → `skills/messageDraftSkill.ts` → Groq (extended to accept an optional `escalationNote`), and sends via the existing `agent.sendReminder` → `telegramAgent` → `skills/telegramSkill.ts`, which itself calls `reminderAgent.logReminder` → `recordReminder` — no second/new send or generation implementation anywhere.
- **Interval constant**: `backend/reminders/schedulerConfig.ts` (new), `getReminderIntervalMinutes()`, default `5`, overridable via `REMINDER_INTERVAL_MINUTES` env var. Used by the scheduler's own timing/query cutoff, and exposed to the frontend via a new `reminderIntervalMinutes` field on `GET /api/health` (`backend/api/server.ts`) so the UI never hardcodes the number separately.
- **Activation guard**: `shouldRunReminderScheduler()` in `backend/index.ts`, added immediately next to the existing `shouldPollTelegram()` and mirroring its exact logic/reasoning (`RAILWAY_ENVIRONMENT` auto-true in production, local opt-in via `ENABLE_REMINDER_SCHEDULER=true`), wired into `main()` the same way. This was left OFF for the entire session (no env var set), so the scheduler never ran unsupervised against the live local dev server outside of controlled test invocations described below.
- **Frontend**: `frontend/src/pages/AddExpenseFlow.tsx` — the first-reminder tone picker now offers only `INITIAL_TONES = ["Casual", "Funny", "Unhinged"]` (renamed from the old unrestricted `TONES` local constant; the shared `TONES` enum in `backend/ai/types.ts` was left untouched since Passive-Aggressive is still a real internal escalation value); the send button now reads "Approve & schedule"; review-step and post-send copy now explains that approving begins automatic escalating follow-ups every N minutes (test mode) until marked paid, reading N from the new `GET /api/health` field via `getHealth()`. `frontend/src/pages/DebtDetail.tsx` now shows an "Automatic reminders: every N minutes (test mode), escalating in tone, until this is marked as paid" banner whenever a debt is UNPAID and has at least one SENT reminder. `frontend/src/api/client.ts` updated (`HealthStatus.reminderIntervalMinutes`, `ReminderContext.history.remindersForThisDebt`/`lastToneForThisDebt`) to match.
- Read the relevant prior `BUILD_LOG.md` entry (em/en dash fix) before touching `stripEmDashes` again — it had already investigated and deliberately left alone a non-breaking hyphen (U+2011) appearing in ordinary compound words as a non-issue. Found the same character reappear in one Unhinged-tone test message ("one‑person strike"); initially added a fix for it, then reverted that change after finding the prior entry's explicit, considered decision to leave it alone — not part of this task's scope (verifying no *em/en dash*, which U+2011 is not), so `stripEmDashes` is unchanged from before this task.

**Files created/modified:**
- `backend/ai/types.ts` (new `ReminderContext.history` fields; `buildReminderPrompt` escalation-note support; `REMINDER_SYSTEM_PROMPT` automatic-escalation paragraph)
- `skills/contextSkill.ts` (same-debt reminder history)
- `skills/escalationSkill.ts` (new — tone-staging logic)
- `skills/messageDraftSkill.ts` (`escalationNote` passthrough)
- `agent/messageDraftAgent.ts` (`escalationNote` passthrough)
- `agent/debtCollectorAgent.ts` (`generateDraft` accepts `escalationNote`)
- `backend/database/database.ts` (new `getDebtsDueForAutomaticFollowUp`)
- `backend/reminders/schedulerConfig.ts` (new — single interval constant/env var)
- `backend/reminders/scheduler.ts` (new — the scheduler itself)
- `backend/index.ts` (`shouldRunReminderScheduler`, wired into `main()`)
- `backend/api/server.ts` (`reminderIntervalMinutes` on `GET /api/health`)
- `frontend/src/api/client.ts` (`HealthStatus`/`ReminderContext` type updates)
- `frontend/src/pages/AddExpenseFlow.tsx` (tone-picker restriction, "Approve & schedule" copy)
- `frontend/src/pages/DebtDetail.tsx` (automatic-mode banner)
- `BUILD_LOG.md` (this entry)

**Result:** Feature implemented end to end and left disabled by default locally (only enabled via a temporary, always-reverted env override during testing, and never touched Railway/production settings). `npx tsc --noEmit -p .` (backend) and `npx tsc -b --noEmit` (frontend) both clean.

**Testing / verification:**
- Confirmed via direct code inspection (not just assumption) that `backend/telegram/poller.ts` cannot stop or resolve a debt — it only ever handles verification codes and the retired conversational draft-approval flow.
- Created one throwaway, unverified test person (`zztest_scheduler_9182`, "close friend"), one manual test expense (₹540, "Pizza and cold coffee test run"), and one debt via the real running local dev API (`localhost:4000`, local Postgres, confirmed via `GET /api/people`/`.env`'s `DATABASE_URL` pointing at `localhost:5433` before starting).
- Generated reminder 1 for real via `POST /debts/:id/generate-message` (Casual tone) — real Groq call, correctly referenced the real expense/amount.
- Called the real `POST /debts/:id/send` — correctly failed with 403 "hasn't verified their Telegram yet" (the app's own pre-flight guard, never reaching Telegram's real API), and correctly recorded a `FAILED` reminder, not `SENT` — proving an unverified contact can never trigger automatic mode through the real send path.
- Because a genuine `SENT` reminder requires a verified Telegram account (explicitly out of scope), used a small throwaway script (`__scheduler_test__.ts`, deleted at the end of this task, never committed) to seed backdated synthetic `SENT` reminder rows directly into the local test DB only — clearly disclosed here as test-only seeding, never a real Telegram send — simulating that reminders 1-5 had already been delivered, and to call the real, unmodified `runReminderSchedulerTick()` function directly (no second server, no second Telegram poller).
- Verified stage progression live against real Groq output for the one test debt: 1 seeded SENT (Casual) → real tick generated stage 2 (Passive-Aggressive: "still waiting on your ₹540 pizza and cold coffee share, guess my wallet's on a diet") → seeded 2nd SENT → real tick generated stage 3 (Passive-Aggressive, blunter: "still haunting my account, huh?") → seeded 3rd SENT → real tick generated stage 4 (Unhinged: "basically staging a protest in my bank account... before my wallet files for divorce") → seeded 4th SENT → real tick confirmed the ceiling holds (still Unhinged, not escalating further) → seeded 5th SENT → real tick confirmed the ceiling still holds at reminder 6. Every generated message stayed anchored to the same real expense/amount, never invented a new fact, and never used an em dash or en dash. Every attempted send correctly, safely failed with the same "not verified" error (recorded `FAILED`), since the test contact was never verified.
- Verified interval timing against real elapsed time, not just backdated timestamps: on a second throwaway debt, seeded a `SENT` reminder with `sent_at = now`, ran a tick with `REMINDER_INTERVAL_MINUTES=0.5` (30s, temporary override inside the throwaway script's own process only — confirmed via `GET /api/health` afterward that the real running app's default of `5` was never affected) — correctly NOT picked up; waited for real wall-clock time to actually pass (36s, confirmed via timestamps), ran another tick — correctly picked up and generated stage 2.
- Verified "mark as paid stops it": called the real `POST /debts/:id/paid`, then ran another tick — reminder count for that debt stayed unchanged (11 before, 11 after), confirming no further automatic sends.
- Verified other data was unaffected throughout: the second test person/debt never interfered with the first, and no reminder or debt belonging to `mel`, `sara`, or `Madhan sir` (the pre-existing real contacts) was ever touched.
- Cleaned up all test data immediately after: deleted both test debts (204, cascade-deleted their reminders), both test expenses (204), both test people (204). Re-verified via `GET /api/people` (only `mel`/`sara`/`Madhan sir` remain), `GET /api/debts` (empty), and `GET /api/reminders` (0 rows). Deleted the throwaway `__scheduler_test__.ts` script itself. Confirmed no `REMINDER_INTERVAL_MINUTES`/`ENABLE_REMINDER_SCHEDULER` leaked into the real `.env` (never touched) and no stray test processes remained running.
- Did not verify a real Telegram account and did not send any real Telegram message to anyone, per explicit scope.

**Claude Code token usage:** Not available.

**Notes / issues:**
- The automatic scheduler was never enabled on the actually-running local dev server during this session (`ENABLE_REMINDER_SCHEDULER` was never set in `.env`) — it only ran via the isolated throwaway test script's own short-lived process invocations, each of which exited immediately after. Nothing keeps running unsupervised after this task.
- Because a real `SENT` reminder for reminder 1 requires a verified Telegram contact (explicitly out of scope to set up), the multi-stage escalation test above relied on directly seeding synthetic `SENT` history rows in the local test DB rather than a fully organic end-to-end send chain; the scheduler's selection query, fresh-context building, escalation staging, generation, and send-attempt logic were all exercised for real on top of that seeded history. If a fully organic test (real verified contact, real successful sends at each stage) is wanted later, that requires a deliberate, separate decision to verify a real Telegram account for testing, which was out of scope here.
- Found (and then deliberately did not fix) a pre-existing, previously-documented non-issue: a non-breaking hyphen (U+2011) sometimes appears in Groq output inside ordinary compound words (e.g. "one-person strike"); this is not an em dash or en dash and a prior session's `BUILD_LOG.md` entry already investigated and intentionally left it alone as out of scope.
- Did not touch expense calculation, item splitting, tax/service/discount/tip logic, payer identification/hiding, Telegram verification, authentication, contacts management UI, or deployment config, beyond what this feature strictly required. Did not commit or push anything, per instructions. Left `.gitignore`, the pre-existing uncommitted `BUILD_LOG.md`/`skills/skill of buildlog.md` deletion, `.claude/`, `.env.railway.bak`, and `build-log.md` exactly as found at the start of this session (all pre-existed this task, per `git status` at session start) — not part of this task's scope.

## 2026-09-20
### Task: Clearer "how to connect" UX for adding a person and Telegram verification, on the People page

**What I asked Claude Code to do:**
Add a targeted "how to connect" UI to the People page's add-person flow: right after adding a person, show step-by-step instructions (what the user does vs. what the other person does) for Telegram verification, including their real verification code, a "Copy code" button, a "Copy instructions" button (using the real, non-hardcoded bot username), a "Check status" button, and distinct verified/not-verified states — all without ever changing the existing verification mechanism itself (code generation, the `/verify` handler, the DB fields, or the silent username-auto-verify path). No decorative arrow/caret icons, no em dash anywhere in new copy.

**What Claude Code did:**
- Inspected `frontend/src/pages/People.tsx`, `frontend/src/api/client.ts`, `backend/api/routes/people.ts`, `backend/telegram/poller.ts`, `backend/telegram/rawApi.ts`, and `backend/api/server.ts` end to end before changing anything, and confirmed the assertions handed to me (code already returned by `POST /people`/`GET /people/:id`, no bot username stored anywhere, `callTelegramApi<T>()` pattern in `rawApi.ts`, `GET /api/health` already existing) against the real current code.
- **Backend**: added `tgGetMe()` and a memory-cached `getBotUsername()` to `backend/telegram/rawApi.ts` (caches only on success, so a transient failure can be retried on a later call rather than getting permanently stuck at null). Wired it into `GET /api/health` (`backend/api/server.ts`) as a new `botUsername` field. Added `getPrimaryUser()` to `backend/database/database.ts` (this is a single-user local-dev app — returns the one real row in `users`, ordered by `id ASC`, or `undefined` if no one has logged in). Used it in `backend/telegram/poller.ts`'s `handleVerifyCommand()` to reword the bot's success reply from `"You're verified! ${person.name} can now send you reminders here."` (read backwards — it addressed the verifying person by their own name) to `"You're verified! You're now connected to ${ownerLabel}'s expense tracker and can receive reminders here."`, where `ownerLabel` is `@<the app owner's real telegram_username>` (falls back to "the app owner" only if no user row exists yet). Note: the `users` table only ever stored `telegram_username`, never a separate display name, so that username is the most "real name" available for the app owner — documented this limitation in the new `getPrimaryUser()` doc comment.
- **Frontend** (`frontend/src/pages/People.tsx`, `frontend/src/api/client.ts`): added `botUsername: string | null` to the `HealthStatus` type. Rebuilt `People.tsx`'s add-person flow so `createPerson`'s response (already a full `PersonDetail` including `verificationCode`) immediately opens an inline "how to connect" panel per person — no navigation away, no hunting for it. The panel is also reachable any time via a new "How to connect" toggle button on every person row (not just right after adding), since people come back later to check status. Panel contents: the real code in a monospace box with a "Copy code" button; a "What you do" / "What they do" numbered list in plain text (no icons); a real `@<botusername>` mention and a real `https://t.me/<botusername>` link/button, built only from the fetched `botUsername` (never guessed/hardcoded); a "Copy instructions" button building the exact message `"Hey! I'm adding you to my expense thing. Open Telegram and search @BOTUSERNAME, press Start, then send the code XXXXXX to the bot. Once you've done that, let me know and I'll check the verification here."` with the real bot username and that person's real code; a "Check status" button that re-fetches `GET /people/:id` and updates in place (no page reload); and distinct verified ("Telegram connected ✓", instructions collapsed by default behind a "Show instructions again" toggle) vs. not-verified (instructions always shown, can't be hidden) states.
- Caught and fixed my own bug during testing: `openConnectPanel` originally always defaulted `showInstructions` to `true`, so a verified person's panel opened with the full steps still showing instead of collapsed — spec said verified should default to hidden. Fixed by defaulting to `false` and letting the existing `showSteps = !verified || showInstructions` expression force it back open for anyone not yet verified.
- Did not change `generateVerificationCode()`, the `/verify` command matching, `verifyPersonByCode`/`verifyPersonTelegram`, the `telegram_verified`/`verification_code` DB columns, or the silent username-auto-verify path (`recordTelegramContact`) in any way — confirmed by re-reading `poller.ts` and `database.ts` after editing that only the one reply string and one new read-only helper function were touched.

**Files created/modified:**
- `backend/telegram/rawApi.ts` (new `tgGetMe()`, `getBotUsername()`)
- `backend/api/server.ts` (`botUsername` field on `GET /api/health`)
- `backend/database/database.ts` (new `getPrimaryUser()`)
- `backend/telegram/poller.ts` (reworded the one verification-success reply string only)
- `frontend/src/api/client.ts` (`HealthStatus.botUsername`)
- `frontend/src/pages/People.tsx` (the whole new "how to connect" panel/UX)
- `BUILD_LOG.md` (this entry)

**Result:** Feature implemented end to end. `npx tsc --noEmit -p tsconfig.json` (backend) and `npm run build` (frontend, `tsc -b && vite build`) both clean, run twice (before and after the `showInstructions` bug fix found during testing).

**Testing / verification:**
- Confirmed the local dev stack was already running (`tsx watch backend/index.ts` + Vite) against local Postgres (`.env`'s `DATABASE_URL=postgresql://postgres@localhost:5433/debtcollector` — never touched, never pointed at Railway). `curl localhost:4000/api/health` returned `{"aiConfigured":true,"telegramConfigured":true,"reminderIntervalMinutes":5,"botUsername":"UnhingedDebtCollectorBot"}` — the real bot username, from a real `getMe` call.
- Drove the real UI in a real Chrome tab (via the claude-in-chrome tool) at `localhost:5173/people`, alongside the pre-existing real people already in the DB (`Madhan sir`, `mel`, `sara` — never touched, never sent anything, never had their rows read out to an outside party). Clicked the real "+ Add Person" button, filled in a throwaway test person (`ZZ_TestPerson_SuperAgent`, telegram username `zz_test_superagent_person`), clicked the real "Save person" button.
- Confirmed the "how to connect" panel opened automatically with the real, unique code `8UQG2G`, the real bot username `@UnhingedDebtCollectorBot`, a real `https://t.me/UnhingedDebtCollectorBot` link, and the exact "What you do"/"What they do" steps.
- Clicked the real "Copy code" button — button label changed to "Copied" (confirms `navigator.clipboard.writeText` succeeded); read the source to confirm the copied value is exactly `detail.verificationCode` (no formatting added).
- Read the exact "Copy instructions" text the code builds for this person: `"Hey! I'm adding you to my expense thing. Open Telegram and search @UnhingedDebtCollectorBot, press Start, then send the code 8UQG2G to the bot. Once you've done that, let me know and I'll check the verification here."` — matches the requested tone/example exactly, no em dash.
- Clicked the real "Check status" button before any verification — confirmed (via `read_network_requests`) it fired a real `GET /api/people/13` and the panel correctly kept showing "Telegram not connected".
- Simulated a real bot-side verification for this test person only: ran a throwaway script (via `tsx`, with `.env` sourced for `DATABASE_URL`) that called the actual, unmodified `verifyPersonByCode("8UQG2G", "999999999", "999999999")` from `backend/database/database.ts` directly against the local DB — confirmed it flipped `telegram_verified` from `0` to `1` for person id 13 only. Deleted the throwaway script from the scratchpad directory after use (never part of the repo).
- Reloaded the People page fresh and confirmed the list row itself now showed "Telegram verified", and reopening the "how to connect" panel showed "Telegram connected ✓" with the step-by-step instructions collapsed by default and a working "Show instructions again" / "Hide instructions" toggle (this is what surfaced the `showInstructions` default bug, which was fixed and re-verified in the same pass). Clicked the real "Check status" button again post-verification — confirmed (via `read_network_requests`) another real `GET /api/people/13`, still correctly showing the verified state.
- Cleaned up the throwaway test person via the real `DELETE /api/people/13` endpoint (the same one the UI's "Remove" button calls — the UI's native `window.confirm()` dialog doesn't render in automated screenshots, so I called the endpoint directly instead of guessing at dialog automation). Row counts: `GET /api/people` returned 4 people before deletion (ids 10 `Madhan sir`, 13 `ZZ_TestPerson_SuperAgent`, 1 `mel`, 2 `sara`) and 3 after (only 10, 1, 2 remain) — confirmed by both the API response and a fresh UI reload. No other row was modified or removed.
- Verified the existing verification mechanism was not altered in behavior: `generateVerificationCode()`, the `/verify CODE` regex/bare-token matching in `handleVerifyCommand()`, `verifyPersonByCode`/`verifyPersonTelegram`, and `recordTelegramContact()`'s silent username auto-verify path are all byte-for-byte unchanged except the one reply string.
- Did not test the bot-reply wording change against a real live Telegram conversation (that requires a real device on the other end, out of scope) — verified it by direct code reading only; the string itself was never exercised end-to-end through `tgSendMessage`.

**Claude Code token usage:** Not available.

**Notes / issues:**
- Mid-task, the coordinating/parent session reported that it had separately found and fixed a corrupted line in `backend/ai/groqClient.ts` (a stray `/` character in place of `max_tokens: params.maxTokens ?? 1024,`) that it said had crashed the backend, and asked me to confirm I hadn't caused it. I never opened, read, or edited `backend/ai/groqClient.ts` at any point in this task — `git status --short backend/ai/groqClient.ts` shows it clean/unmodified relative to `HEAD` right now, and the full-project `tsc --noEmit` I ran (both before and after that report) was clean throughout. I have no direct knowledge of how or whether that corruption happened; flagging this per instructions since it was reported as the second occurrence of the same file being corrupted during a delegated task this session, but I can't independently confirm anything beyond "it is not modified and not broken right now."
- Did not modify expense calculation, item splitting, tax/tip logic, payer hiding, authentication, deployment, the reminder scheduler feature, or any other page, per scope. Did not commit or push anything, per instructions.

## 2026-09-20
### Task: Send a one-time thank-you message when a debt is marked paid

**What I asked Claude Code to do:**
After a debt is marked paid, stop all future automatic reminders and send exactly one short, natural, relationship-aware thank-you Telegram message — never again if the debt was already paid before.

**What Claude Code did:**
- Added a small, separate generation path rather than reusing the reminder prompt as-is, since a "thanks for paying" message must never sound like a reminder: `THANK_YOU_SYSTEM_PROMPT` + `buildThankYouPrompt()` in `backend/ai/types.ts`, explicitly banning any mention of the amount/reminders, any em or en dash, and corporate/receipt-style phrasing, reusing the exact same `stripEmDashes()` sanitizer already used for reminders.
- `skills/messageDraftSkill.ts`: added `draftThankYouMessage()`, mirroring `draftReminderMessage()`'s existing Groq-call/retry/rate-limit-handling pattern rather than duplicating it.
- `agent/messageDraftAgent.ts`: added a thin `draftThankYou()` passthrough, matching the file's existing one-agent-per-skill convention.
- `agent/debtCollectorAgent.ts`'s `markDebtPaid()`: now checks the debt's status *before* updating it. Only on a genuine UNPAID→PAID transition does it build fresh context (reusing `contextAgent.buildContext`, the same context-builder the automatic scheduler uses), generate the thank-you, and send it via the existing `telegramAgent.sendMessage` + `reminderAgent.logReminder` path — no new send/logging mechanism. A repeat call on an already-PAID debt updates the status (a harmless no-op) but never re-sends. The thank-you send is wrapped in try/catch so a messaging failure never blocks the paid-status update itself. Stopping future automatic reminders needed no new code: the scheduler (`backend/reminders/scheduler.ts`) already only ever picks up debts still `UNPAID`.

**Files created/modified:**
- `backend/ai/types.ts`
- `skills/messageDraftSkill.ts`
- `agent/messageDraftAgent.ts`
- `agent/debtCollectorAgent.ts`
- `BUILD_LOG.md` (this entry)

**Result:** Marking a debt paid now sends exactly one real, natural thank-you and never a second one, and no further automatic reminders follow.

**Testing / verification:**
- `npx tsc --noEmit -p tsconfig.json`: clean.
- Real end-to-end test against the already-verified local `Test Person` (id 15, real chat id): created a throwaway expense/debt (id 27, ₹150), called `POST /api/debts/27/paid` — a real thank-you was generated and delivered for real ("Thanks so much! 🙏", `telegram_message_id: 331`, logged as a `SENT` reminder with `tone: null`, distinct from the escalation ladder's tones).
- Idempotency: called `POST /api/debts/27/paid` again on the already-paid debt — reminder count for that debt stayed at exactly 1, confirming no duplicate thank-you.
- Cleaned up the test debt/expense (204s) immediately after. Confirmed afterward that Test Person's verification and the separate, earlier real demo debt (id 26, with its own 2 real reminders from the scheduler test) were untouched.

**Claude Code token usage:** Not available.

**Notes / issues:** None outstanding. Did not touch the reminder-escalation ladder, expense calculation, Telegram verification, or authentication.

## 2026-09-20
### Task: Fix unreliable escalation and timing drift in automatic reminders

**What I asked Claude Code to do:**
The user showed a real Telegram screenshot proving two problems: consecutive automatic reminders weren't reliably getting meaner (a later "Passive-Aggressive" message read milder than the one before it), and the interval had drifted from ~5 minutes to a stable ~6 minutes.

**What Claude Code did:**
- Root-caused the escalation problem by reading the real conversation: reminders 2 and 3 were both forced to the same "Passive-Aggressive" tone label, distinguished only by an abstract prompt note ("push it further") — the model didn't reliably differentiate two same-labeled stages. Reminder 4 (a genuine tone-label jump to "Unhinged") landed hard and reliably. Also found that `agent/debtCollectorAgent.ts`'s `generateDraft()` only ever passed the literal previous message to the model when `regenerate: true` (the manual "Regenerate" button) — the automatic scheduler never sets that flag, so every automatic follow-up was generated with zero memory of what it had just said, only an abstract reminder count.
- `skills/escalationSkill.ts`: simplified the ladder so no two consecutive stages ever share a tone label — stage 2 = Passive-Aggressive, stage 3 (and every reminder after) = Unhinged, held at that ceiling. Removed the old 3-tier (PA, PA-again, Unhinged) design.
- `agent/debtCollectorAgent.ts`: `previousMessage` is now also passed whenever `escalationNote` is set (automatic follow-up), not only on manual regenerate.
- `backend/ai/types.ts`'s `buildReminderPrompt()`: added an escalation-aware branch for `previousMessage` — during automatic escalation it now says the new message "must clearly sound MORE annoyed/impatient/forceful than that exact previous message... if you're unsure whether this draft is harsher than the one above, make it harsher," instead of the manual-regenerate framing ("a different phrasing, same tone").
- `backend/reminders/scheduler.ts`: found the timing-drift cause — the poll loop was capped at 60s, so a reminder's exact send-second could self-reinforce a ~60s-late pattern every cycle (5:34, then a stable 6:00, 6:00). Tightened the poll cap from 60s to 15s so real-world drift per cycle stays under ~15s.

**Files created/modified:**
- `skills/escalationSkill.ts`
- `agent/debtCollectorAgent.ts`
- `backend/ai/types.ts`
- `backend/reminders/scheduler.ts`
- `BUILD_LOG.md` (this entry)

**Result:** Automatic reminders now escalate through a guaranteed tone-label jump each stage, every follow-up sees and is explicitly told to sound worse than its own literal predecessor, and the interval hugs 5:00–5:15 instead of drifting toward 6:00.

**Testing / verification:**
- `npx tsc --noEmit -p tsconfig.json`: clean.
- Confirmed live via the real running dev server: log now reports "polling every 15s" (was 60s) after restart; `GET /api/health` still reports `reminderIntervalMinutes: 5` (the real per-debt cadence is unchanged — only the poll granularity around it tightened).
- Diagnosed against real production evidence: the user's own Telegram screenshot showing reminders 2 and 3 (both "Passive-Aggressive") with 3 reading milder than 2, and reminder 4 (a real tone jump to "Unhinged") landing convincingly harder — this is what motivated moving the tone jump earlier rather than repeating a label.
- Did not run a fresh multi-cycle live test in this pass (the existing live demo debt, id 28, is already at the "Unhinged" ceiling and will pick up the new previous-message-aware prompt on its very next automatic cycle) — the user is actively watching this same debt in real time.

**Claude Code token usage:** Not available.

**Notes / issues:** None outstanding. Did not touch the manual first-reminder flow, payer-hiding, expense calculation, or Telegram verification.

---

## Automatic per-turn token usage log

Everything above this line is the narrative task-by-task log (one entry per unit of work, written
by whichever agent did that work). Everything below is appended automatically, one line per Claude
Code turn, by the `Stop` hook (`.claude/hooks/build-log-stop.cjs`, registered in
`.claude/settings.json`) — date, time, and the *actual* token usage for that turn read straight from
the session transcript, never estimated. See `.claude/skills/build-log/SKILL.md` for exactly how the
numbers are computed.

This section used to live in a separate file, `build-log.md`, at the repo root. Merged into this
file on 2026-09-20 so there is a single canonical build log; nothing below was re-estimated or
altered, it's the original file's entries verbatim.

New narrative entries (like the ones above) should always be added **above** this line, never below
it — the hook always appends to the very end of this file, so this section must stay last for
automatic logging to keep working correctly.

- 2026-09-20 13:09:30 - 952456 tokens (input: 943389, output: 9067)
- 2026-09-20 13:20:25 - 2849364 tokens (input: 2820349, output: 29015)
- 2026-09-20 13:24:53 - 1339468 tokens (input: 1331295, output: 8173)
- 2026-09-20 13:31:51 - 2459655 tokens (input: 2447240, output: 12415)
- 2026-09-20 13:36:03 - 471179 tokens (input: 468828, output: 2351)
- 2026-09-20 13:45:01 - 329025 tokens (input: 325367, output: 3658)
- 2026-09-20 13:57:40 - 2076242 tokens (input: 2071833, output: 4409)
- 2026-09-20 14:00:41 - 1087741 tokens (input: 1083682, output: 4059)
- 2026-09-20 14:02:15 - 552815 tokens (input: 552070, output: 745)
- 2026-09-20 14:12:14 - 3530641 tokens (input: 3521804, output: 8837)
- 2026-09-20 14:24:44 - 6087224 tokens (input: 6072617, output: 14607)
- 2026-09-20 15:28:24 - 15277340 tokens (input: 15250954, output: 26386)
- 2026-09-20 15:37:59 - 2606451 tokens (input: 2599096, output: 7355)
- 2026-09-20 15:46:36 - 2693550 tokens (input: 2689378, output: 4172)
- 2026-09-20 15:53:28 - 14755894 tokens (input: 14745978, output: 9916)
- 2026-09-20 16:04:45 - 9978810 tokens (input: 9962185, output: 16625)
- 2026-09-20 16:06:37 - 5042678 tokens (input: 5037184, output: 5494)
- 2026-09-20 16:31:22 - 3959819 tokens (input: 3940726, output: 19093)
- 2026-09-20 16:55:08 - 6648438 tokens (input: 6636857, output: 11581)
- 2026-09-20 17:04:14 - 4952125 tokens (input: 4944592, output: 7533)
- 2026-09-20 17:41:51 - 1000728 tokens (input: 1000090, output: 638)
- 2026-09-20 17:45:06 - 5095808 tokens (input: 5087648, output: 8160)
- 2026-09-20 18:02:31 - 4191330 tokens (input: 4186604, output: 4726)
- 2026-09-20 18:03:56 - 1595326 tokens (input: 1590928, output: 4398)
- 2026-09-20 18:09:56 - 7109290 tokens (input: 7102942, output: 6348)
- 2026-09-20 18:20:53 - 8483777 tokens (input: 8470088, output: 13689)
- 2026-09-20 18:23:45 - 9285817 tokens (input: 9280511, output: 5306)
- 2026-09-20 18:28:18 - 1774075 tokens (input: 1771323, output: 2752)
- 2026-09-20 18:31:16 - 593262 tokens (input: 592843, output: 419)
- 2026-09-20 18:34:13 - 6008567 tokens (input: 6000959, output: 7608)
- 2026-09-20 18:43:09 - 14841345 tokens (input: 14826432, output: 14913)
- 2026-09-20 18:47:20 - 3803825 tokens (input: 3797228, output: 6597)
- 2026-09-20 18:50:17 - 636979 tokens (input: 635962, output: 1017)
- 2026-09-20 18:58:30 - 1277593 tokens (input: 1275794, output: 1799)
- 2026-09-20 19:05:57 - 17754079 tokens (input: 17737505, output: 16574)
- 2026-09-20 19:14:06 - 3363986 tokens (input: 3358719, output: 5267)
- 2026-09-20 19:23:28 - 20150457 tokens (input: 20136011, output: 14446)
- 2026-09-20 19:24:24 - 1423928 tokens (input: 1422744, output: 1184)
- 2026-09-20 19:29:34 - 11666678 tokens (input: 11649129, output: 17549)
- 2026-09-20 19:37:33 - 980698 tokens (input: 973445, output: 7253)
- 2026-09-20 19:37:53 - 78647 tokens (input: 78522, output: 125)
- 2026-09-20 19:39:29 - 79750 tokens (input: 79614, output: 136)
- 2026-09-20 19:39:40 - 81436 tokens (input: 79916, output: 1520)
- 2026-09-20 19:39:53 - 19601666 tokens (input: 19581524, output: 20142)
- 2026-09-20 19:39:56 - 167090 tokens (input: 166118, output: 972)
- 2026-09-20 19:43:36 - 342583 tokens (input: 341052, output: 1531)
- 2026-09-20 19:46:52 - 1675553 tokens (input: 1666860, output: 8693)
- 2026-09-20 19:55:32 - 105671 tokens (input: 105439, output: 232)
- 2026-09-20 20:16:03 - 10199246 tokens (input: 10169883, output: 29363)
- 2026-09-20 20:47:24 - 2132897 tokens (input: 2124050, output: 8847)

- 2026-09-20 21:09:03 - 28084905 tokens (input: 27983171, output: 101734)
- 2026-09-20 21:09:50 - 530418 tokens (input: 529861, output: 557)
- 2026-09-20 21:14:07 - 1338441 tokens (input: 1335819, output: 2622)
- 2026-09-20 21:16:09 - 1362458 tokens (input: 1360236, output: 2222)
- 2026-09-20 21:21:31 - 1958988 tokens (input: 1952165, output: 6823)
- 2026-09-20 23:06:22 - 8464768 tokens (input: 8441676, output: 23092)
- 2026-09-21 10:30:28 - 668746 tokens (input: 663346, output: 5400)
- 2026-09-21 10:32:06 - 59995 tokens (input: 59573, output: 422)
- 2026-09-21 10:33:00 - 60247 tokens (input: 60082, output: 165)
- 2026-09-21 10:33:24 - 60551 tokens (input: 60299, output: 252)
- 2026-09-21 10:34:07 - 121750 tokens (input: 121350, output: 400)
- 2026-09-21 10:34:41 - 61287 tokens (input: 61166, output: 121)
- 2026-09-21 10:35:59 - 61424 tokens (input: 61352, output: 72)
- 2026-09-21 10:38:02 - 124331 tokens (input: 123947, output: 384)
- 2026-09-21 10:44:17 - 1391037 tokens (input: 1381302, output: 9735)
- 2026-09-21 10:45:24 - 87988 tokens (input: 87508, output: 480)
- 2026-09-21 10:46:05 - 88191 tokens (input: 88041, output: 150)
- 2026-09-21 10:47:01 - 179099 tokens (input: 177632, output: 1467)
- 2026-09-21 10:48:04 - 91589 tokens (input: 90570, output: 1019)
- 2026-09-21 10:49:35 - 91826 tokens (input: 91791, output: 35)
- 2026-09-21 10:50:39 - 185124 tokens (input: 184198, output: 926)
- 2026-09-21 10:51:25 - 188643 tokens (input: 187996, output: 647)
- 2026-09-21 10:54:45 - 97241 tokens (input: 95773, output: 1468)
- 2026-09-21 10:55:39 - 102173 tokens (input: 102012, output: 161)
- 2026-09-21 10:58:39 - 413348 tokens (input: 412095, output: 1253)
- 2026-09-21 11:09:09 - 3308461 tokens (input: 3288655, output: 19806)
- 2026-09-21 11:12:55 - 1362867 tokens (input: 1358719, output: 4148)
- 2026-09-21 11:33:39 - 280825 tokens (input: 280269, output: 556)
- 2026-09-21 11:48:21 - 4696392 tokens (input: 4685840, output: 10552)
- 2026-09-21 12:22:29 - 13909213 tokens (input: 13876505, output: 32708)
- 2026-09-21 12:22:48 - 984366 tokens (input: 983722, output: 644)
- 2026-09-21 12:23:00 - 246660 tokens (input: 246449, output: 211)
- 2026-09-21 12:23:30 - 744094 tokens (input: 743101, output: 993)
- 2026-09-21 12:25:24 - 1007787 tokens (input: 1006628, output: 1159)
- 2026-09-21 13:06:11 - 759420 tokens (input: 758997, output: 423)
- 2026-09-21 13:38:08 - 762144 tokens (input: 761788, output: 356)
- 2026-09-21 19:28:11 - 16679261 tokens (input: 16647551, output: 31710)
- 2026-09-21 19:34:36 - 3069969 tokens (input: 3064222, output: 5747)
- 2026-09-21 19:35:23 - 1382382 tokens (input: 1380709, output: 1673)
- 2026-09-21 19:36:06 - 1046740 tokens (input: 1046069, output: 671)
- 2026-09-21 19:37:19 - 2461672 tokens (input: 2459571, output: 2101)
- 2026-09-21 19:41:57 - 11390430 tokens (input: 11376270, output: 14160)
- 2026-09-21 19:43:04 - 759895 tokens (input: 758795, output: 1100)
- 2026-09-21 19:44:50 - 3831592 tokens (input: 3828642, output: 2950)
- 2026-09-21 19:45:02 - 385582 tokens (input: 385555, output: 27)
- 2026-09-21 19:45:15 - 385871 tokens (input: 385856, output: 15)
- 2026-09-21 19:46:31 - 2328085 tokens (input: 2326138, output: 1947)
- 2026-09-21 19:46:34 - 390133 tokens (input: 389866, output: 267)
- 2026-09-21 19:46:46 - 390448 tokens (input: 390407, output: 41)
- 2026-09-21 19:47:00 - 781768 tokens (input: 781734, output: 34)
- 2026-09-21 19:47:50 - 783127 tokens (input: 782996, output: 131)
- 2026-09-21 19:48:15 - 392508 tokens (input: 392153, output: 355)
- 2026-09-21 20:04:40 - 18870874 tokens (input: 18826781, output: 44093)
- 2026-09-21 20:09:34 - 2352932 tokens (input: 2343944, output: 8988)
- 2026-09-21 20:19:08 - 10236378 tokens (input: 10228636, output: 7742)
- 2026-09-21 20:19:20 - 992315 tokens (input: 992132, output: 183)
- 2026-09-21 20:19:46 - 496600 tokens (input: 496586, output: 14)
- 2026-09-21 20:19:58 - 496898 tokens (input: 496877, output: 21)
- 2026-09-21 20:20:38 - 994657 tokens (input: 994635, output: 22)
- 2026-09-21 20:21:46 - 1998015 tokens (input: 1996732, output: 1283)
- 2026-09-21 20:24:18 - 2532525 tokens (input: 2529120, output: 3405)
- 2026-09-21 20:26:27 - 3096796 tokens (input: 3090645, output: 6151)
- 2026-09-21 20:29:49 - 5215545 tokens (input: 5212725, output: 2820)
- 2026-09-21 20:30:01 - 523368 tokens (input: 523355, output: 13)
- 2026-09-21 20:30:14 - 523652 tokens (input: 523646, output: 6)
- 2026-09-21 20:30:27 - 523942 tokens (input: 523930, output: 12)
- 2026-09-21 20:30:46 - 524226 tokens (input: 524220, output: 6)
- 2026-09-21 20:31:45 - 524639 tokens (input: 524504, output: 135)
- 2026-09-21 20:32:34 - 524935 tokens (input: 524919, output: 16)
- 2026-09-21 20:33:07 - 1579478 tokens (input: 1578517, output: 961)
- 2026-09-21 20:39:11 - 8597890 tokens (input: 8592109, output: 5781)
- 2026-09-21 20:42:18 - 3266183 tokens (input: 3264801, output: 1382)
- 2026-09-21 22:53:28 - 3826931 tokens (input: 3825715, output: 1216)
- 2026-09-21 22:53:42 - 548113 tokens (input: 548100, output: 13)
- 2026-09-21 22:53:55 - 548393 tokens (input: 548387, output: 6)
- 2026-09-21 22:54:07 - 548682 tokens (input: 548667, output: 15)
- 2026-09-21 22:54:20 - 548973 tokens (input: 548958, output: 15)
- 2026-09-21 22:55:00 - 1649649 tokens (input: 1649144, output: 505)
- 2026-09-21 23:03:57 - 4442604 tokens (input: 4438328, output: 4276)
- 2026-09-21 23:11:04 - 2234142 tokens (input: 2233300, output: 842)
- 2026-09-21 23:13:16 - 3921293 tokens (input: 3920042, output: 1251)
- 2026-09-21 23:13:29 - 561628 tokens (input: 561602, output: 26)
- 2026-09-21 23:13:42 - 1124101 tokens (input: 1124082, output: 19)
- 2026-09-21 23:14:07 - 1125221 tokens (input: 1125203, output: 18)
- 2026-09-21 23:15:13 - 563038 tokens (input: 563022, output: 16)
- 2026-09-21 23:16:01 - 2260405 tokens (input: 2258600, output: 1805)
- 2026-09-21 23:19:51 - 6353030 tokens (input: 6347223, output: 5807)
- 2026-09-22 10:44:17 - 1174232 tokens (input: 1173320, output: 912)
- 2026-09-22 11:02:51 - 32564894 tokens (input: 32536588, output: 28306)
