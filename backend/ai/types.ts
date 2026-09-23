export interface ExpenseLineItem {
  /** Stable id for React keys / item-selection state. Generated if the model didn't give one. */
  id: string;
  name: string;
  quantity: number | null;
  unitPrice: number | null;
  /** Line total. Never invented: computed from quantity*unitPrice when both are known and the model didn't give a total directly, otherwise 0. */
  price: number;
  /** True if `price` above couldn't be read or derived with confidence — the UI should flag this item for the user to check/fix rather than treat it as a solid fact. */
  uncertain: boolean;
}

export interface ExpenseExtraction {
  merchant: string | null;
  date: string | null;
  /** Grand total — what the bill/payment actually came to. */
  total: number | null;
  currency: string | null;
  /** Sum of line items before tax/service/discount, if the bill states one distinctly from `total`. */
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  serviceCharge: number | null;
  discount: number | null;
  category: string | null;
  paymentMethod: string | null;
  transactionReference: string | null;
  lineItems: ExpenseLineItem[];
  visibleNames: string[];
  description: string | null;
  /** The model's own confidence (0-1) in this extraction overall — low means the image was hard to read; never a stand-in for validating specific fields. */
  confidence: number | null;
}

export const TONES = ["Casual", "Funny", "Passive-Aggressive", "Unhinged", "Angry"] as const;
export type Tone = (typeof TONES)[number];

export interface ReminderContext {
  person: {
    name: string;
    telegramUsername: string;
    relationship: string;
    /** Who they are / their personality / how they handle money — shapes HOW the message is written, not just facts it states. */
    description: string | null;
    /**
     * True when skills/formalitySkill.ts's `shouldStayFormal` resolved true for this person (a
     * manual per-person override, or an auto-detected formal relationship like professor/boss/
     * client/senior). This is a HARD signal, not a style suggestion: it overrides tone/escalation
     * — see REMINDER_SYSTEM_PROMPT and skills/escalationSkill.ts's formal ceiling.
     */
    formalityLocked: boolean;
  };
  debt: {
    /** This person's share. */
    amount: number;
    /** The full original expense amount, for reference when amount is a partial share. */
    expenseTotal: number;
    currency: string;
    date: string | null;
    category: string | null;
    reason: string;
    shareMode: "FULL" | "HALF" | "CUSTOM";
    /** Free-text context the user typed when creating this debt (e.g. "she already promised to pay Friday"). */
    additionalContext: string | null;
    /** What the user wants this message to actually ask for (e.g. "Send it today"). */
    desiredAction: string | null;
    /**
     * The actual item(s) this specific debt covers, when it was built from an itemized bill (e.g.
     * [{name: "Chicken Biryani", amount: 450}, {name: "Coke", amount: 120}]) — real selected rows
     * only, never the whole bill's item list. Null when the debt is a flat amount with no item
     * breakdown (manual entry, or a non-itemized screenshot).
     */
    items: Array<{ name: string; amount: number }> | null;
  };
  history: {
    previousDebts: number;
    previousReminders: number;
    previousPaidDebts: number;
    daysOutstanding: number;
    /** Tone actually used the last time a reminder was sent to this person, or null if never. Real fact, not a guess — lets the model escalate/continue consistently instead of restarting cold every time. */
    lastReminderTone: Tone | null;
    /**
     * This person's OTHER currently-unpaid debts (excludes the one this message is about). Real
     * rows only — never invented. Lets the model naturally acknowledge "there's also X" without
     * ever merging amounts: this message must still only ask for `debt.amount` above.
     */
    otherOpenDebts: Array<{ amount: number; reason: string; daysOutstanding: number }>;
    /**
     * How many times a reminder has already been successfully SENT for THIS EXACT debt (not the
     * relationship-wide `previousReminders` above, which deliberately excludes this debt). This is
     * what automatic escalation needs: 0 means this is genuinely the first message about this
     * expense; a higher count is what lets reminder 3/4/5... know it IS reminder 3/4/5 for the same
     * conversation and stay anchored to it rather than resetting cold. See skills/contextSkill.ts.
     */
    remindersForThisDebt: number;
    /** Tone used the last time THIS EXACT debt was reminded about, or null if never. Distinct from `lastReminderTone` above (which is scoped to any OTHER debt). */
    lastToneForThisDebt: Tone | null;
  };
}

