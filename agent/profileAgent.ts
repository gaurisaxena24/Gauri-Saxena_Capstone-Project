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

export function addPerson(input: CreatePersonInput): Promise<Person> {
  return profileSkill.addPerson(input);
}

export function findOrCreatePerson(input: CreatePersonInput): Promise<Person> {
  return profileSkill.findOrCreatePerson(input);
}

export function findPersonById(id: number): Promise<Person | undefined> {
  return profileSkill.findPersonById(id);
}

export function findPersonByUsername(telegramUsername: string): Promise<Person | undefined> {
  return profileSkill.findPersonByUsername(telegramUsername);
}

export function listPeople(): Promise<PersonWithStats[]> {
  return profileSkill.listPeople();
}

export function editPerson(
  id: number,
  patch: Partial<{ name: string; relationship: string | null; notes: string | null; phoneNumber: string | null }>
): Promise<Person | undefined> {
  return profileSkill.editPerson(id, patch);
}

export function isTelegramVerified(person: Person): boolean {
  return profileSkill.isTelegramVerified(person);
}

export function removePerson(id: number): Promise<boolean> {
  return profileSkill.removePerson(id);
}
