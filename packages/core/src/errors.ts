import { DrizzleQueryError } from "drizzle-orm/errors";

// drizzle wraps every driver failure as "Failed query: <SQL> params: ..."
// and keeps the actual reason (connection timeout, auth failure, ...) in
// `cause`. The SQL tells the user nothing; the reason does -- and the params
// can hold a whole transcript, which has no place in a log line either.
export function errorMessage(err: unknown): string {
  if (err instanceof DrizzleQueryError && err.cause instanceof Error) return err.cause.message;
  return err instanceof Error ? err.message : String(err);
}