export interface GeneratedReminder {
  tone: Tone;
  reasoning: string;
  message: string;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("GROQ_API_KEY is not configured. Add it to your .env file to enable AI features.");
    this.name = "AiNotConfiguredError";
  }
}

export class AiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiRequestError";
  }
}

/** Extracts the first {...} or [...] JSON value from a model response, tolerating stray prose/fencing. */
export function extractJson<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new AiRequestError("AI response did not contain JSON.");
  try {
    return JSON.parse(candidate.slice(start)) as T;
  } catch {
    throw new AiRequestError("AI response contained malformed JSON.");
  }
}

export function emptyExpenseExtraction(): ExpenseExtraction {
  return {
    merchant: null,
    date: null,
    total: null,
    currency: null,
    subtotal: null,
    tax: null,
    tip: null,
    serviceCharge: null,
    discount: null,
    category: null,
    paymentMethod: null,
    transactionReference: null,
    lineItems: [],
    visibleNames: [],
    description: null,
    confidence: null,
  };
}

/**
 * The vision/OCR extraction step's own contract. Nested but still minimal —
 * every field is either a primitive or an array of one flat item shape, so
 * the model has little structure to get wrong. Mapped onto the richer
 * internal `ExpenseExtraction` immediately after parsing (see
 * `mapRawExtractionToExpense`); nothing downstream ever sees this shape.
 */
export interface RawLineItem {
  name: string | null;
  quantity: number | null;
  unit_price: number | null;
  total: number | null;
}

export interface RawExpenseExtraction {
  merchant_or_person: string | null;
  date: string | null;
  items: RawLineItem[];
  subtotal: number | null;
  tax: number | null;
  service_charge: number | null;
  discount: number | null;
  grand_total: number | null;
  currency: string | null;
  description: string | null;
  people: string[];
  raw_context: string | null;
  /** 0-1: the model's own confidence in this whole extraction — low when the image was blurry, cropped, tilted, or otherwise hard to read. */
  confidence: number | null;
}

const MAX_DESCRIPTION_LENGTH = 300;

/** Defensive cap regardless of what the model returns — a UI note should never become a wall of text. */
function capDescription(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_DESCRIPTION_LENGTH ? `${trimmed.slice(0, MAX_DESCRIPTION_LENGTH).trim()}…` : trimmed;
}

let lineItemIdCounter = 0;
function nextLineItemId(): string {
  lineItemIdCounter += 1;
  return `item_${Date.now().toString(36)}_${lineItemIdCounter}`;
}

/**
 * Never invents a line total: uses the model's own `total` if given, derives
 * quantity*unitPrice only when both are actually present, and otherwise
 * leaves it at 0 with `uncertain: true` so the UI flags it for the user to
 * fill in rather than silently treating a guess as a fact.
 */
function mapRawLineItem(raw: Partial<RawLineItem>): ExpenseLineItem {
  const quantity = typeof raw.quantity === "number" ? raw.quantity : null;
  const unitPrice = typeof raw.unit_price === "number" ? raw.unit_price : null;
  const stated = typeof raw.total === "number" ? raw.total : null;
  const derived = quantity !== null && unitPrice !== null ? quantity * unitPrice : null;
  const price = stated ?? derived;
  return {
    id: nextLineItemId(),
    name: raw.name?.trim() || "Unknown item",
    quantity,
    unitPrice,
    price: price ?? 0,
    uncertain: price === null,
  };
}

export function mapRawExtractionToExpense(raw: Partial<RawExpenseExtraction>): ExpenseExtraction {
  return {
    ...emptyExpenseExtraction(),
    merchant: raw.merchant_or_person ?? null,
    date: raw.date ?? null,
    total: typeof raw.grand_total === "number" ? raw.grand_total : null,
    currency: raw.currency ?? null,
    subtotal: typeof raw.subtotal === "number" ? raw.subtotal : null,
    tax: typeof raw.tax === "number" ? raw.tax : null,
    serviceCharge: typeof raw.service_charge === "number" ? raw.service_charge : null,
    // Always stored as a positive magnitude regardless of how the model returned it (some receipts
    // print it with a minus sign) — downstream math always does `tax + serviceCharge - discount`.
    discount: typeof raw.discount === "number" ? Math.abs(raw.discount) : null,
    lineItems: Array.isArray(raw.items) ? raw.items.map(mapRawLineItem) : [],
    visibleNames: Array.isArray(raw.people) ? raw.people : [],
    description: capDescription(raw.description) ?? capDescription(raw.raw_context),
    confidence: typeof raw.confidence === "number" ? raw.confidence : null,
  };
}

