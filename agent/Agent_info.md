# Agents

> **Status:** this table describes the originally-planned five-agent design. There used to be two
> parallel implementations — an original Telegram-only conversational flow (`agent/debtinfoAgent/`,
> `agent/debtDraftAgent/`) alongside the web app's expense flow — but the Telegram-only flow has
> since been retired (its code removed; its historical data in the `debts` table is kept). The web
> app's flow is now the only one, and its real architecture is one **Main Agent** coordinating one
> **agent per skill** (more granular than this table's original five roles, but the same shape):
>
> `agent/debtCollectorAgent.ts` (**Main Agent**) never calls a skill directly — it only calls the
> matching agent, which is the only thing that talks to its skill. It never chains straight from
> message generation to sending, either — that only happens across two separate HTTP calls, the
> second only ever triggered by the user's own click.
>
> | Original role | Real agent(s) | Skill(s) underneath |
> |---|---|---|
> | Debt Agent | `agent/debtAgent.ts`, `agent/debtCalculationAgent.ts`, `agent/expenseReaderAgent.ts` | `debtSkill`, `debtCalculationSkill`, `expenseReaderSkill` |
> | Store Agent | `agent/profileAgent.ts` | `profileSkill` |
> | Message Agent | `agent/contextAgent.ts`, `agent/messageDraftAgent.ts` | `contextSkill`, `messageDraftSkill` (a real Groq call) |
> | Telegram Agent | `agent/telegramAgent.ts` (sends only to a genuinely Telegram-verified person) | `telegramSkill` |
> | *(new — not in the original five)* | `agent/reminderAgent.ts` | `reminderSkill`, the send-attempt history |
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
