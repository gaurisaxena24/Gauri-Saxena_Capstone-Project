# Reminder Scheduler — the one autonomous, non-click-driven agent

Every other agent in this app (see `Agent_info.md`) only ever runs because a person clicked
something — approve a debt, send a reminder, mark it paid. The **Reminder Scheduler**
(`backend/reminders/scheduler.ts`, config in `backend/reminders/schedulerConfig.ts`) is the one
exception: once a debt's *first* reminder has been manually approved and sent, every reminder after
that is generated and sent on its own, on a timer, with no human clicking anything, until the debt
is marked paid.

It isn't a new parallel pipeline — it's a scheduled trigger that calls the exact same Main Agent →
skill chain everything else uses. It never generates a message or sends a Telegram message itself.

## What it does, step by step

On an interval (`getReminderIntervalMinutes()`, default 5 minutes, overridable via
`REMINDER_INTERVAL_MINUTES`), each tick:

1. Queries `getDebtsDueForAutomaticFollowUp()` (`backend/database/database.ts`) for every debt that
   is still `UNPAID`, has at least one reminder that was actually `SENT` (i.e. a person manually
   approved and sent the first one — this never fires on a debt that hasn't had that human step
   yet), and whose most recent sent reminder is at least one interval old.
2. For each due debt, re-fetches it and re-checks `status === "UNPAID"` a second time immediately
   before doing anything else — closing the race window against someone clicking "Mark as paid" in
   the same moment the scheduler wakes up.
3. Asks `skills/escalationSkill.ts` how many times this exact debt has already been automatically
   followed up on, which returns the next stage's forced tone and an escalation note (see below).
4. Builds fresh context via `contextAgent.buildContext` — never a stale cached one — so the message
   reflects the debt's real current state (days overdue, other open debts, etc.) at send time.
5. Generates the message through the same path a manual send uses:
   `agent.generateDraft` → `messageDraftAgent` → `skills/messageDraftSkill.ts` → Groq, passing the
   forced tone, the escalation note, and the literal text of the previous automatic message so the
   model is explicitly told to sound worse than that exact message, not just "more escalated" in
   the abstract.
6. Sends through the same path a manual send uses: `agent.sendReminder` → `telegramAgent` →
   `skills/telegramSkill.ts`, which itself calls `reminderAgent.logReminder` to record the send —
   there is no second, parallel generation or send implementation anywhere in this codebase.

## The escalation ladder (`skills/escalationSkill.ts`)

The *first* reminder for any debt is always the tone the person picked by hand
(Casual/Funny/Unhinged — see `frontend/src/pages/AddExpenseFlow.tsx`'s `INITIAL_TONES`), sent
through the normal manual-review flow. This module only ever decides the tone for reminders after
that:

| Automatic follow-up # | Forced tone | Register |
| --- | --- | --- |
| 2nd | `Passive-Aggressive` | noticeably more passive-aggressive than a first reminder, still clearly the same person |
| 3rd and every one after it | `Angry` | blunt, fed up, no jokes, no absurd imagery — genuinely angry, not the comedic/dramatic "Unhinged" register. Ceiling: it holds here rather than escalating indefinitely, and never crosses into a real threat or harassment no matter how many follow-ups a debt has had. |

`"Angry"` is a real, distinct value in `TONES` (`backend/ai/types.ts`) — it is not the same as
`"Unhinged"`, which stays reserved for the manual picker's comedic/dramatic register. Automatic
escalation never uses `"Unhinged"`.

Each stage also gets the literal previous automatic message as an anchor, with an explicit
instruction that the new one must read as more annoyed/impatient/forceful than that exact message —
this is what makes the escalation reliably felt turn over turn, rather than hoping the model infers
"angrier" from a stage number alone.

## Safety / activation guard

Same pattern as the existing Telegram poller (`backend/telegram/poller.ts`): only one process may
hold this responsibility at a time, or the same escalating follow-up could be double- or
triple-sent to the same person. `backend/index.ts`'s `shouldRunReminderScheduler()` only starts it
when `RAILWAY_ENVIRONMENT` is set (the real deployed instance) or `ENABLE_REMINDER_SCHEDULER=true`
is set locally for deliberate testing — never on an ordinary local `npm run dev`.

## What it does *not* do

- It never picks up a debt whose first reminder hasn't been manually sent — there is no automatic
  "cold" first contact.
- It never invents an amount, expense, or reason — every generated message is grounded in the same
  real debt/context data a manual send would use.
- It never sends once a debt's status is `PAID` — marking a debt paid is itself what stops its
  future automatic reminders; there is no separate "cancel" flag or action.
