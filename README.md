# Gauri-Saxena_Capstone-Project_Unhinged-debt-collector_
An AI-powered expense/debt tracker that turns awkward payment requests into funny, personalized Telegram messages. Adjusts tone and escalation based on the expense, relationship, and reminder history.

Used through the local web app: record any expense (manually, or by uploading a bill/receipt/Google Pay/UPI screenshot), pick who owes what, review/edit the AI-written reminder, then send via Telegram. (An earlier "chat directly with the bot to log a debt" flow existed and has since been retired in favor of the web app — see `BUILD_LOG.md` for that history.)

## Person memory

A person is a persistent record (`people` table), matched by Telegram username (case/`@`-insensitive) — the same picker you use to attach someone to a new expense is how the app recognizes "this is the same Rahul as last time." You only ever type someone's name, relationship, and description once, when you first add them; every later expense just picks them from the list, so you're never re-asked something the app already knows.

What's remembered per person, and how it's used when writing the next reminder:

- **Identity & relationship** — name, Telegram username, relationship (e.g. "close friend", "coworker"), and a free-text description of who they are/how they handle money. This shapes *how* the message is written (word choice, how teasing vs. formal it can be), not just what facts it states.
- **Every past debt, kept separate** — each expense a person is tagged on creates its own `expense_debts` row. A new debt (e.g. ₹800 for concert tickets) never merges into or overwrites an older one (e.g. ₹500 for dinner still unpaid) — they're always distinct transactions. The AI is told about the person's *other* currently-unpaid debts (amount + reason only) so it can naturally acknowledge "and also that other thing" when it fits, but it's always instructed to only ask for the current debt's amount.
- **Reminder history** — how many times this person has been reminded before (across all their debts) and, critically, the *tone* actually used last time, so a second or third reminder reads like a continuation of an ongoing dynamic (more blunt/tired for a close friend, still measured for a distant one) instead of resetting to a polite-stranger tone every time.

Nothing here is invented: if a person is brand new or has no prior debts/reminders, the AI is explicitly told there's no history to draw on, so it never fabricates a past conversation, excuse, or promise.

## Human-sounding messages

Message generation (`backend/ai/types.ts`'s `REMINDER_SYSTEM_PROMPT`, called from `skills/messageDraftSkill.ts`) is deliberately steered away from sounding like an assistant or a bill notice: contractions, sentence fragments, and imperfect grammar/punctuation are treated as more natural, not as mistakes; greetings and sign-offs are dropped unless the relationship genuinely calls for them; corporate phrasing ("kindly", "outstanding balance", "I hope this message finds you well") is explicitly banned; and length/structure is varied on purpose so reminders don't all read like the same template with a name swapped in. The four escalation tones (Casual / Funny / Passive-Aggressive / Unhinged) still exist, but each is written to sound like a specific person's texting voice rather than a fixed script — regenerating asks for a genuinely different phrasing/structure, not a light reword.

## Running it

1. Copy `.env.example` to `.env` and fill in `GROQ_API_KEY` (get one at console.groq.com) and `TELEGRAM_BOT_TOKEN`.
2. `npm install` (and `npm --prefix frontend install` once, for the web app).
3. `npm run dev` — starts the API + Telegram bot and the web app together.
4. Open `http://localhost:5173`.

Groq is the only AI provider — no key management in the app itself; `GROQ_API_KEY` in `.env` is all that's needed. If your Groq account doesn't have a vision-capable model (most standard accounts don't), the app automatically falls back to local OCR + a Groq text call instead of failing — you don't have to configure this.

Before a reminder can actually be delivered to someone, they need to be Telegram-verified: either they send the bot any message once (if they have a public @username) and it verifies automatically, or — for accounts with no public username, which the Bot API otherwise can't identify at all — they send the bot the one-time code shown on their profile page. Either way, a typed username or phone number alone is never treated as proof.

See `plan.md` for the product/AI design and `BUILD_LOG.md` for the full build history.
