import "dotenv/config";
import { draftReminderMessage, draftThankYouMessage } from "./skills/messageDraftSkill.ts";
import { escalationForFollowUp } from "./skills/escalationSkill.ts";
import { groqCooldownRemainingMs } from "./backend/ai/groqClient.ts";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { return await fn(); } catch (e: any) {
      if (!/limit|rate/i.test(e?.message ?? "")) throw e;
      const wait = Math.max(groqCooldownRemainingMs(), 30_000) + 5_000;
      console.error(`(waiting ${Math.round(wait / 1000)}s for Groq quota)`);
      await sleep(wait);
    }
  }
  throw new Error("gave up waiting for Groq");
}
const base = (over: any = {}) => ({
  person: { name: "Raj", telegramUsername: "rajk99", relationship: "close friend", description: "always forgets to pay, jokes around a lot", formalityLocked: false, ...over },
  debt: { amount: 850, expenseTotal: 1700, currency: "INR", date: "2026-09-20", category: "food", reason: "dinner at Toit", place: "Toit", shareMode: "HALF", additionalContext: null, desiredAction: "Send their share", items: [{ name: "Chicken Biryani", amount: 450 }, { name: "Coke", amount: 120 }] },
  history: { previousDebts: 1, previousReminders: 2, previousPaidDebts: 1, daysOutstanding: 3, lastReminderTone: "Casual", otherOpenDebts: [], remindersForThisDebt: 0, lastToneForThisDebt: null as any },
});
async function gen(label: string, sent: number, ctx: any, prev?: string, lastTone?: string) {
  const e = escalationForFollowUp(sent, ctx.person.formalityLocked);
  ctx.history.remindersForThisDebt = sent;
  ctx.history.daysOutstanding = 3 + sent * 2;
  ctx.history.lastToneForThisDebt = lastTone ?? null;
  const r = await withRetry(() => draftReminderMessage({ context: ctx, ladderTone: e.tone, escalationNote: e.note, followUp: sent > 0, previousMessage: prev }));
  console.log(`\n■ ${label}\n  ladder default: ${e.tone}  →  AI used: ${r.tone}\n  "${r.message}"\n  why: ${r.reasoning.slice(0, 240)}`);
  await sleep(20000);
  return r;
}
const raj = base();
let prev: string | undefined; let lastTone: string | undefined;
const labels = ["1 (first message)", "2 (second nudge)", "3", "4", "5", "6", "7", "8 (ceiling)"];
for (let i = 0; i < labels.length; i++) { const r = await gen(`Raj, reminder ${labels[i]}`, i, raj, prev, lastTone); prev = r.message; lastTone = r.tone; }
await gen("OVERRIDE: Raj 'lost his job last month', reminder 6 (ladder says Angry)", 5, base({ description: "lost his job last month, going through a rough patch" }), "raj seriously, the toit money. today.", "Slightly Angry");
await gen("FORMAL: professor, reminder 6", 5, base({ name: "Dr. Mehta", relationship: "professor", description: null, formalityLocked: true, telegramUsername: null }), "Hi Dr. Mehta, a small note that the ₹850 from the department dinner is still pending.", "Annoyed");
const ty = await withRetry(() => draftThankYouMessage({ ...raj, history: { ...raj.history, remindersForThisDebt: 8, lastToneForThisDebt: "Unhinged", daysOutstanding: 19 } } as any, "gmail"));
console.log(`\n■ THANK-YOU after 8 reminders (last one Unhinged), found by Gmail Sync\n  "${ty}"`);
console.log("\nDONE")