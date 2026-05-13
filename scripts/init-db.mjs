#!/usr/bin/env node
// Bootstraps the Postgres schema. Run once per environment:
//   POSTGRES_URL=... node scripts/init-db.mjs
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "@vercel/postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, "../db/schema.sql");
const ddl = readFileSync(schemaPath, "utf8");

// Split on semicolons that terminate statements. Naive but fine for our DDL.
const statements = ddl
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.startsWith("--"));

for (const stmt of statements) {
  process.stdout.write(`> ${stmt.slice(0, 60).replace(/\n/g, " ")}... `);
  // eslint-disable-next-line no-await-in-loop
  await sql.query(stmt);
  process.stdout.write("ok\n");
}
console.log("\nSchema initialized.");
