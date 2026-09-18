/**
 * Debt Calculation Agent — the addressable interface debtCollectorAgent
 * (Main Agent) calls to turn a share decision (full/half/custom) into an
 * exact amount. Delegates to skills/debtCalculationSkill.ts — deterministic
 * arithmetic only, Groq is never involved in computing a number.
 */

import { computeShare, InvalidShareError, type ShareMode } from "../skills/debtCalculationSkill.js";

export { InvalidShareError };
export type { ShareMode };

export function calculateShare(mode: ShareMode, expenseTotal: number, customAmount?: number): number {
  return computeShare(mode, expenseTotal, customAmount);
}