/**
 * The prompt tells the model never to use em dashes (part of the "sounds like a real friend
 * texting", not an AI, style requirement) but a reasoning model occasionally slips one in anyway —
 * reproduced directly against the real API. Also strips en dashes (–): observed in practice, the
 * model sometimes "obeys" the em-dash instruction by substituting an en dash instead, which is the
 * same AI-sounding tell in a different character. Enforced here deterministically rather than
 * trusting the instruction alone: a spaced dash reads as a clause break (", "), an unspaced one as
 * a harder pause (", " still reads naturally in short texting-style messages).
 */
function stripEmDashes(message: string): string {
  return message.replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ",");
}

export function normalizeGeneratedReminder(
  parsed: Partial<GeneratedReminder>,
  forcedTone?: Tone
): GeneratedReminder {
  const tone: Tone = (TONES as readonly string[]).includes(parsed.tone as string)
    ? (parsed.tone as Tone)
    : (forcedTone ?? "Casual");
  if (!parsed.message) throw new AiRequestError("AI did not return a message.");
  return { tone, reasoning: parsed.reasoning ?? "", message: stripEmDashes(parsed.message) };
}

export const EXPENSE_SYSTEM_PROMPT = `You extract expense/payment information from a photo or scanned text of a payment/expense record. \
This could be a restaurant bill, a shop receipt, a Google Pay/UPI payment screenshot, a Splitwise \
screenshot, a Telegram payment/expense screenshot, a bank transfer confirmation, or any other \
expense screenshot. Do not assume it is a traditional itemized bill — for example, a Google Pay \
screenshot may just show a payment to a person with no itemization at all, and a Splitwise \
screenshot may already state the expense name and split. Interpret whatever is actually visible.

When the image IS an itemized bill or receipt, extract EVERY line item separately — do not \
collapse them into just a total. For each item, read its name, quantity, unit price (if shown), \
and line total (if shown). Also separately read the subtotal, tax, service charge, discount, and \
grand total whenever any of them are visibly stated — these are usually printed as distinct lines \
near the bottom of a bill, not the same number. The grand total is just the final amount charged; \
never assume it is what any one specific person owes — that split happens later, outside this step.

Only report what is actually visible/legible. Never invent an item, name, quantity, price, amount, \
date, or any other detail that isn't actually shown — a missing/unreadable field must be null (or \
[] for a list), never a guess or a value backed into from the total. If you can state an item's \
name but genuinely cannot read its price, still include the item with a null price rather than \
omitting it or making one up.

Set "confidence" (0-1) to reflect how legible the image was overall — high (0.8-1) for a clear, \
well-lit, straight photo; lower (below 0.5) if the image is blurry, cropped, tilted, low-resolution, \
or otherwise genuinely hard to read. A low confidence with partially-filled fields is a completely \
valid, honest result — it is not a failure to correct for by guessing the rest.

Respond with ONLY valid JSON. Do not include markdown code fences. Do not include any explanation \
or prose before or after the JSON — output nothing but the JSON object itself. Use null for any \
field you can't identify (or [] for a list) — a field being missing is expected and fine. If the \
image can't be understood at all, still return the same JSON shape with every field null/empty and \
confidence near 0, rather than failing to produce valid JSON.`;

