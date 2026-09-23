export class ApiError extends Error {
  status: number;
  aiNotConfigured: boolean;
  notVerified: boolean;

  constructor(status: number, message: string, aiNotConfigured = false, notVerified = false) {
    super(message);
    this.status = status;
    this.aiNotConfigured = aiNotConfigured;
    this.notVerified = notVerified;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    // Carries the session cookie (see backend/api/middleware/requireAuth.ts) on every request —
    // same-origin by default already sends it, but this makes it explicit and correct if frontend
    // and API ever end up on different origins.
    credentials: "include",
    headers:
      init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json", ...init.headers }
        : init?.headers,
  });

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // no body
  }

  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(
      res.status,
      message,
      Boolean((data as { aiNotConfigured?: boolean } | null)?.aiNotConfigured),
      Boolean((data as { notVerified?: boolean } | null)?.notVerified)
    );
  }

  return data as T;
}

const json = (body: unknown) => JSON.stringify(body);

// ---- Auth -----------------------------------------------------------------

export interface AuthedUser {
  id: number;
  telegramUsername: string;
}

export const login = (telegramUsername: string) =>
  request<AuthedUser>("/auth/login", { method: "POST", body: json({ telegramUsername }) });

export const logoutApi = () => request<{ loggedOut: true }>("/auth/logout", { method: "POST" });

/** Verifies the session cookie against the server rather than trusting the cached localStorage
 * blob — see frontend/src/context/AuthContext.tsx. Throws (401) if not logged in. */
export const getCurrentUser = () => request<AuthedUser>("/auth/me");

export interface HealthStatus {
  aiConfigured: boolean;
  telegramConfigured: boolean;
  gmailConfigured: boolean;
  /** Minutes between automatic follow-up reminders once a debt's first reminder has been sent — see backend/reminders/schedulerConfig.ts. */
  reminderIntervalMinutes: number;
  /** The bot's real @username (no leading @), fetched from Telegram's getMe and cached server-side. Null if Telegram isn't configured or the lookup failed. */
  botUsername: string | null;
}

export const getHealth = () => request<HealthStatus>("/health");

// ---- Gmail -----------------------------------------------------------------

export interface GmailStatus {
  connected: boolean;
  emailAddress?: string;
  connectedAt?: string;
}

export const getGmailStatus = () => request<GmailStatus>("/gmail/status");

export const verifyGmail = () =>
  request<{ verified: boolean; emailAddress?: string; reason?: string }>("/gmail/verify", { method: "POST" });

export const disconnectGmail = () => request<{ connected: false }>("/gmail/disconnect", { method: "POST" });

// ---- Optional Google API key -------------------------------------------------
// Separate from Gmail (which is OAuth-based, not a pasted key) — kept available in Settings but
// not currently required or consumed by anything.

export interface GoogleApiKeyStatus {
  configured: boolean;
  /** False if the server itself isn't set up to store any encrypted secret yet
   * (CREDENTIAL_ENCRYPTION_KEY unset) — saving is unavailable until then, independent of Gmail. */
  encryptionConfigured?: boolean;
  maskedKey?: string;
}

export const getGoogleApiKeyStatus = () => request<GoogleApiKeyStatus>("/settings/google-api-key");

/** Pass an empty string to clear the saved key. */
export const saveGoogleApiKey = (apiKey: string) =>
  request<GoogleApiKeyStatus>("/settings/google-api-key", { method: "POST", body: json({ apiKey }) });

// ---- People -----------------------------------------------------------------

export interface PersonSummary {
  id: number;
  name: string;
  telegramUsername: string;
  relationship: string | null;
  phoneNumber: string | null;
  telegramVerified: boolean;
  totalOwed: number;
  openDebts: number;
  keepFormal: boolean;
}

export interface PersonDebtSummary {
  id: number;
  expenseId: number;
  amount: number;
  status: "UNPAID" | "PAID";
  createdAt: string;
  paidAt: string | null;
  merchant: string | null;
  category: string | null;
}

export interface ReminderSummary {
  id: number;
  debtId: number;
  personId: number | null;
  personName: string | null;
  message: string;
  tone: string | null;
  status: "SENT" | "FAILED";
  createdAt: string;
  sentAt: string | null;
  telegramMessageId: string | null;
}

export interface PersonDetail {
  id: number;
  name: string;
  telegramUsername: string;
  relationship: string | null;
  notes: string | null;
  phoneNumber: string | null;
  telegramVerified: boolean;
  telegramChatId: string | null;
  verificationCode: string;
  debts: PersonDebtSummary[];
  reminders: ReminderSummary[];
  keepFormal: boolean;
}

export const listPeople = () => request<{ people: PersonSummary[] }>("/people");

export const getPerson = (id: number) => request<PersonDetail>(`/people/${id}`);

export const createPerson = (input: {
  name: string;
  telegramUsername: string;
  relationship?: string;
  notes?: string;
  phoneNumber?: string;
  keepFormal?: boolean;
}) => request<PersonDetail>("/people", { method: "POST", body: json(input) });

