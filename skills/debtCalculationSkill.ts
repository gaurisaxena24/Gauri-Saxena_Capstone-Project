/**
 * Debt Calculation Skill — deterministic arithmetic only. Groq never
 * computes a share; this is plain code so the number is always exactly
 * right and reproducible.
 */

export type ShareMode = "FULL" | "HALF" | "CUSTOM";

export class InvalidShareError extends Error {}

export function computeShare(mode: ShareMode, expenseTotal: number, customAmount?: number): number {
  switch (mode) {
    case "FULL":
      return expenseTotal;
    case "HALF":
      return expenseTotal / 2;
    case "CUSTOM": {
      const amount = Number(customAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new InvalidShareError("Enter a valid custom amount greater than 0.");
      }
      return amount;
    }
    default:
      throw new InvalidShareError("mode must be 'FULL', 'HALF' or 'CUSTOM'.");
  }
}