export const EXPENSE_USER_PROMPT = `Extract whatever expense/payment information is actually visible and respond with ONLY this JSON shape, nothing else:
{
  "merchant_or_person": string | null,
  "date": string | null,
  "items": [                          // [] if this isn't an itemized bill (e.g. a plain UPI payment screenshot) — never invented to fill this in
    {
      "name": string,
      "quantity": number | null,      // null if not shown or not applicable
      "unit_price": number | null,    // price per single unit, if shown separately from the line total
      "total": number | null          // this item's own line total, if shown; null if only name/quantity could be read
    }
  ],
  "subtotal": number | null,          // sum of items before tax/service/discount, ONLY if the bill states this distinctly
  "tax": number | null,
  "service_charge": number | null,
  "discount": number | null,          // a POSITIVE amount that was subtracted from the bill (e.g. 50 for a ₹50 discount) — never negative, even if the receipt prints it with a minus sign
  "grand_total": number | null,       // the final total actually charged/paid — NOT any one person's share
  "currency": string | null,
  "description": string | null,       // a short (under ~10 words) natural summary of what this was for, e.g. "dinner at a restaurant" or "UPI payment to a friend" — NOT a transcription of the receipt
  "people": string[],
  "raw_context": string | null,       // only if there's a brief, genuinely useful note beyond description (e.g. a stated purpose/split, or a legibility problem like "bottom-right corner is cut off"); short, NEVER a dump of everything visible in the image
  "confidence": number                // 0-1, your overall confidence in this extraction
}`;

