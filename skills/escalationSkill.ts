/**
 * Escalation Skill — decides which tone (and how strongly) an AUTOMATIC follow-up reminder should
 * use, based purely on how many times this exact debt has already been successfully reminded about
 * (`ReminderContext.history.remindersForThisDebt`, from skills/contextSkill.ts). Only ever consulted
 * by the automatic reminder scheduler (backend/reminders/scheduler.ts) — the FIRST reminder for a
 * debt is always the user's own manually-chosen tone (Casual/Funny/Unhinged), sent through the
 * normal review flow in frontend/src/pages/AddExpenseFlow.tsx, and never touches this module.
 *
 * "Angry" is a real, distinct tone value in TONES (backend/ai/types.ts) alongside the original four —
 * it is used ONLY by this escalation ladder, never exposed as a manual tone-picker option anywhere in
 * the frontend (the only tone-picker UI, AddExpenseFlow.tsx's INITIAL_TONES, still lists just
 * Casual/Funny/Unhinged). It is deliberately NOT the same register as "Unhinged": Unhinged is
 * comedic/dramatic chaos, Angry is genuinely blunt and fed up with no jokes — see
 * REMINDER_SYSTEM_PROMPT's own paragraph distinguishing the two. The user explicitly asked for the
 * escalation ceiling to read as really angry, not as the app's existing funny/absurd "Unhinged" bit.
 *
 * Reproduced directly against the real app: forcing TWO consecutive automatic follow-ups to the same
 * tone label ("Passive-Aggressive" at both stage 2 and stage 3), distinguished only by an abstract
 * prompt note, did NOT reliably escalate — the stage-3 message came out milder than stage 2. A real
 * tone-LABEL jump (Passive-Aggressive -> something else) landed hard and reliably. So the ladder below
 * never repeats a tone label on consecutive stages, and every stage also receives the literal previous
 * message (see scheduler.ts's `previousMessage` argument to draftReminderMessage) with an explicit
 * "must sound meaner than that exact message" instruction (see buildReminderPrompt's escalation-aware
 * branch in backend/ai/types.ts) — a concrete anchor to escalate from, instead of hoping the model
 * infers "more" from a count alone.
 *
 * Ceiling: reminder 3 and every automatic reminder after it (3, 4, 5...) all resolve to stage 3 and
 * reuse the same "Angry" tone. Escalating indefinitely beyond genuinely angry-but-not-abusive would
 * risk crossing into a real threat or harassment — which REMINDER_SYSTEM_PROMPT hard-bans even for
 * "Angry"/"Unhinged", and matters more here since nothing reviews these before they send. Holding at
 * the angriest-but-still-safe register is the deliberate ceiling, not a gap.
 */

import type { Tone } from "../backend/ai/types.js";

export interface EscalationStage {
  /** The forced tone label passed straight through to draftReminderMessage's `forcedTone`. */
  tone: Tone;
  /** 2 or 3 — 3 also covers every reminder after the third. Purely descriptive/for logging. */
  stage: 2 | 3;
  /** Appended to the generation prompt via buildReminderPrompt's `escalationNote`. */
  note: string;
}

/**
 * @param remindersForThisDebt How many reminders have already been SENT for this exact debt
 * (0 = about to send the very first one — callers of this module should never actually hit that
 * case, since reminder 1 is always the manual, user-chosen-tone send).
 */
export function escalationForFollowUp(remindersForThisDebt: number): EscalationStage {
  const upcomingReminderNumber = remindersForThisDebt + 1;

  if (remindersForThisDebt <= 1) {
    return {
      tone: "Passive-Aggressive",
      stage: 2,
      note:
        `This is automatic follow-up #${upcomingReminderNumber} for this exact debt, generated and sent with ` +
        "no human review. Turn noticeably more passive-aggressive than a first reminder would be, " +
        "still short and believable as a real text, still clearly about the same expense.",
    };
  }

  return {
    tone: "Angry",
    stage: 3,
    note:
      `This is automatic follow-up #${upcomingReminderNumber} for this exact debt, generated and sent with ` +
      "no human review. This is genuinely angry, not a joke or a bit: short, blunt, visibly out of " +
      "patience, still shaped by the relationship (restrained/terse for a professor or distant " +
      "acquaintance, blunter and more informal for a close friend or sibling). No absurd imagery, no " +
      "comedic exaggeration. This must NEVER cross into a real threat, harassment, or abusive language, " +
      "no matter how many times this same debt has already been reminded about. Hold at this same " +
      "maximum register rather than trying to escalate further than this.",
  };
}
