/**
 * Profile Skill — owns everything about a person: creating, updating,
 * finding, and their Telegram verification status. Debt/expense history for
 * a profile is read via debtSkill, not duplicated here.
 */

import {
  createPerson,
  deletePerson,
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

export function addPerson(input: CreatePersonInput): Promise<Person> {
  return createPerson(input);
}

export function findOrCreatePerson(input: CreatePersonInput): Promise<Person> {
  return getOrCreatePerson(input);
}

export function findPersonById(id: number): Promise<Person | undefined> {
  return getPerson(id);
}

export function findPersonByUsername(telegramUsername: string): Promise<Person | undefined> {
  return getPersonByUsername(telegramUsername);
}

export function listPeople(): Promise<PersonWithStats[]> {
  return listPeopleWithStats();
}

export function editPerson(
  id: number,
  patch: Partial<{ name: string; relationship: string | null; notes: string | null; phoneNumber: string | null }>
): Promise<Person | undefined> {
  return updatePerson(id, patch);
}

/** A person can be sent to for real only once the poller has seen a genuine incoming message from them. */
export function isTelegramVerified(person: Person): boolean {
  return Boolean(person.telegram_verified);
}

/** Removes a person and only that person — never their expenses/debts (a real DB foreign key blocks this while any debt still references them). */
export function removePerson(id: number): Promise<boolean> {
  return deletePerson(id);
}
