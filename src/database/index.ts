import { getDatabaseBackend } from "./connection";
import { seedAdmin } from "./seed-admin";

export async function ensureDatabaseReady(): Promise<void> {
  if (getDatabaseBackend() === "postgres" && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in production.");
  }
  await seedAdmin();
}

export * from "./connection";
