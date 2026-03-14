import { Pool } from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { readFile } from "fs/promises";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set in the environment");
}

const validatedDatabaseUrl = databaseUrl;

const pool = new Pool({
  connectionString: validatedDatabaseUrl,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getDatabaseName(connectionString: string): string {
  const url = new URL(connectionString);
  const databaseName = url.pathname.replace(/^\//, "");

  if (!databaseName) {
    throw new Error("DATABASE_URL must include a database name");
  }

  return databaseName;
}

function getAdminConnectionString(connectionString: string): string {
  const url = new URL(connectionString);
  url.pathname = "/postgres";
  return url.toString();
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function ensureDatabaseExists(connectionString: string): Promise<void> {
  const databaseName = getDatabaseName(connectionString);
  const adminPool = new Pool({
    connectionString: getAdminConnectionString(connectionString),
  });

  try {
    const result = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      databaseName,
    ]);

    if (result.rowCount === 0) {
      await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
      console.log(`Created local database "${databaseName}".`);
    }
  } finally {
    await adminPool.end();
  }
}

export async function initializeDatabase(): Promise<void> {
  await ensureDatabaseExists(validatedDatabaseUrl);

  const schemaPath = path.join(__dirname, "..", "database", "schema.sql");
  const schemaSql = await readFile(schemaPath, "utf8");

  await pool.query(schemaSql);
}

export default pool;
