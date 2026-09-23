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
  keepFormal?: boolean;
}

export function addPerson(userId: number, input: CreatePersonInput): Promise<Person> {
  return createPerson(userId, input);
}

export function findOrCreatePerson(userId: number, input: CreatePersonInput): Promise<Person> {
  return getOrCreatePerson(userId, input);
}

export function findPersonById(userId: number, id: number): Promise<Person | undefined> {
  return getPerson(userId, id);
}

export function findPersonByUsername(userId: number, telegramUsername: string): Promise<Person | undefined> {
  return getPersonByUsername(userId, telegramUsername);
}

export function listPeople(userId: number): Promise<PersonWithStats[]> {
  return listPeopleWithStats(userId);
}

export function editPerson(
  userId: number,
  id: number,
  patch: Partial<{
    name: string;
    relationship: string | null;
    notes: string | null;
    phoneNumber: string | null;
    keepFormal: boolean;
  }>
): Promise<Person | undefined> {
  return updatePerson(userId, id, patch);
}

/** A person can be sent to for real only once the poller has seen a genuine incoming message from them. */
export function isTelegramVerified(person: Person): boolean {
  return Boolean(person.telegram_verified);
}

/** Removes a person and only that person — never their expenses/debts (a real DB foreign key blocks this while any debt still references them). */
export function removePerson(userId: number, id: number): Promise<boolean> {
  return deletePerson(userId, id);
}
