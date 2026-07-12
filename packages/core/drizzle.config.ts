import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Only used by `drizzle-kit generate`/`migrate` CLI runs (dev-time); the
    // app itself reads DATABASE_URL via src/db/client.ts, never this file.
    url: process.env.DATABASE_URL ?? "postgresql://placeholder/placeholder",
  },
});
