const VARIANT_STYLES = {
  positive:
    "bg-emerald-100 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20",
  warning:
    "bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
  neutral:
    "bg-violet-100 text-violet-800 border border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20",
} as const;

export function Chip({
  children,
  variant = "neutral",
}: {
  children: React.ReactNode;
  variant?: keyof typeof VARIANT_STYLES;
}) {
  return (
    <span className={`rounded-md px-2.5 py-1 text-xs font-medium ${VARIANT_STYLES[variant]}`}>
      {children}
    </span>
  );
}
