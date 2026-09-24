/** Green = Paid, red = Unpaid, in both light and dark mode (colors from index.css). */
export function StatusBadge({ status }: { status: "PAID" | "UNPAID" }) {
  const paid = status === "PAID";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        paid
          ? "bg-[var(--color-success-badge-bg)] text-[var(--color-success-badge-text)]"
          : "bg-[var(--color-unpaid-badge-bg)] text-[var(--color-unpaid-badge-text)]"
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {paid ? "Paid" : "Unpaid"}
    </span>
  );
}
