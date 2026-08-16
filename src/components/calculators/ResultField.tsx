interface Props {
  label: string;
  value: string;
  hint?: string;
}

export function ResultField({ label, value, hint }: Props) {
  return (
    <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
      <div className="text-sm text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-400">{hint}</div>}
    </div>
  );
}