export const REMINDER_SYSTEM_PROMPT = `You are the message-writing component of "Unhinged Debt Collector", an app that helps a \
person write a Telegram debt reminder to someone who owes them money. You are ghost-writing a text \
message this specific person would actually send, from their own phone, to someone they actually \
know — not drafting a notice on their behalf.

Resolve inputs in this order, highest priority first, whenever any of them would otherwise conflict:
1. person.relationship / person.description — who this person actually is. This is decided BEFORE \
tone or escalation, not adjusted after the fact.
2. person.formalityLocked — a HARD override, either set manually on this person's profile or \
auto-detected from their relationship (professor, boss, client, senior, etc.). When true, it caps \
how far this message is allowed to go regardless of anything below: stay restrained, professional, \
and respectful, never blunt, sarcastic, casual, or angry — even if forcedTone or an escalation note \
below says otherwise. A relationship like "Professor" overrides any prior angry/passive-aggressive/ \
escalating momentum immediately; it does not gradually override it.
3. debt + history — the actual facts of this specific situation (amount, how overdue, prior \
reminders).
4. forcedTone / escalation stage — the requested tone or automatic-escalation stage. This is the \
LOWEST priority: it shapes register and word choice only within whatever room steps 1-3 leave, and \
must yield to person.formalityLocked whenever the two conflict.

The context you receive always has three layers, and the message must genuinely be a synthesis of \
all three — never a generic "you owe me money" template with the name swapped in:

1. person.description — who this person actually is: their personality, how they communicate, how \
they handle money, any specific trait given. Before writing, pick out anything concrete in it (e.g. \
"cat person", "always forgets to pay", "sarcastic", "gives money fast") and actually let it shape \
the message — a specific real detail like that is worth more than a generic "casual" tone. Word \
choice, how teasing it can be, whether bluntness lands as normal or harsh — all of it comes from \
who this specific person actually is, not a generic persona.
2. person.relationship — the EXACT label given (e.g. "roommate", "sibling", "colleague", "ex", \
"close friend", "batchmate"), not just a rough "close vs distant" bucket. Let the specific \
relationship suggest what's actually realistic between these two people: a roommate reminder can \
reference living together or shared bills, a sibling can be blunter and more familiar than a \
friend, a colleague or acquaintance should stay lighter and more restrained even in a "Funny" tone, \
an ex carries more edge or awkwardness than a plain friend. Two messages about the identical debt \
to two people with different relationships/descriptions should read like they were written by the \
same person to genuinely different people, each grounded in what's actually known about that \
specific person — not like a template with a name and number swapped.
3. debt + history — the actual facts: amount owed (this may be the full expense, half, or a custom \
split — say so naturally if it's not the full amount), what it was for, how overdue it is, and \
reminder history including any other unpaid debts this person has and the tone last used with them. \
This is the factual backbone; never invent an amount, date, prior promise, conversation, excuse, or \
anything else not actually present in the context.

If debt.desiredAction is set, the message must actually ask for that specific thing (e.g. "send it \
today", "tell me when you'll pay") rather than a generic "pay me back". If debt.additionalContext is \
set, treat it as true background the person supplied and weave it in naturally — never contradict it.

If debt.items is set, this debt is that person's share of specific item(s) from a bill, not the \
whole bill — you may naturally mention what it's actually for (e.g. "your share of the biryani and \
the coke") using only the exact item names given, but never list every single one mechanically and \
never invent an item that isn't in that list.

Use history to make the message feel like it comes from an ongoing relationship, not a cold first \
contact, when it isn't one:
- history.previousReminders is how many times this person has already been reminded about ANY debt \
before. 0 means this is genuinely the first time — don't fake familiarity or exasperation that \
hasn't been earned yet. A higher count, especially for a close relationship, licenses more \
blunt/tired/frustrated phrasing, escalating toward real, biting anger at "Unhinged" — not a joke, \
never a real threat.
- history.lastReminderTone is the tone actually used last time (or null). If it's set, let the new \
message feel like a continuation of that dynamic rather than resetting to polite-stranger mode, \
even when the tone label itself changes.
- history.otherOpenDebts lists this person's OTHER currently-unpaid debts (if any). You may \
naturally acknowledge that there's more than one thing outstanding (e.g. "and also the thing from \
last week") ONLY if it fits naturally — but this message must still ask for exactly debt.amount, \
never a combined total, and never treat the current debt and an older one as the same transaction.
- If there is no relevant history (new person, no prior debts/reminders), don't invent any — just \
write a normal first message for that relationship.

Write like a real friend texting another friend — short, casual, spontaneous, a little unserious. \
This must NOT sound like AI, customer support, marketing copy, or a professionally written \
reminder:
- Keep it short: usually 1-3 sentences, sometimes a single line. Never write a paragraph when one \
sentence will do. Natural texting register: contractions (you're, can't, gonna), sentence \
fragments, informal phrasing — imperfect grammar (lowercase starts, missing commas, a run-on \
sentence) reads as more human, not as a mistake to fix.
- Vary length, rhythm, and structure between messages — don't default to the same shape every \
time, and don't force a punchline into every single one; a plain, simple line is fine for a casual \
acquaintance or a low-key mood.
- Be clever and funny about the ACTUAL situation (the specific food, event, or context in debt.reason \
/ debt.items / additionalContext) rather than writing a generic "joke" — the humor should come from \
what this debt is actually for, not from a bolted-on one-liner. It's fine for it to be slightly \
absurd. For a close friend you can be teasing, dramatic, or mildly ridiculous; for a casual \
acquaintance or colleague, keep it friendly and simple instead of forcing a bit.
- No greeting ("Hi ___,") and no sign-off ("Thanks!", "Best,") unless the relationship is genuinely \
formal/distant enough that a bare reminder would feel rude — and even then keep it minimal, not \
letter-shaped.
- Never use corporate/customer-service or formal phrasing — this includes but isn't limited to: "I \
hope you're doing well"/"I hope this message finds you well", "I wanted to follow up regarding", \
"I wanted to reach out", "just a gentle reminder", "just a quick reminder", "just following up", \
"kindly", "please be advised", "please settle the outstanding amount", "at your earliest \
convenience", "outstanding balance", "is hanging out in my account", or anything that reads like a \
bill, an automated notice, or a template with the name swapped in.
- Never use em dashes (—) or en dashes (–) anywhere in the message, and never substitute one for \
the other — use a comma, period, or just a new short sentence instead.
- Never explain your own reasoning inside the message itself (e.g. don't write "I'm reminding you \
because it's been 5 days") — the message just IS the text; save any explanation for "reasoning".
- Emojis are optional and rare, not a default — never more than one, and only when it genuinely \
fits the tone; most good messages have none at all.
- Use ₹ before the amount for INR (never "INR" or "Rs" as a prefix), and only state the amount when \
it's actually relevant to what you're saying — not mechanically in every sentence.

For calibration only — the register/vibe these should sound like, never phrases to reuse verbatim \
or drop into an unrelated message: "Because I spilled your coffee.", "Coffee is best when free.", \
"Friendship fee.", "Dinner on you tonight.", "Help me, I'm poor.", "Shut up and take my money.", \
"The Gulab Jamun and Dal Khichdi are still waiting on their ₹385. They're getting impatient.", \
"Dinner was great. Your contribution to my bank account would also be great." A normal, low-key \
reminder is just as valid: "hey, quick one, the ₹350 from dinner last week whenever you get a sec" \
reads exactly right for a casual tone with no history to escalate from.

Some messages are AUTOMATIC follow-ups: after a person approves and sends the first reminder for a \
debt, later reminders for that same debt are generated and sent on a timer with no human review at \
all. When the prompt tells you this exact debt has already been reminded about before (see \
history.remindersForThisDebt / lastToneForThisDebt), treat that as real continuity, not a fresh \
conversation: keep the same real amount/expense/items, and let it read like the same person getting \
increasingly (but believably) fed up, never a polite reset. Escalation must still be shaped by \
relationship and person.description exactly as described above: the same escalation stage should \
land very differently for a professor or senior colleague (stay restrained, brief, and still \
plausibly respectful even when direct or annoyed) than for a close friend or sibling (can get \
blunter, funnier, more dramatic at the same stage). Because these messages send automatically with \
no one checking them first, the safety rule below matters even more here than on a manually-reviewed \
message: no matter how many times this exact debt has already been reminded about, never write a \
real threat, never harassment, and never anything that isn't recognizably still a text message a \
real person would send a friend/colleague/family member they're owed money by.

"Angry" is a distinct tone from "Unhinged" — do not conflate them. "Unhinged" is comedic/dramatic \
chaos (absurd, over-the-top, a bit ridiculous); it is NOT genuinely angry. "Angry" is the opposite \
register: no jokes, no absurd imagery, no theatrics — short, blunt, visibly frustrated, like someone \
who is actually out of patience, not performing a bit. It's still shaped by relationship exactly like \
every other tone: angry-at-a-close-friend can be blunt and informal ("bro seriously, just send it"), \
while angry-at-a-professor or a distant acquaintance stays terse and controlled rather than familiar \
("This still hasn't been paid. Please send it today."), never actually disrespectful upward. "Angry" \
is used only for automatic escalation, never a real threat, never harassment, and never abusive \
language — it reads as genuinely fed up, not violent or menacing.

Rules you must follow exactly:
- Escalation tone must be one of exactly: "Casual", "Funny", "Passive-Aggressive", "Unhinged", "Angry".
- If the caller does not force a tone, pick the one tone that best fits the relationship, the \
person's description, the amount, and reminder history, and explain briefly why in "reasoning".
- "reasoning" must name the specific relationship label and any specific trait from \
person.description that actually shaped the message (e.g. "sibling + always forgets to pay → \
blunt but affectionate") — if that's genuinely hard to point to, the message probably isn't tailored \
enough yet.
- The message must stay short (usually 1-3 sentences, sometimes just one line) and read like a \
real Telegram message this specific person would actually send to this specific other person — \
not a form letter, not marketing copy, not customer support.
- Even at "Unhinged" or "Angry", the message must never be a real threat, never harassment, and never abusive language — "Unhinged" stays funny/dramatic; "Angry" stays blunt and fed up, not violent or menacing.
- If asked to regenerate, write a genuinely different phrasing/joke/structure from the previous \
message, at the same tone — not a light rewording of the same sentence.

Respond with ONLY a JSON object, no prose outside it, in exactly this shape:
{ "tone": "Casual" | "Funny" | "Passive-Aggressive" | "Unhinged", "reasoning": string, "message": string }`;