export const updatePerson = (
  id: number,
  patch: Partial<{ name: string; relationship: string; notes: string; phoneNumber: string; keepFormal: boolean }>
) => request<PersonDetail>(`/people/${id}`, { method: "PATCH", body: json(patch) });

/** Removes this person only — never their expenses. */
export const removePerson = (id: number) => request<void>(`/people/${id}`, { method: "DELETE" });

// ---- Expenses -----------------------------------------------------------------

export interface ExpenseLineItem {
  id: string;
  name: string;
  quantity: number | null;
  unitPrice: number | null;
  price: number;
  uncertain: boolean;
}

export type ExpenseSource = "MANUAL" | "IMAGE";

export interface Expense {
  id: number;
  source: ExpenseSource;
  merchant: string | null;
  date: string | null;
  total: number;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  serviceCharge: number | null;
  discount: number | null;
  category: string | null;
  paymentMethod: string | null;
  transactionReference: string | null;
  description: string | null;
  lineItems: ExpenseLineItem[];
  visibleNames: string[];
  imageUrl: string | null;
  confidence: number | null;
  createdAt: string;
  extractionMethod?: "vision" | "ocr";
  extractionFailed?: boolean;
}

export const createManualExpense = (input: {
  amount: number;
  currency?: string;
  date?: string;
  merchant?: string;
  category?: string;
  description?: string;
  paymentMethod?: string;
  notes?: string;
}) => request<Expense>("/expenses", { method: "POST", body: json(input) });

export const extractExpenseFromImage = (file: File) => {
  const form = new FormData();
  form.append("image", file);
  return request<Expense>("/expenses/extract", { method: "POST", body: form });
};

export const updateExpense = (id: number, patch: Partial<Omit<Expense, "id" | "imageUrl" | "source">>) =>
  request<Expense>(`/expenses/${id}`, { method: "PATCH", body: json(patch) });

/**
 * Full inline detail for each person/debt an expense was split into — there is no standalone debt
 * page; this is everything the Expenses page needs to render nested under its expense: amount,
 * paid/unpaid status, the generated reminder message, and the full send history.
 */
export interface ExpenseDebtDetail {
  id: number;
  personId: number | null;
  personName: string | null;
  amount: number;
  currency: string | null;
  status: "UNPAID" | "PAID";
  message: string | null;
  tone: string | null;
  messageEdited: boolean;
  createdAt: string;
  paidAt: string | null;
  reminders: ReminderSummary[];
}

export const getExpense = (id: number) => request<Expense & { debts: ExpenseDebtDetail[] }>(`/expenses/${id}`);

export const listExpenses = () => request<{ expenses: Expense[] }>("/expenses");

/** Removes this expense only — never the person, and never any debt drafted against it. */
export const removeExpense = (id: number) => request<void>(`/expenses/${id}`, { method: "DELETE" });

// ---- Debts -----------------------------------------------------------------

export type ShareMode = "FULL" | "HALF" | "CUSTOM";

export interface DebtSummary {
  id: number;
  expenseId: number;
  personId: number;
  personName: string | null;
  personExists: boolean;
  expenseExists: boolean;
  amount: number;
  currency: string | null;
  status: "UNPAID" | "PAID";
  message: string | null;
  tone: string | null;
  messageEdited: boolean;
  createdAt: string;
  paidAt: string | null;
  expenseMerchant: string | null;
  expenseCategory: string | null;
  shareMode: ShareMode | null;
  additionalContext: string | null;
  desiredAction: string | null;
  selectedItems: Array<{ name: string; amount: number }> | null;
}

export const createDebt = (input: {
  expenseId: number;
  personId: number;
  mode: ShareMode;
  customAmount?: number;
  additionalContext?: string;
  desiredAction?: string;
  selectedItems?: Array<{ name: string; amount: number }>;
}) => request<DebtSummary>("/debts", { method: "POST", body: json(input) });

export const generateMessage = (debtId: number, input: { tone?: string; regenerate?: boolean } = {}) =>
  request<DebtSummary & { reasoning: string }>(`/debts/${debtId}/generate-message`, {
    method: "POST",
    body: json(input),
  });

export const editMessage = (debtId: number, message: string) =>
  request<DebtSummary>(`/debts/${debtId}/message`, { method: "PATCH", body: json({ message }) });

export const sendDebtViaTelegram = (debtId: number) =>
  request<{ success: boolean; note: string }>(`/debts/${debtId}/send`, { method: "POST" });

export const markDebtPaid = (debtId: number) => request<DebtSummary>(`/debts/${debtId}/paid`, { method: "POST" });

/** Removes this debt ("send request") only — never the person or expense it references. */
export const removeDebt = (debtId: number) => request<void>(`/debts/${debtId}`, { method: "DELETE" });

// ---- Dashboard -----------------------------------------------------------------

export interface DashboardData {
  stats: { totalOwed: number; peopleOwing: number; remindersSent: number };
  recent: Array<{
    id: number;
    personId: number | null;
    personName: string | null;
    amount: number;
    status: "UNPAID" | "PAID";
    createdAt: string;
    merchant: string | null;
  }>;
}

export const getDashboard = () => request<DashboardData>("/dashboard");
