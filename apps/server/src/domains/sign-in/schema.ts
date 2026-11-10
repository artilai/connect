import type { signIns } from "../../platform/db/schema";

export type SignInRecord = typeof signIns.$inferSelect;

export type NewSignIn = Omit<typeof signIns.$inferInsert, "id" | "accountId" | "codeHash">;
