Unhinged Debt Collector — MVP Plan

A. MVP Feature List
1. Debt Input Form — structured fields for: person's name, amount owed, reason for debt, days/weeks overdue, relationship to user, prior reminder status (yes/no), optional free-text context.
2. AI Context Interpretation — the AI reads all inputs (not just amount/time) and forms an internal assessment of the situation (e.g. "small amount, close friend, first reminder, no prior contact → keep it light").
3. AI Escalation Decision — the AI picks a *default* tone/escalation level based on the interpreted context, rather than the user always choosing it manually.
4. Personalized Message Generation — a WhatsApp-style message written in the chosen tone, referencing the specific details provided (name, amount, reason, time overdue).
5. Manual Escalation Override — user can select a different level (Casual / Funny / Passive-Aggressive / Unhinged) and regenerate in that tone.
6. Regenerate Button — user can request a new variation at the *same* escalation level if they don't like the phrasing.
7. Copy-to-Clipboard Output — final message is displayed in a clean, copyable format for manual sending.

B. Exact User Flow

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
6. AI generates a WhatsApp-style message in that tone
      ↓
7. Message displayed to user with:
   - The AI's chosen tone (editable)
   - A "Regenerate" button (same tone, new phrasing)
   - Tone selector (Casual / Funny / Passive-Aggressive / Unhinged)
      ↓
8. User optionally changes tone → AI regenerates in new tone
      ↓
9. User copies final message and sends manually via WhatsApp


C. What Information the AI Receives
- Person's name
- Amount owed
- Reason for the debt
- Time overdue
- Relationship to the user (e.g. close friend, roommate, coworker, acquaintance)
- Whether a reminder has already been sent
- Optional free-text context (e.g. "he's been avoiding my texts," "she just got paid," "we're still cool, just forgetful")
- (On regeneration) the previously generated message, so the AI doesn't just repeat itself

D. AI Responsibility vs. User Control

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

E. Minimum AI Agent Architecture

A single-agent, two-step reasoning pipeline is enough for this MVP — no multi-agent orchestration needed:

1. Context Interpreter step (AI call #1, or first reasoning pass)
   - Input: structured fields + free-text context
   - Output: a short internal assessment (e.g. relationship closeness score, urgency level, recommended tone) — this can be returned as structured JSON (tone, reasoning, confidence)

2. Message Generator step (AI call #2, or second reasoning pass)
   - Input: original debt details + the tone decided in step 1 (or user-overridden tone) + prior generated message if regenerating
   - Output: final WhatsApp-style message text

This can technically be done as one LLM call with a structured JSON output (`{tone, reasoning, message}`) for MVP simplicity, or split into two calls if you want to visibly show the "AI reasoning" step to demonstrate decision-making for your assignment (recommended — makes the AI's involvement visible and gradable).

No memory store, no agent framework, no tool use required. Regeneration is just a repeated call with a "generate a different variation" instruction plus the previous output for contrast.

F. Explicitly Out of Scope for MVP

- Automatic WhatsApp sending / WhatsApp Business API integration
- Splitwise or any external finance app integration
- User accounts, authentication, or login
- Persistent database / debt history storage
- Long-term memory of a person across multiple debts or sessions
- Fully autonomous agent that sends messages without human review
- Multi-user support, sharing, or collaboration features
- Analytics/dashboards on debts owed over time
- Payment tracking or marking debts as "paid"

These are strong candidates for a "Phase 2 / Advanced Version" section, showing growth potential without bloating the MVP.

G. Paragraph for plan.md → "MVP Scope"

The MVP for Unhinged Debt Collector focuses on a single core flow: the user submits structured details about an outstanding debt (person, amount, reason, time overdue, relationship, and prior reminder status) along with optional free-text context. The AI interprets this information to assess the social context of the situation and recommends an appropriate escalation level — Casual, Funny, Passive-Aggressive, or Unhinged — before generating a personalized, WhatsApp-style reminder message. The user can override the AI's recommended tone, regenerate the message for a new variation, and copy the final result to send manually. The MVP intentionally excludes automated sending, third-party integrations (WhatsApp API, Splitwise), user accounts, and persistent memory, keeping the scope narrow while still requiring genuine AI reasoning over context rather than simple template filling.

H. Why This Qualifies as High AI Involvement

The AI is not just filling blanks in a pre-written template — it performs a genuine **judgment task**: interpreting qualitative, sometimes ambiguous human context (relationship closeness, social awkwardness, whether patience has already been tested) and converting that into a concrete decision (which escalation tone is appropriate) before generating language that fits it. This mirrors real-world AI agent design: reasoning over unstructured input → producing a structured decision → generating grounded natural-language output conditioned on that decision. Because the tone recommendation changes based on context rather than being hardcoded or purely user-selected, the AI is demonstrably making a decision, not just executing a fixed generation task — which is the core requirement of "meaningful AI involvement" for the assignment.