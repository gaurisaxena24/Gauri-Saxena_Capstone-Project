Unhinged Debt Collector — MVP Plan

## A. MVP Feature List
1. Debt Input Form — structured fields for: person's name, amount owed, reason for debt, days/weeks overdue, relationship to user, prior reminder status (yes/no), optional free-text context.
2. AI Context Interpretation — the AI reads all inputs (not just amount/time) and forms an internal assessment of the situation (e.g. "small amount, close friend, first reminder, no prior contact → keep it light").
3. AI Escalation Decision — the AI picks a *default* tone/escalation level based on the interpreted context, rather than the user always choosing it manually.
4. Personalized Message Generation — a chat style message written in the chosen tone, referencing the specific details provided (name, amount, reason, time overdue).
5. Manual Escalation Override — user can select a different level (Casual / Funny / Passive-Aggressive / Unhinged) and regenerate in that tone.
6. Regenerate Button — user can request a new variation at the *same* escalation level if they don't like the phrasing.
7. Copy-to-Clipboard Output — final message is displayed in a clean, copyable format for manual sending.

## B. Exact User Flow

1. User fills in debt form
      ↓
2. User submits
      ↓
3. AI receives structured input + optional context
      ↓
4. AI reasons about the situation:
   - How serious is this, socially?
   - Has patience already been tested (reminded before)?
   - How should relationship type affect bluntness?
      ↓
5. AI selects a recommended escalation level + justifies it briefly
      ↓
6. AI generates a Telegram-style message in that tone
      ↓
7. Message displayed to user with:
   - The AI's chosen tone (editable)
   - A "Regenerate" button (same tone, new phrasing)
   - Tone selector (Casual / Funny / Passive-Aggressive / Unhinged)
      ↓
8. User optionally changes tone → AI regenerates in new tone
      ↓
9. User copies final message and sends manually via Telegram// Telegram bot is able to send the file.


## C. What Information the AI Receives
- Person's name
- Amount owed
- Reason for the debt
- Time overdue
- Relationship to the user (e.g. close friend, roommate, coworker, acquaintance)
- Whether a reminder has already been sent
- Optional free-text context (e.g. "he's been avoiding my texts," "she just got paid," "we're still cool, just forgetful")
- (On regeneration) the previously generated message, so the AI doesn't just repeat itself

## D. AI Responsibility vs. User Control

Decided by AI
- Interpreting how serious/awkward the situation is
- Recommending an initial escalation level
- Choosing specific wording, jokes, and phrasing
- Adjusting message content to reference context (e.g. "you said you'd pay after payday")
- Deciding how blunt/harsh a message can be without becoming threatening

Controlled by User

- Entering the raw debt details
- Overriding the AI's tone choice
- Triggering regeneration
- Making the final decision to send (always manual, never automatic)
- Copying and sending the message themselves

The AI infers an appropriate tone from unstructured + structured context, and the user's control is a checkpoint/override, not the source of the decision.

## E. Minimum AI Agent Architecture

A single-agent, two-step reasoning pipeline is enough for this MVP — no multi-agent orchestration needed:

1. Context Interpreter step (AI call #1, or first reasoning pass)
   - Input: structured fields + free-text context
   - Output: a short internal assessment (e.g. relationship closeness score, urgency level, recommended tone) — this can be returned as structured JSON (tone, reasoning, confidence)

2. Message Generator step (AI call #2, or second reasoning pass)
   - Input: original debt details + the tone decided in step 1 (or user-overridden tone) + prior generated message if regenerating
   - Output: final Telegram-style message text

This can technically be done as one LLM call with a structured JSON output (`{tone, reasoning, message}`) for MVP simplicity, or split into two calls if you want to visibly show the "AI reasoning" step to demonstrate decision-making for your assignment (recommended — makes the AI's involvement visible and gradable).

No memory store, no agent framework, no tool use required. Regeneration is just a repeated call with a "generate a different variation" instruction plus the previous output for contrast.

## F. Explicitly Out of Scope for MVP

- Splitwise or any external finance app integration
- User accounts, authentication, or login
- Persistent database / debt history storage
- Long-term memory of a person across multiple debts or sessions
- Fully autonomous agent that sends messages without human review
- Multi-user support, sharing, or collaboration features
- Analytics/dashboards on debts owed over time
- Payment tracking or marking debts as "paid"

These are strong candidates for a "Phase 2 / Advanced Version" section, showing growth potential without bloating the MVP.

## G. Paragraph for plan.md → "MVP Scope"

The MVP for Unhinged Debt Collector focuses on a single core flow: the user submits structured details about an outstanding debt (person, amount, reason, time overdue, relationship, and prior reminder status) along with optional free-text context. The AI interprets this information to assess the social context of the situation and recommends an appropriate escalation level — Casual, Funny, Passive-Aggressive, or Unhinged — before generating a personalized, message style reminders. The user can override the AI's recommended tone, regenerate the message for a new variation, and copy the final result to send manually. The MVP intentionally excludes automated sending, third-party integrations (Telegram API, Splitwise), user accounts, and persistent memory, keeping the scope narrow while still requiring genuine AI reasoning over context rather than simple template filling.

## H. Why This Qualifies as High AI Involvement

The AI is not just filling blanks in a pre-written template — it performs a genuine **judgment task**: interpreting qualitative, sometimes ambiguous human context (relationship closeness, social awkwardness, whether patience has already been tested) and converting that into a concrete decision (which escalation tone is appropriate) before generating language that fits it. This mirrors real-world AI agent design: reasoning over unstructured input → producing a structured decision → generating grounded natural-language output conditioned on that decision. Because the tone recommendation changes based on context rather than being hardcoded or purely user-selected, the AI is demonstrably making a decision, not just executing a fixed generation task — which is the core requirement of "meaningful AI involvement" for the assignment.

## I. Explicit Use of AI

AI is the core decision-making component of Unhinged Debt Collector. It is used for more than simply generating text.

### What the AI Does

1. **Context Interpretation**

   * Reads both structured debt information and optional free-text context.
   * Interprets factors such as the relationship between the two people, amount owed, how long the debt has been overdue, and whether the person has already been reminded.
   * Example: `₹300 + close friend + 2 days overdue + first reminder` should produce a different response from `₹8,000 + roommate + 3 weeks overdue + already reminded twice`.

2. **Escalation Decision**

   * Based on the interpreted context, the AI recommends one of four escalation levels:

     * Casual
     * Funny
     * Passive-Aggressive
     * Unhinged
   * This decision is made by the AI rather than being completely predetermined by the user.

3. **Personalized Message Generation**

   * Generates a message based on the actual debt details and interpreted social context.
   * The AI decides the wording, humour, level of bluntness, and references to the situation instead of relying on fixed templates.

4. **Regeneration**

   * When the user requests another version, the AI receives the previous message and generates a substantially different variation at the same escalation level.
   * If the user changes the tone, the AI regenerates the message according to the new user-selected tone.

5. **Safety and Boundary Control**

   * The AI can make the message assertive or humorous without turning it into a threat, harassment, or abusive message.
   * The final decision to send remains with the user.

### Why AI Is Necessary

The main AI task is **context-dependent judgment**. The same amount of money can require completely different communication depending on the relationship, time overdue, previous reminders, and surrounding context.

Therefore, the AI is responsible for:

`Raw debt information + human context → interpretation → escalation decision → personalized message`

This makes the AI an active decision-making component of the system rather than simply a text generator filling predefined templates.

---

## J. Why Use Splitwise and Telegram?

The advanced version of Unhinged Debt Collector extends the MVP beyond message generation into an end-to-end debt-reminder workflow.

### Splitwise: Source of Debt Information

Instead of asking the user to manually enter every debt, a future version can use **Splitwise** as the source of structured debt data.

Splitwise already represents information such as:

* Who owes money
* How much is owed
* What the expense was for
* Whether the balance is outstanding

The project does **not** need to recreate a full financial-management application like Splitwise. Building our own complete Splitwise replacement would significantly increase the scope without improving the core AI-agent problem.

Instead, Splitwise can act as an **external data source**, while Unhinged Debt Collector acts as the AI layer that interprets the situation and decides how to communicate about it.

The workflow becomes:

`Splitwise → Debt information → AI context interpretation → Escalation decision → Message generation`

### Telegram: Message Delivery

Telegram is used as the communication layer in the advanced version.

Rather than automatically sending messages through Telegram provides a practical messaging interface that can be connected to the project through a Telegram bot/API.

The workflow becomes:

`AI-generated message → User review → Telegram → Recipient`

The user remains in control of the final action. The system should not send a message without the required user confirmation.

### Why Not Build These Systems Ourselves?

The purpose of the project is **not** to spend most of the development effort recreating existing products.

Building our own:

* Splitwise-like debt management system
* messaging platform
* authentication system
* payment tracker
* contact database

would make the project much larger while adding little value to the central AI component.

Using external services allows the project to demonstrate how an AI agent can operate **within a larger tool ecosystem**:

`External data → AI reasoning → User checkpoint → External action`

This also creates a clear path from the MVP to the advanced version without changing the core concept.

---

## K. MVP vs. Advanced Version

### MVP

`User enters debt details`
↓
`AI interprets context`
↓
`AI selects escalation level`
↓
`AI generates message`
↓
`User reviews / overrides / regenerates`
↓
`User copies and manually sends`

### Advanced Version

`Splitwise provides debt information`
↓
`AI interprets debt + social context`
↓
`AI selects escalation level`
↓
`AI generates message`
↓
`Human review / confirmation`
↓
`Telegram sends message`

The MVP proves the AI decision-making concept first. Splitwise and Telegram are then added as external tools to demonstrate how the same agent can retrieve information and perform an action in a larger end-to-end workflow.
