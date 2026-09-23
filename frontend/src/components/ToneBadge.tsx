const TONE_STYLES: Record<string, string> = {
  Casual: "bg-[var(--color-tone-casual-soft)] text-[var(--color-tone-casual)]",
  Funny: "bg-[var(--color-tone-funny-soft)] text-[var(--color-tone-funny)]",
  "Passive-Aggressive": "bg-[var(--color-tone-funny-soft)] text-[var(--color-tone-funny)]",
  Annoyed: "bg-[var(--color-tone-passive-soft)] text-[var(--color-tone-passive)]",
  "Slightly Angry": "bg-[var(--color-tone-mad-soft)] text-[var(--color-tone-mad)]",
  Angry: "bg-[var(--color-tone-angry-soft)] text-[var(--color-tone-angry)]",
  "Very Angry": "bg-[var(--color-tone-furious-soft)] text-[var(--color-tone-furious)]",
  Unhinged: "bg-[var(--color-tone-unhinged-soft)] text-[var(--color-tone-unhinged)]",
};

export function ToneBadge({ tone }: { tone: string | null }) {
  if (!tone) return null;
  const style = TONE_STYLES[tone] ?? "bg-ink/5 text-ink-soft";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${style}`}>
      {tone}
    </span>
  );
}
