/**
 * Formality Skill — decides whether a person's reminders must stay restrained/professional no
 * matter what tone escalation would otherwise pick. This is the "context overrides tone" rule:
 * relationship context is resolved FIRST, and it caps what escalation (skills/escalationSkill.ts)
 * is allowed to do, rather than escalation deciding the tone and relationship just flavoring the
 * wording within it.
 *
 * Priority order, highest first:
 *  1. `person.keep_formal` — an explicit manual override set on the person's profile. Always wins,
 *     in both directions: true forces formal treatment even if the relationship text doesn't match
 *     any keyword below; the field simply isn't set (0) when the user hasn't opted in, in which case
 *     auto-detection applies.
 *  2. Auto-detected relationship keywords (professor, boss, etc.) — used only when no manual
 *     override is set.
 */

import type { Person } from "../backend/database/database.js";

/** Case-insensitive, whole-word match against a person's free-text `relationship` field. */
const FORMAL_RELATIONSHIP_KEYWORDS = [
  "professor",
  "prof",
  "teacher",
  "boss",
  "manager",
  "client",
  "senior",
  "sir",
  "ma'am",
  "maam",
];

export function isFormalRelationship(relationship: string | null | undefined): boolean {
  if (!relationship) return false;
  const normalized = relationship.toLowerCase();
  return FORMAL_RELATIONSHIP_KEYWORDS.some((keyword) => new RegExp(`\\b${keyword}\\b`).test(normalized));
}

/**
 * The single source of truth for "must this person's reminders stay restrained/professional?" —
 * every caller (escalation ladder, AI context, prompt) goes through this, never re-deriving it.
 */
export function shouldStayFormal(person: Pick<Person, "relationship" | "keep_formal">): boolean {
  if (person.keep_formal) return true;
  return isFormalRelationship(person.relationship);
}
