/**
 * Unhinged Debt Collector Skill.
 *
 * Pure, state-aware debt-information collector. It has no knowledge of
 * Telegram or any other transport — it only reads/writes session state via
 * ./debtFormStore.ts and returns a structured result describing what's
 * still missing. An agent (see ../agent/debtCollectorAgent.ts) is
 * responsible for invoking this Skill repeatedly, one incoming user message
 * at a time, and for actually sending `next_question` / the completion
 * summary over Telegram.
 */

import {
  startSession,
  getSession,
  clearSession,
  type DebtFormSession,
  type DebtFormFields,
} from "./debtFormStore.js";

const TRIGGER_WORDS = new Set(["hi", "hello", "hey", "start"]);

export interface DebtContextJSON {
  person_name: string | null;
  telegram_username: string | null;
  amount_owed: string | null;
  debt_reason: string | null;
  overdue_duration: string | null;
  relationship: string | null;
  previously_reminded: boolean | null;
  previous_reminder_count: number | null;
  additional_context: string | null;
  tone: string | null;
}

export type DebtCollectorFieldKey = keyof DebtFormFields;

export interface DebtCollectorSkillResult {
  status: "collecting" | "complete";
  next_field: DebtCollectorFieldKey | null;
  next_question: string | null;
  debt_context: DebtContextJSON;
  /** Validation problem with the message that was just processed, if any. */
  error?: string;
  /** True the one time this call started a brand-new session (trigger word). */
  justStarted?: boolean;
}

type SimpleFieldKey = Exclude<
  DebtCollectorFieldKey,
  "previously_reminded" | "previous_reminder_count"
>;

interface Question {
  field: SimpleFieldKey | "previously_reminded";
  prompt: (fields: DebtFormFields) => string;
}

/** Ordered walk through the fields; the conditional reminder-count follow-up is handled separately. */
const QUESTIONS: Question[] = [
  { field: "person_name", prompt: () => "Who owes you money?" },
  { field: "telegram_username", prompt: (f) => `What's ${f.person_name}'s Telegram username?` },
  { field: "amount_owed", prompt: (f) => `How much does ${f.person_name} owe you?` },
  { field: "debt_reason", prompt: () => "What's the debt for?" },
  { field: "overdue_duration", prompt: () => "How long has it been overdue?" },
  { field: "relationship", prompt: (f) => `What's your relationship with ${f.person_name}?` },
  { field: "previously_reminded", prompt: (f) => `Have you reminded ${f.person_name} before? Yes/No` },
  { field: "additional_context", prompt: () => "Any additional context? (optional — reply 'skip' to leave blank)" },
  { field: "tone", prompt: () => "Any preferred tone for the reminder? (optional — reply 'skip' to leave blank)" },
];

/** Optional fields where the user may reply "skip" to leave them blank instead of typing something. */
const SKIPPABLE_FIELDS = new Set<SimpleFieldKey>(["additional_context", "tone"]);

const REMINDER_COUNT_PROMPT = "How many times have you reminded them?";

function isTriggerMessage(text: string): boolean {
  return TRIGGER_WORDS.has(text.trim().toLowerCase());
}

function parseYesNo(text: string): boolean | undefined {
  const normalized = text.trim().toLowerCase();
  if (normalized === "yes" || normalized === "y") return true;
  if (normalized === "no" || normalized === "n") return false;
  return undefined;
}

function isAwaitingReminderCount(session: DebtFormSession): boolean {
  return (
    session.fields.previously_reminded === true &&
    session.fields.previous_reminder_count === undefined
  );
}

function toDebtContext(fields: DebtFormFields): DebtContextJSON {
  return {
    person_name: fields.person_name ?? null,
    telegram_username: fields.telegram_username ?? null,
    amount_owed: fields.amount_owed ?? null,
    debt_reason: fields.debt_reason ?? null,
    overdue_duration: fields.overdue_duration ?? null,
    relationship: fields.relationship ?? null,
    previously_reminded: fields.previously_reminded ?? null,
    previous_reminder_count: fields.previous_reminder_count ?? null,
    additional_context: fields.additional_context ?? null,
    tone: fields.tone ?? null,
  };
}

function buildResult(
  session: DebtFormSession,
  options: { error?: string; justStarted?: boolean } = {}
): DebtCollectorSkillResult {
  if (session.step >= QUESTIONS.length) {
    const debt_context = toDebtContext(session.fields);
    clearSession(session.chatId);
    return { status: "complete", next_field: null, next_question: null, debt_context };
  }

  const debt_context = toDebtContext(session.fields);

  if (isAwaitingReminderCount(session)) {
    return {
      status: "collecting",
      next_field: "previous_reminder_count",
      next_question: REMINDER_COUNT_PROMPT,
      debt_context,
      ...options,
    };
  }

  const question = QUESTIONS[session.step];
  return {
    status: "collecting",
    next_field: question.field,
    next_question: question.prompt(session.fields),
    debt_context,
    ...options,
  };
}

/**
 * Runs one step of the collection loop for a single incoming message.
 *
 * Returns `undefined` when this Skill has nothing to do with the message
 * (no active session and the text isn't a trigger word), so the caller can
 * let some other handler look at it. Otherwise returns the updated
 * structured state: `status: "collecting"` means the agent should ask
 * `next_question` and invoke the Skill again with the reply; `status:
 * "complete"` means `debt_context` is fully populated and the loop should
 * stop.
 */
export function invokeDebtCollectorSkill(
  chatId: string | number,
  rawText: string
): DebtCollectorSkillResult | undefined {
  const text = rawText.trim();
  if (!text) return undefined;

  let session = getSession(chatId);

  if (!session) {
    if (!isTriggerMessage(text)) return undefined;
    session = startSession(chatId);
    return buildResult(session, { justStarted: true });
  }

  if (isAwaitingReminderCount(session)) {
    const count = Number.parseInt(text, 10);
    if (Number.isNaN(count)) {
      return buildResult(session, { error: "Please reply with a number." });
    }
    session.fields.previous_reminder_count = count;
    session.step += 1;
    return buildResult(session);
  }

  const question = QUESTIONS[session.step];
  if (!question) {
    return buildResult(session);
  }

  if (question.field === "previously_reminded") {
    const answer = parseYesNo(text);
    if (answer === undefined) {
      return buildResult(session, { error: "Please reply Yes or No." });
    }
    session.fields.previously_reminded = answer;
    if (!answer) {
      session.fields.previous_reminder_count = 0;
      session.step += 1;
    }
    return buildResult(session);
  }

  const isSkip = SKIPPABLE_FIELDS.has(question.field) && text.toLowerCase() === "skip";
  if (!isSkip) {
    session.fields[question.field] = text;
  }
  session.step += 1;
  return buildResult(session);
}
