export function StatusBadge({ status }: { status: "PAID" | "UNPAID" }) {
  return status === "PAID" ? (
    <span className="inline-flex items-center rounded-full bg-[var(--color-success-badge-bg)] px-2.5 py-1 text-xs font-medium text-[var(--color-success-badge-text)]">
      Paid
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-[var(--color-accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent-dark)]">
      Unpaid
    </span>
  );
}
