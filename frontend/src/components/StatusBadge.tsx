export function StatusBadge({ status }: { status: "PAID" | "UNPAID" }) {
  return status === "PAID" ? (
    <span className="inline-flex items-center rounded-full bg-[var(--color-success-soft)] px-2.5 py-1 text-xs font-medium text-[var(--color-success)]">
      Paid
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-[var(--color-accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent-dark)]">
      Unpaid
    </span>
  );
}