export function buildReminderPrompt(params: {
  context: ReminderContext;
  forcedTone?: Tone;
  previousMessage?: string;
  /**
   * Set only by the automatic reminder scheduler (backend/reminders/scheduler.ts) for a follow-up
   * that's escalating with no human review. Explains exactly what this particular follow-up stage
   * should sound like, on top of `forcedTone` — see skills/escalationSkill.ts.
   */
  escalationNote?: string;
}): string {
  const { history, debt } = params.context;
  const lines = [
    `Context:\n${JSON.stringify(params.context, null, 2)}`,
    debt.items && debt.items.length > 0
      ? `\nThis debt is specifically for: ${debt.items.map((i) => i.name).join(", ")}. You may reference this naturally, but the amount you're asking for is still exactly debt.amount, not the sum of these items' original bill prices (this may already be their discounted/adjusted share).`
      : ``,
    history.previousReminders > 0
      ? `\nThis person has already been reminded ${history.previousReminders} time(s) before` +
        (history.lastReminderTone ? `, most recently in a "${history.lastReminderTone}" tone.` : ".")
      : `\nThis is the first time this person has ever been reminded about anything — there is no prior familiarity to lean on.`,
    history.remindersForThisDebt > 0
      ? `\nThis exact debt (the same amount, same expense) has already been reminded about ${history.remindersForThisDebt} time(s) before` +
        (history.lastToneForThisDebt ? `, most recently in a "${history.lastToneForThisDebt}" tone.` : ".") +
        ` Keep referencing the same real expense/amount/items every time, never inventing a new fact or a new reason, and write this message as a natural escalation from that exact prior message, not a reset back to a first-contact tone.`
      : ``,
    history.otherOpenDebts.length > 0
      ? `\nThis person also currently owes for ${history.otherOpenDebts.length} other separate thing(s): ${history.otherOpenDebts
          .map((d) => `${d.reason} (${d.amount})`)
          .join(", ")}. You may acknowledge this naturally if it fits, but this message must only ask for the amount in "debt.amount" above — never add these together.`
      : ``,
    params.forcedTone
      ? `\nThe user has explicitly chosen the tone "${params.forcedTone}". Use exactly that tone.`
      : `\nNo tone was forced — choose the best-fitting tone yourself.`,
    params.escalationNote ? `\n${params.escalationNote}` : ``,
  ].filter(Boolean);
  if (params.previousMessage) {
    lines.push(
      params.escalationNote
        ? `\nThe previous message about this exact debt was:\n"${params.previousMessage}"\nThis new message must clearly sound MORE annoyed/impatient/forceful than that exact previous message — a real escalation a reader could feel, not a same-level rephrasing and never milder. If you're unsure whether this draft is harsher than the one above, make it harsher.`
        : `\nThe previous message was:\n"${params.previousMessage}"\nWrite a genuinely different phrasing/structure from it, at the same tone.`
    );
  }
  return lines.join("\n");
}

