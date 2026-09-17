import { z } from "zod";
import { getDraft } from "../draftStore.js";
export const getDraftStatusInputSchema = z.object({
    draft_id: z.string().min(1).describe("The draftId returned by create_debt_reminder_draft"),
});
export function getDraftStatus(input) {
    const { draft_id } = getDraftStatusInputSchema.parse(input);
    const draft = getDraft(draft_id);
    if (!draft)
        return { found: false };
    return {
        found: true,
        status: draft.status,
        currentText: draft.text,
        approvedText: draft.approvedText,
        sentToRecipient: draft.sentToRecipient,
    };
}
