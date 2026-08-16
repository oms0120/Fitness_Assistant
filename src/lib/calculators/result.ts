import { z } from "zod";

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; errors: Record<string, string> };

export function flattenZodErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

export function parseResult<T>(
  schema: z.ZodType<T>,
  input: unknown,
): Result<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: flattenZodErrors(parsed.error) };
  }
  return { ok: true, data: parsed.data };
}
