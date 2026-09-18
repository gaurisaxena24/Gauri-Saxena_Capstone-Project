/**
 * Profile Skill — owns everything about a person: creating, updating,
 * finding, and their Telegram verification status. Debt/expense history for
 * a profile is read via debtSkill, not duplicated here.
 */

import {
  createPerson,
  getOrCreatePerson,
  getPerson,
  getPersonByUsername,
  listPeopleWithStats,
  updatePerson,
  type Person,
  type PersonWithStats,
} from "../backend/database/database.js";

export interface CreatePersonInput {
  name: string;
  telegramUsername: string;
  relationship?: string;
  notes?: string;
  phoneNumber?: string;
}

export function addPerson(input: CreatePersonInput): Person {
  return createPerson(input);
}

export function findOrCreatePerson(input: CreatePersonInput): Person {
  return getOrCreatePerson(input);
}

export function findPersonById(id: number): Person | undefined {
  return getPerson(id);
}

export function findPersonByUsername(telegramUsername: string): Person | undefined {
  return getPersonByUsername(telegramUsername);
}

export function listPeople(): PersonWithStats[] {
  return listPeopleWithStats();
}

export function editPerson(
  id: number,
  patch: Partial<{ name: string; relationship: string | null; notes: string | null; phoneNumber: string | null }>
): Person | undefined {
  return updatePerson(id, patch);
}

/** A person can be sent to for real only once the poller has seen a genuine incoming message from them. */
export function isTelegramVerified(person: Person): boolean {
  return Boolean(person.telegram_verified);
}
