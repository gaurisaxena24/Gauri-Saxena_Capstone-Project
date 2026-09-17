/**
 * In-memory session state for the Unhinged Debt Collector Skill's
 * step-by-step form. One session per Telegram chat, mirroring the
 * in-memory Map pattern used by ../../draftStore.ts.
 */
const sessions = new Map();
function key(chatId) {
    return String(chatId);
}
export function startSession(chatId) {
    const session = {
        chatId,
        step: 0,
        fields: {},
        createdAt: Date.now(),
    };
    sessions.set(key(chatId), session);
    return session;
}
export function getSession(chatId) {
    return sessions.get(key(chatId));
}
export function clearSession(chatId) {
    sessions.delete(key(chatId));
}
/** TEMPORARY DEBUG HELPER — remove once the multi-step loop is fully verified. */
export function debugListSessions() {
    return Array.from(sessions.values());
}
