const VARIANT_STYLES = {
  positive: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
} as const;

function Icon({ variant }: { variant: keyof typeof VARIANT_STYLES }) {
  if (variant === "positive") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 9v4M12 16.5h.01" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M10.6 4.2 2.9 17.5a1.5 1.5 0 0 0 1.3 2.25h15.6a1.5 1.5 0 0 0 1.3-2.25L13.4 4.2a1.5 1.5 0 0 0-2.8 0Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function InsightList({
  label,
  items,
  variant,
}: {
  label: string;
  items: string[];
  variant: keyof typeof VARIANT_STYLES;
}) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </span>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <span className={`mt-0.5 shrink-0 ${VARIANT_STYLES[variant]}`}>
              <Icon variant={variant} />
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