/**
 * A short, one-time Telegram message sent the moment a debt is marked paid, thanking the person
 * and (as a side effect) stopping the automatic reminder scheduler for that debt, since it only
 * ever picks up debts still UNPAID. Deliberately a separate, much smaller prompt from
 * REMINDER_SYSTEM_PROMPT above: this is not a reminder and must never ask for money, reference an
 * amount as still owed, or reuse any escalation/urgency framing — it's just a quick, genuine thanks.
 */
export const THANK_YOU_SYSTEM_PROMPT = `You are ghost-writing a single short "thanks for paying" Telegram text from one real person to \
another, for the "Unhinged Debt Collector" app. This is NOT a reminder and must never ask for \
money, mention an amount as still owed, or use any reminder/escalation framing — the debt is \
already paid; this message only exists to say thanks.

Use person.relationship and person.description (if given) to shape how casual, warm, or brief it \
is — a close friend or sibling can be very short and casual ("thank u!! 🙏" or "ty!"), a colleague \
or acquaintance can be a touch more neutral but still natural, never formal or corporate.

Rules:
- Keep it very short: almost always a single short line, sometimes just a few words.
- Sound like a real text message, not a receipt or an automated confirmation.
- Never use em dashes (—) or en dashes (–) anywhere, and never substitute one for the other.
- Never use corporate/customer-service phrasing ("Thank you for your payment", "We appreciate your prompt payment", "Your transaction has been completed", "kindly", "at your earliest convenience", or anything that reads like a receipt/automated notice).
- At most one emoji, and only if it genuinely fits — plenty of good versions have none at all.
- Never mention the amount, the reminders that were sent before, or ask for anything else.

Respond with ONLY a JSON object, no prose outside it, in exactly this shape:
{ "message": string }`;

export function buildThankYouPrompt(context: ReminderContext): string {
  const { person, debt } = context;
  return [
    `Context:\n${JSON.stringify({ person, debtReason: debt.reason }, null, 2)}`,
    `\nThis person just paid what they owed for "${debt.reason}". Write the one-time thank-you text described in the system prompt.`,
  ].join("\n");
}

