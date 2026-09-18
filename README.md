# Gauri-Saxena_Capstone-Project_Unhinged-debt-collector_
An AI-powered expense/debt tracker that turns awkward payment requests into funny, personalized Telegram messages. Adjusts tone and escalation based on the expense, relationship, and reminder history.

Used through the local web app: record any expense (manually, or by uploading a bill/receipt/Google Pay/UPI screenshot), pick who owes what, review/edit the AI-written reminder, then send via Telegram. (An earlier "chat directly with the bot to log a debt" flow existed and has since been retired in favor of the web app — see `BUILD_LOG.md` for that history.)

## Running it

1. Copy `.env.example` to `.env` and fill in `GROQ_API_KEY` (get one at console.groq.com) and `TELEGRAM_BOT_TOKEN`.
2. `npm install` (and `npm --prefix frontend install` once, for the web app).
3. `npm run dev` — starts the API + Telegram bot and the web app together.
4. Open `http://localhost:5173`.

Groq is the only AI provider — no key management in the app itself; `GROQ_API_KEY` in `.env` is all that's needed. If your Groq account doesn't have a vision-capable model (most standard accounts don't), the app automatically falls back to local OCR + a Groq text call instead of failing — you don't have to configure this.

Before a reminder can actually be delivered to someone, they need to be Telegram-verified: either they send the bot any message once (if they have a public @username) and it verifies automatically, or — for accounts with no public username, which the Bot API otherwise can't identify at all — they send the bot the one-time code shown on their profile page. Either way, a typed username or phone number alone is never treated as proof.

See `plan.md` for the product/AI design and `BUILD_LOG.md` for the full build history.
