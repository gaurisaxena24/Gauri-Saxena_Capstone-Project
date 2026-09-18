# Agents

> **Status:** this table describes the originally-planned five-agent design. There used to be two
> parallel implementations — an original Telegram-only conversational flow (`agent/debtinfoAgent/`,
> `agent/debtDraftAgent/`) alongside the web app's expense flow — but the Telegram-only flow has
> since been retired (its code removed; its historical data in the `debts` table is kept). The web
> app's flow is now the only one, and it maps onto this table as:
>
> `agent/debtCollectorAgent.ts` plays **Main Agent**, orchestrating the others but never chaining
> straight from message generation to sending — that only happens across two separate HTTP calls,
> the second only ever triggered by the user's own click. **Debt Agent** → `skills/debtSkill.ts` +
> `skills/debtCalculationSkill.ts`. **Store Agent** → `skills/profileSkill.ts` + the database layer.
> **Message Agent** → `skills/contextSkill.ts` + `skills/messageDraftSkill.ts` (a real Groq call).
> **Telegram Agent** → `skills/telegramSkill.ts` (which only sends to a person once genuinely
> Telegram-verified) + `skills/reminderSkill.ts` for the send-attempt history.
>
> See `agent/Agents_DebtCollector` and `BUILD_LOG.md` for more detail and history.

| Agent              | What it does                                      | Why                                                           | Takes information from | Interacts with                                         |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------- | ---------------------- | ------------------------------------------------------ |
| **Main Agent**     | Talks to the agents and manages the overall process | Controls which agent works next                               | User                   | Debt Agent, Store Agent, Message Agent, Telegram Agent |
| **Debt Agent**     | Collects the debt information from the user       | Gets all the information needed for the debt reminder         | User                   | Main Agent, Store Agent                                |
| **Store Agent**    | Stores and retrieves the debt information         | Keeps the user's debt information available for the next step | Debt Agent             | Debt Agent, Message Agent                              |
| **Message Agent**  | Creates the actual debt reminder message          | Uses the stored information to write a personalized message   | Store Agent            | Main Agent                                             |
| **Telegram Agent** | Sends the approved message to the person          | Delivers the final message through Telegram                   | Main Agent             | Telegram                                               |

## Flow

**User → Main Agent → Debt Agent → Store Agent → Message Agent → Main Agent → Telegram Agent → Person**