/** Shared by normalizeGeneratedReminder above and the thank-you flow — see stripEmDashes's own comment. */
export function normalizeGeneratedThankYou(parsed: { message?: unknown }): string {
  const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
  if (!message) throw new AiRequestError("AI response was missing a valid thank-you message.");
  return stripEmDashes(message);
}

// ---------------------------------------------------------------------------
// Gmail background payment detection (backend/gmail/paymentScanner.ts)
// ---------------------------------------------------------------------------

/** Raw model output — mapped defensively onto `GmailPaymentExtraction` immediately after parsing,
 * same convention as `RawExpenseExtraction` above; nothing downstream sees this shape. */
export interface RawGmailPaymentExtraction {
  is_payment: boolean;
  amount: number | null;
  payer_identifier: string | null;
  confidence: number;
}

export interface GmailPaymentExtraction {
  isPayment: boolean;
  amount: number | null;
  payerIdentifier: string | null;
  confidence: number;
  /** Set when the model couldn't produce valid JSON at all — a genuinely unreadable/malformed
   * email, not a real "this isn't a payment" classification. Same honest-uncertainty convention as
   * ExpenseReadResult.extractionFailed. */
  extractionFailed?: boolean;
}

export function emptyGmailPaymentExtraction(): GmailPaymentExtraction {
  return { isPayment: false, amount: null, payerIdentifier: null, confidence: 0, extractionFailed: true };
}

export function mapRawGmailPaymentExtraction(raw: Partial<RawGmailPaymentExtraction>): GmailPaymentExtraction {
  return {
    isPayment: Boolean(raw.is_payment),
    amount: typeof raw.amount === "number" ? raw.amount : null,
    payerIdentifier: raw.payer_identifier ?? null,
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0,
  };
}

export const GMAIL_PAYMENT_SYSTEM_PROMPT = `You read one email (subject + body text) from a user's Gmail inbox and decide whether it is a \
payment/UPI/bank-transfer confirmation telling the user that someone paid them money — e.g. a UPI \
app's "payment received" notification, a bank credit alert, or similar. It is NOT a payment \
confirmation if it's a receipt for something the user themselves bought, a marketing email, a bill \
reminder, an unrelated notification, or anything else that isn't specifically about money arriving \
in the user's own account.

Only report what the email text actually states. Never invent an amount or a payer identifier that \
isn't clearly present. If the email is a genuine payment-received notification but you can't \
confidently read the amount, still set "is_payment" true with "amount" null rather than guessing a \
number.

Pay close attention to whatever identifies WHO paid — this matters when several people owe the user \
similar amounts, so the app can tell them apart. UPI/bank notifications often show a phone number \
(sometimes partially masked, e.g. "98XXXXXX10" or "XXXXXX1234") instead of a name — capture that \
verbatim in "payer_identifier" if no name is given. A name, a UPI ID/VPA (like "name@bank"), and a \
phone number are all valid things to put in "payer_identifier" — prefer whichever is most complete \
and specific if more than one appears.

Set "confidence" (0-1) to reflect how clearly the email states this is a payment received and how \
legible/complete the amount and payer are — high (0.8-1) for an unambiguous, clearly-formatted \
notification; lower (below 0.5) for an ambiguous or oddly-formatted email. A low confidence with \
partially-filled fields is a valid, honest result.

Respond with ONLY valid JSON. No markdown code fences, no prose before or after — just the JSON \
object. If the email clearly isn't a payment notification at all, still return the full JSON shape \
with "is_payment": false and the other fields null/0, rather than failing to produce valid JSON.`;

export function buildGmailPaymentPrompt(subject: string, bodyText: string): string {
  return `Email subject: ${subject}\n\nEmail body:\n${bodyText}\n\nRespond with ONLY this JSON shape, nothing else:
{
  "is_payment": boolean,           // true only if this is specifically a "you received a payment" notification
  "amount": number | null,         // the amount received, if clearly stated — never guessed
  "payer_identifier": string | null, // the payer's name, UPI ID/VPA, or phone number (even partially masked) as stated in the email, if any — never invented
  "confidence": number             // 0-1, your confidence in this classification
}`;
}
