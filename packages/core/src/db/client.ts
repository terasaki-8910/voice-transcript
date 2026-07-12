import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

// ACCEPTANCE H3: DATABASE_URL is read only from the environment, never
// hardcoded. Returns undefined (not a throw) when unset -- callers use
// recordHistorySafe/listHistorySafe (history.ts) so a missing/unreachable
// DB never blocks or crashes a transcription (H5).
export function createDb(): Db | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  return drizzle(url, { schema });
}
