export function formatDebtPreview(fields) {
    return (`━━━━━━━━━━━━━━━━\n` +
        `DEBT PREVIEW\n` +
        `━━━━━━━━━━━━━━━━\n\n` +
        `Name: ${fields.name}\n` +
        `Amount: ${fields.amount}\n` +
        `Reason: ${fields.reason}\n` +
        `Overdue: ${fields.overdue_period}\n` +
        `Relationship: ${fields.relationship}\n` +
        `Previous reminder: ${fields.prior_reminder}\n` +
        `Context: ${fields.context || "-"}\n` +
        `Tone: ${fields.tone || "-"}\n\n` +
        `━━━━━━━━━━━━━━━━\n\n` +
        `Do you want to save this debt?`);
}
export function buildDebtPreviewKeyboard(draftId) {
    return {
        inline_keyboard: [
            [
                { text: "Save", callback_data: `save_debt:${draftId}` },
                { text: "Make Changes", callback_data: `edit_debt:${draftId}` },
            ],
        ],
    };
}
export function formatEditableDraftText(fields) {
    return (`Edit any line below and send it back as a single message (keep the "Label:" prefixes). ` +
        `Lines you don't want to change can stay as they are.\n\n` +
        `Name: ${fields.name}\n` +
        `Amount: ${fields.amount}\n` +
        `Reason: ${fields.reason}\n` +
        `Overdue: ${fields.overdue_period}\n` +
        `Relationship: ${fields.relationship}\n` +
        `Previous reminder: ${fields.prior_reminder}\n` +
        `Context: ${fields.context ?? ""}\n` +
        `Tone: ${fields.tone ?? ""}`);
}
export function formatSavedSuffix(id) {
    return `\n\n Debt saved successfully. (id #${id})`;
}
const LABEL_TO_FIELD = {
    name: "name",
    amount: "amount",
    reason: "reason",
    overdue: "overdue_period",
    relationship: "relationship",
    "previous reminder": "prior_reminder",
    context: "context",
    tone: "tone",
};
/**
 * Parses the user's edited text (same "Label: value" shape as
 * formatEditableDraftText) back into structured fields, starting from the
 * existing draft so any line the user didn't touch keeps its current value.
 */
export function parseEditedDraftText(text, base) {
    const updated = { ...base };
    for (const rawLine of text.split("\n")) {
        const line = rawLine.trim();
        if (!line)
            continue;
        const separatorIndex = line.indexOf(":");
        if (separatorIndex === -1)
            continue;
        const label = line.slice(0, separatorIndex).trim().toLowerCase();
        const value = line.slice(separatorIndex + 1).trim();
        const field = LABEL_TO_FIELD[label];
        if (!field)
            continue;
        if (field === "context" || field === "tone") {
            updated[field] = value || undefined;
        }
        else {
            updated[field] = value;
        }
    }
    return updated;
}
