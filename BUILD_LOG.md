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