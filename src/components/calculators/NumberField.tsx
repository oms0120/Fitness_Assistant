"use client";

interface Props {
  label: string;
  unit?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  step?: string;
}

export function NumberField({ label, unit, value, onChange, error, step = "0.1" }: Props) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        {unit && <span className="text-sm text-zinc-500">{unit}</span>}
      </div>
      {error && <span className="mt-1 block text-sm text-red-500">{error}</span>}
    </label>
  );
}
