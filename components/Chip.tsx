const VARIANT_STYLES = {
  positive: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  warning: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  neutral: "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400",
} as const;

export function Chip({
  children,
  variant = "neutral",
}: {
  children: React.ReactNode;
  variant?: keyof typeof VARIANT_STYLES;
}) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${VARIANT_STYLES[variant]}`}>
      {children}
    </span>
  );
}
