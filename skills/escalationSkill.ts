/**
 * Escalation Skill — decides the DEFAULT tone for every reminder about a debt, based on how many
 * times this exact debt has already been successfully reminded about
 * (`ReminderContext.history.remindersForThisDebt`, from skills/contextSkill.ts). Used both for the
 * first reminder (POST /debts/:id/generate-message, reviewed by the user before sending) and for
 * every automatic follow-up (backend/reminders/scheduler.ts).
 *
 * The tone returned here is the ladder's default, not an order: it's passed as `ladderTone`, and the
 * person's context (relationship, description, additionalContext) overrides it in either direction —
 * gentler for someone going through a hard time, further along for someone the context says always
 * ghosts — see REMINDER_SYSTEM_PROMPT's "CONTEXT OVERRIDES THE LADDER". The formal cap below is the
 * one override enforced in code rather than left to the model.
 *
 * The ladder is a deliberate, smooth build — one step per reminder, never random:
 *
 *   reminder 1   Casual          (the first send, reviewed by the user)
 *   reminder 2   Casual          (second nudge, a touch more pointed)
 *   reminder 3   Passive-Aggressive
 *   reminder 4   Annoyed
 *   reminder 5   Slightly Angry
 *   reminder 6   Angry
 *   reminder 7   Very Angry
 *   reminder 8+  Unhinged        (very weird — and weird in a new way every time)
 *
 * Reproduced directly against the real app earlier: forcing two consecutive follow-ups to the same
 * tone label, distinguished only by a prompt note, did NOT reliably escalate. So every step up to the
 * ceiling has its own distinct tone label, and every follow-up also receives the literal previous
 * message (see debtCollectorAgent.generateDraft's `previousMessage`) with an explicit "one step
 * further along the ladder than this" instruction (buildReminderPrompt in backend/ai/types.ts).
 *
 * Every message is still written from the debt's real context — who the person is, the exact
 * relationship, what it was for, where (debt.place), the items, how long it's been — the tone only
 * decides register. See REMINDER_SYSTEM_PROMPT's "ESCALATION LADDER" section.
 *
 * Ceiling: "Unhinged" — surreal/absurd, never a threat, harassment or abuse (hard-banned in the
 * prompt, and it matters more here since nothing reviews these before they send). It repeats from
 * reminder 8 on, but each one must be weird in a genuinely different way from the last.
 *
 * Formal ceiling: whenever skills/formalitySkill.ts's `shouldStayFormal` is true (professor, boss,
 * client, senior, or a manual per-person override), the ladder stops at a restrained, polite
 * "Annoyed" and never reaches the angry steps or Unhinged. This is a hard, code-level cap — the
 * relationship constrains what escalation is allowed to pick, not the other way around.
 */

import type { Tone } from "../backend/ai/types.js";

export interface EscalationStage {
  /** The forced tone label passed straight through to draftReminderMessage's `forcedTone`. */
  tone: Tone;
  /** The reminder number about to be sent (2, 3, 4…). Purely descriptive/for logging. */
  stage: number;
  /** Appended to the generation prompt via buildReminderPrompt's `escalationNote`. */
  note: string;
}

interface LadderStep {
  tone: Tone;
  instruction: string;
}

const CONTEXT_REMINDER =
  "Build it from the real context: this person's relationship and description, what it was for " +
  "(debt.reason / debt.items), where it was (debt.place), and how long it's been.";

/** Index = reminder number - 1. The last entry repeats for every reminder after it. */
const LADDER: LadderStep[] = [
  { tone: "Casual", instruction: "Relaxed, friendly first nudge." },
  {
    tone: "Casual",
    instruction:
      "Still casual and friendly, but a touch more pointed than the first reminder (a light 'hey again' " +
      "energy). Not annoyed yet.",
  },
  {
    tone: "Passive-Aggressive",
    instruction:
      "Passive-aggressive: still technically polite and friendly on the surface, but with a pointed, " +
      "sweetly sarcastic edge (the 'no worries!! just checking again :)' energy, pointed 'as I mentioned' " +
      "vibes). Not openly annoyed or angry yet.",
  },
  {
    tone: "Annoyed",
    instruction:
      "Past the passive-aggressive politeness: patience openly thinning, mildly exasperated, a little dry, " +
      "clearly noticing how many times this has been asked. Not angry yet.",
  },
  {
    tone: "Slightly Angry",
    instruction:
      "Now actually irritated. Shorter and firmer than before, much less joking, clearly wants it " +
      "sorted today.",
  },
  {
    tone: "Angry",
    instruction: "Genuinely angry. No jokes, no softening, blunt and out of patience.",
  },
  {
    tone: "Very Angry",
    instruction:
      "As angry as a real person gets over this: terse, heated, completely done asking nicely. Still " +
      "no threats, no insults about who they are, no abuse.",
  },
  {
    tone: "Unhinged",
    instruction:
      "The anger has snapped into something VERY WEIRD: surreal, deranged-sounding, theatrical and " +
      "absurd, e.g. addressing the items as if they're alive or haunting you, a bizarre ritual or " +
      "prophecy about the money, conspiracy-level drama about the place, an unsettlingly calm tone " +
      "that is obviously not calm. Weird in a funny way, never scary: no threats of any kind (not even " +
      "jokey ones), no harassment, no abuse. If an earlier reminder was already Unhinged, be weird in " +
      "a completely different way this time.",
  },
];

/**
 * @param remindersForThisDebt How many reminders have already been SENT for this exact debt
 * (0 = about to send the very first one — callers of this module should never actually hit that
 * case, since reminder 1 is always the manual, user-chosen-tone send).
 * @param formal When true (skills/formalitySkill.ts's `shouldStayFormal`), caps the ladder at a
 * restrained "Annoyed" forever.
 */
export function escalationForFollowUp(remindersForThisDebt: number, formal: boolean): EscalationStage {
  const upcomingReminderNumber = remindersForThisDebt + 1;
  const header =
    upcomingReminderNumber === 1
      ? "This is the FIRST reminder for this debt; the user reviews it before it's sent."
      : `This is automatic follow-up #${upcomingReminderNumber} for this exact debt, generated and sent with ` +
        "no human review.";

  if (formal) {
    const tone: Tone = upcomingReminderNumber <= 2 ? "Casual" : "Annoyed";
    return {
      tone,
      stage: upcomingReminderNumber,
      note:
        `${header} This person's relationship context (professor, boss, client, senior, or similar) ` +
        "OVERRIDES normal escalation: " +
        (tone === "Casual"
          ? "keep it a polite, friendly, low-key nudge. "
          : "be firmer and more direct about wanting it paid than before, but stay restrained, polite and " +
            "respectful — never blunt, sarcastic, angry or weird, no matter how many reminders have gone out. ") +
        CONTEXT_REMINDER,
    };
  }

  const step = LADDER[Math.min(upcomingReminderNumber, LADDER.length) - 1];
  return {
    tone: step.tone,
    stage: upcomingReminderNumber,
    note:
      `${header} Ladder default step: "${step.tone}" — ${step.instruction} ${CONTEXT_REMINDER} ` +
      "This step is the default only: if the person's context calls for gentler or harsher, the context wins.",
  };
}
