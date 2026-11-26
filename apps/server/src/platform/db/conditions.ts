import { type Column, eq } from "drizzle-orm";

// That the column holds the value, or no condition without one.
export function eqIfGiven(column: Column, value: string | null | undefined) {
  return value ? eq(column, value) : undefined;
}
