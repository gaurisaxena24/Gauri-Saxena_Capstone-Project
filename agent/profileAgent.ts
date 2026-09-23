/**
 * Profile Agent ("Store Agent") — the addressable interface debtCollectorAgent
 * (Main Agent) calls for everything about a person's identity: creating,
 * finding, listing, editing, and checking Telegram-verification status.
 * Delegates to skills/profileSkill.ts for the actual database work.
 */

import * as profileSkill from "../skills/profileSkill.js";
import type { Person, PersonWithStats } from "../backend/database/database.js";
import type { CreatePersonInput } from "../skills/profileSkill.js";

export type { CreatePersonInput };

export function addPerson(userId: number, input: CreatePersonInput): Promise<Person> {
  return profileSkill.addPerson(userId, input);
}

// Deliberately requires telegramUsername (unlike CreatePersonInput, where it's optional) — see
// profileSkill.findOrCreatePerson's own comment for why its find-by-username contract can't take an
// optional lookup key.
export function findOrCreatePerson(
  userId: number,
  input: { name: string; telegramUsername: string; relationship?: string }
): Promise<Person> {
  return profileSkill.findOrCreatePerson(userId, input);
}

export function findPersonById(userId: number, id: number): Promise<Person | undefined> {
  return profileSkill.findPersonById(userId, id);
}

export function findPersonByUsername(userId: number, telegramUsername: string): Promise<Person | undefined> {
  return profileSkill.findPersonByUsername(userId, telegramUsername);
}

export function listPeople(userId: number): Promise<PersonWithStats[]> {
  return profileSkill.listPeople(userId);
}

export function editPerson(
  userId: number,
  id: number,
  patch: Partial<{ name: string; relationship: string | null; notes: string | null; phoneNumber: string | null }>
): Promise<Person | undefined> {
  return profileSkill.editPerson(userId, id, patch);
}

export function isTelegramVerified(person: Person): boolean {
  return profileSkill.isTelegramVerified(person);
}

export function removePerson(userId: number, id: number): Promise<boolean> {
  return profileSkill.removePerson(userId, id);
}
